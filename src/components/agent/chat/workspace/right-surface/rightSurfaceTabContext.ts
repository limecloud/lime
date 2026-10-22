import { createContext, useContext } from "react";
import type { ThreadSidePanelTab } from "./threadSidePanelTabs";

export const RightSurfaceTabContext = createContext<{
  tab: ThreadSidePanelTab;
  active: boolean;
} | null>(null);

export const useRightSurfaceTab = () => useContext(RightSurfaceTabContext);
