import { createContext, useContext } from "react";

export const SidePanelActiveContext = createContext(true);
export const useSidePanelTabActive = () => useContext(SidePanelActiveContext);

export const SidePanelActivationContext = createContext<(() => void) | null>(
  null,
);
export const useSidePanelActivation = () =>
  useContext(SidePanelActivationContext);

export const UnifiedToolbarContext = createContext<{
  mode: "full" | "split";
  isVisible: boolean;
  tabStripActions: HTMLElement | null;
} | null>(null);

export const useUnifiedToolbar = () => useContext(UnifiedToolbarContext);
