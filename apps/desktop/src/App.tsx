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

const authBoxStyle: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "20px",
  background: "#1a1a2e",
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/sign-in/*"
          element={
            <div style={authBoxStyle}>
              <BrandMark size={216} subtitle="Secure desktop access" />
              <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
            </div>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <div style={authBoxStyle}>
              <BrandMark size={216} subtitle="Create your workspace" />
              <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
            </div>
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
