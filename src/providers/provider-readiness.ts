import { providerDecision, type ProviderId } from "./provider-policy.js";

export type ProviderReadinessStatus =
  | "ready"
  | "disabled_by_data_policy"
  | "missing_credentials"
  | "unavailable_authentication";

const PROVIDER_IDS = ["groq", "gemini", "ollama", "audd"] as const satisfies readonly ProviderId[];
const CREDENTIAL_ENV: Record<(typeof PROVIDER_IDS)[number], readonly string[]> = {
  groq: ["GROQ_API"],
  gemini: ["GEMINI_API_KEY"],
  ollama: ["OLLAMA_API_KEY"],
  audd: ["AUDD_API", "AUDD_API_TOKEN"],
};
const unavailable = new Map<ProviderId, ProviderReadinessStatus>();

export function markProviderUnavailable(provider: ProviderId, reason: "authentication"): void {
  unavailable.set(provider, reason === "authentication" ? "unavailable_authentication" : "ready");
}

export function markProviderAvailable(provider: ProviderId): void {
  unavailable.delete(provider);
}

export function isProviderRuntimeAvailable(provider: ProviderId): boolean {
  return !unavailable.has(provider);
}

export function getProviderReadiness(env: Record<string, string | undefined> = process.env) {
  return PROVIDER_IDS.map((provider) => {
    const decision = providerDecision(provider, env);
    const credentialConfigured = CREDENTIAL_ENV[provider].some((key) => Boolean(env[key]?.trim()));
    const runtimeStatus = unavailable.get(provider);
    const status: ProviderReadinessStatus = runtimeStatus
      ?? (!decision.enabled ? "disabled_by_data_policy" : !credentialConfigured ? "missing_credentials" : "ready");
    return {
      provider,
      enabled: status === "ready",
      status,
      credentialConfigured,
      enableFlag: decision.enableFlag,
    };
  });
}
