"use client";

import { Check, Minus, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useRuleChecks, useRules, useSetRuleCheck, type RuleCheck } from "../queries";

const STATUSES: { value: RuleCheck["status"]; icon: typeof Check; activeClass: string }[] = [
  { value: "followed", icon: Check, activeClass: "bg-profit/20 text-profit border-profit" },
  { value: "broken", icon: X, activeClass: "bg-loss/20 text-loss border-loss" },
  { value: "na", icon: Minus, activeClass: "bg-surface-2 text-muted border-border" },
];

/** Tick off your rules for a given day — shown on Dashboard and Rules screens. */
export function DailyChecklist({ date, compact = false }: { date: string; compact?: boolean }) {
  const { data: rules = [] } = useRules();
  const { data: checks = [] } = useRuleChecks(date);
  const setCheck = useSetRuleCheck();

  if (rules.length === 0) return null;
  const statusFor = (ruleId: string) => checks.find((c) => c.rule_id === ruleId)?.status;
  const followedCount = checks.filter((c) => c.status === "followed").length;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Today&apos;s rules</CardTitle>
        <span className="text-xs text-muted">
          {followedCount}/{rules.length} followed
        </span>
      </CardHeader>
      <CardContent className={cn("space-y-1", compact && "max-h-56 overflow-y-auto")}>
        {rules.map((rule) => {
          const current = statusFor(rule.id);
          return (
            <div key={rule.id} className="flex items-center justify-between gap-2 py-1">
              <span className={cn("text-sm", current === "broken" && "text-loss")}>{rule.text}</span>
              <div className="flex gap-1 shrink-0">
                {STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    title={s.value}
                    onClick={() => setCheck.mutate({ date, ruleId: rule.id, status: s.value })}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                      current === s.value ? s.activeClass : "border-border text-muted/50 hover:text-muted"
                    )}
                  >
                    <s.icon className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
