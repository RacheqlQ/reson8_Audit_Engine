import { describe, expect, it, vi } from "vitest";
import { GroqClient } from "../src/providers/groq/client.js";

describe("Groq TPM capacity responses", () => {
  it("retries HTTP 413 TPM-capacity responses using Retry-After and jitter", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: { type: "rate_limit_error", code: "tokens_per_minute", message: "Request exceeds tokens per minute (TPM) capacity" } }),
      { status: 413, headers: { "content-type": "application/json", "retry-after": "1" } },
    ));
    const delays: number[] = [];
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const client = new GroqClient(
      "test-key",
      "openai/gpt-oss-120b",
      fetchMock as typeof fetch,
      async (ms) => { delays.push(ms); },
    );

    try {
      const failure = await client.assess({ evidence: {}, sonicDna: null }).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        provider: "groq",
        model: "openai/gpt-oss-120b",
        httpStatus: 413,
        retryable: true,
      });
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("GROQ_TPM_CAPACITY_EXHAUSTED");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(delays).toHaveLength(2);
      expect(delays.every((delay) => delay >= 1000 && delay <= 60000)).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it("does not retry a non-capacity HTTP 413 oversized request", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: { type: "invalid_request_error", code: "request_too_large", message: "Payload is too large" } }),
      { status: 413, headers: { "content-type": "application/json" } },
    ));
    const client = new GroqClient("test-key", "openai/gpt-oss-120b", fetchMock as typeof fetch, async () => {});

    await expect(client.assess({ evidence: {}, sonicDna: null })).rejects.toThrow("GROQ_REQUEST_TOO_LARGE");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
