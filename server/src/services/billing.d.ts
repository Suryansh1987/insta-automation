import type { Plan } from "@insta-saas/shared";
export declare function isBillingReady(): boolean;
export declare function getRazorpayPublicConfig(): {
    billingReady: boolean;
    razorpayKeyId: string | null;
};
export declare function getSubscriptionCheckoutExpireBy(): number;
export declare function verifyRazorpaySignature(input: string, signature: string, secret: string): boolean;
export declare function verifyWebhookSignature(rawBody: string, signature: string): boolean;
export declare function createRazorpaySubscription(input: {
    userId: string;
    email: string;
    plan: Exclude<Plan, "free">;
    idempotencyKey: string;
}): Promise<any>;
export declare function fetchRazorpaySubscription(providerSubscriptionId: string): Promise<any>;
export declare function syncSubscriptionFromProvider(payload: any): Promise<any>;
export declare function attachSuccessfulPayment(input: {
    providerSubscriptionId: string;
    providerPaymentId?: string | null;
}): Promise<any>;
export declare function reconcileUserPlan(userId: string): Promise<{
    plan: Plan;
    limits: import("@insta-saas/shared").PlanLimit;
}>;
//# sourceMappingURL=billing.d.ts.map