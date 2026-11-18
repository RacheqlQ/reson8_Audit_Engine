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
    expect(decoded.samples.buffer).toBe(buffer.buffer);
  });

  it("decodes a real stereo WAV without downmixing and returns EBU R128 measurements", async () => {
    const sampleRate = 48000, channels = 2, frames = sampleRate * 2;
    const dataBytes = frames * channels * 2;
    const wav = Buffer.alloc(44 + dataBytes);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + dataBytes, 4); wav.write("WAVE", 8);
    wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(channels, 22); wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * channels * 2, 28); wav.writeUInt16LE(channels * 2, 32);
    wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(dataBytes, 40);
    for (let frame = 0; frame < frames; frame++) {
      const sample = Math.round(Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.2 * 32767);
      wav.writeInt16LE(sample, 44 + frame * 4);
      wav.writeInt16LE(Math.round(sample * 0.8), 46 + frame * 4);
    }
    const decoded = await createAudioDecoder().decode(wav);
    expect(decoded.sampleRate).toBe(sampleRate);
    expect(decoded.channels).toBe(channels);
    expect(decoded.samples.length).toBe(frames * channels);
    expect(decoded.loudnessLufs).toBeTypeOf("number");
    expect(decoded.loudnessLufs).toBeGreaterThan(-30);
    expect(decoded.loudnessLufs).toBeLessThan(-5);
    expect(decoded.truePeakDbfs).toBeTypeOf("number");
  });

  it("extracts EBU R128 integrated loudness, loudness range and true peak", () => {
    const summary = parseEbur128Summary([
      "frame I: -70.0 LUFS", "frame I: -15.4 LUFS", "Integrated loudness:", "I: -12.3 LUFS", "Threshold: -22.4 LUFS", "",
      "Loudness range:", "LRA: 4.2 LU", "", "True peak:", "Peak: -1.1 dBFS",
    ].join("\n"));
    expect(summary).toEqual({ loudnessLufs: -12.3, loudnessRangeLu: 4.2, truePeakDbfs: -1.1 });
  });

});
