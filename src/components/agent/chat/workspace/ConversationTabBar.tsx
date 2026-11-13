import { useEffect, useRef, useState, type RefObject } from "react";
import { MessageSquare, Pin, Plus, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { requestSessionPinToggle } from "@/lib/sessionPinEvents";
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
  closeConversationTabsToTheRight,
  closeOtherConversationTabs,
  moveConversationTab,
  requestNewConversationTab,
  setConversationTabPinned,
  useConversationTabs,
} from "@/lib/conversationTabs";

export function ConversationTabBar({
  currentSessionId,
  onRename,
  editingTitle,
}: {
  currentSessionId?: string | null;
  onRename?: () => void;
  editingTitle?: {
    sessionId: string;
    draft: string;
    prompt: string;
    inputRef: RefObject<HTMLInputElement>;
    onChange: (value: string) => void;
    onCommit: () => void;
    onCancel: () => void;
  };
}) {
  const { t } = useTranslation("navigation");
  const { tabs, activeSessionId } = useConversationTabs();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const [pendingPinnedClose, setPendingPinnedClose] =
    useState<{ sessionId: string; title: string } | null>(null);
  const closeTab = (sessionId: string, title: string, pinned?: boolean) => {
    if (pinned) {
      setPendingPinnedClose({ sessionId, title });
      return;
    }
    closeConversationTab(sessionId);
  };

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
      {tabs.map((tab) => {
        const active =
          tab.sessionId === (activeSessionId || currentSessionId);
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
            {tab.pinned ? (
              <Pin className="h-3 w-3 shrink-0 text-[color:var(--lime-text-muted)]" />
            ) : null}
            {editingTitle?.sessionId === tab.sessionId ? (
              <input
                ref={editingTitle.inputRef}
                className="h-6 min-w-0 flex-1 rounded border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-1 text-[13px] font-medium text-[color:var(--lime-text-strong)] outline-none"
                data-testid="thread-workspace-header-title-input"
                aria-label={editingTitle.prompt}
                value={editingTitle.draft}
                onChange={(event) => editingTitle.onChange(event.target.value)}
                onBlur={editingTitle.onCommit}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    editingTitle.onCommit();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    editingTitle.onCancel();
                  }
                }}
              />
            ) : active && onRename ? (
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
                closeTab(tab.sessionId, tab.title, tab.pinned);
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
                onClick={() => closeTab(tab.sessionId, tab.title, tab.pinned)}
              >
                {String(
                  t("navigation.sidebar.conversations.tabs.close", {
                    defaultValue: "关闭标签页",
                  }),
                )}
              </ContextMenuItem>
              <ContextMenuItem
                className="whitespace-nowrap"
                data-testid="conversation-tab-menu-pin"
                onClick={() => {
                  setConversationTabPinned(tab.sessionId, !tab.pinned);
                  requestSessionPinToggle(tab.sessionId);
                }}
              >
                <Pin className="h-3.5 w-3.5" />
                {String(
                  t(
                    tab.pinned
                      ? "navigation.sidebar.conversations.tabs.unpinFromSidebar"
                      : "navigation.sidebar.conversations.tabs.pinToSidebar",
                    {
                      defaultValue: tab.pinned
                        ? "从侧栏取消固定"
                        : "固定到侧栏",
                    },
                  ),
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
                data-testid="conversation-tab-menu-close-right"
                onClick={() =>
                  closeConversationTabsToTheRight(tab.sessionId)
                }
              >
                {String(
                  t("navigation.sidebar.conversations.tabs.closeRight", {
                    defaultValue: "关闭右侧标签页",
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
      <Dialog
        open={pendingPinnedClose !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPinnedClose(null);
        }}
      >
        <DialogContent
          className="max-w-[420px]"
          data-testid="conversation-tab-close-pinned-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {String(
                t("navigation.sidebar.conversations.tabs.closePinnedTitle", {
                  defaultValue: "关闭固定标签页？",
                }),
              )}
            </DialogTitle>
            <DialogDescription>
              {String(
                t(
                  "navigation.sidebar.conversations.tabs.closePinnedDescription",
                  {
                    title: pendingPinnedClose?.title ?? "",
                    defaultValue: "「{{title}}」的固定也会取消。",
                  },
                ),
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingPinnedClose(null)}
            >
              {String(
                t("navigation.sidebar.conversations.tabs.closePinnedCancel", {
                  defaultValue: "取消",
                }),
              )}
            </Button>
            <Button
              type="button"
              data-testid="conversation-tab-close-pinned-confirm"
              onClick={() => {
                const pending = pendingPinnedClose;
                setPendingPinnedClose(null);
                if (!pending) return;
                closeConversationTab(pending.sessionId);
                setConversationTabPinned(pending.sessionId, false);
                requestSessionPinToggle(pending.sessionId);
              }}
            >
              {String(
                t("navigation.sidebar.conversations.tabs.closePinnedConfirm", {
                  defaultValue: "关闭标签页",
                }),
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
