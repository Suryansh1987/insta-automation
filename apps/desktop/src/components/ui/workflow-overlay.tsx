import type React from "react";
import BoxLoader from "./box-loader";
import type { WorkflowStageView } from "./workflow-stage";

interface WorkflowOverlayProps {
  open: boolean;
  title: string;
  subtitle: string;
  targetLabel?: string;
  progressLabel?: string;
  stages: WorkflowStageView[];
}

export default function WorkflowOverlay({
  open,
  title,
  subtitle,
  targetLabel,
  progressLabel,
  stages,
}: WorkflowOverlayProps): React.JSX.Element | null {
  if (!open) return null;

  return (
    <div className="workflow-overlay">
      <div className="workflow-panel">
        <div className="workflow-panel__hero">
          <BoxLoader />
          <div>
            <div className="workflow-panel__eyebrow">Background Workflow</div>
            <h3 className="workflow-panel__title">{title}</h3>
            <p className="workflow-panel__subtitle">{subtitle}</p>
          </div>
        </div>

        <div className="workflow-panel__meta">
          {targetLabel && <span className="workflow-chip">{targetLabel}</span>}
          {progressLabel && <span className="workflow-chip workflow-chip--accent">{progressLabel}</span>}
        </div>

        <div className="workflow-stage-list">
          {stages.map((stage) => (
            <div key={stage.id} className={`workflow-stage workflow-stage--${stage.state}`}>
              <span className="workflow-stage__dot" />
              <div className="workflow-stage__copy">
                <div className="workflow-stage__label">{stage.label}</div>
                <div className="workflow-stage__detail">
                  {stage.detail ?? defaultDetail(stage.state)}
                </div>
              </div>
              <div className="workflow-stage__state">{stateLabel(stage.state)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function stateLabel(state: WorkflowStageView["state"]): string {
  if (state === "active") return "Running";
  if (state === "done") return "Done";
  if (state === "error") return "Issue";
  return "Queued";
}

function defaultDetail(state: WorkflowStageView["state"]): string {
  if (state === "active") return "In progress";
  if (state === "done") return "Completed";
  if (state === "error") return "Needs attention";
  return "Waiting for its turn";
}
