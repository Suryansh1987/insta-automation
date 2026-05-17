import { useEffect, useRef } from "react";
import api from "../api/client";
import { useAuth } from "@clerk/clerk-react";
import { useAutomationStore, type TargetStatus } from "../store/automation";
import { useState } from "react";
import type { IgAccount, WorkerStartCmd } from "@insta-saas/shared";
import WorkflowOverlay from "../components/ui/workflow-overlay";
import LoadingState from "../components/ui/loading-state";
import "dotenv/config";

const SERVER_URL =import.meta.env.VITE_BACKEND_URL;

export default function Automation() {
  const { getToken } = useAuth();
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [defaultMessage, setDefaultMessage] = useState("");
  const [targets, setTargets] = useState("");
  const [minDelay, setMinDelay] = useState(20_000);
  const [maxDelay, setMaxDelay] = useState(60_000);
  const [error, setError] = useState("");

  const { runningAccounts, targetRows, sent, failed, statusText, currentJobId,
          startJob, stopJob, setProgress, activeRunAccountId, workflowStages, workflowTarget, hydrateFromStorage } = useAutomationStore();
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hydrateFromStorage();
    api.get<{ accounts: IgAccount[] }>("/accounts").then((r) => {
      setAccounts(r.data.accounts);
      if (r.data.accounts.length > 0) {
        const firstId = activeRunAccountId && r.data.accounts.some((a) => a.id === activeRunAccountId)
          ? activeRunAccountId
          : r.data.accounts[0].id;
        setSelectedId(firstId);
        r.data.accounts.forEach((a) => {
          window.worker?.isRunning(a.id).then(({ running }) => {
            if (!running && useAutomationStore.getState().activeRunAccountId === a.id) {
              useAutomationStore.getState().clearJob();
            }
          });
        });
      }
    }).finally(() => setLoadingAccounts(false));
  }, [activeRunAccountId, hydrateFromStorage]);

  // Poll DB every 10s for authoritative counts
  useEffect(() => {
    if (!currentJobId || !runningAccounts.has(selectedId)) return;
    const iv = setInterval(async () => {
      try {
        const { data } = await api.get<{ job: { sent: number; failed: number } }>(`/automation/status/${currentJobId}`);
        setProgress(data.job.sent, data.job.failed);
      } catch { /* ignore */ }
    }, 10_000);
    return () => clearInterval(iv);
  }, [currentJobId, selectedId, runningAccounts, setProgress]);

  // Auto-scroll sending row
  useEffect(() => {
    const row = targetRows.find((r) => r.status === "sending");
    if (!row) return;
    tableRef.current?.querySelector<HTMLElement>(`[data-u="${row.username}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [targetRows]);

  function parseTargets() {
    return targets.split(/[\n,]+/).map((t) => t.trim().replace(/^@/, "")).filter(Boolean).map((username) => ({ username }));
  }

  async function handleStart() {
    setError("");
    if (!selectedId) return setError("No account selected.");
    if (!defaultMessage.trim()) return setError("Enter a default message.");
    if (!targets.trim()) return setError("Enter at least one target username.");
    const targetList = parseTargets();
    try {
      const token = await getToken();
      if (!token) return setError("Not authenticated.");
      const { data: jobData } = await api.post<{ job: { id: string } }>("/automation/start", {
        igAccountId: selectedId, targets: targetList,
        defaultMessage: defaultMessage.trim(), minDelayMs: minDelay, maxDelayMs: maxDelay,
      });
      const cmd: WorkerStartCmd = {
        cmd: "start", accountId: selectedId, jobId: jobData.job.id,
        sessionDir: `./sessions/${selectedId}`, serverUrl: SERVER_URL, authToken: token,
        targets: targetList, defaultMessage: defaultMessage.trim(), minDelayMs: minDelay, maxDelayMs: maxDelay,
      };
      startJob(selectedId, targetList.map((t) => t.username), jobData.job.id);
      const result = await window.worker.start(cmd);
      if (result.error) {
        stopJob(selectedId);
        return setError(result.error);
      }
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message ?? "Failed to start job.");
    }
  }

  async function handleStop() {
    if (!selectedId) return;
    try {
      await api.post(`/automation/stop/${selectedId}`);
      await window.worker.stop(selectedId);
      stopJob(selectedId);
    } catch (err: any) { setError(err.response?.data?.error ?? "Failed to stop."); }
  }

  async function handleForceKill() {
    if (!selectedId) return;
    setError("");
    await window.worker.kill(selectedId);
    stopJob(selectedId);
  }

  const isRunning = runningAccounts.has(selectedId);
  const totalTargets = targetRows.length || parseTargets().length;
  const pct = totalTargets > 0 ? ((sent + failed) / totalTargets) * 100 : 0;

  return (
    <div style={{ padding: 28, maxWidth: 780, position: "relative" }}>
      <h1 style={{ margin: "0 0 24px", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>
        Automation
      </h1>
      {/* Config card */}
      <div style={card}>
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Instagram Account</label>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={inp}>
            {accounts.length === 0
              ? <option value="">No accounts - go to Accounts first</option>
              : accounts.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Default Message <span style={{ color: "var(--fg-4)", fontWeight: 400 }}>(fallback when AI unavailable)</span></label>
          <textarea value={defaultMessage} onChange={(e) => setDefaultMessage(e.target.value)}
            placeholder="Hey! Hope you're doing well." rows={3} style={{ ...inp, resize: "vertical" }} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Target Usernames <span style={{ color: "var(--fg-4)", fontWeight: 400 }}>(one per line or comma-separated)</span></label>
          <textarea value={targets} onChange={(e) => setTargets(e.target.value)}
            placeholder={"username1\nusername2"} rows={6} style={{ ...inp, resize: "vertical" }} />
          <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--fg-4)" }}>{parseTargets().length} targets</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 22 }}>
          {[["Min Delay (ms)", minDelay, setMinDelay], ["Max Delay (ms)", maxDelay, setMaxDelay]].map(([label, val, setter]) => (
            <div key={label as string}>
              <label style={lbl}>{label as string}</label>
              <input type="number" value={val as number} min={0}
                onChange={(e) => (setter as any)(Number(e.target.value))} style={inp} />
              <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--fg-4)" }}>{((val as number) / 1000).toFixed(0)}s</p>
            </div>
          ))}
        </div>

        {error && <p style={{ color: "var(--accent)", fontSize: 12, margin: "-6px 0 14px", padding: "8px 12px", background: "var(--accent-soft)", borderRadius: "var(--radius-sm)" }}>{error}</p>}
        {statusText && <p style={{ color: isRunning ? "var(--info)" : "var(--positive)", fontSize: 12, margin: "-6px 0 14px" }}>{statusText}</p>}

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {isRunning ? (
            <button onClick={handleStop} style={{ ...btnBase, background: "var(--accent)", color: "#1a1917" }}>Stop Job</button>
          ) : (
            <button onClick={handleStart} disabled={accounts.length === 0} style={{ ...btnBase, background: "var(--accent)", color: "#1a1917", opacity: accounts.length === 0 ? 0.4 : 1, cursor: accounts.length === 0 ? "default" : "pointer" }}>
              Start Automation
            </button>
          )}
          <button onClick={handleForceKill} style={{ ...btnBase, background: "none", border: "1px solid var(--accent-line)", color: "var(--accent)", fontSize: 12, padding: "9px 16px" }}>
            Force Kill
          </button>
        </div>
      </div>

      {/* Progress table */}
      {targetRows.length > 0 && (
        <div style={{ ...card, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, color: "var(--fg)" }}>Progress</span>
            <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
              <b style={{ color: "var(--positive)" }}>{sent}</b> sent -{" "}
              <b style={{ color: "var(--accent)" }}>{failed}</b> failed -{" "}
              <b style={{ color: "var(--fg-2)" }}>{totalTargets - sent - failed}</b> remaining
            </span>
          </div>

          {/* Progress bar */}
          <div style={{ height: 5, background: "var(--line-hi)", borderRadius: 3, marginBottom: 14, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 3, transition: "width 0.4s ease" }} />
          </div>

          <div ref={tableRef} style={{ maxHeight: 320, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line-hi)" }}>
                  {["Username", "Status", "Message sent"].map((h) => (
                    <th key={h} style={{ padding: "5px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targetRows.map((row) => (
                  <tr key={row.username} data-u={row.username} style={{ borderBottom: "1px solid var(--line)", background: row.status === "sending" ? "var(--accent-soft)" : "transparent", transition: "background 0.2s" }}>
                    <td style={{ padding: "8px 10px", fontWeight: row.status === "sending" ? 600 : 400, color: "var(--fg)" }}>@{row.username}</td>
                    <td style={{ padding: "8px 10px" }}><StatusBadge status={row.status} /></td>
                    <td style={{ padding: "8px 10px", color: "var(--fg-3)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.messageSent ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <WorkflowOverlay
        open={isRunning}
        title="Headless DM automation running"
        subtitle="The browser stays hidden while we open profiles, collect context, create a message, and send it."
        targetLabel={workflowTarget ? `Current target: @${workflowTarget}` : undefined}
        progressLabel={totalTargets > 0 ? `${sent + failed}/${totalTargets} complete` : undefined}
        stages={workflowStages}
      />
      {loadingAccounts && (
        <LoadingState
          overlay
          title="Loading automation workspace"
          subtitle="Preparing accounts and active run state."
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: TargetStatus }) {
  const map: Record<TargetStatus, { label: string; color: string; bg: string }> = {
    pending:  { label: "Pending",  color: "var(--fg-3)",    bg: "var(--line)" },
    sending:  { label: "Sending...", color: "var(--warning)", bg: "rgba(224,176,114,0.15)" },
    sent:     { label: "Sent",     color: "var(--positive)", bg: "rgba(154,194,138,0.12)" },
    failed:   { label: "Failed",   color: "var(--accent)",   bg: "var(--accent-soft)" },
    skipped:  { label: "Skipped",  color: "var(--info)",     bg: "rgba(127,163,194,0.12)" },
  };
  const s = map[status];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

const card: React.CSSProperties = { background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 22, border: "1px solid var(--line)" };
const inp: React.CSSProperties = { display: "block", width: "100%", padding: "9px 12px", background: "var(--bg-input)", border: "1px solid var(--line-hi)", borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--fg)", outline: "none", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6, color: "var(--fg-2)" };
const btnBase: React.CSSProperties = { padding: "9px 22px", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: "var(--font-body)" };
