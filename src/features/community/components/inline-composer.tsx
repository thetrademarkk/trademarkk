"use client";

import * as React from "react";
import { CircleUserRound, X } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { useMyProfile } from "../api";
import { COMMUNITY_DRAFT_KEY, readDraft } from "../draft";
import { CommunityAvatar } from "./avatar";
import { Composer } from "./composer";
import { SignInGate } from "./sign-in-gate";

/**
 * LinkedIn-style top-of-feed composer. Collapsed it is one inviting line;
 * clicking it expands the full composer in place (no dialog). A saved draft
 * reopens it automatically so the trader resumes mid-thought after a reload.
 */
export function InlineComposer() {
  const { data: session } = useSession();
  const { data: me } = useMyProfile(Boolean(session));
  const [expanded, setExpanded] = React.useState(false);
  const [gateOpen, setGateOpen] = React.useState(false);

  React.useEffect(() => {
    if (readDraft(COMMUNITY_DRAFT_KEY)) setExpanded(true);
  }, []);

  const startPost = () => {
    if (session) setExpanded(true);
    else setGateOpen(true); // signing in is the happy path; dismissing still lets them draft
  };

  return (
    <div className="mb-4 rounded-xl border bg-surface p-3 sm:p-4">
      {expanded ? (
        <div data-testid="inline-composer-expanded">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {me ? (
                <CommunityAvatar
                  username={me.username}
                  displayName={me.displayName}
                  avatar={me.avatar}
                  size="sm"
                />
              ) : (
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"
                  aria-hidden
                >
                  <CircleUserRound className="h-4.5 w-4.5" />
                </span>
              )}
              <p className="truncate text-sm font-medium">{me ? me.displayName : "New post"}</p>
            </div>
            <button
              type="button"
              aria-label="Collapse composer"
              onClick={() => setExpanded(false)}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <Composer
            draftKey={COMMUNITY_DRAFT_KEY}
            autoFocusBody
            onPosted={() => setExpanded(false)}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {me ? (
            <CommunityAvatar
              username={me.username}
              displayName={me.displayName}
              avatar={me.avatar}
            />
          ) : (
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"
              aria-hidden
            >
              <CircleUserRound className="h-5 w-5" />
            </span>
          )}
          <button
            type="button"
            onClick={startPost}
            aria-label="Start a post"
            className="min-w-0 flex-1 rounded-full border bg-surface-2/40 px-4 py-2.5 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <span className="block truncate">Share a trade idea, lesson or question…</span>
          </button>
        </div>
      )}

      <SignInGate
        open={gateOpen}
        onOpenChange={(open) => {
          setGateOpen(open);
          if (!open) setExpanded(true); // even a dismissal means "I want to write" — auth happens at post time
        }}
        onAuthed={() => setExpanded(true)}
      />
    </div>
  );
}
