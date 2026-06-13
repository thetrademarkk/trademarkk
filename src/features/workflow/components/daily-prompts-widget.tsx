"use client";

import { ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PROMPT_FIELDS, type DailyPrompts } from "../daily-prompts";

/**
 * Structured daily-journal prompts widget. Controlled: the JournalEditor owns
 * the {@link DailyPrompts} state and serializes them into the journal entry's
 * postmarket_review on save (reusing the existing journal storage — no schema
 * change). Answer the four questions to make the daily review a habit.
 */
export function DailyPromptsWidget({
  value,
  onChange,
}: {
  value: DailyPrompts;
  onChange: (next: DailyPrompts) => void;
}) {
  return (
    <Card data-testid="daily-prompts">
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <ListChecks className="h-4 w-4 text-muted" aria-hidden /> Daily review prompts
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {PROMPT_FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`prompt-${f.key}`}>{f.label}</Label>
            <Textarea
              id={`prompt-${f.key}`}
              rows={3}
              placeholder={f.placeholder}
              value={value[f.key]}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
