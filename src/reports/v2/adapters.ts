import { hasMultipleTuningWindows, hasReportableKeyCandidates, isReliableKey, isReliableTempo } from "../evidence-guardrails.js";
import { hasSubmittedMasterAudio } from "../../audio/master-audio-evidence.js";
import type { AuditReportInput } from "../generate-audit-report.js";
import type { TonalResolution } from "../../audio/tonal-resolution.js";

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
  tonalResolution: TonalResolution | null;
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
  decisionDimensions: DecisionDimension[];
}

export interface DecisionDimension {
  name: "Audio" | "Identity" | "Market" | "Release readiness";
  status: string;
  basis: string;
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
export function buildDecisionDimensions(input: AuditReportInput): DecisionDimension[] {
  const evidence = record(input.evidence);
  const audio = record(input.sonicDna);
  const reconciliation = record(evidence?.reconciliation);
  const conflicts = Array.isArray(reconciliation?.conflicts) ? reconciliation.conflicts : [];
  const reconciledFields = Array.isArray(reconciliation?.reconciledRecordingFields)
    ? reconciliation.reconciledRecordingFields
    : Array.isArray(reconciliation?.reconciledFields)
      ? reconciliation.reconciledFields.filter(field => !["album", "upc", "label", "releaseDate"].includes(String(field)))
      : [];
  const sourceProviders = Array.isArray(evidence?.sourceProviders) ? evidence.sourceProviders.filter(value => typeof value === "string") : [];
  const fieldProvenance = record(evidence?.fieldProvenance);
  const identityFields = ["artist", "title", "isrc"].filter(field =>
    nonEmpty(evidence?.[field]) && (nonEmpty(fieldProvenance?.[field]) !== null || sourceProviders.length > 0)
  );
  const tempoMeasured = isReliableTempo(audio as Parameters<typeof isReliableTempo>[0]);
  const keyMeasured = isReliableKey(audio);
  const descriptiveMeasurements = [
    "loudnessLufs", "loudnessRangeLu", "truePeakDbfs", "rmsLevelDbfs", "rmsEnergy",
    "spectralCentroidHz", "spectralBandwidthHz", "spectralRolloffHz", "zeroCrossingRate",
  ].filter(field => finite(audio?.[field]));
  const audioSubmitted = hasSubmittedMasterAudio(evidence ?? {}, audio);
  const audioMeasures = [
    ...(tempoMeasured ? ["tempo"] : []),
    ...(keyMeasured ? ["song key"] : []),
    ...(descriptiveMeasurements.length ? ["recording profile"] : []),
  ];
  const audioStatus = !audioSubmitted
    ? "NOT MEASURED"
    : audioMeasures.length ? "MEASURED" : "ANALYSIS INCOMPLETE";
  const audioBasis = !audioSubmitted
    ? "No uploaded recording was available for review."
    : "The uploaded recording was reviewed. Only supported findings are presented; artistic quality and final mastering suitability require human review.";

  const identityStatus = conflicts.length
    ? "CONFLICTS OPEN"
    : reconciledFields.length >= 2
      ? "CROSS-CHECKED"
      : identityFields.length >= 2
        ? "SOURCE-RETURNED"
        : "UNVERIFIED";
  const identityBasis = conflicts.length
    ? conflicts.length + " identity field conflict(s) remain unresolved."
    : reconciledFields.length >= 2
      ? "Reconciled fields: " + reconciledFields.join(", ") + "."
      : identityFields.length >= 2
        ? "Source-attributed identity fields: " + identityFields.join(", ") + "."
        : "Fewer than two core identity fields have source attribution.";

  const hasCommercial = commercialEvidenceExists(evidence);
  const marketPlacement = record(input.marketPlacement);
  const hasCatalogueContext = Boolean(
    comparablesFrom(evidence)
    || (Array.isArray(marketPlacement?.playlistPresence) && marketPlacement.playlistPresence.length)
    || (Array.isArray(marketPlacement?.playlistTargets) && marketPlacement.playlistTargets.length)
  );
  const marketStatus = hasCommercial
    ? "PERFORMANCE VERIFIED"
    : hasCatalogueContext ? "CATALOGUE CONTEXT ONLY" : "NOT ESTABLISHED";
  const marketBasis = hasCommercial
    ? "At least one non-negative commercial metric has a verified source and reporting period."
    : hasCatalogueContext
      ? "Source-attributed catalogue or playlist context is present; audience demand and commercial performance are not established."
      : "No verified commercial-performance record or source-attributed market comparison is available.";

  const readinessGates = [
    ["rightsClearanceVerified", "rights clearance"],
    ["deliveryConfirmed", "delivery confirmation"],
    ["releaseStatusVerified", "release status"],
    ["masterApprovalVerified", "final master approval"],
  ] as const;
  const missingGates = readinessGates.filter(([key]) => evidence?.[key] !== true).map(([, label]) => label);
  const releaseStatus = missingGates.length ? "NOT CLEARED" : "GATES VERIFIED";
  const releaseBasis = missingGates.length
    ? "Not source-verified: " + missingGates.join(", ") + "."
    : "All four required release gates are explicitly marked verified in the supplied evidence.";
  return [
    { name: "Audio", status: audioStatus, basis: audioBasis },
    { name: "Identity", status: identityStatus, basis: identityBasis },
    { name: "Market", status: marketStatus, basis: marketBasis },
    { name: "Release readiness", status: releaseStatus, basis: releaseBasis },
  ];
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
  const harmonic = record(audio?.harmonicFeatures);
  const resolutionValue = record(harmonic?.tonalResolution) ?? record(audio?.tonalResolution);
  const tonalResolution = resolutionValue && (resolutionValue.status === "CONFIRMED" || resolutionValue.status === "PROVISIONAL" || resolutionValue.status === "UNAVAILABLE")
    ? resolutionValue as unknown as TonalResolution : null;
  const energyValue = firstFinite(audio, ["energy", "rmsEnergy", "loudnessLufs", "rmsLevelDbfs"]);
  const energyConfidence = confidence(audio?.energyConfidence ?? audio?.rmsEnergyConfidence ?? audio?.loudnessConfidence);
  const energyMethod = methodOf(audio, ["energyMethod", "loudnessMethod", "method"]);
  const loudnessMetrics = [
    finite(audio?.loudnessLufs) ? "Integrated loudness " + Number(audio?.loudnessLufs).toFixed(1) + " LUFS" : null,
    finite(audio?.loudnessRangeLu) ? "Loudness range " + Number(audio?.loudnessRangeLu).toFixed(1) + " LU" : null,
    finite(audio?.truePeakDbfs) ? "True peak " + Number(audio?.truePeakDbfs).toFixed(1) + " dBFS" : null,
    finite(audio?.rmsLevelDbfs) ? "RMS level " + Number(audio?.rmsLevelDbfs).toFixed(1) + " dBFS" : null,
  ].filter((value): value is string => value !== null);
  const energyDisplay = loudnessMetrics.length
    ? loudnessMetrics.join(" · ") + (energyValue === null ? "" : " · Energy index " + Number(energyValue).toFixed(1))
    : energyValue === null ? null : energyValue;
  const structure = sectionsFrom(audio);
  const energySeries = seriesFrom(audio);
  const sonicAxes = axesFrom(audio);
  const comparables = comparablesFrom(evidence);
  const moments = momentsFrom(audio, evidence);
  const notYetMeasured: string[] = [];
  if (!tempoReliable && typeof audio?.tempoConfidence === "number" && Number.isFinite(audio.tempoConfidence) && audio.tempoConfidence > 0) {
    const candidate = firstFinite(audio, ["tempoCandidateBpm", "bpm"]);
    if (candidate !== null && candidate >= 40 && candidate <= 220) {
      const alternatives = [candidate / 2, candidate * 2]
        .filter(value => value >= 40 && value <= 220)
        .map(value => Number(value.toFixed(1)));
      notYetMeasured.push(candidate + " BPM (provisional tempo candidate" +
        (alternatives.length ? "; plausible half/double-time alternatives: " + alternatives.join(" / ") + " BPM" : "") +
        "; not a confirmed tempo).");
    } else if (candidate !== null) {
      notYetMeasured.push("Tempo candidate " + candidate + " BPM abstained: outside the plausible 40–220 BPM reporting range.");
    }
  }
  if (!keyReliable && hasReportableKeyCandidates(audio)) {
    const candidates = Array.isArray(tonalResolution?.candidates)
      ? tonalResolution.candidates.map(item => ({ key: item.tonic, mode: item.mode }))
      : Array.isArray(harmonic?.topCandidates) ? harmonic.topCandidates.map(record).filter(Boolean).map(item => ({ key: item?.key, mode: item?.mode })) : [];
    const labels = candidates.map(item => [nonEmpty(item.key), nonEmpty(item.mode)].filter(Boolean).join(" ")).filter(Boolean);
    if (labels.length) notYetMeasured.push(labels[0] + " (provisional tonal centre; alternatives: " + labels.slice(1).join(", ") + "; no confirmed tonic asserted).");
    const reasons = tonalResolution?.reasonCodes ?? [];
    if (reasons.length) notYetMeasured.push("Tonal resolution limitation: " + reasons.join(", ") + ".");
  } else if (tonalResolution?.status === "UNAVAILABLE") {
    notYetMeasured.push("Tonal resolution unavailable: insufficient stable harmonic evidence in the uploaded master.");
  }
  if (hasMultipleTuningWindows(audio)) {
    notYetMeasured.push("More than one tuning window was detected; a single tuning reference is not confirmed.");
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
    tonalResolution,
    energy: {
      value: energyDisplay,
      confidence: energyConfidence,
      method: energyMethod,
      evidence: sourceLine(audio, "Uploaded-master energy evidence"),
    },
    structure, energySeries, sonicAxes, comparables, moments,
    headlineScore: finite(assessment?.headlineScore) && assessment.headlineScore >= 0 && assessment.headlineScore <= 100 ? assessment.headlineScore : null,
    scoreDrivers: driversFrom(assessment),
    hasVerifiedCommercialEvidence: commercialEvidenceExists(evidence),
    decisionDimensions: buildDecisionDimensions(input),
    notYetMeasured,
  };
}
