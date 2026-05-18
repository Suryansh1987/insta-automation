import { useEffect, useState } from "react";
import { useToastStore, type ToastItem, type ToastType } from "../../store/toast";

const DURATION = 5000;

const META: Record<ToastType, { icon: string; color: string; bg: string; border: string; bar: string }> = {
  error:   { icon: "✕", color: "#e05c5c", bg: "rgba(220,53,69,0.10)",  border: "rgba(220,53,69,0.28)",  bar: "#e05c5c" },
  success: { icon: "✓", color: "var(--positive)", bg: "rgba(154,194,138,0.10)", border: "rgba(154,194,138,0.28)", bar: "var(--positive)" },
  warning: { icon: "⚠", color: "var(--warning)", bg: "rgba(224,176,114,0.10)", border: "rgba(224,176,114,0.28)", bar: "var(--warning)" },
  info:    { icon: "i", color: "var(--info)",    bg: "rgba(127,163,194,0.10)", border: "rgba(127,163,194,0.28)", bar: "var(--info)" },
};

function ToastCard({ toast, onRemove }: { toast: ToastItem; onRemove(): void }) {
  const [progress, setProgress] = useState(100);
  const [visible, setVisible] = useState(false);
  const m = META[toast.type];

  useEffect(() => {
    // Slide-in
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      setProgress(Math.max(0, 100 - (elapsed / DURATION) * 100));
    }, 40);
    return () => clearInterval(tick);
  }, []);

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "12px 14px",
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 10,
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        minWidth: 280,
        maxWidth: 380,
        overflow: "hidden",
        transform: visible ? "translateX(0)" : "translateX(110%)",
        opacity: visible ? 1 : 0,
        transition: "transform 0.28s cubic-bezier(.22,1,.36,1), opacity 0.28s ease",
      }}
    >
      {/* Icon */}
      <span style={{
        flexShrink: 0, width: 20, height: 20, borderRadius: "50%",
        background: `color-mix(in srgb, ${m.color} 18%, transparent)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 800, color: m.color, marginTop: 1,
      }}>
        {m.icon}
      </span>

      {/* Message */}
      <span style={{ flex: 1, fontSize: 13, color: "var(--fg)", lineHeight: 1.45, wordBreak: "break-word" }}>
        {toast.message}
      </span>

      {/* Close */}
      <button
        onClick={onRemove}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "var(--fg-4)", fontSize: 16, lineHeight: 1,
          padding: "0 0 0 4px", flexShrink: 0, marginTop: -1,
        }}
      >
        ×
      </button>

      {/* Progress bar */}
      <div style={{
        position: "absolute", bottom: 0, left: 0,
        height: 2, background: m.bar, opacity: 0.6,
        width: `${progress}%`, transition: "width 40ms linear",
        borderRadius: "0 0 0 10px",
      }} />
    </div>
  );
}

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove  = useToastStore((s) => s.remove);

  return (
    <div style={{
      position: "fixed",
      bottom: 24,
      right: 24,
      zIndex: 9999,
      display: "flex",
      flexDirection: "column",
      gap: 10,
      alignItems: "flex-end",
      pointerEvents: "none",
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: "auto" }}>
          <ToastCard toast={t} onRemove={() => remove(t.id)} />
        </div>
      ))}
    </div>
  );
}
