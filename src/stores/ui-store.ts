import { create } from "zustand";

interface UiState {
  quickAddOpen: boolean;
  commandOpen: boolean;
  sidebarCollapsed: boolean;
  setQuickAddOpen: (open: boolean) => void;
  setCommandOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  quickAddOpen: false,
  commandOpen: false,
  sidebarCollapsed: false,
  setQuickAddOpen: (quickAddOpen) => set({ quickAddOpen }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));
