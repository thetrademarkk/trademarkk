"use client";

import {
  keepPreviousData,
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
  PostDetailResponse,
  PostView,
  ProfileCommentView,
  ProfileView,
  SearchResponse,
} from "./types";
import { SEARCH_MIN_CHARS } from "./search";
import { applyReaction, totalReactions, type ReactionKind } from "./reactions";
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

/**
 * Unified header-search typeahead — traders + topics + posts in one call.
 * `keepPreviousData` holds the last results on screen between keystrokes so
 * the panel never flashes empty mid-typing.
 */
export function useCommunitySearch(q: string) {
  return useQuery({
    queryKey: ["community-search", q],
    queryFn: () => request<SearchResponse>(`/api/community/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= SEARCH_MIN_CHARS,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/* ── Composer autocomplete (@mention / #hashtag typeahead) ─────────────────── */

export interface AutocompleteUser {
  username: string;
  displayName: string;
  avatar: string | null;
}
export interface AutocompleteTag {
  tag: string;
  count: number;
}

/**
 * @mention suggestions for the composer typeahead. Block-aware on the server;
 * the result holds between keystrokes so the dropdown never flashes empty.
 * Enabled only while an @token is active (`enabled`), debounced by the caller.
 */
export function useUserAutocomplete(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["community-ac-user", q],
    queryFn: () =>
      request<{ users: AutocompleteUser[] }>(
        `/api/community/autocomplete?kind=user&q=${encodeURIComponent(q)}`
      ),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** #hashtag suggestions (existing tags by prefix + curated topics with counts). */
export function useTagAutocomplete(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ["community-ac-tag", q],
    queryFn: () =>
      request<{ tags: AutocompleteTag[] }>(
        `/api/community/autocomplete?kind=tag&q=${encodeURIComponent(q)}`
      ),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
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
    queryFn: () => request<PostDetailResponse>(`/api/community/posts/${id}`),
  });
}

/** Posts render in feeds AND on profile pages — writes must refresh both instantly. */
function invalidatePostLists(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["community-feed"] });
  void qc.invalidateQueries({ queryKey: ["community-user"] }); // all profile pages
  void qc.invalidateQueries({ queryKey: ["community-user-likes"] }); // Likes tabs
  void qc.invalidateQueries({ queryKey: ["community-user-comments"] }); // Comments tabs
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

/**
 * Optimistic reaction toggle/switch — patches every cached copy of the post
 * immediately, then rolls back on error. Passing no kind reacts with `like`
 * (back-compat). Clicking your current reaction removes it; a different kind
 * switches in place. Reuses the pure `applyReaction` so the optimistic math
 * matches the server exactly.
 */
export function useToggleLike() {
  const qc = useQueryClient();

  const patchPost = (post: PostView, clicked: ReactionKind): PostView => {
    const { counts, next } = applyReaction(post.reactionCounts, post.myReaction, clicked);
    return {
      ...post,
      myReaction: next,
      likedByMe: next !== null,
      reactionCounts: counts,
      likeCount: totalReactions(counts),
    };
  };

  const patchEverywhere = (id: string, clicked: ReactionKind) => {
    qc.setQueriesData<InfiniteData<FeedResponse>>({ queryKey: ["community-feed"] }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              posts: p.posts.map((post) => (post.id === id ? patchPost(post, clicked) : post)),
            })),
          }
        : data
    );
    qc.setQueryData<PostDetailResponse>(["community-post", id], (data) =>
      data ? { ...data, post: patchPost(data.post, clicked) } : data
    );
  };

  return useMutation({
    mutationFn: ({ id, reaction = "like" }: { id: string; reaction?: ReactionKind }) =>
      request<{ liked: boolean; reaction: ReactionKind | null; likeCount: number }>(
        `/api/community/posts/${id}/like`,
        { method: "POST", body: JSON.stringify({ reaction }) }
      ),
    // Snapshot the affected caches so a failed switch (not its own inverse)
    // restores exactly, then apply the optimistic patch.
    onMutate: ({ id, reaction = "like" }) => {
      const feeds = qc.getQueriesData<InfiniteData<FeedResponse>>({ queryKey: ["community-feed"] });
      const detail = qc.getQueryData<PostDetailResponse>(["community-post", id]);
      patchEverywhere(id, reaction);
      return { feeds, detail, id };
    },
    onError: (_e, _vars, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.feeds) qc.setQueryData(key, data);
      qc.setQueryData(["community-post", ctx.id], ctx.detail);
    },
    // Profile pages cache posts separately — refresh them with the server truth.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["community-user"] });
      void qc.invalidateQueries({ queryKey: ["community-user-likes"] });
    },
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
    qc.setQueryData<PostDetailResponse>(["community-post", id], (data) =>
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

/** Counts a share (share sheet / copy link) — optimistic, anonymous, increment-only. */
export function useRecordShare() {
  const qc = useQueryClient();
  const patchEverywhere = (id: string, delta: number) => {
    const patchPost = (post: PostView): PostView => ({
      ...post,
      shareCount: Math.max(0, post.shareCount + delta),
    });
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
    qc.setQueryData<PostDetailResponse>(["community-post", id], (data) =>
      data ? { ...data, post: patchPost(data.post) } : data
    );
  };
  return useMutation({
    mutationFn: (id: string) =>
      request<{ shareCount: number }>(`/api/community/posts/${id}/share`, { method: "POST" }),
    onMutate: (id) => patchEverywhere(id, 1),
    onError: (_e, id) => patchEverywhere(id, -1), // silent revert — sharing still worked locally
  });
}

/** Follow toggle scoped to the post detail header — keeps that page's state instant. */
export function useFollowAuthor(postId: string, username: string) {
  const qc = useQueryClient();
  const key = ["community-post", postId];
  const set = (following: boolean) =>
    qc.setQueryData<PostDetailResponse>(key, (data) =>
      data ? { ...data, authorFollowedByMe: following } : data
    );
  return useMutation({
    mutationFn: () =>
      request<{ following: boolean }>(
        `/api/community/users/${encodeURIComponent(username)}/follow`,
        { method: "POST" }
      ),
    onMutate: () => {
      const prev = qc.getQueryData<PostDetailResponse>(key)?.authorFollowedByMe ?? false;
      set(!prev);
      return { prev };
    },
    onSuccess: (r) => {
      set(r.following);
      void qc.invalidateQueries({ queryKey: ["community-user", username] });
      void qc.invalidateQueries({ queryKey: ["community-feed"] });
    },
    onError: (_e, _v, ctx) => set(ctx?.prev ?? false),
  });
}

/** Pins/unpins one of the viewer's OWN posts to their profile top. */
export function usePinPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<{ pinned: boolean }>(`/api/community/posts/${id}/pin`, { method: "POST" }),
    onSuccess: () => {
      // The pin marker rides on every cached copy of the author's posts.
      void qc.invalidateQueries({ queryKey: ["community-user"] });
      void qc.invalidateQueries({ queryKey: ["community-feed"] });
      void qc.invalidateQueries({ queryKey: ["community-post"] });
    },
  });
}

export function useToggleCommentLike(postId: string) {
  const qc = useQueryClient();
  const patch = (commentId: string) => {
    qc.setQueryData<PostDetailResponse>(["community-post", postId], (data) =>
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

interface NotificationsResponse {
  notifications: NotificationView[];
  unread: number;
}

/** Bell polls the default 30; the full page asks for more via `limit`. */
export function useNotifications(enabled: boolean, limit = 30) {
  return useQuery({
    queryKey: ["community-notifications", limit],
    queryFn: () => request<NotificationsResponse>(`/api/community/notifications?limit=${limit}`),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
}

/**
 * Marks notifications read — pass ids to read one group, nothing to read all.
 * Optimistic: every cached notification list (bell + page) flips instantly.
 */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const patch = (ids: string[] | null) =>
    qc.setQueriesData<NotificationsResponse>({ queryKey: ["community-notifications"] }, (data) => {
      if (!data) return data;
      const hit = (n: NotificationView) => !n.read && (!ids || ids.includes(n.id));
      const flipped = data.notifications.filter(hit).length;
      return {
        notifications: data.notifications.map((n) => (hit(n) ? { ...n, read: true } : n)),
        unread: ids ? Math.max(0, data.unread - flipped) : 0,
      };
    });
  return useMutation({
    mutationFn: (ids?: string[]) =>
      request("/api/community/notifications", {
        method: "POST",
        body: JSON.stringify(ids?.length ? { ids } : {}),
      }),
    onMutate: (ids) => patch(ids?.length ? ids : null),
    onSettled: () => qc.invalidateQueries({ queryKey: ["community-notifications"] }),
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
      qc.setQueryData<PostDetailResponse>(["community-post", postId], (data) =>
        data
          ? {
              ...data, // keep related/follow state — don't drop detail extras
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
        accent: string | null;
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
        pinnedPost: PostView | null;
        posts: PostView[];
        nextCursor: string | null;
      }>(`/api/community/users/${encodeURIComponent(username)}`),
  });
}

/** Profile "Comments" tab — fetched lazily when the tab opens. */
export function useUserComments(username: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["community-user-comments", username],
    queryFn: ({ pageParam }) =>
      request<{ comments: ProfileCommentView[]; nextCursor: string | null }>(
        `/api/community/users/${encodeURIComponent(username)}/comments${
          pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""
        }`
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 15_000,
  });
}

/** Profile "Likes" tab — posts the user liked, newest like first. */
export function useUserLikes(username: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["community-user-likes", username],
    queryFn: ({ pageParam }) =>
      request<{ posts: PostView[]; nextCursor: string | null }>(
        `/api/community/users/${encodeURIComponent(username)}/likes${
          pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""
        }`
      ),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: 15_000,
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
