import { adjacentGenresFor, findGenre, GENRE_TAXONOMY } from "../genre/taxonomy.js";
import { MIN_RELIABLE_KEY_CONFIDENCE, MIN_KEY_SEGMENT_AGREEMENT } from "../audio/key-estimation.js";
import { MIN_RELIABLE_TEMPO_CONFIDENCE } from "../audio/sonic-dna.js";
export { MIN_RELIABLE_KEY_CONFIDENCE, MIN_RELIABLE_TEMPO_CONFIDENCE };

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

export function hasMultipleTuningWindows(value: Record<string, unknown> | null | undefined): boolean {
  if (!value) return false;
  const tuning = value.keyTuningCents;
  const windows = value.tuningEvidenceWindows;
  return typeof tuning === "number" && Number.isFinite(tuning) && tuning >= -50 && tuning <= 50
    && typeof windows === "number" && Number.isInteger(windows) && windows >= 2;
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
    && agreement >= MIN_KEY_SEGMENT_AGREEMENT && agreement <= 1;
}

function stripUnsupportedClaims(value: unknown, suppressTempo: boolean, suppressGenre: boolean, suppressCommercial: boolean, suppressVocal: boolean, suppressKey: boolean): unknown {
  if (typeof value === "string") {
    const sentences = value.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const kept = sentences.filter((sentence) => {
      const hasTempoNumber = /\b(?:\d{2,3}\s*bpm|beats per minute)\b/i.test(sentence);
      const cautionaryTempoContext = /\b(?:not|no|without|insufficient|unreliable|unverified|uncertain|abstain(?:ed)?|cannot|could not|unable|withheld|not reported|requires? review)\b/i.test(sentence);
      const hasTempoClaim = hasTempoNumber || /\bhigh[- ]energy\b/i.test(sentence)
        || (/\btempo\b/i.test(sentence) && !cautionaryTempoContext);
      const lower = sentence.toLocaleLowerCase();
      const hasGenreClaim = suppressGenre && GENRE_TAXONOMY.some((genre) =>
        genre.label.length >= 4 && lower.includes(genre.label.toLocaleLowerCase()),
      );
      const contradictsProviderGenre = !suppressGenre
        && /\bgenre\b/i.test(sentence)
        && /\b(?:unverified|unknown|undetermined|not established|not confirmed)\b/i.test(sentence);
      const commercialTerms = /\b(?:streams?|monthly listeners?|listeners?|saves?|sales?|revenue|playlist adds?|conversions?|completion rate|marketability|commercial performance|commercial potential|commercial success|commercially (?:promising|viable|strong|successful|attractive|competitive)|demand|traction|market fit)\b/i;
      const cautionaryCommercialContext = /\b(?:cannot|can't|could not|unable|withheld|requires? review)\b/i.test(sentence)
        || /\bno\s+(?:(?:verified|source-attributed|reliable|supporting|sufficient)\s+)*(?:streams?|monthly listeners?|listeners?|saves?|sales?|revenue|playlist adds?|conversions?|commercial (?:performance|potential|success|metrics?)|market demand|traction|market fit|evidence)\b/i.test(sentence)
        || /\bwithout\s+(?:(?:verified|source-attributed|reliable|sufficient)\s+)*(?:commercial (?:performance|metrics?|potential|success)|audience|streams?|monthly listeners?|listeners?|saves?|sales?|revenue|playlist adds?|conversions?|evidence)\b/i.test(sentence)
        || /\b(?:streams?|monthly listeners?|listeners?|saves?|sales?|revenue|playlist adds?|conversions?|commercial (?:performance|potential|success|metrics?)|market demand|traction|market fit|marketability)\s+(?:is|are|remains?|was|were)\s+(?:not|unavailable|unverified|unknown|undetermined|withheld|unsubstantiated)\b/i.test(sentence)
        || /\bnot\s+(?:available|verified|supported|supplied|reported|provided|established|confirmed|measured|substantiated)\b/i.test(sentence)
        || /\binsufficient\s+(?:evidence|data|metrics?|support|reporting)\b/i.test(sentence);
      const actionableMonitoringInstruction = /\b(?:verify|measure|monitor|track|investigate)\s+(?:the\s+)?(?:streams?|monthly listeners?|listeners?|saves?|sales?|revenue|playlist adds?|conversions?|completion rate|market demand|commercial performance|marketability)\b/i.test(sentence);
      const hasCommercialClaim = suppressCommercial && commercialTerms.test(sentence) && !cautionaryCommercialContext && !actionableMonitoringInstruction;
      const vocalClaim = /\b(?:instrumental(?:[- ]only)?|vocal[- ]free|no vocals|without vocals?|without vocal content|no vocal content|vocals? (?:are )?(?:absent|not present|not detected))\b/i;
      const hasUnsupportedVocalClaim = suppressVocal && vocalClaim.test(sentence);
      const keyClaim = /\b[A-G](?:#|b|♯|♭)\s*(?:major|minor)\b|\b[A-G]-(?:sharp|flat)\s*(?:major|minor)\b/i.test(sentence)
        || /\b(?:key|mode|tonic)\s*(?:is|of|:|at|centered on)\s+[A-G]\s*(?:major|minor)\b/i.test(sentence)
        || /\bin\s+[A-G]\s*(?:major|minor)\b/.test(sentence);
      const hasUnsupportedKeyClaim = suppressKey && keyClaim;
      return !(suppressTempo && hasTempoClaim) && !hasGenreClaim && !contradictsProviderGenre && !hasCommercialClaim && !hasUnsupportedVocalClaim && !hasUnsupportedKeyClaim;
    });
    return kept.join(" ").trim();
  }
  if (Array.isArray(value)) return value.map((item) => stripUnsupportedClaims(item, suppressTempo, suppressGenre, suppressCommercial, suppressVocal, suppressKey));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stripUnsupportedClaims(item, suppressTempo, suppressGenre, suppressCommercial, suppressVocal, suppressKey)]));
  }
  return value;
}

const TEMPO_UNAVAILABLE_RATIONALE = "Not scored: the uploaded-master tempo estimate did not pass the confidence gate, so a numeric tempo-to-lane comparison would not be sufficiently supported for this release.";
const RHYTHM_UNAVAILABLE_RATIONALE = "Not scored: the current detector generates a provisional beat-grid candidate but does not independently validate beat timing. A timestamp count alone is not proof of rhythmic consistency.";

const GENRE_UNCONFIRMED_RATIONALE =
  "No definitive provider-backed primary genre is available because the supplied genre classification abstained or lacks a supported primary genre. Keep lane positioning unconfirmed until named source evidence supports a cautious hypothesis.";

const ALBUM_CONFLICT_RATIONALE =
 "Album metadata is present but conflicting across supplied sources. Preserve the source-specific values and reconcile them before treating the album field as complete; do not describe the field as missing.";

function stripUnsupportedTechnicalClaims(
 value: unknown,
 suppressLoudnessOptimisation: boolean,
 suppressBrightTimbre: boolean,
 rmsEnvelopeSpreadDb?: number,
): unknown {
 if (typeof value === "string") {
  const sentences = value.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const kept = sentences.flatMap((sentence) => {
   if (suppressLoudnessOptimisation && /\b(?:LUFS|loudness)\b/i.test(sentence)
     && /\b(?:optimis\w*|increas\w*|rais\w*|louder|target level|push the level)\b/i.test(sentence)) return [];
   if (suppressBrightTimbre && /\bbright(?:ness)?\b/i.test(sentence)) return [];
   // The stored dynamicRangeDb field is an RMS-envelope proxy, not EBU LRA or mastering dynamic range.
   if (/\bdynamic range\b/i.test(sentence) && /\b\d+(?:\.\d+)?\s*dB\b/i.test(sentence)) {
    if (/\b(?:healthy|excellent|great|good|wide|strong|impressive)\b/i.test(sentence)) return [];
    const measured = sentence.match(/\b(\d+(?:\.\d+)?)\s*dB\b/i);
    if (typeof rmsEnvelopeSpreadDb === "number" && measured
      && Math.abs(Number(measured[1]) - rmsEnvelopeSpreadDb) < 0.011) {
     return [sentence.replace(/\bdynamic range\b/ig, "RMS-envelope spread (internal proxy; not mastering dynamic range)")];
    }
    return [];
   }
   return [sentence];
  });
  return kept.join(" ").trim();
 }
 if (Array.isArray(value)) return value.map((item) => stripUnsupportedTechnicalClaims(item, suppressLoudnessOptimisation, suppressBrightTimbre, rmsEnvelopeSpreadDb));
 if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
  .map(([key, item]) => [key, stripUnsupportedTechnicalClaims(item, suppressLoudnessOptimisation, suppressBrightTimbre, rmsEnvelopeSpreadDb)]));
 return value;
}

function hasAlbumConflict(evidence:Record<string,unknown>|null|undefined):boolean {
 if(!evidence)return false;
 const reconciliation=evidence.reconciliation;
 if(!reconciliation||typeof reconciliation!=="object"||Array.isArray(reconciliation))return false;
 const conflicts=(reconciliation as Record<string,unknown>).conflicts;
 return Array.isArray(conflicts)&&conflicts.some((entry)=>Boolean(entry&&typeof entry==="object"&&(entry as Record<string,unknown>).field==="album"));
}

function sanitizeAlbumConflictClaims(value:unknown):unknown {
 if(typeof value==="string"){
  const sentences=value.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const kept=sentences.filter(sentence=>!(/\balbum\b/i.test(sentence)&&/\b(?:missing|unavailable|not supplied|not provided|absent|not present)\b/i.test(sentence)));
  return kept.join(" ").trim();
 }
 if(Array.isArray(value))return value.map(sanitizeAlbumConflictClaims);
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,sanitizeAlbumConflictClaims(item)]));
 return value;
}

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

function hasVocalAnalysis(value: Record<string, unknown> | null | undefined): boolean {
  if (!value) return false;
  const features = value.vocalFeatures;
  if (!features || typeof features !== "object" || Array.isArray(features)) return false;
  const status = (features as Record<string, unknown>).status;
  return status === "analyzed" || status === "measured" || status === "completed";
}

const METADATA_FIELD_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  artist: 15, title: 15, isrc: 20, album: 10, releaseDate: 10, label: 10, upc: 10, genre: 10,
});

export function deriveMetadataCompleteness(evidence?: Record<string, unknown> | null): { score: number; rationale: string } | null {
  if (!evidence) return null;
  const provenance = evidence.fieldProvenance && typeof evidence.fieldProvenance === "object"
    ? evidence.fieldProvenance as Record<string, unknown> : {};
  const conflicts = evidence.reconciliation && typeof evidence.reconciliation === "object"
    ? (evidence.reconciliation as Record<string, unknown>).conflicts : [];
  const conflicted = new Set(Array.isArray(conflicts) ? conflicts.flatMap((item) =>
    item && typeof item === "object" && typeof (item as Record<string, unknown>).field === "string"
      ? [(item as Record<string, unknown>).field as string] : []) : []);
  const reconciledFields = evidence.reconciliation && typeof evidence.reconciliation === "object"
    && Array.isArray((evidence.reconciliation as Record<string, unknown>).reconciledFields)
    ? new Set((evidence.reconciliation as Record<string, unknown>).reconciledFields as string[]) : new Set<string>();
  let available = 0;
  let score = 0;
  for (const [field, weight] of Object.entries(METADATA_FIELD_WEIGHTS)) {
    const raw = field === "genre" ? (evidence.genre ?? evidence.genres) : evidence[field];
    const present = typeof raw === "string" ? raw.trim().length > 0 : Array.isArray(raw) ? raw.length > 0 : false;
    if (!present) continue;
    available++;
    const sourceAttributed = (typeof provenance[field] === "string" && Boolean((provenance[field] as string).trim()))
      || (Array.isArray(provenance[field]) && (provenance[field] as unknown[]).length > 0)
      || reconciledFields.has(field);
    score += weight * (sourceAttributed ? 1 : 0.5) * (conflicted.has(field) ? 0.5 : 1);
  }
  if (available < 2) return null;
  return {
    score: Math.round(score),
    rationale: "Deterministic completeness score across eight core release fields. Source-attributed values receive full credit; conflicting fields receive half credit, and absent fields receive no credit for this release.",
  };
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
  let result = stripUnsupportedClaims(assessment, !reliableTempo, !hasProviderGenre, !hasVerifiedCommercialMetrics(evidence), !hasVocalAnalysis(sonicDna), !isReliableKey(sonicDna)) as T;
  const measuredLoudness = sonicDna?.loudnessLufs;
  const suppressLoudnessOptimisation = typeof measuredLoudness === "number" && Number.isFinite(measuredLoudness) && Math.abs(measuredLoudness + 11) <= 0.6;
  const measuredCentroid = sonicDna?.spectralCentroidHz;
  const suppressBrightTimbre = typeof measuredCentroid === "number" && Number.isFinite(measuredCentroid) && measuredCentroid <= 2_000;
  result = stripUnsupportedTechnicalClaims(result, suppressLoudnessOptimisation, suppressBrightTimbre, typeof sonicDna?.dynamicRangeDb === "number" ? sonicDna.dynamicRangeDb : undefined) as T;

  if (hasAlbumConflict(evidence)) {
    result = sanitizeAlbumConflictClaims(result) as T;
    if (Array.isArray(result.evidenceGaps) && !result.evidenceGaps.some((gap:unknown)=>typeof gap==="string"&&/album metadata is present but conflicting/i.test(gap))) {
      result.evidenceGaps.push(ALBUM_CONFLICT_RATIONALE);
    }

  }

  const mutable = result as Record<string, any>;
  const scorecardDefaults = {
    tempoLaneFit: { score: null, rationale: TEMPO_UNAVAILABLE_RATIONALE },
    rhythmicConsistency: { score: null, rationale: RHYTHM_UNAVAILABLE_RATIONALE },
    dynamicRangeLoudness: { score: null, rationale: "Not scored: RMS-envelope spread and RMS dBFS are descriptive signal measurements, not mastering-readiness criteria. No destination-specific integrated-loudness, loudness-range or true-peak targets were supplied for this release." },
    metadataCompleteness: { score: null, rationale: "Not scored: fewer than two source-attributed core release fields are available to support a reproducible completeness assessment; populate and reconcile identity metadata first for this release." },
    releaseReadiness: { score: null, rationale: "Not scored: source-verified rights clearance, delivery confirmation, release status and master approval are not all present for this specific release; no readiness score is inferred." },
  };
  mutable.scorecard = { ...scorecardDefaults, ...(mutable.scorecard ?? {}) };
  if (result.scorecard) {
    const tempoDimension = result.scorecard.tempoLaneFit;
    const rhythmDimension = result.scorecard.rhythmicConsistency;
    const primaryGenre = hasProviderGenre && genre && typeof genre.primaryGenre === "string" ? findGenre(genre.primaryGenre) : null;
    const bpm = typeof sonicDna?.bpm === "number" && Number.isFinite(sonicDna.bpm) ? sonicDna.bpm : null;
    if (!reliableTempo || bpm === null) {
      if (tempoDimension) result.scorecard.tempoLaneFit = { score: null, rationale: TEMPO_UNAVAILABLE_RATIONALE };
    } else if (!primaryGenre?.tempoHints) {
      if (tempoDimension) result.scorecard.tempoLaneFit = { score: null, rationale: "Not scored: the uploaded-master tempo is confidence-qualified, but no source-backed primary genre with a reference tempo range is available for a defensible tempo-to-lane comparison." };
    } else {
      const [low, high] = primaryGenre.tempoHints;
      const distance = bpm < low ? low - bpm : bpm > high ? bpm - high : 0;
      const score = Math.round(Math.max(0, 1 - distance / Math.max(12, high - low)) * 100);
      if (tempoDimension) result.scorecard.tempoLaneFit = {
        score,
        rationale: "Taxonomy tempo-band fit compares the confidence-qualified uploaded-master BPM against the " + primaryGenre.label + " reference range of " + low + "–" + high + " BPM; this is a positioning heuristic, not a market-performance or audience-response score.",
      };
    }
    const rhythm = sonicDna?.rhythmFeatures && typeof sonicDna.rhythmFeatures === "object"
      ? sonicDna.rhythmFeatures as Record<string, unknown> : {};
    const beatTimes = Array.isArray(rhythm.beatTimesSeconds)
      ? rhythm.beatTimesSeconds.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
    const stableGrid = rhythm.beatGridStatus === "measured" || rhythm.beatGridStatus === "stable";
    if (!reliableTempo || !stableGrid || beatTimes.length < 8) {
      if (rhythmDimension) result.scorecard.rhythmicConsistency = { score: null, rationale: RHYTHM_UNAVAILABLE_RATIONALE };
    } else {
      const intervals = beatTimes.slice(1).map((value, index) => value - beatTimes[index]).filter((value) => value > 0);
      const mean = intervals.reduce((sum, value) => sum + value, 0) / Math.max(1, intervals.length);
      const variance = intervals.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(1, intervals.length);
      const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 1;
      const score = Math.round(Math.max(0, Math.min(1, 1 - coefficientOfVariation / 0.2)) * 100);
      if (rhythmDimension) result.scorecard.rhythmicConsistency = {
        score,
        rationale: "Beat-interval regularity is calculated from " + intervals.length + " measured intervals using their coefficient of variation; it describes timing consistency, not groove quality, emotional feel or listener response.",
      };
    }
    const metadata = deriveMetadataCompleteness(evidence);
    result.scorecard.metadataCompleteness = metadata ?? {
      score: null,
      rationale: hasAlbumConflict(evidence) ? "Not scored: fewer than two source-attributed identity fields are available for a stable completeness estimate; the album conflict is documented in the reconciliation section and remains unresolved." : "Not scored: fewer than two source-attributed core release fields are available to support a reproducible completeness assessment; populate and reconcile identity metadata first for this release.",
    };
    const readinessVerified = evidence?.rightsClearanceVerified === true
      && evidence?.deliveryConfirmed === true
      && evidence?.releaseStatusVerified === true
      && evidence?.masterApprovalVerified === true;
    if (result.scorecard.releaseReadiness && !readinessVerified) {
      result.scorecard.releaseReadiness = {
        score: null,
        rationale: "Not scored: source-verified rights clearance, delivery confirmation, release status and master approval are not all present.",
      };
    }
  }
  if (hasProviderGenre && result.aAndRPositioning && genre) {
    const primaryLane = typeof genre.primaryGenre === "string" ? findGenre(genre.primaryGenre)?.label : null;
    result.aAndRPositioning.primaryLane = primaryLane ?? "Unconfirmed — no taxonomy-backed genre label";
    result.aAndRPositioning.adjacentLanes = adjacentGenresFor(primaryLane);
  }
  if (!reliableTempo && Array.isArray(mutable.risks)) {
    mutable.risks = mutable.risks.filter((risk: unknown) => typeof risk !== "string" || !/tempo and groove consistency require review|tempo confidence.*(?:low|below)|tempo estimate.*(?:unreliable|uncertain)/i.test(risk));
  }
  if (!isReliableKey(sonicDna as Record<string, unknown> | null | undefined) && Array.isArray(mutable.risks)) {
    mutable.risks = mutable.risks.filter((risk: unknown) => typeof risk !== "string" || !/key(?: and mode)? .*?(?:unverified|unknown|not determined|confidence)/i.test(risk));
  }
  if (!hasProviderGenre && result.aAndRPositioning) {
    result.aAndRPositioning.primaryLane = "Unconfirmed — insufficient provider-backed genre evidence";
    result.aAndRPositioning.adjacentLanes = [];
    result.aAndRPositioning.rationale = GENRE_UNCONFIRMED_RATIONALE;
  }
  const dynamicRangeDimension = mutable.scorecard?.dynamicRangeLoudness;
  if (dynamicRangeDimension && typeof dynamicRangeDimension === "object") {
    dynamicRangeDimension.score = null;
    dynamicRangeDimension.rationale = "Not scored: RMS-envelope spread and RMS dBFS are descriptive signal measurements, not mastering-readiness criteria. No destination-specific integrated-loudness, loudness-range or true-peak targets were supplied for this release.";
  }
  if (sonicDna?.channels === 1 && Array.isArray(mutable.risks)
    && !mutable.risks.some((risk: unknown) => typeof risk === "string" && /mono master delivery risk/i.test(risk))) {
    mutable.risks.push("Mono master delivery risk: confirm the destination distributor and DSP delivery requirements accept a single-channel master before release.");
  }
  const zeroConfidence = typeof assessment.confidence === "number"
    && Number.isFinite(assessment.confidence)
    && assessment.confidence <= 0;
  const hasUploadedAudioMaster = sonicDna?.provenance === "uploaded_audio_master";
  if (!hasUploadedAudioMaster && Array.isArray(mutable.strengths)) {
    mutable.strengths = mutable.strengths.filter((strength: unknown) =>
      typeof strength !== "string" || !/\b(?:bpm|tempo|key|mode|loudness|lufs|rms|dynamic range|spectral|vocal|frequency|master-derived|audio measurement)\b/i.test(strength));
  }
  if (Array.isArray(mutable.evidenceLabels)) {
    mutable.evidenceLabels = mutable.evidenceLabels.filter((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const record = entry as Record<string, unknown>;
      if (!hasUploadedAudioMaster && record.label === "OBSERVED") return false;
      if (record.source === "synthetic_audio_fixture") return false;
      const claim = typeof record.claim === "string" ? record.claim : "";
      if (!reliableTempo && /\b(?:tempo|bpm|beats per minute)\b/i.test(claim)) return false;
      if (!isReliableKey(sonicDna as Record<string, unknown> | null | undefined) && /\b(?:key|mode|major|minor|tonic)\b/i.test(claim)) return false;
      if (!hasVocalAnalysis(sonicDna) && /\b(?:vocal|instrumental|singing|singer|voice)\b/i.test(claim)) return false;
      if (zeroConfidence && record.label === "INFERRED") return false;
      return true;
    });
  }
  if (!hasProviderGenre && typeof mutable.laneHypothesis === "string") {
    mutable.laneHypothesis = GENRE_UNCONFIRMED_RATIONALE;
  }
  if (!hasVerifiedCommercialMetrics(evidence) && mutable.commercialRead) {
    mutable.commercialRead = {
      marketability: "undetermined",
      rationale: "ISRC-linked catalogue evidence supports recording identity, release context, label and DSP availability where returned. It does not establish audience or campaign performance: streams, listeners, saves, sales, revenue, playlist conversion and campaign outcomes require verified DSP analytics for a defined reporting period.",
    };
  }
  if (zeroConfidence) {
    if (typeof mutable.creativeIdentity === "string") {
      mutable.creativeIdentity = "Creative identity is unconfirmed because overall A&R assessment confidence is zero. Do not assign a genre, mood, vocal identity or audience position until source reconciliation and a human listening review are complete.";
    }
    mutable.strengths = [];
    if (Array.isArray(mutable.risks)) {
      mutable.risks = [...mutable.risks, "Overall A&R assessment confidence is zero; track-specific creative strengths, positioning and commercial conclusions are withheld."];
    }
    if (Array.isArray(mutable.referencesToVerify)) {
      mutable.referencesToVerify = ["No comparable recording is selected. After identity and musical lane are verified, choose references and document the exact musical dimension being compared."];
    }
    const dimensionAbstentionRationale = (dimension: string): string => {
      switch (dimension) {
        case "tempoLaneFit":
          return "Not scored: overall assessment confidence is zero; no numeric tempo-lane rating is issued until a confidence-qualified measurement and source-backed genre lane can be reviewed for this release."
        case "rhythmicConsistency":
          return "Not scored: overall assessment confidence is zero; no numeric rhythm rating is issued until a stable beat grid and enough measured timestamps are available for this release."
        case "dynamicRangeLoudness":
          return "Not scored: overall assessment confidence is zero. RMS-envelope spread and RMS dBFS are descriptive signal measurements, not mastering-readiness criteria. No destination-specific integrated-loudness, loudness-range or true-peak targets were supplied for this release."
        case "metadataCompleteness":
          return "Not scored: overall assessment confidence is zero. Identity fields and source conflicts are shown in the reconciliation section; no numeric metadata-completeness rating is issued until the source records can be reviewed for this release."
        case "releaseReadiness":
          return "Not scored: overall assessment confidence is zero. No numeric release-readiness rating is issued until source-verified rights, delivery, release status and master approval are available for this release."
        default:
          return "Not scored: overall assessment confidence is zero. The available evidence cannot support a numeric rating for this dimension; complete the listed evidence and human-review steps before assigning a score.";
      }
    };
    if (!mutable.scorecard || typeof mutable.scorecard !== "object" || Array.isArray(mutable.scorecard)) {
      mutable.scorecard = {};
    }
    for (const [dimension, value] of Object.entries(mutable.scorecard as Record<string, unknown>)) {
      const existing = value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      mutable.scorecard[dimension] = {
        ...existing,
        score: null,
        rationale: dimensionAbstentionRationale(dimension),
      };
    }
    for (const dimension of ["tempoLaneFit", "rhythmicConsistency", "dynamicRangeLoudness", "metadataCompleteness", "releaseReadiness"]) {
      const existing = mutable.scorecard[dimension] && typeof mutable.scorecard[dimension] === "object"
        ? mutable.scorecard[dimension] as Record<string, unknown>
        : {};
      mutable.scorecard[dimension] = {
        ...existing,
        score: null,
        rationale: dimensionAbstentionRationale(dimension),
      };
    }
    if (mutable.commercialRead) {
      mutable.commercialRead = {
        marketability: "undetermined",
        rationale: hasVerifiedCommercialMetrics(evidence)
          ? "Verified commercial metrics are present, but overall A&R assessment confidence is zero. They remain source evidence and do not establish a reliable track-specific commercial verdict."
          : "ISRC-linked catalogue evidence may support recording identity and release context, but this audit has zero assessment confidence and no source-attributed DSP performance data. Streams, listeners, saves, sales, revenue, playlist conversion and campaign outcomes remain unverified; no commercial verdict can be issued.",
      };
    }
    if (mutable.aAndRPositioning) {
      mutable.aAndRPositioning.primaryLane = "Unconfirmed — overall assessment confidence is zero";
      mutable.aAndRPositioning.adjacentLanes = [];
      mutable.aAndRPositioning.rationale = "No track-specific genre or lane verdict is issued because the overall assessment confidence is zero. Complete source reconciliation and a human listening review before assigning positioning.";
    }
    if (typeof mutable.laneHypothesis === "string") {
      mutable.laneHypothesis = "No comparable-lane hypothesis is issued because overall assessment confidence is zero. Verify identity and complete a human listening review before selecting references.";
    }
    if (mutable.releaseStrategy) {
      mutable.releaseStrategy.recommendation = "No track-specific release recommendation is issued because assessment confidence is zero. Verify the recording identity, complete a human listening review, and obtain source-attributed release and audience evidence before selecting a release lane or campaign.";
      mutable.releaseStrategy.priorities = [
        "Verify artist, title, release version and ISRC against an authoritative DSP or distributor source.",
        "Complete a human listening review covering hook recall, arrangement, vocal presence, mix translation and creative differentiation.",
        "Confirm rights ownership, release status, master approval and distributor delivery with the rights holder.",
        "Collect source-attributed audience and campaign baselines with a defined reporting period before recommending spend."
      ];
    }
    if (mutable.promotionPlan) {
      mutable.promotionPlan.preRelease = "No track-specific pre-release campaign is recommended until identity, genre, vocal status and release readiness have been verified.";
      mutable.promotionPlan.releaseWindow = "No release window is recommended from the current evidence. Confirm the release date, distributor lead time, rights clearance and campaign capacity first.";
      mutable.promotionPlan.postRelease = "No track-specific post-release sequence is recommended until the release is live and source-attributed performance data can establish a baseline.";
      mutable.promotionPlan.pitchingAngles = ["No track-specific pitching angle is approved until a human listening review and verified identity record are available."];
      mutable.promotionPlan.playlistCategories = ["Use only DSP playlist candidates returned from verified genre and adjacent-lane searches."];
      mutable.promotionPlan.contentIdeas = ["Prepare a visual asset only after the artist confirms the creative identity and intended audience."];
    }
    if (mutable.labelPartnerFit) {
      mutable.labelPartnerFit.partnerProfile = "No label or partner fit can be established from the current zero-confidence assessment. Verify the artist, release identity, genre and vocal profile before shortlisting any company or curator.";
      mutable.labelPartnerFit.criteriaToDemonstrate = [
        "A verified artist and release identity supported by an authoritative source.",
        "A human-reviewed genre and vocal profile supported by the submitted master.",
        "Documented rights ownership, release status and approved distribution materials.",
        "Source-attributed audience and campaign performance with a defined reporting period."
      ];
      mutable.labelPartnerFit.diligenceBeforeContact = "Do not contact a label or curator on the basis of this assessment. First reconcile identity metadata, complete the listening review, confirm rights and delivery, and research current submission requirements from each target's official source.";
    }
    if (mutable.executionPlan) {
      mutable.executionPlan.days30 = "Verify artist, title and release identity against authoritative DSP and distributor records. Complete a human listening review covering hook recall, arrangement, vocal presence, production choices and lane clarity. Confirm rights ownership, master approval and delivery status before making release recommendations.";
      mutable.executionPlan.days60 = "Repeat the technical assessment with validated audio analysis, document its methods and confidence, and reconcile metadata across independent providers. Build a shortlist of actual labels and curators only after the musical lane and submission eligibility are supported by evidence.";
      mutable.executionPlan.days90 = "Create a release and promotion plan from verified release dates, confirmed partner requirements and source-attributed audience baselines. Record outreach, responses and campaign outcomes; do not assume placements, demand or commercial conversion.";
    }
    if (typeof mutable.productionArrangementGuidance === "string") {
      mutable.productionArrangementGuidance = "No track-specific production changes are recommended because the overall assessment confidence is zero. A qualified listener or mix engineer should review the full recording, identify audible arrangement or mix issues, and document time-coded observations before proposing edits. Preserve measured technical values as measurements only; they do not establish musical quality or justify adding instruments, changing the arrangement or altering loudness.";
    }
  }
  return result;
}
