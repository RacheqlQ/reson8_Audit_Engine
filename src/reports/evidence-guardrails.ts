export const MIN_RELIABLE_TEMPO_CONFIDENCE = 0.5;

type TempoEvidence = {
  bpm?: unknown;
  tempoConfidence?: unknown;
  rhythmFeatures?: unknown;
} | null | undefined;

/**
 * A BPM candidate is reportable only when its confidence is explicit,
 * finite, within the supported analysis range, and not marked as abstained.
 * The threshold is a conservative product gate, not a calibrated accuracy claim.
 */
export function isReliableTempo(value: TempoEvidence): boolean {
  if (!value || typeof value !== "object") return false;
  const bpm = value.bpm;
  const confidence = value.tempoConfidence;
  if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm < 40 || bpm > 240) return false;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return false;
  if (confidence < MIN_RELIABLE_TEMPO_CONFIDENCE || confidence > 1) return false;
  const rhythm = value.rhythmFeatures;
  if (rhythm && typeof rhythm === "object" && (rhythm as Record<string, unknown>).status === "insufficient_evidence") return false;
  return true;
}

function stripUnsupportedTempoClaims(value: unknown): unknown {
  if (typeof value === "string") {
    const sentences = value.match(/[^.!?]+[.!?]?/g) ?? [value];
    const kept = sentences.filter((sentence) =>
      !/\b(?:\d{2,3}\s*bpm|beats per minute|tempo|high[- ]energy)\b/i.test(sentence),
    );
    return kept.join(" ").trim() || "Not asserted: the supporting measurement confidence is insufficient.";
  }
  if (Array.isArray(value)) return value.map(stripUnsupportedTempoClaims);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stripUnsupportedTempoClaims(item)]));
  }
  return value;
}

const TEMPO_UNAVAILABLE_RATIONALE =
  "Tempo and rhythmic consistency remain unscored because the uploaded-master estimate does not meet the minimum confidence gate. A numeric candidate without adequate confidence is not a verified measurement and must not support lane, energy, playlist or release claims.";

const GENRE_UNCONFIRMED_RATIONALE =
  "No definitive provider-backed primary genre is available because the supplied genre classification abstained or lacks a supported primary genre. Keep lane positioning unconfirmed until named source evidence supports a cautious hypothesis.";

export function sanitizeAssessmentForEvidence<T extends Record<string, any>>(
  assessment: T,
  sonicDna: Record<string, unknown> | null | undefined,
): T {
  const reliableTempo = isReliableTempo(sonicDna as TempoEvidence);
  const classification = sonicDna?.genreClassification;
  const genre = classification && typeof classification === "object"
    ? classification as Record<string, unknown>
    : null;
  const hasProviderGenre = Boolean(
    genre && typeof genre.primaryGenre === "string" && genre.primaryGenre.trim()
      && genre.abstained !== true,
  );
  const result = (reliableTempo ? structuredClone(assessment) : stripUnsupportedTempoClaims(assessment)) as T;

  if (!reliableTempo && result.scorecard) {
    if (result.scorecard.tempoLaneFit) result.scorecard.tempoLaneFit = { score: null, rationale: TEMPO_UNAVAILABLE_RATIONALE };
    if (result.scorecard.rhythmicConsistency) result.scorecard.rhythmicConsistency = { score: null, rationale: TEMPO_UNAVAILABLE_RATIONALE };
  }
  if (!hasProviderGenre && result.aAndRPositioning) {
    result.aAndRPositioning.primaryLane = "Unconfirmed — insufficient provider-backed genre evidence";
    result.aAndRPositioning.adjacentLanes = [];
    result.aAndRPositioning.rationale = GENRE_UNCONFIRMED_RATIONALE;
  }
  if (!hasProviderGenre && typeof result.laneHypothesis === "string") {
    result.laneHypothesis = GENRE_UNCONFIRMED_RATIONALE;
  }
  return result;
}
