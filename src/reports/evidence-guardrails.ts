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
      return !(suppressTempo && hasTempoClaim) && !hasGenreClaim && !hasCommercialClaim && !hasUnsupportedVocalClaim && !hasUnsupportedKeyClaim;
    });
    return kept.join(" ").trim() || "Not asserted: the supporting measurement confidence is insufficient.";
  }
  if (Array.isArray(value)) return value.map((item) => stripUnsupportedClaims(item, suppressTempo, suppressGenre, suppressCommercial, suppressVocal, suppressKey));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stripUnsupportedClaims(item, suppressTempo, suppressGenre, suppressCommercial, suppressVocal, suppressKey)]));
  }
  return value;
}

const TEMPO_UNAVAILABLE_RATIONALE =
  "Tempo and rhythmic consistency remain unscored because the uploaded-master estimate does not meet the minimum confidence gate. A numeric candidate without adequate confidence is not a verified measurement and must not support lane, energy, playlist or release claims.";

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
  return kept.join(" ").trim() || "Not asserted: the measured technical profile does not support that claim.";
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
  return kept.join(" ").trim()||ALBUM_CONFLICT_RATIONALE;
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
    if (result.scorecard?.metadataCompleteness) {
      result.scorecard.metadataCompleteness = { score: null, rationale: ALBUM_CONFLICT_RATIONALE };
    }
    if (Array.isArray(result.evidenceGaps) && !result.evidenceGaps.some((gap:unknown)=>typeof gap==="string"&&/album metadata is present but conflicting/i.test(gap))) {
      result.evidenceGaps.push(ALBUM_CONFLICT_RATIONALE);
    }
    if (Array.isArray(result.risks) && !result.risks.some((risk:unknown)=>typeof risk==="string"&&/album metadata is present but conflicting/i.test(risk))) {
      result.risks.push(ALBUM_CONFLICT_RATIONALE);
    }
  }

  const mutable = result as Record<string, any>;
  if (!reliableTempo && result.scorecard) {
    if (result.scorecard.tempoLaneFit) result.scorecard.tempoLaneFit = { score: null, rationale: TEMPO_UNAVAILABLE_RATIONALE };
    if (result.scorecard.rhythmicConsistency) result.scorecard.rhythmicConsistency = { score: null, rationale: TEMPO_UNAVAILABLE_RATIONALE };
  }
  if (hasProviderGenre && result.aAndRPositioning && genre) {
    const taxonomyLabels = new Set(GENRE_TAXONOMY.map((item) => item.label.toLocaleLowerCase()));
    const allowed = new Set((Array.isArray(genre.genres) ? genre.genres : [])
      .flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).label === "string"
        ? [(item as Record<string, unknown>).label as string] : [])
      .map((label) => label.toLocaleLowerCase()));
    const primaryLane = typeof result.aAndRPositioning.primaryLane === "string" ? result.aAndRPositioning.primaryLane.trim() : "";
    if (primaryLane && !taxonomyLabels.has(primaryLane.toLocaleLowerCase())) {
      result.aAndRPositioning.primaryLane = typeof genre.primaryGenre === "string" && taxonomyLabels.has(genre.primaryGenre.toLocaleLowerCase())
        ? genre.primaryGenre : "Unconfirmed — no taxonomy-backed genre label";
    }
    result.aAndRPositioning.adjacentLanes = result.aAndRPositioning.adjacentLanes.filter((label: string) =>
      taxonomyLabels.has(label.toLocaleLowerCase()) && (allowed.size === 0 || allowed.has(label.toLocaleLowerCase())));
  }
  if (!hasProviderGenre && result.aAndRPositioning) {
    result.aAndRPositioning.primaryLane = "Unconfirmed — insufficient provider-backed genre evidence";
    result.aAndRPositioning.adjacentLanes = [];
    result.aAndRPositioning.rationale = GENRE_UNCONFIRMED_RATIONALE;
  }
  const dynamicRangeDimension = mutable.scorecard?.dynamicRangeLoudness;
  if (dynamicRangeDimension && typeof dynamicRangeDimension === "object") {
    dynamicRangeDimension.score = null;
    dynamicRangeDimension.rationale = "Not scored: RMS-envelope spread and RMS dBFS are descriptive signal measurements, not mastering-readiness criteria. No destination-specific integrated-loudness, loudness-range or true-peak targets were supplied.";
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
      rationale: "No verified, source-attributed commercial-performance metrics are available for this release. Streams, listeners, saves, sales, revenue, playlist conversion and campaign outcomes cannot be inferred from audio features, genre metadata or general catalog context.",
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
          return "Not scored: overall assessment confidence is zero. Technical tempo measurements alone do not establish artistic positioning or a reliable lane-fit score.";
        case "rhythmicConsistency":
          return "Not scored: overall assessment confidence is zero. BPM and rhythm measurements, where present, are not sufficient for a final consistency rating without human listening and segment-level review.";
        case "dynamicRangeLoudness":
          return "Not scored: overall assessment confidence is zero. RMS-envelope spread and RMS dBFS are descriptive signal measurements, not mastering-readiness criteria. No destination-specific integrated-loudness, loudness-range or true-peak targets were supplied.";
        case "metadataCompleteness":
          return "Not scored: overall assessment confidence is zero. Identity fields and source conflicts are shown in the reconciliation section; no numeric metadata-completeness rating is issued at this confidence level.";
        case "releaseReadiness":
          return "Not scored: overall assessment confidence is zero. No numeric release-readiness rating is issued; audience, market, campaign and release evidence must be reviewed separately.";
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
          : "No verified, source-attributed commercial-performance metrics are available. Overall A&R assessment confidence is zero, so no commercial verdict can be issued.",
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
      mutable.promotionPlan.playlistCategories = ["No target playlist assigned pending verified genre and vocal analysis."];
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
