import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  SidePanelActiveContext,
  UnifiedToolbarContext,
} from "./unifiedTabStripContext";

export interface UnifiedTabStripEntry {
  mode: "full" | "split";
  isVisible: boolean;
  desktopPlacement?: string;
  mainTabId: string;
  mainTabPanelId: string;
  mainToolbar?: ReactNode;
  sidePanelTabStrip?: ReactNode;
  sidePanelActive?: boolean;
  node?: ReactNode;
  onContentTabDoubleClick?: (tabId: string) => void;
  // 既有布局 owner 测得的分界坐标，只用于共享标题栏对齐。
  mainPaneEnd?: number;
  inlineMainToolbar?: boolean;
}

export function UnifiedTabStripRenderer({
  entry,
}: {
  entry: UnifiedTabStripEntry;
}) {
  const [tabStripActions, setTabStripActions] = useState<HTMLDivElement | null>(
    null,
  );
  const toolbar = useMemo(
    () => ({
      mode: entry.mode,
      isVisible: entry.isVisible,
      tabStripActions,
    }),
    [entry.mode, entry.isVisible, tabStripActions],
  );
  return (
    <UnifiedToolbarContext.Provider value={toolbar}>
      <div
        data-app-shell-unified-tab-strip={entry.isVisible ? "" : undefined}
        data-main-tab-id={entry.mainTabId}
        data-mode={entry.mode}
        className="pointer-events-auto flex h-full min-w-0 flex-1 items-center"
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        onDoubleClick={(event) => {
          const tab = (event.target as Element).closest('[role="tab"]');
          if (tab && event.currentTarget.contains(tab)) {
            entry.onContentTabDoubleClick?.(tab.id);
          }
        }}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement;
          const tablist = target.closest('[role="tablist"]');
          if (
            target.getAttribute("role") === "tab" &&
            tablist &&
            ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
          ) {
            const tabs = Array.from(
              tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
            );
            const index = tabs.indexOf(target as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? tabs[0]
                : event.key === "End"
                  ? tabs.at(-1)
                  : tabs[
                      (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                        tabs.length
                    ];
            event.preventDefault();
            next?.click();
            next?.focus();
            return;
          }
        }}
      >
        {entry.inlineMainToolbar ? null : (
          <div
            className="h-full min-w-0"
            style={{
              width:
                entry.isVisible && entry.mode === "split"
                  ? `max(0px, calc(${entry.mainPaneEnd ?? 0}px - var(--app-shell-main-titlebar-left, 0px)))`
                  : undefined,
              flex: entry.isVisible ? "0 0 auto" : "1 1 auto",
              order: entry.mode === "full" ? 1 : 0,
            }}
          >
            {entry.mainToolbar}
          </div>
        )}
        <div
          className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          role="tablist"
          style={{ display: entry.isVisible ? undefined : "none" }}
        >
          {entry.inlineMainToolbar ? (
            <div className="flex h-full min-w-0 flex-1 items-center">
              {entry.mainToolbar}
            </div>
          ) : null}
          {entry.node}
          <div
            ref={setTabStripActions}
            className="flex h-full min-w-0 items-center"
          />
          <SidePanelActiveContext.Provider
            value={entry.sidePanelActive ?? true}
          >
            {entry.sidePanelTabStrip}
          </SidePanelActiveContext.Provider>
        </div>
      </div>
    </UnifiedToolbarContext.Provider>
  );
}
