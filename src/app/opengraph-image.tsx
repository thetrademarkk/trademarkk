import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";

export const runtime = "edge";
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** A small check glyph drawn as SVG (no emoji fonts in the OG renderer). */
function Check() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M20 6 9 17l-5-5"
        stroke="#34D399"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function OgImage() {
  const bullets = [
    "Every Indian trader type — intraday, F&O, MCX, currency",
    "Paise-accurate charges & a full Indian tax pack",
    "Your data, your database — hosted, BYOD or local",
  ];
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "linear-gradient(135deg, #0A0A0B 0%, #15101F 100%)",
        color: "#FAFAFA",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#7C3AED",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            fontWeight: 700,
            letterSpacing: -1,
          }}
        >
          TM
        </div>
        <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>
          Trade
          <span style={{ color: "#A78BFA" }}>Markk</span>
        </div>
      </div>
      <div
        style={{ display: "flex", marginTop: 44, fontSize: 62, fontWeight: 700, lineHeight: 1.1 }}
      >
        Mark your trade, every day.
      </div>
      <div
        style={{ display: "flex", marginTop: 22, fontSize: 28, color: "#A1A1AA", maxWidth: 920 }}
      >
        The free, open-source trading journal built for India.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 44 }}>
        {bullets.map((b) => (
          <div key={b} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 24 }}>
            <Check />
            <span>{b}</span>
          </div>
        ))}
      </div>
    </div>,
    size
  );
}
