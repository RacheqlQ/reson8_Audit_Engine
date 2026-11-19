import { describe, expect, it } from "vitest";
import {
  buildUnavailableMetric,
  parseRealMasterAuditContract,
  requireRealMasterInput,
} from "../src/audio/real-master-contract.js";

describe("real-master audit contract", () => {
  it("rejects synthetic fixture execution in production", () => {
    expect(() => requireRealMasterInput({
      sourceKind: "synthetic_fixture",
      sourceAudioPath: null,
      sha256: null,
      mimeType: null,
      byteLength: 0,
    })).toThrow(/REAL_MASTER_REQUIRED/);
  });

  it("requires an actual uploaded master identity and non-empty bytes", () => {
    expect(() => requireRealMasterInput({
      sourceKind: "uploaded_master",
      sourceAudioPath: "jobs/1/master.wav",
      sha256: "a".repeat(64),
      mimeType: "audio/wav",
      byteLength: 0,
    })).toThrow(/MASTER_BYTES_EMPTY/);
  });

  it("represents unavailable measurements with explicit diagnostics, not N/D strings", () => {
    const metric = buildUnavailableMetric("tempo_bpm", "INSUFFICIENT_SIGNAL", "No stable transient periodicity.");
    expect(metric).toMatchObject({
      name: "tempo_bpm",
      status: "unavailable",
      value: null,
      diagnostics: [{ code: "INSUFFICIENT_SIGNAL", message: "No stable transient periodicity." }],
    });
    expect(() => parseRealMasterAuditContract({
      schemaVersion: "1.0.0",
      auditId: "audit-1",
      source: { sourceKind: "uploaded_master", sourceAudioPath: "jobs/1/master.wav", sha256: "a".repeat(64), mimeType: "audio/wav", byteLength: 100 },
      directSignalMeasurements: [metric],
      calibratedPredictions: [],
      externalRecords: [],
      strategicSynthesis: [],
    })).not.toThrow();
  });

  it("rejects uncalibrated probabilities and synthesis without evidence references", () => {
    const base = {
      schemaVersion: "1.0.0",
      auditId: "audit-1",
      source: { sourceKind: "uploaded_master", sourceAudioPath: "jobs/1/master.wav", sha256: "a".repeat(64), mimeType: "audio/wav", byteLength: 100 },
      directSignalMeasurements: [],
      externalRecords: [],
    };
    expect(() => parseRealMasterAuditContract({
      ...base,
      calibratedPredictions: [{ name: "mood", status: "predicted", label: "energetic", probability: 0.8, calibration: "uncalibrated", featureDrivers: [] }],
      strategicSynthesis: [],
    })).toThrow();
    expect(() => parseRealMasterAuditContract({
      ...base,
      calibratedPredictions: [],
      strategicSynthesis: [{ claim: "Strong playlist fit", evidenceRefs: [], evidenceClass: "INFERRED" }],
    })).toThrow();
  });

  it("accepts verified external records only with source and retrieval provenance", () => {
    const parsed = parseRealMasterAuditContract({
      schemaVersion: "1.0.0",
      auditId: "audit-2",
      source: { sourceKind: "uploaded_master", sourceAudioPath: "jobs/2/master.flac", sha256: "b".repeat(64), mimeType: "audio/flac", byteLength: 1024 },
      directSignalMeasurements: [],
      calibratedPredictions: [],
      externalRecords: [{
        status: "verified",
        provider: "musicbrainz",
        recordId: "recording-id",
        retrievedAt: "2026-11-19T12:00:00.000Z",
        fields: { isrc: "USAAA2600001" },\n        fieldProvenance: { isrc: { provider: "musicbrainz", recordId: "recording-id", retrievedAt: "2026-11-19T12:00:00.000Z" } },
      }],
      strategicSynthesis: [],
    });
    expect(parsed.externalRecords[0]?.status).toBe("verified");
  });
});
