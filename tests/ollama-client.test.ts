import { describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../src/providers/groq/client.js";

describe("Ollama Cloud assessment fallback transport", () => {
  it("uses the hosted OpenAI-compatible endpoint, bearer key, JSON mode and per-section output budget", async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ error: { message: "temporary unavailable" } }), { status: 503 });
    });
    const client = new OllamaClient("test-ollama-key", "gemma4:31b", fetchMock as typeof fetch, async () => {});

    await expect(client.assess({ evidence: {}, sonicDna: null })).rejects.toThrow("Ollama narrative assessment failed with HTTP 503");
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url).toBe("https://ollama.com/v1/chat/completions");
      expect(request.headers.get("authorization")).toBe("Bearer test-ollama-key");
      expect(request.body.model).toBe("gemma4:31b");
      expect(request.body.response_format).toEqual({ type: "json_object" });
      expect(request.body.max_tokens).toBeGreaterThanOrEqual(256);
      expect(request.body.max_tokens).toBeLessThanOrEqual(850);
      expect(request.body).not.toHaveProperty("max_completion_tokens");
    }
  });

  it("requires an Ollama API key", () => {
    expect(() => new OllamaClient("")).toThrow("OLLAMA_API_KEY is required");
  });
});
