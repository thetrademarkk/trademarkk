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
import { toggleFollowedTag } from "./followed-tags";
import { toggleWatchedSymbol } from "./watchlist";
import { extractCashtags } from "./cashtags";
import type { LinkUnfurl } from "./unfurl";
import type { CreatePostInput, EditPostInput, UpdateProfileInput } from "./schemas";
import type { PostEditSnapshot } from "./edit-window";

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
export type FeedScope = "all" | "following" | "saved" | "watchlist";

export function useFeed(
  sort: FeedSort,
  tag: string | null,
  search: string | null = null,
  scope: FeedScope = "all",
  initialFeed: FeedResponse | null = null,
  symbol: string | null = null
) {
  return useInfiniteQuery({
    queryKey: ["community-feed", sort, tag, search, scope, symbol],
    queryFn: ({ pageParam }) =>
      request<FeedResponse>(
        `/api/community/posts?sort=${sort}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}${
          search ? `&q=${encodeURIComponent(search)}` : ""
        }${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}${
          scope !== "all" ? `&scope=${scope}` : ""
        }${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`
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

/**
 * Lazy link-preview for a post. The server resolves the FIRST link in the
 * post body and returns its cached/fetched OG unfurl (or null). Fired only when
 * `enabled` (the post body actually contains a link) so a linkless feed never
 * touches the network. Cached for an hour client-side — the card is stable.
 */
export function useUnfurl(postId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["community-unfurl", postId],
    queryFn: () =>
      request<{ unfurl: LinkUnfurl | null }>(
        `/api/community/unfurl?postId=${encodeURIComponent(postId)}`
      ),
    enabled,
    staleTime: 60 * 60_000,
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

/* ── Trending board (tickers & topics) ───────────────────────── */

export interface TrendingBoardItem {
  key: string;
  authors: number;
  posts: number;
  score: number;
}
export interface TrendingBoardResponse {
  window: "24h" | "7d";
  tickers: TrendingBoardItem[];
  topics: TrendingBoardItem[];
}

/**
 * Trending tickers & topics for a window. Block-aware on the server for
 * signed-in viewers; the anonymous board is CDN-cached. Drives the
 * /community/trending page and the right-rail Trending widget.
 */
export function useTrending(window: "24h" | "7d") {
  return useQuery({
    queryKey: ["community-trending", window],
    queryFn: () => request<TrendingBoardResponse>(`/api/community/trending?window=${window}`),
    staleTime: 5 * 60_000,
  });
}

/* ── Per-symbol community sentiment gauge ─────────────────────── */

export interface SentimentGaugeView {
  bull: number;
  bear: number;
  total: number;
  bullPct: number;
  bearPct: number;
  hasSignal: boolean;
}
export interface SentimentResponse {
  symbol: string;
  window: "24h" | "7d";
  gauge: SentimentGaugeView;
}

/**
 * Community sentiment gauge for a symbol over a window. Block-aware on the
 * server for signed-in viewers; the anonymous gauge is CDN-cached. Drives the
 * per-symbol stream page's bull/bear gauge — NOT a recommendation.
 */
export function useSymbolSentiment(symbol: string, window: "24h" | "7d") {
  return useQuery({
    queryKey: ["community-sentiment", symbol, window],
    queryFn: () =>
      request<SentimentResponse>(
        `/api/community/sentiment?symbol=${encodeURIComponent(symbol)}&window=${window}`
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** The signed-in viewer's followed tags. Drives the tag page's Follow state + the left-rail list. */
export function useFollowedTags(enabled: boolean) {
  return useQuery({
    queryKey: ["community-followed-tags"],
    queryFn: () => request<{ tags: string[] }>("/api/community/followed-tags"),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Optimistic follow/unfollow of a tag. Patches the cached followed-tags list
 * instantly (so the tag page button and the left-rail list flip together) and
 * rolls back on error. Refreshes the Following feed on success so newly-followed
 * tags' posts appear without a manual reload.
 */
export function useToggleFollowTag() {
  const qc = useQueryClient();
  const key = ["community-followed-tags"];
  return useMutation({
    mutationFn: (tag: string) =>
      request<{ following: boolean }>(`/api/community/tags/${encodeURIComponent(tag)}/follow`, {
        method: "POST",
      }),
    onMutate: (tag) => {
      const prev = qc.getQueryData<{ tags: string[] }>(key);
      qc.setQueryData<{ tags: string[] }>(key, (data) => ({
        tags: toggleFollowedTag(data?.tags ?? [], tag),
      }));
      return { prev };
    },
    onError: (_e, _tag, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      // A followed tag's posts flow into the Following feed.
      void qc.invalidateQueries({ queryKey: ["community-feed"] });
    },
  });
}

/* ── Watchlist (watched symbols) ─────────────────────────────── */

/**
 * The signed-in viewer's watched symbols. Drives the per-symbol stream's Watch
 * button state, the left-rail "Your watchlist" list, and the Watchlist feed
 * availability. Empty (and skipped) for signed-out viewers.
 */
export function useWatchedSymbols(enabled: boolean) {
  return useQuery({
    queryKey: ["community-watched-symbols"],
    queryFn: () => request<{ symbols: string[] }>("/api/community/watchlist"),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Optimistic watch/unwatch of a symbol. Patches the cached watched-symbols list
 * instantly (so the stream-page Watch button and the left-rail list flip
 * together) and rolls back on error. Refreshes the Watchlist feed on success so
 * a newly-watched symbol's posts appear without a manual reload.
 */
export function useToggleWatch() {
  const qc = useQueryClient();
  const key = ["community-watched-symbols"];
  return useMutation({
    mutationFn: (symbol: string) =>
      request<{ watching: boolean }>(`/api/community/watchlist/${encodeURIComponent(symbol)}`, {
        method: "POST",
      }),
    onMutate: (symbol) => {
      const prev = qc.getQueryData<{ symbols: string[] }>(key);
      qc.setQueryData<{ symbols: string[] }>(key, (data) => ({
        symbols: toggleWatchedSymbol(data?.symbols ?? [], symbol),
      }));
      return { prev };
    },
    onError: (_e, _symbol, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      // A watched symbol's posts flow into the Watchlist feed.
      void qc.invalidateQueries({ queryKey: ["community-feed"] });
    },
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

/**
 * Reshare (empty body) or quote (with commentary) a post. Optimistically bumps
 * the ORIGINAL post's reshareCount in every cached copy, then rolls back on
 * error. The new reshare itself appears after the feed lists invalidate.
 */
export function useReshare() {
  const qc = useQueryClient();
  const bump = (rootId: string, delta: number) => {
    const patch = (post: PostView): PostView =>
      post.id === rootId ? { ...post, reshareCount: Math.max(0, post.reshareCount + delta) } : post;
    qc.setQueriesData<InfiniteData<FeedResponse>>({ queryKey: ["community-feed"] }, (data) =>
      data ? { ...data, pages: data.pages.map((p) => ({ ...p, posts: p.posts.map(patch) })) } : data
    );
    qc.setQueryData<PostDetailResponse>(["community-post", rootId], (data) =>
      data ? { ...data, post: patch(data.post) } : data
    );
  };
  return useMutation({
    mutationFn: ({ targetId, body }: { targetId: string; body?: string }) =>
      request<{ id: string; rootId: string; quote: boolean }>(
        `/api/community/posts/${targetId}/reshare`,
        { method: "POST", body: JSON.stringify(body ? { body } : {}) }
      ),
    // We optimistically bump the TARGET id; the server may collapse to a root,
    // but at feed scale the target usually IS the root, and onSettled reconciles.
    onMutate: ({ targetId }) => {
      bump(targetId, 1);
      return { targetId };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx) bump(ctx.targetId, -1);
    },
    onSettled: () => invalidatePostLists(qc),
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
 * Edit a post (title/body/tags) within its window. Optimistically patches every
 * cached copy — feed pages and the detail page — appending the pre-edit content
 * to the local history and stamping `editedAt`, then rolls back on error.
 */
export function useEditPost(id: string) {
  const qc = useQueryClient();

  const patchPost = (post: PostView, input: EditPostInput, editedAt: string): PostView => {
    const snapshot: PostEditSnapshot = {
      editedAt,
      title: post.title,
      body: post.body,
      tags: post.tags,
    };
    return {
      ...post,
      title: input.title?.trim() || null,
      body: input.body.trim(),
      tags: input.tags,
      // Sentiment is only kept when the new body still tags a ticker (mirrors the
      // server re-gate); `undefined` leaves the existing lean untouched.
      sentiment:
        input.sentiment === undefined
          ? input.body.trim().length && extractCashtags(input.body).length > 0
            ? post.sentiment
            : null
          : extractCashtags(input.body).length > 0
            ? (input.sentiment ?? null)
            : null,
      editedAt,
      editHistory: [...post.editHistory, snapshot],
    };
  };

  const patchEverywhere = (input: EditPostInput, editedAt: string) => {
    qc.setQueriesData<InfiniteData<FeedResponse>>({ queryKey: ["community-feed"] }, (data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              posts: p.posts.map((post) =>
                post.id === id ? patchPost(post, input, editedAt) : post
              ),
            })),
          }
        : data
    );
    qc.setQueryData<PostDetailResponse>(["community-post", id], (data) =>
      data ? { ...data, post: patchPost(data.post, input, editedAt) } : data
    );
  };

  return useMutation({
    mutationFn: (input: EditPostInput) =>
      request<{ edited: boolean; editedAt: string }>(`/api/community/posts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onMutate: (input) => {
      const feeds = qc.getQueriesData<InfiniteData<FeedResponse>>({ queryKey: ["community-feed"] });
      const detail = qc.getQueryData<PostDetailResponse>(["community-post", id]);
      patchEverywhere(input, new Date().toISOString());
      return { feeds, detail };
    },
    onError: (_e, _input, ctx) => {
      if (!ctx) return;
      for (const [key, data] of ctx.feeds) qc.setQueryData(key, data);
      qc.setQueryData(["community-post", id], ctx.detail);
    },
    // Refresh profile lists + reconcile the detail/feed history with server truth.
    onSettled: () => invalidatePostLists(qc),
  });
}

/** Edit a comment's body within its window — optimistic patch with rollback. */
export function useEditComment(postId: string) {
  const qc = useQueryClient();
  const key = ["community-post", postId];
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      request<{ edited: boolean; editedAt: string }>(`/api/community/comments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      }),
    onMutate: ({ id, body }) => {
      const prev = qc.getQueryData<PostDetailResponse>(key);
      const editedAt = new Date().toISOString();
      qc.setQueryData<PostDetailResponse>(key, (data) =>
        data
          ? {
              ...data,
              comments: data.comments.map((c) =>
                c.id === id
                  ? {
                      ...c,
                      editHistory: [...c.editHistory, { editedAt, body: c.body }],
                      body: body.trim(),
                      editedAt,
                    }
                  : c
              ),
            }
          : data
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["community-user-comments"] });
    },
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
