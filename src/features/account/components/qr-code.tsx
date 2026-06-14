"use client";

import * as React from "react";
import { encodeQr } from "../qr";

/**
 * Renders a string as a scannable QR code (crisp SVG, dependency-free — the
 * matrix comes from our own encoder). Used for the TOTP `otpauth://` URI so the
 * user can scan it with an authenticator app. `aria-label` describes it; the raw
 * secret is shown separately for manual entry, so a screen-reader user is never
 * stuck with an unreadable image.
 */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const { modules, error } = React.useMemo(() => {
    try {
      return { modules: encodeQr(value), error: null as string | null };
    } catch (e) {
      return { modules: null, error: e instanceof Error ? e.message : "Could not render QR" };
    }
  }, [value]);

  if (error || !modules) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border bg-surface p-4 text-center text-xs text-muted"
        style={{ width: size, height: size }}
      >
        QR unavailable — use the manual key below.
      </div>
    );
  }

  const n = modules.length;
  const quiet = 2; // quiet-zone modules around the code
  const dim = n + quiet * 2;
  // Build one path string of all dark module rects — far fewer DOM nodes than a
  // rect per module (a v6 code is ~1,700 modules).
  let d = "";
  for (let r = 0; r < n; r++) {
    const row = modules[r]!;
    for (let c = 0; c < n; c++) {
      if (row[c]) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Two-factor setup QR code — scan it with your authenticator app"
      className="rounded-lg border bg-white"
    >
      <rect width={dim} height={dim} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
