import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useUser, useAuth } from "@clerk/clerk-react";
import { usePlanStore } from "../store/plan";
import { PLAN_LIMITS } from "@insta-saas/shared";
import { toast } from "../store/toast";
import type { MessagingPreferences, UpdateMessagingPreferencesRequest, WorkerCheckCmd, WorkerMessage } from "@insta-saas/shared";
import WorkflowOverlay from "../components/ui/workflow-overlay";
import { applyStageMessage, createWorkflowStages, type WorkflowStageView } from "../components/ui/workflow-stage";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Area, AreaChart,
} from "recharts";

interface DailyStat  { date: string; sent: number; failed: number; seen: number; replied: number }
interface Totals     { jobs: number; sent: number; failed: number }
interface TodayJob   {
  id: string; status: string; totalTargets: number; sent: number; failed: number;
  defaultMessage: string | null; igAccountId: string; igAccount: { username: string };
}
interface AnalyzeRecord {
  id: string; username: string; messageSent: string | null;
  status: string; seen: boolean; replied: boolean; replyPreview: string | null; sentAt: string;
}

const emptyPreferences: MessagingPreferences = { senderName: "", tone: "", customPrompt: "" };

const SERVER_URL = ((import.meta.env.VITE_BACKEND_URL as string) ?? "http://localhost:3001").replace(/\/$/, "");
const JOBS_PER_PAGE = 5;

const pulseKf = `
@keyframes skpulse { 0%,100%{opacity:1} 50%{opacity:.35} }`;

function Sk({ w, h, r = 5 }: { w: string | number; h: number; r?: number }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: "var(--bg-canvas)", animation: "skpulse 1.6s ease-in-out infinite", flexShrink: 0 }} />;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user }   = useUser();
  const { getToken } = useAuth();
  const plan   = usePlanStore((s) => s.plan) ?? "free";
  const limits = PLAN_LIMITS[plan];

  const [daily,     setDaily]     = useState<DailyStat[]>([]);
  const [totals,    setTotals]    = useState<Totals>({ jobs: 0, sent: 0, failed: 0 });
  const [todayJobs, setTodayJobs] = useState<TodayJob[]>([]);
  const [jobsTotal, setJobsTotal] = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [preferences, setPreferences] = useState<MessagingPreferences>(emptyPreferences);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const [preferencesSaving, setPreferencesSaving] = useState(false);

  // Filters
  const [chartDays, setChartDays]   = useState<7 | 14 | 30>(7);
  const [jobsDate,  setJobsDate]    = useState(todayISO());
  const [jobsPage,  setJobsPage]    = useState(1);

  // Analyze modal
  const [analyzeJob,     setAnalyzeJob]     = useState<TodayJob | null>(null);
  const [analyzeRecords, setAnalyzeRecords] = useState<AnalyzeRecord[]>([]);
  const [analyzeLoading, setAnalyzeLoading] = useState(false);

  async function fetchData(opts?: { days?: number; date?: string; page?: number }) {
    setLoading(true);
    try {
      const d    = opts?.days ?? chartDays;
      const date = opts?.date ?? jobsDate;
      const page = opts?.page ?? jobsPage;
      const { data } = await api.get<{
        daily: DailyStat[]; totals: Totals; todayJobs: TodayJob[];
        jobsTotal: number; jobsPage: number;
      }>("/automation/analytics", { params: { days: d, jobsDate: date, jobsPage: page, jobsLimit: JOBS_PER_PAGE } });
      setDaily(data.daily);
      setTotals(data.totals);
      setTodayJobs(data.todayJobs);
      setJobsTotal(data.jobsTotal);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPreferences() {
    setPreferencesLoading(true);
    try {
      const { data } = await api.get<{ preferences: MessagingPreferences }>("/automation/preferences");
      setPreferences(data.preferences ?? emptyPreferences);
    } finally {
      setPreferencesLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    fetchPreferences();
  }, []);

  function applyChartDays(d: 7 | 14 | 30) {
    setChartDays(d);
    setJobsPage(1);
    fetchData({ days: d, page: 1 });
  }

  function applyJobsDate(date: string) {
    setJobsDate(date);
    setJobsPage(1);
    fetchData({ date, page: 1 });
  }

  function applyPage(page: number) {
    setJobsPage(page);
    fetchData({ page });
  }

  async function openAnalyze(job: TodayJob) {
    setAnalyzeJob(job);
    setAnalyzeLoading(true);
    try {
      const { data } = await api.get<{ job: { messageRecords: AnalyzeRecord[] } }>(`/automation/status/${job.id}`);
      setAnalyzeRecords(data.job.messageRecords ?? []);
    } finally {
      setAnalyzeLoading(false);
    }
  }

  function patchPreferences(patch: Partial<MessagingPreferences>) {
    setPreferences((current) => ({ ...current, ...patch }));
  }

  async function savePreferences() {
    setPreferencesSaving(true);
    try {
      const payload: UpdateMessagingPreferencesRequest = {
        senderName: preferences.senderName,
        tone: preferences.tone,
        customPrompt: preferences.customPrompt,
      };
      const { data } = await api.patch<{ preferences: MessagingPreferences }>("/automation/preferences", payload);
      setPreferences(data.preferences ?? emptyPreferences);
      toast.success("Messaging preferences saved.");
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? "Failed to save messaging preferences.");
    } finally {
      setPreferencesSaving(false);
    }
  }

  const dateLabel  = (d: string) => new Date(d + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const successRate = totals.sent + totals.failed > 0
    ? Math.round((totals.sent / (totals.sent + totals.failed)) * 100) : 0;
  const totalPages = Math.max(1, Math.ceil(jobsTotal / JOBS_PER_PAGE));
  const isToday    = jobsDate === todayISO();

  return (
    <>
      <style>{pulseKf}</style>
      <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.3px" }}>
            Dashboard
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--fg-3)" }}>
            Welcome back, <strong style={{ color: "var(--fg-2)" }}>{user?.primaryEmailAddress?.emailAddress}</strong>
          </p>
        </div>

        {/* KPI cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
          {loading ? Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={cardS}>
              <Sk w={60} h={11} />
              <div style={{ marginTop: 12 }}><Sk w={80} h={30} r={6} /></div>
              <div style={{ marginTop: 8 }}><Sk w={100} h={11} /></div>
            </div>
          )) : (
            <>
              <KPICard label="Plan"          value={limits.label}       sub={limits.price}              accent="var(--accent)"    description="Your current subscription tier." />
              <KPICard label="Total jobs"    value={totals.jobs}        sub="all time"                  description="Automation runs created on this workspace." />
              <KPICard label="Messages sent" value={totals.sent}        sub="all time"                  accent="var(--positive)"  description="Total DMs successfully delivered." />
              <KPICard label="Success rate"  value={`${successRate}%`}  sub={`${totals.failed} failed`} accent={successRate >= 70 ? "var(--positive)" : "var(--warning)"} description="Share of attempted messages that succeeded." />
            </>
          )}
        </div>

        <ChartCard
          title="Messaging Preferences"
          sub="Set the name, tone, and AI instructions used for personalized DMs."
          action={
            <button
              onClick={savePreferences}
              disabled={preferencesLoading || preferencesSaving}
              style={{
                ...ghostBtn,
                background: preferencesSaving ? "var(--bg-canvas)" : "var(--accent-soft)",
                border: `1px solid ${preferencesSaving ? "var(--line)" : "var(--accent-line)"}`,
                color: preferencesSaving ? "var(--fg-4)" : "var(--accent)",
                cursor: preferencesLoading || preferencesSaving ? "default" : "pointer",
              }}
            >
              {preferencesSaving ? "Saving..." : "Save preferences"}
            </button>
          }
        >
          {preferencesLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Sk w={110} h={12} />
                <Sk w="100%" h={40} r={8} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Sk w={90} h={12} />
                <Sk w="100%" h={40} r={8} />
              </div>
              <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 8 }}>
                <Sk w={140} h={12} />
                <Sk w="100%" h={88} r={8} />
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label style={fieldLabel}>Your Name</label>
                <input
                  value={preferences.senderName}
                  onChange={(e) => patchPreferences({ senderName: e.target.value })}
                  placeholder="Warmly, Aayush"
                  style={fieldInput}
                />
                <div style={fieldHint}>This name is used in the DM sign-off.</div>
              </div>
              <div>
                <label style={fieldLabel}>Tone</label>
                <input
                  value={preferences.tone}
                  onChange={(e) => patchPreferences({ tone: e.target.value })}
                  placeholder="Warm, thoughtful, friendly"
                  style={fieldInput}
                />
                <div style={fieldHint}>Example: warm, playful, confident, softly professional.</div>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={fieldLabel}>Custom Prompt</label>
                <textarea
                  value={preferences.customPrompt}
                  onChange={(e) => patchPreferences({ customPrompt: e.target.value })}
                  placeholder="Write like a real human, keep it short, and avoid sounding salesy."
                  rows={4}
                  style={{ ...fieldInput, resize: "vertical" }}
                />
                <div style={fieldHint}>Extra instructions for AI-personalized messages.</div>
              </div>
            </div>
          )}
        </ChartCard>

        {/* Charts */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
          <ChartCard
            title="Messages per day"
            sub={`Last ${chartDays} days`}
            action={
              <RangeFilter value={chartDays} onChange={applyChartDays} />
            }
          >
            {loading ? (
              <div style={{ height: 180, display: "flex", alignItems: "flex-end", gap: 4, overflow: "hidden" }}>
                {Array.from({ length: chartDays > 14 ? 10 : 7 }).map((_, i) => (
                  <div key={i} style={{ flex: 1, height: 40 + (i % 3) * 30, borderRadius: 4, background: "var(--bg-canvas)", animation: "skpulse 1.6s ease-in-out infinite" }} />
                ))}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={daily} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--line-hi)", borderRadius: 8, color: "var(--fg)", fontSize: 12 }} labelFormatter={dateLabel as any} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--fg-2)" }} />
                  <Bar dataKey="sent"   fill="var(--positive)" radius={[4,4,0,0]} name="Sent" />
                  <Bar dataKey="failed" fill="var(--accent)"   radius={[4,4,0,0]} name="Failed" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Seen vs replied"
            sub={`Conversation outcomes · last ${chartDays} days`}
            action={
              <RangeFilter value={chartDays} onChange={applyChartDays} />
            }
          >
            {loading ? (
              <div style={{ height: 180, borderRadius: 6, background: "var(--bg-canvas)", animation: "skpulse 1.6s ease-in-out infinite", overflow: "hidden" }} />
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={daily}>
                  <defs>
                    <linearGradient id="seenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--info)"    stopOpacity={0.28} />
                      <stop offset="95%" stopColor="var(--info)"    stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="replyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="var(--warning)" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="var(--warning)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--line-hi)", borderRadius: 8, color: "var(--fg)", fontSize: 12 }} labelFormatter={dateLabel as any} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--fg-2)" }} />
                  <Area type="monotone" dataKey="seen"    stroke="var(--info)"    fill="url(#seenGrad)"  strokeWidth={2} name="Seen"    dot={false} />
                  <Area type="monotone" dataKey="replied" stroke="var(--warning)" fill="url(#replyGrad)" strokeWidth={2} name="Replied" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Jobs table */}
        <ChartCard
          title="Jobs"
          sub={isToday ? `Today · ${jobsTotal} run${jobsTotal !== 1 ? "s" : ""}` : `${jobsDate} · ${jobsTotal} run${jobsTotal !== 1 ? "s" : ""}`}
          action={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="date"
                value={jobsDate}
                max={todayISO()}
                onChange={(e) => e.target.value && applyJobsDate(e.target.value)}
                style={{
                  padding: "5px 10px", background: "var(--bg-input)", color: "var(--fg)",
                  border: "1px solid var(--line-hi)", borderRadius: "var(--radius-sm)",
                  fontSize: 12, fontFamily: "var(--font-body)", cursor: "pointer",
                  colorScheme: "dark",
                }}
              />
              <button onClick={() => navigate("/automation")} style={ghostBtn}>+ New job</button>
            </div>
          }
        >
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--bg-canvas)", borderRadius: "var(--radius-md)", padding: "12px 16px", border: "1px solid var(--line)" }}>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}><Sk w={120} h={14} /><Sk w={60} h={18} r={99} /></div>
                    <div style={{ display: "flex", gap: 12 }}><Sk w={50} h={12} /><Sk w={50} h={12} /><Sk w={50} h={12} /></div>
                  </div>
                  <Sk w={72} h={30} r={6} />
                </div>
              ))}
            </div>
          ) : todayJobs.length === 0 ? (
            <p style={{ color: "var(--fg-4)", fontSize: 13, margin: "8px 0", textAlign: "center", padding: "20px 0" }}>
              {isToday ? "No jobs today. Start one from Automation." : `No jobs on ${jobsDate}.`}
            </p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
                {todayJobs.map((job) => (
                  <div key={job.id} style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--bg-canvas)", borderRadius: "var(--radius-md)", padding: "12px 16px", border: "1px solid var(--line)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--fg)" }}>@{job.igAccount?.username}</span>
                        <JobStatusPill status={job.status} />
                      </div>
                      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--fg-3)" }}>
                        <span>Total: <b style={{ color: "var(--fg-2)" }}>{job.totalTargets}</b></span>
                        <span>Sent: <b style={{ color: "var(--positive)" }}>{job.sent}</b></span>
                        <span>Failed: <b style={{ color: "var(--accent)" }}>{job.failed}</b></span>
                      </div>
                    </div>
                    <button onClick={() => openAnalyze(job)} style={{
                      padding: "7px 16px", background: "var(--accent-soft)", border: "1px solid var(--accent-line)",
                      borderRadius: "var(--radius-sm)", color: "var(--accent)",
                      fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-body)", whiteSpace: "nowrap",
                    }}>
                      Analyze
                    </button>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 12, color: "var(--fg-3)" }}>
                    Page {jobsPage} of {totalPages} · {jobsTotal} total
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => applyPage(jobsPage - 1)}
                      disabled={jobsPage <= 1}
                      style={{ ...pgBtn, opacity: jobsPage <= 1 ? 0.4 : 1, cursor: jobsPage <= 1 ? "default" : "pointer" }}
                    >
                      ← Prev
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        onClick={() => applyPage(p)}
                        style={{
                          ...pgBtn,
                          background: p === jobsPage ? "var(--accent)" : "var(--bg-canvas)",
                          color: p === jobsPage ? "#1a1917" : "var(--fg-3)",
                          border: `1px solid ${p === jobsPage ? "var(--accent)" : "var(--line)"}`,
                          fontWeight: p === jobsPage ? 700 : 400,
                        }}
                      >
                        {p}
                      </button>
                    ))}
                    <button
                      onClick={() => applyPage(jobsPage + 1)}
                      disabled={jobsPage >= totalPages}
                      style={{ ...pgBtn, opacity: jobsPage >= totalPages ? 0.4 : 1, cursor: jobsPage >= totalPages ? "default" : "pointer" }}
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </ChartCard>

        {/* Analyze modal */}
        {analyzeJob && (
          <AnalyzeModal
            job={analyzeJob}
            records={analyzeRecords}
            loading={analyzeLoading}
            getToken={getToken}
            onClose={() => { setAnalyzeJob(null); setAnalyzeRecords([]); }}
            onRecordsUpdated={(updated) => setAnalyzeRecords((prev) => prev.map((r) => updated.find((u) => u.id === r.id) ?? r))}
          />
        )}
      </div>
    </>
  );
}

// ── Range filter pill group ──────────────────────────────────────────────────
function RangeFilter({ value, onChange }: { value: number; onChange(d: 7 | 14 | 30): void }) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", padding: 2, border: "1px solid var(--line)" }}>
      {([7, 14, 30] as const).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          style={{
            padding: "3px 10px", border: "none", borderRadius: 4,
            fontSize: 11, fontWeight: 700, fontFamily: "var(--font-body)", cursor: "pointer",
            background: value === d ? "var(--accent)" : "transparent",
            color: value === d ? "#1a1917" : "var(--fg-4)",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, description, accent }: { label: string; value: string | number; sub: string; description: string; accent?: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        ...cardS,
        borderTop: accent ? `2px solid ${accent}` : "1px solid var(--line)",
        transform: hovered ? "translateY(-2px)" : "none",
        boxShadow: hovered ? "0 12px 28px rgba(0,0,0,0.18)" : "none",
        transition: "transform 0.15s, box-shadow 0.15s",
        cursor: "default",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={description}
    >
      <div style={{ fontSize: 11, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent ?? "var(--fg)", fontFamily: "var(--font-display)", lineHeight: 1, marginBottom: 5 }}>{value}</div>
      <div style={{ fontSize: 11, color: hovered ? "var(--fg-2)" : "var(--fg-4)" }}>{hovered ? description : sub}</div>
    </div>
  );
}

// ── Chart card wrapper ────────────────────────────────────────────────────────
function ChartCard({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={cardS}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--fg)" }}>{title}</div>
          {sub && <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Analyze modal ─────────────────────────────────────────────────────────────
function AnalyzeModal({ job, records, loading, getToken, onClose, onRecordsUpdated }: {
  job: TodayJob; records: AnalyzeRecord[]; loading: boolean;
  getToken: () => Promise<string | null>;
  onClose(): void; onRecordsUpdated(u: AnalyzeRecord[]): void;
}) {
  const [checking,      setChecking]      = useState(false);
  const [checkDone,     setCheckDone]     = useState(false);
  const [checkProgress, setCheckProgress] = useState(0);
  const [checkError,    setCheckError]    = useState("");
  const [checkStages,   setCheckStages]   = useState<WorkflowStageView[]>(createWorkflowStages("analyze"));
  const [checkTarget,   setCheckTarget]   = useState("");
  const pendingUpdatesRef = useRef<AnalyzeRecord[]>([]);
  const unsubscribeRef    = useRef<(() => void) | null>(null);

  const sentRecords  = records.filter((r) => r.status === "sent");
  const sentCount    = sentRecords.length;
  const failedCount  = records.filter((r) => r.status === "failed").length;
  const seenCount    = records.filter((r) => r.seen).length;
  const repliedCount = records.filter((r) => r.replied).length;

  useEffect(() => {
    if (!checking) return;
    const iv = setInterval(async () => {
      const fresh = await getToken();
      if (fresh) window.worker?.refreshToken(job.igAccountId, fresh).catch(() => undefined);
    }, 45_000);
    return () => clearInterval(iv);
  }, [checking, job.igAccountId, getToken]);

  useEffect(() => () => { unsubscribeRef.current?.(); }, []);

  async function handleCheck() {
    if (checking || sentRecords.length === 0) return;
    setCheckError(""); setChecking(true); setCheckDone(false);
    setCheckProgress(0); setCheckStages(createWorkflowStages("analyze"));
    setCheckTarget(sentRecords[0]?.username ?? "");
    pendingUpdatesRef.current = [];

    const token = await getToken();
    if (!token) { setCheckError("Not authenticated."); setChecking(false); return; }

    const cmd: WorkerCheckCmd = {
      cmd: "check", accountId: job.igAccountId, jobId: job.id,
      sessionDir: `./sessions/${job.igAccountId}`,
      serverUrl: SERVER_URL, authToken: token,
      targets: sentRecords.map((r) => ({ username: r.username, messageRecordId: r.id })),
    };

    unsubscribeRef.current?.();
    const handleMsg = (msg: WorkerMessage) => {
      if (msg.jobId !== job.id) return;
      if (msg.type === "check_result" && msg.checkRecordId) {
        const updated: AnalyzeRecord = { ...records.find((r) => r.id === msg.checkRecordId)!, seen: msg.checkSeen ?? false, replied: msg.checkReplied ?? false, replyPreview: msg.checkReplyPreview ?? null };
        pendingUpdatesRef.current = [...pendingUpdatesRef.current, updated];
        onRecordsUpdated(pendingUpdatesRef.current);
        setCheckProgress((p) => p + 1);
      }
      if (msg.type === "stage" && msg.workflow === "analyze") { setCheckStages((p) => applyStageMessage(p, msg)); setCheckTarget(msg.stageUsername ?? ""); }
      if (msg.type === "check_done") { setChecking(false); setCheckDone(true); unsubscribeRef.current?.(); unsubscribeRef.current = null; }
      if (msg.type === "status" && (msg.status === "error" || msg.status === "stopped")) { setChecking(false); setCheckError("Check stopped or errored."); unsubscribeRef.current?.(); unsubscribeRef.current = null; }
    };
    unsubscribeRef.current = window.worker.onMessage(handleMsg);
    const result = await window.worker.check(cmd);
    if (result.error) { setCheckError(result.error); setChecking(false); unsubscribeRef.current?.(); unsubscribeRef.current = null; }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: "var(--bg-sidebar)", borderRadius: "var(--radius-lg)", border: "1px solid var(--line-hi)", width: "min(860px, 94vw)", maxHeight: "82vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }} onClick={(e) => e.stopPropagation()}>

        {/* Modal header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 18, color: "var(--fg)" }}>Job Analysis — @{job.igAccount?.username}</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-3)" }}>{new Date().toLocaleDateString(undefined, { dateStyle: "long" })}</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {checkError  && <span style={{ fontSize: 11, color: "var(--accent)" }}>{checkError}</span>}
            {checkDone   && <span style={{ fontSize: 11, color: "var(--positive)" }}>Check complete</span>}
            {checking    && <span style={{ fontSize: 11, color: "var(--info)" }}>Checking {checkProgress}/{sentRecords.length}…</span>}
            {!loading && sentRecords.length > 0 && (
              <button onClick={handleCheck} disabled={checking} style={{ padding: "7px 14px", background: checking ? "var(--bg-canvas)" : "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: "var(--radius-sm)", color: checking ? "var(--fg-4)" : "var(--accent)", fontSize: 12, fontWeight: 600, cursor: checking ? "default" : "pointer", fontFamily: "var(--font-body)" }}>
                {checking ? "Checking…" : "Check Seen/Replied"}
              </button>
            )}
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--fg-3)", fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>×</button>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, borderBottom: "1px solid var(--line)", background: "var(--line)" }}>
          {[
            { label: "Sent",    value: sentCount,    color: "var(--positive)" },
            { label: "Failed",  value: failedCount,  color: "var(--accent)" },
            { label: "Seen",    value: seenCount,    color: "var(--info)" },
            { label: "Replied", value: repliedCount, color: "var(--warning)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "var(--bg-sidebar)", padding: "14px 20px" }}>
              <div style={{ fontSize: 11, color: "var(--fg-3)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 700, color, fontFamily: "var(--font-display)" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Records table */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 20px" }}>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <Sk w={100} h={13} /><Sk w={55} h={20} r={99} /><Sk w={45} h={13} /><Sk w={45} h={13} /><Sk w={180} h={13} /><Sk w={50} h={13} />
                </div>
              ))}
            </div>
          ) : records.length === 0 ? (
            <p style={{ color: "var(--fg-4)", padding: "24px 0", textAlign: "center", fontSize: 13 }}>No message records for this job.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginTop: 16 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--line-hi)" }}>
                  {["Username","Status","Seen","Replied","Message","Time"].map((h) => (
                    <th key={h} style={{ padding: "7px 10px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--fg-4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "9px 10px", color: "var(--fg)", fontWeight: 500 }}>@{r.username}</td>
                    <td style={{ padding: "9px 10px" }}><MsgBadge status={r.status} /></td>
                    <td style={{ padding: "9px 10px" }}>{r.seen ? <span style={{ color: "var(--info)", fontWeight: 600, fontSize: 12 }}>✓ Seen</span> : <span style={{ color: "var(--fg-4)", fontSize: 12 }}>—</span>}</td>
                    <td style={{ padding: "9px 10px" }}>{r.replied ? <span style={{ color: "var(--warning)", fontWeight: 600, fontSize: 12 }}>✓ Replied</span> : <span style={{ color: "var(--fg-4)", fontSize: 12 }}>—</span>}</td>
                    <td style={{ padding: "9px 10px", maxWidth: 220, color: "var(--fg-2)" }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.messageSent ?? ""}>{r.messageSent ?? "—"}</span>
                    </td>
                    <td style={{ padding: "9px 10px", color: "var(--fg-3)", fontSize: 12, whiteSpace: "nowrap" }}>{new Date(r.sentAt).toLocaleTimeString(undefined, { timeStyle: "short" })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <WorkflowOverlay
          open={checking}
          title="Headless conversation analysis running"
          subtitle="Opening each profile in the background, reading the chat thread, and saving seen/reply status."
          targetLabel={checkTarget ? `Current target: @${checkTarget}` : undefined}
          progressLabel={sentRecords.length > 0 ? `${checkProgress}/${sentRecords.length} checked` : undefined}
          stages={checkStages}
        />
      </div>
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────
function JobStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    running: { bg: "rgba(154,194,138,0.15)", color: "var(--positive)" },
    done:    { bg: "rgba(154,194,138,0.15)", color: "var(--positive)" },
    stopped: { bg: "rgba(224,176,114,0.15)", color: "var(--warning)" },
    error:   { bg: "var(--accent-soft)",     color: "var(--accent)" },
  };
  const s = map[status] ?? map.error;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.color, ...(status === "running" ? { animation: "skpulse 1.4s ease-in-out infinite" } : {}) }} />
      {status}
    </span>
  );
}

function MsgBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    sent:    { bg: "rgba(154,194,138,0.15)", color: "var(--positive)" },
    failed:  { bg: "var(--accent-soft)",     color: "var(--accent)" },
    skipped: { bg: "rgba(127,163,194,0.15)", color: "var(--info)" },
  };
  const s = map[status] ?? { bg: "var(--line)", color: "var(--fg-3)" };
  return <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "var(--radius-full)", fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>{status}</span>;
}

const cardS: React.CSSProperties = { background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: "18px 20px", border: "1px solid var(--line)" };
const ghostBtn: React.CSSProperties = { padding: "6px 14px", background: "none", border: "1px solid var(--line-hi)", borderRadius: "var(--radius-sm)", color: "var(--fg-2)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-body)" };
const pgBtn: React.CSSProperties = { padding: "4px 10px", background: "var(--bg-canvas)", color: "var(--fg-3)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", fontSize: 12, fontFamily: "var(--font-body)", cursor: "pointer" };
const fieldLabel: React.CSSProperties = { display: "block", marginBottom: 6, fontSize: 12, fontWeight: 700, color: "var(--fg-2)" };
const fieldHint: React.CSSProperties = { marginTop: 5, fontSize: 11, color: "var(--fg-4)" };
const fieldInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  background: "var(--bg-input)",
  color: "var(--fg)",
  border: "1px solid var(--line-hi)",
  borderRadius: "var(--radius-sm)",
  fontSize: 13,
  fontFamily: "var(--font-body)",
};
