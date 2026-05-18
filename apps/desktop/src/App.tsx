import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SignedIn, SignedOut, SignIn, SignUp } from "@clerk/clerk-react";
import AuthSetup from "./components/AuthSetup";
import Layout from "./components/Layout";
import BrandMark from "./components/BrandMark";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import Automation from "./pages/Automation";
import History from "./pages/History";
import Plans from "./pages/Plans";

// ── Clerk dark-theme appearance ───────────────────────────────────────────────



// ── Auth page shell ───────────────────────────────────────────────────────────

function AuthPage({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-app)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
      overflow: "hidden",
      padding: "32px 16px",
    }}>
      {/* Ambient glow — top right */}
      <div style={{
        position: "absolute",
        top: -120,
        right: -120,
        width: 500,
        height: 500,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(217,119,87,0.12) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />
      {/* Ambient glow — bottom left */}
      <div style={{
        position: "absolute",
        bottom: -100,
        left: -100,
        width: 380,
        height: 380,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(217,119,87,0.07) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />

      <div style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 28,
        width: "100%",
        maxWidth: 420,
      }}>
        {/* Brand */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <BrandMark size={72} showText={false} />
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 22,
              color: "var(--fg)",
              letterSpacing: "-0.3px",
              lineHeight: 1.1,
            }}>
              InstaFlow
            </div>
            <div style={{ fontSize: 12, color: "var(--fg-3)", marginTop: 5 }}>
              {subtitle}
            </div>
          </div>
        </div>

        {/* Clerk form */}
        <div style={{ width: "100%" }}>
          {children}
        </div>

        {/* Footer */}
        <p style={{ margin: 0, fontSize: 11, color: "var(--fg-4)", textAlign: "center" }}>
          Instagram DM automation — built for scale
        </p>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/sign-in/*"
          element={
            <AuthPage subtitle="Sign in to your workspace">
              <SignIn
                routing="path"
                path="/sign-in"
                signUpUrl="/sign-up"
                fallbackRedirectUrl="/"
              />
            </AuthPage>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <AuthPage subtitle="Create your account">
              <SignUp
                routing="path"
                path="/sign-up"
                signInUrl="/sign-in"
                fallbackRedirectUrl="/"
              />
            </AuthPage>
          }
        />

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
