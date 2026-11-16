import { describe, expect, it } from "vitest";
import { createAudioDecoder } from "../src/audio/decoder.js";

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
});
