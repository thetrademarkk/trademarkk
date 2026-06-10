"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  heading: string;
}

/** MDN-style "On this page" — scroll-spy highlights the section in view. */
export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = React.useState<string | null>(items[0]?.id ?? null);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      // Trigger when a heading enters the top third of the viewport.
      { rootMargin: "-10% 0px -70% 0px" }
    );
    for (const item of items) {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [items]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  return (
    <nav aria-label="On this page">
      <p className="micro-label mb-3">On this page</p>
      <ul className="space-y-0.5 border-l">
        {items.map((item) => (
          <li key={item.id}>
            <button
              onClick={() => scrollTo(item.id)}
              className={cn(
                "-ml-px block w-full border-l-2 py-1 pl-3 text-left text-[13px] leading-5 transition-colors",
                active === item.id
                  ? "border-accent text-accent font-medium"
                  : "border-transparent text-muted hover:text-foreground"
              )}
            >
              {item.heading}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
