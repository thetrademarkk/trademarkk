"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PnlText } from "@/components/shared/pnl-text";
import { cn, toDateKey, todayKey } from "@/lib/utils";
import { describeInstrument } from "@/features/trades";
import { journalStreak, useDayTrades, useJournalDates, useJournalEntry, useSaveJournal } from "../queries";

const MOODS = ["😖", "😕", "😐", "🙂", "😎"];

export function JournalEditor({ date }: { date: string }) {
  const { data: entry, isLoading } = useJournalEntry(date);
  const { data: dayTrades = [] } = useDayTrades(date);
  const { data: dates = [] } = useJournalDates();
  const save = useSaveJournal();

  const [premarket, setPremarket] = React.useState("");
  const [market, setMarket] = React.useState("");
  const [postmarket, setPostmarket] = React.useState("");
  const [mood, setMood] = React.useState<number | null>(null);
  const [followed, setFollowed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setPremarket(entry?.premarket_plan ?? "");
    setMarket(entry?.market_notes ?? "");
    setPostmarket(entry?.postmarket_review ?? "");
    setMood(entry?.mood ?? null);
    setFollowed(entry?.followed_plan == null ? null : entry.followed_plan === 1);
  }, [entry, date]);

  const shift = (days: number) => {
    const d = new Date(date + "T12:00:00");
    d.setDate(d.getDate() + days);
    return toDateKey(d);
  };
  const dayPnl = dayTrades.filter((t) => t.status === "closed").reduce((s, t) => s + t.net_pnl, 0);
  const streak = journalStreak(dates);

  const handleSave = async () => {
    await save.mutateAsync({
      date,
      premarket_plan: premarket,
      market_notes: market,
      postmarket_review: postmarket,
      mood,
      followed_plan: followed,
    });
    toast.success("Journal saved");
  };

  if (isLoading) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" asChild>
          <Link href={`/app/journal?date=${shift(-1)}`}><ChevronLeft /></Link>
        </Button>
        <div className="text-sm font-semibold">
          {new Date(date + "T12:00:00").toLocaleDateString("en-IN", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </div>
        <Button variant="outline" size="icon" disabled={date >= todayKey()} asChild={date < todayKey()}>
          {date < todayKey() ? <Link href={`/app/journal?date=${shift(1)}`}><ChevronRight /></Link> : <ChevronRight />}
        </Button>
        {date !== todayKey() && (
          <Button variant="link" size="sm" asChild>
            <Link href={`/app/journal?date=${todayKey()}`}>Today</Link>
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {streak > 0 && (
            <Badge variant="warning">
              <Flame className="h-3 w-3" /> {streak}-day streak
            </Badge>
          )}
          {dayTrades.length > 0 && <PnlText value={dayPnl} className="font-semibold" />}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>🌅 Pre-market plan</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={7}
              placeholder={"Bias, key levels, watchlist…\nMax loss for today: ₹"}
              value={premarket}
              onChange={(e) => setPremarket(e.target.value)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>📈 During market</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={7}
              placeholder="Quick notes as the session unfolds…"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>🌙 Post-market review</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              rows={7}
              placeholder={"What worked? What didn't?\nLesson for tomorrow:"}
              value={postmarket}
              onChange={(e) => setPostmarket(e.target.value)}
            />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <div className="space-y-1">
          <Label>Mood</Label>
          <div className="flex gap-1">
            {MOODS.map((m, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setMood(mood === i + 1 ? null : i + 1)}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-transform",
                  mood === i + 1 ? "border-accent bg-accent/15 scale-110" : "opacity-50 hover:opacity-100"
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label>Followed my plan?</Label>
          <div className="flex h-9 items-center">
            <Switch checked={followed === true} onCheckedChange={(c) => setFollowed(c)} />
          </div>
        </div>
        <Button className="ml-auto" onClick={handleSave} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save journal"}
        </Button>
      </div>

      {dayTrades.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Trades this day ({dayTrades.length})</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {dayTrades.map((t) => (
              <Link
                key={t.id}
                href={`/app/trades/${t.id}`}
                className="flex items-center justify-between py-2 text-sm hover:bg-surface-2 -mx-2 px-2 rounded"
              >
                <span>
                  {describeInstrument(t)}{" "}
                  <span className="text-xs text-muted">· {t.direction} · {t.qty} qty</span>
                </span>
                {t.status === "closed" ? <PnlText value={t.net_pnl} /> : <Badge variant="warning">open</Badge>}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
