import { Check, Minus, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { todayKey } from "@/lib/utils";
import { openAppTab } from "../lib/app-api";
import { useRuleChecks, useRules, useSetRuleCheck, type RuleStatus } from "../lib/journal";

const STATUSES: { value: RuleStatus; icon: LucideIcon; label: string }[] = [
  { value: "followed", icon: Check, label: "Followed" },
  { value: "broken", icon: X, label: "Broken" },
  { value: "na", icon: Minus, label: "Not applicable" },
];

/** Today's discipline checklist — the same rows the web dashboard reads. */
export function RulesCard({ appUrl }: { appUrl: string }) {
  const date = todayKey();
  const { data: rules = [], isLoading } = useRules();
  const { data: checks } = useRuleChecks(date);
  const setCheck = useSetRuleCheck(date);

  if (isLoading) return null;

  if (rules.length === 0) {
    return (
      <section className="card">
        <h2 className="card-title">Today&apos;s rules</h2>
        <p className="note">
          No rules yet. Define your trading rules in the web app and tick them off here every day.{" "}
          <button type="button" className="link" onClick={() => openAppTab(appUrl, "/app/rules")}>
            Set up rules
          </button>
        </p>
      </section>
    );
  }

  const followedCount = rules.filter((r) => checks?.get(r.id) === "followed").length;

  return (
    <section className="card">
      <h2 className="card-title">
        Today&apos;s rules
        <span className="meta">
          {followedCount}/{rules.length} followed
        </span>
      </h2>
      <div>
        {rules.map((rule) => {
          const current = checks?.get(rule.id);
          return (
            <div key={rule.id} className="rule-row">
              <span className={`rule-text${current === "broken" ? " broken" : ""}`}>
                {rule.text}
              </span>
              <div className="rule-actions">
                {STATUSES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    title={s.label}
                    aria-label={`${s.label}: ${rule.text}`}
                    aria-pressed={current === s.value}
                    className={`rule-btn${current === s.value ? ` on-${s.value}` : ""}`}
                    onClick={() => setCheck.mutate({ ruleId: rule.id, status: s.value })}
                  >
                    <s.icon size={13} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
