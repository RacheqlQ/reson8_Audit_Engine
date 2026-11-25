import { describe, expect, it } from "vitest";
import { AI_ASSESSMENT_STAGE_TIMEOUT_MS, classifyAuditFailure } from "../src/jobs/process-audit-job.js";
import { GROQ_ASSESSMENT_TIMEOUT_MS } from "../src/providers/groq/client.js";

describe("AI assessment deadline contract", () => {
  it("allows eleven minutes for the surrounding assessment stage", () => {
    expect(AI_ASSESSMENT_STAGE_TIMEOUT_MS).toBe(11 * 60_000);
  });

  it("keeps the Groq provider deadline below the outer stage deadline", () => {
    expect(GROQ_ASSESSMENT_TIMEOUT_MS).toBeLessThan(AI_ASSESSMENT_STAGE_TIMEOUT_MS);
    expect(GROQ_ASSESSMENT_TIMEOUT_MS).toBe(7 * 60_000);
  });

  it("classifies exhausted Groq JSON validation responses as malformed output", () => {
    expect(classifyAuditFailure(new Error(
      'Groq narrative assessment failed with HTTP 400 after bounded JSON recovery: {"error":{"code":"json_validate_failed"}}',
    ))).toBe("malformed_output");
  });
});
