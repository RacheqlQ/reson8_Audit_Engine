import { describe, expect, it } from "vitest";
import { AI_ASSESSMENT_STAGE_TIMEOUT_MS, classifyAuditFailure } from "../src/jobs/process-audit-job.js";
import { GEMINI_ASSESSMENT_TIMEOUT_MS, GROQ_ASSESSMENT_TIMEOUT_MS } from "../src/providers/groq/client.js";

describe("AI assessment deadline contract", () => {
  it("allows fifteen minutes for the surrounding assessment stage", () => {
    expect(AI_ASSESSMENT_STAGE_TIMEOUT_MS).toBe(15 * 60_000);
  });

  it("keeps the Groq provider deadline below the outer stage deadline", () => {
    expect(GROQ_ASSESSMENT_TIMEOUT_MS).toBeLessThan(AI_ASSESSMENT_STAGE_TIMEOUT_MS);
    expect(GROQ_ASSESSMENT_TIMEOUT_MS).toBe(7 * 60_000);
  });

  it("reserves a bounded Groq recovery window and one-minute handoff after primary and Gemini fallback", () => {
    expect(GROQ_ASSESSMENT_TIMEOUT_MS + GEMINI_ASSESSMENT_TIMEOUT_MS + 4 * 60_000 + 60_000).toBeLessThanOrEqual(AI_ASSESSMENT_STAGE_TIMEOUT_MS);
  });

  it("classifies exhausted Groq JSON validation responses as malformed output", () => {
    expect(classifyAuditFailure(new Error(
      'Groq narrative assessment failed with HTTP 400 after bounded JSON recovery: {"error":{"code":"json_validate_failed"}}',
    ))).toBe("malformed_output");
  });
});
