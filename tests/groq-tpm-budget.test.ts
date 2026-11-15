import { describe, expect, it, vi } from "vitest";
import { GroqClient } from "../src/providers/groq/client.js";

describe("Groq TPM reservation budget", () => {
  it("uses a bounded completion reservation and reduces it again after a 413", async () => {
    const budgets: number[] = [];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      budgets.push(body.max_completion_tokens);
      if (budgets.length === 1) {
        return new Response(JSON.stringify({
          error: { message: "Request too large on tokens per minute. Limit 8000, Requested 8524." },
        }), { status: 413 });
      }
      return new Response(JSON.stringify({
        error: { message: "Invalid API key", code: "invalid_api_key" },
      }), { status: 400 });
    });

    const client = new GroqClient("test-key", "test-model", fetchImpl as typeof fetch, async () => {});
    await expect(client.assess({ evidence: {}, sonicDna: null }))
      .rejects.toThrow("Groq narrative assessment failed with HTTP 400");

    expect(budgets).toEqual([2500, 1500]);
  });
});
