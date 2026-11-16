import { describe, expect, it } from "vitest";
import { createRecognitionSample } from "../src/audio/recognition-sample.js";

describe("createRecognitionSample", () => {
  it("requests a short WAV sample from the source master", async () => {
    const calls: string[][] = [];
    const sample = await createRecognitionSample(
      new Uint8Array([1, 2, 3]),
      "audio/wav",
      async (args) => {
        calls.push(args);
        return new Uint8Array([9, 8, 7]);
      },
    );

    expect(sample).toEqual(new Uint8Array([9, 8, 7]));
    expect(calls[0]).toContain("-t");
    expect(calls[0]).toContain("30");
    expect(calls[0]).toContain("pipe:0");
    expect(calls[0]).toContain("pipe:1");
  });
});
