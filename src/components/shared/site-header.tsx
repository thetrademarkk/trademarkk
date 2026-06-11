import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "./logo";
import { NavLinks } from "./nav-links";
import { siteConfig } from "@/config/site";

/** One header for all public surfaces (marketing + community) — same nav, same chrome. */
export function SiteHeader({ cta }: { cta: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
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
