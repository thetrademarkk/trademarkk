"use client";

import * as React from "react";
import { Flag, LayoutDashboard, MessageSquareWarning, Newspaper } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminOverview, useModQueue } from "./use-admin-overview";
import { OverviewSection } from "./overview-section";
import { SubmissionsSection } from "./submissions-section";
import { FeedbackSection } from "./feedback-section";
import { ReportsSection } from "./reports-section";

type SectionId = "overview" | "moderation" | "blog" | "feedback";

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; description: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, description: "Platform analytics" },
  { id: "moderation", label: "Moderation", icon: Flag, description: "Reported content" },
  { id: "blog", label: "Blog review", icon: Newspaper, description: "Community submissions" },
  {
    id: "feedback",
    label: "Feedback",
    icon: MessageSquareWarning,
    description: "Bug reports & ideas",
  },
];

/**
 * Admin shell: persistent sidebar (rail on mobile) + section panes. Queue
 * counts surface on the nav itself so pending work is visible from anywhere.
 */
export function AdminShell() {
  const [section, setSection] = React.useState<SectionId>("overview");
  const { data: overview } = useAdminOverview();
  // The nav badge shows the count of OPEN moderation items (reports + flags).
  const { data: modData } = useModQueue({ source: "all", status: "open", sort: "newest", page: 1 });

  const counts: Partial<Record<SectionId, number>> = {
    moderation: modData ? modData.openCounts.reports + modData.openCounts.flags : undefined,
    blog: overview?.stats.blogPending,
  };
  const active = SECTIONS.find((s) => s.id === section)!;

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      {/* ── Nav: sidebar on md+, horizontal scroll rail on mobile ── */}
      <nav
        aria-label="Admin sections"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 md:m-0 md:w-52 md:shrink-0 md:flex-col md:overflow-visible md:p-0"
      >
        {SECTIONS.map((s) => {
          const isActive = s.id === section;
          const count = counts[s.id];
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex shrink-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                isActive
                  ? "bg-accent/12 font-medium text-accent"
                  : "text-muted hover:bg-surface-2/60 hover:text-foreground"
              )}
            >
              <s.icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{s.label}</span>
              {typeof count === "number" && count > 0 && (
                <span
                  className={cn(
                    "ml-auto rounded-full px-1.5 py-0.5 font-money text-[11px] leading-none",
                    isActive ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Active pane ── */}
      <main className="min-w-0 flex-1">
        <div className="mb-5">
          <h1 className="text-lg font-bold md:text-xl">{active.label}</h1>
          <p className="mt-0.5 text-sm text-muted">{active.description}</p>
        </div>
        {section === "overview" && <OverviewSection />}
        {section === "moderation" && <ReportsSection />}
        {section === "blog" && <SubmissionsSection />}
        {section === "feedback" && <FeedbackSection />}
      </main>
    </div>
  );
}
