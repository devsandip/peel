import {
  applyRemoteCloudHead,
  createCloudClient,
  type CloudClientState,
} from "./index";
import {
  validateCloudScope,
  cloudStateWrite,
  type CloudScope,
  type CloudStateStore,
} from "./durable";
import {
  CLOUD_PAGE_ITEMS,
  cloudPageHash,
  cloudScopeHash,
  validatePullLocation,
  validatePullPage,
  validatePullStart,
  type CloudPullPage,
  type CloudPullStart,
  type PullLocation,
} from "./pull";
export interface CloudPullProgress {
  version: 1;
  generation: number;
  kind: "bootstrap" | "changes";
  roundId: string;
  scopeHash: string;
  fromSequence: number;
  throughSequence: number;
  upperSequence: number | null;
  next: PullLocation | null;
  checkpoint: string | null;
  lastPage: { from: string; digest: string } | null;
}
export interface CloudPageStateWrite {
  noteId: string;
  expectedGeneration: number | null;
  next: CloudClientState;
}
export interface CloudPullStateStore extends CloudStateStore {
  readPull(
    scope: CloudScope,
    noteIds: string[],
  ): Promise<{
    progress: CloudPullProgress | null;
    states: Record<string, CloudClientState | null>;
  }>;
  commitPull(
    scope: CloudScope,
    expectedGeneration: number | null,
    next: CloudPullProgress,
    writes: CloudPageStateWrite[],
  ): Promise<boolean>;
}
const integer = (n: unknown): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0;
export function validatePullProgress(
  input: CloudPullProgress,
): CloudPullProgress {
  const p = structuredClone(input);
  const keys = [
    "version",
    "generation",
    "kind",
    "roundId",
    "scopeHash",
    "fromSequence",
    "throughSequence",
    "upperSequence",
    "next",
    "checkpoint",
    "lastPage",
  ];
  if (
    !p ||
    typeof p !== "object" ||
    Object.keys(p).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(p, key)) ||
    p.version !== 1 ||
    !integer(p.generation) ||
    p.generation < 1 ||
    !["bootstrap", "changes"].includes(p.kind) ||
    typeof p.roundId !== "string" ||
    !/^[0-9a-f]{32}$/.test(p.roundId) ||
    typeof p.scopeHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(p.scopeHash) ||
    !integer(p.fromSequence) ||
    !integer(p.throughSequence) ||
    p.throughSequence < p.fromSequence ||
    (p.upperSequence !== null &&
      (!integer(p.upperSequence) || p.upperSequence < p.throughSequence))
  )
    throw Error("Unrecognized Cloud pull progress");
  if (p.next !== null) validatePullLocation(p.next);
  else if (
    typeof p.checkpoint !== "string" ||
    !p.checkpoint.length ||
    p.throughSequence !== p.upperSequence
  )
    throw Error("Unrecognized Cloud pull completion");
  if (
    p.checkpoint !== null &&
    (typeof p.checkpoint !== "string" ||
      !p.checkpoint.length ||
      p.checkpoint.length > 4096)
  )
    throw Error("Unrecognized Cloud checkpoint");
  if (
    p.lastPage !== null &&
    (!p.lastPage ||
      Object.keys(p.lastPage).length !== 2 ||
      typeof p.lastPage.from !== "string" ||
      !p.lastPage.from.length ||
      p.lastPage.from.length > 4096 ||
      typeof p.lastPage.digest !== "string" ||
      !/^[0-9a-f]{64}$/.test(p.lastPage.digest))
  )
    throw Error("Unrecognized Cloud applied page");
  if (
    p.kind === "changes" &&
    (p.upperSequence === null || p.next?.kind === "heads")
  )
    throw Error("Unrecognized Cloud pull phase");
  return p;
}
export function validatePullWrite(
  scope: CloudScope,
  expected: number | null,
  input: CloudPullProgress,
  inputWrites: CloudPageStateWrite[],
) {
  const next = validatePullProgress(input),
    writes = structuredClone(inputWrites);
  if (
    (expected !== null && !integer(expected)) ||
    next.generation !== (expected ?? 0) + 1 ||
    writes.length > CLOUD_PAGE_ITEMS
  )
    throw Error("Invalid Cloud pull generation transition");
  const ids = new Set<string>();
  for (const write of writes) {
    if (ids.has(write.noteId)) throw Error("Duplicate Cloud page state write");
    ids.add(write.noteId);
    write.next = cloudStateWrite(
      scope,
      write.noteId,
      write.expectedGeneration,
      write.next,
    );
  }
  return { next, writes };
}
export class DurableCloudPull {
  private scope: CloudScope;
  constructor(
    private store: CloudPullStateStore,
    scope: CloudScope,
  ) {
    this.scope = validateCloudScope(scope);
  }
  async progress() {
    return (await this.store.readPull(this.scope, [])).progress;
  }
  async begin(input: CloudPullStart, expectedGeneration: number | null) {
    const start = validatePullStart(input),
      hash = await cloudScopeHash(this.scope);
    if (start.scopeHash !== hash)
      throw Error("Cloud pull belongs to another account or library");
    const previous = (await this.store.readPull(this.scope, [])).progress;
    if ((previous?.generation ?? null) !== expectedGeneration)
      throw Error("Cloud pull round changed; reload progress");
    if (start.kind === "changes") {
      const from =
        previous?.next === null
          ? previous.throughSequence
          : previous?.kind === "changes"
            ? previous.fromSequence
            : null;
      if (!previous?.checkpoint || start.fromSequence !== from)
        throw Error(
          "Cloud changes must resume this store's completed checkpoint",
        );
    }
    const next: CloudPullProgress = {
      version: 1,
      generation: (expectedGeneration ?? 0) + 1,
      kind: start.kind,
      roundId: start.roundId,
      scopeHash: hash,
      fromSequence: start.fromSequence,
      throughSequence: start.fromSequence,
      upperSequence: start.upperSequence,
      next: start.next,
      checkpoint: previous?.checkpoint ?? null,
      lastPage: null,
    };
    if (
      !(await this.store.commitPull(this.scope, expectedGeneration, next, []))
    )
      throw Error("Cloud pull round changed; reload progress");
    return next;
  }
  async apply(input: CloudPullPage) {
    const page = validatePullPage(input),
      hash = await cloudScopeHash(this.scope),
      digest = await cloudPageHash(page);
    if (page.scopeHash !== hash)
      throw Error("Cloud page belongs to another account or library");
    const ids = page.heads.map((head) => head.noteId);
    for (let attempt = 0; attempt < 32; attempt++) {
      const snapshot = await this.store.readPull(this.scope, ids),
        previous = snapshot.progress;
      if (!previous) throw Error("Start a Cloud pull before applying pages");
      if (previous.scopeHash !== hash)
        throw Error("Stored Cloud pull belongs to another scope");
      if (
        previous.roundId !== page.roundId ||
        previous.next?.token !== page.from ||
        previous.next.kind !== page.kind
      )
        return {
          kind:
            previous.lastPage?.from === page.from &&
            previous.lastPage.digest === digest
              ? ("already-applied" as const)
              : ("stale" as const),
          progress: previous,
        };
      if (
        page.fromSequence !== previous.fromSequence ||
        page.throughSequence < previous.throughSequence ||
        (previous.upperSequence !== null &&
          page.upperSequence !== previous.upperSequence) ||
        (page.kind === "heads" &&
          (page.next?.kind === "changes") !== (page.upperSequence !== null)) ||
        (page.kind === "changes" &&
          page.next !== null &&
          page.throughSequence === previous.throughSequence)
      )
        throw Error("Cloud page sequence or phase mismatch");
      const writes: CloudPageStateWrite[] = [];
      for (const head of page.heads) {
        if (head.kind === "missing")
          throw Error("Cloud page contains a missing head");
        const old = snapshot.states[head.noteId] ?? null;
        const next = applyRemoteCloudHead(
          old ?? createCloudClient(this.scope.collectionId, head.noteId),
          {
            revision: head.revision,
            snapshot: head.kind === "note" ? head.snapshot : null,
          },
        );
        if (!old || next.generation !== old.generation)
          writes.push({
            noteId: head.noteId,
            expectedGeneration: old?.generation ?? null,
            next,
          });
      }
      const next: CloudPullProgress = {
        ...previous,
        generation: previous.generation + 1,
        upperSequence: page.upperSequence,
        throughSequence: page.throughSequence,
        next: page.next,
        checkpoint: page.checkpoint ?? previous.checkpoint,
        lastPage: { from: page.from, digest },
      };
      if (
        await this.store.commitPull(
          this.scope,
          previous.generation,
          next,
          writes,
        )
      )
        return { kind: "applied" as const, progress: next };
    }
    throw Error("Cloud page store busy; progress was not advanced, retry");
  }
}
