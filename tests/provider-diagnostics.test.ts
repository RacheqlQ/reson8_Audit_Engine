import { describe, expect, it, vi } from "vitest";
import {
  logProviderFailure,
  logProviderResponse,
} from "../src/diagnostics/provider-response.js";

describe("provider response diagnostics", () => {
  it("logs structured provider responses without exposing credentials or raw binary data", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logProviderResponse({
      provider: "audd",
      operation: "recognize",
      status: 200,
      ok: true,
      auditJobId: "job-123",
      payload: {
        result: { artist: "Otis Redding", title: "(Sittin' On) the Dock of the Bay" },
        api_token: "must-not-appear",
        audio: "binary-audio-must-not-appear",
      },
    });

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain('"event":"provider_response"');
    expect(line).toContain('"provider":"audd"');
    expect(line).toContain('"operation":"recognize"');
    expect(line).toContain('"httpStatus":200');
    expect(line).toContain("Otis Redding");
    expect(line).not.toContain("must-not-appear");
    expect(line).not.toContain("api_token");

    info.mockRestore();
  });

  it("logs provider failures as structured events", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logProviderFailure({
      provider: "spotify",
      operation: "catalog_metadata",
      auditJobId: "job-456",
      error: new Error("Spotify metadata request failed with HTTP 500"),
    });

    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).toContain('"event":"provider_error"');
    expect(line).toContain('"provider":"spotify"');
    expect(line).toContain("HTTP 500");

    error.mockRestore();
  });

  it("truncates oversized provider payloads", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logProviderResponse({
      provider: "tidal",
      operation: "catalog_metadata",
      status: 200,
      ok: true,
      payload: { data: "x".repeat(40_000) },
    });

    const line = String(info.mock.calls[0]?.[0]);
    expect(line.length).toBeLessThan(33_000);
    expect(line).toContain("[truncated]");

    info.mockRestore();
  });
});
