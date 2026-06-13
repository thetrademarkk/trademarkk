import type { Metadata } from "next";
import { Activity, Eye, Flame, Heart, MessageSquare, UserPlus, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getPulseData } from "@/server/pulse";
import type { PulseData } from "@/lib/pulse-stats";
import { VitalCards } from "./_components/vital-cards";
import { PulseCharts } from "./_components/pulse-sections";

export const metadata: Metadata = {
  title: "Pulse — live platform stats",
  description:
    "Live, honest numbers from the TradeMark platform: traders, activity, community growth and real-visit web vitals. Aggregates only — never personal data.",
  alternates: { canonical: "/pulse" },
};

/** ISR: re-aggregated at most every 10 minutes; the CDN serves it in between. */
export const revalidate = 600;

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border bg-surface p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" aria-hidden />
        <p className="micro-label">{label}</p>
      </div>
      <p className="mt-2 font-money text-2xl font-bold md:text-3xl" data-pulse-stat={label}>
        {value.toLocaleString("en-IN")}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

function Unavailable() {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-xl border border-dashed px-6 py-16 text-center">
      <h2 className="text-base font-semibold">Stats are warming up</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        The aggregates could not be computed right now. Nothing is broken on your side — try again
        in a few minutes.
      </p>
    </div>
  );
}

export default async function PulsePage() {
  let data: PulseData | null = null;
  try {
    data = await getPulseData();
  } catch {
    data = null;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-20 pt-12">
      {/* ── Heading ── */}
      <div className="max-w-2xl">
        <p className="flex w-fit items-center gap-2 rounded-full border bg-surface/60 px-3.5 py-1.5 text-xs text-muted">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-profit/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-profit" />
          </span>
          Live · refreshed every 10 minutes
        </p>
        <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-5xl">
          Platform <span className="text-gradient">Pulse</span>
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted md:text-base">
          The same numbers we look at, published. Real aggregates from the platform database — no
          marketing math, no vanity rounding. Journals live in each trader&apos;s own database and
          are not centrally readable, so there are no trade metrics here and never will be without
          explicit opt-in.
        </p>
      </div>

      {!data ? (
        <div className="mt-12">
          <Unavailable />
        </div>
      ) : (
        <>
          {/* ── KPI grid ── */}
          <section aria-label="Platform totals" className="mt-10">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi
                icon={Users}
                label="Registered traders"
                value={data.totals.traders}
                sub={`+${data.totals.traders7d.toLocaleString("en-IN")} this week`}
              />
              <Kpi
                icon={Activity}
                label="Active · 30 days"
                value={data.totals.active30d}
                sub={`${data.totals.active7d.toLocaleString("en-IN")} in the last 7 days`}
              />
              <Kpi
                icon={Eye}
                label="Page views · 30 days"
                value={data.totals.views30d}
                sub="first-party, cookieless"
              />
              <Kpi
                icon={Flame}
                label="Longest shared streak"
                value={data.totals.longestStreak}
                sub="days · opt-in only"
              />
              <Kpi
                icon={UserPlus}
                label="Community posts"
                value={data.totals.posts}
                sub={`+${data.totals.posts7d.toLocaleString("en-IN")} this week`}
              />
              <Kpi icon={MessageSquare} label="Comments" value={data.totals.comments} />
              <Kpi icon={Heart} label="Likes" value={data.totals.likes} />
              <Kpi
                icon={Activity}
                label="Active · 7 days"
                value={data.totals.active7d}
                sub="signed-in visitors"
              />
            </div>
          </section>

          {/* ── Trends ── */}
          <section aria-label="Trends" className="mt-10">
            <h2 className="text-lg font-bold md:text-xl">Last 30 days</h2>
            <p className="mt-1 text-sm text-muted">
              Daily series are zero-filled — quiet days show as quiet days.
            </p>
            <div className="mt-5">
              <PulseCharts data={data} />
            </div>
          </section>

          {/* ── Web vitals ── */}
          <section aria-label="Web vitals" className="mt-12">
            <h2 className="text-lg font-bold md:text-xl">Speed, measured on real visits</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Core Web Vitals collected on actual page loads with the open-source{" "}
              <code className="font-mono text-xs">web-vitals</code> library — the same field data
              Google uses to judge sites. P75 means three in four visits were at least this fast.
              Collected anonymously: metric, value and page only.
            </p>
            <div className="mt-5">
              <VitalCards vitals={data.vitals} />
            </div>
          </section>

          {/* ── Methodology ── */}
          <section aria-label="Methodology" className="mt-12 rounded-xl border bg-surface/40 p-5">
            <h2 className="text-sm font-semibold">How these numbers are made</h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted">
              <li>
                · Counted directly from the platform database — accounts, community content and
                first-party page events. No third-party trackers, no sampling.
              </li>
              <li>
                · Page views and vitals are anonymous: we store the path and timestamp, never IPs
                or fingerprints. Profile and post URLs are normalized before storage.
              </li>
              <li>
                · Your journal (trades, notes, rules) lives in your own database. We cannot read
                it, so it can never appear here.
              </li>
              <li>
                · Aggregated{" "}
                <time dateTime={data.generatedAt}>
                  {new Date(data.generatedAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Kolkata",
                  })}
                </time>{" "}
                IST · refreshed every 10 minutes.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
