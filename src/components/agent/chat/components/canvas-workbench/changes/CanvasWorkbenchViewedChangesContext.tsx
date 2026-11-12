import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface CanvasWorkbenchViewedChangesValue {
  viewedChangeIds: Set<string>;
  toggleViewedChange: (changeId: string) => void;
}

const noop = () => undefined;

const CanvasWorkbenchViewedChangesContext =
  createContext<CanvasWorkbenchViewedChangesValue>({
    viewedChangeIds: new Set(),
    toggleViewedChange: noop,
  });

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

export function useCanvasWorkbenchViewedChanges() {
  return useContext(CanvasWorkbenchViewedChangesContext);
}
