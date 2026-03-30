import type { ComponentProps, ReactNode } from "react";
import { Info } from "lucide-react";
import { StepProgress } from "@/lib/workspace/workbenchUi";
import { EmptyState } from "../components/EmptyState";
import { MessageList } from "../components/MessageList";
import { TeamWorkspaceDock } from "../components/TeamWorkspaceDock";
import { WorkspacePendingA2UIDialog } from "./WorkspacePendingA2UIDialog";
import {
  ChatContainer,
  ChatContainerInner,
  ChatContent,
  ChatInputSlot,
  EntryBanner,
  EntryBannerClose,
  MessageViewport,
} from "./WorkspaceStyles";
import type {
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";
import type { A2UISubmissionNoticeData } from "../components/Inputbar/components/A2UISubmissionNotice";

interface WorkspaceChatContentProps {
  entryBannerVisible: boolean;
  entryBannerMessage?: string;
  onDismissEntryBanner: () => void;
  serviceSkillExecutionCard?: ReactNode;
  stepProgressProps?: ComponentProps<typeof StepProgress> | null;
  showChatLayout: boolean;
  compactChrome: boolean;
  contextWorkspaceEnabled: boolean;
  themeWorkbenchMessageViewportBottomPadding?: string;
  messageListProps: ComponentProps<typeof MessageList>;
  teamWorkspaceDockProps?: ComponentProps<typeof TeamWorkspaceDock> | null;
  emptyStateProps: ComponentProps<typeof EmptyState>;
  showWorkspaceAlert: boolean;
  onSelectWorkspaceDirectory: () => void;
  onDismissWorkspaceAlert: () => void;
  pendingA2UIForm?: A2UIResponse | null;
  onPendingA2UISubmit?: (formData: A2UIFormData) => void;
  a2uiSubmissionNotice?: A2UISubmissionNoticeData | null;
  showInlineInputbar: boolean;
  inputbarNode: ReactNode;
}

export function WorkspaceChatContent({
  entryBannerVisible,
  entryBannerMessage,
  onDismissEntryBanner,
  serviceSkillExecutionCard,
  stepProgressProps,
  showChatLayout,
  compactChrome,
  contextWorkspaceEnabled,
  themeWorkbenchMessageViewportBottomPadding,
  messageListProps,
  teamWorkspaceDockProps,
  emptyStateProps,
  showWorkspaceAlert,
  onSelectWorkspaceDirectory,
  onDismissWorkspaceAlert,
  pendingA2UIForm,
  onPendingA2UISubmit,
  a2uiSubmissionNotice,
  showInlineInputbar,
  inputbarNode,
}: WorkspaceChatContentProps) {
  const messageListNode = (
    <MessageList
      {...messageListProps}
      compactLeadingSpacing={contextWorkspaceEnabled}
    />
  );

  return (
    <ChatContainer>
      <ChatContainerInner>
        {entryBannerVisible && entryBannerMessage ? (
          <EntryBanner>
            <Info className="h-4 w-4 shrink-0" />
            <span>{entryBannerMessage}</span>
            <EntryBannerClose
              type="button"
              onClick={onDismissEntryBanner}
              aria-label="关闭入口提示"
            >
              关闭
            </EntryBannerClose>
          </EntryBanner>
        ) : null}

        {stepProgressProps ? <StepProgress {...stepProgressProps} /> : null}
        {serviceSkillExecutionCard}

        {showChatLayout ? (
          <ChatContent $compact={compactChrome}>
            <>
              {contextWorkspaceEnabled ? (
                <MessageViewport
                  $bottomPadding={themeWorkbenchMessageViewportBottomPadding}
                >
                  {messageListNode}
                </MessageViewport>
              ) : (
                messageListNode
              )}
              {teamWorkspaceDockProps ? (
                <TeamWorkspaceDock {...teamWorkspaceDockProps} />
              ) : null}
            </>
          </ChatContent>
        ) : (
          <EmptyState {...emptyStateProps} />
        )}

        {showChatLayout && (
          <>
            {showWorkspaceAlert ? (
              <div className="mx-4 mb-2 flex items-center gap-2 rounded-[18px] border border-amber-200/90 bg-amber-50/86 px-3.5 py-2.5 text-sm text-amber-800 shadow-sm shadow-amber-950/5 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                <span className="flex-1">
                  工作区目录不存在，请重新选择一个本地目录后继续
                </span>
                <button
                  type="button"
                  onClick={onSelectWorkspaceDirectory}
                  className="shrink-0 rounded-xl border border-amber-200 bg-white/84 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:border-amber-300 hover:bg-white dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                >
                  重新选择目录
                </button>
                <button
                  type="button"
                  onClick={onDismissWorkspaceAlert}
                  className="shrink-0 text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>
            ) : null}
            <WorkspacePendingA2UIDialog
              pendingA2UIForm={pendingA2UIForm}
              onA2UISubmit={onPendingA2UISubmit}
              a2uiSubmissionNotice={a2uiSubmissionNotice}
            />
            {showInlineInputbar ? (
              <ChatInputSlot>{inputbarNode}</ChatInputSlot>
            ) : null}
          </>
        )}
      </ChatContainerInner>
    </ChatContainer>
  );
}
