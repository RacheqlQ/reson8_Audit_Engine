import { providerDecision } from "./provider-policy.js";

export type AssessmentProvider = "groq" | "gemini" | "ollama";

export interface ProviderReadiness {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  reason: "disabled_by_data_policy" | "missing_credentials" | "authentication_failed" | null;
}

export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: AssessmentProvider,
    readonly reason: "disabled_by_data_policy" | "missing_credentials" | "authentication_failed",
  ) {
    super(`${provider.toUpperCase()}_PROVIDER_UNAVAILABLE:${reason}`);
    this.name = "ProviderUnavailableError";
  }
}

const runtimeUnavailable = new Map<AssessmentProvider, "authentication_failed">();

export function markProviderUnavailable(provider: AssessmentProvider, reason: "authentication_failed"): void {
  runtimeUnavailable.set(provider, reason);
}

export function clearProviderUnavailable(provider: AssessmentProvider): void {
  runtimeUnavailable.delete(provider);
}

const CREDENTIALS: Record<AssessmentProvider, readonly string[]> = {
  groq: ["GROQ_API_KEY", "GROQ_API"],
  gemini: ["GEMINI_API_KEY"],
  ollama: ["OLLAMA_API_KEY"],
};

export function getProviderReadiness(
  env: Record<string, string | undefined> = process.env,
): Record<AssessmentProvider, ProviderReadiness> {
  return Object.fromEntries((Object.keys(CREDENTIALS) as AssessmentProvider[]).map((provider) => {
    const enabled = providerDecision(provider, env).enabled;
    const configured = CREDENTIALS[provider].some((key) => Boolean(env[key]?.trim()));
    const runtimeReason = runtimeUnavailable.get(provider) ?? null;
    const reason = !enabled ? "disabled_by_data_policy"
      : !configured ? "missing_credentials"
        : runtimeReason;
    return [provider, {
      enabled,
      configured,
      ready: reason === null,
      reason,
    }];
  })) as Record<AssessmentProvider, ProviderReadiness>;
}
