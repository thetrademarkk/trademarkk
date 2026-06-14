"use client";

import * as React from "react";

/**
 * Whether "Continue with Google" should render. Sourced from the server's
 * /api/auth/config (which returns `google: hasGoogle()`), so the button only
 * ever appears when the Google provider is actually registered — it can never
 * show with empty creds and dead-click. Starts `false` so nothing flashes
 * before the check resolves; an env-absent deployment simply stays false.
 */
export function useGoogleEnabled(): boolean {
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/config", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : { google: false }))
      .then((d) => {
        if (!cancelled) setEnabled(Boolean(d?.google));
      })
      .catch(() => {
        /* network blip → leave Google hidden; email/password still works */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
