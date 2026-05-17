import type React from "react";
import BoxLoader from "./box-loader";

export default function LoadingState({
  title,
  subtitle,
  compact = false,
  overlay = false,
}: {
  title: string;
  subtitle?: string;
  compact?: boolean;
  overlay?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={overlay ? "loading-state loading-state--overlay" : "loading-state"}
      style={overlay ? undefined : {
        minHeight: compact ? 160 : 260,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: compact ? "18px 12px" : "28px 20px",
        background: compact ? "transparent" : "var(--bg-card)",
        borderRadius: compact ? 0 : "var(--radius-md)",
        border: compact ? "none" : "1px solid var(--line)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, maxWidth: 320 }}>
        <BoxLoader />
        <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--fg)" }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--fg-3)" }}>{subtitle}</div>}
      </div>
    </div>
  );
}
