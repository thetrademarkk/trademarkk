"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

/** Last-resort boundary — replaces the whole document if the root layout throws. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);
  return (
    <html lang="en">
      <body
        style={{ fontFamily: "system-ui, sans-serif", background: "#0A0A0B", color: "#FAFAFA" }}
      >
        <div
          style={{
            minHeight: "100dvh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          <TriangleAlert size={40} color="#FBBF24" aria-hidden />
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>The app hit an unexpected error</h1>
          <p style={{ fontSize: 14, color: "#A1A1AA", maxWidth: 360 }}>
            We&apos;ve logged it. Reloading usually fixes it.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 8,
              background: "#8B5CF6",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              padding: "10px 20px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
