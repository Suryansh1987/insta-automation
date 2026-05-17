import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { prisma } from "../db/prisma";
import { generatePersonalizedMessage } from "../services/llm";
import { consumeMessageQuota } from "../services/usage";

export const automationRouter = Router();
automationRouter.use(requireAuth);

const startSchema = z
  .object({
    igAccountId: z.string(),
    targets: z
      .array(z.object({ username: z.string().min(1), message: z.string().optional() }))
      .min(1, "At least one target is required"),
    defaultMessage: z.string().min(1, "Default message is required"),
    minDelayMs: z.number().int().min(0),
    maxDelayMs: z.number().int().min(0),
  })
  .refine((d) => d.minDelayMs <= d.maxDelayMs, {
    message: "minDelayMs must be <= maxDelayMs",
  });

automationRouter.post("/start", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const body = startSchema.parse(req.body);

    const account = await prisma.igAccount.findFirst({
      where: { id: body.igAccountId, userId: r.userId },
    });
    if (!account) return res.status(404).json({ error: "Instagram account not found." });

    // Auto-stop any previously running job for this account
    await prisma.automationJob.updateMany({
      where: { igAccountId: body.igAccountId, status: "running" },
      data: { status: "stopped", stoppedAt: new Date() },
    });

    const job = await prisma.automationJob.create({
      data: {
        userId: r.userId,
        igAccountId: body.igAccountId,
        status: "running",
        totalTargets: body.targets.length,
        defaultMessage: body.defaultMessage,
        startedAt: new Date(),
      },
    });

    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});

automationRouter.post("/stop/:jobId", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const job = await prisma.automationJob.findFirst({
      where: { id: req.params.jobId, userId: r.userId },
    });
    if (!job) return res.status(404).json({ error: "Job not found." });
    if (job.status !== "running") {
      return res.status(400).json({ error: `Job is already in status: ${job.status}` });
    }

    const updated = await prisma.automationJob.update({
      where: { id: job.id },
      data: { status: "stopped", stoppedAt: new Date() },
    });

    res.json({ job: updated });
  } catch (err) {
    next(err);
  }
});

// Save a single message record + increment job counters
const saveMessageSchema = z.object({
  jobId: z.string(),
  username: z.string().min(1),
  messageSent: z.string().optional(),
  status: z.enum(["sent", "failed", "skipped"]),
  tokenCount: z.number().int().min(0).default(0),
  errorReason: z.string().optional(),
});

const saveLogSchema = z.object({
  jobId: z.string(),
  level: z.enum(["info", "warn", "error"]).default("info"),
  message: z.string().min(1),
});

const consumeQuotaSchema = z.object({
  jobId: z.string(),
  username: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

automationRouter.post("/message", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const body = saveMessageSchema.parse(req.body);

    // Verify job belongs to this user
    const job = await prisma.automationJob.findFirst({
      where: { id: body.jobId, userId: r.userId },
    });
    if (!job) return res.status(404).json({ error: "Job not found." });

    const [record] = await prisma.$transaction([
      prisma.messageRecord.create({
        data: {
          jobId: body.jobId,
          username: body.username,
          messageSent: body.messageSent,
          status: body.status,
          tokenCount: body.tokenCount,
          errorReason: body.errorReason,
        },
      }),
      prisma.automationJob.update({
        where: { id: body.jobId },
        data: {
          sent:        body.status === "sent"    ? { increment: 1 } : undefined,
          failed:      body.status === "failed"  ? { increment: 1 } : undefined,
          totalTokens: body.tokenCount > 0       ? { increment: body.tokenCount } : undefined,
        },
      }),
    ]);

    res.status(201).json({ record });
  } catch (err) {
    next(err);
  }
});

automationRouter.post("/consume-message-quota", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const body = consumeQuotaSchema.parse(req.body);

    const job = await prisma.automationJob.findFirst({
      where: { id: body.jobId, userId: r.userId },
    });
    if (!job) return res.status(404).json({ error: "Job not found." });

    const quota = await consumeMessageQuota({
      userId: r.userId,
      plan: r.userPlan,
      idempotencyKey: body.idempotencyKey,
      metadata: {
        jobId: body.jobId,
        username: body.username,
      },
    });

    if (!quota.allowed) {
      return res.status(429).json({
        error: `Daily message limit reached for your ${r.userPlan} plan.`,
        code: "DAILY_MESSAGE_LIMIT_REACHED",
        ...quota,
      });
    }

    res.json(quota);
  } catch (err) {
    next(err);
  }
});

automationRouter.post("/log", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const body = saveLogSchema.parse(req.body);

    const job = await prisma.automationJob.findFirst({
      where: { id: body.jobId, userId: r.userId },
    });
    if (!job) return res.status(404).json({ error: "Job not found." });

    const log = await prisma.jobLog.create({
      data: {
        jobId: body.jobId,
        level: body.level,
        message: body.message,
      },
    });

    res.status(201).json({ log });
  } catch (err) {
    next(err);
  }
});

// Called by the worker when the run ends (done / stopped / error)
automationRouter.post("/finalize/:jobId", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const { status } = z.object({ status: z.enum(["done", "stopped", "error"]) }).parse(req.body);
    const job = await prisma.automationJob.findFirst({
      where: { id: req.params.jobId, userId: r.userId },
    });
    if (!job) return res.status(404).json({ error: "Job not found." });
    const updated = await prisma.automationJob.update({
      where: { id: job.id },
      data: { status, stoppedAt: new Date() },
    });
    res.json({ job: updated });
  } catch (err) {
    next(err);
  }
});

automationRouter.post("/personalize", async (req, res, next) => {
  try {
    const personalizeSchema = z.object({
      posts: z.array(
        z.object({
          caption: z.string(),
          likes: z.number().nullable(),
          comments: z.number().nullable(),
        }),
      ),
      bio: z.string(),
      profileScreenshot: z.string().optional(),
      senderName: z.string().min(1),
    });
    const { posts, bio, profileScreenshot, senderName } = personalizeSchema.parse(req.body);
    const result = await generatePersonalizedMessage(posts, bio, profileScreenshot, senderName);
    res.json({ message: result.message, tokenCount: result.tokenCount });
  } catch (err) {
    next(err);
  }
});

// List all jobs for the user (most recent first)
automationRouter.get("/jobs", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;

    // Jobs stuck in "running" with no recent activity (older than 30 min) are treated as errored
    await prisma.automationJob.updateMany({
      where: {
        userId: r.userId,
        status: "running",
        startedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
      },
      data: { status: "error", stoppedAt: new Date() },
    });

    const jobs = await prisma.automationJob.findMany({
      where: { userId: r.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        igAccount: { select: { username: true } },
        _count: { select: { messageRecords: true } },
      },
    });
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
});

// Dashboard analytics
automationRouter.get("/analytics", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;

    // Last 7 days daily stats
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const records = await prisma.messageRecord.findMany({
      where: { job: { userId: r.userId }, sentAt: { gte: since } },
      select: { sentAt: true, status: true, tokenCount: true, seen: true, replied: true },
    });

    const dayMap: Record<string, { date: string; sent: number; failed: number; tokens: number; seen: number; replied: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = { date: key, sent: 0, failed: 0, tokens: 0, seen: 0, replied: 0 };
    }
    for (const r of records) {
      const key = r.sentAt.toISOString().slice(0, 10);
      if (!dayMap[key]) continue;
      if (r.status === "sent") dayMap[key].sent++;
      else if (r.status === "failed") dayMap[key].failed++;
      dayMap[key].tokens += r.tokenCount;
      if (r.seen) dayMap[key].seen++;
      if (r.replied) dayMap[key].replied++;
    }

    // All-time totals
    const totals = await prisma.automationJob.aggregate({
      where: { userId: r.userId },
      _sum: { sent: true, failed: true, totalTokens: true },
      _count: { id: true },
    });

    // Today's jobs
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayJobs = await prisma.automationJob.findMany({
      where: { userId: r.userId, createdAt: { gte: todayStart } },
      orderBy: { createdAt: "desc" },
      include: { igAccount: { select: { username: true } } },
    });

    res.json({
      daily: Object.values(dayMap),
      totals: {
        jobs: totals._count.id,
        sent: totals._sum.sent ?? 0,
        failed: totals._sum.failed ?? 0,
        tokens: totals._sum.totalTokens ?? 0,
      },
      todayJobs,
    });
  } catch (err) {
    next(err);
  }
});

// Bulk update seen/replied for message records (after Playwright check)
automationRouter.patch("/message-records", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const schema = z.array(z.object({
      id: z.string(),
      seen: z.boolean().optional(),
      seenAt: z.string().optional(),
      replied: z.boolean().optional(),
      repliedAt: z.string().optional(),
      replyPreview: z.string().optional(),
    }));
    const updates = schema.parse(req.body);

    const results = await prisma.$transaction(
      updates.map((u) =>
        prisma.messageRecord.updateMany({
          where: { id: u.id, job: { userId: r.userId } },
          data: {
            seen: u.seen,
            seenAt: u.seenAt ? new Date(u.seenAt) : undefined,
            replied: u.replied,
            repliedAt: u.repliedAt ? new Date(u.repliedAt) : undefined,
            replyPreview: u.replyPreview,
          },
        })
      )
    );

    const saved = updates.map((u, index) => ({
      id: u.id,
      updated: results[index]?.count ?? 0,
    }));
    const missingIds = saved.filter((entry) => entry.updated === 0).map((entry) => entry.id);

    if (missingIds.length > 0) {
      return res.status(404).json({
        ok: false,
        error: "Some message records could not be updated.",
        saved,
        missingIds,
      });
    }

    res.json({ ok: true, saved });
  } catch (err) {
    next(err);
  }
});

// Job detail: logs + message records
automationRouter.get("/status/:jobId", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const job = await prisma.automationJob.findFirst({
      where: { id: req.params.jobId, userId: r.userId },
      include: {
        igAccount: { select: { username: true } },
        logs: { orderBy: { createdAt: "desc" }, take: 50 },
        messageRecords: { orderBy: { sentAt: "asc" } },
      },
    });
    if (!job) return res.status(404).json({ error: "Job not found." });
    res.json({ job });
  } catch (err) {
    next(err);
  }
});
