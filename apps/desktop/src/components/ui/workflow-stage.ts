import type { WorkerMessage, WorkerStageState, WorkerWorkflow } from "@insta-saas/shared";

export interface WorkflowStageView {
  id: string;
  label: string;
  state: WorkerStageState;
  detail?: string;
}

const SEND_TEMPLATE: WorkflowStageView[] = [
  { id: "open_profile", label: "Opening profile", state: "pending" },
  { id: "scroll_profile", label: "Scrolling profile", state: "pending" },
  { id: "capture_screenshot", label: "Taking screenshot", state: "pending" },
  { id: "check_likes", label: "Checking likes and posts", state: "pending" },
  { id: "check_bio", label: "Checking description", state: "pending" },
  { id: "generate_message", label: "Creating message", state: "pending" },
  { id: "send_message", label: "Sending message", state: "pending" },
];

const ANALYZE_TEMPLATE: WorkflowStageView[] = [
  { id: "open_profile", label: "Opening profile", state: "pending" },
  { id: "open_thread", label: "Opening chat", state: "pending" },
  { id: "read_conversation", label: "Reading conversation", state: "pending" },
  { id: "check_seen", label: "Checking seen status", state: "pending" },
  { id: "check_reply", label: "Checking reply", state: "pending" },
  { id: "save_result", label: "Saving result", state: "pending" },
];

export function createWorkflowStages(workflow: WorkerWorkflow): WorkflowStageView[] {
  const template = workflow === "analyze" ? ANALYZE_TEMPLATE : SEND_TEMPLATE;
  return template.map((stage) => ({ ...stage }));
}

export function applyStageMessage(
  stages: WorkflowStageView[],
  msg: WorkerMessage,
): WorkflowStageView[] {
  if (msg.type !== "stage" || !msg.stageId) return stages;

  const next = stages.map((stage) =>
    stage.id === msg.stageId
      ? {
          ...stage,
          label: msg.stageLabel ?? stage.label,
          state: msg.stageState ?? stage.state,
          detail: msg.stageDetail ?? stage.detail,
        }
      : stage,
  );

  if (next.some((stage) => stage.id === msg.stageId)) return next;

  return [
    ...next,
    {
      id: msg.stageId,
      label: msg.stageLabel ?? msg.stageId,
      state: msg.stageState ?? "pending",
      detail: msg.stageDetail,
    },
  ];
}
