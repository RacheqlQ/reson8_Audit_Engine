import type { ProviderAttemptDiagnostic } from "../providers/groq/client.js";

export type AssessmentProviderName = ProviderAttemptDiagnostic["provider"];
export type ProviderFailureClass = NonNullable<ProviderAttemptDiagnostic["failureClass"]>;

export interface AssessmentProviderClient<TInput, TResult> {
  assess(input: TInput, signal?: AbortSignal): Promise<TResult>;
}

export interface AssessmentProviderCandidate<TInput, TResult> {
  provider: AssessmentProviderName;
  model: string;
  client: AssessmentProviderClient<TInput, TResult> | null;
}

export interface AssessmentProviderChainCallbacks<TInput, TResult> {
  onSkipped?: (candidate: AssessmentProviderCandidate<TInput, TResult>) => Promise<void>;
  onFailure?: (candidate: AssessmentProviderCandidate<TInput, TResult>, error: unknown) => void;
}

export interface AssessmentProviderFailureDiagnostic {
  provider: AssessmentProviderName;
  model: string;
  attemptCount: number;
  statusCodes: number[];
  failureClasses: ProviderFailureClass[];
  estimatedInputTokens: number[];
  actualUsage: {
    status: "reported" | "unavailable";
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
}

export class AssessmentProviderChainError extends Error {
  readonly diagnostics: AssessmentProviderFailureDiagnostic[];

  constructor(diagnostics: AssessmentProviderFailureDiagnostic[], cause?: unknown) {
    const summary = diagnostics.map(item =>
      item.provider + "/" + item.model + " attempts=" + item.attemptCount
      + " statuses=" + (item.statusCodes.length ? item.statusCodes.join(",") : "none")
      + " failures=" + (item.failureClasses.length ? item.failureClasses.join(",") : "unclassified")
      + " estimatedInputTokens=" + (item.estimatedInputTokens.length ? item.estimatedInputTokens.join(",") : "unavailable")
      + " actualUsage=" + (item.actualUsage.status === "reported"
        ? "reported(prompt=" + item.actualUsage.promptTokens + ",completion=" + item.actualUsage.completionTokens + ",total=" + item.actualUsage.totalTokens + ")"
        : "unavailable")
    ).join("; ");
    super("ASSESSMENT_PROVIDER_CHAIN_FAILED: " + summary, { cause });
    this.name = "AssessmentProviderChainError";
    this.diagnostics = diagnostics;
  }
}

function classifyError(error: unknown): ProviderFailureClass | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/GROQ_PROMPT_BUDGET_EXCEEDED|PROVIDER_PROMPT_BUDGET_EXCEEDED/i.test(message)) return "preflight_budget";
  if (/completion_truncated|finish_reason.{0,12}length/i.test(message)) return "completion_truncated";
  if (/threshold_violation/i.test(message)) return "threshold_violation";
  if (/HTTP 400|json_validate_failed|schema|malformed/i.test(message)) return "malformed_output";
  if (/HTTP 503|HTTP 429|capacity|rate.limit/i.test(message)) return "capacity_or_503";
  if (/timed out|timeout|ETIMEDOUT/i.test(message)) return "timeout";
  if (/network|fetch failed|ECONNRESET|HTTP 5\d\d/i.test(message)) return "network";
  return null;
}

function summarizeProviderFailure(
  candidate: AssessmentProviderCandidate<unknown, unknown>,
  attempts: ProviderAttemptDiagnostic[],
  error: unknown,
): AssessmentProviderFailureDiagnostic {
  const providerAttempts = attempts.filter(item => item.provider === candidate.provider && item.model === candidate.model);
  const usage = providerAttempts.find(item => item.actualUsage?.status === "reported")?.actualUsage;
  const fallbackClass = classifyError(error);
  const classes = [...new Set(providerAttempts.map(item => item.failureClass).filter((item): item is ProviderFailureClass => Boolean(item)))];
  if (!classes.length && fallbackClass) classes.push(fallbackClass);
  return {
    provider: candidate.provider,
    model: candidate.model,
    attemptCount: providerAttempts.reduce((maximum, item) => Math.max(maximum, item.attempt), 0),
    statusCodes: providerAttempts.map(item => item.status).filter((item): item is number => typeof item === "number"),
    failureClasses: classes,
    estimatedInputTokens: providerAttempts.map(item => item.estimatedInputTokens).filter((item): item is number => typeof item === "number"),
    actualUsage: usage ? {
      status: "reported",
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    } : { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
  };
}

/**
 * Try each configured assessment provider in order. Attempt metadata is
 * collected through the existing callback and summarized without retaining
 * private evidence or provider response bodies in the terminal error.
 */
export async function runAssessmentProviderChain<TInput, TResult>(
  candidates: readonly AssessmentProviderCandidate<TInput, TResult>[],
  input: TInput,
  signal?: AbortSignal,
  callbacks: AssessmentProviderChainCallbacks<TInput, TResult> = {},
): Promise<TResult> {
  let lastProviderError: unknown = null;
  const allAttempts: ProviderAttemptDiagnostic[] = [];
  const failedCandidates: AssessmentProviderFailureDiagnostic[] = [];

  for (const candidate of candidates) {
    if (!candidate.client) {
      await callbacks.onSkipped?.(candidate);
      continue;
    }

    const originalRecorder = input && typeof input === "object"
      ? (input as { recordProviderAttempt?: (attempt: ProviderAttemptDiagnostic) => Promise<void> }).recordProviderAttempt
      : undefined;
    const providerInput = input && typeof input === "object" && originalRecorder
      ? {
          ...(input as Record<string, unknown>),
          recordProviderAttempt: async (attempt: ProviderAttemptDiagnostic) => {
            allAttempts.push(attempt);
            await originalRecorder(attempt);
          },
        } as TInput
      : input;

    const attemptStart = allAttempts.length;
    try {
      return await candidate.client.assess(providerInput, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastProviderError = error;
      failedCandidates.push(summarizeProviderFailure(candidate, allAttempts.slice(attemptStart), error));
      callbacks.onFailure?.(candidate, error);
    }
  }

  if (failedCandidates.length) throw new AssessmentProviderChainError(failedCandidates, lastProviderError);
  throw lastProviderError ?? new Error("AI_PROVIDERS_UNAVAILABLE: no assessment provider could be attempted");
}
