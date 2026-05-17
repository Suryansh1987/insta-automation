import { useEffect, useRef, useState } from "react";
import type { WorkerMessage } from "@insta-saas/shared";

interface LogEntry { id: number; level: string; message: string; time: string }

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const counter = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.worker?.onMessage((msg: WorkerMessage) => {
      let message = msg.message ?? "";
      if (!message) {
        if (msg.type === "status") message = `Status → ${msg.status}`;
        else if (msg.type === "progress") message = `Progress — sent: ${msg.sent ?? 0}, failed: ${msg.failed ?? 0}`;
        else if (msg.type === "message_sent") message = `@${msg.username}: ${msg.messageStatus}`;
      }
      const level = msg.level ?? (msg.type === "error" ? "error" : "info");
      setLogs((prev) => [...prev.slice(-499), { id: counter.current++, level, message, time: new Date().toLocaleTimeString() }]);
    });
    return () => window.worker?.offMessage();
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  function levelColor(l: string) {
    if (l === "error") return "#f87171";
    if (l === "warn")  return "var(--warning)";
    return "var(--info)";
  }

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>Live Logs</h1>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--fg-3)" }}>{logs.length} entries</p>
        </div>
        <button onClick={() => setLogs([])} style={{
          padding: "7px 16px", background: "var(--bg-card)", border: "1px solid var(--line-hi)",
          borderRadius: "var(--radius-sm)", color: "var(--fg-2)", fontSize: 12,
          cursor: "pointer", fontFamily: "var(--font-body)",
        }}>
          Clear
        </button>
      </div>

      <div style={{
        flex: 1, background: "var(--bg-rail)", borderRadius: "var(--radius-md)",
        border: "1px solid var(--line)", padding: "14px 18px",
        overflowY: "auto", fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7,
      }}>
        {logs.length === 0 ? (
          <span style={{ color: "var(--fg-4)" }}>No logs yet — start an automation job to see live output.</span>
        ) : logs.map((log) => (
          <div key={log.id} style={{ marginBottom: 1 }}>
            <span style={{ color: "var(--fg-4)" }}>[{log.time}]</span>{" "}
            <span style={{ color: levelColor(log.level), fontWeight: 500 }}>[{log.level.toUpperCase()}]</span>{" "}
            <span style={{ color: "var(--fg-2)" }}>{log.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
