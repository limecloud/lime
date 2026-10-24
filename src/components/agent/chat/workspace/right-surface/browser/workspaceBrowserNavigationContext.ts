import { createContext, useContext } from "react";

export const WorkspaceBrowserNavigationContext = createContext<{
  openAddress: (sourceTabId: string, url: string) => Promise<void>;
  setAddressDraft: (sourceTabId: string, value: string) => void;
} | null>(null);

export const useWorkspaceBrowserNavigation = () =>
  useContext(WorkspaceBrowserNavigationContext);
