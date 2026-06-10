"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Check, SunMoon } from "lucide-react";
import { THEMES } from "@/providers/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Compact theme picker for the marketing header. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Change theme">
          <SunMoon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.id} onClick={() => setTheme(t.id)}>
            <span
              className="h-3.5 w-3.5 rounded-full border"
              style={{
                background:
                  t.id === "light" ? "#fafafa" : t.id === "midnight" ? "#0b1220" : t.id === "oled" ? "#000" : "#1b1b1f",
              }}
            />
            {t.label}
            {mounted && theme === t.id && <Check className="ml-auto h-3.5 w-3.5 text-accent" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
