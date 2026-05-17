import { useEffect, useState } from "react";
import api from "../api/client";
import { usePlanStore } from "../store/plan";
import { PLAN_LIMITS, PLAN_FEATURES } from "@insta-saas/shared";
import type {
  BillingSubscription,
  CreateSubscriptionResponse,
  Plan,
  PlansResponse,
  SyncSubscriptionResponse,
  UsageSummary,
} from "@insta-saas/shared";

const ALL_PLANS: Plan[] = ["free", "pro", "max"];

export default function Plans() {
  const plan = usePlanStore((s) => s.plan) ?? "free";
  const setPlan = usePlanStore((s) => s.setPlan);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState("");
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [billingReady, setBillingReady] = useState(false);
  const [startingPlan, setStartingPlan] = useState<Plan | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function loadPlans() {
    const { data } = await api.get<PlansResponse>("/plans");
    setPlan(data.plan);
    setUsage(data.usage);
    setSubscription(data.subscription);
    setBillingReady(data.billingReady);
  }

  useEffect(() => {
    loadPlans()
      .catch((err: any) => setFlash(err.response?.data?.error ?? "Failed to load plans."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubscribe(nextPlan: Exclude<Plan, "free">) {
    if (startingPlan || !billingReady) return;
    setStartingPlan(nextPlan);
    setFlash("");
    try {
      const { data } = await api.post<CreateSubscriptionResponse>("/plans/subscribe", { plan: nextPlan });
      setSubscription(data.subscription);
      const result = await window.desktop.openExternal(data.checkoutUrl);
      if (result.error) {
        setFlash(result.error);
      } else {
        setFlash(`Razorpay checkout opened for ${PLAN_LIMITS[nextPlan].label}. Complete payment there, then click Refresh status here.`);
      }
    } catch (err: any) {
      setFlash(err.response?.data?.error ?? "Failed to start subscription checkout.");
    } finally {
      setStartingPlan(null);
    }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setFlash("");
    try {
      const { data } = await api.post<SyncSubscriptionResponse>("/plans/sync", {
        subscriptionId: subscription?.providerSubscriptionId ?? subscription?.id,
      });
      setPlan(data.plan);
      setSubscription(data.subscription);
      await loadPlans();
      setFlash(`Subscription status refreshed. Current plan: ${PLAN_LIMITS[data.plan].label}.`);
    } catch (err: any) {
      setFlash(err.response?.data?.error ?? "Failed to refresh subscription status.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div style={{ padding: 28, maxWidth: 960 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>Plans</h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>
            Current plan: <strong style={{ color: "var(--accent)" }}>{PLAN_LIMITS[plan].label}</strong>
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || !subscription}
          style={{
            padding: "9px 14px",
            background: syncing || !subscription ? "var(--bg-card)" : "var(--accent-soft)",
            color: syncing || !subscription ? "var(--fg-4)" : "var(--accent)",
            border: "1px solid var(--accent-line)",
            borderRadius: "var(--radius-sm)",
            cursor: syncing || !subscription ? "default" : "pointer",
            fontWeight: 700,
            fontSize: 12,
            fontFamily: "var(--font-body)",
          }}
        >
          {syncing ? "Refreshing..." : "Refresh status"}
        </button>
      </div>

      {flash && (
        <div style={{ marginBottom: 18, padding: "10px 14px", background: "rgba(154,194,138,0.12)", border: "1px solid rgba(154,194,138,0.3)", borderRadius: "var(--radius-sm)", color: "var(--positive)", fontSize: 13 }}>
          {flash}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 14, marginBottom: 22 }}>
        <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 18, border: "1px solid var(--line)" }}>
          <div style={{ fontSize: 11, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Daily usage</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 30, color: "var(--fg)", marginBottom: 6 }}>
            {usage ? `${usage.remaining} left` : loading ? "..." : "0 left"}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>
            {usage ? `${usage.used} used of ${usage.limit} message attempts today.` : "Daily quota updates after each target is processed."}
          </p>
        </div>

        <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 18, border: "1px solid var(--line)" }}>
          <div style={{ fontSize: 11, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Subscription</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22, color: "var(--fg)", marginBottom: 6 }}>
            {subscription ? subscription.status : "No paid subscription"}
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "var(--fg-3)" }}>
            {subscription
              ? `${PLAN_LIMITS[subscription.plan].label} plan${subscription.currentEnd ? ` until ${new Date(subscription.currentEnd).toLocaleDateString()}` : ""}.`
              : "Free plan is active. Start a Razorpay subscription to upgrade."}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {ALL_PLANS.map((p) => {
          const limits = PLAN_LIMITS[p];
          const features = PLAN_FEATURES[p];
          const isCurrent = plan === p;
          const isPaid = p !== "free";

          return (
            <div key={p} style={{
              background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: 22,
              border: isCurrent ? "1.5px solid var(--accent-line)" : "1px solid var(--line)",
              display: "flex", flexDirection: "column",
              boxShadow: isCurrent ? "0 0 0 3px var(--accent-soft)" : "none",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 16, color: "var(--fg)" }}>{limits.label}</h3>
                {isCurrent && (
                  <span style={{ fontSize: 10, background: "var(--accent)", color: "#1a1917", padding: "2px 8px", borderRadius: "var(--radius-full)", fontWeight: 700, letterSpacing: "0.05em" }}>
                    CURRENT
                  </span>
                )}
              </div>
              <p style={{ fontSize: 26, fontWeight: 800, margin: "0 0 6px", color: isCurrent ? "var(--accent)" : "var(--fg)", fontFamily: "var(--font-display)" }}>
                {limits.price}
              </p>
              <p style={{ margin: "0 0 18px", fontSize: 12, color: "var(--fg-4)" }}>
                {limits.maxAccounts} account{limits.maxAccounts > 1 ? "s" : ""} and {limits.dailyMessages} messages/day
              </p>
              <ul style={{ margin: "0 0 22px", paddingLeft: 0, flex: 1, listStyle: "none" }}>
                {features.map((f) => (
                  <li key={f} style={{ marginBottom: 8, fontSize: 13, color: "var(--fg-2)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ color: "var(--positive)", marginTop: 1, flexShrink: 0 }}>+</span>
                    {f}
                  </li>
                ))}
              </ul>
              {isPaid ? (
                <button
                  onClick={() => handleSubscribe(p as Exclude<Plan, "free">)}
                  disabled={isCurrent || startingPlan !== null || !billingReady}
                  style={{
                    width: "100%", padding: 11,
                    background: isCurrent || !billingReady ? "var(--bg-canvas)" : "var(--accent)",
                    color: isCurrent || !billingReady ? "var(--fg-4)" : "#1a1917",
                    border: "none", borderRadius: "var(--radius-sm)",
                    cursor: isCurrent || startingPlan !== null || !billingReady ? "default" : "pointer",
                    fontWeight: 700, fontSize: 13, fontFamily: "var(--font-body)",
                  }}
                >
                  {isCurrent ? "Current Plan" : startingPlan === p ? "Opening checkout..." : `Subscribe to ${limits.label}`}
                </button>
              ) : (
                <button disabled style={{
                  width: "100%", padding: 11,
                  background: "var(--bg-canvas)", color: "var(--fg-4)",
                  border: "none", borderRadius: "var(--radius-sm)",
                  cursor: "default", fontWeight: 700, fontSize: 13, fontFamily: "var(--font-body)",
                }}>
                  {isCurrent ? "Current Plan" : "Included"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {!billingReady && (
        <p style={{ marginTop: 24, fontSize: 12, color: "var(--accent)" }}>
          Razorpay is not configured yet. Add the Razorpay keys, webhook secret, and plan IDs on the server to enable paid subscriptions.
        </p>
      )}
    </div>
  );
}
