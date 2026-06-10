"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { THEMES } from "@/providers/theme-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const [colorBlind, setColorBlind] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setColorBlind(localStorage.getItem("tm.pl-cb") === "1");
  }, []);

  const toggleColorBlind = (on: boolean) => {
    setColorBlind(on);
    localStorage.setItem("tm.pl-cb", on ? "1" : "0");
    document.documentElement.dataset.pl = on ? "cb" : "";
  };

  if (!mounted) return null;

  return (
    <Card>
      <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Theme</Label>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors",
                  theme === t.id ? "border-accent ring-1 ring-accent" : "hover:bg-surface-2"
                )}
              >
                <span
                  className="mb-2 block h-6 rounded border"
                  style={{
                    background:
                      t.id === "light" ? "#fafafa" : t.id === "midnight" ? "#0b1220" : t.id === "oled" ? "#000" : "#0a0a0b",
                  }}
                />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label>Color-blind-safe P&L</Label>
            <p className="text-xs text-muted">Blue for profit, orange for loss</p>
          </div>
          <Switch checked={colorBlind} onCheckedChange={toggleColorBlind} />
        </div>
      </CardContent>
    </Card>
  );
}
