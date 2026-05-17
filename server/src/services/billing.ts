import crypto from "crypto";
import type { Plan, SubscriptionStatus } from "@insta-saas/shared";
import { PLAN_LIMITS } from "@insta-saas/shared";
import { prisma } from "../db/prisma";

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";
const PAID_PLAN_ORDER: Plan[] = ["max", "pro", "free"];
const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>(["authenticated", "active"]);
const db = prisma as any;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function getBasicAuthHeader(): string {
  const keyId = requireEnv("RAZORPAY_KEY_ID");
  const keySecret = requireEnv("RAZORPAY_KEY_SECRET");
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
}

function parseDate(unixSeconds?: number | null): Date | null {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

function getConfiguredPlanId(plan: Exclude<Plan, "free">): string {
  if (plan === "pro") return requireEnv("RAZORPAY_PLAN_ID_PRO");
  return requireEnv("RAZORPAY_PLAN_ID_MAX");
}

function getSubscriptionTotalCount(): number {
  return Number(process.env.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT ?? 1200);
}

export function isBillingReady(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET &&
    process.env.RAZORPAY_PLAN_ID_PRO &&
    process.env.RAZORPAY_PLAN_ID_MAX,
  );
}

export function getRazorpayPublicConfig() {
  return {
    billingReady: isBillingReady(),
    razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? null,
  };
}

export function getSubscriptionCheckoutExpireBy(): number {
  return Math.floor(Date.now() / 1000) + 30 * 60;
}

export function verifyRazorpaySignature(input: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(input).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = requireEnv("RAZORPAY_WEBHOOK_SECRET");
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function createRazorpaySubscription(input: {
  userId: string;
  email: string;
  plan: Exclude<Plan, "free">;
  idempotencyKey: string;
}) {
  const totalCount = getSubscriptionTotalCount();
  const planId = getConfiguredPlanId(input.plan);

  const response = await fetch(`${RAZORPAY_API_BASE}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: getBasicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      plan_id: planId,
      total_count: totalCount,
      quantity: 1,
      customer_notify: true,
      expire_by: getSubscriptionCheckoutExpireBy(),
      notes: {
        userId: input.userId,
        userEmail: input.email,
        targetPlan: input.plan,
        idempotencyKey: input.idempotencyKey,
      },
    }),
  });

  const payload: any = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.description ?? "Failed to create Razorpay subscription.");
  }

  const subscription = await db.subscription.create({
    data: {
      userId: input.userId,
      plan: input.plan,
      provider: "razorpay",
      status: payload.status,
      providerSubscriptionId: payload.id,
      providerCustomerId: payload.customer_id ?? null,
      shortUrl: payload.short_url ?? null,
      currentStart: parseDate(payload.current_start),
      currentEnd: parseDate(payload.current_end),
      cancelAtCycleEnd: Boolean(payload.has_scheduled_changes && payload.schedule_change_at === "cycle_end"),
      metadata: payload,
    },
  });

  await db.billingAttempt.create({
    data: {
      userId: input.userId,
      subscriptionId: subscription.id,
      targetPlan: input.plan,
      provider: "razorpay",
      status: "created",
      idempotencyKey: input.idempotencyKey,
      providerSubscriptionId: payload.id,
      metadata: payload,
    },
  });

  return subscription;
}

export async function fetchRazorpaySubscription(providerSubscriptionId: string) {
  const response = await fetch(`${RAZORPAY_API_BASE}/subscriptions/${providerSubscriptionId}`, {
    headers: { Authorization: getBasicAuthHeader() },
  });
  const payload: any = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.description ?? "Failed to fetch Razorpay subscription.");
  }
  return payload;
}

function getPlanFromPlanId(planId: string | null | undefined, fallbackPlan: Plan): Plan {
  if (!planId) return fallbackPlan;
  if (planId === process.env.RAZORPAY_PLAN_ID_PRO) return "pro";
  if (planId === process.env.RAZORPAY_PLAN_ID_MAX) return "max";
  return fallbackPlan;
}

export async function syncSubscriptionFromProvider(payload: any) {
  const providerSubscriptionId = payload?.id as string | undefined;
  if (!providerSubscriptionId) return null;

  const existing = await db.subscription.findUnique({
    where: { providerSubscriptionId },
  });
  if (!existing) return null;

  const nextPlan = getPlanFromPlanId(payload.plan_id, existing.plan as Plan);

  const updated = await db.subscription.update({
    where: { id: existing.id },
    data: {
      plan: nextPlan as any,
      status: payload.status,
      providerCustomerId: payload.customer_id ?? existing.providerCustomerId,
      shortUrl: payload.short_url ?? existing.shortUrl,
      currentStart: parseDate(payload.current_start),
      currentEnd: parseDate(payload.current_end),
      cancelAtCycleEnd: Boolean(payload.has_scheduled_changes && payload.schedule_change_at === "cycle_end"),
      lastPaymentId: payload.charge_at ? existing.lastPaymentId : existing.lastPaymentId,
      metadata: payload,
    },
  });

  await reconcileUserPlan(existing.userId);
  return updated;
}

export async function attachSuccessfulPayment(input: {
  providerSubscriptionId: string;
  providerPaymentId?: string | null;
}) {
  const subscription = await db.subscription.findUnique({
    where: { providerSubscriptionId: input.providerSubscriptionId },
  });
  if (!subscription) return null;

  await db.subscription.update({
    where: { id: subscription.id },
    data: { lastPaymentId: input.providerPaymentId ?? subscription.lastPaymentId },
  });

  await db.billingAttempt.updateMany({
    where: { subscriptionId: subscription.id, status: "created" },
    data: {
      status: "completed",
      providerPaymentId: input.providerPaymentId ?? undefined,
    },
  });

  return subscription;
}

export async function reconcileUserPlan(userId: string) {
  const subscriptions = await db.subscription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const winning = PAID_PLAN_ORDER.find((plan) =>
    subscriptions.some((subscription: any) =>
      subscription.plan === plan && ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status as SubscriptionStatus),
    ),
  ) ?? "free";

  await prisma.user.update({
    where: { id: userId },
    data: { plan: winning as any },
  });

  return {
    plan: winning,
    limits: PLAN_LIMITS[winning],
  };
}
