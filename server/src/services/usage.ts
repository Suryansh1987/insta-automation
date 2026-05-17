import { PLAN_LIMITS, type Plan } from "@insta-saas/shared";
import { prisma } from "../db/prisma";
const db = prisma as any;

function startOfLocalDay(date = new Date()): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function getUsageDateKey(date = new Date()): string {
  return startOfLocalDay(date).toISOString().slice(0, 10);
}

export async function getMessageUsageSummary(userId: string, plan: Plan) {
  const usageDate = startOfLocalDay();
  const counter = await db.dailyUsageCounter.findUnique({
    where: {
      userId_usageDate_metric: {
        userId,
        usageDate,
        metric: "message_attempt",
      },
    },
  });

  const limit = PLAN_LIMITS[plan].dailyMessages;
  const used = counter?.used ?? 0;

  return {
    metric: "message_attempt" as const,
    used,
    limit,
    remaining: Math.max(limit - used, 0),
    usageDate: getUsageDateKey(usageDate),
  };
}

export async function consumeMessageQuota(input: {
  userId: string;
  plan: Plan;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}) {
  const usageDate = startOfLocalDay();
  const limit = PLAN_LIMITS[input.plan].dailyMessages;

  return prisma.$transaction(async (tx) => {
    const dbTx = tx as any;
    const existingEvent = await dbTx.usageEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { counter: true },
    });

    if (existingEvent) {
      const used = existingEvent.counter.used;
      return {
        allowed: true,
        used,
        limit,
        remaining: Math.max(limit - used, 0),
        alreadyConsumed: true,
      };
    }

    const current = await dbTx.dailyUsageCounter.findUnique({
      where: {
        userId_usageDate_metric: {
          userId: input.userId,
          usageDate,
          metric: "message_attempt",
        },
      },
    });

    if ((current?.used ?? 0) >= limit) {
      return {
        allowed: false,
        used: current?.used ?? 0,
        limit,
        remaining: 0,
        alreadyConsumed: false,
      };
    }

    const counter = await dbTx.dailyUsageCounter.upsert({
      where: {
        userId_usageDate_metric: {
          userId: input.userId,
          usageDate,
          metric: "message_attempt",
        },
      },
      create: {
        userId: input.userId,
        usageDate,
        metric: "message_attempt",
        used: 1,
      },
      update: {
        used: { increment: 1 },
      },
    });

    await dbTx.usageEvent.create({
      data: {
        userId: input.userId,
        counterId: counter.id,
        metric: "message_attempt",
        usageDate,
        quantity: 1,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      },
    });

    return {
      allowed: true,
      used: counter.used,
      limit,
      remaining: Math.max(limit - counter.used, 0),
      alreadyConsumed: false,
    };
  });
}
