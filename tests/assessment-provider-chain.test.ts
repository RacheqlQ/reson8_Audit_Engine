import { describe, expect, it, vi } from "vitest";
import { runAssessmentProviderChain } from "../src/jobs/assessment-provider-chain.js";

describe("assessment provider fallback chain", () => {
  it("continues to Ollama when Gemini fails with an unclassified provider error", async () => {
    const groq = {
      assess: vi.fn().mockRejectedValue(new Error("HTTP 413 capacity limit")),
    };
    const gemini = {
      assess: vi.fn().mockRejectedValue(new Error("Gemini returned an unexpected provider response")),
    };
    const ollama = {
      assess: vi.fn().mockResolvedValue({ verdict: "promising" }),
    };

    const result = await runAssessmentProviderChain([
      { provider: "groq", model: "gpt-oss", client: groq },
      { provider: "gemini", model: "gemini-flash-lite", client: gemini },
      { provider: "ollama", model: "gemma", client: ollama },
    ], { trackId: "fixture-track" });

    expect(result).toEqual({ verdict: "promising" });
    expect(groq.assess).toHaveBeenCalledOnce();
    expect(gemini.assess).toHaveBeenCalledOnce();
    expect(ollama.assess).toHaveBeenCalledOnce();
  });

  it("continues to the next configured provider after a non-retryable HTTP 402 response", async () => {
    const gemini = {
      assess: vi.fn().mockRejectedValue(new Error("Gemini evidence-score failed with HTTP 503")),
    };
    const ollama = {
      assess: vi.fn().mockRejectedValue(new Error("Ollama evidence-score failed with HTTP 402")),
    };
    const resultProvider = {
      assess: vi.fn().mockResolvedValue({ verdict: "recovered" }),
    };

    const result = await runAssessmentProviderChain([
      { provider: "gemini", model: "gemini-flash-lite", client: gemini },
      { provider: "ollama", model: "gemma", client: ollama },
      { provider: "groq", model: "gpt-oss", client: resultProvider },
    ], { trackId: "fixture-track" });

    expect(result).toEqual({ verdict: "recovered" });
    expect(gemini.assess).toHaveBeenCalledOnce();
    expect(ollama.assess).toHaveBeenCalledOnce();
    expect(resultProvider.assess).toHaveBeenCalledOnce();
  });


  it("retains safe multi-provider status, retry, budget and usage diagnostics", async () => {
    const input = {
      recordProviderAttempt: vi.fn(async (_attempt: import("../src/providers/groq/client.js").ProviderAttemptDiagnostic) => {}),
    };
    const groq = {
      assess: vi.fn(async (received: typeof input) => {
        await received.recordProviderAttempt({
          provider: "groq", model: "openai/gpt-oss-120b", status: 400,
          errorType: "malformed_output", retryable: true, attempt: 1, group: "narrative",
          estimatedInputTokens: 5650, actualUsage: null,
        });
        await received.recordProviderAttempt({
          provider: "groq", model: "openai/gpt-oss-120b", status: null,
          errorType: "provider_unavailable", retryable: false, attempt: 2, group: "narrative",
          failureKind: "prompt_budget_exceeded", estimatedInputTokens: 6017, actualUsage: null,
        });
        throw new Error("GROQ_PROMPT_BUDGET_EXCEEDED");
      }),
    };
    const gemini = {
      assess: vi.fn(async (received: typeof input) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          await received.recordProviderAttempt({
            provider: "gemini", model: "gemini-3.5-flash-lite", status: 503,
            errorType: "provider_error", retryable: attempt < 3, attempt, group: "narrative",
            estimatedInputTokens: 5829, actualUsage: null,
          });
        }
        throw new Error("Gemini narrative assessment failed with HTTP 503");
      }),
    };

    const { AssessmentProviderChainError } = await import("../src/jobs/assessment-provider-chain.js");
    let caught: unknown;
    try {
      await runAssessmentProviderChain([
        { provider: "groq", model: "openai/gpt-oss-120b", client: groq },
        { provider: "gemini", model: "gemini-3.5-flash-lite", client: gemini },
      ], input);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AssessmentProviderChainError);
    const diagnostics = (caught as InstanceType<typeof AssessmentProviderChainError>).diagnostics;
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      provider: "groq", model: "openai/gpt-oss-120b",
      classification: "preflight_budget",
      classifications: ["schema_or_malformed_400", "preflight_budget"],
      statusCodes: [400], attemptCount: 1, preflightCount: 1,
      estimatedInputTokens: 6017,
      actualUsage: { status: "unavailable", reason: "no_200_response_usage" },
    });
    expect(diagnostics[1]).toMatchObject({
      provider: "gemini", model: "gemini-3.5-flash-lite",
      classification: "capacity_or_503", classifications: ["capacity_or_503"],
      statusCodes: [503, 503, 503], attemptCount: 3, preflightCount: 0,
      estimatedInputTokens: 5829,
      actualUsage: { status: "unavailable", reason: "no_200_response_usage" },
    });
    expect(JSON.stringify(diagnostics)).not.toContain("threshold_violation");
    expect(String((caught as Error).message)).toContain("actual usage unavailable");
  });

  it("returns the final configured provider error when every provider fails", async () => {
    const groq = { assess: vi.fn().mockRejectedValue(new Error("Groq capacity")) };
    const gemini = { assess: vi.fn().mockRejectedValue(new Error("Gemini unavailable")) };
    const ollama = { assess: vi.fn().mockRejectedValue(new Error("Ollama unavailable")) };

    await expect(runAssessmentProviderChain([
      { provider: "groq", model: "gpt-oss", client: groq },
      { provider: "gemini", model: "gemini-flash-lite", client: gemini },
      { provider: "ollama", model: "gemma", client: ollama },
    ], { trackId: "fixture-track" })).rejects.toThrow("Ollama unavailable");
  });
});
