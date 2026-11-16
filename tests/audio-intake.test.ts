import { describe, expect, it } from "vitest";
import { validateAudioUpload } from "../src/jobs/audio-intake.js";

describe("validateAudioUpload", () => {
  it("accepts supported audio with a valid size and filename", () => {
    expect(
      validateAudioUpload({
        filename: "My Song.wav",
        mimeType: "audio/wav",
        sizeBytes: 4_000_000,
      }),
    ).toEqual({
      filename: "My Song.wav",
      mimeType: "audio/wav",
      sizeBytes: 4_000_000,
    });
  });

  it("accepts FLAC and MP3 uploads", () => {
    expect(validateAudioUpload({ filename: "master.flac", mimeType: "audio/flac", sizeBytes: 1 })).toBeTruthy();
    expect(validateAudioUpload({ filename: "master.mp3", mimeType: "audio/mpeg", sizeBytes: 1 })).toBeTruthy();
  });

  it("rejects unsupported MIME types", () => {
    expect(() =>
      validateAudioUpload({ filename: "track.exe", mimeType: "application/octet-stream", sizeBytes: 100 }),
    ).toThrow("Unsupported audio type");
  });

  it("rejects empty and oversized files", () => {
    expect(() => validateAudioUpload({ filename: "track.wav", mimeType: "audio/wav", sizeBytes: 0 })).toThrow(
      "Audio file is empty",
    );
    expect(() =>
      validateAudioUpload({ filename: "track.wav", mimeType: "audio/wav", sizeBytes: 50 * 1024 * 1024 + 1 }),
    ).toThrow("Audio file exceeds the 50 MB limit");
  });

  it("rejects path traversal and preserves only the basename", () => {
    expect(validateAudioUpload({ filename: "../../secret/track.wav", mimeType: "audio/wav", sizeBytes: 100 }).filename).toBe(
      "track.wav",
    );
  });

  it("rejects missing filenames", () => {
    expect(() => validateAudioUpload({ filename: "", mimeType: "audio/wav", sizeBytes: 100 })).toThrow(
      "Audio filename is required",
    );
  });
});
