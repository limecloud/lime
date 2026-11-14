import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  CalendarClock,
  Copy,
  GitFork,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HeaderAction } from "@/components/app-shell/AppShell";
import {
  HeaderToolbar,
  HeaderToolbarActionMount,
} from "@/components/app-shell/HeaderToolbar";
import { useUnifiedToolbar } from "@/components/app-shell/unifiedTabStripContext";
import {
  closeConversationTab,
  ensureConversationTab,
  requestNewConversationTab,
  useConversationTabs,
} from "@/lib/conversationTabs";
import { ConversationTabBar } from "./ConversationTabBar";
import { resolveHotkeyPlatform } from "@/lib/hotkeys/platform";
import { requestSessionPinToggle } from "@/lib/sessionPinEvents";
import { requestScheduledTaskForThread } from "@/lib/scheduledTaskEvents";
import { requestCopyConversation } from "@/lib/conversationCopyEvents";

interface ThreadWorkspaceHeaderProps {
  sessionId: string;
  scheduledTaskThreadId?: string | null;
  title: string;
  onRename?: (title: string) => Promise<void>;
  onArchive?: () => Promise<void>;
  onFork?: () => Promise<void>;
  actions?: ReactNode;
  summaryToggle?: ReactNode;
  leading?: ReactNode;
  trailingTabs?: ReactNode;
}

function useHeaderToolbarActionContainer(children: ReactNode) {
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "flex h-full min-w-0 items-center gap-1";
    return element;
  });
  return { container, content: createPortal(children, container) };
}

export function ThreadWorkspaceHeader({
  sessionId,
  scheduledTaskThreadId,
  title,
  onRename,
  onArchive,
  onFork,
  actions,
  summaryToggle,
  leading,
  trailingTabs,
}: ThreadWorkspaceHeaderProps) {
  const { t: tNavigation } = useTranslation("navigation");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const currentSessionId = useRef(sessionId);
  currentSessionId.current = sessionId;
  const titleEdit = useRef<{
    sessionId: string;
    originalTitle: string;
    draft: string;
    rename: NonNullable<ThreadWorkspaceHeaderProps["onRename"]>;
  } | null>(null);
  const activeTitleEdit =
    editingTitle && titleEdit.current?.sessionId === sessionId
      ? titleEdit.current
      : null;
  const renamePrompt = String(
    tNavigation("navigation.sidebar.conversations.rename.prompt"),
  );
  useEffect(() => {
    if (titleEdit.current?.sessionId !== sessionId) {
      titleEdit.current = null;
      setEditingTitle(false);
      setTitleDraft(title);
    }
  }, [sessionId, title]);

  useEffect(() => {
    if (!editingTitle) {
      setTitleDraft(title);
    }
  }, [editingTitle, title]);

  useEffect(() => {
    if (!editingTitle) {
      return;
    }
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [editingTitle]);

  const startRename = useCallback(() => {
    if (!onRename || currentSessionId.current !== sessionId) {
      return;
    }
    titleEdit.current = {
      sessionId,
      originalTitle: title,
      draft: title,
      rename: onRename,
    };
    setTitleDraft(title);
    setEditingTitle(true);
  }, [onRename, sessionId, title]);

  const shortcutPlatform = resolveHotkeyPlatform(navigator);
  const isMacShortcut = shortcutPlatform === "mac";
  const { tabs: conversationTabs } = useConversationTabs();
  useEffect(() => {
    if (sessionId) ensureConversationTab(sessionId, title);
  }, [sessionId, title]);
  const showConversationTabBar = Boolean(sessionId) && conversationTabs.length > 0;
  const renameShortcut = isMacShortcut ? "⌥⌘R" : "Ctrl+Alt+R";
  const pinShortcut = isMacShortcut ? "⌥⌘P" : "Ctrl+Alt+P";
  const archiveShortcut = isMacShortcut ? "⇧⌘A" : "Ctrl+Shift+A";

  useEffect(() => {
    if (!sessionId) return;
    const handleThreadShortcut = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "rename" && onRename) {
        startRename();
      } else if (action === "pin") {
        requestSessionPinToggle(sessionId);
      } else if (action === "archive" && onArchive) {
        void onArchive();
      } else if (action === "fork" && onFork) {
        void onFork();
      }
    };
    window.addEventListener("lime:thread-shortcut", handleThreadShortcut);
    return () =>
      window.removeEventListener("lime:thread-shortcut", handleThreadShortcut);
  }, [onArchive, onFork, onRename, startRename, sessionId]);

  const commitRename = (edit: typeof activeTitleEdit) => {
    if (
      !edit ||
      titleEdit.current !== edit ||
      currentSessionId.current !== edit.sessionId
    ) {
      return;
    }
    titleEdit.current = null;
    const nextTitle = edit.draft.trim();
    setEditingTitle(false);
    if (!nextTitle || nextTitle === edit.originalTitle) {
      return;
    }
    void edit.rename(nextTitle);
  };

  const cancelRename = (edit: typeof activeTitleEdit) => {
    if (!edit || titleEdit.current !== edit) {
      return;
    }
    titleEdit.current = null;
    setTitleDraft(title);
    setEditingTitle(false);
  };

  const unified = useUnifiedToolbar();
  const actionDestination = unified?.isVisible
    ? unified.mode === "split"
      ? "chat"
      : "tab-strip"
    : "window";
  const summaryDestination = actionDestination === "chat" ? "chat" : "window";
  const threadActions = useHeaderToolbarActionContainer(
    <div
      className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="thread-workspace-header-tools"
      data-action-destination={actionDestination}
    >
      {actions}
    </div>,
  );
  const summaryActions = useHeaderToolbarActionContainer(
    <div className="contents" data-action-destination={summaryDestination}>
      {summaryToggle}
    </div>,
  );

  return (
    <>
      {threadActions.content}
      {summaryActions.content}
      <HeaderToolbar
        className="flex-1"
        data-testid="thread-workspace-header"
        data-header-placement="titlebar"
        data-session-id={sessionId}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2.5"
          data-testid="thread-workspace-header-context"
        >
          {leading ? (
            <span
              className="flex shrink-0 items-center"
              data-testid="thread-workspace-header-leading"
            >
              {leading}
            </span>
          ) : null}
          {showConversationTabBar && sessionId ? (
            <ConversationTabBar
              currentSessionId={sessionId}
              onRename={onRename ? startRename : undefined}
              editingTitle={
                activeTitleEdit
                  ? {
                      sessionId: activeTitleEdit.sessionId,
                      draft: titleDraft,
                      prompt: renamePrompt,
                      inputRef: titleInputRef,
                      onChange: (value) => {
                        if (
                          titleEdit.current === activeTitleEdit &&
                          currentSessionId.current ===
                            activeTitleEdit.sessionId
                        ) {
                          activeTitleEdit.draft = value;
                          setTitleDraft(value);
                        }
                      },
                      onCommit: () => commitRename(activeTitleEdit),
                      onCancel: () => cancelRename(activeTitleEdit),
                    }
                  : undefined
              }
            />
          ) : activeTitleEdit ? (

            <input
              ref={titleInputRef}
              className="h-7 min-w-[8ch] max-w-[320px] flex-1 rounded-md border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-stage-surface,var(--lime-app-bg,#f4f7f1))] px-2 text-[13px] font-medium text-[color:var(--lime-text-strong)] outline-none"
              data-testid="thread-workspace-header-title-input"
              aria-label={renamePrompt}
              value={titleDraft}
              onChange={(event) => {
                if (
                  titleEdit.current === activeTitleEdit &&
                  currentSessionId.current === activeTitleEdit.sessionId
                ) {
                  activeTitleEdit.draft = event.target.value;
                  setTitleDraft(event.target.value);
                }
              }}
              onBlur={() => commitRename(activeTitleEdit)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename(activeTitleEdit);
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelRename(activeTitleEdit);
                }
              }}
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <h1
                className="[[data-mode=full]_&]:hidden min-w-0 max-w-[320px] truncate text-[13px] font-medium leading-5 text-[color:var(--lime-text-strong)]"
                data-testid="thread-workspace-header-title"
                title={title}
              >
                {onRename ? (
                  <button
                    type="button"
                    className="max-w-full truncate rounded-md px-1 text-left hover:bg-[color:var(--lime-chrome-tab-hover)]"
                    onClick={startRename}
                  >
                    {title}
                  </button>
                ) : (
                  title
                )}
              </h1>
              {sessionId ? (
                <button
                  type="button"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-text-strong)]"
                  aria-label={String(
                    tNavigation(
                      "navigation.sidebar.conversations.tabs.close",
                      { defaultValue: "关闭标签页" },
                    ),
                  )}
                  data-testid="conversation-tab-close-single"
                  onClick={() => closeConversationTab(sessionId)}
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-text-strong)]"
                aria-label={String(
                  tNavigation("navigation.sidebar.conversations.tabs.new", {
                    defaultValue: "新聊天",
                  }),
                )}
                data-testid="conversation-tab-new"
                onClick={requestNewConversationTab}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          )}
          {trailingTabs ? (
            <div
              className="flex min-w-[140px] max-w-[45%] flex-1 items-center gap-1 overflow-x-auto"
              data-inline-side-panel-tabs
            >
              {trailingTabs}
            </div>
          ) : null}
        </div>
        {actionDestination === "chat" ? (
          <HeaderToolbar.Actions className="min-w-0 max-w-full shrink">
            <HeaderToolbarActionMount container={summaryActions.container} />
            <HeaderToolbarActionMount container={threadActions.container} />
          </HeaderToolbar.Actions>
        ) : null}
      </HeaderToolbar>
      {actionDestination === "tab-strip" ? (
        <HeaderToolbarActionMount
          container={threadActions.container}
          destination={unified?.tabStripActions ?? null}
        />
      ) : null}
      {actions || onRename || onArchive || onFork || summaryToggle ? (
        <HeaderAction
          actionId="unified-workspace-controls"
          align="end"
          slotPosition="right"
        >
          <HeaderToolbar.Actions
            className="max-w-[min(44vw,520px)]"
            data-testid="thread-workspace-header-actions"
            data-header-action-overflow="tools"
          >
            {summaryDestination === "window" ? (
              <HeaderToolbarActionMount container={summaryActions.container} />
            ) : null}
            {onRename || onArchive || onFork ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] text-[color:var(--lime-chrome-muted)] transition hover:bg-[color:var(--lime-chrome-tab-hover)] hover:text-[color:var(--lime-chrome-text)]"
                    aria-label={String(
                      tNavigation(
                        "navigation.sidebar.conversations.openActionMenu",
                        {
                          title,
                        },
                      ),
                    )}
                    title={String(
                      tNavigation(
                        "navigation.sidebar.conversations.moreActions",
                      ),
                    )}
                    data-testid="thread-workspace-header-action-menu"
                  >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 p-1">
                  {onRename ? (
                    <DropdownMenuItem className="whitespace-nowrap" onClick={startRename}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      {String(
                        tNavigation(
                          "navigation.sidebar.conversations.menu.rename",
                        ),
                      )}
                      <span className="ml-auto pl-6 font-mono text-[11px] text-muted-foreground">
                        {renameShortcut}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    data-testid="thread-workspace-header-pin"
                    onClick={() => requestSessionPinToggle(sessionId)}
                  >
                    <Pin className="h-3.5 w-3.5" aria-hidden="true" />
                    {String(
                      tNavigation(
                        "navigation.sidebar.conversations.menu.pin",
                      ),
                    )}
                    <span className="ml-auto pl-6 font-mono text-[11px] text-muted-foreground">
                      {pinShortcut}
                    </span>
                  </DropdownMenuItem>
                  {onFork ? (
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      data-testid="thread-workspace-header-fork"
                      onClick={() => {
                        void onFork();
                      }}
                    >
                      <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
                      {String(
                        tNavigation(
                          "navigation.sidebar.conversations.menu.fork",
                        ),
                      )}
                    </DropdownMenuItem>
                  ) : null}
                  {scheduledTaskThreadId ? (
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      data-testid="thread-workspace-header-schedule-task"
                      onClick={() =>
                        requestScheduledTaskForThread(
                          scheduledTaskThreadId,
                        )
                      }
                    >
                      <CalendarClock
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                      {String(
                        tNavigation(
                          "navigation.sidebar.conversations.menu.addScheduledTask",
                        ),
                      )}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem
                    className="whitespace-nowrap"
                    data-testid="thread-workspace-header-copy"
                    onClick={requestCopyConversation}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    {String(
                      tNavigation(
                        "navigation.sidebar.conversations.menu.copy",
                      ),
                    )}
                  </DropdownMenuItem>
                  {onArchive ? (
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      data-testid="thread-workspace-header-archive"
                      onClick={() => {
                        void onArchive();
                      }}
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                      {String(
                        tNavigation(
                          "navigation.sidebar.conversations.menu.archive",
                        ),
                      )}
                      <span className="ml-auto pl-6 font-mono text-[11px] text-muted-foreground">
                        {archiveShortcut}
                      </span>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {actionDestination === "window" ? (
              <HeaderToolbarActionMount container={threadActions.container} />
            ) : null}
          </HeaderToolbar.Actions>
        </HeaderAction>
      ) : null}
    </>
  );
}
