// Synthetic only. Never load an existing profile or local database for benchmarks.
export const wordQueries = [
  "onboarding",
  '"useful thought"',
  "tag42",
  "next ide",
  '"room to think"',
  "synthetic 123",
  "onboarding",
  "tag4",
  "close capture",
  "next idea",
];
export function wordFixtures(count = 10000) {
  const time = "2026-10-26T12:00:00.000Z";
  const filler =
    "Keep a useful thought close. Capture the next idea and make room to think. ";
  return Array.from({ length: count }, (_, i) => ({
    schemaVersion: 1,
    collectionId: "local",
    noteId: "00000000-0000-4000-8000-" + i.toString(16).padStart(12, "0"),
    bodyMarkdown: `# Synthetic note ${i}\n${i % 100 === 0 ? "A shorter onboarding signup. " : ""}${filler.repeat(28)}\n##tag${i % 500}`,
    state: i % 10 === 0 ? "archived" : "active",
    createdAt: time,
    updatedAt: time,
    deletedAt: null,
    purgeAfter: null,
    serverRevision: null,
    localRevision: 1,
  }));
}
