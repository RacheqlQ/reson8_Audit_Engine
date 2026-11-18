export type TokenLimiterSleep = (ms: number, signal?: AbortSignal) => Promise<void>;

interface TokenReservation {
  at: number;
  tokens: number;
}

/** Process-shared rolling-window limiter used by all Groq section requests in one worker process. */
export class SharedTokenPerMinuteLimiter {
  private reservations: TokenReservation[] = [];

  constructor(
    private readonly tokenBudget: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(tokenBudget) || tokenBudget < 1) throw new Error("Token-per-minute budget must be positive");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("Token-per-minute window must be positive");
  }

  async acquire(tokens: number, sleep: TokenLimiterSleep, signal?: AbortSignal): Promise<void> {
    const cost = Math.ceil(tokens);
    if (!Number.isFinite(cost) || cost < 1 || cost > this.tokenBudget) {
      throw new Error("TOKEN_BUDGET_EXCEEDED: request exceeds the shared token-per-minute budget");
    }
    while (true) {
      signal?.throwIfAborted();
      const now = this.now();
      this.reservations = this.reservations.filter((entry) => now - entry.at < this.windowMs);
      const used = this.reservations.reduce((sum, entry) => sum + entry.tokens, 0);
      if (used + cost <= this.tokenBudget) {
        this.reservations.push({ at: now, tokens: cost });
        return;
      }
      const oldest = this.reservations[0];
      const waitMs = Math.max(1, this.windowMs - (now - oldest.at));
      await sleep(waitMs, signal);
    }
  }

  reset(): void {
    this.reservations = [];
  }
}

const configuredBudget = Number(process.env.GROQ_TPM_BUDGET ?? 6_000);
export const sharedGroqTokenLimiter = new SharedTokenPerMinuteLimiter(
  Number.isFinite(configuredBudget) && configuredBudget >= 256 ? configuredBudget : 6_000,
);
