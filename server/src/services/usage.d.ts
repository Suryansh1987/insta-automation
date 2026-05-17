import { type Plan } from "@insta-saas/shared";
export declare function getUsageDateKey(date?: Date): string;
export declare function getMessageUsageSummary(userId: string, plan: Plan): Promise<{
    metric: "message_attempt";
    used: any;
    limit: number;
    remaining: number;
    usageDate: string;
}>;
export declare function consumeMessageQuota(input: {
    userId: string;
    plan: Plan;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
}): Promise<{
    allowed: boolean;
    used: any;
    limit: number;
    remaining: number;
    alreadyConsumed: boolean;
}>;
//# sourceMappingURL=usage.d.ts.map