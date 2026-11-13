import { describe, expect, it } from "vitest";
import { createAudioDecoder } from "../src/audio/decoder.js";
import { createRecognitionSample } from "../src/audio/recognition-sample.js";

describe("audio task cancellation", () => {
  it("passes the abort signal to the injected audio decoder and settles on abort", async () => {
    const controller = new AbortController();
    const reason = new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT");
    let receivedSignal: AbortSignal | undefined;
    const decoder = createAudioDecoder((_bytes, signal) => {
      receivedSignal = signal;
      return new Promise<Float32Array>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    const pending = decoder.decode(new Uint8Array([1, 2, 3]), controller.signal);
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(receivedSignal).toBe(controller.signal);
  });

  it("passes the abort signal to recognition-sample extraction and settles on abort", async () => {
    const controller = new AbortController();
    const reason = new Error("AUDIT_SHUTDOWN_DRAIN_TIMEOUT");
    let receivedSignal: AbortSignal | undefined;
    const pending = createRecognitionSample(
      new Uint8Array([1, 2, 3]),
      "audio/wav",
      (_args, signal) => {
        receivedSignal = signal;
        return new Promise<Uint8Array>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      controller.signal,
    );
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(receivedSignal).toBe(controller.signal);
  });
});
