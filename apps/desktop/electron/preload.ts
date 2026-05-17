/**
 * Preload — runs in an isolated context but shares the DOM with the renderer.
 * Everything registered here fires BEFORE React or Clerk loads.
 *
 * Instrumentation in this file:
 *   - history.pushState / replaceState patches  (React Router navigation)
 *   - window.location.assign / replace patches  (hard navigations)
 *   - Capture-phase click listener              (catches raw <a> clicks)
 *   - hashchange / popstate listeners           (back/forward, hash changes)
 *   - All events forwarded to main via IPC so they land in the persistent log
 */

import { contextBridge, ipcRenderer } from "electron";
import type { WorkerStartCmd, WorkerConnectCmd, WorkerCheckCmd, WorkerMessage } from "@insta-saas/shared";

const workerMessageListeners = new Map<(msg: WorkerMessage) => void, (_event: Electron.IpcRendererEvent, msg: WorkerMessage) => void>();

// ─── IPC bridge (existing worker API) ────────────────────────────────────────

contextBridge.exposeInMainWorld("worker", {
  connect: (cmd: WorkerConnectCmd): Promise<{ ok?: true; error?: string }> =>
    ipcRenderer.invoke("worker:connect", cmd),

  start: (cmd: WorkerStartCmd): Promise<{ ok?: true; error?: string }> =>
    ipcRenderer.invoke("worker:start", cmd),

  stop: (accountId: string): Promise<{ ok?: true; error?: string }> =>
    ipcRenderer.invoke("worker:stop", accountId),

  kill: (accountId: string): Promise<{ ok?: true; error?: string }> =>
    ipcRenderer.invoke("worker:kill", accountId),

  isRunning: (accountId: string): Promise<{ running: boolean }> =>
    ipcRenderer.invoke("worker:isRunning", accountId),

  check: (cmd: WorkerCheckCmd): Promise<{ ok?: true; error?: string }> =>
    ipcRenderer.invoke("worker:check", cmd),

  onMessage: (callback: (msg: WorkerMessage) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: WorkerMessage) => callback(msg);
    workerMessageListeners.set(callback, handler);
    ipcRenderer.on("worker:message", handler);
    return () => {
      const bound = workerMessageListeners.get(callback);
      if (!bound) return;
      ipcRenderer.removeListener("worker:message", bound);
      workerMessageListeners.delete(callback);
    };
  },

  offMessage: (callback?: (msg: WorkerMessage) => void): void => {
    if (callback) {
      const handler = workerMessageListeners.get(callback);
      if (!handler) return;
      ipcRenderer.removeListener("worker:message", handler);
      workerMessageListeners.delete(callback);
      return;
    }

    for (const handler of workerMessageListeners.values()) {
      ipcRenderer.removeListener("worker:message", handler);
    }
    workerMessageListeners.clear();
  },
});

// ─── Debug bridge — renderer can send logs to the persistent file ────────────

contextBridge.exposeInMainWorld("debugLog", (tag: string, ...args: unknown[]) => {
  ipcRenderer.send("debug:log", tag, ...args);
});

contextBridge.exposeInMainWorld("desktop", {
  openExternal: (url: string): Promise<{ ok?: true; error?: string }> =>
    ipcRenderer.invoke("desktop:openExternal", url),
});

// ─── Forensic instrumentation — injected before React or Clerk load ──────────

function rlog(tag: string, ...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  const body = args.map(a =>
    a == null ? String(a) :
    typeof a === "object" ? JSON.stringify(a) : String(a)
  ).join(" ");
  const line = `[${ts}] [preload:${tag}] ${body}`;
  console.log(line);
  ipcRenderer.send("debug:log", tag, ...args);
}

// Log the starting URL immediately — if this shows file://, the HTTP server didn't start
rlog("init", "href =", window.location.href);
rlog("init", "origin =", window.location.origin);
rlog("init", "protocol =", window.location.protocol);

// ── Patch History API ─────────────────────────────────────────────────────────
// React Router (and Clerk) use pushState/replaceState for in-app navigation.
// These do NOT trigger will-navigate in the main process — patching here is the
// only way to catch them from the outside.

const _origPush = history.pushState.bind(history);
history.pushState = function (state: unknown, unused: string, url?: string | URL | null) {
  rlog("history.pushState", String(url ?? "(null)"), new Error().stack?.split("\n")[2]?.trim());
  return _origPush(state, unused, url);
};

const _origReplace = history.replaceState.bind(history);
history.replaceState = function (state: unknown, unused: string, url?: string | URL | null) {
  rlog("history.replaceState", String(url ?? "(null)"), new Error().stack?.split("\n")[2]?.trim());
  return _origReplace(state, unused, url);
};

// window.location.assign / replace / href are read-only inside Electron's
// context isolation sandbox — attempting to patch them crashes the preload.
// Full-document navigations from these calls are caught by will-navigate in
// the main process (see main.ts), which already logs them.

// ── Click capture — detect raw <a> clicks ────────────────────────────────────
// Must be in capture phase (3rd arg = true) so it fires before React's handlers
// and before any preventDefault() call can hide it.

document.addEventListener("click", (e: MouseEvent) => {
  const anchor = (e.target as HTMLElement).closest("a");
  if (!anchor) return;

  rlog("anchor.click", JSON.stringify({
    href:         anchor.getAttribute("href"),      // raw attribute value
    resolvedHref: anchor.href,                      // absolute URL after browser resolution
    text:         anchor.textContent?.trim().slice(0, 60),
    target:       anchor.target || "(none)",
    rel:          anchor.rel || "(none)",
    defaultPrevented: e.defaultPrevented,
  }));
}, true /* capture */);

// ── Hash and popstate changes ─────────────────────────────────────────────────

window.addEventListener("hashchange", (e) => {
  rlog("hashchange", { oldURL: e.oldURL, newURL: e.newURL });
});

window.addEventListener("popstate", (e) => {
  rlog("popstate", { state: JSON.stringify(e.state), href: window.location.href });
});
