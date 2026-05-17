import { Request, Response, NextFunction } from "express";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { prisma } from "../db/prisma";
import type { Plan } from "@insta-saas/shared";

export interface AuthRequest extends Request {
  userId: string;
  userPlan: Plan;
}

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing authorization header" });
  }

  const token = header.slice(7);
  let clerkUserId: string;

  try {
    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });
    clerkUserId = payload.sub;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Auto-provision user in our DB on their first request (after Clerk sign-up)
  let user = await prisma.user.findUnique({
    where: { id: clerkUserId },
    select: { id: true, plan: true },
  });

  if (!user) {
    try {
      const clerkUser = await clerk.users.getUser(clerkUserId);
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? `${clerkUserId}@unknown`;
      user = await prisma.user.create({
        data: { id: clerkUserId, email },
        select: { id: true, plan: true },
      });
    } catch (err) {
      console.error("[auth] Failed to provision user:", err);
      return res.status(500).json({ error: "Failed to provision user account." });
    }
  }

  (req as AuthRequest).userId = user.id;
  (req as AuthRequest).userPlan = user.plan as Plan;
  next();
}
