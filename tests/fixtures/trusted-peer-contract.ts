import { newNote } from "../../packages/core/src/index";
import {
  createIdentity,
  exportPublic,
  nonce,
  signSession,
  type SessionBinding,
} from "../../packages/peer-protocol/src/auth";
import {
  DurableReplica,
  type ReplicaStore,
} from "../../packages/peer-protocol/src/durable";
import { TrustedReplica } from "../../packages/peer-protocol/src/trusted";
import type { Edit } from "../../packages/peer-protocol/src/index";
import type { StoreFactory } from "./peer-store-contract";

const wall = 1793030400000;
const library = "synthetic-current-trust";
function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
const rejected = async (run: () => Promise<unknown>, label: string) => {
  let failed = false;
  try {
    await run();
  } catch {
    failed = true;
  }
  assert(failed, label);
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
export async function runTrustedContract(factory: StoreFactory) {
  const alice = await createIdentity(),
    bob = await createIdentity(),
    third = await createIdentity();
  const stores = new Set<ReplicaStore>();
  const checks: Record<string, boolean> = {};
  const open = (
    name: string,
    hook?: () => void,
    wrap = (store: ReplicaStore) => store,
  ) => {
    const actual = factory(name, hook);
    stores.add(actual);
    const store = wrap(actual);
    return {
      store: actual,
      raw: new DurableReplica(store, library, alice.deviceId),
      trusted: new TrustedReplica(store, library, alice.deviceId, () => wall),
    };
  };
  const binding = (): SessionBinding => ({
    version: 1,
    libraryId: library,
    sessionId: nonce(),
    initiatorId: alice.deviceId,
    responderId: bob.deviceId,
    initiatorNonce: nonce(),
    responderNonce: nonce(),
    offerHash: nonce(),
    answerHash: nonce(),
    expiresAt: wall + 60000,
  });
  const edit = (name: string): Edit => ({
    protocol: 1,
    libraryId: library,
    editId: nonce(),
    stamp: { physical: wall, logical: 0, deviceId: bob.deviceId },
    note: {
      ...newNote("local", "Synthetic trusted peer source"),
      noteId: name,
    },
  });
  const authenticate = async (trusted: TrustedReplica) => {
    const expected = binding();
    return trusted.authorizeSession(await signSession(bob, expected), expected);
  };
  const check = async (name: string, run: () => Promise<void>) => {
    await run();
    checks[name] = true;
  };
  try {
    await check(
      "onlyConfirmedKeyAndExactProofCanClaimWithoutConsumingFailedProof",
      async () => {
        const { store, trusted } = open("proof");
        const expected = binding(),
          proof = await signSession(bob, expected);
        await rejected(
          () => trusted.authorizeSession(proof, expected),
          "Unknown peer trusted",
        );
        await rejected(
          () => trusted.confirmPeer({ ...bob, deviceId: third.deviceId }),
          "Mismatched key trusted",
        );
        await rejected(() => trusted.confirmPeer(alice), "Self paired");
        await trusted.confirmPeer(bob);
        await rejected(
          () =>
            trusted.authorizeSession(proof, {
              ...expected,
              answerHash: nonce(),
            }),
          "Wrong installed transcript accepted",
        );
        await rejected(
          () =>
            trusted.authorizeSession(
              { ...proof, signature: "0".repeat(128) },
              expected,
            ),
          "Bad signature accepted",
        );
        const handle = await trusted.authorizeSession(proof, expected);
        assert(
          handle.peerId === bob.deviceId && Object.isFrozen(handle),
          "Missing immutable handle",
        );
        const snapshot = await store.read(null, [
          `nonce/${expected.initiatorNonce}`,
          `claim/${expected.sessionId}`,
        ]);
        assert(
          snapshot.rows.length === 2,
          "Claim and nonce not persisted together",
        );
      },
    );
    await check(
      "failedClaimRollsBackAndRestartCannotRestoreHandleOrReplay",
      async () => {
        let fail = false;
        let { store, trusted } = open("restart", () => {
          if (fail) throw new Error("Synthetic claim failure");
        });
        await trusted.confirmPeer(bob);
        const expected = binding(),
          proof = await signSession(bob, expected);
        const before = await store.read(null, [
          "meta/identity",
          "meta/session-count",
          `claim/${expected.sessionId}`,
          `nonce/${expected.initiatorNonce}`,
        ]);
        fail = true;
        await rejected(
          () => trusted.authorizeSession(proof, expected),
          "Failed claim returned handle",
        );
        const after = await store.read(null, [
          "meta/identity",
          "meta/session-count",
          `claim/${expected.sessionId}`,
          `nonce/${expected.initiatorNonce}`,
        ]);
        assert(
          JSON.stringify(before) === JSON.stringify(after),
          "Claim partially committed",
        );
        fail = false;
        const handle = await trusted.authorizeSession(proof, expected);
        await store.close();
        stores.delete(store);
        ({ store, trusted } = open("restart"));
        await rejected(
          () => trusted.authorizeSession(proof, expected),
          "Replayed durable challenge accepted",
        );
        await rejected(
          () => trusted.applyEdit(handle, edit("restart-note"), wall),
          "Old instance handle restored",
        );
        const active = await authenticate(trusted);
        await rejected(
          () => trusted.applyEdit({ ...active }, edit("forged-note"), wall),
          "Copied handle accepted",
        );
        const other = new TrustedReplica(
          store,
          library,
          alice.deviceId,
          () => wall,
        );
        await rejected(
          () => other.applyEdit(active, edit("foreign-note"), wall),
          "Foreign instance handle accepted",
        );
      },
    );
    await check(
      "directEditPurgeAndAcknowledgementUseCurrentSessionPeer",
      async () => {
        const { raw, trusted } = open("operations");
        await trusted.confirmPeer(bob);
        const handle = await authenticate(trusted);
        const incoming = edit("trusted-note");
        const receipt = await trusted.applyEdit(handle, incoming, wall);
        assert(
          receipt.committed &&
            (await raw.view("trusted-note")).note?.bodyMarkdown ===
              incoming.note.bodyMarkdown,
          "Direct edit not committed",
        );
        await rejected(
          () =>
            trusted.applyEdit(
              handle,
              {
                ...incoming,
                stamp: { ...incoming.stamp, deviceId: third.deviceId },
              },
              wall,
            ),
          "Forwarded author accepted",
        );
        const local = await raw.saveLocal(
          newNote("local", "Synthetic local delivery"),
          0,
          wall,
          "local-trusted-edit",
          [bob.deviceId, third.deviceId],
        );
        assert(
          !(await trusted.acknowledge(
            handle,
            local.noteId,
            "stale-generation",
            "edit",
          )),
          "Stale ack accepted",
        );
        assert(
          await trusted.acknowledge(
            handle,
            local.noteId,
            "local-trusted-edit",
            "edit",
          ),
          "Current ack missing",
        );
        const pending = (await raw.view(local.noteId)).delivery;
        assert(
          pending?.awaiting.length === 1 &&
            pending.awaiting[0] === third.deviceId,
          "Ack cleared another peer",
        );
        await trusted.applyPurge(handle, {
          protocol: 1,
          libraryId: library,
          noteId: "trusted-note",
          purgeId: nonce(),
          deviceId: bob.deviceId,
          purgedAt: wall,
        });
        assert(
          !(await raw.view("trusted-note")).note &&
            (await raw.view("trusted-note")).tombstone,
          "Purge missing",
        );
      },
    );
    await check(
      "revocationReconfirmationExpiryAndCloseInvalidateCapabilities",
      async () => {
        const { raw, trusted, store } = open("generations");
        await trusted.confirmPeer(bob);
        const first = await authenticate(trusted);
        await trusted.assertCurrent(first);
        await trusted.revokePeer(bob.deviceId);
        await rejected(
          () => trusted.assertCurrent(first),
          "Revoked session allowed outgoing authorization",
        );
        await rejected(
          () => trusted.applyEdit(first, edit("revoked-note"), wall),
          "Revoked edit committed",
        );
        await rejected(
          () => authenticate(trusted),
          "Revoked peer reauthenticated",
        );
        await trusted.confirmPeer(bob);
        await rejected(
          () => trusted.applyEdit(first, edit("old-generation-note"), wall),
          "Reconfirmation revived old handle",
        );
        const second = await authenticate(trusted);
        await trusted.closeSession(second);
        await rejected(
          () => trusted.applyEdit(second, edit("closed-note"), wall),
          "Closed handle committed",
        );
        let now = wall;
        const expiring = new TrustedReplica(
          store,
          library,
          alice.deviceId,
          () => now,
        );
        const handle = await authenticate(expiring);
        now = handle.expiresAt;
        await rejected(
          () => expiring.applyEdit(handle, edit("expired-note"), wall),
          "Expired handle committed",
        );
        const draft = await raw.saveDraft(
          newNote("local", "Synthetic local draft while peer is blocked"),
          0,
          "clock-free-draft",
        );
        assert(
          (await raw.view(draft.noteId)).draft,
          "Authorization blocked local draft",
        );
      },
    );
    await check(
      "malformedAuthorizationMetadataAndSubstitutedKeysFailClosed",
      async () => {
        const { store, trusted } = open("malformed");
        await trusted.confirmPeer(bob);
        const expected = binding(),
          proof = await signSession(bob, expected);
        const replace = async (key: string, data: unknown, remove = false) => {
          const snapshot = await store.read(null, [key]);
          await store.commit(snapshot.revision, [
            { key, row: remove ? null : { key, value: data } },
          ]);
        };
        for (const invalid of [
          null,
          false,
          -1,
          1.5,
          "0",
          Number.MAX_SAFE_INTEGER,
        ]) {
          await replace("meta/session-count", invalid);
          const before = await store.read(null, [
            "meta/session-count",
            `claim/${expected.sessionId}`,
          ]);
          await rejected(
            () => trusted.authorizeSession(proof, expected),
            "Invalid counter permitted claim",
          );
          assert(
            JSON.stringify(before) ===
              JSON.stringify(
                await store.read(null, [
                  "meta/session-count",
                  `claim/${expected.sessionId}`,
                ]),
              ),
            "Invalid counter was overwritten",
          );
        }
        await replace("meta/session-count", null, true);
        for (const key of [
          `nonce/${expected.initiatorNonce}`,
          `claim/${expected.sessionId}`,
        ]) {
          await replace(key, false);
          await rejected(
            () => trusted.authorizeSession(proof, expected),
            "Existing malformed replay record reused",
          );
          await replace(key, null, true);
        }
        const handle = await trusted.authorizeSession(proof, expected);
        const key = `trust/${bob.deviceId}`;
        const previous = (await store.read(null, [key])).rows[0].value;
        await replace(key, {
          ...(previous as object),
          spki: await exportPublic(third),
        });
        await rejected(
          () => authenticate(trusted),
          "Substituted stored key accepted",
        );
        await rejected(
          () => trusted.applyEdit(handle, edit("substituted-key-note"), wall),
          "Changed key revived old capability",
        );
      },
    );
    await check(
      "scopedEnumerationBindsTargetAndRechecksRevocationAfterScan",
      async () => {
        const reached = deferred(),
          resume = deferred();
        let hold = false;
        const wrapped = (base: ReplicaStore): ReplicaStore => ({
          read: (noteId, keys) => base.read(noteId, keys),
          commit: (revision, changes) => base.commit(revision, changes),
          close: () => base.close(),
          scan: async (request) => {
            const page = await base.scan!(request);
            if (hold) {
              reached.resolve();
              await resume.promise;
            }
            return page;
          },
        });
        const { store, raw, trusted } = open("enumeration", undefined, wrapped);
        await trusted.confirmPeer(bob);
        const handle = await authenticate(trusted);
        for (const noteId of ["scoped-one", "scoped-two"])
          await raw.saveLocal(
            { ...newNote("local", "Synthetic scoped source"), noteId },
            0,
            wall,
            `edit-${noteId}`,
            [bob.deviceId, third.deviceId],
          );
        const page = await trusted.pendingPage(handle, null, 1);
        assert(
          page.entries.length === 1 &&
            page.cursor?.peerId === bob.deviceId &&
            !JSON.stringify(page.entries).includes(third.deviceId),
          "Session exposed other delivery targets",
        );
        const resolved = await trusted.resolvePending(handle, page.entries[0]);
        assert(
          resolved.outcome === "ready" && resolved.packet.kind === "edit",
          "Scoped direct generation missing",
        );
        assert(
          !JSON.stringify(await trusted.inventoryPage(handle)).includes(
            "bodyMarkdown",
          ),
          "Scoped metadata exposed source",
        );
        await rejected(
          () => trusted.pendingPage({ ...handle }),
          "Copied handle enumerated",
        );
        hold = true;
        const pending = trusted.pendingPage(handle);
        void pending.catch(() => {});
        let timer: ReturnType<typeof setTimeout>;
        await Promise.race([
          reached.promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Synthetic scan gate timeout")),
              5000,
            );
          }),
        ]).finally(() => clearTimeout(timer));
        try {
          await new TrustedReplica(
            store,
            library,
            alice.deviceId,
            () => wall,
          ).revokePeer(bob.deviceId);
        } finally {
          resume.resolve();
        }
        await rejected(
          () => pending,
          "Revocation during enumeration returned metadata",
        );
        await rejected(
          () => trusted.resolvePending(handle, page.entries[0]),
          "Revoked handle resolved source",
        );
        assert(
          (await raw.view("scoped-one")).delivery?.awaiting.includes(
            bob.deviceId,
          ),
          "Enumeration cleared delivery",
        );
      },
    );
    for (const operation of [
      "authorize",
      "edit",
      "purge",
      "ack",
      "close",
    ] as const) {
      await check(
        `committed${operation === "close" ? "Closure" : "Revocation"}WinsPending${operation === "authorize" ? "Authorization" : operation === "purge" ? "Purge" : operation === "ack" ? "Acknowledgement" : "Edit"}`,
        async () => {
          const reached = deferred(),
            resume = deferred();
          let armed = false,
            paused = false;
          const gated = (base: ReplicaStore): ReplicaStore => ({
            read: (noteId, keys) => base.read(noteId, keys),
            close: () => base.close(),
            commit: async (revision, changes) => {
              const matching = changes.some((change) =>
                change.key.startsWith(
                  operation === "authorize"
                    ? "claim/"
                    : operation === "purge"
                      ? "tombstone/"
                      : operation === "ack"
                        ? "pending/"
                        : "head/",
                ),
              );
              if (armed && !paused && matching) {
                paused = true;
                reached.resolve();
                await resume.promise;
              }
              return base.commit(revision, changes);
            },
          });
          const { raw, trusted } = open(`race-${operation}`, undefined, gated);
          await trusted.confirmPeer(bob);
          const handle =
            operation === "authorize" ? null : await authenticate(trusted);
          const other = open(`race-${operation}`).trusted;
          const noteId = `race-${operation}-note`;
          if (operation === "purge" || operation === "ack")
            await raw.saveLocal(
              { ...newNote("local", "Synthetic retained source"), noteId },
              0,
              wall,
              "race-local-edit",
              [bob.deviceId],
            );
          armed = true;
          const pending =
            operation === "authorize"
              ? authenticate(trusted)
              : operation === "purge"
                ? trusted.applyPurge(handle!, {
                    protocol: 1,
                    libraryId: library,
                    noteId,
                    purgeId: nonce(),
                    deviceId: bob.deviceId,
                    purgedAt: wall,
                  })
                : operation === "ack"
                  ? trusted.acknowledge(
                      handle!,
                      noteId,
                      "race-local-edit",
                      "edit",
                    )
                  : trusted.applyEdit(handle!, edit(noteId), wall);
          void pending.catch(() => {});
          await reached.promise;
          try {
            if (operation === "close") await trusted.closeSession(handle!);
            else await other.revokePeer(bob.deviceId);
          } finally {
            resume.resolve();
          }
          await rejected(
            () => pending,
            "Stale authorization committed after invalidation",
          );
          const view = await raw.view(noteId);
          if (operation === "purge" || operation === "ack") {
            assert(
              view.note?.bodyMarkdown === "Synthetic retained source" &&
                !view.tombstone,
              "Rejected operation removed saved content",
            );
            assert(
              view.delivery?.awaiting.includes(bob.deviceId),
              "Rejected operation cleared pending delivery",
            );
          } else assert(!view.note, "Rejected edit left a note");
        },
      );
    }
    return checks;
  } finally {
    for (const store of stores) await store.close();
  }
}
