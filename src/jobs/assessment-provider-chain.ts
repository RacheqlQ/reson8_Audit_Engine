import type { ProviderAttemptDiagnostic } from "../providers/groq/client.js";

export type AssessmentProviderName = ProviderAttemptDiagnostic["provider"];
export type ProviderFailureClassification =
  | "preflight_budget"
  | "schema_or_malformed_400"
  | "capacity_or_503"
  | "network"
  | "timeout";

export interface AssessmentProviderFailureDetail {
  provider: AssessmentProviderName;
  model: string;
  classification: ProviderFailureClassification;
  classifications: ProviderFailureClassification[];
  statusCodes: number[];
  attemptCount: number;
  preflightCount: number;
  estimatedInputTokens: number | null;
  actualUsage:
    | { status: "available"; promptTokens: number | null; completionTokens: number | null; totalTokens: number | null }
    | { status: "unavailable"; reason: "no_200_response_usage" };
}

export class AssessmentProviderChainError extends Error {
  readonly diagnostics: AssessmentProviderFailureDetail[];

  constructor(diagnostics: AssessmentProviderFailureDetail[]) {
    const summary = diagnostics.map((item) => {
      const statuses = item.statusCodes.length ? "HTTP " + item.statusCodes.join(",") : "no HTTP response";
      const usage = item.actualUsage.status === "available"
        ? "actual usage " + (item.actualUsage.totalTokens ?? "partial")
        : "actual usage unavailable";
      return item.provider + "/" + item.model + ": " + item.classifications.join("+")
        + "; " + statuses + "; " + item.attemptCount + " HTTP attempt(s)"
        + (item.preflightCount ? "; " + item.preflightCount + " preflight rejection(s)" : "")
        + (item.estimatedInputTokens === null ? "" : "; estimated input " + item.estimatedInputTokens)
        + "; " + usage;
    }).join(" -> ");
    super("Assessment provider chain exhausted: " + summary);
    this.name = "AssessmentProviderChainError";
    this.diagnostics = diagnostics;
  }
}

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
  onFailure?: (
    candidate: AssessmentProviderCandidate<TInput, TResult>,
    error: unknown,
    diagnostic: AssessmentProviderFailureDetail,
  ) => void;
}

function classifyAttempt(attempt: ProviderAttemptDiagnostic): ProviderFailureClassification | null {
  if (attempt.status === 200 && attempt.errorType === "none") return null;
  if (attempt.failureKind === "prompt_budget_exceeded") return "preflight_budget";
  if (attempt.status === 400 || attempt.failureKind === "invalid_json" || attempt.failureKind === "schema_violation") {
    return "schema_or_malformed_400";
  }
  if (attempt.status === 429 || attempt.status === 503 || (attempt.status !== null && attempt.status >= 500)) {
    return "capacity_or_503";
  }
  if (attempt.errorType === "timeout") return "timeout";
  return "network";
}

function classifyError(error: unknown): ProviderFailureClassification {
  const message = error instanceof Error ? error.message : String(error);
  if (/GROQ_PROMPT_BUDGET_EXCEEDED|prompt_budget_exceeded/i.test(message)) return "preflight_budget";
  if (/HTTP 400|json_validate_failed|malformed|schema/i.test(message)) return "schema_or_malformed_400";
  if (/HTTP 429|HTTP 503|HTTP 5\d\d|capacity|temporarily unavailable/i.test(message)) return "capacity_or_503";
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return "timeout";
  return "network";
}

function failureDetail(
  candidate: AssessmentProviderCandidate<unknown, unknown>,
  error: unknown,
  attempts: ProviderAttemptDiagnostic[],
): AssessmentProviderFailureDetail {
  const providerAttempts = attempts.filter((attempt) => attempt.provider === candidate.provider);
  const classifications = [...new Set(providerAttempts.map(classifyAttempt).filter(
    (value): value is ProviderFailureClassification => value !== null,
  ))];
  if (!classifications.length) classifications.push(classifyError(error));
  const uniqueHttpAttempts = new Map<string, ProviderAttemptDiagnostic>();
  for (const attempt of providerAttempts) {
    if (attempt.status !== null) uniqueHttpAttempts.set(String(attempt.group) + ":" + attempt.attempt + ":" + attempt.status, attempt);
  }
  const statusCodes = [...uniqueHttpAttempts.values()].map((attempt) => attempt.status as number);
  const usage = [...providerAttempts].reverse()
    .find((attempt) => attempt.actualUsage !== undefined && attempt.actualUsage !== null)?.actualUsage;
  const estimated = providerAttempts.map((attempt) => attempt.estimatedInputTokens)
    .filter((value): value is number => typeof value === "number");
  return {
    provider: candidate.provider,
    model: candidate.model,
    classification: classifications[classifications.length - 1],
    classifications,
    statusCodes,
    attemptCount: statusCodes.length,
    preflightCount: providerAttempts.filter((attempt) => attempt.failureKind === "prompt_budget_exceeded").length,
    estimatedInputTokens: estimated.length ? estimated[estimated.length - 1] : null,
    actualUsage: usage
      ? { status: "available", promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, totalTokens: usage.totalTokens }
      : { status: "unavailable", reason: "no_200_response_usage" },
  };
}

/**
 * Try each configured assessment provider in order. Capture only bounded,
 * structured attempt metadata; never copy prompts, evidence or provider bodies
 * into the final failure diagnostic.
 */
export async function runAssessmentProviderChain<TInput, TResult>(
  candidates: readonly AssessmentProviderCandidate<TInput, TResult>[],
  input: TInput,
  signal?: AbortSignal,
  callbacks: AssessmentProviderChainCallbacks<TInput, TResult> = {},
): Promise<TResult> {
  const attempts: ProviderAttemptDiagnostic[] = [];
  const recordable = input && typeof input === "object"
    ? input as TInput & { recordProviderAttempt?: (attempt: ProviderAttemptDiagnostic) => Promise<void> }
    : null;
  const originalRecorder = recordable?.recordProviderAttempt;
  const trackedInput = originalRecorder
    ? Object.assign({}, input, {
        recordProviderAttempt: async (attempt: ProviderAttemptDiagnostic) => {
          attempts.push(attempt);
          await originalRecorder(attempt);
        },
      }) as TInput
    : input;
  const failures: AssessmentProviderFailureDetail[] = [];

  for (const candidate of candidates) {
    if (!candidate.client) {
      await callbacks.onSkipped?.(candidate);
      continue;
    }

    try {
      return await candidate.client.assess(trackedInput, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const detail = failureDetail(candidate as AssessmentProviderCandidate<unknown, unknown>, error, attempts);
      failures.push(detail);
      callbacks.onFailure?.(candidate, error, detail);
    }
  }

  if (failures.length) throw new AssessmentProviderChainError(failures);
  throw new Error("AI_PROVIDERS_UNAVAILABLE: no assessment provider could be attempted");
}
