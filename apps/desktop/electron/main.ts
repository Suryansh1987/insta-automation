import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import path from "path";
import http from "http";
import fs from "fs";
import { spawn, ChildProcess, execSync } from "child_process";
import type { AddressInfo } from "net";
import type { WorkerStartCmd, WorkerConnectCmd, WorkerCheckCmd, WorkerMessage } from "@insta-saas/shared";
import { initLogger, log } from "./logger";

const IS_DEV = process.env.ELECTRON_IS_DEV === "true" || !app.isPackaged;
const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

// Write a breadcrumb to TEMP the instant the process starts — before app.whenReady()
// This file always exists if the exe launched, regardless of whether the app reaches ready.
try {
  const tmpLog = path.join(
    process.env.TEMP ?? process.env.TMP ?? "C:\\Temp",
    "instaflow-startup.txt"
  );
  fs.writeFileSync(tmpLog,
    `started=${new Date().toISOString()}\nIS_DEV=${IS_DEV}\nisPackaged=${app.isPackaged}\n__dirname=${__dirname}\n`,
    "utf8"
  );
} catch { /* ignore — TEMP may not be writable */ }

let mainWindow: BrowserWindow | null = null;
let localServer: http.Server | null = null;
const workers = new Map<string, ChildProcess>();

const MIME: Record<string, string> = {
  ".html":  "text/html",
  ".js":    "application/javascript",
  ".css":   "text/css",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".svg":   "image/svg+xml",
  ".ico":   "image/x-icon",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
};

// Clerk-hosted domains that should open in the system browser, not the Electron window
const CLERK_EXTERNAL_HOSTS = new Set([
  "accounts.clerk.dev",
  "clerk.accounts.dev",
  "clerk.dev",
]);

// ─── Local HTTP server (production only) ──────────────────────────────────────

function startLocalServer(distDir: string): Promise<number> {
  return new Promise((resolve) => {
    localServer = http.createServer((req, res) => {
      const urlPath = (req.url ?? "/").split("?")[0];
      const filePath = path.join(distDir, urlPath === "/" ? "index.html" : urlPath);
      const ext = path.extname(filePath);

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // SPA fallback: unknown paths → index.html
          fs.readFile(path.join(distDir, "index.html"), (_e, html) => {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(html);
          });
          return;
        }
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
        res.end(data);
      });
    });

    localServer.listen(0, "localhost", () => {
      resolve((localServer!.address() as AddressInfo).port);
    });
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);

  let appURL: string;
  if (IS_DEV) {
    appURL = "http://localhost:5173";
  } else {
    const distDir = path.join(process.resourcesPath, "app.asar.unpacked", "dist");
    const port = await startLocalServer(distDir);
    appURL = `http://localhost:${port}`;
  }

  log("startup", `IS_DEV=${IS_DEV}`);
  log("startup", `app.isPackaged=${app.isPackaged}`);
  log("startup", `__dirname=${__dirname}`);
  log("startup", `resourcesPath=${process.resourcesPath ?? "(undefined)"}`);
  log("startup", `appURL=${appURL}`);

  const wc = mainWindow.webContents;

  // ── Every navigation event, in firing order ──────────────────
  //   will-navigate          → renderer is about to start a cross-document navigation
  //   did-start-navigation   → navigation committed to start (fired for all frames)
  //   did-redirect-navigation→ server-side 3xx redirect received
  //   did-navigate           → main frame finished navigating (new document loaded)
  //   did-navigate-in-page   → same-document navigation: hash change / pushState / replaceState
  //   did-finish-load        → page's load event fired
  //   did-fail-load          → navigation or load failed (ERR_* codes)
  //   did-fail-provisional-load → navigation failed before any response
  // ─────────────────────────────────────────────────────────────

  wc.on("will-navigate", (event, url, _isInPlace, isMainFrame) => {
    log("will-navigate", url);
    if (!isMainFrame) return; // allow subframe/iframe navigations (e.g. Razorpay checkout iframe)
    if (url.startsWith(appURL)) return; // same-origin — always allow

    event.preventDefault();
    log("will-navigate", `BLOCKED: ${url}`);

    try {
      const { hostname } = new URL(url);
      if (CLERK_EXTERNAL_HOSTS.has(hostname)) {
        log("will-navigate", `→ opening Clerk URL in system browser: ${url}`);
        shell.openExternal(url);
      }
    } catch { /* ignore malformed URLs */ }
  });

  wc.on("did-start-navigation", (_event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
    log("did-start-navigation", { url, isInPlace, isMainFrame, frameProcessId, frameRoutingId });
  });

  // Server-side redirect (Clerk's OAuth flows can produce these)
  wc.on("did-redirect-navigation", (_event, url, isInPlace, isMainFrame, frameProcessId, frameRoutingId) => {
    log("did-redirect-navigation", { url, isInPlace, isMainFrame, frameProcessId, frameRoutingId });
  });

  wc.on("did-navigate", (_event, url, httpResponseCode) => {
    log("did-navigate", { url, httpResponseCode });
  });

  // Hash changes and pushState/replaceState — NOT caught by will-navigate
  wc.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    log("did-navigate-in-page", { url, isMainFrame });
  });

  wc.on("did-finish-load", () => {
    log("did-finish-load", wc.getURL());
  });

  wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    log("did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame });
    if (errorCode === -3) return; // ERR_ABORTED — intentionally cancelled above
    log("did-fail-load", "→ reloading app to", appURL);
    mainWindow?.loadURL(appURL);
  });

  wc.on("did-fail-provisional-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    log("did-fail-provisional-load", { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  // New windows (OAuth pop-ups, window.open calls from Clerk)
  wc.setWindowOpenHandler(({ url }) => {
    log("setWindowOpenHandler", url);
    try {
      const { hostname } = new URL(url);
      if (CLERK_EXTERNAL_HOSTS.has(hostname) || url.startsWith(appURL)) {
        shell.openExternal(url);
      }
    } catch { /* ignore */ }
    return { action: "deny" };
  });

  // Renderer console → persistent log (catches errors that vanish before DevTools opens)
  wc.on("console-message", (_event, level, message, line, sourceId) => {
    log("console", { level, message, line, sourceId });
  });

  mainWindow.loadURL(appURL);
  log("startup", `loadURL called: ${appURL}`);

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  initLogger(); // must be after app is ready so app.getPath("userData") resolves
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const worker of workers.values()) killWorkerTree(worker);
  localServer?.close();
  if (process.platform !== "darwin") app.quit();
});

// ─── Worker IPC ───────────────────────────────────────────────────────────────

// On Windows, worker.kill() only kills the Node process — chrome-headless-shell
// grandchildren become orphans and keep their lock on the session directory.
// taskkill /F /T kills the entire process tree including all descendants.
function killWorkerTree(proc: ChildProcess): void {
  if (process.platform === "win32" && proc.pid) {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: "ignore" });
    } catch { /* process may already be gone */ }
  } else {
    proc.kill("SIGKILL");
  }
}

function spawnWorker(accountId: string, firstCmd: object): ChildProcess | { error: string } {
  // Auto-kill any existing worker for this account so the user can restart freely
  const existing = workers.get(accountId);
  if (existing) {
    existing.removeAllListeners("exit"); // prevent the exit handler from sending a spurious error status to the UI
    killWorkerTree(existing);
    workers.delete(accountId);
    log("worker:spawn", `killed existing worker for accountId=${accountId} before respawn`);
  }

  // In dev, app.getAppPath() = apps/desktop/ → go up two levels to reach insta-saas/
  const workerScript = IS_DEV
    ? path.join(app.getAppPath(), "../../apps/worker/src/worker.ts")
    : path.join(process.resourcesPath, "worker.js");

  const bundledBrowsersPath = path.join(process.resourcesPath, "playwright-browsers");

  const workerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(!IS_DEV && { ELECTRON_RUN_AS_NODE: "1" }),
    // Always point to bundled browsers in production; in dev, use system default (no override)
    ...(!IS_DEV && { PLAYWRIGHT_BROWSERS_PATH: bundledBrowsersPath }),
  };

  log("worker:spawn", `script=${workerScript} browsersPath=${IS_DEV ? "(system default)" : bundledBrowsersPath}`);

  const proc = IS_DEV
    ? spawn("npx", ["tsx", workerScript], { stdio: ["pipe", "pipe", "pipe"], shell: true, env: workerEnv })
    : spawn(process.execPath, [workerScript], { stdio: ["pipe", "pipe", "pipe"], env: workerEnv });

  workers.set(accountId, proc);
  proc.stdin!.write(JSON.stringify(firstCmd) + "\n");

  // Forward worker stderr to the persistent debug log
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (chunk: string) => {
    log("worker:stderr", chunk.trimEnd());
  });

  let buffer = "";
  proc.stdout!.setEncoding("utf8");
  proc.stdout!.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg: WorkerMessage = JSON.parse(trimmed);
        log("worker:ipc-out", JSON.stringify(msg));
        mainWindow?.webContents.send("worker:message", msg);
      } catch { /* ignore non-JSON */ }
    }
  });

  proc.on("exit", (code, signal) => {
    log("worker:exit", `accountId=${accountId} pid=${proc.pid} code=${code} signal=${signal}`);
    workers.delete(accountId);
    // If the worker exits without sending a terminal status, synthesise an error
    // so the UI doesn't stay stuck at "Browser open…" forever.
    log("worker:exit", `sending synthetic error status to UI for accountId=${accountId}`);
    mainWindow?.webContents.send("worker:message", {
      type: "status", accountId, jobId: accountId, status: "error",
    } satisfies WorkerMessage);
  });

  return proc;
}

// In dev, store sessions next to the project so they persist across restarts
// and match the location created by older dev runs. In prod, use the OS userData dir.
const sessionsBase = IS_DEV
  ? path.join(app.getAppPath(), "sessions")
  : path.join(app.getPath("userData"), "sessions");
log("sessions", `sessionsBase=${sessionsBase} IS_DEV=${IS_DEV} appPath=${app.getAppPath()}`);

ipcMain.handle("worker:connect", async (_event, cmd: WorkerConnectCmd) => {
  const result = spawnWorker(cmd.accountId, {
    ...cmd,
    sessionDir: path.join(sessionsBase, cmd.accountId),
  });
  if ("error" in result) return result;
  return { ok: true };
});

ipcMain.handle("worker:start", async (_event, cmd: WorkerStartCmd) => {
  const sessionDir = path.join(sessionsBase, cmd.accountId);
  log("worker:start", `accountId=${cmd.accountId} sessionDir=${sessionDir} targets=${cmd.targets?.length ?? 0}`);
  const result = spawnWorker(cmd.accountId, { ...cmd, sessionDir });
  if ("error" in result) return result;
  return { ok: true };
});

ipcMain.handle("worker:stop", async (_event, accountId: string) => {
  const worker = workers.get(accountId);
  if (!worker) return { error: "No worker running for this account." };
  worker.stdin!.write(JSON.stringify({ cmd: "stop" }) + "\n");
  return { ok: true };
});

ipcMain.handle("worker:refreshToken", async (_event, accountId: string, token: string) => {
  const worker = workers.get(accountId);
  if (!worker) return { ok: true }; // job already finished, no-op
  worker.stdin!.write(JSON.stringify({ cmd: "refreshToken", token }) + "\n");
  log("worker:refreshToken", `sent fresh token to worker for accountId=${accountId}`);
  return { ok: true };
});

ipcMain.handle("worker:kill", async (_event, accountId: string) => {
  log("worker:kill", `called for accountId=${accountId} hasWorker=${workers.has(accountId)}`);
  const worker = workers.get(accountId);
  if (!worker) {
    log("worker:kill", `no worker found for accountId=${accountId} — nothing to kill`);
    return { ok: true };
  }
  killWorkerTree(worker);
  workers.delete(accountId);
  log("worker:kill", `force-killed worker pid=${worker.pid} for accountId=${accountId}`);
  return { ok: true };
});

ipcMain.handle("worker:isRunning", async (_event, accountId: string) => {
  return { running: workers.has(accountId) };
});

ipcMain.handle("worker:check", async (_event, cmd: WorkerCheckCmd) => {
  const result = spawnWorker(cmd.accountId, {
    ...cmd,
    sessionDir: path.join(sessionsBase, cmd.accountId),
  });
  if ("error" in result) return result;
  return { ok: true };
});

ipcMain.handle("desktop:openExternal", async (_event, url: string) => {
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to open external URL." };
  }
});
