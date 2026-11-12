import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ThreadSummaryPanelState } from "./useThreadSummaryPanel";

export function ThreadSummaryLayout({
  state,
  panel,
  children,
}: {
  state: ThreadSummaryPanelState;
  panel: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      ref={state.mainContentRef}
      className="relative h-full min-h-0 min-w-0 overflow-hidden"
      data-testid="thread-summary-layout"
      data-summary-mode={state.displayMode}
    >
      <div
        className="h-full min-h-0"
        style={{ transform: `translateX(${state.contentShift}px)` }}
      >
        {children}
      </div>
      {state.isInline ? (
        <aside
          id={state.panelId}
          className="absolute bottom-2 right-2 top-2.5 flex w-[300px] min-h-0 flex-col"
          data-testid="thread-summary-inline"
        >
          {panel}
        </aside>
      ) : null}
    </div>
  );
}

export function ThreadSummaryToggle({
  state,
  panel,
}: {
  state: ThreadSummaryPanelState;
  panel: ReactNode;
}) {
  const { t } = useTranslation("agent");
  const label = String(
    t(
      state.isOverlay
        ? "agentChat.summary.toggle"
        : "agentChat.summary.togglePinned",
    ),
  );
  return (
    <Popover.Root open={state.isPopoverOpen} onOpenChange={state.onOpenChange}>
      <Popover.Anchor
        virtualRef={{
          current: {
            getBoundingClientRect() {
              const trigger = document.querySelector(
                `[data-summary-trigger-id="${state.panelId}"]`,
              );
              const toolbar =
                trigger?.closest("[data-app-shell-main-titlebar]") ??
                trigger?.closest(
                  "[data-app-shell-header-toolbar], [data-app-shell-titlebar]",
                ) ??
                trigger;
              const header = toolbar?.getBoundingClientRect() ?? new DOMRect();
              const main = state.mainContent?.getBoundingClientRect();
              if (!main) return header;
              const left = Math.max(header.left, main.left);
              return new DOMRect(
                left,
                header.top,
                Math.max(0, Math.min(header.right, main.right) - left),
                header.height,
              );
            },
          },
        }}
      />
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[color:var(--lime-chrome-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={label}
          title={label}
          aria-controls={state.panelId}
          aria-pressed={state.isOpen}
          disabled={!state.isOverlay && state.pinDisabled}
          data-testid="thread-workspace-summary-toggle"
          data-summary-trigger-id={state.panelId}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          id={state.panelId}
          align="end"
          alignOffset={8}
          sideOffset={8}
          collisionPadding={8}
          className="z-50 flex w-[300px] max-w-[calc(100vw-16px)] flex-col outline-none"
          style={{
            maxHeight:
              "min(var(--radix-popover-content-available-height), calc(100vh - 16px))",
          }}
          data-testid="thread-summary-popover"
          onPointerDownOutside={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest(
                '[data-app-shell-tab-strip-controller="right"]',
              )
            )
              event.preventDefault();
          }}
          onFocusOutside={(event) => {
            if (
              event.target instanceof Element &&
              event.target.matches(
                '[role="tabpanel"][data-app-shell-tab-panel-controller="right"]',
              )
            )
              event.preventDefault();
          }}
        >
          {panel}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
