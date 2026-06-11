"use client";

import * as React from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useDeleteRule, useRules, useSaveRule } from "../queries";

const CATEGORIES = ["risk", "entry", "exit", "discipline"];

export function RulesManager() {
  const { data: rules = [] } = useRules(true);
  const saveRule = useSaveRule();
  const deleteRule = useDeleteRule();
  const [text, setText] = React.useState("");
  const [category, setCategory] = React.useState("discipline");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editText, setEditText] = React.useState("");

  const add = async () => {
    if (!text.trim()) return;
    await saveRule.mutateAsync({ text: text.trim(), category });
    setText("");
  };

  const startEdit = (id: string, current: string) => {
    setEditingId(id);
    setEditText(current);
  };

  const commitEdit = async (rule: { id: string; category: string; active: number }) => {
    if (!editText.trim()) return;
    await saveRule.mutateAsync({
      id: rule.id,
      text: editText.trim(),
      category: rule.category,
      active: rule.active === 1,
    });
    setEditingId(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your trading rules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Input
            className="flex-1 min-w-[200px]"
            placeholder='e.g. "No trades after 2:30 PM"'
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={add} disabled={saveRule.isPending}>
            <Plus /> Add
          </Button>
        </div>

        <div className="divide-y">
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-2 py-2">
              <Badge variant="outline" className="capitalize w-20 justify-center shrink-0">
                {rule.category}
              </Badge>
              {editingId === rule.id ? (
                <>
                  <Input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEdit(rule);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                    aria-label="Edit rule text"
                    className="h-8"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Save rule"
                    onClick={() => void commitEdit(rule)}
                  >
                    <Check className="h-4 w-4 text-profit" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel edit"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <span className={rule.active ? "text-sm" : "text-sm text-muted line-through"}>
                    {rule.text}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Edit rule"
                      className="text-muted hover:text-foreground"
                      onClick={() => startEdit(rule.id, rule.text)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete rule"
                      className="text-muted hover:text-loss"
                      onClick={() =>
                        confirm("Delete rule and its history?") && deleteRule.mutate(rule.id)
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Switch
                      checked={rule.active === 1}
                      aria-label="Rule active"
                      onCheckedChange={(active) =>
                        saveRule.mutate({
                          id: rule.id,
                          text: rule.text,
                          category: rule.category,
                          active,
                        })
                      }
                    />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
