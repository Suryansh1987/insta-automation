import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import {
  PLAN_FEATURES,
  PLAN_LIMITS,
  type CreateSubscriptionResponse,
  type PlansResponse,
  type SyncSubscriptionResponse,
} from "@insta-saas/shared";
import {
  attachSuccessfulPayment,
  createRazorpaySubscription,
  fetchRazorpaySubscription,
  getRazorpayPublicConfig,
  isBillingReady,
  reconcileUserPlan,
  syncSubscriptionFromProvider,
  verifyRazorpaySignature,
  verifyWebhookSignature,
} from "../services/billing";
import { getMessageUsageSummary } from "../services/usage";

export const plansRouter = Router();
plansRouter.use(requireAuth);
const db = prisma as any;

const subscribeSchema = z.object({
  plan: z.enum(["pro", "max"]),
});

const syncSchema = z.object({
  subscriptionId: z.string().optional(),
});

const verifySchema = z.object({
  razorpay_payment_id: z.string(),
  razorpay_subscription_id: z.string(),
  razorpay_signature: z.string(),
});

function serializeSubscription(subscription: any) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    plan: subscription.plan,
    status: subscription.status,
    provider: subscription.provider,
    providerSubscriptionId: subscription.providerSubscriptionId,
    providerCustomerId: subscription.providerCustomerId,
    shortUrl: subscription.shortUrl,
    currentStart: subscription.currentStart?.toISOString() ?? null,
    currentEnd: subscription.currentEnd?.toISOString() ?? null,
    cancelAtCycleEnd: subscription.cancelAtCycleEnd,
    lastPaymentId: subscription.lastPaymentId,
    createdAt: subscription.createdAt.toISOString(),
    updatedAt: subscription.updatedAt.toISOString(),
  };
}

async function getLatestSubscription(userId: string) {
  return db.subscription.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

plansRouter.get("/", async (req, res, next) => {
  try {
    const r = req as AuthRequest;
    const [usage, subscription] = await Promise.all([
      getMessageUsageSummary(r.userId, r.userPlan),
      getLatestSubscription(r.userId),
    ]);

    const billing = getRazorpayPublicConfig();
    const body: PlansResponse = {
      plan: r.userPlan,
      limits: PLAN_LIMITS[r.userPlan],
      features: PLAN_FEATURES[r.userPlan],
      usage,
      subscription: serializeSubscription(subscription),
      billingReady: billing.billingReady,
      razorpayKeyId: billing.razorpayKeyId,
    };

    res.json(body);
  } catch (err) {
    next(err);
  }
});

plansRouter.post("/subscribe", async (req, res, next) => {
  try {
    if (!isBillingReady()) {
      return res.status(503).json({ error: "Razorpay is not configured yet." });
    }

    const r = req as AuthRequest;
    const { plan } = subscribeSchema.parse(req.body);

    const existing = await db.subscription.findFirst({
      where: {
        userId: r.userId,
        plan,
        status: { in: ["created", "authenticated", "pending", "active"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing?.shortUrl) {
      const body: CreateSubscriptionResponse = {
        plan,
        checkoutUrl: existing.shortUrl,
        idempotencyKey: `existing:${existing.id}`,
        subscription: serializeSubscription(existing)!,
        message: `Continue your ${plan} subscription checkout.`,
      };
      return res.json(body);
    }

    const user = await prisma.user.findUnique({
      where: { id: r.userId },
      select: { email: true },
    });
    if (!user) return res.status(404).json({ error: "User not found." });

    const idempotencyKey = crypto.randomUUID();
    const subscription = await createRazorpaySubscription({
      userId: r.userId,
      email: user.email,
      plan,
      idempotencyKey,
    });

    const body: CreateSubscriptionResponse = {
      plan,
      checkoutUrl: subscription.shortUrl ?? "",
      idempotencyKey,
      subscription: serializeSubscription(subscription)!,
      message: `Subscription created for ${plan}. Complete payment in Razorpay.`,
    };
    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
});

plansRouter.post("/sync", async (req, res, next) => {
  try {
    if (!isBillingReady()) {
      return res.status(503).json({ error: "Razorpay is not configured yet." });
    }

    const r = req as AuthRequest;
    const { subscriptionId } = syncSchema.parse(req.body ?? {});

    const localSubscription = subscriptionId
      ? await db.subscription.findFirst({
          where: {
            userId: r.userId,
            OR: [{ id: subscriptionId }, { providerSubscriptionId: subscriptionId }],
          },
        })
      : await getLatestSubscription(r.userId);

    if (!localSubscription?.providerSubscriptionId) {
      const body: SyncSubscriptionResponse = {
        plan: r.userPlan,
        subscription: null,
      };
      return res.json(body);
    }

    const providerPayload = await fetchRazorpaySubscription(localSubscription.providerSubscriptionId);
    const updated = await syncSubscriptionFromProvider(providerPayload);
    const reconciled = await reconcileUserPlan(r.userId);

    const body: SyncSubscriptionResponse = {
      plan: reconciled.plan,
      subscription: serializeSubscription(updated ?? localSubscription),
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

plansRouter.post("/verify", async (req, res, next) => {
  try {
    const r = req as AuthRequest;
    const body = verifySchema.parse(req.body);
    const valid = verifyRazorpaySignature(
      `${body.razorpay_payment_id}|${body.razorpay_subscription_id}`,
      body.razorpay_signature,
      process.env.RAZORPAY_KEY_SECRET!,
    );

    if (!valid) {
      return res.status(400).json({ error: "Invalid Razorpay signature." });
    }

    await attachSuccessfulPayment({
      providerSubscriptionId: body.razorpay_subscription_id,
      providerPaymentId: body.razorpay_payment_id,
    });

    const providerPayload = await fetchRazorpaySubscription(body.razorpay_subscription_id);
    const updated = await syncSubscriptionFromProvider(providerPayload);
    const reconciled = await reconcileUserPlan(r.userId);

    res.json({
      plan: reconciled.plan,
      subscription: serializeSubscription(updated),
    });
  } catch (err) {
    next(err);
  }
});

export async function razorpayWebhookHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const signature = req.header("x-razorpay-signature");
    const eventId = req.header("x-razorpay-event-id");

    if (!signature || !eventId) {
      return res.status(400).json({ error: "Missing webhook headers." });
    }
    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ error: "Invalid webhook signature." });
    }

    const duplicate = await db.webhookEvent.findUnique({
      where: { provider_eventId: { provider: "razorpay", eventId } },
    });
    if (duplicate) return res.json({ ok: true, duplicate: true });

    const payload = JSON.parse(rawBody);
    const subscriptionPayload = payload?.payload?.subscription?.entity;
    const paymentPayload = payload?.payload?.payment?.entity;
    const providerSubscriptionId =
      subscriptionPayload?.id ??
      paymentPayload?.subscription_id ??
      null;

    await db.webhookEvent.create({
      data: {
        provider: "razorpay",
        eventId,
        eventType: payload.event ?? "unknown",
        signature,
        status: "received",
        payload,
      },
    });

    if (providerSubscriptionId && paymentPayload?.id) {
      await attachSuccessfulPayment({
        providerSubscriptionId,
        providerPaymentId: paymentPayload.id,
      });
    }

    if (subscriptionPayload?.id) {
      const updated = await syncSubscriptionFromProvider(subscriptionPayload);
      if (updated) {
        await reconcileUserPlan(updated.userId);
      }
    }

    await db.webhookEvent.update({
      where: { provider_eventId: { provider: "razorpay", eventId } },
      data: {
        status: "processed",
        processedAt: new Date(),
      },
    });

    res.json({ ok: true });
  } catch (err) {
    const eventId = req.header("x-razorpay-event-id");
    if (eventId) {
      await db.webhookEvent.updateMany({
        where: { provider: "razorpay", eventId },
        data: {
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown webhook error",
        },
      });
    }
    next(err);
  }
}
