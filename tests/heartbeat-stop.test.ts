import { describe, expect, it } from "vitest";
import { processAuditJob, type AuditProcessorDependencies } from "../src/jobs/process-audit-job.js";

describe("worker heartbeat shutdown ordering", () => {
  it("awaits an in-flight heartbeat shutdown before writing terminal completion", async () => {
    const events: string[] = [];
    let releaseStop!: () => void;
    let signalStopStarted!: () => void;
    const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });
    const stopStarted = new Promise<void>((resolve) => { signalStopStarted = resolve; });

    const deps = {
      getJob: async () => ({
        id: "heartbeat-race-job",
        ownerId: null,
        sourceAudioPath: "fixture/master.wav",
        mimeType: "audio/wav",
        sourceType: "master" as const,
        catalogUrl: null,
        status: "processing" as const,
        claimToken: "11111111-1111-4111-8111-111111111111",
        leaseExpiresAt: "2099-01-01T00:00:00.000Z",
        workerId: "heartbeat-race-test",
      }),
      markProcessing: async () => {},
      collectCatalogMetadata: async () => { throw new Error("not used"); },
      recognizeUrl: async () => ({ matched: false as const }),
      downloadMaster: async () => new Uint8Array([1, 2, 3]),
      createRecognitionSample: async () => new Uint8Array([1, 2]),
      recognize: async () => ({ matched: false as const }),
      saveRecognition: async () => {},
      saveEvidence: async () => {},
      decode: async () => ({ samples: new Float32Array([0, 0.1, -0.1, 0]), sampleRate: 44100, channels: 1 }),
      saveSonicDna: async () => {},
      generateAssessment: async () => ({}),
      saveAssessment: async () => {},
      generateReport: async () => new Uint8Array([37, 80, 68, 70, 45]),
      saveReport: async () => {},
      stopHeartbeat: async () => {
        events.push("heartbeat-stop-started");
        signalStopStarted();
        await stopGate;
        events.push("heartbeat-stopped");
      },
      markCompleted: async () => { events.push("terminal-completion"); },
      markFailed: async () => { events.push("terminal-failure"); },
    } as unknown as AuditProcessorDependencies;

    const processing = processAuditJob("heartbeat-race-job", deps);
    await stopStarted;
    expect(events).toContain("heartbeat-stop-started");
    expect(events).not.toContain("terminal-completion");

    releaseStop();
    await expect(processing).resolves.toEqual({ status: "completed" });
    expect(events).toEqual([
      "heartbeat-stop-started",
      "heartbeat-stopped",
      "terminal-completion",
    ]);
  });
});
