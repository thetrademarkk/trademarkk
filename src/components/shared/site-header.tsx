"use client";

import * as React from "react";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

/**
 * One header for all public surfaces (marketing + community) — same nav, same
 * chrome. Sticky with backdrop blur; gains a border + slightly more opaque
 * background once the page is scrolled.
 */
export function SiteHeader({ cta }: { cta: React.ReactNode }) {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        "sticky top-0 z-40 border-b backdrop-blur transition-[background-color,border-color,box-shadow] duration-300",
        scrolled ? "border-border bg-bg/85 shadow-sm" : "border-transparent bg-bg/60"
      )}
    >
      {/* max-w-5xl matches every public page container — header and content align. */}
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
        <Logo />
        <NavLinks />
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <Button variant="ghost" size="icon" asChild>
            <a href={siteConfig.github} target="_blank" rel="noreferrer" aria-label="GitHub">
              <Github className="h-4 w-4" />
            </a>
          </Button>
          {cta}
        </div>
      </div>
    </header>
  );
}
