import { isReliableKey, isReliableTempo } from "../evidence-guardrails.js";
export type ReleaseDateStatus = {
  verdict: "DETERMINED" | "UNVERIFIED";
  context: "POST-RELEASE" | "UPCOMING" | "RELEASE DATE NOT RECONCILED";
  date: string;
  source: string;
};
export type SmartAction = {
  window: "Days 1–14" | "Days 15–30" | "Days 31–60" | "Days 61–90";
  specific: string;
  measurable: string;
  achievable: string;
  relevant: string;
  timeBound: string;
};
export type SwotItem = { category: "Strengths" | "Weaknesses" | "Opportunities" | "Threats"; items: string[] };
export type ReconciledArIntelligence = {
  answers: Array<{ question: string; answer: string }>;
  releaseDate: ReleaseDateStatus;
  marketVerdict: "PROPOSED" | "PERFORMANCE VERIFIED";
  vocalCadence: { provenance: "HEURISTIC_SIGNAL_DERIVED"; findings: string[] };
  swot: SwotItem[];
  smartActions: SmartAction[];
};

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(text).filter((item): item is string => Boolean(item)) : [];
const cleanPlaceholder = (value: string) =>
  !/^(?:not supplied|not provided|not available|unknown|n\/a)(?: in the assessment)?\.?$/i.test(value.trim());
function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}
function verifiedCommercialEvidence(evidence: UnknownRecord): boolean {
  for (const key of ["commercialEvidence", "commercialPerformance", "commercialMetrics"]) {
    const item = record(evidence[key]);
    if (item.verified !== true || !text(item.source) || !text(item.reportingPeriod)) continue;
    const metrics = record(item.metrics ?? item);
    if (["streams", "monthlyListeners", "listeners", "saves", "sales", "revenue", "playlistAdds", "conversions", "completionRate"]
      .some(key => { const value = metrics[key]; return finite(value) && value >= 0; })) return true;
  }
  return false;
}
function releaseDateStatus(evidence: UnknownRecord, generatedAt: unknown): ReleaseDateStatus {
  const date = text(evidence.releaseDate) ?? "";
  const provenance = record(evidence.fieldProvenance);
  const source = text(provenance.releaseDate) ?? text(evidence.releaseDateSource) ?? "";
  const attributed = Boolean(source) && !/^(?:unknown|unavailable|unverified)$/i.test(source);
  if (!validCalendarDate(date) || !attributed) {
    return { verdict: "UNVERIFIED", context: "RELEASE DATE NOT RECONCILED", date: "Date not reconciled", source: "Source not reconciled" };
  }
  const auditDate = typeof generatedAt === "string" ? generatedAt.slice(0, 10) : "";
  const auditValid = validCalendarDate(auditDate);
  return {
    verdict: "DETERMINED",
    context: auditValid && date < auditDate ? "POST-RELEASE" : "UPCOMING",
    date,
    source
  };
}
function descriptor(profile: UnknownRecord, key: string): number | null {
  const item = record(record(profile.descriptors)[key]);
  return finite(item.median) ? item.median : null;
}
function signalHeuristics(sonicDna: UnknownRecord): ReconciledArIntelligence["vocalCadence"] {
  const profile = record(sonicDna.acousticFeatureProfile);
  const findings: string[] = [];
  if (profile.status === "measured") {
    const mid = descriptor(profile, "midBandEnergyRatio");
    const high = descriptor(profile, "highBandEnergyRatio");
    const flux = descriptor(profile, "spectralFlux");
    const zcr = descriptor(profile, "zeroCrossingRate");
    const centroid = descriptor(profile, "spectralCentroidHz");
    const crest = descriptor(profile, "crestFactorDb");
    if (mid !== null) findings.push("Mid-band energy proxy: " + (mid >= 0.3 ? "relatively prominent" : mid <= 0.12 ? "relatively restrained" : "moderate") + " in the supplied windowed profile.");
    if (high !== null) findings.push("High-band detail proxy: " + (high >= 0.16 ? "relatively prominent" : high <= 0.05 ? "relatively restrained" : "moderate") + " in the supplied windowed profile.");
    if (flux !== null || zcr !== null) {
      const activity = (flux !== null && flux >= 0.1) || (zcr !== null && zcr >= 0.08);
      findings.push("Transient/cadence activity proxy: " + (activity ? "elevated" : "lower") + " relative to the heuristic thresholds; this is not a beat-grid or syllable analysis.");
    }
    if (centroid !== null) findings.push("Spectral centroid: " + Math.round(centroid) + " Hz; a whole-signal brightness descriptor, not a vocal-tone measurement.");
    if (crest !== null) findings.push("Crest factor: " + crest.toFixed(1) + " dB; a signal-dynamics descriptor, not a mix-readiness verdict.");
  }
  if (!findings.length) findings.push("Insufficient measured descriptors; vocal/cadence signal characteristics are not determined.");
  findings.push("HEURISTIC_SIGNAL_DERIVED: descriptors are whole-signal proxies only and are not proof of human vocals, voice presence, delivery, lyrics, vocal layering or syllable cadence.");
  return { provenance: "HEURISTIC_SIGNAL_DERIVED", findings };
}
function releaseGaps(evidence: UnknownRecord): string[] {
  const reconciliation = record(evidence.reconciliation);
  const conflicts = Array.isArray(reconciliation.conflicts) ? reconciliation.conflicts : [];
  const gaps = ["isrc", "upc", "label", "album"].filter(key => !text(evidence[key]));
  const conflictFields = conflicts.map(value => text(record(value).field)).filter((value): value is string => Boolean(value));
  return [...new Set([...gaps, ...conflictFields])];
}
function buildSwot(assessment: UnknownRecord, evidence: UnknownRecord, signal: ReconciledArIntelligence["vocalCadence"]): SwotItem[] {
  const strengths = list(assessment.strengths).filter(cleanPlaceholder).slice(0, 3);
  const risks = list(assessment.risks).filter(cleanPlaceholder).slice(0, 3);
  const gaps = releaseGaps(evidence);
  const measuredSignal = signal.findings.filter(line => !/Insufficient measured descriptors|HEURISTIC_SIGNAL_DERIVED/.test(line));
  const fixture = evidence.fixture === true;
  const safeStrengths = fixture ? [] : strengths;
  const safeRisks = fixture ? [] : risks;
  return [
    { category: "Strengths", items: safeStrengths.length ? safeStrengths : measuredSignal.length ? measuredSignal.slice(0, 2) : ["No track-specific strength is asserted beyond the supplied, source-attributed evidence."] },
    { category: "Weaknesses", items: safeRisks.length ? safeRisks : ["A human listening review is still required for hook recall, arrangement impact, vocal performance and mix translation."] },
    { category: "Opportunities", items: ["[PROPOSED] Test the primary and adjacent lane hypotheses against independently verified reference recordings and human-reviewed curator feedback.", "[PROPOSED] Build an approved short-form content test around a timestamp confirmed by listening; measure only attributable responses."] },
    { category: "Threats", items: [gaps.length ? "Release identity and delivery diligence remains open for: " + gaps.join(", ") + "." : "Rights, delivery and master approval must remain source-verified before external pitching.", "Unverified audience demand or commercial performance must not be used to justify spend, partner claims or forecast outcomes."] }
  ];
}
function buildSmartActions(release: ReleaseDateStatus, evidence: UnknownRecord): SmartAction[] {
  const releaseAnchor = release.verdict === "DETERMINED" ? "the reconciled " + release.date + " release" : "the release date once independently reconciled";
  const gaps = releaseGaps(evidence);
  return [
    { window: "Days 1–14", specific: "Reconcile artist, track, version, album/EP, ISRC, UPC, label and release-date records against distributor and DSP source records.", measurable: "Record a source and outcome for 100% of the listed identity fields; leave unresolved fields explicitly open.", achievable: "Use the provider records already returned and request only missing distributor documentation.", relevant: "A stable recording/release identity is required before pitching, rights review or campaign attribution.", timeBound: "Complete the reconciliation log by day 14; current open fields: " + (gaps.join(", ") || "none recorded") + "." },
    { window: "Days 15–30", specific: "Complete rights, ownership, approved-master, artwork and delivery checks for " + releaseAnchor + ".", measurable: "Attach dated evidence for each required gate and mark each gate verified or pending; do not use estimated completion.", achievable: "Assign one owner per missing document and escalate only unresolved items.", relevant: "Prevents external pitching or spend against an uncleared or incorrectly mapped release.", timeBound: "Close or formally hold each gate by day 30." },
    { window: "Days 31–60", specific: "Prepare one evidence-led positioning pack and a small approved content/pitch test using the measured recording profile and human-confirmed excerpts.", measurable: "Track the number of approved assets, verified targets contacted, responses received and source-attributed platform observations; do not set invented reach or stream targets.", achievable: "Reuse existing approved assets and a manually verified shortlist; no paid tooling is required.", relevant: "Tests the proposed lane and creative proposition without representing hypotheses as proven demand.", timeBound: "Complete the test log and review decision by day 60." },
    { window: "Days 61–90", specific: "Review the test, refresh only responsive curator/creator follow-ups and decide whether to continue, revise or pause the proposition.", measurable: "Compare like-for-like source reports and document available saves, listeners, streams or conversions only when provider-sourced; list unavailable metrics separately.", achievable: "Use platform-native exports and the day-30 baseline; do not estimate missing results.", relevant: "Creates a defensible next-step decision for " + releaseAnchor + " without fabricating commercial performance.", timeBound: "Document the decision, owner and evidence still required by day 90." }
  ];
}
export function buildReconciledArIntelligence(input: {
  evidence?: Record<string, unknown>;
  sonicDna?: Record<string, unknown> | null;
  assessment?: Record<string, unknown>;
  generatedAt?: string;
}): ReconciledArIntelligence {
  const evidence = record(input.evidence), audio = record(input.sonicDna), assessment = record(input.assessment);
  const release = releaseDateStatus(evidence, input.generatedAt);
  const commercial = verifiedCommercialEvidence(evidence);
  const signal = signalHeuristics(audio);
  const conflicts = Array.isArray(record(evidence.reconciliation).conflicts) ? record(evidence.reconciliation).conflicts as unknown[] : [];
  const conflictText = conflicts.map(value => record(value)).map(item => {
    const field = text(item.field) ?? "metadata";
    const values = Array.isArray(item.values) ? item.values.map(text).filter(Boolean).join(" vs ") : "conflicting source values";
    return field + ": " + values;
  }).filter(Boolean);
  const genre = text(evidence.genre) ?? text(record(assessment.aAndRPositioning).primaryLane) ?? list(audio.genreContext)[0] ?? "a lane hypothesis to validate";
  const structure = Array.isArray(audio.structure) ? audio.structure.map(value => {
    const item = record(value);
    return [text(item.label ?? item.name), finite(item.startSeconds) ? item.startSeconds + "s" : null].filter(Boolean).join(" at ");
  }).filter(Boolean) : [];
  const hookEvidence = list(audio.flaggedMoments).length > 0 || Array.isArray(audio.flaggedMoments) && audio.flaggedMoments.length > 0;
  const gaps = releaseGaps(evidence);
  const market = commercial ? "PERFORMANCE VERIFIED — a source and reporting-period backed commercial metric is present; interpret only the metric actually supplied." : "PROPOSED — no verified commercial telemetry supports a performance verdict, audience-demand claim or forecast.";
  const tempoConfirmed = isReliableTempo(audio as Parameters<typeof isReliableTempo>[0]);
  const keyConfirmed = isReliableKey(audio);
  const answers = [
    { question: "1. What is the sonic and groove identity?", answer: [tempoConfirmed ? "Confirmed tempo: " + audio.bpm + " BPM." : "Tempo is not confirmed.", keyConfirmed ? "Confirmed key: " + text(audio.key) + " " + text(audio.mode) + "." : "Key is not confirmed.", signal.findings[0]].filter(Boolean).join(" ") },
    { question: "2. What is the hook and arrangement arc?", answer: structure.length ? "Supplied structure markers: " + structure.join("; ") + ". Confirm hook recall and section impact by human listening." : hookEvidence ? "Timestamped moments were supplied; verify hook recall and arrangement arc by listening to those moments. No unprovided section labels are inferred." : "No validated structure or hook timestamps were supplied; hook recall and arrangement arc require human listening." },
    { question: "3. Is the mix/master release-ready?", answer: "Technical descriptors can describe the submitted signal, but they do not certify mastering quality. Check clipping, translation, balance, distortion and destination delivery specifications with a human engineer; rights and approved-master gates remain separate." },
    { question: "4. Which primary and adjacent genre lanes should be tested?", answer: "PROPOSED primary lane: " + genre + ". Treat this as a positioning hypothesis unless a provider-backed genre classification is present; test adjacent lanes against verified references rather than inventing taxonomy labels." },
    { question: "5. Which audience and territories should be targeted?", answer: "No audience or territory demand is established by audio descriptors alone. PROPOSED: select a small territory/curator test only after reviewing source-attributed listener geography or artist-owned audience data; record unknown territories as unverified." },
    { question: "6. What is the catalogue and release status?", answer: "Release date: " + release.verdict + " — " + release.date + " (" + release.context + "). " + (gaps.length ? "Open catalogue fields: " + gaps.join(", ") + "." : "No missing core catalogue fields were identified in the supplied record; verify all values against distributor records.") + (conflictText.length ? " Conflicts: " + conflictText.join("; ") + "." : "") },
    { question: "7. What is the marketing and rollout proposition?", answer: "PROPOSED: prepare an approved, track-specific pitch pack and human-verified short-form excerpt, then test a limited curator/creator shortlist. Anchor timing to " + (release.verdict === "DETERMINED" ? release.date : "a release date that must first be reconciled") + "; report only attributable outcomes." },
    { question: "8. What is the next decision trigger?", answer: "Proceed to external pitching only when recording identity, rights, delivery and approved-master checks are evidenced; then review source-attributed response data at day 30/60/90. Hold if a material identity conflict or rights gate remains open." }
  ];
  return { answers, releaseDate: release, marketVerdict: commercial ? "PERFORMANCE VERIFIED" : "PROPOSED", vocalCadence: signal, swot: buildSwot(assessment, evidence, signal), smartActions: buildSmartActions(release, evidence) };
}
