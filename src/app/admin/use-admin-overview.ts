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

/* ── Moderation queue (rank-14): unified reports + auto-flagged posts ── */

export interface ModQueueItemView {
  key: string;
  source: "report" | "flag";
  status: "open" | "actioned";
  targetType: "post" | "comment";
  targetId: string;
  postId: string | null;
  label: string;
  note: string | null;
  preview: string | null;
  author: string | null;
  authorId: string | null;
  authorBanned: boolean;
  reporter: string | null;
  createdAt: string;
}

export interface ModQueueResponse {
  items: ModQueueItemView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  openCounts: { reports: number; flags: number };
}

export type ModSourceFilter = "all" | "report" | "flag";
export type ModStatusFilter = "open" | "actioned" | "all";
export type ModSort = "newest" | "oldest";

export interface ModQueueParams {
  source: ModSourceFilter;
  status: ModStatusFilter;
  sort: ModSort;
  page: number;
}

export function useModQueue(params: ModQueueParams) {
  return useQuery({
    queryKey: ["admin-moderation", params],
    queryFn: async () => {
      const qs = new URLSearchParams({
        source: params.source,
        status: params.status,
        sort: params.sort,
        page: String(params.page),
      });
      const res = await fetch(`/api/admin/moderation?${qs}`);
      if (!res.ok) throw new Error("Failed to load the moderation queue");
      return (await res.json()) as ModQueueResponse;
    },
    placeholderData: (prev) => prev,
  });
}
