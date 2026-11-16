import "./EvidenceChainPanel.css";

export interface EvidenceChainPanelProps {
  currentStepIndex: number;
}

interface EvidenceStep {
  number: string;
  title: string;
  description: string;
}

const EVIDENCE_STEPS: readonly EvidenceStep[] = [
  { number: "01", title: "Secure intake", description: "Private master + integrity hash" },
  { number: "02", title: "Recognition", description: "AudD evidence sample" },
  { number: "03", title: "Sonic measurement", description: "Full-master audio analysis" },
  { number: "04", title: "Reconciliation", description: "Identifiers + source evidence" },
  { number: "05", title: "A&R assessment", description: "Evidence-bound interpretation" },
  { number: "06", title: "Report", description: "Song-specific PDF output" },
];

export function EvidenceChainPanel({ currentStepIndex }: EvidenceChainPanelProps) {
  const activeIndex = Math.min(
    Math.max(Number.isFinite(currentStepIndex) ? currentStepIndex : 0, 0),
    EVIDENCE_STEPS.length - 1,
  );

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <p className="kicker">EVIDENCE CHAIN</p>
          <h3>What happens next</h3>
        </div>
        <span className="live-line" aria-hidden="true" />
      </div>

      <ol className="pipeline" aria-label="Audit evidence processing pipeline">
        {EVIDENCE_STEPS.map((step, index) => {
          const isCurrent = index === activeIndex;
          const isCompleted = index < activeIndex;

          return (
            <li
              key={step.number}
              className={[isCurrent && "current", isCompleted && "completed"]
                .filter(Boolean)
                .join(" ")}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span>{step.number}</span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.description}</small>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default EvidenceChainPanel;
