export type Plan = "free" | "pro" | "max";

export interface PlanLimit {
  maxAccounts: number;
  dailyMessages: number;
  label: string;
  price: string;
}

export const PLAN_LIMITS: Record<Plan, PlanLimit> = {
  free: { maxAccounts: 1, dailyMessages: 10, label: "Free", price: "$0/mo" },
  pro: { maxAccounts: 3, dailyMessages: 200, label: "Pro", price: "Razorpay plan" },
  max: { maxAccounts: 5, dailyMessages: 1000, label: "Max", price: "Razorpay plan" },
};

export const PLAN_FEATURES: Record<Plan, string[]> = {
  free: [
    "1 Instagram account",
    "10 messages per day",
    "Basic DM automation",
    "Default message templates",
  ],
  pro: [
    "3 Instagram accounts",
    "200 messages per day",
    "AI-personalized messages",
    "Excel target upload",
    "Priority support",
  ],
  max: [
    "5 Instagram accounts",
    "1000 messages per day",
    "AI-personalized messages",
    "Excel target upload",
    "Proxy support per account",
    "Analytics dashboard",
    "Priority support",
  ],
};

export interface SignupRequest  { email: string; password: string }
export interface LoginRequest   { email: string; password: string }
export interface AuthResponse   { token: string; user: UserProfile }

export interface UserProfile {
  id: string;
  email: string;
  plan: Plan;
}

export type SubscriptionStatus =
  | "created"
  | "authenticated"
  | "active"
  | "pending"
  | "halted"
  | "cancelled"
  | "completed"
  | "expired";

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
  limits: PlanLimit;
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
export type MessageStatus = "sent" | "failed" | "skipped";

export interface AutomationJob {
  id: string;
  igAccountId: string;
  igAccountUsername?: string;
  status: JobStatus;
  totalTargets: number;
  sent: number;
  failed: number;
  defaultMessage: string | null;
  totalTokens: number;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  logs: JobLog[];
  messageRecords?: MessageRecord[];
}

export interface JobLog {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  createdAt: string;
}

export interface MessageRecord {
  id: string;
  jobId: string;
  username: string;
  messageSent: string | null;
  status: MessageStatus;
  tokenCount: number;
  errorReason: string | null;
  seen: boolean;
  seenAt: string | null;
  replied: boolean;
  repliedAt: string | null;
  replyPreview: string | null;
  sentAt: string;
}

export interface SaveMessageRequest {
  jobId: string;
  username: string;
  messageSent?: string;
  status: MessageStatus;
  tokenCount?: number;
  errorReason?: string;
}

export interface StartJobRequest {
  igAccountId: string;
  targets: Array<{ username: string; message?: string }>;
  defaultMessage: string;
  minDelayMs: number;
  maxDelayMs: number;
}

export type WorkerMessageType = "log" | "status" | "progress" | "error" | "message_sent" | "check_result" | "check_done" | "stage";
export type WorkerWorkflow = "connect" | "send" | "analyze";
export type WorkerStageState = "pending" | "active" | "done" | "error";

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
  checkRecordId?: string;
  checkUsername?: string;
  checkSeen?: boolean;
  checkReplied?: boolean;
  checkReplyPreview?: string;
  workflow?: WorkerWorkflow;
  stageId?: string;
  stageLabel?: string;
  stageState?: WorkerStageState;
  stageDetail?: string;
  stageUsername?: string;
}

export interface WorkerStartCmd {
  cmd: "start";
  accountId: string;
  jobId: string;
  sessionDir: string;
  serverUrl: string;
  authToken: string;
  targets: Array<{ username: string; message?: string }>;
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

export interface WorkerCheckCmd {
  cmd: "check";
  accountId: string;
  jobId: string;
  sessionDir: string;
  serverUrl: string;
  authToken: string;
  targets: Array<{ username: string; messageRecordId: string }>;
}

export interface PersonalizeRequest {
  posts: Array<{ caption: string; likes: number | null; comments: number | null }>;
  bio: string;
  profileScreenshot?: string;
  senderName: string;
}

export interface PersonalizeResponse {
  message: string | null;
  tokenCount: number;
}
