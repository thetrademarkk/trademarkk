"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export const THEMES = [
  { id: "carbon", label: "Carbon", dark: true },
  { id: "midnight", label: "Midnight", dark: true },
  { id: "oled", label: "OLED Black", dark: true },
  { id: "light", label: "Light", dark: false },
] as const;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      themes={THEMES.map((t) => t.id)}
      defaultTheme="oled"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
