import { useEffect, useRef, useState } from "react";
import { MessageSquare, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useTranslation } from "react-i18next";
import {
  activateConversationTab,
  closeAllConversationTabs,
  closeConversationTab,
  closeOtherConversationTabs,
  moveConversationTab,
  requestNewConversationTab,
  useConversationTabs,
} from "@/lib/conversationTabs";

export function ConversationTabBar({
  currentSessionId,
  onRename,
  homeActive = false,
}: {
  currentSessionId?: string | null;
  onRename?: () => void;
  homeActive?: boolean;
}) {
  const { t } = useTranslation("navigation");
  const { tabs, activeSessionId } = useConversationTabs();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);

  useEffect(() => {
    if (!activeSessionId) return;
    const activeTab = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-session-id]") ?? [],
    ).find((element) => element.dataset.sessionId === activeSessionId);
    activeTab?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeSessionId]);

  return (
    <div
      ref={listRef}
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      role="tablist"
      aria-label={String(
        t("navigation.sidebar.conversations.tabs.ariaLabel", {
          defaultValue: "打开的聊天",
        }),
      )}
      data-testid="conversation-tab-bar"
    >
      {!currentSessionId ? (
        <div
          role="tab"
          tabIndex={0}
          aria-selected={homeActive}
          className={`group relative flex h-8 min-w-[120px] max-w-[220px] shrink-0 items-center gap-1 rounded-lg border py-0 pl-2 pr-2.5 text-[13px] ${
            homeActive
              ? "border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] font-medium text-[color:var(--lime-text-strong)] shadow-sm"
              : "border-transparent text-[color:var(--lime-text-muted)]"
          }`}
          data-testid="thread-workspace-header-title"
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {String(
              t("navigation.sidebar.conversations.tabs.new", {
                defaultValue: "新聊天",
              }),
            )}
          </span>
        </div>
      ) : null}
      {tabs.map((tab) => {
        const active =
          !homeActive &&
          tab.sessionId ===
            (activeSessionId || currentSessionId);
        return (
          <ContextMenu key={tab.sessionId}>
            <ContextMenuTrigger asChild>
          <div
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/plain", tab.sessionId);
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const dragged = event.dataTransfer.getData("text/plain");
              if (dragged) moveConversationTab(dragged, tab.sessionId);
            }}
            className={`group relative flex h-8 min-w-[120px] max-w-[220px] shrink-0 cursor-grab items-center gap-1 rounded-lg border py-0 pl-2 pr-7 text-[13px] transition-colors active:cursor-grabbing ${
              active
                ? "border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] font-medium text-[color:var(--lime-text-strong)] shadow-sm"
                : "border-transparent text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)]"
            }`}
            data-testid={
              active
                ? "thread-workspace-header-title"
                : "conversation-tab"
            }
            data-session-id={tab.sessionId}
            title={tab.title}
            onClick={() => activateConversationTab(tab.sessionId)}
            onDoubleClick={() => {
              if (active) onRename?.();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                activateConversationTab(tab.sessionId);
                return;
              }
              if (
                event.key === "ArrowLeft" ||
                event.key === "ArrowRight" ||
                event.key === "Home" ||
                event.key === "End"
              ) {
                event.preventDefault();
                const index = tabs.findIndex(
                  (candidate) => candidate.sessionId === tab.sessionId,
                );
                const next =
                  event.key === "Home"
                    ? tabs[0]
                    : event.key === "End"
                      ? tabs[tabs.length - 1]
                      : tabs[
                          (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                            tabs.length
                        ];
                if (next) activateConversationTab(next.sessionId);
              }
            }}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                closeConversationTab(tab.sessionId);
              }
            }}
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-[color:var(--lime-text-muted)]" />
            {active && onRename ? (
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                dir="auto"
                title={tab.title}
                onClick={(event) => {
                  event.stopPropagation();
                  onRename();
                }}
              >
                {tab.title}
              </button>
            ) : (
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {tab.title}
              </span>
            )}
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[color:var(--lime-text-muted)] group-hover:bg-[color:var(--lime-surface-subtle)] hover:text-[color:var(--lime-text-strong)]"
              aria-label={String(
                t("navigation.sidebar.conversations.tabs.closeNamed", {
                  title: tab.title,
                  defaultValue: "关闭 {{title}}",
                }),
              )}
              data-testid={`conversation-tab-close-${tab.sessionId}`}
              onClick={(event) => {
                event.stopPropagation();
                closeConversationTab(tab.sessionId);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44 p-1">
              <ContextMenuItem
                className="whitespace-nowrap"
                data-testid="conversation-tab-menu-close"
                onClick={() => closeConversationTab(tab.sessionId)}
              >
                {String(
                  t("navigation.sidebar.conversations.tabs.close", {
                    defaultValue: "关闭标签页",
                  }),
                )}
              </ContextMenuItem>
              {onRename ? (
                <ContextMenuItem
                  className="whitespace-nowrap"
                  data-testid="conversation-tab-menu-rename"
                  onClick={() => {
                    activateConversationTab(tab.sessionId);
                    onRename();
                  }}
                >
                  {String(
                    t("navigation.sidebar.conversations.tabs.rename", {
                      defaultValue: "重命名标签页",
                    }),
                  )}
                </ContextMenuItem>
              ) : null}
              <ContextMenuItem
                className="whitespace-nowrap"
                data-testid="conversation-tab-menu-close-others"
                onClick={() => closeOtherConversationTabs(tab.sessionId)}
              >
                {String(
                  t("navigation.sidebar.conversations.tabs.closeOthers", {
                    defaultValue: "关闭其他标签页",
                  }),
                )}
              </ContextMenuItem>
              <ContextMenuItem
                className="whitespace-nowrap"
                data-testid="conversation-tab-menu-close-all"
                onClick={() => setConfirmCloseAll(true)}
              >
                {String(
                  t("navigation.sidebar.conversations.tabs.closeAll", {
                    defaultValue: "关闭全部标签页",
                  }),
                )}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
      <div className="flex h-8 shrink-0 items-center">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-text-strong)]"
          aria-label={String(
            t("navigation.sidebar.conversations.tabs.new", {
              defaultValue: "新聊天",
            }),
          )}
          data-testid="conversation-tab-new"
          onClick={requestNewConversationTab}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <Dialog open={confirmCloseAll} onOpenChange={setConfirmCloseAll}>
        <DialogContent
          className="max-w-[420px]"
          data-testid="conversation-tab-close-all-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {String(
                t("navigation.sidebar.conversations.tabs.closeAllTitle", {
                  defaultValue: "关闭所有标签页？",
                }),
              )}
            </DialogTitle>
            <DialogDescription>
              {String(
                t("navigation.sidebar.conversations.tabs.closeAllDescription", {
                  defaultValue: "此面板中所有未固定的标签页将关闭。",
                }),
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmCloseAll(false)}
            >
              {String(
                t("navigation.sidebar.conversations.tabs.closeAllCancel", {
                  defaultValue: "取消",
                }),
              )}
            </Button>
            <Button
              type="button"
              data-testid="conversation-tab-close-all-confirm"
              onClick={() => {
                setConfirmCloseAll(false);
                closeAllConversationTabs();
              }}
            >
              {String(
                t("navigation.sidebar.conversations.tabs.closeAllConfirm", {
                  defaultValue: "关闭",
                }),
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
