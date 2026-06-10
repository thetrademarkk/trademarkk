import { ImageResponse } from "next/og";
import { siteConfig } from "@/config/site";

export const runtime = "edge";
export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#0A0A0B",
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
              background: "#8B5CF6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
            }}
          >
            📈
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>
            Trade<span style={{ color: "#8B5CF6" }}>Mark</span>
          </div>
        </div>
        <div style={{ marginTop: 48, fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>
          Mark your trade,
          <br />
          every day.
        </div>
        <div style={{ marginTop: 24, fontSize: 28, color: "#A1A1AA" }}>
          Free, open-source trading journal for Indian FnO traders
        </div>
        <div style={{ display: "flex", marginTop: 48, gap: 24, fontSize: 22, color: "#34D399" }}>
          <span>✓ Rules &amp; mistakes engine</span>
          <span>✓ Indian charges built-in</span>
          <span>✓ Your data, your database</span>
        </div>
      </div>
    ),
    size
  );
}
