import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyBars, DailyViewsArea } from "@/components/charts/trend-charts";
import type { PulseData } from "@/lib/pulse-stats";

/** Friendly labels for the most common normalized paths. */
const PAGE_LABELS: Record<string, string> = {
  "/": "Home",
  "/community": "Community",
  "/app/dashboard": "Dashboard",
  "/app/trades": "Trades",
  "/app/journal": "Journal",
  "/blog": "Blog",
  "/pulse": "Pulse",
};

export function PulseCharts({ data }: { data: PulseData }) {
  const total30dSignups = data.signupsDaily.reduce((s, d) => s + d.count, 0);
  const total30dPosts = data.postsDaily.reduce((s, d) => s + d.count, 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card data-testid="pulse-chart-signups">
        <CardHeader>
          <CardTitle>New traders · 30 days</CardTitle>
          <p className="text-xs text-muted">{total30dSignups.toLocaleString("en-IN")} signups</p>
        </CardHeader>
        <CardContent>
          <DailyBars data={data.signupsDaily} name="Signups" />
        </CardContent>
      </Card>

      <Card data-testid="pulse-chart-views">
        <CardHeader>
          <CardTitle>Page views · 30 days</CardTitle>
          <p className="text-xs text-muted">
            <span className="text-accent">views</span> ·{" "}
            <span className="text-profit">signed-in visitors</span>
          </p>
        </CardHeader>
        <CardContent>
          <DailyViewsArea data={data.viewsDaily} />
        </CardContent>
      </Card>

      <Card data-testid="pulse-chart-posts">
        <CardHeader>
          <CardTitle>Community posts · 30 days</CardTitle>
          <p className="text-xs text-muted">{total30dPosts.toLocaleString("en-IN")} posts</p>
        </CardHeader>
        <CardContent>
          <DailyBars data={data.postsDaily} name="Posts" color="var(--profit)" />
        </CardContent>
      </Card>

      <TopPages pages={data.topPages} />
    </div>
  );
}

function TopPages({ pages }: { pages: { path: string; views: number }[] }) {
  const max = Math.max(1, ...pages.map((p) => p.views));
  return (
    <Card data-testid="pulse-top-pages">
      <CardHeader>
        <CardTitle>Most visited · 7 days</CardTitle>
        <p className="text-xs text-muted">Normalized paths — individual pages, never people</p>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {pages.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted">
            No page views recorded yet.
          </p>
        ) : (
          pages.map((p) => (
            <div key={p.path} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {PAGE_LABELS[p.path] ?? <code className="font-mono text-xs">{p.path}</code>}
                </span>
                <span className="font-money text-xs text-muted">
                  {p.views.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent/70"
                  style={{ width: `${Math.max(3, (p.views / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
