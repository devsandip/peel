import type { CloudScope } from "./durable";
import {
  CloudMutationService,
  CloudServerError,
  CLOUD_RECEIPT_MS,
  requireCloudAccount,
  validateCloudHead,
  type CloudAccount,
  type CloudChange,
  type CloudHead,
  type CloudServerStore,
} from "./server";
export const CLOUD_PAGE_ITEMS = 32,
  CLOUD_PAGE_BYTES = 512 * 1024,
  CLOUD_PAGE_WIRE_BYTES = 640 * 1024;
export const CLOUD_PAGE_LIFETIME_MS = 15 * 60 * 1000;
const hex64 = /^[0-9a-f]{64}$/,
  identifier = /^[a-zA-Z0-9-]{1,128}$/;
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const error = (code: string, status = 400): never => {
  throw new CloudServerError(code, status);
};
export type PullScope = {
  version: 1;
  collectionId: string;
  modeGeneration: number;
};
function requestScope(input: PullScope) {
  const scope = structuredClone(input),
    keys = ["version", "collectionId", "modeGeneration"];
  if (
    !scope ||
    typeof scope !== "object" ||
    Object.keys(scope).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(scope, key)) ||
    scope.version !== 1 ||
    typeof scope.collectionId !== "string" ||
    !identifier.test(scope.collectionId) ||
    !integer(scope.modeGeneration) ||
    scope.modeGeneration < 1
  )
    return error("invalid-pull-scope");
  return scope;
}
export type PullLocation = { kind: "heads" | "changes"; token: string };
export interface CloudPullStart {
  version: 1;
  kind: "bootstrap" | "changes";
  scopeHash: string;
  roundId: string;
  fromSequence: number;
  upperSequence: number | null;
  next: PullLocation;
}
export interface CloudPullPage {
  version: 1;
  kind: "heads" | "changes";
  scopeHash: string;
  roundId: string;
  from: string;
  fromSequence: number;
  upperSequence: number | null;
  throughSequence: number;
  heads: CloudHead[];
  next: PullLocation | null;
  checkpoint: string | null;
}
interface Cursor {
  version: 1;
  scopeHash: string;
  collectionId: string;
  modeGeneration: number;
  roundId: string;
  phase: "notes" | "tombstones" | "changes" | "checkpoint";
  fromSequence: number;
  upperSequence: number | null;
  afterSequence: number;
  afterId: string | null;
  noteUpperId: string | null;
  tombUpperId: string | null;
  issuedAt: number;
  expiresAt: number;
}
type CursorInput = Omit<Cursor, "issuedAt" | "expiresAt">;
export interface CloudPullMetadata {
  account: CloudAccount | null;
  noteUpperId: string | null;
  tombUpperId: string | null;
}
export interface CloudPullServerStore extends CloudServerStore {
  pullMetadata(subject: string): Promise<CloudPullMetadata>;
  headKeys(
    subject: string,
    phase: "notes" | "tombstones",
    after: string | null,
    upper: string | null,
    limit: number,
  ): Promise<{
    account: CloudAccount | null;
    keys: string[];
    hasMore: boolean;
  }>;
  changesPage(
    subject: string,
    after: number,
    upper: number,
    limit: number,
  ): Promise<{
    account: CloudAccount | null;
    changes: CloudChange[];
    hasMore: boolean;
  }>;
}
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
export async function cloudScopeHash(scope: CloudScope) {
  const value = JSON.stringify([
    "Peel Cloud scope v1",
    scope.ownerSubject,
    scope.collectionId,
    scope.modeGeneration,
  ]);
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function cloudPageHash(page: CloudPullPage) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(page)))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
const base64 = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const unbase64 = (value: string) => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return error("invalid-page-token", 403);
  try {
    return Uint8Array.from(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
      (c) => c.charCodeAt(0),
    );
  } catch {
    return error("invalid-page-token", 403);
  }
};
function cursor(value: Cursor): Cursor {
  const keys = [
    "version",
    "scopeHash",
    "collectionId",
    "modeGeneration",
    "roundId",
    "phase",
    "fromSequence",
    "upperSequence",
    "afterSequence",
    "afterId",
    "noteUpperId",
    "tombUpperId",
    "issuedAt",
    "expiresAt",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k)) ||
    value.version !== 1 ||
    typeof value.scopeHash !== "string" ||
    !hex64.test(value.scopeHash) ||
    typeof value.collectionId !== "string" ||
    !identifier.test(value.collectionId) ||
    !integer(value.modeGeneration) ||
    value.modeGeneration < 1 ||
    typeof value.roundId !== "string" ||
    !/^[0-9a-f]{32}$/.test(value.roundId) ||
    !integer(value.fromSequence) ||
    !integer(value.afterSequence) ||
    !integer(value.issuedAt) ||
    !integer(value.expiresAt)
  )
    return error("invalid-page-token", 403);
  if (
    [value.afterId, value.noteUpperId, value.tombUpperId].some(
      (id) => id !== null && (typeof id !== "string" || !identifier.test(id)),
    )
  )
    return error("invalid-page-token", 403);
  const heads = value.phase === "notes" || value.phase === "tombstones";
  if (heads) {
    const upper =
      value.phase === "notes" ? value.noteUpperId : value.tombUpperId;
    if (
      value.upperSequence !== null ||
      value.afterSequence !== value.fromSequence ||
      (value.afterId !== null && (upper === null || value.afterId > upper))
    )
      return error("invalid-page-token", 403);
  } else if (value.phase === "changes" || value.phase === "checkpoint") {
    if (
      !integer(value.upperSequence) ||
      value.upperSequence < value.fromSequence ||
      value.afterSequence < value.fromSequence ||
      value.afterSequence > value.upperSequence ||
      value.afterId !== null ||
      value.noteUpperId !== null ||
      value.tombUpperId !== null ||
      (value.phase === "checkpoint" &&
        (value.fromSequence !== value.upperSequence ||
          value.afterSequence !== value.upperSequence))
    )
      return error("invalid-page-token", 403);
  } else return error("invalid-page-token", 403);
  const lifetime =
    value.phase === "checkpoint" ? CLOUD_RECEIPT_MS : CLOUD_PAGE_LIFETIME_MS;
  if (value.expiresAt - value.issuedAt !== lifetime)
    return error("invalid-page-token", 403);
  return value;
}
export class CloudCursorSigner {
  constructor(
    private key: CryptoKey,
    private clock = () => Date.now(),
  ) {
    if (
      key.type !== "secret" ||
      key.extractable ||
      key.algorithm.name !== "HMAC" ||
      (key.algorithm as HmacKeyAlgorithm).hash.name !== "SHA-256" ||
      !["sign", "verify"].every((use) => key.usages.includes(use as KeyUsage))
    )
      error("invalid-cursor-signing-key", 503);
  }
  async sign(input: CursorInput): Promise<string> {
    const now = this.clock(),
      snapshot = structuredClone(input);
    const payload = cursor({
      ...snapshot,
      issuedAt: now,
      expiresAt:
        now +
        (snapshot.phase === "checkpoint"
          ? CLOUD_RECEIPT_MS
          : CLOUD_PAGE_LIFETIME_MS),
    });
    const data = bytes(payload),
      signature = new Uint8Array(
        await crypto.subtle.sign("HMAC", this.key, data),
      );
    const token = `${base64(data)}.${base64(signature)}`;
    if (
      token.length > 4096 ||
      this.clock() < now ||
      this.clock() >= payload.expiresAt
    )
      error("snapshot-required", 410);
    return token;
  }
  async read(token: string, subject: string): Promise<Cursor> {
    if (typeof token !== "string" || token.length > 4096)
      return error("invalid-page-token", 403);
    const parts = token.split(".");
    if (parts.length !== 2) return error("invalid-page-token", 403);
    const data = unbase64(parts[0]),
      signature = unbase64(parts[1]);
    if (
      signature.byteLength !== 32 ||
      !(await crypto.subtle.verify("HMAC", this.key, signature, data))
    )
      return error("invalid-page-token", 403);
    let payload: Cursor;
    try {
      payload = cursor(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)),
      );
    } catch {
      return error("invalid-page-token", 403);
    }
    const expected = await cloudScopeHash({
      version: 1,
      ownerSubject: subject,
      collectionId: payload.collectionId,
      modeGeneration: payload.modeGeneration,
    });
    if (payload.scopeHash !== expected) return error("foreign-page-token", 403);
    const now = this.clock();
    if (!integer(now) || now < payload.issuedAt || now >= payload.expiresAt)
      return error("snapshot-required", 410);
    return payload;
  }
}
export function validatePullLocation(value: PullLocation): PullLocation {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 2 ||
    !["heads", "changes"].includes(value.kind) ||
    typeof value.token !== "string" ||
    !value.token.length ||
    value.token.length > 4096
  )
    throw Error("Invalid Cloud pull location");
  return structuredClone(value);
}
export function validatePullStart(input: CloudPullStart) {
  const start = structuredClone(input);
  const keys = [
    "version",
    "kind",
    "scopeHash",
    "roundId",
    "fromSequence",
    "upperSequence",
    "next",
  ];
  if (
    !start ||
    Object.keys(start).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(start, key)) ||
    start.version !== 1 ||
    !["bootstrap", "changes"].includes(start.kind) ||
    typeof start.scopeHash !== "string" ||
    !hex64.test(start.scopeHash) ||
    typeof start.roundId !== "string" ||
    !/^[0-9a-f]{32}$/.test(start.roundId) ||
    !integer(start.fromSequence) ||
    (start.kind === "bootstrap"
      ? start.upperSequence !== null
      : !integer(start.upperSequence) ||
        start.upperSequence < start.fromSequence)
  )
    throw Error("Invalid Cloud pull start");
  validatePullLocation(start.next);
  if (start.next.kind !== (start.kind === "bootstrap" ? "heads" : "changes"))
    throw Error("Invalid Cloud pull start phase");
  return start;
}
export function validatePullPage(input: CloudPullPage) {
  const page = structuredClone(input);
  const keys = [
    "version",
    "kind",
    "scopeHash",
    "roundId",
    "from",
    "fromSequence",
    "upperSequence",
    "throughSequence",
    "heads",
    "next",
    "checkpoint",
  ];
  if (
    !page ||
    Object.keys(page).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(page, key)) ||
    page.version !== 1 ||
    !["heads", "changes"].includes(page.kind) ||
    typeof page.scopeHash !== "string" ||
    !hex64.test(page.scopeHash) ||
    typeof page.roundId !== "string" ||
    !/^[0-9a-f]{32}$/.test(page.roundId) ||
    typeof page.from !== "string" ||
    !page.from.length ||
    page.from.length > 4096 ||
    !integer(page.fromSequence) ||
    !integer(page.throughSequence) ||
    page.throughSequence < page.fromSequence ||
    (page.upperSequence !== null &&
      (!integer(page.upperSequence) ||
        page.upperSequence < page.throughSequence)) ||
    (page.kind === "heads"
      ? page.throughSequence !== page.fromSequence
      : page.upperSequence === null) ||
    !Array.isArray(page.heads) ||
    page.heads.length > CLOUD_PAGE_ITEMS ||
    bytes(page).length > CLOUD_PAGE_WIRE_BYTES
  )
    throw Error("Invalid Cloud pull page");
  const ids = new Set<string>();
  for (const inputHead of page.heads) {
    const head = validateCloudHead(inputHead);
    if (head.kind === "missing" || ids.has(head.noteId))
      throw Error("Invalid Cloud pull head");
    ids.add(head.noteId);
  }
  if (page.next !== null) {
    validatePullLocation(page.next);
    if (
      page.checkpoint !== null ||
      (page.kind === "changes" && page.next.kind !== "changes")
    )
      throw Error("Invalid Cloud pull continuation");
  } else if (
    page.kind !== "changes" ||
    page.throughSequence !== page.upperSequence ||
    typeof page.checkpoint !== "string" ||
    !page.checkpoint.length ||
    page.checkpoint.length > 4096
  )
    throw Error("Invalid Cloud pull completion");
  return page;
}
export class CloudPullService {
  private mutations: CloudMutationService;
  constructor(
    private store: CloudPullServerStore,
    private signer: CloudCursorSigner,
    private clock = () => Date.now(),
  ) {
    this.mutations = new CloudMutationService(store, clock);
  }
  private async metadata(subject: string, scope: PullScope) {
    const meta = await this.store.pullMetadata(subject);
    return {
      ...meta,
      ...requireCloudAccount(meta.account, subject, scope, this.clock()),
    };
  }
  private round() {
    return [...crypto.getRandomValues(new Uint8Array(16))]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
  }
  async bootstrap(
    subject: string,
    scopeInput: PullScope,
  ): Promise<CloudPullStart> {
    const scope = requestScope(scopeInput),
      meta = await this.metadata(subject, scope);
    const scopeHash = await cloudScopeHash({ ...scope, ownerSubject: subject }),
      roundId = this.round();
    const token = await this.signer.sign({
      ...scope,
      scopeHash,
      roundId,
      phase: "notes",
      fromSequence: meta.account.sequence,
      upperSequence: null,
      afterSequence: meta.account.sequence,
      afterId: null,
      noteUpperId: meta.noteUpperId,
      tombUpperId: meta.tombUpperId,
    });
    await this.metadata(subject, scope);
    return {
      version: 1,
      kind: "bootstrap",
      scopeHash,
      roundId,
      fromSequence: meta.account.sequence,
      upperSequence: null,
      next: { kind: "heads", token },
    };
  }
  async resume(subject: string, checkpoint: string): Promise<CloudPullStart> {
    const previous = await this.signer.read(checkpoint, subject);
    if (previous.phase !== "checkpoint")
      return error("wrong-page-token-purpose", 403);
    const meta = await this.metadata(subject, previous),
      roundId = this.round();
    if (meta.account.sequence < previous.afterSequence)
      return error("snapshot-required", 410);
    const { issuedAt: _issued, expiresAt: _expires, ...base } = previous;
    const token = await this.signer.sign({
      ...base,
      roundId,
      phase: "changes",
      fromSequence: previous.afterSequence,
      upperSequence: meta.account.sequence,
      afterSequence: previous.afterSequence,
    });
    await this.metadata(subject, previous);
    return {
      version: 1,
      kind: "changes",
      scopeHash: previous.scopeHash,
      roundId,
      fromSequence: previous.afterSequence,
      upperSequence: meta.account.sequence,
      next: { kind: "changes", token },
    };
  }
  async page(
    subject: string,
    locationInput: PullLocation,
    limit = CLOUD_PAGE_ITEMS,
  ): Promise<CloudPullPage> {
    const location = validatePullLocation(locationInput),
      token = location.token;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > CLOUD_PAGE_ITEMS)
      return error("invalid-page-limit");
    const p = await this.signer.read(token, subject),
      scope: PullScope = {
        version: 1,
        collectionId: p.collectionId,
        modeGeneration: p.modeGeneration,
      };
    await this.metadata(subject, scope);
    const isHeads = p.phase === "notes" || p.phase === "tombstones";
    if (
      location.kind !== (isHeads ? "heads" : "changes") ||
      p.phase === "checkpoint"
    )
      return error("wrong-page-token-purpose", 403);
    let heads: CloudHead[] = [],
      next: PullLocation | null = null,
      checkpoint: string | null = null;
    let through = p.fromSequence,
      upper = p.upperSequence;
    const { issuedAt: _issued, expiresAt: _expires, ...base } = p;
    if (isHeads) {
      const phase = p.phase as "notes" | "tombstones";
      const scan = await this.store.headKeys(
        subject,
        phase,
        p.afterId,
        phase === "notes" ? p.noteUpperId : p.tombUpperId,
        limit,
      );
      requireCloudAccount(scan.account, subject, scope, this.clock());
      let used = 0,
        processed = 0,
        afterId = p.afterId;
      for (const id of scan.keys) {
        const head = await this.mutations.get(subject, scope, id);
        if (head.kind === "missing")
          return error("inconsistent-server-head", 503);
        const size = bytes(head).length;
        if (processed > 0 && used + size > CLOUD_PAGE_BYTES) break;
        used += size;
        heads.push(head);
        afterId = id;
        processed++;
      }
      if (processed < scan.keys.length || scan.hasMore) {
        if (afterId === p.afterId)
          return error("nonprogressing-server-page", 503);
        next = {
          kind: "heads",
          token: await this.signer.sign({ ...base, afterId }),
        };
      } else if (phase === "notes")
        next = {
          kind: "heads",
          token: await this.signer.sign({
            ...base,
            phase: "tombstones",
            afterId: null,
          }),
        };
      else {
        const meta = await this.metadata(subject, scope);
        upper = meta.account.sequence;
        if (upper < p.fromSequence) return error("snapshot-required", 410);
        next = {
          kind: "changes",
          token: await this.signer.sign({
            ...base,
            phase: "changes",
            upperSequence: upper,
            afterId: null,
            noteUpperId: null,
            tombUpperId: null,
          }),
        };
      }
    } else {
      const end = p.upperSequence!;
      const scan = await this.store.changesPage(
        subject,
        p.afterSequence,
        end,
        limit,
      );
      requireCloudAccount(scan.account, subject, scope, this.clock());
      if (scan.account!.sequence < end) return error("snapshot-required", 410);
      let expected = p.afterSequence + 1;
      for (const change of scan.changes) {
        if (change.sequence !== expected++ || change.expiresAt <= this.clock())
          return error("snapshot-required", 410);
      }
      if (!scan.hasMore && expected - 1 !== end)
        return error("snapshot-required", 410);
      const byId = new Map<string, CloudHead>();
      let used = 0;
      through = p.afterSequence;
      for (const change of scan.changes) {
        const head = await this.mutations.get(subject, scope, change.noteId);
        if (head.kind === "missing" || head.revision < change.revision)
          return error("inconsistent-server-head", 503);
        const size = bytes(head).length,
          previousSize = byId.has(head.noteId)
            ? bytes(byId.get(head.noteId)).length
            : 0;
        if (
          through > p.afterSequence &&
          used - previousSize + size > CLOUD_PAGE_BYTES
        )
          break;
        used = used - previousSize + size;
        byId.set(head.noteId, head);
        through = change.sequence;
      }
      heads = [...byId.values()];
      if (through < end) {
        if (through === p.afterSequence)
          return error("nonprogressing-server-page", 503);
        next = {
          kind: "changes",
          token: await this.signer.sign({ ...base, afterSequence: through }),
        };
      } else
        checkpoint = await this.signer.sign({
          ...base,
          phase: "checkpoint",
          fromSequence: end,
          upperSequence: end,
          afterSequence: end,
        });
    }
    await this.metadata(subject, scope);
    return validatePullPage({
      version: 1,
      kind: isHeads ? "heads" : "changes",
      scopeHash: p.scopeHash,
      roundId: p.roundId,
      from: token,
      fromSequence: p.fromSequence,
      upperSequence: upper,
      throughSequence: through,
      heads,
      next,
      checkpoint,
    });
  }
}
