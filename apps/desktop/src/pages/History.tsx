import { useEffect, useState } from "react";
import api from "../api/client";
import type { AutomationJob, MessageRecord } from "@insta-saas/shared";

const pulseKeyframes = `
@keyframes skpulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
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

interface JobRow {
  id: string;
  status: string;
  igAccount: { username: string };
  totalTargets: number;
  sent: number;
  failed: number;
  defaultMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
}

export default function History() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [selectedJob, setSelectedJob] = useState<AutomationJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    api.get<{ jobs: JobRow[] }>("/automation/jobs")
      .then((r) => setJobs(r.data.jobs))
      .finally(() => setLoading(false));
  }, []);

  async function openJob(id: string) {
    setDetailLoading(true);
    try {
      const { data } = await api.get<{ job: AutomationJob }>(`/automation/status/${id}`);
      setSelectedJob(data.job);
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <>
      <style>{pulseKeyframes}</style>
      <div style={{ display: "flex", height: "100vh" }}>
        {/* Sidebar */}
        <div style={{ width: 320, flexShrink: 0, borderRight: "1px solid var(--line)", overflowY: "auto", padding: "24px 16px" }}>
          <h1 style={{ margin: "0 0 18px", fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--fg)", padding: "0 4px" }}>
            Run History
          </h1>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ background: "var(--bg-card)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <Skeleton w={100} h={13} />
                    <Skeleton w={52} h={18} radius={99} />
                  </div>
                  <Skeleton w={130} h={11} />
                  <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                    <Skeleton w={44} h={11} />
                    <Skeleton w={44} h={11} />
                    <Skeleton w={44} h={11} />
                  </div>
                </div>
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <p style={{ color: "var(--fg-4)", fontSize: 13, padding: "0 4px" }}>No runs yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {jobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => openJob(job.id)}
                  style={{
                    background: selectedJob?.id === job.id ? "var(--accent-soft)" : "var(--bg-card)",
                    border: `1px solid ${selectedJob?.id === job.id ? "var(--accent-line)" : "var(--line)"}`,
                    borderRadius: "var(--radius-md)",
                    padding: "12px 14px",
                    cursor: "pointer",
                    transition: "border-color 0.15s",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--fg)" }}>@{job.igAccount?.username ?? "-"}</span>
                    <StatusPill status={job.status} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 6 }}>{fmtDate(job.createdAt)}</div>
                  <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                    <Stat label="Total" value={job.totalTargets} />
                    <Stat label="Sent" value={job.sent} color="var(--positive)" />
                    <Stat label="Failed" value={job.failed} color="var(--accent)" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
          {detailLoading ? (
            <div>
              <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 18, border: "1px solid var(--line)", marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <Skeleton w={140} h={20} radius={6} />
                    <Skeleton w={100} h={12} />
                  </div>
                  <Skeleton w={70} h={24} radius={99} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                      <Skeleton w="60%" h={10} />
                      <div style={{ marginTop: 8 }}><Skeleton w="40%" h={24} radius={6} /></div>
                    </div>
                  ))}
                </div>
                <Skeleton w="100%" h={36} radius={6} />
              </div>
              <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 18, border: "1px solid var(--line)" }}>
                <Skeleton w={120} h={16} />
                <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <Skeleton w={90} h={12} />
                      <Skeleton w={50} h={20} radius={99} />
                      <Skeleton w={30} h={12} />
                      <Skeleton w={30} h={12} />
                      <Skeleton w={160} h={12} />
                      <Skeleton w={50} h={12} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : selectedJob ? (
            <JobDetail job={selectedJob} />
          ) : (
            <div style={{ textAlign: "center", paddingTop: 80, color: "var(--fg-4)", fontSize: 13 }}>
              Select a run to see details
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function JobDetail({ job }: { job: AutomationJob }) {
  const records: MessageRecord[] = (job as AutomationJob & { messageRecords?: MessageRecord[] }).messageRecords ?? [];
  const duration = job.startedAt && job.stoppedAt
    ? fmtDuration(new Date(job.stoppedAt).getTime() - new Date(job.startedAt).getTime())
    : job.startedAt
      ? "Running..."
      : "-";

  return (
    <div>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: "0 0 3px", fontFamily: "var(--font-display)", fontSize: 17, color: "var(--fg)" }}>
              @{(job as AutomationJob & { igAccount?: { username?: string } }).igAccount?.username}
            </h2>
            <span style={{ fontSize: 11, color: "var(--fg-3)" }}>{fmtDate((job as AutomationJob & { createdAt?: string }).createdAt ?? "")}</span>
          </div>
          <StatusPill status={job.status} large />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
          <MetricCell label="Targets" value={job.totalTargets} />
          <MetricCell label="Sent" value={job.sent} color="var(--positive)" />
          <MetricCell label="Failed" value={job.failed} color="var(--accent)" />
          <MetricCell label="Duration" value={duration} />
        </div>

        {job.defaultMessage && (
          <div style={{ background: "var(--bg-input)", borderRadius: "var(--radius-sm)", padding: "9px 12px", fontSize: 12, color: "var(--fg-2)" }}>
            <span style={{ color: "var(--fg-3)" }}>Default: </span>
            {job.defaultMessage}
          </div>
        )}
      </div>

      <div style={{ ...card, marginTop: 14 }}>
        <h3 style={{ margin: "0 0 14px", fontFamily: "var(--font-display)", fontSize: 14, color: "var(--fg)" }}>
          Messages ({records.length})
        </h3>
        {records.length === 0 ? (
          <p style={{ color: "var(--fg-4)", fontSize: 13 }}>No records for this run.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line-hi)" }}>
                  {["Username", "Status", "Seen", "Replied", "Message", "Error", "Time"].map((h) => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "8px 10px", color: "var(--fg)", fontWeight: 500 }}>@{r.username}</td>
                    <td style={{ padding: "8px 10px" }}><MsgBadge status={r.status} /></td>
                    <td style={{ padding: "8px 10px" }}>
                      {r.seen ? <span style={{ color: "var(--info)", fontWeight: 600 }}>Seen</span> : <span style={{ color: "var(--fg-4)" }}>-</span>}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      {r.replied ? <span style={{ color: "var(--warning)", fontWeight: 600 }}>Replied</span> : <span style={{ color: "var(--fg-4)" }}>-</span>}
                    </td>
                    <td style={{ padding: "8px 10px", maxWidth: 220, color: "var(--fg-2)" }}>
                      <MsgCell text={r.messageSent} />
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--accent)", maxWidth: 160 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.errorReason ?? ""}>
                        {r.errorReason ?? "-"}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", color: "var(--fg-3)", whiteSpace: "nowrap" }}>{fmtTime(r.sentAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MsgCell({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span style={{ color: "var(--fg-4)" }}>-</span>;
  const short = text.length > 70;
  return (
    <span>
      {expanded || !short ? text : `${text.slice(0, 70)}...`}
      {short && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ marginLeft: 6, fontSize: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </span>
  );
}

function StatusPill({ status, large }: { status: string; large?: boolean }) {
  const map: Record<string, { bg: string; color: string }> = {
    running: { bg: "rgba(154,194,138,0.15)", color: "var(--positive)" },
    done: { bg: "rgba(154,194,138,0.15)", color: "var(--positive)" },
    stopped: { bg: "rgba(224,176,114,0.15)", color: "var(--warning)" },
    error: { bg: "var(--accent-soft)", color: "var(--accent)" },
    idle: { bg: "var(--line)", color: "var(--fg-3)" },
  };
  const s = map[status] ?? map.idle;
  return (
    <span style={{ display: "inline-block", padding: large ? "3px 12px" : "2px 8px", borderRadius: "var(--radius-full)", fontSize: large ? 12 : 11, fontWeight: 600, background: s.bg, color: s.color, textTransform: "capitalize" }}>
      {status}
    </span>
  );
}

function MsgBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    sent: { bg: "rgba(154,194,138,0.15)", color: "var(--positive)" },
    failed: { bg: "var(--accent-soft)", color: "var(--accent)" },
    skipped: { bg: "rgba(127,163,194,0.12)", color: "var(--info)" },
  };
  const s = map[status] ?? { bg: "var(--line)", color: "var(--fg-3)" };
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: 10, fontWeight: 700, background: s.bg, color: s.color }}>{status}</span>;
}

function MetricCell({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{ background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
      <div style={{ fontSize: 10, color: "var(--fg-4)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? "var(--fg)", fontFamily: "var(--font-display)" }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <span>
      <span style={{ color: "var(--fg-4)" }}>{label}: </span>
      <span style={{ fontWeight: 700, color: color ?? "var(--fg-2)" }}>{value}</span>
    </span>
  );
}

const fmtDate = (iso: string) => iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "-";
const fmtTime = (iso: string) => iso ? new Date(iso).toLocaleTimeString(undefined, { timeStyle: "short" }) : "-";
const fmtDuration = (ms: number) => {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

const card: React.CSSProperties = {
  background: "var(--bg-card)",
  borderRadius: "var(--radius-md)",
  padding: 18,
  border: "1px solid var(--line)",
};
