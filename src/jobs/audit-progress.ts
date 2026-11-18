export const AUDIT_EVENT_STEP: Readonly<Record<string, number>> = Object.freeze({
  processing_claimed: 0,
  processing_started: 0,
  recognition: 1,
  catalog_ingestion: 1,
  sonic_dna: 2,
  evidence_reconciliation: 3,
  ar_assessment: 4,
  report_generated: 5,
  audit_completed: 5,
});

export interface AuditProgressEvent {
  event_type: string;
  status?: string | null;
}

/** Progress is monotonic: persistence timestamps do not always match stage order. */
export function getAuditProgressStep(
  events: readonly AuditProgressEvent[],
  jobStatus: string,
): number {
  if (jobStatus === "completed") return 5;
  return events.reduce((furthest, event) => {
    const step = AUDIT_EVENT_STEP[event.event_type];
    return typeof step === "number" ? Math.max(furthest, step) : furthest;
  }, 0);
}
