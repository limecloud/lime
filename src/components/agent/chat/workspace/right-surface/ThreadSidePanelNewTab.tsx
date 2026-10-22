import { useRef } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, MessageSquare, Shapes } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThreadSidePanelRecents } from "./ThreadSidePanelRecents";
import type { ThreadOutput } from "./threadOutputs";
import { useRightSurfaceTab } from "./rightSurfaceTabContext";
import { useWorkspaceBrowserNavigation } from "./browser/workspaceBrowserNavigationContext";
import { BrowserNewTabAddress } from "./browser/BrowserNewTabAddress";
import styles from "./ThreadSidePanelNewTab.module.css";
import {
  projectNewTabTools,
  type ThreadSidePanelAction,
} from "./threadSidePanelActions";

export interface ThreadSidePanelNewTabProps {
  actions: readonly ThreadSidePanelAction[];
  onActionSelect: (action: ThreadSidePanelAction) => void;
  onChatSelect?: () => void;
  outputs?: readonly ThreadOutput[];
  onOpenOutput?: Parameters<typeof ThreadSidePanelRecents>[0]["onOpen"];
}

const rowClass =
  "flex min-h-10 w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[color:var(--lime-text)] outline-none hover:bg-[color:var(--lime-chrome-tab-hover)] focus-visible:bg-[color:var(--lime-chrome-tab-hover)]";
const menuClass =
  "z-50 min-w-56 rounded-xl border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-1 shadow-lg";

export function ThreadSidePanelNewTab({
  actions,
  onActionSelect,
  onChatSelect,
  outputs = [],
  onOpenOutput,
}: ThreadSidePanelNewTabProps) {
  const { t } = useTranslation("agent");
  const pending = useRef<ThreadSidePanelAction | null>(null);
  const presentation = useRightSurfaceTab();
  const browserNavigation = useWorkspaceBrowserNavigation();
  const { primary, overflow, extensions } = projectNewTabTools(
    actions,
    Boolean(onChatSelect),
  );
  const item = (action: ThreadSidePanelAction) => (
    <DropdownMenu.Item
      key={action.id}
      className={rowClass}
      onSelect={() => {
        if (action.deferSelectionUntilDropdownClose) pending.current = action;
        else onActionSelect(action);
      }}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {action.icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{action.title}</span>
      {action.keyboardShortcut ? (
        <kbd className="shrink-0 text-xs text-[color:var(--lime-text-muted)]">
          {action.keyboardShortcut}
        </kbd>
      ) : null}
    </DropdownMenu.Item>
  );
  return (
    <div
      className={`${styles.root} flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-[color:var(--lime-surface)] px-4 py-8 select-none`}
      data-new-tab-scroll-root
      data-testid="thread-side-panel-new-tab"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        {browserNavigation && presentation ? (
          <BrowserNewTabAddress
            key={presentation.tab.tabId}
            sourceTabId={presentation.tab.tabId}
            active={presentation.active}
            onOpenAddress={browserNavigation.openAddress}
            translate={t}
          />
        ) : null}
        {!actions.length && !onChatSelect && !outputs.length ? (
          <p className="rounded-lg border border-[color:var(--lime-surface-border)] p-3 text-sm text-[color:var(--lime-text-muted)]">
            {t("agentChat.rightSurface.newTab.empty")}
          </p>
        ) : (
          <section className="flex flex-col gap-4">
            <h3 className="text-sm font-medium text-[color:var(--lime-text)]">
              {t("agentChat.rightSurface.newTab.tools")}
            </h3>
            <div className={`${styles.tools} grid gap-x-4 gap-y-1`}>
              {onChatSelect ? (
                <button
                  className={rowClass}
                  onClick={onChatSelect}
                  data-testid="side-panel-new-tab-chat"
                >
                  <MessageSquare size={16} aria-hidden="true" />
                  {t("agentChat.rightSurface.newTab.chat")}
                </button>
              ) : null}
              {primary.map((action) => (
                <button
                  key={action.id}
                  className={rowClass}
                  onClick={() => onActionSelect(action)}
                  data-testid={`side-panel-new-tab-${action.id}`}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {action.icon}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {action.title}
                  </span>
                  {action.keyboardShortcut ? (
                    <kbd className="text-xs text-[color:var(--lime-text-muted)]">
                      {action.keyboardShortcut}
                    </kbd>
                  ) : null}
                </button>
              ))}
              {overflow.length || extensions.length ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger className={rowClass}>
                    <Shapes size={16} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      {t("agentChat.rightSurface.newTab.moreTools")}
                    </span>
                    <ChevronDown size={12} />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className={menuClass}
                      align="end"
                      onCloseAutoFocus={(event) => {
                        const action = pending.current;
                        pending.current = null;
                        if (action) {
                          event.preventDefault();
                          onActionSelect(action);
                        }
                      }}
                    >
                      {overflow.length ? (
                        <>
                          <DropdownMenu.Label className="px-3 py-2 text-xs text-[color:var(--lime-text-muted)]">
                            {t(
                              "agentChat.rightSurface.newTab.moreToolsHeading",
                            )}
                          </DropdownMenu.Label>
                          {overflow.map(item)}
                        </>
                      ) : null}
                      {overflow.length && extensions.length ? (
                        <DropdownMenu.Separator className="my-1 h-px bg-[color:var(--lime-surface-border)]" />
                      ) : null}
                      {extensions.length ? (
                        <>
                          <DropdownMenu.Label className="px-3 py-2 text-xs text-[color:var(--lime-text-muted)]">
                            {t("agentChat.rightSurface.newTab.plugins")}
                          </DropdownMenu.Label>
                          {extensions.map(item)}
                        </>
                      ) : null}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : null}
            </div>
          </section>
        )}
        {onOpenOutput && outputs.length ? (
          <ThreadSidePanelRecents outputs={outputs} onOpen={onOpenOutput} />
        ) : null}
      </div>
    </div>
  );
}
