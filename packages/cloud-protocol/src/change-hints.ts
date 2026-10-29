import {
  assertCloudScope,
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
} from "./durable";
import { validateCloudChange, type CloudChange } from "./server";

export type CloudChangeHint = Readonly<
  CloudScope & {
    kind: "library-changed";
    sequence: number;
    noteId: string;
  }
>;
const keys = [
  "version",
  "kind",
  "ownerSubject",
  "collectionId",
  "modeGeneration",
  "sequence",
  "noteId",
];
const unavailable = () => Error("Cloud change hint unavailable");
const scopeOf = (value: CloudScope): CloudScope => ({
  version: value.version,
  ownerSubject: value.ownerSubject,
  collectionId: value.collectionId,
  modeGeneration: value.modeGeneration,
});
function validate(input: unknown): CloudChangeHint {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Reflect.ownKeys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    throw unavailable();
  const hint = structuredClone(input) as CloudChangeHint;
  if (
    Object.keys(hint).length !== keys.length ||
    hint.kind !== "library-changed" ||
    !Number.isSafeInteger(hint.sequence) ||
    hint.sequence < 1
  )
    throw unavailable();
  validateCloudScope(scopeOf(hint));
  validateCloudNoteId(hint.noteId);
  return Object.freeze(hint);
}

/** Pure metadata reader. The captured scope is not an authentication or paid grant. */
export function createCloudChangeHintReader(
  input: CloudScope,
): (raw: unknown) => CloudChangeHint {
  let expected: CloudScope;
  try {
    expected = validateCloudScope(input);
  } catch {
    throw unavailable();
  }
  return (raw) => {
    try {
      const hint = validate(raw);
      assertCloudScope(scopeOf(hint), expected);
      return hint;
    } catch {
      throw unavailable();
    }
  };
}

/** The server caller must supply actual committed evidence and its trusted scope. No I/O. */
export function cloudChangeHintFromChange(
  inputScope: CloudScope,
  inputChange: CloudChange,
): CloudChangeHint {
  try {
    const scope = validateCloudScope(inputScope),
      change = validateCloudChange(inputChange);
    return validate({
      ...scope,
      kind: "library-changed",
      sequence: change.sequence,
      noteId: change.noteId,
    });
  } catch {
    throw unavailable();
  }
}
