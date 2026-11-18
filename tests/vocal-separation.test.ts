import { describe, expect, it } from "vitest";
import type { ModelSpec, Session } from "@audio/neural-separate";
import { separateVocalsFromPcm } from "../src/audio/vocal-separation.js";

describe("master vocal separation integration", () => {
  it("requests only the vocal stem with the pinned Open-Unmix path and analyses the returned PCM", async () => {
    const sampleRate = 8000;
    const mix = Float32Array.from({ length: sampleRate }, (_, i) =>
      0.5 * Math.sin(2 * Math.PI * 220 * i / sampleRate),
    );
    let sessionRequested = false;
    const session: Session = {
      inputs: [{ name: "magnitude" }],
      outputs: [{ name: "vocals_magnitude" }],
      run: async (feeds) => {
        const input = Object.values(feeds)[0];
        if (!input) throw new Error("Expected a magnitude tensor");
        return { vocals_magnitude: { data: new Float32Array(input.data), dims: [...input.dims] } };
      },
      free: () => {},
    };
    const sessionLoader = async (model: ModelSpec): Promise<Session> => {
      sessionRequested = true;
      expect(String(model)).toContain("huggingface.co/MixDirective/open-unmix-umxhq-vocals-onnx");
      return session;
    };

    const result = await separateVocalsFromPcm(mix, sampleRate, 1, undefined, { sessionLoader });

    expect(sessionRequested).toBe(true);
    expect(result.status).toBe("analyzed");
    expect(result.method).toBe("open_unmix_umxhq_vocal_stem");
  });


  it("converts a returned vocal stem into presence, activity and pitch evidence", async () => {
    const sampleRate = 8000;
    const mix = Float32Array.from({ length: sampleRate * 2 }, (_, i) =>
      0.5 * Math.sin(2 * Math.PI * 220 * i / sampleRate),
    );
    const vocal = Float32Array.from({ length: sampleRate * 2 }, (_, i) =>
      0.25 * Math.sin(2 * Math.PI * 220 * i / sampleRate),
    );
    const separateImpl = async () => ({
      stems: { vocals: [vocal] },
      sampleRate,
      residual: [new Float32Array(mix.length)],
    });
    const result = await separateVocalsFromPcm(mix, sampleRate, 1, undefined, {
      separateImpl: separateImpl as unknown as typeof import("@audio/neural-separate").default,
    });
    expect(result.status).toBe("analyzed");
    expect(result.voicePresence).toBe("likely_present");
    expect(result.pitch.medianHz).toBeGreaterThan(195);
    expect(result.pitch.medianHz).toBeLessThan(245);
  });

  it("returns an explicit unavailable result instead of fabricating vocal measurements when separation fails", async () => {
    const sampleRate = 8000;
    const mix = new Float32Array(sampleRate);
    const result = await separateVocalsFromPcm(mix, sampleRate, 1, undefined, {
      separateImpl: (async () => { throw new Error("model unavailable"); }) as unknown as typeof import("@audio/neural-separate").default,
    });
    expect(result.status).toBe("unavailable");
    expect(result.voicePresence).toBe("uncertain");
    expect(result.reason).toContain("model unavailable");
    expect(result.pitch.medianHz).toBeNull();
  });
});
