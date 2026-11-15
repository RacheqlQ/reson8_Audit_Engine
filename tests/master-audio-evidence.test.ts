import { describe, expect, it } from "vitest";
import { getAuditSourceReadinessError, hasSubmittedMasterAudio } from "../src/audio/master-audio-evidence.js";
import { processAuditJob, type AuditProcessorDependencies } from "../src/jobs/process-audit-job.js";

describe("master audio submission evidence", () => {
  it("recognizes a submitted master independently of whether Sonic DNA measurements exist", () => {
    expect(hasSubmittedMasterAudio({
      masterAudio: { evidenceClass: "OBSERVED", provenance: "uploaded_audio_master" },
    }, null)).toBe(true);
  });

  it("recognizes a master from measured Sonic DNA when the explicit marker is absent", () => {
    expect(hasSubmittedMasterAudio({}, { provenance: "uploaded_audio_master" })).toBe(true);
  });

  it("does not classify provider metadata as an uploaded master", () => {
    expect(hasSubmittedMasterAudio({}, { provenance: "tidal_catalog_metadata" })).toBe(false);
  });

  it("rejects a combined job until both master path and MIME type are finalized", () => {
    expect(getAuditSourceReadinessError({
      sourceType: "combined",
      sourceAudioPath: null,
      mimeType: null,
      catalogUrl: "https://tidal.com/browse/track/example",
    })).toContain("combined audit is missing its uploaded master audio");
    expect(getAuditSourceReadinessError({
      sourceType: "combined",
      sourceAudioPath: "owner/job/master.mp3",
      mimeType: null,
      catalogUrl: "https://tidal.com/browse/track/example",
    })).toContain("MIME type");
  });

  it("rejects a combined job without its DSP source instead of silently downgrading it", () => {
    expect(getAuditSourceReadinessError({
      sourceType: "combined",
      sourceAudioPath: "owner/job/master.mp3",
      mimeType: "audio/mpeg",
      catalogUrl: null,
      catalogUrls: [],
    })).toContain("combined audit is missing its DSP catalog link");
  });

  it("keeps master-only and DSP-only source requirements distinct", () => {
    expect(getAuditSourceReadinessError({
      sourceType: "master",
      sourceAudioPath: "owner/job/master.mp3",
      mimeType: "audio/mpeg",
      catalogUrl: null,
    })).toBeNull();
    expect(getAuditSourceReadinessError({
      sourceType: "dsp_link",
      sourceAudioPath: null,
      mimeType: null,
      catalogUrl: "https://tidal.com/browse/track/example",
    })).toBeNull();
  });
});
