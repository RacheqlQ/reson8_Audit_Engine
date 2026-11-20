export interface BootstrapConsensusOptions {
  iterations?: number;
  seed?: number;
}

export interface BootstrapConsensusDiagnostics {
  winner: string | null;
  windowCount: number;
  observedAgreement: number | null;
  lowerAgreementBound: number | null;
  upperAgreementBound: number | null;
  iterations: number;
  method: "deterministic_window_bootstrap";
}

const DEFAULT_ITERATIONS = 1_000;
const MAX_ITERATIONS = 100_000;

/** Small seeded PRNG: reproducible across Node versions and independent of Math.random(). */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function quantile(sorted: readonly number[], probability: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

/**
 * Resamples observed categorical window labels with replacement.
 * Bounds describe bootstrap variation in agreement with the observed winner;
 * they are not calibrated probabilities or accuracy estimates.
 */
export function bootstrapCategoricalConsensus(
  labels: readonly string[],
  options: BootstrapConsensusOptions = {},
): BootstrapConsensusDiagnostics {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const seed = options.seed ?? 1;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new RangeError(`iterations must be an integer from 1 to ${MAX_ITERATIONS}`);
  }
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("seed must be a safe integer");
  }

  const usable = labels.filter((label) => typeof label === "string" && label.trim().length > 0);
  const unavailable = (): BootstrapConsensusDiagnostics => ({
    winner: null,
    windowCount: usable.length,
    observedAgreement: null,
    lowerAgreementBound: null,
    upperAgreementBound: null,
    iterations,
    method: "deterministic_window_bootstrap",
  });
  if (usable.length === 0) return unavailable();

  const counts = new Map<string, number>();
  for (const label of usable) counts.set(label, (counts.get(label) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return unavailable();

  const winner = ranked[0]![0];
  const observedAgreement = ranked[0]![1] / usable.length;
  const random = createRandom(seed);
  const agreements = new Array<number>(iterations);
  for (let iteration = 0; iteration < iterations; iteration++) {
    let winnerCount = 0;
    for (let draw = 0; draw < usable.length; draw++) {
      if (usable[Math.floor(random() * usable.length)] === winner) winnerCount++;
    }
    agreements[iteration] = winnerCount / usable.length;
  }
  agreements.sort((a, b) => a - b);

  return {
    winner,
    windowCount: usable.length,
    observedAgreement,
    lowerAgreementBound: Math.min(observedAgreement, quantile(agreements, 0.025)),
    upperAgreementBound: Math.max(observedAgreement, quantile(agreements, 0.975)),
    iterations,
    method: "deterministic_window_bootstrap",
  };
}
