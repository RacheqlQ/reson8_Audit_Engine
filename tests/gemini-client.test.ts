import { describe, expect, it, vi } from "vitest";
import { GeminiClient } from "../src/providers/groq/client.js";

describe("Gemini assessment fallback transport", () => {
  it("uses Google's OpenAI-compatible endpoint, JSON-object mode and Gemini token field", async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ error: { message: "temporary unavailable" } }), { status: 503 });
    });
    const client = new GeminiClient("test-gemini-key", undefined, fetchMock as typeof fetch, async () => {});

    await expect(client.assess({ evidence: {}, sonicDna: null })).rejects.toThrow("Gemini narrative assessment failed with HTTP 503");
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
      expect(request.headers.get("authorization")).toBe("Bearer test-gemini-key");
      expect(request.body.model).toBe("gemini-3.6-flash");
      expect(request.body.response_format).toEqual({ type: "json_object" });
      expect(request.body.max_tokens).toBeGreaterThanOrEqual(256);
      expect(request.body.max_tokens).toBeLessThanOrEqual(1200);
      expect(request.body).not.toHaveProperty("max_completion_tokens");
      const messages = request.body.messages as Array<{ content: string }>;
      expect(messages[1].content).toContain('"outputSchema"');
      expect(messages[0].content).toContain("Return JSON only");
    }
  });
});
