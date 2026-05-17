import type {
  WorkerStartCmd, WorkerConnectCmd, WorkerCheckCmd, WorkerMessage,
} from "@insta-saas/shared";

declare global {
  interface Window {
    worker: {
      connect: (cmd: WorkerConnectCmd) => Promise<{ ok?: true; error?: string }>;
      start: (cmd: WorkerStartCmd) => Promise<{ ok?: true; error?: string }>;
      stop: (accountId: string) => Promise<{ ok?: true; error?: string }>;
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
