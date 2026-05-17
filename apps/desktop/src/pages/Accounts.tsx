import { useEffect, useState } from "react";
import api from "../api/client";
import { usePlanStore } from "../store/plan";
import { PLAN_LIMITS } from "@insta-saas/shared";
import type { IgAccount, WorkerConnectCmd, WorkerMessage } from "@insta-saas/shared";
import LoadingState from "../components/ui/loading-state";

export default function Accounts() {
  const plan = usePlanStore((s) => s.plan) ?? "free";
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [username, setUsername] = useState("");
  const [proxy, setProxy] = useState("");
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [loginStatus, setLoginStatus] = useState<Record<string, string>>({});

  const limit = PLAN_LIMITS[plan].maxAccounts;

  function load() {
    api.get<{ accounts: IgAccount[] }>("/accounts").then((r) => setAccounts(r.data.accounts)).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    window.worker?.onMessage((msg: WorkerMessage) => {
      if (msg.type === "status") {
        setLoginStatus((prev) => ({ ...prev, [msg.accountId]: msg.status ?? "" }));
        if (msg.status === "done") api.patch(`/accounts/${msg.accountId}/status`, { status: "active" }).then(load);
        else if (msg.status === "error") api.patch(`/accounts/${msg.accountId}/status`, { status: "error" }).catch(() => {});
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
    const result = await window.worker.connect({ cmd: "connect", accountId, sessionDir: `./sessions/${accountId}` });
    if (result.error) setLoginStatus((prev) => ({ ...prev, [accountId]: "error" }));
  }

  async function handleDelete(id: string, uname: string) {
    if (!confirm(`Remove @${uname}?`)) return;
    await api.delete(`/accounts/${id}`); load();
  }

  const atLimit = accounts.length >= limit;

  return (
    <div style={{ padding: 28, maxWidth: 700, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>Accounts</h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-3)" }}>{accounts.length} / {limit} connected</p>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} disabled={atLimit} style={{
          padding: "8px 18px", background: atLimit ? "var(--bg-card)" : "var(--accent)",
          color: atLimit ? "var(--fg-4)" : "#1a1917",
          border: "none", borderRadius: "var(--radius-sm)", cursor: atLimit ? "default" : "pointer",
          fontWeight: 600, fontSize: 13, fontFamily: "var(--font-body)",
        }}>
          {atLimit ? `Limit (${limit})` : "+ Add Account"}
        </button>
      </div>

      {showAdd && (
        <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 22, marginBottom: 20, border: "1px solid var(--line-hi)" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 15, color: "var(--fg)", fontFamily: "var(--font-display)" }}>Add Instagram Account</h3>
          <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--fg-3)" }}>
            No password stored. After adding, click Login to open a browser and sign in once.
          </p>
          <form onSubmit={handleAdd}>
            <input placeholder="Instagram username" value={username} onChange={(e) => setUsername(e.target.value)} required style={inp} />
            <input placeholder="Proxy (optional)" value={proxy} onChange={(e) => setProxy(e.target.value)} style={inp} />
            {addError && <p style={{ color: "var(--accent)", fontSize: 12, margin: "-4px 0 12px" }}>{addError}</p>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" disabled={addLoading} style={btnPrimary}>{addLoading ? "Adding…" : "Add"}</button>
              <button type="button" onClick={() => { setShowAdd(false); setAddError(""); }} style={btnGhost}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {accounts.length === 0 ? (
        <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 40, textAlign: "center", border: "1px solid var(--line)" }}>
          <p style={{ margin: 0, color: "var(--fg-3)", fontSize: 13 }}>No accounts added yet.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {accounts.map((a) => {
            const ls = loginStatus[a.id];
            const isLoggingIn = ls === "pending" || ls === "running";
            const statusColor = a.status === "active" ? "var(--positive)" : a.status === "error" ? "var(--accent)" : "var(--warning)";

            return (
              <div key={a.id} style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid var(--line)" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: "var(--fg)" }}>@{a.username}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: "var(--radius-full)", background: `color-mix(in srgb, ${statusColor} 12%, transparent)`, fontSize: 11, fontWeight: 600, color: statusColor }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor }} />
                      {a.status}
                    </span>
                  </div>
                  {a.proxy && <p style={{ margin: 0, fontSize: 11, color: "var(--fg-4)" }}>proxy: {a.proxy}</p>}
                  {ls === "done"  && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--positive)" }}>Login successful — session saved.</p>}
                  {ls === "error" && <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--accent)" }}>Login failed. Try again.</p>}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => handleLogin(a.id)} disabled={isLoggingIn} style={{ ...btnGhost, fontSize: 12, padding: "6px 14px", ...(isLoggingIn ? { opacity: 0.5 } : {}) }}>
                    {isLoggingIn ? "Browser open…" : a.status === "active" ? "Re-login" : "Login"}
                  </button>
                  <button onClick={() => handleDelete(a.id, a.username)} style={{ ...btnGhost, fontSize: 12, padding: "6px 14px", color: "var(--accent)", borderColor: "var(--accent-line)" }}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {loading && (
        <LoadingState
          overlay
          title="Loading accounts"
          subtitle="Checking connected Instagram profiles and saved sessions."
        />
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  display: "block", width: "100%", padding: "9px 12px", marginBottom: 10,
  background: "var(--bg-input)", border: "1px solid var(--line-hi)",
  borderRadius: "var(--radius-sm)", fontSize: 13, color: "var(--fg)",
  outline: "none",
};
const btnBase: React.CSSProperties = {
  padding: "8px 18px", border: "none", borderRadius: "var(--radius-sm)",
  cursor: "pointer", fontWeight: 600, fontSize: 13, fontFamily: "var(--font-body)",
};
const btnPrimary: React.CSSProperties = { ...btnBase, background: "var(--accent)", color: "#1a1917" };
const btnGhost: React.CSSProperties = { ...btnBase, background: "none", border: "1px solid var(--line-hi)", color: "var(--fg-2)" };
