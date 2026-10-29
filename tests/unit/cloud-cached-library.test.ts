import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import {
  CloudLibraryPageBuilder,
  validateCloudLibraryPage,
  type CloudLibraryRequest,
} from "../../packages/cloud-protocol/src/library-local";
import {
  cloudDraft,
  cloudScope,
  cloudAck,
} from "../fixtures/cloud-durable-contract";
import {
  applyRemoteCloudHead,
  type CloudDraft,
} from "../../packages/cloud-protocol/src/index";
import { DurableCloudPull } from "../../packages/cloud-protocol/src/pull-local";
import { cloudScopeHash } from "../../packages/cloud-protocol/src/pull";

const request = (
  collection: CloudLibraryRequest["collection"] = "notes",
  limit = 32,
): CloudLibraryRequest => ({ collection, limit, cursor: null });
async function fixture(
  run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>,
) {
  const f = await create();
  try {
    await run(f);
  } finally {
    await f.store.close();
    rmSync(f.parent, { recursive: true, force: true });
  }
}
async function create() {
  const parent = mkdtempSync(join(tmpdir(), "synkies-catalog-")),
    path = join(parent, "cache.sqlite3"),
    store = new SQLiteCloudStateStore(path),
    client = new DurableCloudClient(store, cloudScope);
  return {
    parent,
    path,
    store,
    client,
    save(noteId: string, body: string, extra: Partial<CloudDraft> = {}) {
      return client.save(
        noteId,
        { kind: "upsert", snapshot: { ...cloudDraft(body), noteId, ...extra } },
        null,
      );
    },
  };
}

it("pages globally by edit time and ID with bounded metadata and no bodies", async () =>
  fixture(async (f) => {
    for (let n = 0; n < 35; n++)
      await f.save(
        `note-${String(n).padStart(2, "0")}`,
        `Title ${n}\n${"Unreturned private body ".repeat(200)}`,
        {
          updatedAt: new Date(
            Date.UTC(2026, 9, 28, 0, Math.floor(n / 2)),
          ).toISOString(),
        },
      );
    const ids: string[] = [];
    let next = request("notes", 3);
    for (;;) {
      const page = await f.store.listLibrary(cloudScope, next);
      expect(validateCloudLibraryPage(cloudScope, next, page)).toEqual(page);
      expect(page.entries.length).toBeLessThanOrEqual(3);
      expect(JSON.stringify(page)).not.toContain("Unreturned private body");
      for (const entry of page.entries)
        expect(Object.keys(entry).sort()).toEqual([
          "kind",
          "noteId",
          "status",
          "title",
          "updatedAt",
        ]);
      ids.push(...page.entries.map((entry) => entry.noteId));
      if (!page.next) break;
      next = { ...next, cursor: page.next };
    }
    const expected = Array.from({ length: 35 }, (_, n) => n)
      .sort((a, b) => Math.floor(b / 2) - Math.floor(a / 2) || a - b)
      .map((n) => `note-${String(n).padStart(2, "0")}`);
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(35);
  }));

it("never promotes a retained/in-flight draft to Saved or exposes its body in the catalog", async () =>
  fixture(async (f) => {
    const saved = await f.save("pending", "Newest pending title\nHidden body"),
      prepared = await f.client.prepare(
        "pending",
        saved.generation,
        "catalog-first",
      );
    expect(
      (await f.store.listLibrary(cloudScope, request())).entries[0].status,
    ).toBe("Pending upload");
    await f.client.acknowledge("pending", cloudAck(prepared)); // Controlled state fixture, not provider evidence.
    expect(
      (await f.store.listLibrary(cloudScope, request())).entries[0].status,
    ).toBe("Saved in Cloud");
    const current = (await f.client.get("pending"))!;
    await f.client.save(
      "pending",
      {
        kind: "upsert",
        snapshot: { ...cloudDraft("Later typing"), noteId: "pending" },
      },
      current.generation,
    );
    expect(
      (await f.store.listLibrary(cloudScope, request())).entries[0],
    ).toMatchObject({ title: "Later typing", status: "Pending upload" });
  }));

it("keeps active/archive/trash separate and hides remote deletion titles behind recovery", async () =>
  fixture(async (f) => {
    await f.save("active", "Active title");
    await f.save("archived", "Archive title", { state: "archived" });
    const deletedAt = "2026-10-28T00:00:00.000Z",
      purgeAfter = "2026-11-27T00:00:00.000Z";
    await f.save("trashed", "Trash title", {
      state: "trashed",
      deletedAt,
      purgeAfter,
    });
    for (const [id, purge] of [
      ["deleted-remote", false],
      ["purged-remote", true],
    ] as const) {
      const saved = await f.save(id, "Do not expose this recovery title"),
        prepared = await f.client.prepare(id, saved.generation, id + "-op");
      await f.client.conflict(id, {
        ...cloudAck(prepared),
        revision: 2,
        snapshot: purge
          ? null
          : {
              ...prepared.inFlight!.snapshot!,
              state: "trashed",
              deletedAt,
              purgeAfter,
              serverRevision: 2,
            },
      });
    }
    expect(
      (await f.store.listLibrary(cloudScope, request())).entries.map(
        (entry) => entry.noteId,
      ),
    ).toEqual(["active"]);
    expect(
      (await f.store.listLibrary(cloudScope, request("archive"))).entries.map(
        (entry) => entry.noteId,
      ),
    ).toEqual(["archived"]);
    expect(
      (await f.store.listLibrary(cloudScope, request("trash"))).entries.map(
        (entry) => entry.noteId,
      ),
    ).toEqual(["trashed"]);
    const recovery = await f.store.listLibrary(
      cloudScope,
      request("attention"),
    );
    expect(recovery.entries).toHaveLength(2);
    expect(
      recovery.entries.every(
        (entry) =>
          entry.kind === "recovery" &&
          entry.title === null &&
          entry.status === "Conflict",
      ),
    ).toBe(true);
    expect(JSON.stringify(recovery)).not.toContain("Do not expose");
  }));

it("hides an observed purge before an in-flight receipt settles", async () =>
  fixture(async (f) => {
    const saved = await f.save("observed", "Stale observed title"),
      prepared = await f.client.prepare(
        "observed",
        saved.generation,
        "observed-op",
      ),
      next = applyRemoteCloudHead(prepared, { revision: 2, snapshot: null });
    expect(
      await f.store.commit(cloudScope, "observed", prepared.generation, next),
    ).toBe(true);
    expect((await f.store.listLibrary(cloudScope, request())).entries).toEqual(
      [],
    );
    expect(
      (await f.store.listLibrary(cloudScope, request("attention"))).entries[0],
    ).toMatchObject({
      title: null,
      status: "Pending upload",
      kind: "recovery",
    });
  }));

it("returns pull progress in the same read snapshot without acknowledging pending notes", async () =>
  fixture(async (f) => {
    await f.save("pending", "Still pending");
    const pull = new DurableCloudPull(f.store, cloudScope),
      hash = await cloudScopeHash(cloudScope);
    await pull.begin(
      {
        version: 1,
        kind: "bootstrap",
        roundId: "a".repeat(32),
        scopeHash: hash,
        fromSequence: 0,
        upperSequence: null,
        next: { kind: "heads", token: "synthetic-heads" },
      },
      null,
    );
    const page = await f.store.listLibrary(cloudScope, request());
    expect(page.pull?.next?.token).toBe("synthetic-heads");
    expect(page.entries[0].status).toBe("Pending upload");
  }));

it("rejects foreign stores/cursors/collections and missing cursor/page scopes", async () =>
  fixture(async (f) => {
    await f.save("a", "A");
    await f.save("b", "B");
    const first = await f.store.listLibrary(cloudScope, request("notes", 1)),
      cursor = first.next!;
    await expect(
      f.store.listLibrary(
        { ...cloudScope, ownerSubject: "another-owner" },
        request(),
      ),
    ).rejects.toThrow();
    await expect(
      f.store.listLibrary(cloudScope, { ...request("archive"), cursor }),
    ).rejects.toThrow();
    await expect(
      f.store.listLibrary(cloudScope, {
        ...request(),
        cursor: { ...cursor, scope: { ...cloudScope, modeGeneration: 2 } },
      }),
    ).rejects.toThrow();
    expect(
      () =>
        new CloudLibraryPageBuilder(cloudScope, {
          ...request(),
          cursor: { ...cursor, scope: null as unknown as CloudScope },
        }),
    ).toThrow();
    expect(() =>
      validateCloudLibraryPage(cloudScope, request("notes", 1), {
        ...first,
        scope: null as unknown as CloudScope,
      }),
    ).toThrow();
  }));

it.each([0, 33, NaN, 1.5])(
  "refuses invalid page bound %s without writes",
  async (limit) =>
    fixture(async (f) => {
      await f.save("a", "Preserved");
      await expect(
        f.store.listLibrary(cloudScope, request("notes", limit)),
      ).rejects.toThrow();
      expect((await f.client.get("a"))!.generation).toBe(1);
    }),
);

it.each(["generation", "future", "json"])(
  "refuses %s-corrupted actual SQLite rows without rewriting them",
  async (kind) =>
    fixture(async (f) => {
      await f.save("a", "Preserved body");
      const raw = new DatabaseSync(f.path),
        state = JSON.parse(
          String(raw.prepare("SELECT state FROM m0_cloud_states").get()!.state),
        );
      if (kind === "generation")
        raw.prepare("UPDATE m0_cloud_states SET generation=99").run();
      else
        raw
          .prepare("UPDATE m0_cloud_states SET state=?")
          .run(
            kind === "json" ? "{" : JSON.stringify({ ...state, version: 999 }),
          );
      const before = raw
        .prepare("SELECT generation,state FROM m0_cloud_states")
        .get();
      raw.close();
      await expect(
        f.store.listLibrary(cloudScope, request()),
      ).rejects.toThrow();
      const again = new DatabaseSync(f.path);
      try {
        expect(
          again.prepare("SELECT generation,state FROM m0_cloud_states").get(),
        ).toEqual(before);
      } finally {
        again.close();
      }
    }),
);

it("keeps a locally trashed conflict in Trash when the remote version is also trashed", async () =>
  fixture(async (f) => {
    const saved = await f.save("trash-conflict", "Retained Trash title", {
        state: "trashed",
        deletedAt: "2026-10-28T00:00:00.000Z",
        purgeAfter: "2026-11-27T00:00:00.000Z",
      }),
      prepared = await f.client.prepare(
        "trash-conflict",
        saved.generation,
        "trash-conflict-op",
      );
    await f.client.conflict("trash-conflict", {
      ...cloudAck(prepared),
      revision: 2,
      snapshot: { ...prepared.inFlight!.snapshot!, serverRevision: 2 },
    });
    expect(
      (await f.store.listLibrary(cloudScope, request("trash"))).entries[0],
    ).toMatchObject({
      title: "Retained Trash title",
      kind: "trashed",
      status: "Conflict",
    });
    expect((await f.store.listLibrary(cloudScope, request())).entries).toEqual(
      [],
    );
  }));

it("refuses malformed pull metadata without repairing it", async () =>
  fixture(async (f) => {
    await f.save("a", "Preserved");
    const raw = new DatabaseSync(f.path);
    raw.prepare("UPDATE m0_cloud_meta SET pull_state=?").run("{}");
    raw.close();
    await expect(f.store.listLibrary(cloudScope, request())).rejects.toThrow();
    const again = new DatabaseSync(f.path);
    try {
      expect(
        again.prepare("SELECT pull_state FROM m0_cloud_meta").get()!.pull_state,
      ).toBe("{}");
    } finally {
      again.close();
    }
  }));

it.each(["foreign", "body", "order", "continuation", "status", "oversized"])(
  "refuses an invalid %s metadata page",
  async (kind) =>
    fixture(async (f) => {
      await f.save("a", "A");
      await f.save("b", "B");
      await f.save("c", "C");
      const input = request("notes", 2),
        page = structuredClone(await f.store.listLibrary(cloudScope, input));
      if (kind === "foreign") page.scope.ownerSubject = "foreign-owner";
      if (kind === "body")
        Object.assign(page.entries[0], { bodyMarkdown: "Unexpected body" });
      if (kind === "order") page.entries.reverse();
      if (kind === "continuation") page.next!.noteId = page.entries[0].noteId;
      if (kind === "status")
        page.entries[0] = { ...page.entries[0], status: "Deleted in Cloud" };
      if (kind === "oversized") page.entries.push(page.entries[0]);
      expect(() => validateCloudLibraryPage(cloudScope, input, page)).toThrow();
    }),
);

it("refuses catalog reads after the actual SQLite store closes", async () => {
  const f = await create();
  try {
    await f.save("closed", "Do not serve a stale catalog after close");
    await f.store.close();
    await expect(f.store.listLibrary(cloudScope, request())).rejects.toThrow();
  } finally {
    rmSync(f.parent, { recursive: true, force: true });
  }
});
