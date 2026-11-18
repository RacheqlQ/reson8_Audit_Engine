export interface AuditProgressEvent {
  event_type: string;
}

const STEP_BY_EVENT: Readonly<Record<string, number>> = {
  processing_claimed: 0,
  processing_started: 0,
  recognition: 1,
  catalog_ingestion: 1,
  sonic_dna: 2,
  evidence_reconciliation: 3,
  ar_assessment_started: 4,
  ar_assessment: 4,
  groq_section_completed: 4,
  report_generation_started: 5,
  report_generated: 5,
  audit_completed: 5,
};

/**
 * Progress is monotonic: persisted events may arrive out of order relative to
 * the user-facing stages, and auxiliary events must not reset the indicator.
 */
export function currentAuditStepIndex(events: readonly AuditProgressEvent[]): number {
  return events.reduce((highest, event) => {
    const step = STEP_BY_EVENT[event.event_type];
    return step === undefined ? highest : Math.max(highest, step);
  }, 0);
}
