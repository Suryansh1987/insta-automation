import { Request, Response, NextFunction } from "express";
import type { Plan } from "@insta-saas/shared";
export interface AuthRequest extends Request {
    userId: string;
    userPlan: Plan;
}
export declare function requireAuth(req: Request, res: Response, next: NextFunction): Promise<Response<any, Record<string, any>> | undefined>;
//# sourceMappingURL=auth.d.ts.map