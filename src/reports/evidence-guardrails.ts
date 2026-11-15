import { GENRE_TAXONOMY } from "../genre/taxonomy.js";
export const MIN_RELIABLE_TEMPO_CONFIDENCE = 0.5;
export const MIN_RELIABLE_KEY_CONFIDENCE = 0.8;

type TempoEvidence = {
  bpm?: unknown;
  tempoConfidence?: unknown;
  rhythmFeatures?: unknown;
  abstentionReason?: unknown;
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
  if (typeof value.abstentionReason === "string" && value.abstentionReason.trim()) return false;
  const rhythm = value.rhythmFeatures;
  if (rhythm && typeof rhythm === "object") {
    const rhythmRecord = rhythm as Record<string, unknown>;
    if (rhythmRecord.status === "insufficient_evidence") return false;
    if (typeof rhythmRecord.abstentionReason === "string" && rhythmRecord.abstentionReason.trim()) return false;
  }
  return true;
}

export function isReliableKey(value: Record<string, unknown> | null | undefined): boolean {
  if (!value) return false;
  const key = value.key;
  const mode = value.mode;
  const harmonic = value.harmonicFeatures;
  if (harmonic && typeof harmonic === "object" && (harmonic as Record<string, unknown>).status === "insufficient_evidence") return false;
  const confidence = value.keyConfidence;
  const agreement = value.keySegmentAgreement;
  return typeof key === "string" && key.trim().length > 0
    && (mode === "major" || mode === "minor")
    && typeof confidence === "number" && Number.isFinite(confidence)
    && confidence >= MIN_RELIABLE_KEY_CONFIDENCE && confidence <= 1
    && typeof agreement === "number" && Number.isFinite(agreement)
    && agreement >= 0.8 && agreement <= 1;
}

function stripUnsupportedClaims(value: unknown, suppressTempo: boolean, suppressGenre: boolean): unknown {
  if (typeof value === "string") {
    const sentences = value.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const kept = sentences.filter((sentence) => {
      const hasTempoNumber = /\\b(?:\\d{2,3}\\s*bpm|beats per minute)\\b/i.test(sentence);
      const cautionaryTempoContext = /\\b(?:not|no|without|insufficient|unreliable|unverified|uncertain|abstain(?:ed)?|cannot|could not|unable|withheld|not reported|requires review)\\b/i.test(sentence);
      const hasTempoClaim = hasTempoNumber || /\\bhigh[- ]energy\\b/i.test(sentence)
        || (/\\btempo\\b/i.test(sentence) && !cautionaryTempoContext);
      const lower = sentence.toLocaleLowerCase();
      const hasGenreClaim = suppressGenre && GENRE_TAXONOMY.some((genre) =>
        genre.label.length >= 4 && lower.includes(genre.label.toLocaleLowerCase()),
      );
      return !(suppressTempo && hasTempoClaim) && !hasGenreClaim;
    });
    return kept.join(" ").trim() || "Not asserted: the supporting measurement confidence is insufficient.";
  }
  if (Array.isArray(value)) return value.map((item) => stripUnsupportedClaims(item, suppressTempo, suppressGenre));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stripUnsupportedClaims(item, suppressTempo, suppressGenre)]));
  }
  return value;
}

const TEMPO_UNAVAILABLE_RATIONALE =
  "Tempo and rhythmic consistency remain unscored because the uploaded-master estimate does not meet the minimum confidence gate. A numeric candidate without adequate confidence is not a verified measurement and must not support lane, energy, playlist or release claims.";

const GENRE_UNCONFIRMED_RATIONALE =
  "No definitive provider-backed primary genre is available because the supplied genre classification abstained or lacks a supported primary genre. Keep lane positioning unconfirmed until named source evidence supports a cautious hypothesis.";

function hasVerifiedCommercialMetrics(evidence:Record<string,unknown>|null|undefined):boolean {
 if(!evidence)return false;
 const candidates=[evidence.commercialEvidence,evidence.commercialPerformance,evidence.commercialMetrics];
 const metricKeys=["streams","monthlyListeners","listeners","saves","sales","revenue","playlistAdds","conversions","completionRate"];
 return candidates.some((candidate)=>{
  if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return false;
  const record=candidate as Record<string,unknown>;
  if(record.verified!==true||typeof record.source!=="string"||!record.source.trim())return false;
  if(typeof record.reportingPeriod!=="string"||!record.reportingPeriod.trim())return false;
  const metrics=(record.metrics&&typeof record.metrics==="object"&&!Array.isArray(record.metrics))
   ?record.metrics as Record<string,unknown>:record;
  return metricKeys.some(key=>typeof metrics[key]==="number"&&Number.isFinite(metrics[key])&&(metrics[key] as number)>=0);
 });
}

export function sanitizeAssessmentForEvidence<T extends Record<string, any>>(
  assessment: T,
  sonicDna: Record<string, unknown> | null | undefined,
  evidence?: Record<string,unknown> | null,
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
  const result = stripUnsupportedClaims(assessment, !reliableTempo, !hasProviderGenre) as T;

  if (!reliableTempo && result.scorecard) {
    if (result.scorecard.tempoLaneFit) result.scorecard.tempoLaneFit = { score: null, rationale: TEMPO_UNAVAILABLE_RATIONALE };
    if (result.scorecard.rhythmicConsistency) result.scorecard.rhythmicConsistency = { score: null, rationale: TEMPO_UNAVAILABLE_RATIONALE };
  }
  if (!hasProviderGenre && result.aAndRPositioning) {
    result.aAndRPositioning.primaryLane = "Unconfirmed — insufficient provider-backed genre evidence";
    result.aAndRPositioning.adjacentLanes = [];
    result.aAndRPositioning.rationale = GENRE_UNCONFIRMED_RATIONALE;
  }
  const mutable = result as Record<string, any>;
  if (!hasProviderGenre && typeof mutable.laneHypothesis === "string") {
    mutable.laneHypothesis = GENRE_UNCONFIRMED_RATIONALE;
  }
  if (!hasVerifiedCommercialMetrics(evidence) && mutable.commercialRead) {
    mutable.commercialRead = {
      marketability: "undetermined",
      rationale: "No verified, source-attributed commercial-performance metrics are available for this release. Streams, listeners, saves, sales, revenue, playlist conversion and campaign outcomes cannot be inferred from audio features, genre metadata or general catalog context.",
    };
  }
  return result;
}
