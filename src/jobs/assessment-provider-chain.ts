import type { ProviderAttemptDiagnostic } from "../providers/groq/client.js";

export type AssessmentProviderName = ProviderAttemptDiagnostic["provider"];

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

/**
 * Try each configured assessment provider in order. A provider-specific error
 * must not suppress later fallbacks: upstreams can return unclassified 4xx,
 * malformed responses, or transient errors that still leave another provider
 * healthy. Only an explicit worker abort stops the chain immediately.
 */
export async function runAssessmentProviderChain<TInput, TResult>(
  candidates: readonly AssessmentProviderCandidate<TInput, TResult>[],
  input: TInput,
  signal?: AbortSignal,
  callbacks: AssessmentProviderChainCallbacks<TInput, TResult> = {},
): Promise<TResult> {
  let lastProviderError: unknown = null;

  for (const candidate of candidates) {
    if (!candidate.client) {
      await callbacks.onSkipped?.(candidate);
      continue;
    }

    try {
      return await candidate.client.assess(input, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      lastProviderError = error;
      callbacks.onFailure?.(candidate, error);
    }
  }

  throw lastProviderError ?? new Error("AI_PROVIDERS_UNAVAILABLE: no assessment provider could be attempted");
}
