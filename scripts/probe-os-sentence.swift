import Darwin
import Foundation
import NaturalLanguage

// Standalone M0 capability check. No app data, asset request or networking API.
let began = DispatchTime.now().uptimeNanoseconds
let revisions = Array(NLEmbedding.supportedSentenceEmbeddingRevisions(for: .english))
let current = NLEmbedding.currentSentenceEmbeddingRevision(for: .english)
var report: [String: Any] = [
  "scope": "Isolated OS English sentence embedding capability, not app/iPhone acceptance",
  "generatedAt": ISO8601DateFormatter().string(from: Date()),
  "os": ProcessInfo.processInfo.operatingSystemVersionString,
  "supportedRevisions": revisions,
  "currentRevision": current,
  "assetDownloadRequested": false,
  "realNotesUsed": false,
]
if let embedding = NLEmbedding.sentenceEmbedding(for: .english, revision: current) {
  let vector = embedding.vector(for: "Synthetic sentence about a mountain walking route")
  let valid = vector?.count == embedding.dimension && vector?.allSatisfy(\.isFinite) == true
  report["available"] = true
  report["revision"] = embedding.revision
  report["dimensions"] = embedding.dimension
  report["finiteVector"] = valid
  report["elapsedMs"] = Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000
} else {
  report["available"] = false
  report["elapsedMs"] = Double(DispatchTime.now().uptimeNanoseconds - began) / 1_000_000
}
var usage = rusage()
if getrusage(RUSAGE_SELF, &usage) == 0 {
  report["peakRSSBytes"] = usage.ru_maxrss
  report["memoryBoundary"] =
    "Darwin getrusage peak RSS for this one CLI process, not unique model allocation or app/iPhone RAM acceptance"
}
let output = try JSONSerialization.data(
  withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
FileHandle.standardOutput.write(output)
FileHandle.standardOutput.write(Data("\n".utf8))
