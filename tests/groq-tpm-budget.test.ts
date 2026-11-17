import { describe, expect, it, vi } from "vitest";
import { GroqClient } from "../src/providers/groq/client.js";

describe("Groq TPM request budget", () => {
  it("fails permanently on HTTP 413 without retrying the same payload", async () => {
    const budgets: number[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      budgets.push(body.max_completion_tokens);
      return new Response(JSON.stringify({
        error: { message: "Request too large on tokens per minute. Limit 8000, Requested 8524." },
      }), { status: 413 });
    });
    const client = new GroqClient("test-key", "test-model", fetchImpl as typeof fetch, async () => {});
    await expect(client.assess({ evidence: {}, sonicDna: null })).rejects.toThrow("GROQ_REQUEST_TOO_LARGE");
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toBeLessThanOrEqual(850);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
