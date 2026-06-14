"use client";

import * as React from "react";
import { Clock, Plus, VolumeX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  describeMuteEntry,
  MAX_MUTED_ENTRIES,
  MUTE_DURATIONS,
  type MuteEntry,
  type MuteMatchMode,
} from "../muted-words";
import { useAddMutedWord, useMutedWords, useRemoveMutedWord } from "../api";

const MODE_OPTIONS: { value: MuteMatchMode; label: string }[] = [
  { value: "substring", label: "Contains" },
  { value: "word", label: "Whole word" },
  { value: "cashtag", label: "Ticker ($)" },
  { value: "hashtag", label: "Hashtag (#)" },
];

/** A short human label of when a mute expires (or "Forever"). */
function expiryLabel(entry: MuteEntry): string | null {
  if (!entry.expiresAt) return null;
  const ms = Date.parse(entry.expiresAt) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return "Expired";
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${days}d left`;
  const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
  return `${hours}h left`;
}

/**
 * Personal "muted words" settings panel. Add terms with a match mode + optional
 * case-sensitivity + expiry; remove with a button. Posts and comments matching
 * an active mute are hidden from THIS user's own feeds (and collapsed in threads).
 * Strictly personal — never moderation, never affects other users. No emoji.
 */
export function MutedWords() {
  const { data, isLoading } = useMutedWords(true);
  const add = useAddMutedWord();
  const remove = useRemoveMutedWord();

  const [term, setTerm] = React.useState("");
  const [mode, setMode] = React.useState<MuteMatchMode>("substring");
  const [caseSensitive, setCaseSensitive] = React.useState(false);
  const [duration, setDuration] = React.useState<string>("forever");

  const entries = data?.entries ?? [];
  const atCap = entries.length >= MAX_MUTED_ENTRIES;
  const caseAvailable = mode === "substring" || mode === "word";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = term.trim();
    if (!trimmed || atCap || add.isPending) return;
    const durationMs = MUTE_DURATIONS.find((d) => d.id === duration)?.ms ?? 0;
    add.mutate(
      {
        term: trimmed,
        mode,
        caseSensitive: caseAvailable ? caseSensitive : undefined,
        durationMs: durationMs || undefined,
      },
      { onSuccess: () => setTerm("") }
    );
  };

  return (
    <section aria-label="Muted words" className="overflow-hidden rounded-xl border bg-surface">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <VolumeX className="h-4 w-4 text-accent" aria-hidden />
        <div>
          <h2 className="text-sm font-semibold">Muted words</h2>
          <p className="text-xs text-muted">
            Hide posts and comments containing words, tickers or tags — just for you.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-2 border-b p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Word, $TICKER or #tag to mute"
            aria-label="Word to mute"
            maxLength={100}
            disabled={atCap}
            className="flex-1"
          />
          <Select value={mode} onValueChange={(v) => setMode(v as MuteMatchMode)}>
            <SelectTrigger className="sm:w-40" aria-label="Match mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger className="w-32" aria-label="Mute duration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MUTE_DURATIONS.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {caseAvailable && (
            <label className="flex items-center gap-2 text-xs text-muted">
              <Checkbox
                checked={caseSensitive}
                onCheckedChange={(v) => setCaseSensitive(v === true)}
                aria-label="Match case"
              />
              Match case
            </label>
          )}
          <Button
            type="submit"
            size="sm"
            className="ml-auto"
            disabled={!term.trim() || atCap || add.isPending}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Mute
          </Button>
        </div>
        {atCap && (
          <p className="text-xs text-muted">
            You&apos;ve reached the limit of {MAX_MUTED_ENTRIES} muted words.
          </p>
        )}
        {add.isError && (
          <p className="text-xs text-loss" role="alert">
            {(add.error as Error)?.message ?? "Couldn't mute that word."}
          </p>
        )}
      </form>

      {isLoading ? (
        <div className="space-y-2 p-3">
          <Skeleton className="h-9 rounded-lg" />
          <Skeleton className="h-9 rounded-lg" />
        </div>
      ) : entries.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted">
          Nothing muted yet. Muted words only affect what you see.
        </p>
      ) : (
        <ul className="divide-y" aria-label="Your muted words">
          {entries.map((entry) => {
            const expiry = expiryLabel(entry);
            return (
              <li
                key={`${entry.mode} ${entry.term}`}
                className="flex items-center gap-3 px-3 py-2.5"
                data-mute-mode={entry.mode}
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {describeMuteEntry(entry)}
                  {entry.caseSensitive && (
                    <span className="ml-1.5 text-xs text-muted">· case-sensitive</span>
                  )}
                </span>
                {expiry && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    <Clock className="h-3 w-3" aria-hidden />
                    {expiry}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label={`Remove muted word ${describeMuteEntry(entry)}`}
                  onClick={() => remove.mutate({ term: entry.term, mode: entry.mode })}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
