import type { WorkerStartCmd, WorkerConnectCmd, WorkerCheckCmd, WorkerMessage } from "@insta-saas/shared";
import { InstagramClient, type ClientProgressEvent } from "./instagram/client";
import { generatePersonalizedMessage } from "./llm/personalizer";
import { randomDelayMs, sleep } from "./services/delay";

// Redirect all console output to stderr — stdout is reserved for JSON-line IPC only
const toStderr = (...args: unknown[]) => process.stderr.write(args.join(" ") + "\n");
console.log = toStderr;
console.warn = toStderr;
console.error = toStderr;

// Global safety net — catch any unhandled exception or rejection before it silently kills the process
process.on("uncaughtException", (err: Error) => {
  process.stderr.write(`[worker] UNCAUGHT EXCEPTION: ${err.message}\n${err.stack ?? ""}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason: unknown) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason);
  process.stderr.write(`[worker] UNHANDLED REJECTION: ${msg}\n`);
});

let stopRequested = false;
let isRunning = false;

// Clerk session tokens expire in ~60 s. The frontend pushes a fresh token via
// stdin every 45 s so long-running jobs never hit 401s.
let latestAuthToken: string | null = null;
function getAuthToken(cmd: WorkerStartCmd | WorkerCheckCmd): string {
  return latestAuthToken ?? cmd.authToken;
}

function emit(msg: WorkerMessage): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function emitStage(cmd: WorkerStartCmd | WorkerCheckCmd, event: ClientProgressEvent): void {
  emit({
    type: "stage",
    accountId: cmd.accountId,
    jobId: cmd.jobId,
    workflow: event.workflow,
    stageId: event.stageId,
    stageLabel: event.label,
    stageState: event.state,
    stageDetail: event.detail,
    stageUsername: event.username,
  });
}

// ─── stdin reader ─────────────────────────────────────────────

let stdinBuffer = "";
process.stdin.setEncoding("utf8");

process.stdin.on("data", (chunk: string) => {
  stdinBuffer += chunk;
  const lines = stdinBuffer.split("\n");
  stdinBuffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const cmd = JSON.parse(trimmed) as { cmd: string } & Record<string, unknown>;
      handleCommand(cmd);
    } catch {
      process.stderr.write(`[worker] Failed to parse command: ${trimmed}\n`);
    }
  }
});

process.stdin.on("end", () => {
  stopRequested = true;
});

function handleCommand(cmd: { cmd: string } & Record<string, unknown>): void {
  process.stderr.write(`[worker] handleCommand cmd=${cmd.cmd} sessionDir=${cmd.sessionDir ?? "(none)"} isRunning=${isRunning}\n`);
  if (cmd.cmd === "stop") {
    stopRequested = true;
  } else if (cmd.cmd === "refreshToken") {
    const token = cmd.token as string | undefined;
    if (token) {
      latestAuthToken = token;
      process.stderr.write(`[worker] auth token refreshed\n`);
    }
  } else if (cmd.cmd === "connect") {
    if (isRunning) {
      process.stderr.write("[worker] Already running — ignoring connect.\n");
      return;
    }
    runConnect(cmd as unknown as WorkerConnectCmd).catch((err: Error) => {
      process.stderr.write(`[worker] Connect error: ${err.message}\n`);
    });
  } else if (cmd.cmd === "start") {
    if (isRunning) {
      process.stderr.write("[worker] Already running — ignoring start.\n");
      return;
    }
    process.stderr.write(`[worker] Starting job with ${(cmd.targets as unknown[])?.length ?? 0} targets\n`);
    runJob(cmd as unknown as WorkerStartCmd).catch((err: Error) => {
      process.stderr.write(`[worker] Job error: ${err.message}\n${err.stack}\n`);
    });
  } else if (cmd.cmd === "check") {
    if (isRunning) {
      process.stderr.write("[worker] Already running — ignoring check.\n");
      return;
    }
    runCheck(cmd as unknown as WorkerCheckCmd).catch((err: Error) => {
      process.stderr.write(`[worker] Check error: ${err.message}\n`);
    });
  }
}

// ─── helpers ──────────────────────────────────────────────────

async function saveMessageRecord(
  cmd: WorkerStartCmd,
  data: { username: string; messageSent?: string; status: "sent" | "failed" | "skipped"; tokenCount?: number; errorReason?: string },
): Promise<void> {
  const url = `${cmd.serverUrl}/automation/message`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken(cmd)}` },
      body: JSON.stringify({ jobId: cmd.jobId, ...data }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      process.stderr.write(`[worker:saveMessageRecord] HTTP ${response.status} for username=${data.username} status=${data.status} — ${body}\n`);
    } else {
      process.stderr.write(`[worker:saveMessageRecord] saved username=${data.username} status=${data.status}\n`);
    }
  } catch (err) {
    process.stderr.write(`[worker:saveMessageRecord] NETWORK ERROR username=${data.username}: ${(err as Error).message}\n`);
  }
}

async function saveJobLog(
  cmd: WorkerStartCmd | WorkerCheckCmd,
  data: { level?: "info" | "warn" | "error"; message: string },
): Promise<void> {
  const url = `${cmd.serverUrl}/automation/log`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken(cmd)}` },
      body: JSON.stringify({
        jobId: cmd.jobId,
        level: data.level ?? "info",
        message: data.message,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      process.stderr.write(`[worker:saveJobLog] HTTP ${response.status} — ${body}\n`);
    }
  } catch (err) {
    process.stderr.write(`[worker:saveJobLog] NETWORK ERROR: ${(err as Error).message}\n`);
  }
}

async function consumeMessageQuota(
  cmd: WorkerStartCmd,
  username: string,
): Promise<{ allowed: boolean; remaining?: number; error?: string }> {
  const url = `${cmd.serverUrl}/automation/consume-message-quota`;
  process.stderr.write(`[worker:quota] POST ${url} username=${username} jobId=${cmd.jobId}\n`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken(cmd)}` },
      body: JSON.stringify({
        jobId: cmd.jobId,
        username,
        idempotencyKey: `${cmd.jobId}:${username.toLowerCase()}`,
      }),
    });

    process.stderr.write(`[worker:quota] response status=${response.status} ok=${response.ok} username=${username}\n`);

    if (response.ok) {
      const data = await response.json() as { remaining?: number };
      process.stderr.write(`[worker:quota] ALLOWED remaining=${data.remaining ?? "(n/a)"} username=${username}\n`);
      return { allowed: true, remaining: data.remaining };
    }

    const data = await response.json().catch(() => ({} as { error?: string }));
    if (response.status === 429) {
      process.stderr.write(`[worker:quota] DENIED (429 quota exhausted) username=${username} error=${data.error ?? "(none)"}\n`);
      return {
        allowed: false,
        remaining: 0,
        error: data.error ?? "Daily message limit reached.",
      };
    }

    process.stderr.write(`[worker:quota] DENIED (HTTP ${response.status}) username=${username} error=${data.error ?? "(none)"}\n`);
    return {
      allowed: false,
      error: data.error ?? `Quota API returned ${response.status}`,
    };
  } catch (err) {
    process.stderr.write(`[worker:quota] NETWORK ERROR username=${username} error=${(err as Error).message}\n`);
    return {
      allowed: false,
      error: `Quota API call failed: ${(err as Error).message}`,
    };
  }
}

// ─── connect: non-headless manual login ───────────────────────
// No credentials involved — user logs in via the visible browser.
// Playwright saves the session to disk. Worker reports done and exits.

async function runConnect(cmd: WorkerConnectCmd): Promise<void> {
  isRunning = true;

  // accountId used as the jobId placeholder for IPC message routing
  emit({ type: "status", accountId: cmd.accountId, status: "running", jobId: cmd.accountId });
  emit({ type: "log", accountId: cmd.accountId, level: "info", message: "Opening Instagram in browser — please log in.", jobId: cmd.accountId });

  const client = new InstagramClient({ sessionDir: cmd.sessionDir, headless: false });

  try {
    await client.init(); // blocks until user is authenticated
    emit({ type: "log", accountId: cmd.accountId, level: "info", message: "Login successful — session saved.", jobId: cmd.accountId });
    emit({ type: "status", accountId: cmd.accountId, status: "done", jobId: cmd.accountId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "log", accountId: cmd.accountId, level: "error", message, jobId: cmd.accountId });
    emit({ type: "status", accountId: cmd.accountId, status: "error", jobId: cmd.accountId });
  } finally {
    await client.close();
    isRunning = false;
  }
}

// ─── start: headless automation job ──────────────────────────
// Session must already be saved on disk from a prior connect.
// No passwords, no credentials — only authToken to call back to the server API.

async function runJob(cmd: WorkerStartCmd): Promise<void> {
  isRunning = true;
  stopRequested = false;
  let quotaReached = false;

  process.stderr.write(
    `[worker:runJob] START accountId=${cmd.accountId} jobId=${cmd.jobId} ` +
    `sessionDir=${cmd.sessionDir} targets=${cmd.targets.length} ` +
    `serverUrl=${cmd.serverUrl} defaultMessage="${cmd.defaultMessage?.slice(0, 40)}..." ` +
    `minDelayMs=${cmd.minDelayMs} maxDelayMs=${cmd.maxDelayMs}\n`
  );

  emit({ type: "status", accountId: cmd.accountId, status: "running", jobId: cmd.jobId });

  if (cmd.targets.length === 0) {
    process.stderr.write(`[worker:runJob] WARN: targets array is empty — nothing to do\n`);
    emit({ type: "log", accountId: cmd.accountId, level: "warn", message: "No targets provided — job has nothing to do.", jobId: cmd.jobId });
  }

  const client = new InstagramClient({ sessionDir: cmd.sessionDir, headless: true });

  process.stderr.write(`[worker:runJob] created InstagramClient headless=true sessionDir=${cmd.sessionDir}\n`);

  emit({
    type: "stage", accountId: cmd.accountId, jobId: cmd.jobId, workflow: "send",
    stageId: "init_browser", stageLabel: "Launching browser", stageState: "active",
    stageDetail: "Starting headless Chromium and loading session", stageUsername: "",
  });

  process.stderr.write(`[worker:runJob] calling client.init() with 30s timeout...\n`);

  try {
    await Promise.race([
      client.init(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Browser launch timed out after 30 seconds. Check Accounts and re-login.")), 30_000)
      ),
    ]);
    process.stderr.write(`[worker:runJob] client.init() SUCCEEDED\n`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[worker:runJob] client.init() FAILED: ${message}\n`);
    emit({
      type: "stage", accountId: cmd.accountId, jobId: cmd.jobId, workflow: "send",
      stageId: "init_browser", stageLabel: "Launching browser", stageState: "error",
      stageDetail: message, stageUsername: "",
    });
    emit({ type: "log", accountId: cmd.accountId, level: "error", message: `Session error: ${message}`, jobId: cmd.jobId });
    emit({ type: "status", accountId: cmd.accountId, status: "error", jobId: cmd.jobId });
    await client.close().catch(() => undefined);
    isRunning = false;
    return;
  }

  emit({
    type: "stage", accountId: cmd.accountId, jobId: cmd.jobId, workflow: "send",
    stageId: "init_browser", stageLabel: "Launching browser", stageState: "done",
    stageDetail: "Browser ready, session loaded", stageUsername: "",
  });
  process.stderr.write(`[worker:runJob] entering target loop: ${cmd.targets.length} target(s)\n`);
  emit({ type: "log", accountId: cmd.accountId, level: "info", message: "Session loaded — starting automation.", jobId: cmd.jobId });

  const senderName = "Me"; // server could pass this if needed
  let sent = 0;
  let failed = 0;

  for (const [i, target] of cmd.targets.entries()) {
    if (stopRequested) {
      process.stderr.write(`[worker:runJob] stop requested before target[${i}] — breaking loop\n`);
      break;
    }

    const username = target.username.trim();
    process.stderr.write(`[worker:runJob] target[${i + 1}/${cmd.targets.length}] username=${username} — checking quota...\n`);
    const quota = await consumeMessageQuota(cmd, username);
    if (!quota.allowed) {
      quotaReached = true;
      process.stderr.write(`[worker:runJob] quota DENIED for username=${username} — stopping loop. reason: ${quota.error ?? "(none)"}\n`);
      emit({ type: "log", accountId: cmd.accountId, level: "warn", message: quota.error ?? "Daily message limit reached.", jobId: cmd.jobId });
      await saveJobLog(cmd, { level: "warn", message: quota.error ?? "Daily message limit reached." });
      break;
    }

    process.stderr.write(`[worker:runJob] quota OK for username=${username} remaining=${quota.remaining ?? "(n/a)"} — processing target\n`);
    emit({ type: "log", accountId: cmd.accountId, level: "info", message: `[${i + 1}/${cmd.targets.length}] Processing @${username}...`, jobId: cmd.jobId });
    emit({ type: "message_sent", accountId: cmd.accountId, jobId: cmd.jobId, username, messageStatus: "sending" });

    let message = target.message?.trim() || "";
    let tokenCount = 0;

    if (!message) {
      const scrapeResult = await client.scrapeUserPosts(username, 3, (event) => emitStage(cmd, event));

      if (!scrapeResult.messageable) {
        emitStage(cmd, {
          workflow: "send",
          stageId: "send_message",
          label: "Opening message composer",
          state: "error",
          detail: "Message button not available",
          username,
        });
        emit({ type: "log", accountId: cmd.accountId, level: "warn", message: `@${username}: Message button not available — skipping.`, jobId: cmd.jobId });
        emit({ type: "message_sent", accountId: cmd.accountId, jobId: cmd.jobId, username, messageSent: "", messageStatus: "skipped" });
        await saveMessageRecord(cmd, { username, status: "skipped", errorReason: "Message button not available" });
        failed++;
        emit({ type: "progress", accountId: cmd.accountId, sent, failed, jobId: cmd.jobId });
        continue;
      }

      if (scrapeResult.posts.length > 0) {
        emitStage(cmd, {
          workflow: "send",
          stageId: "generate_message",
          label: "Creating message",
          state: "active",
          detail: `Generating AI message for @${username}`,
          username,
        });
        const personalized = await generatePersonalizedMessage(scrapeResult, senderName, { serverUrl: cmd.serverUrl, authToken: getAuthToken(cmd) });
        message = personalized.message ?? cmd.defaultMessage;
        tokenCount = personalized.tokenCount;
        emitStage(cmd, {
          workflow: "send",
          stageId: "generate_message",
          label: "Creating message",
          state: "done",
          detail: personalized.message ? "AI message created" : "Used default fallback message",
          username,
        });
      } else {
        message = cmd.defaultMessage;
        emitStage(cmd, {
          workflow: "send",
          stageId: "generate_message",
          label: "Creating message",
          state: "done",
          detail: "Used default fallback message",
          username,
        });
      }
    } else {
      emitStage(cmd, {
        workflow: "send",
        stageId: "generate_message",
        label: "Creating message",
        state: "done",
        detail: "Using provided message",
        username,
      });
    }

    const result = await client.sendMessage(username, message, (event) => emitStage(cmd, event));
    if (result.status === "sent") {
      sent++;
      emit({ type: "log", accountId: cmd.accountId, level: "info", message: `@${username}: DM sent.`, jobId: cmd.jobId });
      emit({ type: "message_sent", accountId: cmd.accountId, jobId: cmd.jobId, username, messageSent: message, messageStatus: "sent" });
      await saveMessageRecord(cmd, { username, messageSent: message, status: "sent", tokenCount });
    } else {
      failed++;
      emit({ type: "log", accountId: cmd.accountId, level: "warn", message: `@${username}: ${result.status}${result.error ? ` — ${result.error}` : ""}`, jobId: cmd.jobId });
      emit({ type: "message_sent", accountId: cmd.accountId, jobId: cmd.jobId, username, messageSent: message, messageStatus: "failed" });
      await saveMessageRecord(cmd, { username, messageSent: message, status: "failed", tokenCount, errorReason: result.error ?? result.status });
    }

    emit({ type: "progress", accountId: cmd.accountId, sent, failed, jobId: cmd.jobId });

    if (i < cmd.targets.length - 1 && !stopRequested) {
      const delay = randomDelayMs(cmd.minDelayMs, cmd.maxDelayMs);
      emit({ type: "log", accountId: cmd.accountId, level: "info", message: `Waiting ${(delay / 1000).toFixed(0)}s before next message...`, jobId: cmd.jobId });
      await sleep(delay);
    }
  }

  await client.close();

  const finalStatus = stopRequested || quotaReached ? "stopped" : "done";

  // Persist the final status to the DB before emitting IPC so the history page reflects reality
  process.stderr.write(`[worker:runJob] finalizing job jobId=${cmd.jobId} status=${finalStatus} sent=${sent} failed=${failed}\n`);
  try {
    const finalizeUrl = `${cmd.serverUrl}/automation/finalize/${cmd.jobId}`;
    const finalizeRes = await fetch(finalizeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken(cmd)}` },
      body: JSON.stringify({ status: finalStatus }),
    });
    if (!finalizeRes.ok) {
      const body = await finalizeRes.text().catch(() => "");
      process.stderr.write(`[worker:runJob] finalize HTTP ${finalizeRes.status} — ${body}\n`);
    } else {
      process.stderr.write(`[worker:runJob] finalize OK jobId=${cmd.jobId}\n`);
    }
  } catch (err) {
    process.stderr.write(`[worker:runJob] finalize NETWORK ERROR: ${(err as Error).message}\n`);
  }

  emit({ type: "status", accountId: cmd.accountId, status: finalStatus, sent, failed, jobId: cmd.jobId });
  isRunning = false;
}

// ─── check: inspect existing DM threads for seen/replied ──────

async function runCheck(cmd: WorkerCheckCmd): Promise<void> {
  isRunning = true;
  stopRequested = false;

  emit({ type: "status", accountId: cmd.accountId, status: "running", jobId: cmd.jobId });

  const client = new InstagramClient({ sessionDir: cmd.sessionDir, headless: true });

  try {
    await Promise.race([
      client.init(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Browser launch timed out after 30 seconds. Check Accounts and re-login.")), 30_000)
      ),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "log", accountId: cmd.accountId, level: "error", message: `Session error: ${message}`, jobId: cmd.jobId });
    emit({ type: "status", accountId: cmd.accountId, status: "error", jobId: cmd.jobId });
    await client.close().catch(() => undefined);
    isRunning = false;
    return;
  }

  emit({ type: "log", accountId: cmd.accountId, level: "info", message: `Checking ${cmd.targets.length} conversation(s)…`, jobId: cmd.jobId });

  for (const [i, target] of cmd.targets.entries()) {
    if (stopRequested) break;

    emit({ type: "log", accountId: cmd.accountId, level: "info", message: `[${i + 1}/${cmd.targets.length}] Checking @${target.username}…`, jobId: cmd.jobId });

    const result = await client.checkConversation(target.username, (event) => emitStage(cmd, event));
    emit({
      type: "log",
      accountId: cmd.accountId,
      level: "info",
      message: `@${target.username}: seen=${result.seen ? "yes" : "no"}, replied=${result.replied ? "yes" : "no"}${result.replyPreview ? `, preview="${result.replyPreview}"` : ""}`,
      jobId: cmd.jobId,
    });
    await saveJobLog(cmd, {
      level: "info",
      message: `Analyze @${target.username}: seen=${result.seen ? "true" : "false"}, replied=${result.replied ? "true" : "false"}${result.replyPreview ? `, replyPreview="${result.replyPreview}"` : ""}`,
    });

    emit({
      type: "check_result",
      accountId: cmd.accountId,
      jobId: cmd.jobId,
      checkRecordId: target.messageRecordId,
      checkUsername: target.username,
      checkSeen: result.seen,
      checkReplied: result.replied,
      checkReplyPreview: result.replyPreview,
    });

    // Persist result to DB immediately
    try {
      emit({
        type: "stage",
        accountId: cmd.accountId,
        jobId: cmd.jobId,
        workflow: "analyze",
        stageId: "save_result",
        stageLabel: "Saving result",
        stageState: "active",
        stageDetail: `Saving @${target.username} to database`,
        stageUsername: target.username,
      });
      const payload = [{
        id: target.messageRecordId,
        seen: result.seen,
        seenAt: result.seen ? new Date().toISOString() : undefined,
        replied: result.replied,
        repliedAt: result.replied ? new Date().toISOString() : undefined,
        replyPreview: result.replyPreview,
      }];
      const response = await fetch(`${cmd.serverUrl}/automation/message-records`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAuthToken(cmd)}` },
        body: JSON.stringify(payload),
      });
      const responseText = await response.text();
      if (!response.ok) {
        emit({
          type: "stage",
          accountId: cmd.accountId,
          jobId: cmd.jobId,
          workflow: "analyze",
          stageId: "save_result",
          stageLabel: "Saving result",
          stageState: "error",
          stageDetail: `Save failed with ${response.status}`,
          stageUsername: target.username,
        });
        const message = `Failed to save check result for @${target.username} (recordId=${target.messageRecordId}): ${response.status} ${response.statusText}${responseText ? ` - ${responseText}` : ""}`;
        process.stderr.write(`[worker] ${message}\n`);
        emit({ type: "log", accountId: cmd.accountId, level: "error", message, jobId: cmd.jobId });
        await saveJobLog(cmd, { level: "error", message });
      } else {
        emit({
          type: "stage",
          accountId: cmd.accountId,
          jobId: cmd.jobId,
          workflow: "analyze",
          stageId: "save_result",
          stageLabel: "Saving result",
          stageState: "done",
          stageDetail: "Database updated",
          stageUsername: target.username,
        });
        process.stderr.write(`[worker] Saved check result for @${target.username} (recordId=${target.messageRecordId}): ${responseText || "(no body)"}\n`);
      }
    } catch (err) {
      emit({
        type: "stage",
        accountId: cmd.accountId,
        jobId: cmd.jobId,
        workflow: "analyze",
        stageId: "save_result",
        stageLabel: "Saving result",
        stageState: "error",
        stageDetail: "Save request crashed",
        stageUsername: target.username,
      });
      const message = `Failed to save check result for @${target.username} (recordId=${target.messageRecordId}): ${(err as Error).message}`;
      process.stderr.write(`[worker] ${message}\n`);
      emit({ type: "log", accountId: cmd.accountId, level: "error", message, jobId: cmd.jobId });
      await saveJobLog(cmd, { level: "error", message });
    }

    if (i < cmd.targets.length - 1 && !stopRequested) {
      await sleep(2_000);
    }
  }

  await client.close();

  emit({ type: "check_done", accountId: cmd.accountId, jobId: cmd.jobId });
  emit({ type: "status", accountId: cmd.accountId, status: "done", jobId: cmd.jobId });
  isRunning = false;
}
