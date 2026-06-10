import {
  BarChart3,
  BookOpenText,
  CalendarDays,
  FileText,
  Layers,
  LayoutDashboard,
  NotebookPen,
  Settings,
  ShieldCheck,
} from "lucide-react";

export const NAV_ITEMS = [
  { href: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app/trades", label: "Trades", icon: BookOpenText },
  { href: "/app/journal", label: "Journal", icon: NotebookPen },
  { href: "/app/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/app/rules", label: "Rules & Mistakes", icon: ShieldCheck },
  { href: "/app/playbooks", label: "Playbooks", icon: Layers },
  { href: "/app/reports", label: "Reports", icon: FileText },
  { href: "/app/settings", label: "Settings", icon: Settings },
] as const;

/** Bottom tab bar on mobile: 4 primary destinations (+ floating quick-add). */
export const MOBILE_TABS = [
  { href: "/app/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/app/trades", label: "Trades", icon: BookOpenText },
  { href: "/app/journal", label: "Journal", icon: NotebookPen },
  { href: "/app/analytics", label: "Stats", icon: BarChart3 },
] as const;
