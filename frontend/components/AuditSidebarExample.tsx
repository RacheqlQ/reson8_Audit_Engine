import { useEffect, useState } from "react";
import EvidenceChainPanel from "./EvidenceChainPanel";

type AuditPipelineStep =
  | "secure_intake"
  | "recognition"
  | "sonic_measurement"
  | "reconciliation"
  | "ar_assessment"
  | "report";

interface AuditStatusPayload {
  jobId: string;
  status: "queued" | "processing" | "completed" | "failed";
  currentStepIndex?: number;
}

const STEP_INDEX: Record<AuditPipelineStep, number> = {
  secure_intake: 0,
  recognition: 1,
  sonic_measurement: 2,
  reconciliation: 3,
  ar_assessment: 4,
  report: 5,
};

export function AuditSidebar({ jobId }: { jobId: string }) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const response = await fetch(`/v1/audits/${encodeURIComponent(jobId)}`);
        if (!response.ok) throw new Error("Unable to read audit status");

        const payload = (await response.json()) as AuditStatusPayload;

        if (!stopped) {
          setCurrentStepIndex(
            payload.currentStepIndex ??
              (payload.status === "completed" ? STEP_INDEX.report : 0),
          );
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, 2500);
      }
    }

    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return <EvidenceChainPanel currentStepIndex={currentStepIndex} />;
}
