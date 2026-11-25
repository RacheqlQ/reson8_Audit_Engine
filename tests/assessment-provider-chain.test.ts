import { describe, expect, it, vi } from "vitest";
import { AssessmentProviderChainError, runAssessmentProviderChain } from "../src/jobs/assessment-provider-chain.js";
import type { ProviderAttemptDiagnostic } from "../src/providers/groq/client.js";

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

  it("returns the final configured provider error when every provider fails", async () => {
    const groq = { assess: vi.fn().mockRejectedValue(new Error("Groq capacity")) };
    const gemini = { assess: vi.fn().mockRejectedValue(new Error("Gemini unavailable")) };
    const ollama = { assess: vi.fn().mockRejectedValue(new Error("Ollama unavailable")) };

    await expect(runAssessmentProviderChain([
      { provider: "groq", model: "gpt-oss", client: groq },
      { provider: "gemini", model: "gemini-flash-lite", client: gemini },
      { provider: "ollama", model: "gemma", client: ollama },
    ], { trackId: "fixture-track" })).rejects.toBeInstanceOf(AssessmentProviderChainError);
  });
});

describe("assessment provider chain diagnostics", () => {
  it("retains Groq 400/preflight and three Gemini 503 attempts without inventing usage or threshold failures", async () => {
    const attempts: ProviderAttemptDiagnostic[] = [];
    const input = {
      evidence: { artist: "Private fixture evidence" },
      recordProviderAttempt: async (attempt: ProviderAttemptDiagnostic) => { attempts.push(attempt); },
    };
    const groq = {
      assess: async (received: typeof input) => {
        await received.recordProviderAttempt({
          provider: "groq", model: "openai/gpt-oss-120b", status: 400,
          errorType: "malformed_output", retryable: false, attempt: 1, group: "narrative",
          failureClass: "schema_or_malformed_400", estimatedInputTokens: 5650,
          actualUsage: { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
        });
        await received.recordProviderAttempt({
          provider: "groq", model: "openai/gpt-oss-120b", status: null,
          errorType: "provider_error", retryable: false, attempt: 2, group: "narrative",
          failureKind: "prompt_budget_exceeded", failureClass: "preflight_budget", estimatedInputTokens: 6017,
          actualUsage: { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
        });
        throw new Error("GROQ_PROMPT_BUDGET_EXCEEDED");
      },
    };
    const gemini = {
      assess: async (received: typeof input) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          await received.recordProviderAttempt({
            provider: "gemini", model: "gemini-3.5-flash-lite", status: 503,
            errorType: "provider_error", retryable: attempt < 3, attempt, group: "narrative",
            failureClass: "capacity_or_503", estimatedInputTokens: 5829,
            actualUsage: { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
          });
        }
        throw new Error("Gemini HTTP 503 after bounded retries");
      },
    };

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
    const error = caught as AssessmentProviderChainError;
    expect(error.diagnostics).toHaveLength(2);
    expect(error.diagnostics[0]).toMatchObject({
      provider: "groq", model: "openai/gpt-oss-120b", attemptCount: 2,
      statusCodes: [400], failureClasses: ["schema_or_malformed_400", "preflight_budget"],
      estimatedInputTokens: [5650, 6017],
      actualUsage: { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
    });
    expect(error.diagnostics[1]).toMatchObject({
      provider: "gemini", model: "gemini-3.5-flash-lite", attemptCount: 3,
      statusCodes: [503, 503, 503], failureClasses: ["capacity_or_503"], estimatedInputTokens: [5829, 5829, 5829],
      actualUsage: { status: "unavailable", promptTokens: null, completionTokens: null, totalTokens: null },
    });
    expect(attempts).toHaveLength(5);
    expect(error.message).toContain("actualUsage=unavailable");
    expect(error.message).not.toContain("Private fixture evidence");
    expect(error.message).not.toContain("threshold_violation");
  });

  it("reports actual usage only when a successful provider response explicitly supplies it", async () => {
    const attempts: ProviderAttemptDiagnostic[] = [];
    const input = { recordProviderAttempt: async (attempt: ProviderAttemptDiagnostic) => { attempts.push(attempt); } };
    const client = {
      assess: async (received: typeof input) => {
        await received.recordProviderAttempt({
          provider: "groq", model: "test-model", status: 200, errorType: "none",
          retryable: false, attempt: 1, group: "narrative", estimatedInputTokens: 1200,
          actualUsage: { status: "reported", promptTokens: 1200, completionTokens: 400, totalTokens: 1600 },
        });
        return "complete";
      },
    };
    await expect(runAssessmentProviderChain([
      { provider: "groq", model: "test-model", client },
    ], input)).resolves.toBe("complete");
    expect(attempts[0].actualUsage).toEqual({
      status: "reported", promptTokens: 1200, completionTokens: 400, totalTokens: 1600,
    });
  });
});


describe("Gemini capacity recovery back to Groq", () => {
  it("retries the Groq provider after Gemini exhausts its bounded capacity attempts", async () => {
    let groqCalls = 0;
    const groq = { assess: vi.fn(async () => {
      groqCalls++;
      if (groqCalls === 1) throw new Error("Groq narrative completion_truncated");
      return { verdict: "completed-by-groq" };
    }) };
    const gemini = { assess: vi.fn().mockRejectedValue(new Error("Gemini evidence-score failed with HTTP 503 capacity_or_503")) };
    const result = await runAssessmentProviderChain([
      { provider: "groq", model: "gpt-oss", client: groq },
      { provider: "gemini", model: "gemini-flash-lite", client: gemini },
      { provider: "groq", model: "gpt-oss", client: groq },
    ], { trackId: "capacity-fallback-fixture" });
    expect(result).toEqual({ verdict: "completed-by-groq" });
    expect(groq).toHaveBeenCalledTimes(2);
    expect(gemini).toHaveBeenCalledOnce();
  });
});
