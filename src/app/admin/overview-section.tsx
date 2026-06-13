"use client";

import { BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/empty-state";
import { DailyBars } from "@/components/charts/trend-charts";
import { fillDailySeries } from "@/lib/pulse-stats";
import { timeAgo } from "@/lib/utils";
import { useAdminOverview } from "./use-admin-overview";

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="micro-label">{label}</p>
      <p className="mt-1 font-money text-2xl font-bold">{value.toLocaleString("en-IN")}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </Card>
  );
}

/** Whole-platform analytics from first-party data (page_events + platform tables). */
export function OverviewSection() {
  const { data, isLoading, isError } = useAdminOverview();
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Could not load analytics"
        description="The overview query failed — refresh to retry."
      />
    );
  }

  const { stats } = data;
  const views14d = fillDailySeries(
    data.dailyViews.map((d) => ({ day: d.day, count: d.views })),
    14
  );
  const maxPage = Math.max(1, ...data.topPages.map((p) => p.views));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total users" value={stats.totalUsers} sub={`+${stats.newUsers7d} this week`} />
        <Stat label="Active users · 7d" value={stats.activeUsers7d} sub="signed-in, visited" />
        <Stat label="Page views · 7d" value={stats.views7d} />
        <Stat label="Hosted / BYOD" value={stats.hostedDbs} sub={`${stats.byodUsers} on their own DB`} />
        <Stat label="Community posts" value={stats.totalPosts} sub={`+${stats.posts7d} this week`} />
        <Stat label="Comments" value={stats.totalComments} />
        <Stat label="Likes" value={stats.totalLikes} />
        <Stat label="Blog pending" value={stats.blogPending} sub={`${stats.feedbackCount} feedback total`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daily page views · 14d</CardTitle>
          </CardHeader>
          <CardContent>
            <DailyBars data={views14d} name="Views" height={170} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top pages · 7d</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {data.topPages.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">No views recorded yet.</p>
            ) : (
              data.topPages.map((p) => (
                <div key={p.path} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-mono text-xs">{p.path}</span>
                    <span className="font-money text-xs text-muted">
                      {p.views.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent/70"
                      style={{ width: `${Math.max(3, (p.views / maxPage) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent signups</CardTitle>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recentUsers.map((u) => (
                <TableRow key={u.email}>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="max-w-56 truncate text-muted">{u.email}</TableCell>
                  <TableCell className="text-right text-xs text-muted">
                    <time dateTime={new Date(u.createdAt * 1000).toISOString()}>
                      {timeAgo(new Date(u.createdAt * 1000).toISOString())} ago
                    </time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
