type Draft = {
  flush: () => Promise<void>;
  freeze: (reason: string) => void;
  unfreeze: (reason: string) => void;
};
const drafts = new Set<Draft>();
const exitReasons = new Set<string>();
export const draftsAreFrozen = () => exitReasons.size > 0;
export function registerDraft(draft: Draft) {
  drafts.add(draft);
  for (const reason of exitReasons) draft.freeze(reason);
  return () => {
    drafts.delete(draft);
  };
}
export async function prepareDraftsForExit(reason: string) {
  exitReasons.add(reason);
  const current = [...drafts];
  for (const draft of current) draft.freeze(reason);
  await Promise.all(current.map((d) => d.flush()));
}
export function releaseDrafts(reason: string) {
  exitReasons.delete(reason);
  for (const draft of drafts) draft.unfreeze(reason);
}
