export interface AuditProgressEvent {
  event_type: string;
}

const EVENT_STEP: Readonly<Record<string, number>> = {
  processing_claimed: 0,
  processing_started: 0,
  recognition: 1,
  catalog_ingestion: 1,
  sonic_dna: 2,
  evidence_reconciliation: 3,
  ar_assessment: 4,
  report_generated: 5,
  audit_completed: 5,
};

/**
 * Progress represents the furthest completed stage, not the newest event.
 * Persistence may legitimately append a Sonic DNA enrichment after
 * reconciliation; chronological recency must never move the UI backwards.
 */
export function getAuditProgressStep(
  events: readonly AuditProgressEvent[],
  status: string,
): number {
  let furthestStep = status === "completed" ? 5 : 0;
  for (const event of events) {
    const step = EVENT_STEP[event.event_type];
    if (typeof step === "number" && step > furthestStep) furthestStep = step;
  }
  return furthestStep;
}
