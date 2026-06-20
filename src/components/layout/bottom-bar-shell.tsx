import * as React from "react";

/**
 * Shared mobile bottom-bar chrome — the consistency contract between the
 * journal {@link BottomNav} and the {@link CommunityBottomNav}. Both share the
 * exact same surface, border, safe-area inset, z-index and `md:hidden`
 * breakpoint so the two surfaces never visually drift. Tab contents differ;
 * the shell does not. `fixed` establishes the containing block for any
 * absolutely-positioned child (e.g. the journal's centered FAB).
 */
export function BottomBarShell({
  children,
  label = "Primary",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t bg-surface/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {children}
    </nav>
  );
}
