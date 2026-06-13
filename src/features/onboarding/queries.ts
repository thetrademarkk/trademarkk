"use client";

import { useQuery } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { sanitizeTraderProfile, TRADER_PROFILE_KEY, type TraderProfile } from "./trader-profile";

/**
 * The trader profile lives in the journal DB's key/value `settings` table (key
 * `trader_profile.v1`), so it persists identically in hosted, BYOD and local
 * modes and travels with mode-switch copies + backups. Additive only — no
 * migration needed (the `settings` table already exists). Reads degrade to the
 * `mixed` default when absent or invalid, so the app behaves exactly as it did
 * pre-SEG-08 for anyone who never picked a type.
 */
export function useTraderProfile() {
  const { db } = useDb();
  return useQuery({
    queryKey: ["trader-profile"],
    queryFn: async (): Promise<TraderProfile> => {
      const res = await db.execute(`SELECT value FROM settings WHERE key = ?`, [
        TRADER_PROFILE_KEY,
      ]);
      const raw = res.rows[0]?.value;
      let parsed: unknown = null;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }
      return sanitizeTraderProfile(parsed);
    },
  });
}
