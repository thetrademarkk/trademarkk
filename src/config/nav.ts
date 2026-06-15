import {
  BarChart3,
  BookOpenText,
  CalendarDays,
  FileText,
  FlaskConical,
  Layers,
  LayoutDashboard,
  Lightbulb,
  NotebookPen,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Opens in a new tab (e.g. Community — a separate surface from the journal). */
  newTab?: boolean;
}

export interface NavSection {
  /** Uppercase group label shown in the sidebar (hidden when collapsed). */
  label: string;
  items: NavItem[];
}

/**
 * Sidebar nav, grouped into the three universes the journal spans. This is the
 * single source of truth — `NAV_ITEMS` (the flat list consumed by the command
 * palette and elsewhere) is derived from it so order can never drift.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Journal",
    items: [
      { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/app/trades", label: "Trades", icon: BookOpenText },
      { href: "/app/journal", label: "Journal", icon: NotebookPen },
      { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
    ],
  },
  {
    label: "Analyze",
    items: [
      { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/app/insights", label: "Insights", icon: Lightbulb },
      { href: "/app/rules", label: "Rules & Mistakes", icon: ShieldCheck },
      { href: "/app/playbooks", label: "Playbooks", icon: Layers },
      { href: "/app/reports", label: "Reports", icon: FileText },
    ],
  },
  {
    label: "Explore",
    items: [
      { href: "/backtesting", label: "Backtesting", icon: FlaskConical, newTab: true },
      { href: "/community", label: "Community", icon: Users, newTab: true },
      { href: "/app/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((s) => s.items);

/** Bottom tab bar on mobile: primary destinations (+ centered quick-add FAB). */
export const MOBILE_TABS: NavItem[] = [
  { href: "/app/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/app/trades", label: "Trades", icon: BookOpenText },
  { href: "/app/journal", label: "Journal", icon: NotebookPen },
];
