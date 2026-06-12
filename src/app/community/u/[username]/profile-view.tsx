"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Camera,
  Flame,
  Heart,
  LinkIcon,
  Loader2,
  MessageCircle,
  Pencil,
  UserCheck,
  UserPlus,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { cn, timeAgo } from "@/lib/utils";
import { compressAvatar } from "@/lib/images";
import { badgesFor } from "@/lib/streak-badges";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  CommunityAvatar,
  PostCard,
  SignInGate,
  useUpdateProfile,
  useUserProfile,
} from "@/features/community";
import {
  ApiError,
  useStartConversation,
  useToggleBlock,
  useToggleFollow,
  useUserComments,
  useUserLikes,
} from "@/features/community/api";
import {
  PROFILE_ACCENTS,
  accentById,
  coverGradient,
  swatchGradient,
} from "@/features/community/accents";
import { formatCount, postContextLabel } from "@/features/community/format";

export function ProfileView({ username }: { username: string }) {
  const router = useRouter();
  const { data, isLoading, isError } = useUserProfile(username);
  const updateProfile = useUpdateProfile();
  const toggleFollow = useToggleFollow(username);
  const toggleBlock = useToggleBlock(username);
  const startConversation = useStartConversation();
  const confirmDialog = useConfirm();
  const [editOpen, setEditOpen] = React.useState(false);
  const [gateOpen, setGateOpen] = React.useState(false);
  // Which action the sign-in gate resumes after auth (Follow vs Message).
  const [gateAction, setGateAction] = React.useState<"follow" | "message">("follow");
  // undefined = unchanged, "" = remove photo, data-url = new photo
  const [avatarDraft, setAvatarDraft] = React.useState<string | undefined>(undefined);
  // undefined = unchanged, "" = no accent, otherwise a preset accent id
  const [accentDraft, setAccentDraft] = React.useState<string | undefined>(undefined);
  const [tab, setTab] = React.useState("posts");
  const fileRef = React.useRef<HTMLInputElement>(null);

  const pickAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarDraft(await compressAvatar(file));
    } catch {
      toast.error("Could not read that image");
    }
    e.target.value = "";
  };

  const follow = () =>
    toggleFollow.mutate(undefined, {
      onError: (e) => {
        if (e instanceof ApiError && e.status === 401) {
          setGateAction("follow");
          setGateOpen(true);
        } else {
          toast.error("Could not follow");
        }
      },
    });

  const message = () =>
    startConversation.mutate(username, {
      onSuccess: (r) => router.push(`/community/messages?c=${r.id}`),
      onError: (e) => {
        if (e instanceof ApiError && e.status === 401) {
          setGateAction("message");
          setGateOpen(true);
        } else {
          toast.error(e instanceof Error ? e.message : "Could not start the conversation");
        }
      },
    });

  const block = async (currentlyBlocked: boolean) => {
    if (!currentlyBlocked) {
      const ok = await confirmDialog({
        title: `Block @${username}?`,
        description: "You won't see their posts or comments anywhere.",
        confirmLabel: "Block",
        destructive: true,
      });
      if (!ok) return;
    }
    toggleBlock.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(r.blocked ? `Blocked @${username}` : `Unblocked @${username}`),
      onError: (e) =>
        e instanceof ApiError && e.status === 401
          ? setGateOpen(true)
          : toast.error("Could not update block"),
    });
  };

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
    );
  }
  if (isError || !data) {
    return <p className="py-16 text-center text-sm text-muted">Profile not found.</p>;
  }
  const { profile, posts, pinnedPost } = data;
  // Live preview while the edit dialog is open; the saved value for visitors.
  const accent = accentById(accentDraft !== undefined ? accentDraft : profile.accent);

  const saveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newUsername = String(form.get("username"));
    try {
      await updateProfile.mutateAsync({
        username: newUsername || undefined,
        displayName: String(form.get("displayName")) || undefined,
        bio: String(form.get("bio") ?? ""),
        website: String(form.get("website") ?? ""),
        ...(avatarDraft !== undefined ? { avatar: avatarDraft } : {}),
        ...(accentDraft !== undefined ? { accent: accentDraft } : {}),
      });
      toast.success("Profile updated");
      setEditOpen(false);
      if (newUsername && newUsername !== profile.username) {
        location.assign(`/community/u/${newUsername}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update profile");
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link
        href="/community"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to community
      </Link>

      <header className="overflow-hidden rounded-xl border bg-surface">
        {/* Cover accent band — subtle gradient when the owner picked a preset. */}
        <div
          aria-hidden
          data-cover-accent={accent?.id ?? "none"}
          className="h-14 bg-surface-2/60 sm:h-20"
          style={accent ? { background: coverGradient(accent) } : undefined}
        />
        <div className="flex items-start gap-4 p-5 pt-0">
          <div className="-mt-7 shrink-0 rounded-full ring-4 ring-surface">
            <CommunityAvatar
              size="lg"
              username={profile.username}
              displayName={profile.displayName}
              avatar={profile.avatar}
            />
          </div>
          <div className="min-w-0 flex-1 pt-3">
            <h1 className="text-lg font-bold leading-tight">{profile.displayName}</h1>
            <p className="text-sm text-muted">@{profile.username}</p>
            {profile.bio && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{profile.bio}</p>
            )}
            {profile.website && /^https?:\/\//i.test(profile.website) && (
              <a
                href={profile.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <LinkIcon className="h-3 w-3" aria-hidden />
                {profile.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
              </a>
            )}
            {profile.streak && (
              <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 font-medium text-warning">
                  <Flame className="h-3 w-3" aria-hidden />
                  {profile.streak.current}-day streak
                </span>
                <span className="text-muted">best {profile.streak.best}</span>
                {badgesFor(profile.streak.best).map((b) => (
                  <span
                    key={b.days}
                    title={`${b.name} — ${b.days} days`}
                    className={cn("flex h-6 w-6 items-center justify-center rounded-full", b.bg)}
                  >
                    <b.icon className={cn("h-3.5 w-3.5", b.color)} aria-hidden />
                  </span>
                ))}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              <span className="font-medium text-foreground">{profile.followerCount}</span> followers
              · <span className="font-medium text-foreground">{profile.followingCount}</span>{" "}
              following · {profile.postCount} post{profile.postCount === 1 ? "" : "s"} · joined{" "}
              <time dateTime={profile.createdAt}>{timeAgo(profile.createdAt)}</time> ago
            </p>
          </div>
          {data.profile.mine ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
            </Button>
          ) : (
            <div className="mt-3 flex flex-col items-end gap-1.5">
              {!profile.blockedByMe && (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={message}
                    disabled={startConversation.isPending}
                    aria-label={`Message @${profile.username}`}
                  >
                    {startConversation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Message
                  </Button>
                  <Button
                    variant={profile.followedByMe ? "outline" : "default"}
                    size="sm"
                    onClick={follow}
                    disabled={toggleFollow.isPending}
                    aria-pressed={profile.followedByMe}
                  >
                    {profile.followedByMe ? (
                      <>
                        <UserCheck className="h-3.5 w-3.5" aria-hidden /> Following
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-3.5 w-3.5" aria-hidden /> Follow
                      </>
                    )}
                  </Button>
                </div>
              )}
              <Button
                variant={profile.blockedByMe ? "destructive" : "ghost"}
                size="sm"
                onClick={() => block(profile.blockedByMe)}
                disabled={toggleBlock.isPending}
                aria-pressed={profile.blockedByMe}
                className={profile.blockedByMe ? "" : "text-muted hover:text-loss"}
              >
                <UserX className="h-3.5 w-3.5" aria-hidden />
                {profile.blockedByMe ? "Unblock" : "Block"}
              </Button>
            </div>
          )}
        </div>
      </header>

      {profile.blockedByMe && (
        <p className="mt-3 rounded-lg border border-loss/30 bg-loss/5 px-3 py-2 text-xs text-muted">
          You&apos;ve blocked @{profile.username} — their posts and comments are hidden from your
          feeds.
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab} className="mt-5">
        <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-auto">
          <TabsTrigger value="posts">
            Posts
            <span className="ml-1.5 font-money text-xs text-muted">
              {formatCount(profile.postCount)}
            </span>
          </TabsTrigger>
          <TabsTrigger value="comments">
            Comments
            <span className="ml-1.5 font-money text-xs text-muted">
              {formatCount(profile.commentCount)}
            </span>
          </TabsTrigger>
          <TabsTrigger value="likes">
            Likes
            <span className="ml-1.5 font-money text-xs text-muted">
              {formatCount(profile.likeCount)}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts">
          <section aria-label={`Posts by ${profile.displayName}`} className="space-y-3">
            {pinnedPost && <PostCard post={pinnedPost} showPinned />}
            {posts.length === 0 && !pinnedPost ? (
              <p className="py-10 text-center text-sm text-muted">No posts yet.</p>
            ) : (
              posts.map((post) => <PostCard key={post.id} post={post} />)
            )}
          </section>
        </TabsContent>

        <TabsContent value="comments">
          <CommentsTab username={profile.username} displayName={profile.displayName} />
        </TabsContent>

        <TabsContent value="likes">
          <LikesTab username={profile.username} displayName={profile.displayName} />
        </TabsContent>
      </Tabs>

      <SignInGate
        open={gateOpen}
        onOpenChange={setGateOpen}
        onAuthed={gateAction === "message" ? message : follow}
      />
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={saveProfile}>
            {/* ── Profile photo ── */}
            <div className="flex items-center gap-3">
              <div className="relative">
                {avatarDraft !== undefined && avatarDraft === "" ? (
                  <CommunityAvatar
                    size="lg"
                    username={profile.username}
                    displayName={profile.displayName}
                  />
                ) : (
                  <CommunityAvatar
                    size="lg"
                    username={profile.username}
                    displayName={profile.displayName}
                    avatar={avatarDraft ?? profile.avatar}
                  />
                )}
                <button
                  type="button"
                  aria-label="Change profile photo"
                  onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border bg-surface text-muted shadow-sm transition-colors hover:text-foreground"
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <div className="text-xs text-muted">
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() => fileRef.current?.click()}
                >
                  Upload photo
                </button>
                {(avatarDraft ? true : avatarDraft !== "" && profile.avatar) && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="hover:text-loss"
                      onClick={() => setAvatarDraft("")}
                    >
                      Remove
                    </button>
                  </>
                )}
                <p className="mt-0.5">Square works best — auto-cropped to 256px.</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={pickAvatar}
                aria-label="Profile photo file"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-name">Display name</Label>
              <Input
                id="pf-name"
                name="displayName"
                defaultValue={profile.displayName}
                maxLength={40}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-username">Username</Label>
              <Input
                id="pf-username"
                name="username"
                defaultValue={profile.username}
                pattern="[a-z0-9_]{3,20}"
                title="3–20 characters: a-z, 0-9, underscore"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-bio">Bio</Label>
              <Textarea
                id="pf-bio"
                name="bio"
                defaultValue={profile.bio ?? ""}
                maxLength={280}
                rows={3}
                placeholder="Index options scalper · 3 years in the market"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-website">Website / X profile (optional)</Label>
              <Input
                id="pf-website"
                name="website"
                type="url"
                defaultValue={profile.website ?? ""}
                maxLength={120}
                placeholder="https://x.com/yourhandle"
              />
            </div>
            {/* ── Cover accent (preset palette only) ── */}
            <div className="space-y-1.5">
              <Label id="pf-accent-label">Cover accent</Label>
              <div
                role="group"
                aria-labelledby="pf-accent-label"
                className="flex flex-wrap items-center gap-2"
              >
                <button
                  type="button"
                  aria-label="No accent"
                  aria-pressed={!accent}
                  onClick={() => setAccentDraft("")}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border text-muted transition-shadow hover:text-foreground",
                    !accent && "ring-2 ring-accent ring-offset-2 ring-offset-surface"
                  )}
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden />
                </button>
                {PROFILE_ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    aria-label={`${a.name} accent`}
                    aria-pressed={accent?.id === a.id}
                    onClick={() => setAccentDraft(a.id)}
                    className={cn(
                      "h-7 w-7 rounded-full transition-shadow",
                      accent?.id === a.id && "ring-2 ring-accent ring-offset-2 ring-offset-surface"
                    )}
                    style={{ background: swatchGradient(a) }}
                  />
                ))}
              </div>
              <p className="text-xs text-muted">
                Paints a subtle band across the top of your profile.
              </p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={updateProfile.isPending}
              aria-busy={updateProfile.isPending}
            >
              {updateProfile.isPending && <Loader2 className="animate-spin" aria-hidden />}
              Save profile
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** "Comments" tab — the user's comments, each linking back to its post. */
function CommentsTab({ username, displayName }: { username: string; displayName: string }) {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useUserComments(
    username,
    true
  );
  const rows = data?.pages.flatMap((p) => p.comments) ?? [];

  if (isLoading) return <Skeleton className="h-28 rounded-xl" />;
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No comments yet.</p>;
  }
  return (
    <section aria-label={`Comments by ${displayName}`} className="space-y-3">
      {rows.map((c) => (
        <article key={c.id} className="rounded-xl border bg-surface p-4">
          <p className="text-xs text-muted">
            Commented on{" "}
            <Link
              href={`/community/post/${c.post.id}`}
              className="font-medium text-accent hover:underline"
            >
              {postContextLabel(c.post.title, c.post.body)}
            </Link>
            {" · "}
            <time dateTime={c.createdAt}>{timeAgo(c.createdAt)}</time> ago
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
            {c.body}
          </p>
          {c.likeCount > 0 && (
            <p className="mt-2 flex items-center gap-1 text-xs text-muted">
              <Heart className="h-3.5 w-3.5" aria-hidden />
              <span className="font-money">{formatCount(c.likeCount)}</span>
            </p>
          )}
        </article>
      ))}
      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
          Show more comments
        </Button>
      )}
    </section>
  );
}

/** "Likes" tab — posts the user liked, newest like first. */
function LikesTab({ username, displayName }: { username: string; displayName: string }) {
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useUserLikes(
    username,
    true
  );
  const rows = data?.pages.flatMap((p) => p.posts) ?? [];

  if (isLoading) return <Skeleton className="h-44 rounded-xl" />;
  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">No liked posts yet.</p>;
  }
  return (
    <section aria-label={`Posts liked by ${displayName}`} className="space-y-3">
      {rows.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
        >
          {isFetchingNextPage && <Loader2 className="animate-spin" aria-hidden />}
          Show more likes
        </Button>
      )}
    </section>
  );
}
