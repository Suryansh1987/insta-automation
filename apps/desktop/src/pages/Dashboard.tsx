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

function Sk({ w, h, r = 5 }: { w: string | number; h: number; r?: number }) {
  return (
    <div
      className="animate-skpulse bg-canvas shrink-0"
      style={{ width: w, height: h, borderRadius: r }}
    />
  );
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

  const [chartDays, setChartDays]   = useState<7 | 14 | 30>(7);
  const [jobsDate,  setJobsDate]    = useState(todayISO());
  const [jobsPage,  setJobsPage]    = useState(1);

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

  useEffect(() => { fetchData(); fetchPreferences(); }, []);

  function applyChartDays(d: 7 | 14 | 30) { setChartDays(d); setJobsPage(1); fetchData({ days: d, page: 1 }); }
  function applyJobsDate(date: string)      { setJobsDate(date); setJobsPage(1); fetchData({ date, page: 1 }); }
  function applyPage(page: number)          { setJobsPage(page); fetchData({ page }); }

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
    <div className="p-7 max-w-[1100px] mx-auto">

      {/* Header */}
      <div className="mb-7">
        <h1 className="m-0 font-display text-[22px] font-bold text-fg tracking-tight">Dashboard</h1>
        <p className="mt-1 text-[13px] text-fg-3">
          Welcome back,{" "}
          <strong className="font-semibold" style={{ color: "var(--fg-2)" }}>
            {user?.primaryEmailAddress?.emailAddress}
          </strong>
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 mb-7">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={CARD}>
                <Sk w={60} h={11} />
                <div className="mt-3"><Sk w={80} h={30} r={4} /></div>
                <div className="mt-2"><Sk w={100} h={11} /></div>
              </div>
            ))
          : <>
              <KPICard label="Plan"          value={limits.label}       sub={limits.price}              accent="var(--accent)"    description="Your current subscription tier." />
              <KPICard label="Total jobs"    value={totals.jobs}        sub="all time"                  description="Automation runs created on this workspace." />
              <KPICard label="Messages sent" value={totals.sent}        sub="all time"                  accent="var(--positive)"  description="Total DMs successfully delivered." />
              <KPICard label="Success rate"  value={`${successRate}%`}  sub={`${totals.failed} failed`} accent={successRate >= 70 ? "var(--positive)" : "var(--warning)"} description="Share of attempted messages that succeeded." />
            </>
        }
      </div>

      {/* Messaging preferences */}
      <ChartCard
        title="Messaging Preferences"
        sub="Set the name, tone, and AI instructions used for personalized DMs."
        action={
          <button
            onClick={savePreferences}
            disabled={preferencesLoading || preferencesSaving}
            className="px-3.5 py-1.5 text-xs font-semibold rounded border-2 transition-all duration-150"
            style={{
              background:  preferencesSaving ? "var(--bg-canvas)" : "var(--accent-soft)",
              borderColor: preferencesSaving ? "var(--line)"      : "var(--accent-line)",
              color:       preferencesSaving ? "var(--fg-4)"      : "var(--accent)",
              cursor:      preferencesLoading || preferencesSaving ? "default" : "pointer",
            }}
          >
            {preferencesSaving ? "Saving…" : "Save preferences"}
          </button>
        }
      >
        {preferencesLoading ? (
          <div className="grid grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-2"><Sk w={110} h={12} /><Sk w="100%" h={40} r={4} /></div>
            <div className="flex flex-col gap-2"><Sk w={90}  h={12} /><Sk w="100%" h={40} r={4} /></div>
            <div className="col-span-2 flex flex-col gap-2"><Sk w={140} h={12} /><Sk w="100%" h={88} r={4} /></div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className={FIELD_LABEL}>Your Name</label>
              <input
                value={preferences.senderName}
                onChange={(e) => patchPreferences({ senderName: e.target.value })}
                placeholder="Warmly, Aayush"
                className={FIELD_INPUT}
              />
              <div className={FIELD_HINT}>This name is used in the DM sign-off.</div>
            </div>
            <div>
              <label className={FIELD_LABEL}>Tone</label>
              <input
                value={preferences.tone}
                onChange={(e) => patchPreferences({ tone: e.target.value })}
                placeholder="Warm, thoughtful, friendly"
                className={FIELD_INPUT}
              />
              <div className={FIELD_HINT}>Example: warm, playful, confident, softly professional.</div>
            </div>
            <div className="col-span-2">
              <label className={FIELD_LABEL}>Custom Prompt</label>
              <textarea
                value={preferences.customPrompt}
                onChange={(e) => patchPreferences({ customPrompt: e.target.value })}
                placeholder="Write like a real human, keep it short, and avoid sounding salesy."
                rows={4}
                className={`${FIELD_INPUT} resize-y`}
              />
              <div className={FIELD_HINT}>Extra instructions for AI-personalized messages.</div>
            </div>
          </div>
        )}
      </ChartCard>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4 mb-7">
        <ChartCard
          title="Messages per day"
          sub={`Last ${chartDays} days`}
          action={<RangeFilter value={chartDays} onChange={applyChartDays} />}
        >
          {loading ? (
            <div className="h-[180px] flex items-end gap-1 overflow-hidden">
              {Array.from({ length: chartDays > 14 ? 10 : 7 }).map((_, i) => (
                <div key={i} className="flex-1 animate-skpulse bg-canvas rounded" style={{ height: 40 + (i % 3) * 30 }} />
              ))}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={daily} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--bg-card)", border: "2px solid var(--line-hi)", borderRadius: 4, color: "var(--fg)", fontSize: 12 }} labelFormatter={dateLabel as any} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--fg-2)" }} />
                <Bar dataKey="sent"   fill="var(--positive)" radius={[4,4,0,0]} name="Sent" />
                <Bar dataKey="failed" fill="var(--warning)"  radius={[4,4,0,0]} name="Failed" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Seen vs replied"
          sub={`Conversation outcomes · last ${chartDays} days`}
          action={<RangeFilter value={chartDays} onChange={applyChartDays} />}
        >
          {loading ? (
            <div className="h-[180px] rounded animate-skpulse bg-canvas" />
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="seenGrad"  x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--info)"   stopOpacity={0.28} />
                    <stop offset="95%" stopColor="var(--info)"   stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="replyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--accent)" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="date" tickFormatter={dateLabel} tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "var(--fg-3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "var(--bg-card)", border: "2px solid var(--line-hi)", borderRadius: 4, color: "var(--fg)", fontSize: 12 }} labelFormatter={dateLabel as any} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "var(--fg-2)" }} />
                <Area type="monotone" dataKey="seen"    stroke="var(--info)"   fill="url(#seenGrad)"  strokeWidth={2} name="Seen"    dot={false} />
                <Area type="monotone" dataKey="replied" stroke="var(--accent)" fill="url(#replyGrad)" strokeWidth={2} name="Replied" dot={false} />
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
          <div className="flex gap-2 items-center">
            <input
              type="date"
              value={jobsDate}
              max={todayISO()}
              onChange={(e) => e.target.value && applyJobsDate(e.target.value)}
              className="px-2.5 py-1.5 rounded text-xs font-body cursor-pointer border-2 bg-input text-fg outline-none"
              style={{ borderColor: "var(--line-hi)", colorScheme: "dark" }}
            />
            <button onClick={() => navigate("/automation")} className={GHOST_BTN}>+ New job</button>
          </div>
        }
      >
        {loading ? (
          <div className="flex flex-col gap-2 mt-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3.5 bg-canvas rounded-md px-4 py-3 border-2 border-line">
                <div className="flex-1 flex flex-col gap-2">
                  <div className="flex gap-2"><Sk w={120} h={14} /><Sk w={60} h={18} r={99} /></div>
                  <div className="flex gap-3"><Sk w={50} h={12} /><Sk w={50} h={12} /><Sk w={50} h={12} /></div>
                </div>
                <Sk w={72} h={30} r={4} />
              </div>
            ))}
          </div>
        ) : todayJobs.length === 0 ? (
          <p className="text-fg-4 text-[13px] my-2 text-center py-5">
            {isToday ? "No jobs today. Start one from Automation." : `No jobs on ${jobsDate}.`}
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2 mt-1">
              {todayJobs.map((job) => (
                <div key={job.id} className="flex items-center gap-3.5 bg-canvas rounded-md px-4 py-3 border-2 border-line">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-[14px] text-fg">@{job.igAccount?.username}</span>
                      <JobStatusPill status={job.status} />
                    </div>
                    <div className="flex gap-4 text-xs text-fg-3">
                      <span>Total: <b className="text-fg-2">{job.totalTargets}</b></span>
                      <span>Sent: <b style={{ color: "var(--positive)" }}>{job.sent}</b></span>
                      <span>Failed: <b style={{ color: "var(--warning)" }}>{job.failed}</b></span>
                    </div>
                  </div>
                  <button
                    onClick={() => openAnalyze(job)}
                    className="px-4 py-1.5 text-xs font-bold rounded cursor-pointer border-2 transition-all hover:-translate-x-px hover:-translate-y-px"
                    style={{ background: "var(--accent-soft)", borderColor: "var(--accent-line)", color: "var(--accent)" }}
                  >
                    Analyze
                  </button>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-3.5 pt-3" style={{ borderTop: "2px solid var(--line)" }}>
                <span className="text-xs text-fg-3">Page {jobsPage} of {totalPages} · {jobsTotal} total</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => applyPage(jobsPage - 1)}
                    disabled={jobsPage <= 1}
                    className={`${PG_BTN} ${jobsPage <= 1 ? "opacity-40 cursor-default" : "hover:-translate-x-px hover:-translate-y-px"}`}
                  >← Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      onClick={() => applyPage(p)}
                      className="px-2.5 py-1 text-xs border-2 rounded font-body cursor-pointer"
                      style={{
                        background:  p === jobsPage ? "var(--accent)"    : "var(--bg-canvas)",
                        color:       p === jobsPage ? "#0A0A0A"          : "var(--fg-3)",
                        borderColor: p === jobsPage ? "var(--accent)"    : "var(--line)",
                        fontWeight:  p === jobsPage ? 700 : 400,
                      }}
                    >{p}</button>
                  ))}
                  <button
                    onClick={() => applyPage(jobsPage + 1)}
                    disabled={jobsPage >= totalPages}
                    className={`${PG_BTN} ${jobsPage >= totalPages ? "opacity-40 cursor-default" : "hover:-translate-x-px hover:-translate-y-px"}`}
                  >Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </ChartCard>

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
  );
}

// ── Range filter ──────────────────────────────────────────────────────────────
function RangeFilter({ value, onChange }: { value: number; onChange(d: 7 | 14 | 30): void }) {
  return (
    <div className="flex gap-0.5 rounded p-0.5 border-2 border-line bg-canvas">
      {([7, 14, 30] as const).map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className="px-2.5 py-0.5 rounded text-[11px] font-bold font-body cursor-pointer border-none transition-all duration-150"
          style={{
            background: value === d ? "var(--accent)" : "transparent",
            color:      value === d ? "#0A0A0A" : "var(--fg-4)",
          }}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, description, accent }: { label: string; value: string | number; sub: string; description: string; accent?: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`${CARD} cursor-default transition-all duration-150 ${hovered ? "-translate-x-0.5 -translate-y-0.5 shadow-lift-sm" : ""}`}
      style={accent ? { borderTop: `3px solid ${accent}` } : {}}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={description}
    >
      <div className="text-[11px] text-fg-4 uppercase tracking-[0.08em] mb-2.5 font-mono">{label}</div>
      <div className="text-[28px] font-extrabold font-display leading-none mb-1.5" style={{ color: accent ?? "var(--fg)" }}>
        {value}
      </div>
      <div className="text-[11px]" style={{ color: hovered ? "var(--fg-2)" : "var(--fg-4)" }}>
        {hovered ? description : sub}
      </div>
    </div>
  );
}

// ── Chart card wrapper ────────────────────────────────────────────────────────
function ChartCard({ title, sub, children, action }: { title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={`${CARD} mb-4`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="font-display font-bold text-[14px] text-fg">{title}</div>
          {sub && <div className="text-[11px] text-fg-3 mt-0.5">{sub}</div>}
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
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>;
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
      const fresh = await getToken({ skipCache: true });
      if (fresh) window.worker?.refreshToken(job.igAccountId, fresh).catch(() => undefined);
    }, 25_000);
    return () => clearInterval(iv);
  }, [checking, job.igAccountId, getToken]);

  useEffect(() => () => { unsubscribeRef.current?.(); }, []);

  async function handleCheck() {
    if (checking || sentRecords.length === 0) return;
    setCheckError(""); setChecking(true); setCheckDone(false);
    setCheckProgress(0); setCheckStages(createWorkflowStages("analyze"));
    setCheckTarget(sentRecords[0]?.username ?? "");
    pendingUpdatesRef.current = [];

    const token = await getToken({ skipCache: true });
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[1000]" onClick={onClose}>
      <div
        className="bg-sidebar rounded-md border-2 border-line-hi shadow-hard-lg flex flex-col"
        style={{ width: "min(860px, 94vw)", maxHeight: "82vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 flex justify-between items-start" style={{ borderBottom: "2px solid var(--line)" }}>
          <div>
            <h2 className="m-0 font-display text-[18px] font-bold text-fg">
              Job Analysis — @{job.igAccount?.username}
            </h2>
            <p className="mt-1 text-xs text-fg-3">
              {new Date().toLocaleDateString(undefined, { dateStyle: "long" })}
            </p>
          </div>
          <div className="flex gap-2.5 items-center">
            {checkError  && <span className="text-[11px] text-warning">{checkError}</span>}
            {checkDone   && <span className="text-[11px] text-positive">Check complete</span>}
            {checking    && <span className="text-[11px] text-info">Checking {checkProgress}/{sentRecords.length}…</span>}
            {!loading && sentRecords.length > 0 && (
              <button
                onClick={handleCheck}
                disabled={checking}
                className="px-3.5 py-1.5 text-xs font-bold rounded cursor-pointer border-2 transition-all"
                style={{
                  background:  checking ? "var(--bg-canvas)" : "var(--accent-soft)",
                  borderColor: checking ? "var(--line)"      : "var(--accent-line)",
                  color:       checking ? "var(--fg-4)"      : "var(--accent)",
                }}
              >
                {checking ? "Checking…" : "Check Seen/Replied"}
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-xl cursor-pointer rounded border-2 border-line-hi bg-transparent text-fg-3"
            >×</button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4" style={{ gap: "1px", background: "var(--line)", borderBottom: "2px solid var(--line)" }}>
          {[
            { label: "Sent",    value: sentCount,    color: "var(--positive)" },
            { label: "Failed",  value: failedCount,  color: "var(--warning)"  },
            { label: "Seen",    value: seenCount,    color: "var(--info)"     },
            { label: "Replied", value: repliedCount, color: "var(--accent)"   },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-sidebar px-5 py-3.5">
              <div className="text-[11px] text-fg-3 mb-1 uppercase tracking-[0.06em] font-mono">{label}</div>
              <div className="text-[26px] font-bold font-display" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Records */}
        <div className="flex-1 overflow-y-auto px-6 pb-5">
          {loading ? (
            <div className="flex flex-col gap-2.5 mt-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-3 items-center">
                  <Sk w={100} h={13} /><Sk w={55} h={20} r={99} /><Sk w={45} h={13} /><Sk w={45} h={13} /><Sk w={180} h={13} /><Sk w={50} h={13} />
                </div>
              ))}
            </div>
          ) : records.length === 0 ? (
            <p className="text-fg-4 py-6 text-center text-[13px]">No message records for this job.</p>
          ) : (
            <table className="w-full border-collapse text-[13px] mt-4">
              <thead>
                <tr style={{ borderBottom: "2px solid var(--line-hi)" }}>
                  {["Username","Status","Seen","Replied","Message","Time"].map((h) => (
                    <th key={h} className="px-2.5 py-1.5 text-left text-[11px] font-bold text-fg-4 tracking-[0.06em] uppercase font-mono">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td className="px-2.5 py-2 text-fg font-medium">@{r.username}</td>
                    <td className="px-2.5 py-2"><MsgBadge status={r.status} /></td>
                    <td className="px-2.5 py-2">
                      {r.seen ? <span className="text-positive font-bold text-xs">✓ Seen</span> : <span className="text-fg-4 text-xs">—</span>}
                    </td>
                    <td className="px-2.5 py-2">
                      {r.replied ? <span className="text-accent font-bold text-xs">✓ Replied</span> : <span className="text-fg-4 text-xs">—</span>}
                    </td>
                    <td className="px-2.5 py-2 max-w-[220px] text-fg-2">
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap" title={r.messageSent ?? ""}>{r.messageSent ?? "—"}</span>
                    </td>
                    <td className="px-2.5 py-2 text-fg-3 text-xs whitespace-nowrap">
                      {new Date(r.sentAt).toLocaleTimeString(undefined, { timeStyle: "short" })}
                    </td>
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
    running: { bg: "rgba(168,232,64,0.12)",  color: "var(--positive)" },
    done:    { bg: "rgba(168,232,64,0.12)",  color: "var(--positive)" },
    stopped: { bg: "rgba(224,176,114,0.12)", color: "var(--warning)"  },
    error:   { bg: "rgba(224,176,114,0.12)", color: "var(--warning)"  },
  };
  const s = map[status] ?? map.error;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: s.bg, color: s.color }}>
      <span className="w-1 h-1 rounded-full" style={{ background: s.color, ...(status === "running" ? { animation: "skpulse 1.4s ease-in-out infinite" } : {}) }} />
      {status}
    </span>
  );
}

function MsgBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    sent:    { bg: "rgba(168,232,64,0.12)",  color: "var(--positive)" },
    failed:  { bg: "rgba(224,176,114,0.12)", color: "var(--warning)"  },
    skipped: { bg: "rgba(127,163,194,0.12)", color: "var(--info)"     },
  };
  const s = map[status] ?? { bg: "var(--line)", color: "var(--fg-3)" };
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-bold" style={{ background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

// ── Class constants ───────────────────────────────────────────────────────────
const CARD        = "bg-card rounded-md px-5 py-[18px] border-2 border-line-hi shadow-hard-sm";
const GHOST_BTN   = "px-3.5 py-1.5 text-xs font-semibold border-2 border-line-hi rounded text-fg-2 bg-transparent cursor-pointer transition-all duration-150 hover:-translate-x-px hover:-translate-y-px";
const PG_BTN      = "px-2.5 py-1 text-xs border-2 border-line rounded bg-canvas text-fg-3 cursor-pointer font-body transition-all";
const FIELD_LABEL = "block mb-1.5 text-xs font-bold text-fg-2";
const FIELD_HINT  = "mt-1 text-[11px] text-fg-4";
const FIELD_INPUT = "w-full box-border px-3 py-2.5 bg-input border-2 border-line-hi rounded text-fg text-[13px] font-body outline-none";
