import { useEffect, useState } from "react";
import api from "../api/client";
import { usePlanStore } from "../store/plan";
import { PLAN_LIMITS } from "@insta-saas/shared";
import type { IgAccount, WorkerConnectCmd, WorkerMessage } from "@insta-saas/shared";

const pulseKf = `@keyframes skpulse { 0%,100%{opacity:1} 50%{opacity:.35} }`;

function Sk({ w, h, r = 5 }: { w: string | number; h: number; r?: number }) {
  return <div style={{ width: w, height: h, borderRadius: r, background: "var(--bg-canvas)", animation: "skpulse 1.6s ease-in-out infinite", flexShrink: 0 }} />;
}

export default function Accounts() {
  const plan  = usePlanStore((s) => s.plan) ?? "free";
  const limit = PLAN_LIMITS[plan].maxAccounts;

  const [accounts,    setAccounts]    = useState<IgAccount[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showAdd,     setShowAdd]     = useState(false);
  const [username,    setUsername]    = useState("");
  const [proxy,       setProxy]       = useState("");
  const [addError,    setAddError]    = useState("");
  const [addLoading,  setAddLoading]  = useState(false);
  const [loginStatus, setLoginStatus] = useState<Record<string, string>>({});

  function load() {
    api.get<{ accounts: IgAccount[] }>("/accounts")
      .then((r) => setAccounts(r.data.accounts))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    window.worker?.onMessage((msg: WorkerMessage) => {
      if (msg.type === "status") {
        setLoginStatus((prev) => ({ ...prev, [msg.accountId]: msg.status ?? "" }));
        if (msg.status === "done")  api.patch(`/accounts/${msg.accountId}/status`, { status: "active" }).then(load);
        if (msg.status === "error") api.patch(`/accounts/${msg.accountId}/status`, { status: "error" }).catch(() => {});
      }
    });
    return () => window.worker?.offMessage();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError(""); setAddLoading(true);
    try {
      await api.post("/accounts/connect", { username: username.replace(/^@/, ""), proxy: proxy.trim() || undefined });
      setShowAdd(false); setUsername(""); setProxy(""); load();
    } catch (err: any) {
      setAddError(err.response?.data?.error ?? "Failed to add account.");
    } finally { setAddLoading(false); }
  }

  async function handleLogin(accountId: string) {
    setLoginStatus((prev) => ({ ...prev, [accountId]: "pending" }));
    const result = await window.worker.connect({ cmd: "connect", accountId, sessionDir: `./sessions/${accountId}` } as WorkerConnectCmd);
    if (result.error) setLoginStatus((prev) => ({ ...prev, [accountId]: "error" }));
  }

  async function handleDelete(id: string, uname: string) {
    if (!confirm(`Remove @${uname}?`)) return;
    await api.delete(`/accounts/${id}`); load();
  }

  const atLimit = accounts.length >= limit;

  return (
    <>
      <style>{pulseKf}</style>
      <div style={{ padding: "28px 32px", maxWidth: 720, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.3px" }}>
              Accounts
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-3)" }}>
              {loading ? <Sk w={80} h={12} /> : <>{accounts.length} / {limit} connected</>}
            </p>
          </div>
          <button
            onClick={() => setShowAdd((v) => !v)}
            disabled={atLimit || loading}
            style={{
              padding: "8px 18px",
              background: atLimit || loading ? "var(--bg-card)" : "var(--accent)",
              color: atLimit || loading ? "var(--fg-4)" : "#1a1917",
              border: "none", borderRadius: "var(--radius-sm)",
              cursor: atLimit || loading ? "default" : "pointer",
              fontWeight: 700, fontSize: 13, fontFamily: "var(--font-body)",
            }}
          >
            {atLimit ? `Limit (${limit})` : "+ Add Account"}
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 22, marginBottom: 20, border: "1px solid var(--line-hi)" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15, color: "var(--fg)", fontFamily: "var(--font-display)" }}>Add Instagram Account</h3>
            <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--fg-3)" }}>
              No password stored. After adding, click Login to open a browser and sign in once.
            </p>
            <form onSubmit={handleAdd}>
              <input
                placeholder="Instagram username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                style={inp}
              />
              <input
                placeholder="Proxy (optional)  e.g. http://user:pass@host:port"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                style={inp}
              />
              {addError && (
                <p style={{ color: "var(--accent)", fontSize: 12, margin: "-4px 0 12px", padding: "8px 12px", background: "var(--accent-soft)", borderRadius: "var(--radius-sm)" }}>
                  {addError}
                </p>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" disabled={addLoading} style={btnPrimary}>
                  {addLoading ? "Adding…" : "Add Account"}
                </button>
                <button type="button" onClick={() => { setShowAdd(false); setAddError(""); }} style={btnGhost}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Account list */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: "16px 18px", border: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Sk w={120} h={15} />
                    <Sk w={60} h={20} r={99} />
                  </div>
                  <Sk w={160} h={11} />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Sk w={72} h={32} r={6} />
                  <Sk w={72} h={32} r={6} />
                </div>
              </div>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: "48px 32px", textAlign: "center", border: "1px solid var(--line)" }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.35 }}>◎</div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14, color: "var(--fg)" }}>No accounts connected</p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>Click "+ Add Account" to get started.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {accounts.map((a) => {
              const ls = loginStatus[a.id];
              const isLoggingIn  = ls === "pending" || ls === "running";
              const statusColor  =
                a.status === "active" ? "var(--positive)"
                : a.status === "error" ? "var(--accent)"
                : "var(--warning)";
              const initials = a.username.slice(0, 2).toUpperCase();

              return (
                <div key={a.id} style={{
                  background: "var(--bg-card)", borderRadius: "var(--radius-md)",
                  padding: "14px 18px", display: "flex", justifyContent: "space-between",
                  alignItems: "center", border: "1px solid var(--line)",
                  transition: "border-color 0.15s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {/* Avatar */}
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                      background: "var(--bg-canvas)", border: `2px solid ${statusColor}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 13,
                      color: statusColor,
                    }}>
                      {initials}
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: "var(--fg)" }}>@{a.username}</span>
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "2px 8px", borderRadius: "var(--radius-full)",
                          background: `color-mix(in srgb, ${statusColor} 12%, transparent)`,
                          fontSize: 10, fontWeight: 700, color: statusColor, letterSpacing: "0.04em",
                        }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor }} />
                          {a.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--fg-4)" }}>
                        {a.proxy ? `proxy: ${a.proxy}` : "No proxy"}
                        {a.lastActiveAt && <span style={{ marginLeft: 10 }}>Last active: {new Date(a.lastActiveAt).toLocaleDateString()}</span>}
                      </div>
                      {ls === "done"  && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--positive)" }}>Login successful — session saved.</p>}
                      {ls === "error" && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--accent)" }}>Login failed. Try again.</p>}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <button
                      onClick={() => handleLogin(a.id)}
                      disabled={isLoggingIn}
                      style={{ ...btnGhost, fontSize: 12, padding: "6px 14px", opacity: isLoggingIn ? 0.5 : 1, cursor: isLoggingIn ? "default" : "pointer" }}
                    >
                      {isLoggingIn ? "Browser open…" : a.status === "active" ? "Re-login" : "Login"}
                    </button>
                    <button
                      onClick={() => handleDelete(a.id, a.username)}
                      style={{ ...btnGhost, fontSize: 12, padding: "6px 14px", color: "var(--accent)", borderColor: "rgba(220,53,69,0.3)" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "9px 12px", marginBottom: 10,
  background: "var(--bg-input)", border: "1px solid var(--line-hi)",
  borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--fg)",
  outline: "none", boxSizing: "border-box", fontFamily: "var(--font-body)",
};
const btnBase: React.CSSProperties = { padding: "8px 18px", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontWeight: 700, fontSize: 13, fontFamily: "var(--font-body)" };
const btnPrimary: React.CSSProperties = { ...btnBase, background: "var(--accent)", color: "#1a1917" };
const btnGhost: React.CSSProperties   = { ...btnBase, background: "none", border: "1px solid var(--line-hi)", color: "var(--fg-2)" };
