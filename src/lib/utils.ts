import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const inr0 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const inr2 = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(value: number, opts?: { decimals?: boolean; signed?: boolean }) {
  const formatted = (opts?.decimals ? inr2 : inr0).format(Math.abs(value));
  if (opts?.signed) return value < 0 ? `-${formatted}` : `+${formatted}`;
  return value < 0 ? `-${formatted}` : formatted;
}

export function formatNumber(value: number, decimals = 2) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: decimals }).format(value);
}

export function formatPct(value: number, decimals = 1) {
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Local date as YYYY-MM-DD (journal/rule dates are calendar dates, not instants). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function formatHoldTime(openedAt: string, closedAt: string | null): string {
  if (!closedAt) return "open";
  const ms = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}
