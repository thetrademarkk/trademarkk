"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { newId } from "@/lib/id";
import { useTags } from "@/features/trades";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagChip } from "@/components/shared/tag-chip";

const COLORS = ["#F87171", "#FB923C", "#FBBF24", "#34D399", "#60A5FA", "#8B5CF6", "#E879F9", "#2DD4BF"];

export function TagsSection() {
  const { db } = useDb();
  const qc = useQueryClient();
  const { data: tags = [] } = useTags();
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<"mistake" | "emotion" | "custom">("mistake");

  const addTag = useMutation({
    mutationFn: async () => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
      await db.execute(`INSERT OR IGNORE INTO tags (id, name, kind, color) VALUES (?, ?, ?, ?)`, [
        newId(), name.trim(), kind, color,
      ]);
    },
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });

  const deleteTag = useMutation({
    mutationFn: async (id: string) => {
      await db.batch([
        { sql: `DELETE FROM trade_tags WHERE tag_id = ?`, args: [id] },
        { sql: `DELETE FROM tags WHERE id = ?`, args: [id] },
      ]);
    },
    onSuccess: () => qc.invalidateQueries(),
  });

  return (
    <Card>
      <CardHeader><CardTitle>Tags</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="New tag…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && addTag.mutate()}
          />
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mistake">Mistake</SelectItem>
              <SelectItem value="emotion">Emotion</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => name.trim() && addTag.mutate()} disabled={addTag.isPending}>
            <Plus />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span key={t.id} className="group inline-flex items-center">
              <TagChip name={t.name} color={t.color} />
              <button
                className="ml-0.5 hidden text-muted hover:text-loss group-hover:inline"
                onClick={() => confirm(`Delete tag "${t.name}"?`) && deleteTag.mutate(t.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
