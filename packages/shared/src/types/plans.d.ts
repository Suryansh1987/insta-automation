export type Plan = "free" | "pro" | "max";
export interface PlanLimit {
    maxAccounts: number;
    dailyMessages: number;
    label: string;
    price: string;
}
export declare const PLAN_LIMITS: Record<Plan, PlanLimit>;
export declare const PLAN_FEATURES: Record<Plan, string[]>;
//# sourceMappingURL=plans.d.ts.map