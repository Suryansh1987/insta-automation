import type {
  WorkerStartCmd, WorkerConnectCmd, WorkerCheckCmd, WorkerMessage,
} from "@insta-saas/shared";

interface RazorpayPaymentResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  subscription_id?: string;
  name?: string;
  description?: string;
  handler?: (response: RazorpayPaymentResponse) => void;
  modal?: { ondismiss?: () => void };
  prefill?: Record<string, string>;
  theme?: { color?: string };
}

interface RazorpayInstance {
  open: () => void;
  close: () => void;
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
    worker: {
      connect: (cmd: WorkerConnectCmd) => Promise<{ ok?: true; error?: string }>;
      start: (cmd: WorkerStartCmd) => Promise<{ ok?: true; error?: string }>;
      stop: (accountId: string) => Promise<{ ok?: true; error?: string }>;
      refreshToken: (accountId: string, token: string) => Promise<{ ok?: true; error?: string }>;
      kill: (accountId: string) => Promise<{ ok?: true; error?: string }>;
      isRunning: (accountId: string) => Promise<{ running: boolean }>;
      check: (cmd: WorkerCheckCmd) => Promise<{ ok?: true; error?: string }>;
      onMessage: (cb: (msg: WorkerMessage) => void) => () => void;
      offMessage: (cb?: (msg: WorkerMessage) => void) => void;
    };
    debugLog: (tag: string, ...args: unknown[]) => void;
    desktop: {
      openExternal: (url: string) => Promise<{ ok?: true; error?: string }>;
    };
  }
}
