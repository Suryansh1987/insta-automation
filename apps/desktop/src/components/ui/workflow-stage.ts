import type { WorkerMessage, WorkerStageState, WorkerWorkflow } from "@insta-saas/shared";

export interface WorkflowStageView {
  id: string;
  label: string;
  state: WorkerStageState;
  detail?: string;
}

const SEND_TEMPLATE: WorkflowStageView[] = [
  { id: "open_profile", label: "Opening their profile", state: "pending" },
  { id: "scroll_profile", label: "Looking through their profile", state: "pending" },
  { id: "capture_screenshot", label: "Saving profile details", state: "pending" },
  { id: "check_likes", label: "Reading posts and likes", state: "pending" },
  { id: "check_bio", label: "Reading bio", state: "pending" },
  { id: "generate_message", label: "Writing your message", state: "pending" },
  { id: "send_message", label: "Sending your message", state: "pending" },
];

const ANALYZE_TEMPLATE: WorkflowStageView[] = [
  { id: "open_profile", label: "Opening their profile", state: "pending" },
  { id: "open_thread", label: "Opening the chat", state: "pending" },
  { id: "read_conversation", label: "Reading the chat", state: "pending" },
  { id: "check_seen", label: "Checking if they saw it", state: "pending" },
  { id: "check_reply", label: "Checking if they replied", state: "pending" },
  { id: "save_result", label: "Saving the update", state: "pending" },
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
