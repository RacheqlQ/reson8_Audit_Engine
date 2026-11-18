import { describe, expect, it } from "vitest";
import { preparePcmTransfer } from "../src/audio/vocal-analysis-worker-client.js";

describe("vocal worker PCM transfer", () => {
  it("transfers an owned full PCM buffer without allocating a second audio-sized copy", () => {
    const samples = new Float32Array(16);
    const payload = preparePcmTransfer(samples);

    expect(payload.samples).toBe(samples);
    expect(payload.transferList).toEqual([samples.buffer]);
  });

  it("transfers an aligned PCM view with a small WAV header without copying the audio payload", () => {
    const backing = new ArrayBuffer(44 + 16 * Float32Array.BYTES_PER_ELEMENT);
    const samples = new Float32Array(backing, 44, 16);
    const payload = preparePcmTransfer(samples, { allowLeadingBytes: 64 });

    expect(payload.samples).toBe(samples);
    expect(payload.samples.byteOffset).toBe(44);
    expect(payload.transferList).toEqual([backing]);
  });

  it("still compacts PCM views with unrelated trailing bytes", () => {
    const backing = new Float32Array(24);
    const samples = backing.subarray(4, 20);
    const payload = preparePcmTransfer(samples, { allowLeadingBytes: 64 });

    expect(payload.samples).not.toBe(samples);
    expect(payload.samples).toEqual(samples);
    expect(payload.samples.byteOffset).toBe(0);
    expect(payload.samples.buffer).not.toBe(backing.buffer);
    expect(payload.transferList).toEqual([payload.samples.buffer]);
  });

  it("compacts a PCM subview before transfer so unrelated backing-buffer data is not sent", () => {
    const backing = new Float32Array(24);
    const samples = backing.subarray(4, 20);
    const payload = preparePcmTransfer(samples);

    expect(payload.samples).not.toBe(samples);
    expect(payload.samples).toEqual(samples);
    expect(payload.samples.byteOffset).toBe(0);
    expect(payload.samples.buffer).not.toBe(backing.buffer);
    expect(payload.transferList).toEqual([payload.samples.buffer]);
  });
});
