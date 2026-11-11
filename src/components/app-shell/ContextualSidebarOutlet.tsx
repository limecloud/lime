import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  getContextualSidebarState,
  mountContextualSidebarOutlet,
  subscribeContextualSidebar,
  unmountContextualSidebarOutlet,
} from "./contextualSidebarStore";

export function ContextualSidebarOutlet({
  page,
  fallback = null,
}: {
  page: string;
  fallback?: ReactNode;
}) {
  const current = useSyncExternalStore(
    subscribeContextualSidebar,
    getContextualSidebarState,
    getContextualSidebarState,
  );

  useEffect(() => {
    mountContextualSidebarOutlet();
    return unmountContextualSidebarOutlet;
  }, []);

  if (current.owner !== page || !current.node) {
    return <>{fallback}</>;
  }
  return <>{current.node}</>;
}
