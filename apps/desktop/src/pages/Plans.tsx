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

function Skeleton({ w, h, radius = 6 }: { w: string | number; h: number; radius?: number }) {
  return (
    <div style={{
      width: w, height: h, borderRadius: radius,
      background: "var(--bg-canvas)",
      animation: "pulse 1.6s ease-in-out infinite",
    }} />
  );
}

const pulseKeyframes = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
`;

export default function Plans() {
  const plan = usePlanStore((s) => s.plan) ?? "free";
  const setPlan = usePlanStore((s) => s.setPlan);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [subscription, setSubscription] = useState<BillingSubscription | null>(null);
  const [billingReady, setBillingReady] = useState(false);
  const [razorpayKeyId, setRazorpayKeyId] = useState<string | null>(null);
  const [startingPlan, setStartingPlan] = useState<Plan | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    if (!billingReady) return;
    if (document.querySelector('script[src*="checkout.razorpay.com"]')) return;
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.head.appendChild(script);
  }, [billingReady]);

  async function loadPlans() {
    const { data } = await api.get<PlansResponse>("/plans");
    setPlan(data.plan);
    setUsage(data.usage);
    setSubscription(data.subscription);
    setBillingReady(data.billingReady);
    setRazorpayKeyId(data.razorpayKeyId);
  }

  useEffect(() => {
    loadPlans()
      .catch(() => setFlash({ text: "Couldn't load pricing right now.", type: "error" }))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubscribe(nextPlan: Exclude<Plan, "free">) {
    if (startingPlan || !billingReady) return;
    setStartingPlan(nextPlan);
    setFlash(null);
    try {
      const { data } = await api.post<CreateSubscriptionResponse>("/plans/subscribe", { plan: nextPlan });
      setSubscription(data.subscription);
      const keyId = razorpayKeyId;
      const subId = data.subscription.providerSubscriptionId;
      if (keyId && subId && window.Razorpay) {
        const rzp = new window.Razorpay({
          key: keyId,
          subscription_id: subId,
          name: "InstaFlow",
          description: `${PLAN_LIMITS[nextPlan].label} Plan`,
          handler: async (response) => {
            try {
              await api.post("/plans/verify", response);
              await loadPlans();
              setFlash({ text: "Payment received. Your plan is now updated.", type: "success" });
            } catch (e: any) {
              setFlash({ text: e.response?.data?.error ?? "Payment was made, but we could not confirm it yet. Click Check payment status.", type: "error" });
            }
          },
          modal: {
            ondismiss: () => setFlash({ text: "Payment window closed. If you already paid, click Check payment status.", type: "error" }),
          },
        });
        rzp.open();
      } else {
        const result = await window.desktop.openExternal(data.checkoutUrl);
        if (result.error) {
          setFlash({ text: result.error, type: "error" });
        } else {
          setFlash({ text: `Payment page opened for the ${PLAN_LIMITS[nextPlan].label} plan. After paying, click Check payment status.`, type: "success" });
        }
      }
    } catch (err: any) {
      setFlash({ text: err.response?.data?.error ?? "Couldn't open the payment step.", type: "error" });
    } finally {
      setStartingPlan(null);
    }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setFlash(null);
    try {
      const { data } = await api.post<SyncSubscriptionResponse>("/plans/sync", {
        subscriptionId: subscription?.providerSubscriptionId ?? subscription?.id,
      });
      setPlan(data.plan);
      setSubscription(data.subscription);
      await loadPlans();
      setFlash({ text: `Payment status checked. Your current plan is ${PLAN_LIMITS[data.plan].label}.`, type: "success" });
    } catch (err: any) {
      setFlash({ text: err.response?.data?.error ?? "Couldn't check your payment status.", type: "error" });
    } finally {
      setSyncing(false);
    }
  }

  async function handleCancel(cancelAtCycleEnd: boolean) {
    if (cancelling) return;
    setCancelling(true);
    setShowCancelConfirm(false);
    setFlash(null);
    try {
      const { data } = await api.post<{ plan: Plan; subscription: BillingSubscription; message: string }>(
        "/plans/cancel",
        { cancelAtCycleEnd },
      );
      setPlan(data.plan);
      setSubscription(data.subscription);
      setFlash({ text: data.message, type: "success" });
    } catch (err: any) {
      setFlash({ text: err.response?.data?.error ?? "Couldn't cancel your plan.", type: "error" });
    } finally {
      setCancelling(false);
    }
  }

  const canCancel = subscription?.status === "active" || subscription?.status === "authenticated";
  const isTestMode = razorpayKeyId?.startsWith("rzp_test_");

  return (
    <>
      <style>{pulseKeyframes}</style>
      <div style={{ padding: "28px 32px", maxWidth: 980, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
          <div>
            <h1 style={{ margin: "0 0 5px", fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 700, color: "var(--fg)", letterSpacing: "-0.3px" }}>
              Pricing & Payments
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {loading ? <Skeleton w={160} h={16} /> : (
                <>
                  <span style={{ fontSize: 13, color: "var(--fg-3)" }}>
                    Your plan: <strong style={{ color: "var(--accent)" }}>{PLAN_LIMITS[plan].label}</strong>
                  </span>
                  {razorpayKeyId && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                      padding: "2px 8px", borderRadius: "var(--radius-full)",
                      background: isTestMode ? "rgba(224,176,114,0.15)" : "rgba(154,194,138,0.15)",
                      color: isTestMode ? "var(--warning)" : "var(--positive)",
                      border: `1px solid ${isTestMode ? "rgba(224,176,114,0.35)" : "rgba(154,194,138,0.35)"}`,
                    }}>
                      {isTestMode ? "TEST MODE" : "LIVE"}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={handleSync}
              disabled={syncing || loading || !subscription}
              style={{
                padding: "8px 16px", fontSize: 12, fontWeight: 700,
                background: syncing || loading || !subscription ? "var(--bg-card)" : "var(--accent-soft)",
                color: syncing || loading || !subscription ? "var(--fg-4)" : "var(--accent)",
                border: "1px solid var(--accent-line)",
                borderRadius: "var(--radius-sm)",
                cursor: syncing || loading || !subscription ? "default" : "pointer",
                fontFamily: "var(--font-body)",
              }}
            >
              {syncing ? "Checking..." : "Check payment status"}
            </button>
          </div>
        </div>

        {/* Flash message */}
        {flash && (
          <div style={{
            marginBottom: 20, padding: "11px 16px",
            background: flash.type === "success" ? "rgba(154,194,138,0.1)" : "rgba(220,53,69,0.08)",
            border: `1px solid ${flash.type === "success" ? "rgba(154,194,138,0.3)" : "rgba(220,53,69,0.25)"}`,
            borderRadius: "var(--radius-sm)",
            color: flash.type === "success" ? "var(--positive)" : "var(--negative, #e05c5c)",
            fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <span>{flash.text}</span>
            <button onClick={() => setFlash(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, fontSize: 16, padding: "0 0 0 12px", lineHeight: 1 }}>×</button>
          </div>
        )}

        {/* Cancel confirm */}
        {showCancelConfirm && (
          <div style={{
            marginBottom: 20, padding: "18px 20px",
            background: "rgba(220,53,69,0.06)",
            border: "1px solid rgba(220,53,69,0.25)",
            borderRadius: "var(--radius-md)",
          }}>
            <p style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 700, color: "var(--fg)" }}>Cancel your plan?</p>
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--fg-3)" }}>
              Your account and saved data will stay safe.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => handleCancel(true)}
                disabled={cancelling}
                style={{
                  padding: "8px 16px", fontSize: 12, fontWeight: 700,
                  background: "rgba(220,53,69,0.1)", color: "var(--negative, #e05c5c)",
                  border: "1px solid rgba(220,53,69,0.3)", borderRadius: "var(--radius-sm)",
                  cursor: cancelling ? "default" : "pointer", fontFamily: "var(--font-body)",
                }}
              >
                {cancelling ? "Cancelling..." : "Stop after this billing period"}
              </button>
              <button
                onClick={() => handleCancel(false)}
                disabled={cancelling}
                style={{
                  padding: "8px 16px", fontSize: 12, fontWeight: 700,
                  background: "rgba(220,53,69,0.18)", color: "var(--negative, #e05c5c)",
                  border: "1px solid rgba(220,53,69,0.4)", borderRadius: "var(--radius-sm)",
                  cursor: cancelling ? "default" : "pointer", fontFamily: "var(--font-body)",
                }}
              >
                Stop now
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                disabled={cancelling}
                style={{
                  padding: "8px 16px", fontSize: 12, fontWeight: 600,
                  background: "var(--bg-card)", color: "var(--fg-3)",
                  border: "1px solid var(--line)", borderRadius: "var(--radius-sm)",
                  cursor: "pointer", fontFamily: "var(--font-body)",
                }}
              >
                Keep current plan
              </button>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ background: "var(--bg-card)", borderRadius: "var(--radius-md)", padding: "20px 22px", border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Today's usage</div>
              {canCancel && !showCancelConfirm && (
                <button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={cancelling}
                  style={{
                    padding: "5px 12px", fontSize: 12, fontWeight: 600,
                    background: "transparent",
                    color: "var(--fg-3)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer", fontFamily: "var(--font-body)",
                    transition: "color 0.15s, border-color 0.15s",
                  }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.color = "var(--negative, #e05c5c)"; (e.target as HTMLButtonElement).style.borderColor = "rgba(220,53,69,0.4)"; }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.color = "var(--fg-3)"; (e.target as HTMLButtonElement).style.borderColor = "var(--line)"; }}
                >
                  Cancel subscription
                </button>
              )}
            </div>
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Skeleton w={120} h={36} radius={8} />
                <Skeleton w={200} h={14} />
              </div>
            ) : (
              <>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 32, color: "var(--fg)", marginBottom: 6, lineHeight: 1 }}>
                  {usage ? `${usage.remaining}` : "0"}
                  <span style={{ fontSize: 16, fontWeight: 500, color: "var(--fg-3)", marginLeft: 6 }}>left today</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--fg-3)" }}>
                  {usage ? `${usage.used} of ${usage.limit} messages used today` : "No usage details yet"}
                </div>
                {usage && (
                  <div style={{ marginTop: 12, height: 4, borderRadius: 2, background: "var(--bg-canvas)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 2,
                      width: `${Math.min(100, (usage.used / usage.limit) * 100)}%`,
                      background: usage.used / usage.limit > 0.8 ? "var(--negative, #e05c5c)" : "var(--accent)",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                )}
                {subscription?.cancelAtCycleEnd && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "var(--warning)", fontWeight: 600 }}>
                    Subscription will stop at the end of this billing period
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Pricing cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {ALL_PLANS.map((p) => {
            const limits = PLAN_LIMITS[p];
            const features = PLAN_FEATURES[p];
            const isCurrent = plan === p;
            const isPaid = p !== "free";
            const isPopular = p === "pro";

            return (
              <div key={p} style={{
                background: "var(--bg-card)",
                borderRadius: "var(--radius-md)",
                padding: "24px 22px",
                border: isCurrent ? "1.5px solid var(--accent-line)" : "1px solid var(--line)",
                display: "flex",
                flexDirection: "column",
                boxShadow: isCurrent ? "0 0 0 3px var(--accent-soft)" : "none",
                position: "relative",
              }}>
                {isPopular && !isCurrent && (
                  <div style={{
                    position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)",
                    background: "var(--accent)", color: "#1a1917",
                    fontSize: 10, fontWeight: 800, letterSpacing: "0.08em",
                    padding: "3px 12px", borderRadius: "0 0 var(--radius-sm) var(--radius-sm)",
                  }}>
                    POPULAR
                  </div>
                )}

                {/* Plan name + badge */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--fg)", fontFamily: "var(--font-display)" }}>{limits.label}</span>
                  {isCurrent && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                      padding: "2px 8px", borderRadius: "var(--radius-full)",
                      background: "var(--accent)", color: "#1a1917",
                    }}>
                      CURRENT
                    </span>
                  )}
                </div>

                {/* Price */}
                {loading ? (
                  <Skeleton w={100} h={40} radius={8} />
                ) : (
                  <div style={{ marginBottom: 4 }}>
                    <span style={{
                      fontFamily: "var(--font-display)", fontWeight: 800,
                      fontSize: 30, color: isCurrent ? "var(--accent)" : "var(--fg)",
                      letterSpacing: "-0.5px", lineHeight: 1,
                    }}>
                      {limits.price.split("/")[0]}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--fg-4)", marginLeft: 2 }}>/mo</span>
                  </div>
                )}

                <div style={{ fontSize: 12, color: "var(--fg-4)", marginBottom: 20 }}>
                  {limits.maxAccounts} account{limits.maxAccounts > 1 ? "s" : ""} · {limits.dailyMessages} messages/day
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: "var(--line)", marginBottom: 16 }} />

                {/* Features */}
                <ul style={{ margin: "0 0 24px", padding: 0, flex: 1, listStyle: "none" }}>
                  {features.map((f) => (
                    <li key={f} style={{ marginBottom: 9, fontSize: 13, color: "var(--fg-2)", display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ color: "var(--positive)", marginTop: 1, flexShrink: 0, fontSize: 12, fontWeight: 700 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                {isPaid ? (
                  <button
                    onClick={() => handleSubscribe(p as Exclude<Plan, "free">)}
                    disabled={isCurrent || startingPlan !== null || !billingReady || loading}
                    style={{
                      width: "100%", padding: "11px 0",
                      background: isCurrent || !billingReady || loading
                        ? "var(--bg-canvas)"
                        : isPopular
                          ? "var(--accent)"
                          : "var(--accent-soft)",
                      color: isCurrent || !billingReady || loading
                        ? "var(--fg-4)"
                        : isPopular
                          ? "#1a1917"
                          : "var(--accent)",
                      border: isCurrent || !billingReady || loading
                        ? "1px solid var(--line)"
                        : "1px solid var(--accent-line)",
                      borderRadius: "var(--radius-sm)",
                      cursor: isCurrent || startingPlan !== null || !billingReady || loading ? "default" : "pointer",
                      fontWeight: 700, fontSize: 13,
                      fontFamily: "var(--font-body)",
                      transition: "opacity 0.15s",
                    }}
                  >
                    {isCurrent ? "Current plan" : startingPlan === p ? "Opening payment..." : `Choose ${limits.label}`}
                  </button>
                ) : (
                  <button disabled style={{
                    width: "100%", padding: "11px 0",
                    background: "var(--bg-canvas)", color: "var(--fg-4)",
                    border: "1px solid var(--line)", borderRadius: "var(--radius-sm)",
                    cursor: "default", fontWeight: 600, fontSize: 13,
                    fontFamily: "var(--font-body)",
                  }}>
                    {isCurrent ? "Current plan" : "Free"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {!loading && !billingReady && (
          <p style={{ marginTop: 20, fontSize: 12, color: "var(--accent)", textAlign: "center" }}>
            Payments are not set up yet on this app.
          </p>
        )}
      </div>
    </>
  );
}
