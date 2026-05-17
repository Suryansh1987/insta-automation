import { create } from "zustand";
import type { WorkerMessage, WorkerStageState } from "@insta-saas/shared";

export type TargetStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export interface TargetRow {
  username: string;
  status: TargetStatus;
  messageSent?: string;
}

export interface WorkflowStageSnapshot {
  id: string;
  label: string;
  state: WorkerStageState;
  detail?: string;
}

interface PersistedAutomationState {
  activeRunAccountId: string | null;
  targetRows: TargetRow[];
  sent: number;
  failed: number;
  statusText: string;
  currentJobId: string | null;
  workflowStages: WorkflowStageSnapshot[];
  workflowTarget: string;
}

interface AutomationState extends PersistedAutomationState {
  runningAccounts: Set<string>;
  startJob: (accountId: string, usernames: string[], jobId: string) => void;
  stopJob: (accountId: string) => void;
  applyWorkerMessage: (msg: WorkerMessage) => void;
  setProgress: (sent: number, failed: number) => void;
  clearJob: () => void;
  hydrateFromStorage: () => void;
}

const STORAGE_KEY = "instaflow.automation-session";

function defaultSendStages(): WorkflowStageSnapshot[] {
  return [
    { id: "open_profile", label: "Opening profile", state: "pending" },
    { id: "scroll_profile", label: "Scrolling profile", state: "pending" },
    { id: "capture_screenshot", label: "Taking screenshot", state: "pending" },
    { id: "check_likes", label: "Checking likes and posts", state: "pending" },
    { id: "check_bio", label: "Checking description", state: "pending" },
    { id: "generate_message", label: "Creating message", state: "pending" },
    { id: "send_message", label: "Sending message", state: "pending" },
  ];
}

function loadPersistedState(): PersistedAutomationState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedAutomationState;
  } catch {
    return null;
  }
}

function persistState(state: AutomationState): void {
  if (typeof window === "undefined") return;
  const payload: PersistedAutomationState = {
    activeRunAccountId: state.activeRunAccountId,
    targetRows: state.targetRows,
    sent: state.sent,
    failed: state.failed,
    statusText: state.statusText,
    currentJobId: state.currentJobId,
    workflowStages: state.workflowStages,
    workflowTarget: state.workflowTarget,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function updateStage(
  stages: WorkflowStageSnapshot[],
  msg: WorkerMessage,
): WorkflowStageSnapshot[] {
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

const initialPersisted = loadPersistedState();

export const useAutomationStore = create<AutomationState>()((set, get) => ({
  runningAccounts: new Set(initialPersisted?.activeRunAccountId ? [initialPersisted.activeRunAccountId] : []),
  activeRunAccountId: initialPersisted?.activeRunAccountId ?? null,
  targetRows: initialPersisted?.targetRows ?? [],
  sent: initialPersisted?.sent ?? 0,
  failed: initialPersisted?.failed ?? 0,
  statusText: initialPersisted?.statusText ?? "",
  currentJobId: initialPersisted?.currentJobId ?? null,
  workflowStages: initialPersisted?.workflowStages ?? defaultSendStages(),
  workflowTarget: initialPersisted?.workflowTarget ?? "",

  startJob: (accountId, usernames, jobId) =>
    set((s) => {
      const nextState: AutomationState = {
        ...s,
        runningAccounts: new Set([...s.runningAccounts, accountId]),
        activeRunAccountId: accountId,
        targetRows: usernames.map((username) => ({ username, status: "pending" as TargetStatus })),
        sent: 0,
        failed: 0,
        currentJobId: jobId,
        statusText: "Job started. Headless automation is running in the background.",
        workflowStages: defaultSendStages(),
        workflowTarget: usernames[0] ?? "",
      };
      persistState(nextState);
      return nextState;
    }),

  stopJob: (accountId) =>
    set((s) => {
      const next = new Set(s.runningAccounts);
      next.delete(accountId);
      const nextState: AutomationState = {
        ...s,
        runningAccounts: next,
        statusText: "Stop signal sent.",
      };
      persistState(nextState);
      return nextState;
    }),

  applyWorkerMessage: (msg) =>
    set((s) => {
      let nextState: AutomationState = s;

      if (msg.type === "progress") {
        nextState = { ...nextState, sent: msg.sent ?? s.sent, failed: msg.failed ?? s.failed };
      }

      if (msg.type === "message_sent" && msg.username) {
        nextState = {
          ...nextState,
          targetRows: nextState.targetRows.map((row) =>
            row.username === msg.username
              ? {
                  ...row,
                  status: (msg.messageStatus as TargetStatus) ?? row.status,
                  messageSent: msg.messageSent ?? row.messageSent,
                }
              : row,
          ),
        };
      }

      if (msg.type === "stage" && msg.workflow === "send") {
        nextState = {
          ...nextState,
          workflowStages: updateStage(nextState.workflowStages, msg),
          workflowTarget: msg.stageUsername ?? nextState.workflowTarget,
        };
      }

      if (
        msg.type === "status" &&
        (msg.status === "done" || msg.status === "stopped" || msg.status === "error")
      ) {
        const next = new Set(nextState.runningAccounts);
        next.delete(msg.accountId);
        nextState = {
          ...nextState,
          runningAccounts: next,
          sent: msg.sent ?? nextState.sent,
          failed: msg.failed ?? nextState.failed,
          statusText: `Job ${msg.status}. Sent: ${msg.sent ?? nextState.sent}, Failed: ${msg.failed ?? nextState.failed}`,
        };
      }

      persistState(nextState);
      return nextState;
    }),

  setProgress: (sent, failed) =>
    set((s) => {
      const nextState = { ...s, sent, failed };
      persistState(nextState);
      return nextState;
    }),

  clearJob: () =>
    set((s) => {
      const nextState: AutomationState = {
        ...s,
        runningAccounts: new Set(),
        activeRunAccountId: null,
        targetRows: [],
        sent: 0,
        failed: 0,
        statusText: "",
        currentJobId: null,
        workflowStages: defaultSendStages(),
        workflowTarget: "",
      };
      persistState(nextState);
      return nextState;
    }),

  hydrateFromStorage: () =>
    set((s) => {
      const persisted = loadPersistedState();
      if (!persisted) return s;
      return {
        ...s,
        activeRunAccountId: persisted.activeRunAccountId,
        runningAccounts: new Set(persisted.activeRunAccountId ? [persisted.activeRunAccountId] : []),
        targetRows: persisted.targetRows,
        sent: persisted.sent,
        failed: persisted.failed,
        statusText: persisted.statusText,
        currentJobId: persisted.currentJobId,
        workflowStages: persisted.workflowStages.length > 0 ? persisted.workflowStages : defaultSendStages(),
        workflowTarget: persisted.workflowTarget,
      };
    }),
}));
