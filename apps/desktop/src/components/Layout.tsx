import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useUser, useClerk, useAuth } from "@clerk/clerk-react";
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
  const { getToken } = useAuth();
  const plan = usePlanStore((s) => s.plan) ?? "free";
  const planLabel = PLAN_LIMITS[plan].label;
  const applyWorkerMessage = useAutomationStore((s) => s.applyWorkerMessage);
  const runningAccounts = useAutomationStore((s) => s.runningAccounts);
  const hasRunning = runningAccounts.size > 0;

  useEffect(() => {
    window.worker?.onMessage((msg: WorkerMessage) => applyWorkerMessage(msg));
    return () => window.worker?.offMessage();
  }, [applyWorkerMessage]);

  useEffect(() => {
    if (runningAccounts.size === 0) return;
    const iv = setInterval(async () => {
      const fresh = await getToken({ skipCache: true });
      if (!fresh) return;
      for (const accountId of runningAccounts) {
        window.worker?.refreshToken(accountId, fresh).catch(() => undefined);
      }
    }, 25_000);
    return () => clearInterval(iv);
  }, [runningAccounts, getToken]);

  const initials = (user?.primaryEmailAddress?.emailAddress ?? "?").slice(0, 2).toUpperCase();

  return (
    <div className="flex h-screen bg-app">
      {/* Sidebar */}
      <nav
        className="flex flex-col shrink-0 bg-sidebar"
        style={{ width: "var(--sidebar-w)", borderRight: "3px solid var(--line-hi)" }}
      >
        {/* Brand */}
        <div className="p-4" style={{ borderBottom: "3px solid var(--line-hi)" }}>
          <div
            className="p-3 mb-3 rounded-md"
            style={{ border: "2px solid var(--line-hi)", boxShadow: "4px 4px 0 0 rgba(250,250,247,0.06)" }}
          >
            <BrandMark size={40} compact subtitle={`${planLabel} plan`} />
          </div>

          {hasRunning && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded text-[10px] font-bold tracking-[0.10em] uppercase font-mono"
              style={{ background: "var(--accent-soft)", border: "2px solid var(--accent-line)", color: "var(--accent)" }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse-dot"
                style={{ background: "var(--accent)" }}
                aria-hidden="true"
              />
              Job Running
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-2">
          <div
            className="px-4 pt-2 pb-1 text-[10px] font-bold tracking-[0.12em] uppercase font-mono"
            style={{ color: "var(--fg-4)" }}
          >
            Workspace
          </div>

          {NAV_LINKS.map(({ to, label, icon }) => (
            <NavLink key={to} to={to} end={to === "/"} className="block no-underline">
              {({ isActive }) => (
                <div
                  className="flex items-center gap-3 px-4 py-2.5 text-[13px] transition-all duration-100 cursor-pointer select-none"
                  style={{
                    color: isActive ? "var(--accent)" : "var(--fg-2)",
                    background: isActive ? "var(--accent-soft)" : "transparent",
                    borderLeft: `3px solid ${isActive ? "var(--accent)" : "transparent"}`,
                    fontWeight: isActive ? 700 : 400,
                  }}
                >
                  <span className="w-4 text-center text-sm opacity-90">{icon}</span>
                  {label}
                </div>
              )}
            </NavLink>
          ))}
        </div>

        {/* User chip */}
        <div
          className="flex items-center gap-2.5 p-4"
          style={{ borderTop: "3px solid var(--line-hi)" }}
        >
          <div
            className="w-7 h-7 shrink-0 flex items-center justify-center text-[11px] font-bold rounded"
            style={{ background: "var(--bg-canvas)", border: "2px solid var(--line-hi)", color: "var(--fg-2)" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium truncate" style={{ color: "var(--fg-2)" }}>
              {user?.primaryEmailAddress?.emailAddress}
            </div>
          </div>
          <button
            onClick={() => signOut()}
            title="Sign out"
            className="w-6 h-6 flex items-center justify-center text-xs cursor-pointer rounded transition-colors"
            style={{ background: "none", border: "2px solid var(--line-hi)", color: "var(--fg-3)" }}
          >
            ↩
          </button>
        </div>
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-app">
        <Outlet />
      </main>

      <Toaster />
    </div>
  );
}
