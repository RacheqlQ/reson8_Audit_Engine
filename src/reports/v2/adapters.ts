import { hasMultipleTuningWindows, isReliableKey, isReliableTempo } from "../evidence-guardrails.js";
import type { AuditReportInput } from "../generate-audit-report.js";

export type ConfidenceTag = "High" | "Medium" | "Low";
export interface TimedPoint { timeSeconds: number; value: number; }
export interface TrackSection { index: number; label: string; startSeconds: number; endSeconds: number; }
export interface SonicAxis { value: number; note: string | null; }
export interface Comparable {
  title: string; year: string | number; lane: string; similarity: number; basis: string; source: string;
}
export interface FlaggedMoment {
  timestampSeconds: number; title: string; note: string; tag: "Strength" | "Risk" | "Check";
}
export interface MetricValue {
  value: string | number | null; confidence: ConfidenceTag | null; method: string | null; evidence: string;
}
export interface ReportV2Data {
  tempo: MetricValue;
  key: MetricValue;
  energy: MetricValue;
  structure: TrackSection[] | null;
  energySeries: TimedPoint[] | null;
  sonicAxes: Record<"Rhythm" | "Harmony" | "Texture" | "Vocal" | "Space", SonicAxis> | null;
  comparables: Comparable[] | null;
  moments: FlaggedMoment[] | null;
  headlineScore: number | null;
  scoreDrivers: Array<{ label: string; score: number; weight: number | null; evidence: string }> | null;
  hasVerifiedCommercialEvidence: boolean;
  notYetMeasured: string[];
}

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonEmpty = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const confidence = (value: unknown): ConfidenceTag | null => {
  if (!finite(value) || value < 0 || value > 1) return null;
  return value >= 0.8 ? "High" : value >= 0.5 ? "Medium" : "Low";
};
const methodOf = (source: UnknownRecord | null, keys: string[]): string | null => {
  if (!source) return null;
  for (const key of keys) {
    const method = nonEmpty(source[key]);
    if (method) return method;
  }
  return null;
};
const firstFinite = (source: UnknownRecord | null, keys: string[]): number | null => {
  if (!source) return null;
  for (const key of keys) if (finite(source[key])) return source[key] as number;
  return null;
};
const sourceLine = (source: UnknownRecord | null, fallback: string): string =>
  nonEmpty(source?.evidence) ?? nonEmpty(source?.provenance) ?? fallback;

function sectionsFrom(source: UnknownRecord | null): TrackSection[] | null {
  const raw = source?.structure ?? source?.sections;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: TrackSection[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = record(raw[i]);
    const startSeconds = item?.startSeconds ?? item?.start;
    const endSeconds = item?.endSeconds ?? item?.end;
    const label = nonEmpty(item?.label ?? item?.name);
    if (!item || !finite(startSeconds) || !finite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || !label) return null;
    result.push({ index: i + 1, label, startSeconds, endSeconds });
  }
  return result;
}
function seriesFrom(source: UnknownRecord | null): TimedPoint[] | null {
  const raw = source?.energyOverTime ?? source?.energySeries ?? source?.loudnessTimeSeries;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const result: TimedPoint[] = [];
  for (const itemValue of raw) {
    const item = record(itemValue);
    const timeSeconds = item?.timeSeconds ?? item?.time;
    const value = item?.value ?? item?.energy ?? item?.loudness;
    if (!finite(timeSeconds) || timeSeconds < 0 || !finite(value)) return null;
    result.push({ timeSeconds, value });
  }
  return result.every((point, i) => i === 0 || point.timeSeconds > result[i - 1].timeSeconds) ? result : null;
}
function axesFrom(source: UnknownRecord | null): ReportV2Data["sonicAxes"] {
  const raw = record(source?.sonicDnaAxes ?? source?.sonicAxes);
  if (!raw) return null;
  const names = ["Rhythm", "Harmony", "Texture", "Vocal", "Space"] as const;
  const result = {} as NonNullable<ReportV2Data["sonicAxes"]>;
  for (const name of names) {
    const item = record(raw[name] ?? raw[name.toLowerCase()]);
    const value = item?.score ?? item?.value;
    if (!finite(value) || value < 0 || value > 100) return null;
    result[name] = { value, note: nonEmpty(item?.note) };
  }
  return result;
}
function comparablesFrom(source: UnknownRecord | null): Comparable[] | null {
  const raw = source?.verifiedComparables ?? source?.comparables ?? source?.marketComparables;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: Comparable[] = [];
  for (const itemValue of raw) {
    const item = record(itemValue);
    const title = nonEmpty(item?.title);
    const year = item?.year;
    const lane = nonEmpty(item?.lane);
    const similarity = item?.similarity;
    const basis = nonEmpty(item?.basis);
    const origin = nonEmpty(item?.source);
    if (!item || !title || !(typeof year === "string" || finite(year)) || !lane || !finite(similarity) || similarity < 0 || similarity > 100 || !basis || !origin) return null;
    result.push({ title, year, lane, similarity, basis, source: origin });
  }
  return result;
}
function momentsFrom(audio: UnknownRecord | null, evidence: UnknownRecord | null): FlaggedMoment[] | null {
  const raw = audio?.flaggedMoments ?? audio?.moments ?? evidence?.flaggedMoments;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: FlaggedMoment[] = [];
  for (const itemValue of raw) {
    const item = record(itemValue);
    const timestampSeconds = item?.timestampSeconds ?? item?.timeSeconds;
    const title = nonEmpty(item?.title ?? item?.label);
    const note = nonEmpty(item?.note ?? item?.description);
    const tag = item?.tag;
    if (!item || !finite(timestampSeconds) || timestampSeconds < 0 || !title || !note || (tag !== "Strength" && tag !== "Risk" && tag !== "Check")) return null;
    result.push({ timestampSeconds, title, note, tag });
  }
  return result;
}
function commercialEvidenceExists(evidence: UnknownRecord | null): boolean {
  if (!evidence) return false;
  for (const key of ["commercialEvidence", "commercialPerformance", "commercialMetrics"]) {
    const item = record(evidence[key]);
    if (!item || item.verified !== true || !nonEmpty(item.source) || !nonEmpty(item.reportingPeriod)) continue;
    const metrics = record(item.metrics) ?? item;
    if (["streams", "monthlyListeners", "listeners", "saves", "sales", "revenue", "playlistAdds", "conversions", "completionRate"]
      .some((metric) => finite(metrics[metric]) && (metrics[metric] as number) >= 0)) return true;
  }
  return false;
}
function driversFrom(assessment: UnknownRecord | null): ReportV2Data["scoreDrivers"] {
  const raw = assessment?.scoreDrivers;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: NonNullable<ReportV2Data["scoreDrivers"]> = [];
  for (const value of raw) {
    const item = record(value);
    const label = nonEmpty(item?.label);
    if (!item || !label || !finite(item.score) || item.score < 0 || item.score > 100) continue;
    result.push({ label, score: item.score, weight: finite(item.weight) && item.weight >= 0 ? item.weight : null, evidence: nonEmpty(item.evidence) ?? nonEmpty(item.source) ?? "" });
  }
  return result.length ? result : null;
}

/** Read-only projection for v2. Missing or malformed optional evidence is never synthesized. */
export function adaptReportV2(input: AuditReportInput): ReportV2Data {
  const audio = record(input.sonicDna);
  const evidence = record(input.evidence);
  const assessment = record(input.assessment);
  const tempoConfidence = confidence(audio?.tempoConfidence);
  const tempoReliable = isReliableTempo(audio as Parameters<typeof isReliableTempo>[0]);
  const keyConfidence = confidence(audio?.keyConfidence);
  const keyReliable = isReliableKey(audio);
  const energyValue = firstFinite(audio, ["energy", "rmsEnergy", "loudnessLufs", "rmsLevelDbfs"]);
  const energyConfidence = confidence(audio?.energyConfidence ?? audio?.rmsEnergyConfidence ?? audio?.loudnessConfidence);
  const energyMethod = methodOf(audio, ["energyMethod", "loudnessMethod", "method"]);
  const structure = sectionsFrom(audio);
  const energySeries = seriesFrom(audio);
  const sonicAxes = axesFrom(audio);
  const comparables = comparablesFrom(evidence);
  const moments = momentsFrom(audio, evidence);
  const notYetMeasured: string[] = [];
  if (!tempoReliable) {
    const candidate = firstFinite(audio, ["tempoCandidateBpm", "bpm"]);
    if (candidate !== null) {
      notYetMeasured.push(candidate + " (provisional BPM candidate; half-time " + (candidate / 2).toFixed(1) + " BPM; double-time " + (candidate * 2).toFixed(1) + " BPM; not a confirmed tempo).");
    }
  }
  if (!keyReliable) {
    const harmonic = record(audio?.harmonicFeatures);
    const candidates = Array.isArray(harmonic?.topCandidates) ? harmonic.topCandidates.map(record).filter(Boolean) : [];
    const labels = candidates.map(item => [nonEmpty(item?.key), nonEmpty(item?.mode)].filter(Boolean).join(" ")).filter(Boolean);
    if (labels.length) notYetMeasured.push(labels[0] + " (provisional harmonic candidate; alternatives: " + labels.slice(1).join(", ") + "; no single key asserted).");
  }
  if (hasMultipleTuningWindows(audio)) {
    notYetMeasured.push(audio?.keyTuningCents + " (multiple tonal windows; provisional; " + audio?.tuningEvidenceWindows + " windows; tuning offset is not a key assertion).");
  }
  if (!structure) notYetMeasured.push("Track structure — no valid section boundaries supplied.");
  if (!energySeries) notYetMeasured.push("Energy-over-time curve — no valid timestamped energy or loudness series supplied.");
  if (!sonicAxes) notYetMeasured.push("Sonic DNA — all five scored axes are not supplied.");
  if (!comparables) notYetMeasured.push("Market placement — no verified, source-attributed comparables supplied.");
  if (!moments) notYetMeasured.push("Flagged moments — no valid timestamped Strength, Risk or Check moments supplied.");
  return {
    tempo: {
      value: tempoReliable ? audio?.bpm as number : null,
      confidence: tempoConfidence,
      method: methodOf(record(audio?.rhythmFeatures), ["method"]) ?? methodOf(audio, ["tempoMethod", "method"]),
      evidence: sourceLine(record(audio?.rhythmFeatures), "Uploaded-master tempo evidence"),
    },
    key: {
      value: keyReliable ? [audio?.key, audio?.mode].filter((part) => typeof part === "string" && part.trim()).join(" ") : null,
      confidence: keyConfidence,
      method: methodOf(record(audio?.harmonicFeatures), ["method"]) ?? methodOf(audio, ["keyMethod", "method"]),
      evidence: sourceLine(record(audio?.harmonicFeatures), "Uploaded-master harmonic evidence"),
    },
    energy: {
      value: energyConfidence && energyValue !== null ? energyValue : null,
      confidence: energyConfidence,
      method: energyMethod,
      evidence: sourceLine(audio, "Uploaded-master energy evidence"),
    },
    structure, energySeries, sonicAxes, comparables, moments,
    headlineScore: finite(assessment?.headlineScore) && assessment.headlineScore >= 0 && assessment.headlineScore <= 100 ? assessment.headlineScore : null,
    scoreDrivers: driversFrom(assessment),
    hasVerifiedCommercialEvidence: commercialEvidenceExists(evidence),
    notYetMeasured,
  };
}
