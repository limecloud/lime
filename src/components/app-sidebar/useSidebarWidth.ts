import { useState } from "react";
import {
  APP_SIDEBAR_WIDTH,
  APP_SIDEBAR_MAX_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from "./AppSidebar.constants";

export function useSidebarWidth(
  minimumWidth = 240,
  defaultWidth = APP_SIDEBAR_WIDTH,
) {
  const [width, setWidth] = useState(() => {
    const stored = Number(
      window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY),
    );
    return Number.isFinite(stored) && stored > 0
      ? Math.max(minimumWidth, Math.min(stored, APP_SIDEBAR_MAX_WIDTH))
      : Math.max(minimumWidth, defaultWidth);
  });
  return { width, setWidth };
}
