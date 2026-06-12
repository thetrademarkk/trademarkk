"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Camera,
  Flame,
  LinkIcon,
  Loader2,
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
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  CommunityAvatar,
  PostCard,
  SignInGate,
  useUpdateProfile,
  useUserProfile,
} from "@/features/community";
import { ApiError, useToggleBlock, useToggleFollow } from "@/features/community/api";

export function ProfileView({ username }: { username: string }) {
  const { data, isLoading, isError } = useUserProfile(username);
  const updateProfile = useUpdateProfile();
  const toggleFollow = useToggleFollow(username);
  const toggleBlock = useToggleBlock(username);
  const confirmDialog = useConfirm();
  const [editOpen, setEditOpen] = React.useState(false);
  const [gateOpen, setGateOpen] = React.useState(false);
  // undefined = unchanged, "" = remove photo, data-url = new photo
  const [avatarDraft, setAvatarDraft] = React.useState<string | undefined>(undefined);
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
      onError: (e) =>
        e instanceof ApiError && e.status === 401
          ? setGateOpen(true)
          : toast.error("Could not follow"),
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
  const { profile, posts } = data;

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

      <header className="flex items-start gap-4 rounded-xl border bg-surface p-5">
        <CommunityAvatar
          size="lg"
          username={profile.username}
          displayName={profile.displayName}
          avatar={profile.avatar}
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight">{profile.displayName}</h1>
          <p className="text-sm text-muted">@{profile.username}</p>
          {profile.bio && (
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{profile.bio}</p>
          )}
          {profile.website && (
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
            <span className="font-medium text-foreground">{profile.followerCount}</span> followers ·{" "}
            <span className="font-medium text-foreground">{profile.followingCount}</span> following
            · {profile.postCount} post{profile.postCount === 1 ? "" : "s"} · joined{" "}
            <time dateTime={profile.createdAt}>{timeAgo(profile.createdAt)}</time> ago
          </p>
        </div>
        {data.profile.mine ? (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
          </Button>
        ) : (
          <div className="flex flex-col items-end gap-1.5">
            {!profile.blockedByMe && (
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
      </header>

      {profile.blockedByMe && (
        <p className="mt-3 rounded-lg border border-loss/30 bg-loss/5 px-3 py-2 text-xs text-muted">
          You&apos;ve blocked @{profile.username} — their posts and comments are hidden from your
          feeds.
        </p>
      )}

      <section aria-label={`Posts by ${profile.displayName}`} className="mt-5 space-y-3">
        {posts.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No posts yet.</p>
        ) : (
          posts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </section>

      <SignInGate open={gateOpen} onOpenChange={setGateOpen} onAuthed={follow} />
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
