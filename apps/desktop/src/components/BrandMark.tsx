import brandLogo from "../../ChatGPT_Image_Apr_30__2026__07_01_59_PM-removebg-preview.png";

type BrandMarkProps = {
  size?: number;
  showText?: boolean;
  subtitle?: string;
  compact?: boolean;
};

export default function BrandMark({
  size = 132,
  showText = true,
  subtitle,
  compact = false,
}: BrandMarkProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: compact ? 10 : 14 }}>
      <img
        src={brandLogo}
        alt="TNM"
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          flexShrink: 0,
          filter: "drop-shadow(0 8px 18px rgba(255, 122, 26, 0.22))",
        }}
      />
      {showText && (
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: compact ? 16 : 22,
              color: "var(--fg)",
              lineHeight: 1.05,
              letterSpacing: compact ? "0.01em" : "0",
            }}
          >
            TNM
          </div>
          {subtitle && (
            <div style={{ fontSize: compact ? 12 : 13, color: "var(--fg-3)", marginTop: 5, lineHeight: 1.2 }}>
              {subtitle}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
