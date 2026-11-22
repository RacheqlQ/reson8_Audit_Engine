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
