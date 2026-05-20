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

export interface JobState {
  targetRows: TargetRow[];
  sent: number;
  failed: number;
  currentJobId: string | null;
  workflowStages: WorkflowStageSnapshot[];
  workflowTarget: string;
  workerLogs: string[];
  statusText: string;
}

interface AutomationState {
  runningAccounts: Set<string>;
  jobs: Record<string, JobState>;
  lastStartedAccountId: string | null;

  startJob(accountId: string, usernames: string[], jobId: string): void;
  stopJob(accountId: string): void;
  applyWorkerMessage(msg: WorkerMessage): void;
  setProgress(accountId: string, sent: number, failed: number): void;
  clearJob(accountId: string): void;
  getJob(accountId: string): JobState;
  hydrateFromStorage(): void;

  // Legacy compat — derived from lastStartedAccountId's job
  activeRunAccountId: string | null;
  targetRows: TargetRow[];
  sent: number;
  failed: number;
  currentJobId: string | null;
  workflowStages: WorkflowStageSnapshot[];
  workflowTarget: string;
  workerLogs: string[];
  statusText: string;
}

const STORAGE_KEY = "instaflow.automation-session-v2";

export function defaultSendStages(): WorkflowStageSnapshot[] {
  return [
    { id: "init_browser",        label: "Launching browser",       state: "pending" },
    { id: "open_profile",        label: "Opening profile",          state: "pending" },
    { id: "scroll_profile",      label: "Scrolling profile",        state: "pending" },
    { id: "capture_screenshot",  label: "Taking screenshot",        state: "pending" },
    { id: "check_likes",         label: "Checking likes and posts", state: "pending" },
    { id: "check_bio",           label: "Checking description",     state: "pending" },
    { id: "generate_message",    label: "Creating message",         state: "pending" },
    { id: "send_message",        label: "Sending message",          state: "pending" },
    { id: "wait_delay",          label: "Waiting before next message", state: "pending" },
  ];
}

function emptyJob(): JobState {
  return {
    targetRows: [],
    sent: 0,
    failed: 0,
    currentJobId: null,
    workflowStages: defaultSendStages(),
    workflowTarget: "",
    workerLogs: [],
    statusText: "",
  };
}

interface PersistedState {
  jobs: Record<string, Omit<JobState, "workerLogs">>;
  runningAccountIds: string[];
  lastStartedAccountId: string | null;
}

function loadPersisted(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function savePersisted(state: AutomationState): void {
  if (typeof window === "undefined") return;
  const payload: PersistedState = {
    runningAccountIds: [...state.runningAccounts],
    lastStartedAccountId: state.lastStartedAccountId,
    jobs: Object.fromEntries(
      Object.entries(state.jobs).map(([id, job]) => [
        id,
        { ...job, workerLogs: [] },
      ]),
    ),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function updateStage(stages: WorkflowStageSnapshot[], msg: WorkerMessage): WorkflowStageSnapshot[] {
  if (msg.type !== "stage" || !msg.stageId) return stages;
  const next = stages.map((s) =>
    s.id === msg.stageId
      ? { ...s, label: msg.stageLabel ?? s.label, state: msg.stageState ?? s.state, detail: msg.stageDetail ?? s.detail }
      : s,
  );
  if (next.some((s) => s.id === msg.stageId)) return next;
  return [...next, { id: msg.stageId, label: msg.stageLabel ?? msg.stageId, state: msg.stageState ?? "pending", detail: msg.stageDetail }];
}

function legacyFields(jobs: Record<string, JobState>, accountId: string | null) {
  const job = accountId ? (jobs[accountId] ?? emptyJob()) : emptyJob();
  return {
    activeRunAccountId: accountId,
    targetRows: job.targetRows,
    sent: job.sent,
    failed: job.failed,
    currentJobId: job.currentJobId,
    workflowStages: job.workflowStages,
    workflowTarget: job.workflowTarget,
    workerLogs: job.workerLogs,
    statusText: job.statusText,
  };
}

const persisted = loadPersisted();
const initialJobs: Record<string, JobState> = persisted
  ? Object.fromEntries(Object.entries(persisted.jobs).map(([id, j]) => [id, { ...j, workerLogs: [] }]))
  : {};
const initialRunning = new Set<string>(persisted?.runningAccountIds ?? []);
const initialLastId = persisted?.lastStartedAccountId ?? null;

export const useAutomationStore = create<AutomationState>()((set, get) => ({
  runningAccounts: initialRunning,
  jobs: initialJobs,
  lastStartedAccountId: initialLastId,
  ...legacyFields(initialJobs, initialLastId),

  getJob: (accountId) => get().jobs[accountId] ?? emptyJob(),

  startJob: (accountId, usernames, jobId) =>
    set((s) => {
      const newJob: JobState = {
        targetRows: usernames.map((username) => ({ username, status: "pending" })),
        sent: 0,
        failed: 0,
        currentJobId: jobId,
        workflowStages: defaultSendStages(),
        workflowTarget: usernames[0] ?? "",
        workerLogs: [],
        statusText: "Job started. Automation is running.",
      };
      const jobs = { ...s.jobs, [accountId]: newJob };
      const runningAccounts = new Set([...s.runningAccounts, accountId]);
      const next: AutomationState = {
        ...s,
        runningAccounts,
        jobs,
        lastStartedAccountId: accountId,
        ...legacyFields(jobs, accountId),
      };
      savePersisted(next);
      return next;
    }),

  stopJob: (accountId) =>
    set((s) => {
      const running = new Set(s.runningAccounts);
      running.delete(accountId);
      const jobs = {
        ...s.jobs,
        [accountId]: { ...(s.jobs[accountId] ?? emptyJob()), statusText: "Stop signal sent." },
      };
      const next: AutomationState = {
        ...s,
        runningAccounts: running,
        jobs,
        ...legacyFields(jobs, s.lastStartedAccountId),
      };
      savePersisted(next);
      return next;
    }),

  applyWorkerMessage: (msg) =>
    set((s) => {
      // Determine which account this message belongs to
      const accountId: string | null =
        (msg as any).accountId ?? s.lastStartedAccountId;
      if (!accountId) return s;

      const current = s.jobs[accountId] ?? emptyJob();
      let updated = { ...current };

      if (msg.type === "log" && msg.message) {
        const ts = new Date().toISOString().slice(11, 19);
        const prefix = msg.level === "error" ? "[ERR]" : msg.level === "warn" ? "[WRN]" : "[INF]";
        updated = { ...updated, workerLogs: [...updated.workerLogs.slice(-49), `${ts} ${prefix} ${msg.message}`] };
      }

      if (msg.type === "progress") {
        updated = { ...updated, sent: msg.sent ?? updated.sent, failed: msg.failed ?? updated.failed };
      }

      if (msg.type === "message_sent" && msg.username) {
        const isSending = msg.messageStatus === "sending";
        updated = {
          ...updated,
          targetRows: updated.targetRows.map((row) =>
            row.username === msg.username
              ? { ...row, status: (msg.messageStatus as TargetStatus) ?? row.status, messageSent: msg.messageSent ?? row.messageSent }
              : row,
          ),
          ...(isSending ? { workflowStages: defaultSendStages(), workflowTarget: msg.username } : {}),
        };
      }

      if (msg.type === "stage" && msg.workflow === "send") {
        updated = {
          ...updated,
          workflowStages: updateStage(updated.workflowStages, msg),
          workflowTarget: msg.stageUsername ?? updated.workflowTarget,
        };
      }

      if (msg.type === "status" && (msg.status === "done" || msg.status === "stopped" || msg.status === "error")) {
        const running = new Set(s.runningAccounts);
        running.delete(accountId);
        updated = {
          ...updated,
          statusText: `Job ${msg.status}. Sent: ${msg.sent ?? updated.sent}, Failed: ${msg.failed ?? updated.failed}`,
        };
        const jobs = { ...s.jobs, [accountId]: updated };
        const next: AutomationState = {
          ...s,
          runningAccounts: running,
          jobs,
          sent: msg.sent ?? updated.sent,
          failed: msg.failed ?? updated.failed,
          ...legacyFields(jobs, s.lastStartedAccountId),
        };
        savePersisted(next);
        return next;
      }

      const jobs = { ...s.jobs, [accountId]: updated };
      const next: AutomationState = {
        ...s,
        jobs,
        ...legacyFields(jobs, s.lastStartedAccountId),
      };
      savePersisted(next);
      return next;
    }),

  setProgress: (accountId, sent, failed) =>
    set((s) => {
      const job = { ...(s.jobs[accountId] ?? emptyJob()), sent, failed };
      const jobs = { ...s.jobs, [accountId]: job };
      const next: AutomationState = {
        ...s,
        jobs,
        ...legacyFields(jobs, s.lastStartedAccountId),
      };
      savePersisted(next);
      return next;
    }),

  clearJob: (accountId) =>
    set((s) => {
      const running = new Set(s.runningAccounts);
      running.delete(accountId);
      const jobs = { ...s.jobs, [accountId]: emptyJob() };
      const next: AutomationState = {
        ...s,
        runningAccounts: running,
        jobs,
        ...legacyFields(jobs, s.lastStartedAccountId),
      };
      savePersisted(next);
      return next;
    }),

  hydrateFromStorage: () =>
    set((s) => {
      const p = loadPersisted();
      if (!p) return s;
      const jobs = Object.fromEntries(Object.entries(p.jobs).map(([id, j]) => [id, { ...j, workerLogs: [] }]));
      const runningAccounts = new Set<string>(p.runningAccountIds ?? []);
      return {
        ...s,
        runningAccounts,
        jobs,
        lastStartedAccountId: p.lastStartedAccountId,
        ...legacyFields(jobs, p.lastStartedAccountId),
      };
    }),
}));
