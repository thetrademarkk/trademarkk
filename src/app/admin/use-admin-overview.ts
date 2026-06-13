"use client";

import { useQuery } from "@tanstack/react-query";

export interface AdminOverview {
  stats: {
    totalUsers: number;
    newUsers7d: number;
    hostedDbs: number;
    byodUsers: number;
    totalPosts: number;
    posts7d: number;
    totalComments: number;
    totalLikes: number;
    blogPending: number;
    feedbackCount: number;
    activeUsers7d: number;
    views7d: number;
  };
  recentUsers: { email: string; name: string; createdAt: number }[];
  topPages: { path: string; views: number }[];
  dailyViews: { day: string; views: number }[];
  feedback: {
    id: string;
    category: string;
    message: string;
    email: string | null;
    path: string | null;
    createdAt: string;
  }[];
}

export interface ReportRow {
  id: string;
  targetType: "post" | "comment";
  targetId: string;
  reason: string | null;
  createdAt: string;
  reporter: string;
  targetPreview: string | null;
  postId: string | null;
}

/** A post auto-flagged by the content-quality gate (not yet user-reported). */
export interface FlaggedPostRow {
  id: string;
  flag: string | null;
  createdAt: string;
  author: string;
  preview: string;
}

export function useAdminOverview() {
  return useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const res = await fetch("/api/admin/overview");
      if (!res.ok) throw new Error("Failed to load analytics");
      return (await res.json()) as AdminOverview;
    },
  });
}

export function useAdminReports() {
  return useQuery({
    queryKey: ["admin-reports"],
    queryFn: async () => {
      const res = await fetch("/api/admin/reports");
      if (!res.ok) throw new Error("Failed to load reports");
      return (await res.json()) as { reports: ReportRow[]; flagged?: FlaggedPostRow[] };
    },
  });
}
