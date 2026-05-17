import type { Plan } from "./plans";
export interface SignupRequest {
    email: string;
    password: string;
}
export interface LoginRequest {
    email: string;
    password: string;
}
export interface AuthResponse {
    token: string;
    user: UserProfile;
}
export interface UserProfile {
    id: string;
    email: string;
    plan: Plan;
}
export type SubscriptionStatus = "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled" | "completed" | "expired";
export interface UsageSummary {
    metric: "message_attempt";
    used: number;
    limit: number;
    remaining: number;
    usageDate: string;
}
export interface BillingSubscription {
    id: string;
    plan: Plan;
    status: SubscriptionStatus;
    provider: string;
    providerSubscriptionId: string | null;
    providerCustomerId: string | null;
    shortUrl: string | null;
    currentStart: string | null;
    currentEnd: string | null;
    cancelAtCycleEnd: boolean;
    lastPaymentId: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface PlansResponse {
    plan: Plan;
    limits: {
        maxAccounts: number;
        dailyMessages: number;
        label: string;
        price: string;
    };
    features: string[];
    usage: UsageSummary;
    subscription: BillingSubscription | null;
    billingReady: boolean;
    razorpayKeyId: string | null;
}
export interface CreateSubscriptionRequest {
    plan: Exclude<Plan, "free">;
}
export interface CreateSubscriptionResponse {
    plan: Exclude<Plan, "free">;
    checkoutUrl: string;
    idempotencyKey: string;
    subscription: BillingSubscription;
    message: string;
}
export interface SyncSubscriptionResponse {
    plan: Plan;
    subscription: BillingSubscription | null;
}
export type AccountStatus = "active" | "paused" | "error" | "disconnected";
export interface IgAccount {
    id: string;
    username: string;
    status: AccountStatus;
    proxy?: string;
    lastActiveAt: string | null;
    createdAt: string;
}
export interface ConnectAccountRequest {
    username: string;
    proxy?: string;
}
export type JobStatus = "idle" | "running" | "stopped" | "done" | "error";
export interface AutomationJob {
    id: string;
    igAccountId: string;
    status: JobStatus;
    totalTargets: number;
    sent: number;
    failed: number;
    startedAt: string | null;
    stoppedAt: string | null;
    logs: JobLog[];
}
export interface JobLog {
    id: string;
    level: "info" | "warn" | "error";
    message: string;
    createdAt: string;
}
export interface StartJobRequest {
    igAccountId: string;
    targets: Array<{
        username: string;
        message?: string;
    }>;
    defaultMessage: string;
    minDelayMs: number;
    maxDelayMs: number;
}
export type WorkerMessageType = "log" | "status" | "progress" | "error" | "message_sent";
export interface WorkerMessage {
    type: WorkerMessageType;
    accountId: string;
    level?: "info" | "warn" | "error";
    message?: string;
    status?: JobStatus;
    sent?: number;
    failed?: number;
    jobId?: string;
    username?: string;
    messageSent?: string;
    messageStatus?: "sending" | "sent" | "failed" | "skipped";
}
export interface WorkerStartCmd {
    cmd: "start";
    accountId: string;
    jobId: string;
    sessionDir: string;
    serverUrl: string;
    authToken: string;
    targets: Array<{
        username: string;
        message?: string;
    }>;
    defaultMessage: string;
    minDelayMs: number;
    maxDelayMs: number;
}
export interface WorkerStopCmd {
    cmd: "stop";
}
export interface WorkerConnectCmd {
    cmd: "connect";
    accountId: string;
    sessionDir: string;
}
export interface PersonalizeRequest {
    posts: Array<{
        caption: string;
        likes: number | null;
        comments: number | null;
    }>;
    bio: string;
    profileScreenshot?: string;
    senderName: string;
}
export interface PersonalizeResponse {
    message: string | null;
    tokenCount: number;
}
//# sourceMappingURL=api.d.ts.map