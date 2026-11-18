export type AuditJobStatus = "queued" | "processing" | "completed" | "failed";

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
 * Progress is a high-water mark, not a timestamp ordering.
 * Persistence events can be written after a later logical stage has already
 * completed, so the newest event alone can move the UI backwards.
 */
export function getAuditProgressStepIndex(
  eventTypes: readonly string[],
  status: AuditJobStatus,
): number {
  if (status === "completed") return 5;
  return eventTypes.reduce((furthest, eventType) => Math.max(furthest, EVENT_STEP[eventType] ?? -1), 0);
}
