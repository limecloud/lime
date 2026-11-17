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
import { ensureConversationTab } from "@/lib/conversationTabs";
import { resolveHotkeyPlatform } from "@/lib/hotkeys/platform";
import { requestSessionPinToggle } from "@/lib/sessionPinEvents";
import { requestScheduledTaskForThread } from "@/lib/scheduledTaskEvents";
import { requestCopyConversation } from "@/lib/conversationCopyEvents";

interface ThreadWorkspaceHeaderProps {
  ephemeral?: boolean;
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

function TitleChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.71677 4.71677C8.87298 4.56056 9.12696 4.56056 9.28317 4.71677C9.43938 4.87298 9.43938 5.12696 9.28317 5.28317L6.45993 8.10642C6.20609 8.36023 5.79384 8.36023 5.54001 8.10642L2.71677 5.28317C2.56056 5.12696 2.56056 4.87298 2.71677 4.71677C2.87298 4.56056 3.12696 4.56056 3.28317 4.71677L5.99997 7.43356L8.71677 4.71677Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ThreadWorkspaceHeader({
  sessionId,
  ephemeral = false,
  scheduledTaskThreadId,
  title,
  onRename,
  onArchive,
  onFork,
  actions,
  summaryToggle,
  leading,
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

  useEffect(() => {
    // Register the session even though Codex uses a single title instead of
    // a visible tab strip; task-center visibility depends on this registry.
    if (sessionId) ensureConversationTab(sessionId, title, { ephemeral });
  }, [ephemeral, sessionId, title]);

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

  const threadMenu = (
                  <DropdownMenuContent align="start" className="w-[220px] p-1">
                    {onRename ? (
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        onClick={startRename}
                      >
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
                        tNavigation("navigation.sidebar.conversations.menu.pin"),
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
                    <DropdownMenuItem
                      className="whitespace-nowrap"
                      data-testid="thread-workspace-header-copy"
                      onClick={requestCopyConversation}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      {String(
                        tNavigation("navigation.sidebar.conversations.menu.copy"),
                      )}
                    </DropdownMenuItem>
                    {scheduledTaskThreadId ? (
                      <DropdownMenuItem
                        className="whitespace-nowrap"
                        data-testid="thread-workspace-header-schedule-task"
                        onClick={() =>
                          requestScheduledTaskForThread(scheduledTaskThreadId)
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
          {activeTitleEdit ? (
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
                className="[[data-mode=full]_&]:hidden min-w-0 max-w-[320px] truncate text-[13px] font-[510] leading-5 text-[color:var(--lime-text-strong)]"
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-chrome-tab-hover)]"
                      aria-label={String(
                        tNavigation("navigation.sidebar.conversations.moreActions"),
                      )}
                      data-testid="thread-workspace-header-title-menu"
                    >
                      <TitleChevronIcon />
                    </button>
                  </DropdownMenuTrigger>
                  {threadMenu}
                </DropdownMenu>
              </h1>


            </div>
          )}

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
                    className="sr-only"
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
                {threadMenu}
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
