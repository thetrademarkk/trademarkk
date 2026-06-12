"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  AuthorView,
  CommentView,
  ConversationView,
  DmMessageView,
  FeedResponse,
  LeaderboardRow,
  NotificationView,
  PostView,
  ProfileView,
} from "./types";
import type { CreatePostInput, UpdateProfileInput } from "./schemas";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

export type FeedSort = "latest" | "top";
export type FeedScope = "all" | "following" | "saved";

export function useFeed(
  sort: FeedSort,
  tag: string | null,
  search: string | null = null,
  scope: FeedScope = "all",
  initialFeed: FeedResponse | null = null
) {
  return useInfiniteQuery({
    queryKey: ["community-feed", sort, tag, search, scope],
    queryFn: ({ pageParam }) =>
      request<FeedResponse>(
        `/api/community/posts?sort=${sort}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}${
          search ? `&q=${encodeURIComponent(search)}` : ""
        }${scope !== "all" ? `&scope=${scope}` : ""}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""
        }`
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 15_000,
    // ISR-rendered anonymous first page (community home only). Marked stale
    // from the epoch so a fresh, viewer-personalized fetch fires immediately —
    // the seed only bridges the paint gap, it never sticks for signed-in users.
    ...(initialFeed
      ? {
          initialData: { pages: [initialFeed], pageParams: [""] },
          initialDataUpdatedAt: 0,
        }
      : {}),
  });
}

export function useTrendingTags() {
  return useQuery({
    queryKey: ["community-trending-tags"],
    queryFn: () => request<{ tags: { tag: string; count: number }[] }>("/api/community/tags"),
    staleTime: 5 * 60_000,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: ["community-post", id],
    queryFn: () =>
      request<{ post: PostView; comments: CommentView[] }>(`/api/community/posts/${id}`),
  });
}

/** Posts render in feeds AND on profile pages — writes must refresh both instantly. */
function invalidatePostLists(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["community-feed"] });
  void qc.invalidateQueries({ queryKey: ["community-user"] }); // all profile pages
}

export function useCreatePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePostInput) =>
      request<{ id: string }>("/api/community/posts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidatePostLists(qc),
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/api/community/posts/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidatePostLists(qc),
  });
}

/** Optimistic like toggle — patches every cached copy of the post immediately. */
export function useToggleLike() {
  const qc = useQueryClient();

  const patchPost = (post: PostView): PostView => ({
    ...post,
    likedByMe: !post.likedByMe,
    likeCount: post.likeCount + (post.likedByMe ? -1 : 1),
  });

  const patchEverywhere = (id: string) => {
    qc.setQueriesData<InfiniteData<FeedResponse>>({ queryKey: ["community-feed"] }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              posts: p.posts.map((post) => (post.id === id ? patchPost(post) : post)),
            })),
          }
        : data
    );
    qc.setQueryData<{ post: PostView; comments: CommentView[] }>(["community-post", id], (data) =>
      data ? { ...data, post: patchPost(data.post) } : data
    );
  };

  return useMutation({
    mutationFn: (id: string) =>
      request<{ liked: boolean; likeCount: number }>(`/api/community/posts/${id}/like`, {
        method: "POST",
      }),
    onMutate: (id) => patchEverywhere(id),
    onError: (_e, id) => patchEverywhere(id), // revert
    // Profile pages cache posts separately — refresh them with the server truth.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community-user"] }),
  });
}

/** Optimistic bookmark toggle — mirrors the like pattern. */
export function useToggleBookmark() {
  const qc = useQueryClient();
  const patchPost = (post: PostView): PostView => ({
    ...post,
    bookmarkedByMe: !post.bookmarkedByMe,
  });
  const patchEverywhere = (id: string) => {
    qc.setQueriesData<InfiniteData<FeedResponse>>({ queryKey: ["community-feed"] }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              posts: p.posts.map((post) => (post.id === id ? patchPost(post) : post)),
            })),
          }
        : data
    );
    qc.setQueryData<{ post: PostView; comments: CommentView[] }>(["community-post", id], (data) =>
      data ? { ...data, post: patchPost(data.post) } : data
    );
  };
  return useMutation({
    mutationFn: (id: string) =>
      request<{ bookmarked: boolean }>(`/api/community/posts/${id}/bookmark`, { method: "POST" }),
    onMutate: (id) => patchEverywhere(id),
    onError: (_e, id) => patchEverywhere(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community-user"] }),
  });
}

export function useToggleCommentLike(postId: string) {
  const qc = useQueryClient();
  const patch = (commentId: string) => {
    qc.setQueryData<{ post: PostView; comments: CommentView[] }>(
      ["community-post", postId],
      (data) =>
        data
          ? {
              ...data,
              comments: data.comments.map((c) =>
                c.id === commentId
                  ? {
                      ...c,
                      likedByMe: !c.likedByMe,
                      likeCount: c.likeCount + (c.likedByMe ? -1 : 1),
                    }
                  : c
              ),
            }
          : data
    );
  };
  return useMutation({
    mutationFn: (commentId: string) =>
      request<{ liked: boolean }>(`/api/community/comments/${commentId}/like`, { method: "POST" }),
    onMutate: patch,
    onError: (_e, commentId) => patch(commentId),
  });
}

export function useToggleFollow(username: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ following: boolean }>(
        `/api/community/users/${encodeURIComponent(username)}/follow`,
        {
          method: "POST",
        }
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["community-user", username] });
      void qc.invalidateQueries({ queryKey: ["community-feed"] });
    },
  });
}

/** Blocking removes the user's content from all of the viewer's feeds. */
export function useToggleBlock(username: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<{ blocked: boolean }>(`/api/community/users/${encodeURIComponent(username)}/block`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["community-user", username] });
      void qc.invalidateQueries({ queryKey: ["community-feed"] });
      void qc.invalidateQueries({ queryKey: ["community-post"] });
    },
  });
}

export function useLeaderboard(board: "contrib" | "streak", period: "month" | "all") {
  return useQuery({
    queryKey: ["community-leaderboard", board, period],
    queryFn: () =>
      request<{ rows: LeaderboardRow[] }>(
        `/api/community/leaderboard?board=${board}&period=${period}`
      ),
    staleTime: 60_000,
  });
}

/** Publishes (or hides) the viewer's journal streak — explicit opt-in only. */
export function useShareStreak() {
  const qc = useQueryClient();
  type Me = { shareStreak: boolean } & Record<string, unknown>;
  return useMutation({
    mutationFn: (input: { share: boolean; current: number; best: number }) =>
      request<{ shared: boolean }>("/api/community/streak", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    // Optimistic: the switch flips instantly; server failure rolls it back.
    onMutate: (input) => {
      const prev = qc.getQueryData<Me>(["community-me"]);
      qc.setQueryData<Me>(["community-me"], (me) =>
        me ? { ...me, shareStreak: input.share } : me
      );
      return { prev };
    },
    onError: (_e, _input, ctx) => {
      if (ctx?.prev) qc.setQueryData(["community-me"], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["community-me"] });
      void qc.invalidateQueries({ queryKey: ["community-user"] });
      void qc.invalidateQueries({ queryKey: ["community-leaderboard"] });
    },
  });
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ["community-notifications"],
    queryFn: () =>
      request<{ notifications: NotificationView[]; unread: number }>(
        "/api/community/notifications"
      ),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request("/api/community/notifications", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community-notifications"] }),
  });
}

/* ── Direct messages ─────────────────────────────────────────────────────── */

export interface ConversationsResponse {
  conversations: ConversationView[];
  unread: number;
}

interface ThreadResponse {
  messages: DmMessageView[];
  nextCursor: string | null;
  peer: AuthorView;
}

/** Inbox list + total unread. Pollers pick their own cadence (header 30s, inbox 5s). */
export function useConversations(enabled: boolean, refetchInterval = 30_000) {
  return useQuery({
    queryKey: ["community-dms"],
    queryFn: () => request<ConversationsResponse>("/api/community/dm/conversations"),
    enabled,
    refetchInterval,
    retry: false,
  });
}

/** Starts (or reopens) a 1:1 conversation with a trader. */
export function useStartConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) =>
      request<{ id: string; created: boolean }>("/api/community/dm/conversations", {
        method: "POST",
        body: JSON.stringify({ username }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community-dms"] }),
  });
}

/** Thread messages — 5s polling keeps both sides in sync (SSE later). */
export function useThread(conversationId: string | null) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["community-dm", conversationId],
    queryFn: async () => {
      const data = await request<ThreadResponse>(
        `/api/community/dm/conversations/${conversationId}/messages`
      );
      // Opening the thread marks incoming messages read — sync inbox badges.
      void qc.invalidateQueries({ queryKey: ["community-dms"] });
      return data;
    },
    enabled: Boolean(conversationId),
    refetchInterval: 5_000,
    retry: false,
  });
}

/** Optimistic send — the bubble appears instantly; server failure removes it. */
export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const key = ["community-dm", conversationId];
  return useMutation({
    mutationFn: (body: string) =>
      request<{ message: DmMessageView }>(
        `/api/community/dm/conversations/${conversationId}/messages`,
        { method: "POST", body: JSON.stringify({ body }) }
      ),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ThreadResponse>(key);
      const optimistic: DmMessageView = {
        id: `optimistic-${Date.now()}`,
        body,
        mine: true,
        createdAt: new Date().toISOString(),
      };
      qc.setQueryData<ThreadResponse>(key, (data) =>
        data ? { ...data, messages: [...data.messages, optimistic] } : data
      );
      return { prev, optimisticId: optimistic.id };
    },
    onSuccess: (res, _body, ctx) => {
      qc.setQueryData<ThreadResponse>(key, (data) =>
        data
          ? {
              ...data,
              messages: data.messages.map((m) => (m.id === ctx.optimisticId ? res.message : m)),
            }
          : data
      );
      void qc.invalidateQueries({ queryKey: ["community-dms"] });
    },
    onError: (_e, _body, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
  });
}

export function useAddComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, parentId }: { body: string; parentId?: string | null }) =>
      request<CommentView>(`/api/community/posts/${postId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body, parentId }),
      }),
    onSuccess: (comment) => {
      qc.setQueryData<{ post: PostView; comments: CommentView[] }>(
        ["community-post", postId],
        (data) =>
          data
            ? {
                post: { ...data.post, commentCount: data.post.commentCount + 1 },
                comments: [...data.comments, comment],
              }
            : data
      );
    },
  });
}

export function useDeleteComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      request(`/api/community/comments/${commentId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community-post", postId] }),
  });
}

export function useMyProfile(enabled: boolean) {
  return useQuery({
    queryKey: ["community-me"],
    queryFn: () =>
      request<{
        username: string;
        displayName: string;
        bio: string | null;
        website: string | null;
        avatar: string | null;
        shareStreak: boolean;
      }>("/api/community/profile"),
    enabled,
    retry: false,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) =>
      request("/api/community/profile", { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useUserProfile(username: string) {
  return useQuery({
    queryKey: ["community-user", username],
    queryFn: () =>
      request<{
        profile: ProfileView & { mine: boolean };
        posts: PostView[];
        nextCursor: string | null;
      }>(`/api/community/users/${encodeURIComponent(username)}`),
  });
}

export function useReport() {
  return useMutation({
    mutationFn: (input: {
      targetType: "post" | "comment";
      targetId: string;
      reason: "spam" | "harassment" | "advice" | "other";
      note?: string;
    }) => request("/api/community/report", { method: "POST", body: JSON.stringify(input) }),
  });
}
