import { useEffect, useRef, useState } from "react";
import api from "../api/client";
import { useAuth } from "@clerk/clerk-react";
import { useAutomationStore } from "../store/automation";
import { toast } from "../store/toast";
import type { IgAccount, WorkerStartCmd } from "@insta-saas/shared";

const SERVER_URL = ((import.meta.env.VITE_BACKEND_URL as string) ?? "http://localhost:3001").replace(/\/$/, "");

function Skeleton({ w, h, radius = 5 }: { w: string | number; h: number; radius?: number }) {
  return (
    <div
      className="animate-skpulse bg-canvas shrink-0"
      style={{ width: w, height: h, borderRadius: radius }}
    />
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-3.5 h-3.5 rounded-full border-2 animate-spin-fast shrink-0"
      style={{ borderColor: "rgba(10,10,10,0.3)", borderTopColor: "#0A0A0A" }}
    />
  );
}

type FormConfig = { message: string; targets: string; minDelaySec: number; maxDelaySec: number };
const defaultForm = (): FormConfig => ({ message: "", targets: "", minDelaySec: 20, maxDelaySec: 60 });

export default function Automation() {
  const { getToken } = useAuth();
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [formConfigs, setFormConfigs] = useState<Record<string, FormConfig>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState<Record<string, boolean>>({});

  const { runningAccounts, getJob, startJob, stopJob, clearJob, hydrateFromStorage } = useAutomationStore();

  useEffect(() => {
    hydrateFromStorage();
    api.get<{ accounts: IgAccount[] }>("/accounts").then((r) => {
      setAccounts(r.data.accounts);
      r.data.accounts.forEach((a) => {
        const storeRunning = useAutomationStore.getState().runningAccounts.has(a.id);
        if (!storeRunning) return;
        // Reconcile: clear if neither the worker nor the DB thinks this job is running
        Promise.all([
          window.worker?.isRunning(a.id).then(({ running }) => running).catch(() => false),
          (async () => {
            const jobId = useAutomationStore.getState().jobs[a.id]?.currentJobId;
            if (!jobId) return false;
            try {
              const { data } = await api.get<{ job: { status: string } }>(`/automation/status/${jobId}`);
              return data.job.status === "running";
            } catch {
              return false;
            }
          })(),
        ]).then(([workerRunning, dbRunning]) => {
          if (!workerRunning && !dbRunning) clearJob(a.id);
        });
      });
    }).finally(() => setLoadingAccounts(false));
  }, [hydrateFromStorage, clearJob]);

  useEffect(() => {
    if (runningAccounts.size === 0) return;
    const iv = setInterval(async () => {
      for (const accountId of runningAccounts) {
        const job = getJob(accountId);
        if (!job.currentJobId) continue;
        try {
          const { data } = await api.get<{ job: { sent: number; failed: number } }>(`/automation/status/${job.currentJobId}`);
          useAutomationStore.getState().setProgress(accountId, data.job.sent, data.job.failed);
        } catch { /* ignore */ }
      }
    }, 10_000);
    return () => clearInterval(iv);
  }, [runningAccounts, getJob]);

  function patchForm(accountId: string, patch: Partial<FormConfig>) {
    setFormConfigs((p) => ({ ...p, [accountId]: { ...defaultForm(), ...p[accountId], ...patch } }));
  }

  function setErr(accountId: string, msg: string) { setErrors((p) => ({ ...p, [accountId]: msg })); }
  function clearErr(accountId: string) { setErrors((p) => { const n = { ...p }; delete n[accountId]; return n; }); }

  function parseTargets(raw: string) {
    return raw.split(/[\n,]+/).map((t) => t.trim().replace(/^@/, "")).filter(Boolean).map((u) => ({ username: u }));
  }

  async function handleStart(account: IgAccount) {
    if (account.status !== "active") {
      toast.warning(`@${account.username} is not logged in. Go to Accounts and click Login first.`);
      return;
    }
    const cfg = { ...defaultForm(), ...formConfigs[account.id] };
    clearErr(account.id);
    if (!cfg.message.trim()) return setErr(account.id, "Enter a default message.");
    const targetList = parseTargets(cfg.targets);
    if (targetList.length === 0) return setErr(account.id, "Enter at least one target username.");
    setStarting((p) => ({ ...p, [account.id]: true }));
    try {
      const token = await getToken({ skipCache: true });
      if (!token) { setErr(account.id, "Not authenticated."); return; }
      const { data: jobData } = await api.post<{ job: { id: string } }>("/automation/start", {
        igAccountId: account.id, targets: targetList,
        defaultMessage: cfg.message.trim(),
        minDelayMs: cfg.minDelaySec * 1000, maxDelayMs: cfg.maxDelaySec * 1000,
      });
      const cmd: WorkerStartCmd = {
        cmd: "start", accountId: account.id, jobId: jobData.job.id,
        sessionDir: `./sessions/${account.id}`, serverUrl: SERVER_URL, authToken: token,
        targets: targetList, defaultMessage: cfg.message.trim(),
        minDelayMs: cfg.minDelaySec * 1000, maxDelayMs: cfg.maxDelaySec * 1000,
      };
      startJob(account.id, targetList.map((t) => t.username), jobData.job.id);
      const result = await window.worker.start(cmd);
      if (result.error) { stopJob(account.id); setErr(account.id, result.error); }
    } catch (err: any) {
      setErr(account.id, err.response?.data?.error ?? err.message ?? "Failed to start job.");
    } finally {
      setStarting((p) => ({ ...p, [account.id]: false }));
    }
  }

  async function handleStop(accountId: string) {
    // Always clean up local state — API may say "no job running" if it already finished
    try {
      await api.post(`/automation/stop/${accountId}`);
    } catch {
      // Ignore — job may have already ended in DB
    }
    try {
      await window.worker.stop(accountId);
    } catch {
      // Ignore — worker may have already exited
    }
    stopJob(accountId);
  }

  async function handleForceKill(accountId: string) {
    clearErr(accountId);
    await window.worker.kill(accountId);
    clearJob(accountId);
  }

  return (
    <div className="p-7 max-w-[1120px] mx-auto">

      {/* Header */}
      <div className="mb-6">
        <h1 className="m-0 mb-1 font-display text-[20px] font-bold text-fg tracking-tight">Automation</h1>
        <div className="flex items-center gap-2.5 text-[13px] text-fg-3">
          {loadingAccounts ? <Skeleton w={160} h={14} /> : (
            <>
              <span>{accounts.length} account{accounts.length !== 1 ? "s" : ""}</span>
              <span style={{ color: "var(--line-hi)" }}>·</span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: runningAccounts.size > 0 ? "var(--positive)" : "var(--fg-4)" }}
                />
                {runningAccounts.size} job{runningAccounts.size !== 1 ? "s" : ""} running
              </span>
            </>
          )}
        </div>
      </div>

      {/* Account cards */}
      {loadingAccounts ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))" }}>
          {[0, 1].map((i) => (
            <div key={i} className={CARD}>
              <div className="flex justify-between items-center mb-5">
                <div className="flex items-center gap-2.5">
                  <Skeleton w={36} h={36} radius={99} />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton w={110} h={14} />
                    <Skeleton w={70} h={11} />
                  </div>
                </div>
                <Skeleton w={58} h={22} radius={99} />
              </div>
              <Skeleton w="100%" h={72} radius={4} />
              <div className="mt-3"><Skeleton w="100%" h={100} radius={4} /></div>
              <div className="mt-3 flex gap-2">
                <Skeleton w={80} h={38} radius={4} />
                <Skeleton w={80} h={38} radius={4} />
              </div>
              <div className="mt-3.5"><Skeleton w="100%" h={38} radius={4} /></div>
            </div>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className={`${CARD} text-center py-14`}>
          <div className="text-4xl mb-3.5 opacity-40">◎</div>
          <p className="m-0 mb-1.5 font-bold text-[15px] text-fg">No accounts connected</p>
          <p className="m-0 text-[13px] text-fg-3">Go to <strong>Accounts</strong> to connect an Instagram account first.</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))" }}>
          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              isRunning={runningAccounts.has(account.id)}
              isStarting={!!starting[account.id]}
              job={getJob(account.id)}
              formConfig={{ ...defaultForm(), ...formConfigs[account.id] }}
              error={errors[account.id] ?? ""}
              onPatchForm={(patch) => patchForm(account.id, patch)}
              onStart={() => handleStart(account)}
              onStop={() => handleStop(account.id)}
              onForceKill={() => handleForceKill(account.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Account card ──────────────────────────────────────────────────────────────
interface AccountCardProps {
  account: IgAccount;
  isRunning: boolean;
  isStarting: boolean;
  job: ReturnType<ReturnType<typeof useAutomationStore.getState>["getJob"]>;
  formConfig: FormConfig;
  error: string;
  onPatchForm(patch: Partial<FormConfig>): void;
  onStart(): void;
  onStop(): void;
  onForceKill(): void;
}

function AccountCard({ account, isRunning, isStarting, job, formConfig, error, onPatchForm, onStart, onStop, onForceKill }: AccountCardProps) {
  const tableRef = useRef<HTMLDivElement>(null);
  const total = job.targetRows.length;
  const pct = total > 0 ? ((job.sent + job.failed) / total) * 100 : 0;
  const remaining = total - job.sent - job.failed;
  const targetCount = formConfig.targets.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean).length;
  const initials = account.username.slice(0, 2).toUpperCase();

  useEffect(() => {
    const row = job.targetRows.find((r) => r.status === "sending");
    if (!row) return;
    tableRef.current?.querySelector<HTMLElement>(`[data-u="${row.username}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [job.targetRows]);

  return (
    <div
      className={`${CARD} transition-all duration-200`}
      style={{
        borderColor:  isRunning ? "var(--accent-line)"   : "var(--line-hi)",
        boxShadow:    isRunning ? "4px 4px 0 0 rgba(168,232,64,0.18)" : "4px 4px 0 0 rgba(250,250,247,0.10)",
      }}
    >
      {/* Account header */}
      <div className="flex justify-between items-start mb-5">
        <div className="flex items-center gap-2.5">
          <div
            className="w-[38px] h-[38px] rounded-full shrink-0 flex items-center justify-center font-display font-extrabold text-[13px] border-2"
            style={{
              background:   isRunning ? "var(--accent-soft)" : "var(--bg-canvas)",
              borderColor:  isRunning ? "var(--accent-line)" : "var(--line-hi)",
              color:        isRunning ? "var(--accent)"      : "var(--fg-3)",
            }}
          >
            {initials}
          </div>
          <div>
            <div className="font-display font-bold text-[15px] text-fg leading-tight">
              @{account.username}
            </div>
            {job.statusText && (
              <div className="text-[11px] mt-0.5" style={{ color: isRunning ? "var(--accent)" : "var(--fg-4)" }}>
                {job.statusText}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isRunning && (
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
              style={{ background: "var(--positive)" }}
            />
          )}
          <span
            className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-[0.07em] border"
            style={{
              background:  isRunning ? "var(--accent-soft)" : "var(--bg-canvas)",
              color:       isRunning ? "var(--accent)"      : "var(--fg-4)",
              borderColor: isRunning ? "var(--accent-line)" : "var(--line)",
            }}
          >
            {isStarting ? "STARTING" : isRunning ? "RUNNING" : "IDLE"}
          </span>
        </div>
      </div>

      {/* Running view */}
      {(isRunning || isStarting) && (
        <>
          {isStarting && !isRunning ? (
            <div className="flex items-center gap-2.5 px-4 py-3.5 bg-canvas rounded border-2 border-line mb-4">
              <Spinner />
              <span className="text-[13px] text-fg-2">Launching worker and creating job…</span>
            </div>
          ) : total > 0 ? (
            <div className="mb-4">
              <div className="flex justify-between items-center text-xs mb-1.5">
                <div className="text-fg-3">
                  <span className="font-bold" style={{ color: "var(--positive)" }}>{job.sent}</span> sent ·{" "}
                  <span className="font-bold" style={{ color: "var(--warning)" }}>{job.failed}</span> failed ·{" "}
                  <span className="font-bold text-fg-2">{remaining}</span> remaining
                </div>
                <span className="font-bold text-fg-2 text-xs">{Math.round(pct)}%</span>
              </div>
              <div className="h-1 rounded-full bg-canvas overflow-hidden mb-3">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-in-out"
                  style={{ width: `${pct}%`, background: "var(--accent)" }}
                />
              </div>
              {job.workflowTarget && (
                <div className="text-xs text-fg-3 mb-2.5">
                  <span style={{ color: "var(--accent)" }}>●</span>{" "}
                  Processing <strong className="text-fg-2">@{job.workflowTarget}</strong>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-4 py-3 bg-canvas rounded border-2 border-line mb-4">
              <Spinner />
              <span className="text-[13px] text-fg-3">Initializing automation…</span>
            </div>
          )}

          {/* Workflow stages */}
          {job.workflowStages.some((s) => s.state !== "pending") && (
            <div className="flex flex-col gap-1 mb-3">
              {job.workflowStages.map((stage) => (
                <div key={stage.id} className={`workflow-stage workflow-stage--${stage.state}`}>
                  <span className="workflow-stage__dot" />
                  <div>
                    <div className="workflow-stage__label">{stage.label}</div>
                    {stage.detail && <div className="workflow-stage__detail">{stage.detail}</div>}
                  </div>
                  <div className="workflow-stage__state">{stageLabel(stage.state)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Worker logs */}
          {job.workerLogs.length > 0 && (
            <div
              className="rounded px-3 py-2 max-h-[90px] overflow-y-auto mb-3.5 font-mono"
              style={{ background: "rgba(0,0,0,0.22)" }}
            >
              {job.workerLogs.slice(-5).map((line, i) => (
                <div
                  key={i}
                  className="text-[11px] leading-relaxed"
                  style={{
                    color: line.includes("[ERR]") ? "var(--warning)"
                         : line.includes("[WRN]") ? "var(--warning)"
                         : "var(--fg-3)",
                  }}
                >
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* Target table */}
          {job.targetRows.length > 0 && (
            <div
              ref={tableRef}
              className="max-h-[190px] overflow-y-auto mb-3.5 border-2 border-line rounded overflow-hidden"
            >
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b bg-canvas" style={{ borderColor: "var(--line-hi)" }}>
                    {["Username", "Status", "Message sent"].map((h) => (
                      <th key={h} className="px-2.5 py-1.5 text-left text-[10px] font-bold text-fg-4 uppercase tracking-[0.06em] whitespace-nowrap font-mono">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {job.targetRows.map((row) => (
                    <tr
                      key={row.username}
                      data-u={row.username}
                      className="transition-colors duration-200"
                      style={{
                        borderBottom: "1px solid var(--line)",
                        background: row.status === "sending" ? "var(--accent-soft)" : "transparent",
                      }}
                    >
                      <td className="px-2.5 py-1.5 text-fg whitespace-nowrap" style={{ fontWeight: row.status === "sending" ? 700 : 400 }}>
                        @{row.username}
                      </td>
                      <td className="px-2.5 py-1.5"><StatusBadge status={row.status} /></td>
                      <td className="px-2.5 py-1.5 text-fg-3 max-w-[170px] overflow-hidden text-ellipsis whitespace-nowrap">
                        {row.messageSent ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Idle form */}
      {!isRunning && !isStarting && (
        <>
          <div className="mb-3.5">
            <label className={LBL}>
              Default Message{" "}
              <span className="text-fg-4 font-normal">— fallback when AI is unavailable</span>
            </label>
            <textarea
              value={formConfig.message}
              onChange={(e) => onPatchForm({ message: e.target.value })}
              placeholder="Hey! Saw your profile and wanted to reach out…"
              rows={3}
              className={`${INP} resize-y`}
            />
          </div>

          <div className="mb-3.5">
            <label className={`${LBL} flex justify-between`}>
              <span>
                Target Usernames{" "}
                <span className="text-fg-4 font-normal">— one per line or comma-separated</span>
              </span>
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded-full border"
                style={{
                  color:       targetCount > 0 ? "var(--positive)"              : "var(--fg-4)",
                  background:  targetCount > 0 ? "rgba(168,232,64,0.10)"        : "var(--bg-canvas)",
                  borderColor: "var(--line)",
                }}
              >
                {targetCount} target{targetCount !== 1 ? "s" : ""}
              </span>
            </label>
            <textarea
              value={formConfig.targets}
              onChange={(e) => onPatchForm({ targets: e.target.value })}
              placeholder={"username1\nusername2\nusername3"}
              rows={4}
              className={`${INP} resize-y`}
            />
          </div>

          <div className="mb-4">
            <label className={LBL}>Send Delay</label>
            <div className="flex items-center gap-2.5">
              <div className="flex-1">
                <input
                  type="number"
                  value={formConfig.minDelaySec}
                  min={1}
                  onChange={(e) => onPatchForm({ minDelaySec: Number(e.target.value) })}
                  className={INP}
                />
                <p className="m-0 mt-0.5 text-[11px] text-fg-4">Min (seconds)</p>
              </div>
              <span className="text-fg-4 text-[13px] shrink-0 pt-0.5">to</span>
              <div className="flex-1">
                <input
                  type="number"
                  value={formConfig.maxDelaySec}
                  min={1}
                  onChange={(e) => onPatchForm({ maxDelaySec: Number(e.target.value) })}
                  className={INP}
                />
                <p className="m-0 mt-0.5 text-[11px] text-fg-4">Max (seconds)</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div
          className="mb-3.5 px-3 py-2.5 rounded text-xs flex justify-between items-start gap-2 border-2"
          style={{
            background:  "rgba(224,176,114,0.10)",
            borderColor: "rgba(224,176,114,0.28)",
            color:       "var(--warning)",
          }}
        >
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-1">
        {isRunning ? (
          <button
            onClick={onStop}
            className="flex-1 py-2.5 px-4 font-bold text-[13px] font-body rounded border-2 cursor-pointer transition-all hover:-translate-x-0.5 hover:-translate-y-0.5"
            style={{ background: "var(--accent-soft)", borderColor: "var(--accent-line)", color: "var(--accent)" }}
          >
            Stop Job
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={isStarting}
            className={`flex-1 py-2.5 px-4 flex items-center justify-center gap-2 rounded font-bold text-[13px] font-body border-2 transition-all duration-150 ${
              isStarting
                ? "bg-canvas text-fg-4 border-line cursor-default"
                : "bg-accent text-ink border-line-hi shadow-hard-sm hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-lift-sm cursor-pointer"
            }`}
          >
            {isStarting ? (
              <><Spinner /><span className="text-fg-3">Starting…</span></>
            ) : (
              "Start Automation"
            )}
          </button>
        )}
        <button
          onClick={onForceKill}
          title="Force kill worker process"
          className="py-2.5 px-3.5 text-xs font-bold border-2 border-line-hi rounded bg-transparent text-fg-3 cursor-pointer font-body transition-all hover:-translate-x-0.5 hover:-translate-y-0.5"
        >
          Kill
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function stageLabel(state: string) {
  if (state === "active") return "Running";
  if (state === "done")   return "Done";
  if (state === "error")  return "Issue";
  return "Queued";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pending:  { label: "Pending",  color: "var(--fg-3)",   bg: "var(--line)"               },
    sending:  { label: "Sending…", color: "var(--accent)",  bg: "rgba(168,232,64,0.12)"     },
    sent:     { label: "Sent",     color: "var(--positive)", bg: "rgba(168,232,64,0.12)"    },
    failed:   { label: "Failed",   color: "var(--warning)", bg: "rgba(224,176,114,0.12)"    },
    skipped:  { label: "Skipped",  color: "var(--info)",    bg: "rgba(127,163,194,0.12)"    },
  };
  const s = map[status] ?? map.pending;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

// ── Class constants ───────────────────────────────────────────────────────────
const CARD = "bg-card rounded-md p-[22px] border-2 border-line-hi shadow-hard-sm";
const INP  = "block w-full box-border px-3 py-2.5 bg-input border-2 border-line-hi rounded text-fg text-[13px] font-body outline-none";
const LBL  = "block text-xs font-bold mb-1.5 text-fg-2 font-body";
