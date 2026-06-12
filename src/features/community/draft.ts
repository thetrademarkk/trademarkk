/**
 * Composer draft persistence — title/body/tags survive reloads via localStorage.
 * Images are intentionally NOT persisted (base64 payloads would blow the ~5MB
 * storage quota). All operations are best-effort: storage being unavailable
 * (SSR, blocked third-party storage, full quota) must never break composing.
 */

export const COMMUNITY_DRAFT_KEY = "tm.community-draft";

export interface ComposerDraft {
  title: string;
  body: string;
  tags: string[];
}

const TITLE_MAX = 120;
const BODY_MAX = 5000;
const TAGS_MAX = 4;
/** Mirrors the server's tag schema — corrupt drafts must not produce 400s. */
const TAG_RE = /^[a-z0-9-]{2,20}$/;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // some privacy modes throw on access
  }
}

export function isEmptyDraft(d: ComposerDraft): boolean {
  return d.title.trim() === "" && d.body.trim() === "" && d.tags.length === 0;
}

/** Parse and clamp whatever is in storage; null when absent, corrupt or empty. */
export function readDraft(key: string = COMMUNITY_DRAFT_KEY): ComposerDraft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    const draft: ComposerDraft = {
      title: typeof o.title === "string" ? o.title.slice(0, TITLE_MAX) : "",
      body: typeof o.body === "string" ? o.body.slice(0, BODY_MAX) : "",
      tags: Array.isArray(o.tags)
        ? o.tags
            .filter((t): t is string => typeof t === "string" && TAG_RE.test(t))
            .slice(0, TAGS_MAX)
        : [],
    };
    return isEmptyDraft(draft) ? null : draft;
  } catch {
    return null;
  }
}

/** Save the draft; an empty draft removes the key instead of storing noise. */
export function writeDraft(draft: ComposerDraft, key: string = COMMUNITY_DRAFT_KEY): void {
  const s = storage();
  if (!s) return;
  try {
    if (isEmptyDraft(draft)) s.removeItem(key);
    else s.setItem(key, JSON.stringify(draft));
  } catch {
    // quota exceeded — drafts are best-effort, never block typing
  }
}

export function clearDraft(key: string = COMMUNITY_DRAFT_KEY): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // ignore
  }
}
