import { Router } from "express";
import { z } from "zod";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { enforcePlanLimit } from "../middleware/planGuard";
import { prisma } from "../db/prisma";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);

const ACCOUNT_SELECT = {
  id: true,
  username: true,
  status: true,
  proxy: true,
  lastActiveAt: true,
  createdAt: true,
} as const;

accountsRouter.get("/", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const accounts = await prisma.igAccount.findMany({
      where: { userId: r.userId },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: "asc" },
    });
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

const connectSchema = z.object({
  username: z.string().min(1, "Username is required"),
  proxy: z.string().optional(),
});

// Create the account record. No password — the user logs in manually via a non-headless
// browser spawned by the Electron app. Session is persisted to disk by Playwright.
accountsRouter.post("/connect", enforcePlanLimit, async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const { username, proxy } = connectSchema.parse(req.body);

    const existing = await prisma.igAccount.findUnique({
      where: { userId_username: { userId: r.userId, username } },
    });
    if (existing) {
      return res.status(409).json({ error: "This Instagram account is already connected." });
    }

    const account = await prisma.igAccount.create({
      data: { userId: r.userId, username, proxy, status: "disconnected" },
      select: ACCOUNT_SELECT,
    });

    res.status(201).json({ account });
  } catch (err) {
    next(err);
  }
});

accountsRouter.delete("/:id", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const account = await prisma.igAccount.findFirst({
      where: { id: req.params.id, userId: r.userId },
    });
    if (!account) return res.status(404).json({ error: "Account not found." });

    await prisma.igAccount.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const statusSchema = z.object({
  status: z.enum(["active", "paused", "error", "disconnected"]),
});

// Called by the worker after a successful manual login to mark the account active
accountsRouter.patch("/:id/status", async (req, res, next) => {
  try {
    const r = req as unknown as AuthRequest;
    const { status } = statusSchema.parse(req.body);

    const account = await prisma.igAccount.findFirst({
      where: { id: req.params.id, userId: r.userId },
    });
    if (!account) return res.status(404).json({ error: "Account not found." });

    const updated = await prisma.igAccount.update({
      where: { id: req.params.id },
      data: { status, lastActiveAt: status === "active" ? new Date() : undefined },
      select: ACCOUNT_SELECT,
    });

    res.json({ account: updated });
  } catch (err) {
    next(err);
  }
});
