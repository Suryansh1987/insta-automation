/**
 * Persistent logger — writes every event to both stdout AND a file on disk.
 * Path: %APPDATA%\InstaFlow\instaflow-debug.log  (survives app restarts)
 *
 * Call initLogger() once inside app.whenReady() before anything else.
 * Call log(tag, ...args) from anywhere in the main process.
 * The renderer can send "debug:log" over IPC and it will land here too.
 */

import fs from "fs";
import path from "path";
import { app, ipcMain } from "electron";

let stream: fs.WriteStream | null = null;
export let logFile = "";

export function initLogger(): void {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true }); // ensure directory exists on first run
  logFile = path.join(dir, "instaflow-debug.log");
  stream = fs.createWriteStream(logFile, { flags: "a" });

  const sep = "═".repeat(72);
  _write(sep);
  _write(`SESSION  ${new Date().toISOString()}`);
  _write(`isPackaged=${app.isPackaged}  ELECTRON_IS_DEV=${process.env.ELECTRON_IS_DEV ?? "(unset)"}`);
  _write(`execPath=${process.execPath}`);
  _write(sep);

  // Renderer → file bridge
  ipcMain.on("debug:log", (_evt, tag: string, ...rest: unknown[]) => {
    log(`renderer:${tag}`, ...rest);
  });

  // Surface the log path immediately so it's easy to find
  process.stdout.write(`\n[logger] ▶  ${logFile}\n\n`);
}

function _write(line: string): void {
  const out = line + "\n";
  process.stdout.write(out);
  stream?.write(out);
}

export function log(tag: string, ...args: unknown[]): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const body = args
    .map(a =>
      a == null        ? String(a) :
      a instanceof Error ? `[Error: ${a.message}\n${a.stack}]` :
      typeof a === "object" ? JSON.stringify(a) :
      String(a)
    )
    .join(" ");
  _write(`[${ts}] [${tag}] ${body}`);
}
