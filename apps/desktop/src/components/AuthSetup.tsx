import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { setAuthTokenGetter } from "../api/client";
import { usePlanStore } from "../store/plan";
import api from "../api/client";
import type { Plan } from "@insta-saas/shared";

export default function AuthSetup({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn } = useAuth();
  const setPlan = usePlanStore((s) => s.setPlan);
  const clearPlan = usePlanStore((s) => s.clear);

  useEffect(() => {
    setAuthTokenGetter(() => getToken({ skipCache: true }));
  }, [getToken]);

  useEffect(() => {
    if (!isSignedIn) { clearPlan(); return; }
    api.get<{ plan: Plan }>("/plans").then((r) => setPlan(r.data.plan)).catch(() => {});
  }, [isSignedIn]);

  return <>{children}</>;
}
