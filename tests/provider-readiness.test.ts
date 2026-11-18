import { describe, expect, it } from "vitest";
import { getProviderReadiness } from "../src/providers/provider-readiness.js";

describe("provider readiness", () => {
  it("reports policy and credential readiness without exposing credential values", () => {
    const result = getProviderReadiness({
      PROVIDER_ENABLED_GROQ: "true",
      GROQ_API_KEY: "not-for-output",
      PROVIDER_ENABLED_GEMINI: "true",
      GEMINI_API_KEY: "",
      PROVIDER_ENABLED_OLLAMA: "false",
      OLLAMA_API_KEY: "configured-but-disabled",
    });
    expect(result).toMatchObject({
      groq: { enabled: true, configured: true, ready: true, reason: null },
      gemini: { enabled: true, configured: false, ready: false, reason: "missing_credentials" },
      ollama: { enabled: false, configured: true, ready: false, reason: "disabled_by_data_policy" },
    });
    expect(JSON.stringify(result)).not.toContain("not-for-output");
    expect(JSON.stringify(result)).not.toContain("configured-but-disabled");
  });
});
