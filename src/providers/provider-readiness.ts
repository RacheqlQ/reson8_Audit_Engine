import { providerDecision } from "./provider-policy.js";

export type AssessmentProvider = "groq" | "gemini" | "ollama";

export interface ProviderReadiness {
  enabled: boolean;
  configured: boolean;
  ready: boolean;
  reason: "disabled_by_data_policy" | "missing_credentials" | null;
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
    const ready = enabled && configured;
    return [provider, {
      enabled,
      configured,
      ready,
      reason: !enabled ? "disabled_by_data_policy" : !configured ? "missing_credentials" : null,
    }];
  })) as Record<AssessmentProvider, ProviderReadiness>;
}
