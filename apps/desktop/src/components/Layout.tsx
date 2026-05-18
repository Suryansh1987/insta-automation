import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useUser, useClerk } from "@clerk/clerk-react";
import { usePlanStore } from "../store/plan";
import { useAutomationStore } from "../store/automation";
import { PLAN_LIMITS } from "@insta-saas/shared";
import type { WorkerMessage } from "@insta-saas/shared";
import Toaster from "./ui/Toaster";
import BrandMark from "./BrandMark";

const NAV_LINKS = [
  { to: "/",           label: "Dashboard",  icon: "▦" },
  { to: "/accounts",   label: "Accounts",   icon: "◎" },
  { to: "/automation", label: "Automation", icon: "▶" },
  { to: "/history",    label: "History",    icon: "◷" },
  { to: "/plans",      label: "Plans",      icon: "✦" },
];

export default function Layout() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const plan = usePlanStore((s) => s.plan) ?? "free";
  const planLabel = PLAN_LIMITS[plan].label;
  const applyWorkerMessage = useAutomationStore((s) => s.applyWorkerMessage);
  const runningAccounts = useAutomationStore((s) => s.runningAccounts);
  const hasRunning = runningAccounts.size > 0;

  useEffect(() => {
    window.worker?.onMessage((msg: WorkerMessage) => applyWorkerMessage(msg));
    return () => window.worker?.offMessage();
  }, [applyWorkerMessage]);

  const initials = (user?.primaryEmailAddress?.emailAddress ?? "?").slice(0, 2).toUpperCase();

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-app)" }}>
      {/* Sidebar */}
      <nav style={{
        width: "var(--sidebar-w)", flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--line)",
        display: "flex", flexDirection: "column",
      }}>
        {/* Brand */}
        <div style={{ padding: "18px 16px 16px", borderBottom: "1px solid var(--line)" }}>
          <div
            style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: "18px",
              border: "1px solid var(--line)",
              background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
            }}
          >
            <BrandMark size={56} compact subtitle={`${planLabel} plan`} />
          </div>

          {/* Running indicator */}
          {hasRunning && (
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "var(--accent-soft)", border: "1px solid var(--accent-line)",
              borderRadius: "var(--radius-sm)", padding: "5px 10px", fontSize: 11,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: "var(--accent)", flexShrink: 0,
                boxShadow: "0 0 0 3px var(--accent-soft)",
                animation: "pulse 2s infinite",
              }} />
              <span style={{ color: "var(--accent)" }}>Job running</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
          <div style={{ padding: "6px 18px 4px", fontSize: 10, fontWeight: 600, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Workspace
          </div>
          {NAV_LINKS.map(({ to, label, icon }) => (
            <NavLink key={to} to={to} end={to === "/"} style={({ isActive }) => ({
              display: "flex", alignItems: "center", gap: 9,
              padding: "9px 18px",
              color: isActive ? "var(--accent)" : "var(--fg-2)",
              textDecoration: "none",
              fontSize: 13, fontWeight: isActive ? 600 : 400,
              background: isActive ? "var(--accent-soft)" : "transparent",
              borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "all 0.12s",
            })}>
              <span style={{ fontSize: 14, opacity: 0.9, width: 16, textAlign: "center" }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </div>

        {/* User chip */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
            background: "var(--bg-card)", border: "1px solid var(--line-hi)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "var(--fg-2)",
          }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user?.primaryEmailAddress?.emailAddress}
            </div>
          </div>
          <button onClick={() => signOut()} title="Sign out" style={{
            width: 24, height: 24, padding: 0, background: "none",
            border: "1px solid var(--line-hi)", borderRadius: "var(--radius-sm)",
            color: "var(--fg-3)", fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>↩</button>
        </div>
      </nav>

      {/* Main */}
      <main style={{ flex: 1, overflow: "auto", background: "var(--bg-app)" }}>
        <Outlet />
      </main>

      <Toaster />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
