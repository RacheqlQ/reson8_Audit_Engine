export type TempoConfirmationStatus = "CONFIRMED" | "CANDIDATE" | "PROVISIONAL" | "UNDETERMINED";

export interface TempoVoteCandidate {
  bpm: number;
  prominence?: number;
  confidence?: number;
  beatStrength?: number;
}
export interface TempoVoteWindow {
  bpm?: number | null;
  prominence?: number;
  confidence?: number;
  beatStrength?: number;
  durationSeconds?: number;
  coverage?: number;
  candidates?: TempoVoteCandidate[];
  halfTimeBpm?: number | null;
  doubleTimeBpm?: number | null;
  octaveAlternatives?: number[];
}
export interface TempoVotingOptions {
  windows: TempoVoteWindow[];
  bpmTolerance?: number;
  relativeTolerance?: number;
  minVoteShare?: number;
  minWindowAgreement?: number;
  minProminence?: number;
  minRunnerUpMargin?: number;
  octaveAmbiguityShare?: number;
}
export interface TempoVotingVerdict {
  primary_candidate_bpm: number | null;
  octave_alternatives: number[];
  vote_share: number;
  window_agreement: number;
  prominence_score: number;
  runner_up_margin: number;
  confirmation_status: TempoConfirmationStatus;
  reason_codes: string[];
  explanation: string;
  raw_candidates: Array<{ bpm: number; prominence: number; weight: number; window_index: number }>;
}

type Vote = { bpm: number; prominence: number; weight: number; window: number; octaveKey: number; };
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function octaveClass(bpm: number): number {
  let normalized = bpm;
  while (normalized >= 80) normalized /= 2;
  while (normalized < 40) normalized *= 2;
  return normalized;
}
function closeTempo(a: number, b: number, absoluteTolerance: number, relativeTolerance: number): boolean {
  return Math.abs(a - b) <= Math.max(absoluteTolerance, Math.min(a, b) * relativeTolerance);
}
function roundBpm(value: number): number { return Math.round(value * 10) / 10; }

export function voteTempoCandidates(options: TempoVotingOptions): TempoVotingVerdict {
  const absoluteTolerance = finitePositive(options.bpmTolerance) ? options.bpmTolerance : 1.5;
  const relativeTolerance = finitePositive(options.relativeTolerance) ? options.relativeTolerance : 0.02;
  const minVoteShare = options.minVoteShare ?? 0.65;
  const minWindowAgreement = options.minWindowAgreement ?? 0.65;
  const minProminence = options.minProminence ?? 0.5;
  const minRunnerUpMargin = options.minRunnerUpMargin ?? 0.15;
  const octaveAmbiguityShare = options.octaveAmbiguityShare ?? 0.65;
  const votes: Vote[] = [];
  const validWindows = new Set<number>();

  options.windows.forEach((window, windowIndex) => {
    const suppliedCandidates = Array.isArray(window.candidates) ? [...window.candidates] : [];
    if (finitePositive(window.halfTimeBpm)) suppliedCandidates.push({ bpm: window.halfTimeBpm, prominence: window.prominence, confidence: window.confidence, beatStrength: window.beatStrength });
    if (finitePositive(window.doubleTimeBpm)) suppliedCandidates.push({ bpm: window.doubleTimeBpm, prominence: window.prominence, confidence: window.confidence, beatStrength: window.beatStrength });
    for (const bpm of Array.isArray(window.octaveAlternatives) ? window.octaveAlternatives : []) {
      if (finitePositive(bpm)) suppliedCandidates.push({ bpm, prominence: window.prominence, confidence: window.confidence, beatStrength: window.beatStrength });
    }
    const candidates = suppliedCandidates.length ? suppliedCandidates : (finitePositive(window.bpm)
      ? [{ bpm: window.bpm, prominence: window.prominence, confidence: window.confidence, beatStrength: window.beatStrength }]
      : []);
    const uniqueCandidates = candidates.filter((candidate, index, all) =>
      all.findIndex(other => finitePositive(other.bpm) && finitePositive(candidate.bpm)
        && closeTempo(other.bpm, candidate.bpm, absoluteTolerance, relativeTolerance)) === index);
    const durationWeight = finitePositive(window.durationSeconds) ? Math.min(1, window.durationSeconds / 8) : 1;
    const coverageWeight = typeof window.coverage === "number" && Number.isFinite(window.coverage) ? clamp01(window.coverage) : 1;
    for (const candidate of uniqueCandidates) {
      if (!finitePositive(candidate.bpm) || candidate.bpm < 30 || candidate.bpm > 300) continue;
      const prominenceRaw = candidate.prominence ?? candidate.confidence ?? window.prominence ?? window.confidence ?? 0;
      const beatRaw = candidate.beatStrength ?? window.beatStrength ?? 1;
      if (typeof prominenceRaw !== "number" || !Number.isFinite(prominenceRaw) || typeof beatRaw !== "number" || !Number.isFinite(beatRaw) || beatRaw <= 0) continue;
      const prominence = clamp01(prominenceRaw);
      const quality = prominence * clamp01(beatRaw);
      const weight = quality * durationWeight * coverageWeight;
      if (!(weight > 0) || !Number.isFinite(weight)) continue;
      votes.push({ bpm: candidate.bpm, prominence, weight, window: windowIndex, octaveKey: octaveClass(candidate.bpm) });
      validWindows.add(windowIndex);
    }
  });

  const raw_candidates = votes.map(vote => ({
    bpm: roundBpm(vote.bpm), prominence: roundBpm(vote.prominence),
    weight: Number(vote.weight.toFixed(6)), window_index: vote.window,
  }));
  if (!votes.length) {
    return {
      primary_candidate_bpm: null, octave_alternatives: [], vote_share: 0, window_agreement: 0,
      prominence_score: 0, runner_up_margin: 0, confirmation_status: "UNDETERMINED",
      reason_codes: ["NO_VALID_TEMPO_CANDIDATES"], explanation: "No finite, positive, weighted tempo candidate was available.",
      raw_candidates,
    };
  }

  const groups: Array<{ key: number; votes: Vote[]; weight: number }> = [];
  for (const vote of votes) {
    let group = groups.find(item => closeTempo(item.key, vote.octaveKey, absoluteTolerance, relativeTolerance));
    if (!group) { group = { key: vote.octaveKey, votes: [], weight: 0 }; groups.push(group); }
    group.votes.push(vote); group.weight += vote.weight;
  }
  groups.sort((a, b) => b.weight - a.weight || a.key - b.key);
  const winner = groups[0]!;
  const totalWeight = votes.reduce((sum, vote) => sum + vote.weight, 0);
  const runnerUpShare = (groups[1]?.weight ?? 0) / totalWeight;
  const voteShare = winner.weight / totalWeight;
  const runnerUpMargin = voteShare - runnerUpShare;
  const winningWindowCount = new Set(winner.votes.map(vote => vote.window)).size;
  const windowAgreement = winningWindowCount / Math.max(1, validWindows.size);
  const prominenceScore = winner.votes.reduce((sum, vote) => sum + vote.prominence * vote.weight, 0) / winner.weight;

  const levels: Array<{ bpm: number; weight: number }> = [];
  for (const vote of winner.votes) {
    let level = levels.find(item => closeTempo(item.bpm, vote.bpm, absoluteTolerance, relativeTolerance));
    if (!level) { level = { bpm: vote.bpm, weight: 0 }; levels.push(level); }
    level.weight += vote.weight;
  }
  const nominal = winner.key * 2;
  levels.sort((a, b) => b.weight - a.weight
    || Math.abs(a.bpm - nominal) - Math.abs(b.bpm - nominal)
    || a.bpm - b.bpm);
  const primary = roundBpm(levels[0]!.bpm);
  const half = roundBpm(primary / 2), doubled = roundBpm(primary * 2);
  const octaveAlternatives = [half, doubled].filter(value => value >= 30 && value <= 300 && levels.some(level => closeTempo(level.bpm, value, absoluteTolerance, relativeTolerance)));
  const alternativeWeight = levels.filter(level => !closeTempo(level.bpm, primary, absoluteTolerance, relativeTolerance))
    .reduce((sum, level) => sum + level.weight, 0);
  const octaveShare = alternativeWeight / winner.weight;

  const reasonCodes: string[] = [];
  if (prominenceScore < minProminence) reasonCodes.push("LOW_TRANSIENT_PROMINENCE");
  if (windowAgreement < minWindowAgreement) reasonCodes.push("UNSTABLE_WINDOW_CONSENSUS");
  if (voteShare < minVoteShare || runnerUpMargin < minRunnerUpMargin) reasonCodes.push("LOW_VOTE_CONSENSUS_OR_MARGIN");
  if (octaveShare >= octaveAmbiguityShare) reasonCodes.push("OCTAVE_METRICAL_AMBIGUITY");
  const confirmed = reasonCodes.length === 0;
  const explanation = confirmed
    ? "Tempo is confirmed by weighted candidate consensus, signal prominence, window agreement and metrical disambiguation."
    : "Tempo remains a candidate because " + reasonCodes.map(code => ({
      LOW_TRANSIENT_PROMINENCE: "transient prominence is below threshold",
      UNSTABLE_WINDOW_CONSENSUS: "window agreement is below threshold",
      LOW_VOTE_CONSENSUS_OR_MARGIN: "vote consensus or the runner-up margin is below threshold",
      OCTAVE_METRICAL_AMBIGUITY: "half-time or double-time interpretations remain materially supported",
    } as Record<string, string>)[code] ?? code).join("; ") + ".";
  return {
    primary_candidate_bpm: primary, octave_alternatives: octaveAlternatives, vote_share: Number(voteShare.toFixed(4)),
    window_agreement: Number(windowAgreement.toFixed(4)), prominence_score: Number(prominenceScore.toFixed(4)),
    runner_up_margin: Number(runnerUpMargin.toFixed(4)),
    confirmation_status: confirmed ? "CONFIRMED" : "CANDIDATE",
    reason_codes: reasonCodes, explanation, raw_candidates,
  };
}
