import {
  validateCloudDraft,
  validateCloudSnapshot,
  verifyMutationHash,
  type CloudMutation,
  type CloudSnapshot,
} from "./index";

// Internal M0 server service. The caller subject must come from a trusted auth adapter.
export const CLOUD_RECEIPT_MS = 90 * 86400000;
export const CLOUD_TRASH_MS = 30 * 86400000;
const MAX_ITEM_BYTES = 400 * 1024;
export interface CloudAccount {
  version: 1;
  ownerSubject: string;
  collectionId: string;
  modeGeneration: number;
  status: "active" | "deleted";
  entitlement: "active" | "inactive";
  revision: number;
  sequence: number;
  wall: number;
}
export type CloudHead =
  | { kind: "missing"; noteId: string; revision: 0 }
  | { kind: "note"; noteId: string; revision: number; snapshot: CloudSnapshot }
  | { kind: "purged"; noteId: string; revision: number; purgedAt: number };
export interface CloudReceipt {
  version: 1;
  opId: string;
  noteId: string;
  contentHash: string;
  collectionId: string;
  modeGeneration: number;
  outcome: "applied" | "conflict";
  revision: number;
  sequence: number | null;
  createdAt: number;
  expiresAt: number;
}
export interface CloudChange {
  version: 1;
  sequence: number;
  noteId: string;
  revision: number;
  kind: "upsert" | "purge";
  createdAt: number;
  expiresAt: number;
}
export interface CloudServerRead {
  account: CloudAccount | null;
  head: CloudHead;
  receipt: CloudReceipt | null;
}
export interface CloudServerCommit {
  expectedAccountRevision: number;
  expectedHeadRevision: number;
  account: CloudAccount;
  head?: CloudHead;
  receipt?: CloudReceipt;
  change?: CloudChange;
}
export interface CloudServerStore {
  readAccount(ownerSubject: string): Promise<CloudAccount | null>;
  read(
    ownerSubject: string,
    noteId: string,
    opId?: string,
  ): Promise<CloudServerRead>;
  commit(
    ownerSubject: string,
    noteId: string,
    transition: CloudServerCommit,
  ): Promise<boolean>;
  close(): Promise<void>;
}
export interface CloudMutationRequest {
  version: 1;
  collectionId: string;
  modeGeneration: number;
  mutation: CloudMutation;
}
export interface CloudServerResult {
  receipt: CloudReceipt;
  head: CloudHead;
  replayed: boolean;
}
export class CloudServerError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`Cloud server: ${code}`);
  }
}
function fail(code: string, status = 400): never {
  throw new CloudServerError(code, status);
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(value);
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
export function validateServerSubject(value: string) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,255}$/.test(value)
  )
    fail("invalid-caller");
}
function shape(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("unrecognized-record");
}
function time(value: number) {
  if (!integer(value) || !Number.isFinite(new Date(value).getTime()))
    fail("invalid-server-time", 503);
  return value;
}
function advance(value: number) {
  if (!integer(value) || !Number.isSafeInteger(value + 1))
    fail("counter-exhausted", 503);
  return value + 1;
}
export function validateCloudAccount(input: CloudAccount): CloudAccount {
  const account = structuredClone(input);
  shape(account, [
    "version",
    "ownerSubject",
    "collectionId",
    "modeGeneration",
    "status",
    "entitlement",
    "revision",
    "sequence",
    "wall",
  ]);
  validateServerSubject(account.ownerSubject);
  if (
    account.version !== 1 ||
    !identifier(account.collectionId) ||
    !integer(account.modeGeneration) ||
    account.modeGeneration < 1 ||
    !["active", "deleted"].includes(account.status) ||
    !["active", "inactive"].includes(account.entitlement) ||
    !integer(account.revision) ||
    account.revision < 1 ||
    !integer(account.sequence)
  )
    fail("unrecognized-account");
  time(account.wall);
  return account;
}
export function validateCloudHead(input: CloudHead): CloudHead {
  const head = structuredClone(input);
  if (!head || !identifier(head.noteId) || !integer(head.revision))
    fail("unrecognized-head");
  if (head.kind === "missing") {
    shape(head, ["kind", "noteId", "revision"]);
    if (head.revision !== 0) fail("unrecognized-head");
  } else if (head.kind === "purged") {
    shape(head, ["kind", "noteId", "revision", "purgedAt"]);
    if (head.revision < 1) fail("unrecognized-head");
    time(head.purgedAt);
  } else if (head.kind === "note") {
    shape(head, ["kind", "noteId", "revision", "snapshot"]);
    const snapshot = validateCloudSnapshot(head.snapshot);
    if (
      snapshot.noteId !== head.noteId ||
      snapshot.serverRevision !== head.revision
    )
      fail("unrecognized-head");
    // Conservative serialized-record budget, not a measurement of DynamoDB's item encoding.
    if (new TextEncoder().encode(JSON.stringify(head)).length > MAX_ITEM_BYTES)
      fail("serialized-item-too-large");
  } else fail("unrecognized-head");
  return head;
}
export function validateCloudReceipt(input: CloudReceipt): CloudReceipt {
  const receipt = structuredClone(input);
  shape(receipt, [
    "version",
    "opId",
    "noteId",
    "contentHash",
    "collectionId",
    "modeGeneration",
    "outcome",
    "revision",
    "sequence",
    "createdAt",
    "expiresAt",
  ]);
  if (
    receipt.version !== 1 ||
    !identifier(receipt.opId) ||
    !identifier(receipt.noteId) ||
    !identifier(receipt.collectionId) ||
    typeof receipt.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(receipt.contentHash) ||
    !integer(receipt.modeGeneration) ||
    receipt.modeGeneration < 1 ||
    !integer(receipt.revision) ||
    !["applied", "conflict"].includes(receipt.outcome) ||
    (receipt.outcome === "applied"
      ? !integer(receipt.sequence) ||
        receipt.sequence < 1 ||
        receipt.revision < 1
      : receipt.sequence !== null)
  )
    fail("unrecognized-receipt");
  time(receipt.createdAt);
  time(receipt.expiresAt);
  if (receipt.expiresAt - receipt.createdAt !== CLOUD_RECEIPT_MS)
    fail("unrecognized-receipt");
  return receipt;
}
export function validateCloudChange(input: CloudChange): CloudChange {
  const change = structuredClone(input);
  shape(change, [
    "version",
    "sequence",
    "noteId",
    "revision",
    "kind",
    "createdAt",
    "expiresAt",
  ]);
  if (
    change.version !== 1 ||
    !integer(change.sequence) ||
    change.sequence < 1 ||
    !identifier(change.noteId) ||
    !integer(change.revision) ||
    change.revision < 1 ||
    !["upsert", "purge"].includes(change.kind)
  )
    fail("unrecognized-change");
  time(change.createdAt);
  time(change.expiresAt);
  if (change.expiresAt - change.createdAt !== CLOUD_RECEIPT_MS)
    fail("unrecognized-change");
  return change;
}
function requireActiveCloudAccount(
  account: CloudAccount | null,
  subject: string,
) {
  if (!account || account.ownerSubject !== subject)
    fail("account-unavailable", 401);
  validateCloudAccount(account);
  if (account.status !== "active") fail("account-deleted", 410);
  if (account.entitlement !== "active") fail("cloud-entitlement-inactive", 403);
  return account;
}
function requireCloudAccountTime(account: CloudAccount, now: number) {
  time(now);
  if (now < account.wall) fail("server-clock-moved-backwards", 503);
  time(now + CLOUD_RECEIPT_MS);
}
export function requireCloudAccount(
  input: CloudAccount | null,
  subject: string,
  scope: { version: 1; collectionId: string; modeGeneration: number },
  now: number,
) {
  const account = requireActiveCloudAccount(input, subject);
  if (
    scope.version !== 1 ||
    scope.collectionId !== account.collectionId ||
    scope.modeGeneration !== account.modeGeneration
  )
    fail("collection-generation-mismatch", 409);
  requireCloudAccountTime(account, now);
  return { account, now };
}
export class CloudMutationService {
  constructor(
    private store: CloudServerStore,
    private clock = () => Date.now(),
  ) {}
  /** Discovery metadata only; each data request must still enforce current access. */
  async libraryContext(subject: string) {
    validateServerSubject(subject);
    const account = requireActiveCloudAccount(
      await this.store.readAccount(subject),
      subject,
    );
    requireCloudAccountTime(account, this.clock());
    return {
      version: 1 as const,
      ownerSubject: account.ownerSubject,
      collectionId: account.collectionId,
      modeGeneration: account.modeGeneration,
    };
  }
  private current(
    read: CloudServerRead,
    subject: string,
    scope: Pick<
      CloudMutationRequest,
      "version" | "collectionId" | "modeGeneration"
    >,
  ) {
    return requireCloudAccount(read.account, subject, scope, this.clock());
  }
  private async expire(subject: string, read: CloudServerRead, now: number) {
    const head = read.head;
    if (
      head.kind !== "note" ||
      head.snapshot.state !== "trashed" ||
      Date.parse(head.snapshot.purgeAfter!) > now
    )
      return false;
    const account = read.account!,
      revision = advance(head.revision),
      sequence = advance(account.sequence);
    const next: CloudHead = {
      kind: "purged",
      noteId: head.noteId,
      revision,
      purgedAt: now,
    };
    await this.store.commit(subject, head.noteId, {
      expectedAccountRevision: account.revision,
      expectedHeadRevision: head.revision,
      account: {
        ...account,
        revision: advance(account.revision),
        sequence,
        wall: now,
      },
      head: next,
      change: {
        version: 1,
        sequence,
        noteId: head.noteId,
        revision,
        kind: "purge",
        createdAt: now,
        expiresAt: now + CLOUD_RECEIPT_MS,
      },
    });
    return true;
  }
  async get(
    subjectInput: string,
    scopeInput: Pick<
      CloudMutationRequest,
      "version" | "collectionId" | "modeGeneration"
    >,
    noteId: string,
  ) {
    const subject = subjectInput,
      scope = structuredClone(scopeInput);
    validateServerSubject(subject);
    if (!identifier(noteId)) fail("invalid-note-id");
    for (let attempt = 0; attempt < 32; attempt++) {
      const read = await this.store.read(subject, noteId);
      const { now } = this.current(read, subject, scope);
      if (await this.expire(subject, read, now)) continue;
      return structuredClone(read.head);
    }
    return fail("store-busy", 503);
  }
  async mutate(
    subjectInput: string,
    input: CloudMutationRequest,
  ): Promise<CloudServerResult> {
    const subject = subjectInput,
      request = structuredClone(input);
    validateServerSubject(subject);
    shape(request, ["version", "collectionId", "modeGeneration", "mutation"]);
    if (
      request.version !== 1 ||
      !identifier(request.collectionId) ||
      !integer(request.modeGeneration) ||
      request.modeGeneration < 1
    )
      fail("unsupported-request");
    const mutation = request.mutation;
    if (!(await verifyMutationHash(mutation)))
      fail("invalid-mutation-hash-or-schema");
    if (
      mutation.snapshot &&
      mutation.snapshot.collectionId !== request.collectionId
    )
      fail("snapshot-collection-mismatch");
    for (let attempt = 0; attempt < 32; attempt++) {
      const read = await this.store.read(
        subject,
        mutation.noteId,
        mutation.opId,
      );
      const { account, now } = this.current(read, subject, request);
      if (await this.expire(subject, read, now)) continue;
      const previous = read.receipt;
      if (previous && previous.expiresAt > now) {
        if (
          previous.contentHash !== mutation.contentHash ||
          previous.noteId !== mutation.noteId ||
          previous.collectionId !== request.collectionId ||
          previous.modeGeneration !== request.modeGeneration
        )
          fail("operation-id-reused", 409);
        return { receipt: previous, head: read.head, replayed: true };
      }
      const conflict =
        read.head.kind === "purged" ||
        mutation.baseRevision !== read.head.revision;
      let head = read.head;
      let change: CloudChange | undefined;
      const sequence = conflict ? account.sequence : advance(account.sequence);
      if (!conflict) {
        const revision = advance(read.head.revision);
        if (mutation.kind === "purge")
          head = {
            kind: "purged",
            noteId: mutation.noteId,
            revision,
            purgedAt: now,
          };
        else {
          const draft = validateCloudDraft(mutation.snapshot!);
          const old = read.head.kind === "note" ? read.head.snapshot : null;
          const deletedAt =
            draft.state === "trashed"
              ? old?.state === "trashed"
                ? old.deletedAt
                : new Date(now).toISOString()
              : null;
          const purgeAfter =
            draft.state === "trashed"
              ? old?.state === "trashed"
                ? old.purgeAfter
                : new Date(now + CLOUD_TRASH_MS).toISOString()
              : null;
          head = {
            kind: "note",
            noteId: mutation.noteId,
            revision,
            snapshot: {
              ...draft,
              createdAt: old?.createdAt ?? draft.createdAt,
              deletedAt,
              purgeAfter,
              serverRevision: revision,
            },
          };
          validateCloudHead(head);
        }
        change = {
          version: 1,
          sequence,
          noteId: mutation.noteId,
          revision,
          kind: mutation.kind,
          createdAt: now,
          expiresAt: now + CLOUD_RECEIPT_MS,
        };
      }
      const receipt: CloudReceipt = {
        version: 1,
        opId: mutation.opId,
        noteId: mutation.noteId,
        contentHash: mutation.contentHash,
        collectionId: request.collectionId,
        modeGeneration: request.modeGeneration,
        outcome: conflict ? "conflict" : "applied",
        revision: head.revision,
        sequence: conflict ? null : sequence,
        createdAt: now,
        expiresAt: now + CLOUD_RECEIPT_MS,
      };
      if (
        await this.store.commit(subject, mutation.noteId, {
          expectedAccountRevision: account.revision,
          expectedHeadRevision: read.head.revision,
          account: {
            ...account,
            revision: advance(account.revision),
            sequence,
            wall: now,
          },
          ...(!conflict ? { head, change } : {}),
          receipt,
        })
      )
        return { receipt, head, replayed: false };
    }
    return fail("store-busy", 503);
  }
}
