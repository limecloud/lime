import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useTranslation } from "react-i18next";
import type { ThreadSummaryPanelState } from "./useThreadSummaryPanel";


function SummaryPanelIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.89062 8.81738C5.28506 8.81738 6.41588 9.94837 6.41602 11.3428C6.41602 12.7373 5.28514 13.8682 3.89062 13.8682C2.49611 13.8682 1.36523 12.7373 1.36523 11.3428C1.36537 9.94837 2.49619 8.81738 3.89062 8.81738ZM3.89062 9.86816C3.07609 9.86816 2.41615 10.5283 2.41602 11.3428C2.41602 12.1574 3.076 12.8174 3.89062 12.8174C4.70525 12.8174 5.36523 12.1574 5.36523 11.3428C5.3651 10.5283 4.70516 9.86816 3.89062 9.86816Z"
        fill="currentColor"
      />
      <path
        d="M14 10.8174C14.2898 10.8174 14.5253 11.053 14.5254 11.3428C14.5254 11.6327 14.2899 11.8681 14 11.8682H8.66699C8.37704 11.8682 8.1416 11.6327 8.1416 11.3428C8.14173 11.0529 8.37712 10.8174 8.66699 10.8174H14Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.89062 2.13965C5.28514 2.13965 6.41602 3.27052 6.41602 4.66504C6.41602 6.05956 5.28514 7.19043 3.89062 7.19043C2.49611 7.19043 1.36523 6.05956 1.36523 4.66504C1.36523 3.27052 2.49611 2.13965 3.89062 2.13965ZM3.89062 3.19043C3.076 3.19043 2.41602 3.85042 2.41602 4.66504C2.41602 5.47966 3.076 6.13965 3.89062 6.13965C4.70525 6.13965 5.36523 5.47966 5.36523 4.66504C5.36523 3.85042 4.70525 3.19043 3.89062 3.19043Z"
        fill="currentColor"
      />
      <path
        d="M14 4.13965C14.2899 4.13971 14.5254 4.37513 14.5254 4.66504C14.5254 4.95495 14.2899 5.19036 14 5.19043H8.66699C8.37704 5.19043 8.1416 4.95499 8.1416 4.66504C8.1416 4.37509 8.37704 4.13965 8.66699 4.13965H14Z"
        fill="currentColor"
      />
    </svg>
  );
}

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
          <SummaryPanelIcon />
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
