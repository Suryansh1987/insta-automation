import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import { prisma } from "../db/prisma";
import { PLAN_LIMITS } from "@insta-saas/shared";

export async function enforcePlanLimit(req: Request, res: Response, next: NextFunction) {
  const authReq = req as AuthRequest;
  const plan = authReq.userPlan;
  const limit = PLAN_LIMITS[plan]?.maxAccounts ?? 1;

  const count = await prisma.igAccount.count({
    where: { userId: authReq.userId },
  });

  if (count >= limit) {
    return res.status(403).json({
      error: `Your ${plan} plan allows a maximum of ${limit} Instagram account(s). Upgrade your plan to add more.`,
      code: "PLAN_LIMIT_EXCEEDED",
      currentPlan: plan,
      limit,
      upgradeRequired: true,
    });
  }

  next();
}
