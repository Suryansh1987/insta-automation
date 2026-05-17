import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { SignedIn, SignedOut, SignIn, SignUp, useAuth, useClerk } from "@clerk/clerk-react";
import { useEffect } from "react";
import AuthSetup from "./components/AuthSetup";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Automation from "./pages/Automation";
import History from "./pages/History";
import Logs from "./pages/Logs";
import Plans from "./pages/Plans";

// ── Debug helpers ─────────────────────────────────────────────────────────────

function rlog(tag: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[${ts}] [${tag}] ${msg}`;
  console.log(line);
  // Forward to main process persistent log via the bridge the preload exposed
  (window as unknown as { debugLog?: (...a: unknown[]) => void }).debugLog?.(tag, msg);
}

function RouteLogger() {
  const location = useLocation();
  useEffect(() => {
    rlog("route", `pathname="${location.pathname}" search="${location.search}" hash="${location.hash}"`);
    rlog("route", `href="${window.location.href}" origin="${window.location.origin}"`);
  }, [location]);
  return null;
}

function ClerkDebug() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const clerk = useClerk();
  useEffect(() => {
    rlog("clerk", `isLoaded=${isLoaded} isSignedIn=${isSignedIn} userId=${userId ?? "null"}`);
    if (isLoaded) {
      rlog("clerk", `client.activeSessions.length=${clerk?.client?.activeSessions?.length ?? "?"}`);
    }
  }, [isLoaded, isSignedIn, userId, clerk]);
  return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const authBoxStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#1a1a2e",
};

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <RouteLogger />
      <ClerkDebug />
      <Routes>
        {/*
          routing="path" + BrowserRouter:
            Clerk uses React Router's navigate() for multi-step flows
            (e.g. /sign-in → /sign-in/factor-one) — no full document reload.
            Full-page reloads (sign-out redirect, browser refresh) are handled
            by the SPA fallback in main.ts which serves index.html for any path.
        */}
        <Route
          path="/sign-in/*"
          element={
            <div style={authBoxStyle}>
              <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
            </div>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <div style={authBoxStyle}>
              <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
            </div>
          }
        />

        {/* Main app shell */}
        <Route
          path="/*"
          element={
            <>
              <SignedOut>
                <Navigate to="/sign-in" replace />
              </SignedOut>
              <SignedIn>
                <AuthSetup>
                  <Routes>
                    <Route path="/" element={<Layout />}>
                      <Route index element={<Dashboard />} />
                      <Route path="accounts" element={<Accounts />} />
                      <Route path="automation" element={<Automation />} />
                      <Route path="history" element={<History />} />
                      <Route path="logs" element={<Logs />} />
                      <Route path="plans" element={<Plans />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </AuthSetup>
              </SignedIn>
            </>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
