import { useMemo, useState, type ReactNode } from "react";
import {
  CanvasWorkbenchViewedChangesContext,
  type CanvasWorkbenchViewedChangesValue,
} from "./CanvasWorkbenchViewedChangesContext";

export function CanvasWorkbenchViewedChangesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [viewedChangeIds, setViewedChangeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const value = useMemo<CanvasWorkbenchViewedChangesValue>(
    () => ({
      viewedChangeIds,
      toggleViewedChange: (changeId: string) => {
        setViewedChangeIds((current) => {
          const next = new Set(current);
          if (next.has(changeId)) next.delete(changeId);
          else next.add(changeId);
          return next;
        });
      },
    }),
    [viewedChangeIds],
  );
  return (
    <CanvasWorkbenchViewedChangesContext.Provider value={value}>
      {children}
    </CanvasWorkbenchViewedChangesContext.Provider>
  );
}
