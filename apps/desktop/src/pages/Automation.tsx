import { useEffect, useRef, useState } from "react";
import api from "../api/client";
import { useAuth } from "@clerk/clerk-react";
import { useAutomationStore } from "../store/automation";
import { toast } from "../store/toast";
import type { IgAccount, WorkerStartCmd } from "@insta-saas/shared";

const SERVER_URL = ((import.meta.env.VITE_BACKEND_URL as string) ?? "http://localhost:3001").replace(/\/$/, "");

const pulseKeyframes = `
@keyframes skpulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}`;

function Skeleton({ w, h, radius = 5 }: { w: string | number; h: number; radius?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: "var(--bg-canvas)",
      animation: "skpulse 1.6s ease-in-out infinite",
      flexShrink: 0,
    }} />
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 14, height: 14,
      border: "2px solid rgba(26,25,23,0.3)",
      borderTopColor: "#1a1917",
      borderRadius: "50%",
      animation: "spin 0.7s linear infinite",
      flexShrink: 0,
    }} />
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
        window.worker?.isRunning(a.id).then(({ running }) => {
          if (!running && useAutomationStore.getState().runningAccounts.has(a.id)) {
            clearJob(a.id);
          }
        });
      });
    }).finally(() => setLoadingAccounts(false));
  }, [hydrateFromStorage, clearJob]);

  useEffect(() => {
    if (runningAccounts.size === 0) return;
    const iv = setInterval(async () => {
      const fresh = await getToken();
      if (!fresh) return;
      for (const id of runningAccounts) {
        window.worker?.refreshToken(id, fresh).catch(() => undefined);
      }
    }, 45_000);
    return () => clearInterval(iv);
  }, [runningAccounts, getToken]);

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

  function setErr(accountId: string, msg: string) {
    setErrors((p) => ({ ...p, [accountId]: msg }));
  }

  function clearErr(accountId: string) {
    setErrors((p) => { const n = { ...p }; delete n[accountId]; return n; });
  }

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
      const token = await getToken();
      if (!token) { setErr(account.id, "Not authenticated."); return; }

      const { data: jobData } = await api.post<{ job: { id: string } }>("/automation/start", {
        igAccountId: account.id,
        targets: targetList,
        defaultMessage: cfg.message.trim(),
        minDelayMs: cfg.minDelaySec * 1000,
        maxDelayMs: cfg.maxDelaySec * 1000,
      });

      const cmd: WorkerStartCmd = {
        cmd: "start",
        accountId: account.id,
        jobId: jobData.job.id,
        sessionDir: `./sessions/${account.id}`,
        serverUrl: SERVER_URL,
        authToken: token,
        targets: targetList,
        defaultMessage: cfg.message.trim(),
        minDelayMs: cfg.minDelaySec * 1000,
        maxDelayMs: cfg.maxDelaySec * 1000,
      };

      startJob(account.id, targetList.map((t) => t.username), jobData.job.id);
      const result = await window.worker.start(cmd);
      if (result.error) {
        stopJob(account.id);
        setErr(account.id, result.error);
      }
    } catch (err: any) {
      setErr(account.id, err.response?.data?.error ?? err.message ?? "Failed to start job.");
    } finally {
      setStarting((p) => ({ ...p, [account.id]: false }));
    }
  }

  async function handleStop(accountId: string) {
    try {
      await api.post(`/automation/stop/${accountId}`);
      await window.worker.stop(accountId);
      stopJob(accountId);
    } catch (err: any) {
      setErr(accountId, err.response?.data?.error ?? "Failed to stop.");
    }
  }

  async function handleForceKill(accountId: string) {
    clearErr(accountId);
    await window.worker.kill(accountId);
    clearJob(accountId);
  }

  return (
    <>
      <style>{pulseKeyframes}</style>
      <div style={{ padding: "28px 32px", maxWidth: 1120, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.3px" }}>
            Automation
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--fg-3)" }}>
            {loadingAccounts ? <Skeleton w={160} h={14} /> : (
              <>
                <span>{accounts.length} account{accounts.length !== 1 ? "s" : ""}</span>
                <span style={{ color: "var(--line-hi)" }}>·</span>
                <span>
                  <span style={{
                    display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                    background: runningAccounts.size > 0 ? "var(--positive)" : "var(--fg-4)",
                    marginRight: 5, verticalAlign: "middle",
                  }} />
                  {runningAccounts.size} job{runningAccounts.size !== 1 ? "s" : ""} running
                </span>
              </>
            )}
          </div>
        </div>

        {/* Cards */}
        {loadingAccounts ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 16, justifyContent: "center" }}>
            {[0, 1].map((i) => (
              <div key={i} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Skeleton w={36} h={36} radius={99} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      <Skeleton w={110} h={14} />
                      <Skeleton w={70} h={11} />
                    </div>
                  </div>
                  <Skeleton w={58} h={22} radius={99} />
                </div>
                <Skeleton w="100%" h={72} radius={6} />
                <div style={{ marginTop: 12 }}><Skeleton w="100%" h={100} radius={6} /></div>
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <Skeleton w={80} h={38} radius={6} />
                  <Skeleton w={80} h={38} radius={6} />
                </div>
                <div style={{ marginTop: 14 }}><Skeleton w="100%" h={38} radius={6} /></div>
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", padding: "56px 32px" }}>
            <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.4 }}>◎</div>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 15, color: "var(--fg)" }}>No accounts connected</p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>Go to <strong>Accounts</strong> to connect an Instagram account first.</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 16, justifyContent: "center" }}>
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
    </>
  );
}

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
    <div style={{
      ...cardStyle,
      border: isRunning ? "1.5px solid var(--accent-line)" : "1px solid var(--line)",
      boxShadow: isRunning ? "0 0 0 3px var(--accent-soft)" : "none",
      transition: "box-shadow 0.2s",
    }}>

      {/* Account header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{
            width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
            background: isRunning ? "var(--accent-soft)" : "var(--bg-canvas)",
            border: `2px solid ${isRunning ? "var(--accent-line)" : "var(--line-hi)"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 13,
            color: isRunning ? "var(--accent)" : "var(--fg-3)",
          }}>
            {initials}
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--fg)", lineHeight: 1.2 }}>
              @{account.username}
            </div>
            {job.statusText && (
              <div style={{ fontSize: 11, color: isRunning ? "var(--accent)" : "var(--fg-4)", marginTop: 3 }}>
                {job.statusText}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
          {isRunning && (
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--positive)", display: "inline-block", animation: "skpulse 1.4s ease-in-out infinite" }} />
          )}
          <span style={{
            padding: "3px 10px", borderRadius: 99, fontSize: 10, fontWeight: 800, letterSpacing: "0.07em",
            background: isRunning ? "var(--accent-soft)" : "var(--bg-canvas)",
            color: isRunning ? "var(--accent)" : "var(--fg-4)",
            border: `1px solid ${isRunning ? "var(--accent-line)" : "var(--line)"}`,
          }}>
            {isStarting ? "STARTING" : isRunning ? "RUNNING" : "IDLE"}
          </span>
        </div>
      </div>

      {/* ── Running view ── */}
      {(isRunning || isStarting) && (
        <>
          {isStarting && !isRunning ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", marginBottom: 16, border: "1px solid var(--line)" }}>
              <Spinner />
              <span style={{ fontSize: 13, color: "var(--fg-2)" }}>Launching worker and creating job…</span>
            </div>
          ) : total > 0 ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, marginBottom: 7 }}>
                <div style={{ color: "var(--fg-3)" }}>
                  <span style={{ color: "var(--positive)", fontWeight: 700 }}>{job.sent}</span> sent ·{" "}
                  <span style={{ color: "var(--accent)", fontWeight: 700 }}>{job.failed}</span> failed ·{" "}
                  <span style={{ color: "var(--fg-2)", fontWeight: 700 }}>{remaining}</span> remaining
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-2)" }}>{Math.round(pct)}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: "var(--bg-canvas)", overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 3, transition: "width 0.5s ease" }} />
              </div>
              {job.workflowTarget && (
                <div style={{ fontSize: 12, color: "var(--fg-3)", marginBottom: 10 }}>
                  <span style={{ color: "var(--accent)" }}>●</span>{" "}
                  Processing <strong style={{ color: "var(--fg-2)" }}>@{job.workflowTarget}</strong>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", marginBottom: 16 }}>
              <Spinner />
              <span style={{ fontSize: 13, color: "var(--fg-3)" }}>Initializing automation…</span>
            </div>
          )}

          {/* Workflow stages */}
          {job.workflowStages.some((s) => s.state !== "pending") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
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
            <div style={{ background: "rgba(0,0,0,0.22)", borderRadius: "var(--radius-sm)", padding: "8px 12px", maxHeight: 90, overflowY: "auto", marginBottom: 14, fontFamily: "monospace" }}>
              {job.workerLogs.slice(-5).map((line, i) => (
                <div key={i} style={{ fontSize: 11, lineHeight: 1.6, color: line.includes("[ERR]") ? "var(--accent)" : line.includes("[WRN]") ? "var(--warning)" : "var(--fg-3)" }}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* Target table */}
          {job.targetRows.length > 0 && (
            <div ref={tableRef} style={{ maxHeight: 190, overflowY: "auto", marginBottom: 14, border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line-hi)", background: "var(--bg-canvas)" }}>
                    {["Username", "Status", "Message sent"].map((h) => (
                      <th key={h} style={{ padding: "5px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {job.targetRows.map((row) => (
                    <tr key={row.username} data-u={row.username} style={{ borderBottom: "1px solid var(--line)", background: row.status === "sending" ? "var(--accent-soft)" : "transparent", transition: "background 0.2s" }}>
                      <td style={{ padding: "6px 10px", fontWeight: row.status === "sending" ? 700 : 400, color: "var(--fg)", whiteSpace: "nowrap" }}>@{row.username}</td>
                      <td style={{ padding: "6px 10px" }}><StatusBadge status={row.status} /></td>
                      <td style={{ padding: "6px 10px", color: "var(--fg-3)", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.messageSent ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Idle form ── */}
      {!isRunning && !isStarting && (
        <>
          <div style={{ marginBottom: 14 }}>
            <label style={lbl}>
              Default Message{" "}
              <span style={{ color: "var(--fg-4)", fontWeight: 400 }}>— fallback when AI is unavailable</span>
            </label>
            <textarea
              value={formConfig.message}
              onChange={(e) => onPatchForm({ message: e.target.value })}
              placeholder="Hey! Saw your profile and wanted to reach out…"
              rows={3}
              style={{ ...inp, resize: "vertical" }}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={{ ...lbl, display: "flex", justifyContent: "space-between" }}>
              <span>Target Usernames <span style={{ color: "var(--fg-4)", fontWeight: 400 }}>— one per line or comma-separated</span></span>
              <span style={{
                fontSize: 11, fontWeight: 700, color: targetCount > 0 ? "var(--positive)" : "var(--fg-4)",
                background: targetCount > 0 ? "rgba(154,194,138,0.12)" : "var(--bg-canvas)",
                padding: "1px 8px", borderRadius: 99, border: "1px solid var(--line)",
              }}>
                {targetCount} target{targetCount !== 1 ? "s" : ""}
              </span>
            </label>
            <textarea
              value={formConfig.targets}
              onChange={(e) => onPatchForm({ targets: e.target.value })}
              placeholder={"username1\nusername2\nusername3"}
              rows={4}
              style={{ ...inp, resize: "vertical" }}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={lbl}>Send Delay</label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <input
                  type="number"
                  value={formConfig.minDelaySec}
                  min={1}
                  onChange={(e) => onPatchForm({ minDelaySec: Number(e.target.value) })}
                  style={inp}
                />
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--fg-4)" }}>Min (seconds)</p>
              </div>
              <span style={{ color: "var(--fg-4)", fontSize: 13, flexShrink: 0, paddingTop: 2 }}>to</span>
              <div style={{ flex: 1 }}>
                <input
                  type="number"
                  value={formConfig.maxDelaySec}
                  min={1}
                  onChange={(e) => onPatchForm({ maxDelaySec: Number(e.target.value) })}
                  style={inp}
                />
                <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--fg-4)" }}>Max (seconds)</p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Error */}
      {error && (
        <div style={{ marginBottom: 14, padding: "9px 12px", background: "var(--accent-soft)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--accent)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <span>{error}</span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isRunning ? (
          <button
            onClick={onStop}
            style={{ ...btnBase, flex: 1, background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)" }}
          >
            Stop Job
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={isStarting}
            style={{
              ...btnBase, flex: 1,
              background: isStarting ? "var(--bg-canvas)" : "var(--accent)",
              color: isStarting ? "var(--fg-4)" : "#1a1917",
              border: isStarting ? "1px solid var(--line)" : "none",
              cursor: isStarting ? "default" : "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            {isStarting ? (
              <>
                <Spinner />
                <span style={{ color: "var(--fg-3)" }}>Starting…</span>
              </>
            ) : (
              "Start Automation"
            )}
          </button>
        )}
        <button
          onClick={onForceKill}
          title="Force kill worker process"
          style={{ ...btnBase, background: "transparent", border: "1px solid var(--line-hi)", color: "var(--fg-3)", padding: "9px 14px", fontSize: 12 }}
        >
          Kill
        </button>
      </div>
    </div>
  );
}

function stageLabel(state: string) {
  if (state === "active") return "Running";
  if (state === "done") return "Done";
  if (state === "error") return "Issue";
  return "Queued";
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pending:  { label: "Pending",   color: "var(--fg-3)",    bg: "var(--line)" },
    sending:  { label: "Sending…", color: "var(--warning)", bg: "rgba(224,176,114,0.15)" },
    sent:     { label: "Sent",     color: "var(--positive)", bg: "rgba(154,194,138,0.12)" },
    failed:   { label: "Failed",   color: "var(--accent)",   bg: "var(--accent-soft)" },
    skipped:  { label: "Skipped",  color: "var(--info)",     bg: "rgba(127,163,194,0.12)" },
  };
  const s = map[status] ?? map.pending;
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  borderRadius: "var(--radius-md)",
  padding: "22px",
  border: "1px solid var(--line)",
};
const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "9px 12px",
  background: "var(--bg-input)", border: "1px solid var(--line-hi)",
  borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--fg)",
  outline: "none", boxSizing: "border-box", fontFamily: "var(--font-body)",
};
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6, color: "var(--fg-2)" };
const btnBase: React.CSSProperties = {
  padding: "10px 18px", border: "none", borderRadius: "var(--radius-sm)",
  cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "var(--font-body)",
};
