export interface AuditProgressEvent {
  event_type: string;
}

export interface AuditProgressStage {
  id: string;
  label: string;
  percent: number;
  status: "completed" | "in_progress" | "pending" | "failed" | "not_applicable";
}

export interface AuditProgressSnapshot {
  overallPercent: number;
  completedStages: number;
  totalStages: number;
  stages: AuditProgressStage[];
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
  audit_completed: 6,
};

/**
 * Progress represents the furthest completed stage, not the newest event.
 * Persistence may legitimately append events with close timestamps; the UI
 * must derive its state from durable stage events, never event recency alone.
 */
export function getAuditProgressStep(
  events: readonly AuditProgressEvent[],
  status: string,
): number {
  let furthestStep = status === "completed" ? 6 : 0;
  for (const event of events) {
    const step = EVENT_STEP[event.event_type];
    if (typeof step === "number" && step > furthestStep) furthestStep = step;
  }
  return Math.min(furthestStep, 5);
}

export function getAuditProgress(
  events: readonly AuditProgressEvent[],
  jobStatus: string,
  sourceType: string | null | undefined,
): AuditProgressSnapshot {
  const eventTypes = new Set(events.map((event) => event.event_type));
  const reportCount = events.filter((event) => event.event_type === "report_generated").length;
  const sonicNotApplicable = sourceType === "catalog" || sourceType === "dsp_link";
  const complete = (id: string) => {
    switch (id) {
      case "intake": return true;
      case "recognition": return eventTypes.has("recognition") || eventTypes.has("catalog_ingestion");
      case "sonic_dna": return sonicNotApplicable || eventTypes.has("sonic_dna");
      case "reconciliation": return eventTypes.has("evidence_reconciliation");
      case "assessment": return eventTypes.has("ar_assessment");
      case "report": return reportCount >= 2;
      case "finalization": return eventTypes.has("audit_completed") || jobStatus === "completed";
      default: return false;
    }
  };

  const definitions = [
    { id: "intake", label: "Secure intake" },
    { id: "recognition", label: "Recognition" },
    { id: "sonic_dna", label: "Sonic measurement" },
    { id: "reconciliation", label: "Reconciliation" },
    { id: "assessment", label: "A&R assessment" },
    { id: "report", label: "PDF reports" },
    { id: "finalization", label: "Audit finalization" },
  ];

  let activeAssigned = false;
  const failed = jobStatus === "failed" || eventTypes.has("audit_failed");
  const stages: AuditProgressStage[] = definitions.map((definition) => {
    const notApplicable = definition.id === "sonic_dna" && sonicNotApplicable;
    const isComplete = complete(definition.id);
    if (notApplicable) {
      return { ...definition, percent: 100, status: "not_applicable" };
    }
    if (isComplete) {
      return { ...definition, percent: 100, status: "completed" };
    }
    if (!activeAssigned && failed) {
      activeAssigned = true;
      return { ...definition, percent: 0, status: "failed" };
    }
    if (!activeAssigned && jobStatus === "processing") {
      activeAssigned = true;
      return { ...definition, percent: 0, status: "in_progress" };
    }
    return { ...definition, percent: 0, status: "pending" };
  });

  const completedStages = stages.filter((stage) => stage.percent === 100).length;
  const overallPercent = Math.round(
    (stages.reduce((sum, stage) => sum + stage.percent, 0) / stages.length) * 10,
  ) / 10;

  return { overallPercent, completedStages, totalStages: stages.length, stages };
}
