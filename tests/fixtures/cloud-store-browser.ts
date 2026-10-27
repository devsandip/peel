import { openDB } from "idb";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import {
  cloudAck,
  cloudDraft,
  cloudScope,
  runCloudDurableContract,
} from "./cloud-durable-contract";
import { runCloudHeadContract } from "./cloud-head-contract";
import { runCloudPullContract } from "./cloud-pull-contract";
import {
  createCloudClient,
  saveCloudDraft,
} from "../../packages/cloud-protocol/src/index";
import { cloudScopeHash } from "../../packages/cloud-protocol/src/pull";
import { DurableCloudPull } from "../../packages/cloud-protocol/src/pull-local";

const rejected = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch {
    return true;
  }
  throw Error("Expected isolated browser Cloud store rejection");
};
const remove = (name: string) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(Error("Synthetic Cloud fixture DB still open"));
  });
export async function runBrowserCloudDurability(suffix: string) {
  const names = new Set<string>();
  try {
    const contract = await runCloudDurableContract((name, hook) => {
      const database = `peel-m0-cloud-contract-${suffix}-${name}`;
      names.add(database);
      return new IndexedDBCloudStateStore(database, hook);
    });
    const corruptName = `peel-m0-cloud-corrupt-${suffix}`;
    names.add(corruptName);
    let store = new IndexedDBCloudStateStore(corruptName);
    let repo = new DurableCloudClient(store, cloudScope);
    const saved = await repo.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("Synthetic preserved state") },
      null,
    );
    await store.close();
    let raw = await openDB(corruptName, 2);
    const malformed = structuredClone(saved) as unknown as { version: number };
    malformed.version = 3;
    await raw.put("states", malformed);
    raw.close();
    store = new IndexedDBCloudStateStore(corruptName);
    await rejected(() => store.read(cloudScope, "synthetic-note"));
    await rejected(() =>
      store.commit(cloudScope, "synthetic-note", saved.generation, {
        ...saved,
        generation: saved.generation + 1,
      }),
    );
    await store.close();
    raw = await openDB(corruptName, 2);
    const preserved = (await raw.get("states", "synthetic-note")).version === 3;
    raw.close();
    if (!preserved) throw Error("Malformed state overwritten");
    raw = await openDB(corruptName, 3);
    raw.close();
    store = new IndexedDBCloudStateStore(corruptName);
    await rejected(() => store.read(cloudScope, "synthetic-note"));

    const scopeName = `peel-m0-cloud-badscope-${suffix}`;
    names.add(scopeName);
    store = new IndexedDBCloudStateStore(scopeName);
    await store.close();
    for (const malformedScope of [false, null, {}]) {
      raw = await openDB(scopeName, 2);
      await raw.put("meta", malformedScope, "scope");
      raw.close();
      store = new IndexedDBCloudStateStore(scopeName);
      repo = new DurableCloudClient(store, cloudScope);
      await rejected(() =>
        repo.save(
          "synthetic-note",
          {
            kind: "upsert",
            snapshot: cloudDraft("Must not replace malformed scope"),
          },
          null,
        ),
      );
      await store.close();
      raw = await openDB(scopeName, 2);
      const scopePreserved =
        JSON.stringify(await raw.get("meta", "scope")) ===
          JSON.stringify(malformedScope) && (await raw.count("states")) === 0;
      raw.close();
      if (!scopePreserved) throw Error("Malformed scope overwritten");
    }
    const keyName = `peel-m0-cloud-wrongkey-${suffix}`;
    names.add(keyName);
    raw = await openDB(keyName, 1, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("states", { keyPath: "collectionId" });
      },
    });
    raw.close();
    store = new IndexedDBCloudStateStore(keyName);
    await rejected(() => store.read(cloudScope, "synthetic-note"));
    return {
      ...contract,
      malformedStateAndScopePreserved: true,
      futureVersionRejected: true,
      unexpectedKeyPathRejected: true,
    };
  } finally {
    for (const name of names) await remove(name);
  }
}
export async function prepareBrowserCloudReload(name: string) {
  const store = new IndexedDBCloudStateStore(name);
  const repo = new DurableCloudClient(store, cloudScope);
  try {
    const saved = await repo.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("Synthetic in-flight source") },
      null,
    );
    const prepared = await repo.prepare(
      "synthetic-note",
      saved.generation,
      "reload-op",
    );
    await repo.save(
      "synthetic-note",
      {
        kind: "upsert",
        snapshot: cloudDraft("Synthetic latest pending source"),
      },
      prepared.generation,
    );
    const other = "synthetic-conflict";
    const c = await repo.save(
      other,
      {
        kind: "upsert",
        snapshot: { ...cloudDraft("Synthetic local conflict"), noteId: other },
      },
      null,
    );
    const cp = await repo.prepare(other, c.generation, "reload-conflict-op");
    await repo.conflict(other, {
      ...cloudAck(cp),
      revision: 2,
      snapshot: {
        ...cloudDraft("Synthetic remote conflict"),
        noteId: other,
        serverRevision: 2,
      },
    });
    for (const [id, later] of [
      ["synthetic-head-adopted", false],
      ["synthetic-head-conflict", true],
    ] as const) {
      const saved = await repo.save(
        id,
        {
          kind: "upsert",
          snapshot: {
            ...cloudDraft("Accepted source before reload"),
            noteId: id,
          },
        },
        null,
      );
      const prepared = await repo.prepare(id, saved.generation, `${id}-op`);
      if (later)
        await repo.save(
          id,
          {
            kind: "upsert",
            snapshot: { ...cloudDraft("Later local head source"), noteId: id },
          },
          prepared.generation,
        );
      await repo.acceptedHead(id, {
        ...cloudAck(prepared),
        acceptedRevision: 1,
        revision: 2,
        snapshot: {
          ...cloudDraft("Latest remote head source"),
          noteId: id,
          serverRevision: 2,
        },
      });
    }
    const scopeHash = await cloudScopeHash(cloudScope),
      roundId = "3".repeat(32);
    const pull = new DurableCloudPull(store, cloudScope);
    await pull.begin(
      {
        version: 1,
        kind: "bootstrap",
        scopeHash,
        roundId,
        fromSequence: 0,
        upperSequence: null,
        next: { kind: "heads", token: "reload-head-page" },
      },
      null,
    );
    await pull.apply({
      version: 1,
      kind: "heads",
      scopeHash,
      roundId,
      from: "reload-head-page",
      fromSequence: 0,
      upperSequence: 4,
      throughSequence: 0,
      heads: [
        {
          kind: "note",
          noteId: "synthetic-note",
          revision: 3,
          snapshot: {
            ...cloudDraft("Observed during download"),
            serverRevision: 3,
          },
        },
        {
          kind: "note",
          noteId: "synthetic-pulled",
          revision: 1,
          snapshot: {
            ...cloudDraft("Downloaded source"),
            noteId: "synthetic-pulled",
            serverRevision: 1,
          },
        },
      ],
      next: { kind: "changes", token: "reload-change-page" },
      checkpoint: null,
    });
  } finally {
    await store.close();
  }
}
export async function verifyBrowserCloudReload(name: string) {
  const store = new IndexedDBCloudStateStore(name),
    repo = new DurableCloudClient(store, cloudScope);
  try {
    const pending = await repo.get("synthetic-note"),
      conflict = await repo.get("synthetic-conflict");
    const retry = await repo.retry("synthetic-note");
    const adopted = await repo.get("synthetic-head-adopted"),
      headConflict = await repo.get("synthetic-head-conflict");
    if (
      pending?.current?.snapshot?.bodyMarkdown !==
        "Synthetic latest pending source" ||
      pending.pending?.snapshot?.bodyMarkdown !==
        "Synthetic latest pending source" ||
      retry.snapshot?.bodyMarkdown !== "Synthetic in-flight source" ||
      conflict?.conflict?.local.snapshot?.bodyMarkdown !==
        "Synthetic local conflict" ||
      conflict.conflict.remote?.bodyMarkdown !== "Synthetic remote conflict"
    )
      throw Error("Browser reload lost Cloud source or branches");
    if (
      adopted?.baseRevision !== 2 ||
      adopted.inFlight ||
      adopted.pending ||
      adopted.current?.snapshot?.bodyMarkdown !== "Latest remote head source" ||
      headConflict?.conflict?.local.snapshot?.bodyMarkdown !==
        "Later local head source" ||
      headConflict.conflict.remote?.bodyMarkdown !== "Latest remote head source"
    )
      throw Error("Browser reload lost accepted-head transition");
    const progress = await new DurableCloudPull(store, cloudScope).progress();
    if (
      pending?.observed?.revision !== 3 ||
      progress?.next?.token !== "reload-change-page" ||
      (await repo.get("synthetic-pulled"))?.current?.snapshot?.bodyMarkdown !==
        "Downloaded source"
    )
      throw Error("Browser reload lost page progress or observed head");
    return {
      currentAndPendingSurviveReload: true,
      immutableRetrySurvivesReload: true,
      bothConflictBranchesSurviveReload: true,
      acceptedHeadAdoptionSurvivesReload: true,
      acceptedHeadConflictSurvivesReload: true,
      pageCursorAndObservedHeadSurviveReload: true,
    };
  } finally {
    await store.close();
    await remove(name);
  }
}
export async function runBrowserCloudHeadContract(suffix: string) {
  const names = new Set<string>();
  try {
    return await runCloudHeadContract((name, hook) => {
      const database = `peel-m0-cloud-head-${suffix}-${name}`;
      names.add(database);
      return new IndexedDBCloudStateStore(database, hook);
    });
  } finally {
    for (const name of names) await remove(name);
  }
}
export async function runBrowserCloudPullContract(suffix: string) {
  const names = new Set<string>();
  try {
    const result = await runCloudPullContract((name, hook) => {
      const db = `peel-m0-cloud-pull-${suffix}-${name}`;
      names.add(db);
      return new IndexedDBCloudStateStore(db, hook);
    });
    const name = `peel-m0-cloud-legacy-${suffix}`;
    names.add(name);
    const state = saveCloudDraft(
      createCloudClient(cloudScope.collectionId, "synthetic-note"),
      { kind: "upsert", snapshot: cloudDraft("Legacy browser source") },
    );
    const { observed: _observed, ...old } = state,
      legacy = { ...old, version: 1 };
    let raw = await openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("states", { keyPath: "noteId" });
      },
    });
    await raw.put("meta", cloudScope, "scope");
    await raw.put("states", legacy);
    raw.close();
    let store = new IndexedDBCloudStateStore(name, () => {
      throw Error("Migration interrupted");
    });
    await rejected(() => store.read(cloudScope, "synthetic-note"));
    raw = await openDB(name, 1);
    if (
      raw.version !== 1 ||
      JSON.stringify(await raw.get("states", "synthetic-note")) !==
        JSON.stringify(legacy)
    )
      throw Error("Migration abort changed legacy data");
    raw.close();
    store = new IndexedDBCloudStateStore(name);
    const repo = new DurableCloudClient(store, cloudScope),
      migrated = (await repo.get("synthetic-note"))!;
    if (
      migrated.version !== 2 ||
      migrated.observed !== null ||
      migrated.current?.snapshot?.bodyMarkdown !== "Legacy browser source"
    )
      throw Error("Legacy upgrade lost source");
    await repo.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("After browser upgrade") },
      migrated.generation,
    );
    await store.close();
    await rejected(() => openDB(name, 1));
    return {
      ...result,
      legacyMigrationAndAbortPreserveSource: true,
      oldVersionRefusedAfterUpgrade: true,
    };
  } finally {
    for (const name of names) await remove(name);
  }
}
