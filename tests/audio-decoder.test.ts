import { describe, expect, it } from "vitest";
import { createAudioDecoder, parseEbur128Summary, parseFloatPcmWav } from "../src/audio/decoder.js";

describe("audio decoder", () => {
  it("decodes audio into mono 44.1kHz float PCM and reports duration", async () => {
    const decoder = createAudioDecoder(async () => {
      return new Float32Array([0, 0.5, -0.5, 0]);
    });

    const result = await decoder.decode(new Uint8Array([1, 2, 3]));

    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(1);
    expect(result.samples).toEqual(new Float32Array([0, 0.5, -0.5, 0]));
  });

  it("preserves decoded source sample rate and channel count from float WAV headers", () => {
    const buffer = Buffer.alloc(60);
    buffer.write("RIFF", 0); buffer.writeUInt32LE(52, 4); buffer.write("WAVE", 8);
    buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20);
    buffer.writeUInt16LE(2, 22); buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(384000, 28);
    buffer.writeUInt16LE(8, 32); buffer.writeUInt16LE(32, 34);
    buffer.write("data", 36); buffer.writeUInt32LE(16, 40);
    [0.25, -0.25, 0.5, -0.5].forEach((value, index) => buffer.writeFloatLE(value, 44 + index * 4));
    const decoded = parseFloatPcmWav(buffer);
    expect(decoded.sampleRate).toBe(48000);
    expect(decoded.channels).toBe(2);
    expect([...decoded.samples]).toEqual([0.25, -0.25, 0.5, -0.5]);
  });

  it("extracts EBU R128 integrated loudness, loudness range and true peak", () => {
    const summary = parseEbur128Summary([
      "Integrated loudness:", "I: -12.3 LUFS", "Threshold: -22.4 LUFS", "",
      "Loudness range:", "LRA: 4.2 LU", "", "True peak:", "Peak: -1.1 dBFS",
    ].join("\n"));
    expect(summary).toEqual({ loudnessLufs: -12.3, loudnessRangeLu: 4.2, truePeakDbfs: -1.1 });
  });

});
