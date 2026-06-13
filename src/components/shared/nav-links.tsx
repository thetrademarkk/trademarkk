"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/community", label: "Community" },
  { href: "/pulse", label: "Pulse" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
];

/** Site nav with active state — shared by the marketing and community headers. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="hidden gap-1 text-sm md:flex" aria-label="Site">
      {NAV.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 transition-colors",
              active ? "bg-accent/12 font-medium text-accent" : "text-muted hover:text-foreground"
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
