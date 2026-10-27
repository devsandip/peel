import Accelerate
import Darwin
import Foundation
import NaturalLanguage

// Isolated, serial OS-framework experiment. No app DB, asset request or networking API.
struct SourceNote: Decodable {
  let noteId: String
  let body: String
  let state: String
  let tags: [String]
}
struct Question: Decodable {
  let caseId: String
  let noteId: String
  let query: String
}
struct Fixture: Decodable {
  let marker: String
  let sourceSHA256: String
  let notes: [SourceNote]
  let questions: [Question]
}
struct Chunk {
  let start: Int
  let end: Int
  let text: String
}
struct Embedded {
  let noteId: String
  let state: String
  let tags: [String]
  let vectors: [[Double]]
}
enum ProbeError: Error { case invalidFixture, invalidVector, unavailable, invalidSource }
let fixtureHash = "8e04b40da6d95b30925a51b303e7feaed551cf5b90b7ee5f4c8a05dd069f5989"
func now() -> UInt64 { DispatchTime.now().uptimeNanoseconds }
func milliseconds(_ start: UInt64) -> Double { Double(now() - start) / 1_000_000 }
func memory() -> [String: Any] {
  var info = task_vm_info_data_t()
  var count = mach_msg_type_number_t(
    MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
  let capacity = Int(count)
  let status = withUnsafeMutablePointer(to: &info) { pointer in
    pointer.withMemoryRebound(to: integer_t.self, capacity: capacity) {
      task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
    }
  }
  var result: [String: Any] = ["taskInfoStatus": status]
  if status == KERN_SUCCESS {
    result["residentBytes"] = info.resident_size
    result["physicalFootprintBytes"] = info.phys_footprint
    result["peakPhysicalFootprintBytes"] = info.ledger_phys_footprint_peak
  }
  var usage = rusage()
  if getrusage(RUSAGE_SELF, &usage) == 0 { result["peakRSSBytes"] = usage.ru_maxrss }
  return result
}
func chunks(_ text: String) throws -> [Chunk] {
  guard text.utf8.count <= 262144 else { throw ProbeError.invalidSource }
  let source = Array(text.unicodeScalars)
  var result: [Chunk] = []
  var start = 0
  while start < source.count {
    let end = min(start + 256, source.count)
    result.append(
      Chunk(start: start, end: end, text: String(String.UnicodeScalarView(source[start..<end]))))
    if end == source.count { break }
    start = end - min(48, (end - start) / 2)
  }
  return result
}
func normalized(_ input: [Double]) throws -> [Double] {
  guard input.count == 512, input.allSatisfy(\.isFinite) else { throw ProbeError.invalidVector }
  let norm = sqrt(input.reduce(0) { $0 + $1 * $1 })
  guard norm.isFinite && norm > 0 else { throw ProbeError.invalidVector }
  return input.map { $0 / norm }
}
func rank(_ notes: [Embedded], _ query: [Double], activeOnly: Bool = false, tags: [String] = [])
  -> [(String, Double, Int)]
{
  var scores: [(String, Double, Int)] = []
  for note in notes {
    if note.state == "trashed" || (activeOnly && note.state != "active")
      || !tags.allSatisfy({ note.tags.contains($0) })
    {
      continue
    }
    var best = -Double.infinity
    var winner = -1
    for (index, vector) in note.vectors.enumerated() {
      var dot = 0.0
      vDSP_dotprD(vector, 1, query, 1, &dot, vDSP_Length(query.count))
      if dot > best {
        best = dot
        winner = index
      }
    }
    if winner >= 0 { scores.append((note.noteId, best, winner)) }
  }
  return scores.sorted { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 > $1.1 }
}
func quantiles(_ values: [Double]) -> [String: Any] {
  let sorted = values.sorted()
  return [
    "count": values.count, "p50": sorted[Int(ceil(Double(sorted.count) * 0.5)) - 1],
    "p95": sorted[Int(ceil(Double(sorted.count) * 0.95)) - 1], "max": sorted.last!,
    "samples": values,
  ]
}
func output(_ report: [String: Any]) throws {
  let bytes = try JSONSerialization.data(
    withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
  FileHandle.standardOutput.write(bytes)
  FileHandle.standardOutput.write(Data("\n".utf8))
}
do {
  guard CommandLine.arguments.count == 2 else { throw ProbeError.invalidFixture }
  let path = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
  guard path.lastPathComponent == "fixture.json",
    path.deletingLastPathComponent().lastPathComponent.hasPrefix("os-sentence-m0-"),
    path.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent == "scratch"
  else { throw ProbeError.invalidFixture }
  let bytes = try Data(contentsOf: path)
  guard bytes.count < 1_048_576 else { throw ProbeError.invalidFixture }
  let fixture = try JSONDecoder().decode(Fixture.self, from: bytes)
  guard fixture.marker == "Peel synthetic OS sentence M0", fixture.sourceSHA256 == fixtureHash,
    fixture.notes.count == 71, fixture.questions.count == 30,
    Set(fixture.notes.map(\.noteId)).count == 71
  else { throw ProbeError.invalidFixture }
  let before = memory()
  let began = now()
  guard NLEmbedding.supportedSentenceEmbeddingRevisions(for: .english).contains(1),
    let model = NLEmbedding.sentenceEmbedding(for: .english, revision: 1)
  else { throw ProbeError.unavailable }
  func embed(_ source: String) throws -> [Double] {
    guard let vector = model.vector(for: source) else { throw ProbeError.invalidVector }
    return try normalized(vector)
  }
  _ = try embed("Synthetic sentence initialization vector")
  let coldMs = milliseconds(began)
  let afterReady = memory()
  let indexBegan = now()
  var embedded: [Embedded] = []
  var totalChunks = 0
  var longestChunks = 0
  var allSourceCovered = true
  for note in fixture.notes {
    if note.state == "trashed" { continue }
    let parts = try chunks(note.body)
    totalChunks += parts.count
    if note.noteId == "kettle" { longestChunks = parts.count }
    var covered = Array(repeating: false, count: note.body.unicodeScalars.count)
    for part in parts { for position in part.start..<part.end { covered[position] = true } }
    allSourceCovered = allSourceCovered && covered.allSatisfy { $0 }
    let vectors = try parts.map { try embed($0.text) }
    embedded.append(
      Embedded(noteId: note.noteId, state: note.state, tags: note.tags, vectors: vectors))
  }
  let indexMs = milliseconds(indexBegan)
  let afterIndex = memory()
  let sanitySource = try chunks(fixture.notes[0].body)[0].text
  let sanityVector = try embed(sanitySource)
  let sanityQuery = try embed(fixture.questions[0].query)
  let scalarDot = zip(sanityVector, sanityQuery).reduce(0.0) { $0 + $1.0 * $1.1 }
  var acceleratedDot = 0.0
  vDSP_dotprD(sanityVector, 1, sanityQuery, 1, &acceleratedDot, 512)
  let apiDistance = model.distance(
    between: sanitySource, and: fixture.questions[0].query, distanceType: .cosine)
  let sanity = [
    "dotImplementationsAgree": abs(scalarDot - acceleratedDot) < 0.000001,
    "frameworkOneMinusCosineAgrees": abs(apiDistance - (1 - scalarDot)) < 0.00001,
    "frameworkSquaredDistanceAgrees": abs(apiDistance * apiDistance - 2 * (1 - scalarDot))
      < 0.00001,
    "exactSourceRanksFirst": rank(embedded, sanityVector).first?.0 == fixture.notes[0].noteId,
  ]
  guard sanity["dotImplementationsAgree"] == true && sanity["exactSourceRanksFirst"] == true else {
    try output([
      "scope": "Synthetic OS sentence embedding controls", "errorCode": "sanity-control-failed",
      "controls": sanity, "frameworkDistance": apiDistance, "calculatedDistance": 1 - scalarDot,
      "scalarDot": scalarDot, "acceleratedDot": acceleratedDot,
      "exactSourceResult": rank(embedded, sanityVector).first?.0 ?? "none",
      "expectedSource": fixture.notes[0].noteId, "realNotesUsed": false,
    ])
    exit(1)
  }
  var quality: [[String: Any]] = []
  var top3 = 0
  for question in fixture.questions {
    let matches = rank(embedded, try embed(question.query))
    let position = matches.firstIndex { $0.0 == question.noteId }.map { $0 + 1 } ?? 0
    if position > 0 && position <= 3 { top3 += 1 }
    quality.append(["caseId": question.caseId, "semanticRank": position])
  }
  let filterVector = try embed(fixture.questions[0].query)
  let active = rank(embedded, filterVector, activeOnly: true)
  let oneTag = embedded.first { !$0.tags.isEmpty }!.tags[0]
  let tagged = rank(embedded, filterVector, tags: [oneTag])
  let filters = [
    "activeOnly": active.allSatisfy { match in
      embedded.first { $0.noteId == match.0 }?.state == "active"
    },
    "tag": !tagged.isEmpty
      && tagged.allSatisfy { match in embedded.first { $0.noteId == match.0 }!.tags.contains(oneTag)
      },
    "trashExcluded": embedded.count == 70 && !embedded.contains { $0.state == "trashed" },
  ]
  var scaled: [Embedded] = []
  var addresses = Set<UInt>()
  for index in 0..<10000 {
    let source = embedded[index % embedded.count]
    let copies = source.vectors.map { vector in vector.withUnsafeBufferPointer { Array($0) } }
    if let vector = copies.first {
      _ = vector.withUnsafeBufferPointer { addresses.insert(UInt(bitPattern: $0.baseAddress!)) }
    }
    scaled.append(
      Embedded(
        noteId: String(format: "scale-%05d", index), state: index % 10 == 0 ? "archived" : "active",
        tags: ["tag-\(index % 500)"], vectors: copies))
  }
  let afterScale = memory()
  var timings: [Double] = []
  var observed = 0
  for index in 0..<100 {
    let started = now()
    let vector = try embed(fixture.questions[index % fixture.questions.count].query)
    observed += rank(scaled, vector).prefix(30).count
    timings.append(milliseconds(started))
  }
  guard observed == 3000, addresses.count == 10000, allSourceCovered,
    filters.values.allSatisfy({ $0 })
  else { throw ProbeError.invalidVector }
  try output([
    "scope":
      "Standalone serial Apple NLEmbedding English revision1, synthetic source; no Tauri/WebKit/iPhone or app acceptance",
    "generatedAt": ISO8601DateFormatter().string(from: Date()),
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "model": [
      "api": "NaturalLanguage.NLEmbedding.sentenceEmbedding", "language": "en",
      "revision": model.revision, "dimensions": model.dimension, "weightHashExposed": false,
      "assetDownloadRequested": false,
    ],
    "fixtureSHA256": fixtureHash,
    "initialization": [
      "modelAndFirstVectorMs": coldMs,
      "boundary":
        "Fresh CLI process measurement after entry; OS asset/filesystem caches may already be warm, excludes executable startup",
    ],
    "indexing": [
      "notes": embedded.count, "chunks": totalChunks, "longNoteChunks": longestChunks,
      "allSourcePassedToAPI": allSourceCovered, "chunkScalarLimit": 256, "overlapScalarLimit": 48,
      "ms": indexMs, "opaqueTokenizerLimitUnresolved": true,
    ],
    "quality": [
      "semanticTop3": top3, "total": fixture.questions.count, "cases": quality,
      "syntheticTop3ThresholdMet": top3 >= 24,
    ],
    "sanityControls": sanity,
    "distanceDiagnostic": [
      "apiDistance": apiDistance, "cosineDistance": 1 - scalarDot,
      "boundary":
        "Observed API distance is compared with both formulas; ranking remains cosine of normalized returned vectors and is unchanged",
    ],
    "filters": filters,
    "scale": [
      "rows": scaled.count, "independentFirstVectorBuffers": addresses.count,
      "source": "Copied fixture vectors, not10000 independently embedded bodies",
    ],
    "warmQueryMs": quantiles(timings),
    "memory": [
      "beforeModel": before, "afterReady": afterReady, "afterIndex": afterIndex,
      "afterScale": afterScale, "final": memory(),
      "boundary":
        "One CLI process Mach task_vm_info resident/physical footprint plus Darwin peak RSS; excludes other processes, system accelerator allocation and full-app/device memory acceptance",
    ],
    "applicationDatabasesOpened": 0,
    "realNotesUsed": false,
  ])
} catch {
  try? output([
    "scope": "Synthetic OS sentence embedding M0",
    "errorCode": error is ProbeError ? String(describing: error) : "native-experiment-failed",
    "realNotesUsed": false,
  ])
  exit(1)
}
