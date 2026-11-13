import { createContext, useContext } from "react";

export interface CanvasWorkbenchViewedChangesValue {
  viewedChangeIds: Set<string>;
  toggleViewedChange: (changeId: string) => void;
}

const noop = () => undefined;

export const CanvasWorkbenchViewedChangesContext =
  createContext<CanvasWorkbenchViewedChangesValue>({
    viewedChangeIds: new Set(),
    toggleViewedChange: noop,
  });

export function useCanvasWorkbenchViewedChanges() {
  return useContext(CanvasWorkbenchViewedChangesContext);
}
