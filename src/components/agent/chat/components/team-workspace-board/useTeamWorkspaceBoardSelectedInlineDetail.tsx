import type { ComponentProps, ReactNode } from "react";
import type { SelectedSessionActivityState } from "../../team-workspace-runtime/activityPreviewSelectors";
import { TeamWorkspaceCanvasSelectedInlineDetail } from "./TeamWorkspaceCanvasSelectedInlineDetail";

type TeamWorkspaceCanvasSelectedInlineDetailProps = ComponentProps<
  typeof TeamWorkspaceCanvasSelectedInlineDetail
>;

interface UseTeamWorkspaceBoardSelectedInlineDetailParams {
  canOpenSelectedSession: TeamWorkspaceCanvasSelectedInlineDetailProps["canOpenSelectedSession"];
  canResumeSelectedSession: TeamWorkspaceCanvasSelectedInlineDetailProps["canResumeSelectedSession"];
  canSendSelectedSessionInput: TeamWorkspaceCanvasSelectedInlineDetailProps["canSendSelectedSessionInput"];
  canStopSelectedSession: TeamWorkspaceCanvasSelectedInlineDetailProps["canStopSelectedSession"];
  canWaitSelectedSession: TeamWorkspaceCanvasSelectedInlineDetailProps["canWaitSelectedSession"];
  detailDisplay: TeamWorkspaceCanvasSelectedInlineDetailProps["detailDisplay"];
  detailSummary: TeamWorkspaceCanvasSelectedInlineDetailProps["detailSummary"];
  formatUpdatedAt: TeamWorkspaceCanvasSelectedInlineDetailProps["formatUpdatedAt"];
  inlineDetailSectionClassName: TeamWorkspaceCanvasSelectedInlineDetailProps["inlineDetailSectionClassName"];
  inlineTimelineEntryClassName: TeamWorkspaceCanvasSelectedInlineDetailProps["inlineTimelineEntryClassName"];
  inlineTimelineFeedClassName: TeamWorkspaceCanvasSelectedInlineDetailProps["inlineTimelineFeedClassName"];
  isChildSession: TeamWorkspaceCanvasSelectedInlineDetailProps["isChildSession"];
  onOpenSubagentSession?: (sessionId: string) => void | Promise<void>;
  onSelectedSessionAction: TeamWorkspaceCanvasSelectedInlineDetailProps["onSelectedSessionAction"];
  onSelectedSessionInputDraftChange: TeamWorkspaceCanvasSelectedInlineDetailProps["onSelectedSessionInputDraftChange"];
  onSelectedSessionSendInput: TeamWorkspaceCanvasSelectedInlineDetailProps["onSelectedSessionSendInput"];
  pendingSessionAction?: {
    action: NonNullable<TeamWorkspaceCanvasSelectedInlineDetailProps["pendingAction"]>;
  } | null;
  selectedActionPending: TeamWorkspaceCanvasSelectedInlineDetailProps["selectedActionPending"];
  selectedSession:
    | TeamWorkspaceCanvasSelectedInlineDetailProps["selectedSession"]
    | null;
  selectedSessionActivityState: SelectedSessionActivityState;
  selectedSessionInputDraft: TeamWorkspaceCanvasSelectedInlineDetailProps["selectedSessionInputDraft"];
  selectedSessionInputMessage: TeamWorkspaceCanvasSelectedInlineDetailProps["selectedSessionInputMessage"];
}

export function useTeamWorkspaceBoardSelectedInlineDetail({
  canOpenSelectedSession,
  canResumeSelectedSession,
  canSendSelectedSessionInput,
  canStopSelectedSession,
  canWaitSelectedSession,
  detailDisplay,
  detailSummary,
  formatUpdatedAt,
  inlineDetailSectionClassName,
  inlineTimelineEntryClassName,
  inlineTimelineFeedClassName,
  isChildSession,
  onOpenSubagentSession,
  onSelectedSessionAction,
  onSelectedSessionInputDraftChange,
  onSelectedSessionSendInput,
  pendingSessionAction = null,
  selectedActionPending,
  selectedSession,
  selectedSessionActivityState,
  selectedSessionInputDraft,
  selectedSessionInputMessage,
}: UseTeamWorkspaceBoardSelectedInlineDetailParams): ReactNode {
  if (!selectedSession) {
    return null;
  }

  return (
    <TeamWorkspaceCanvasSelectedInlineDetail
      canOpenSelectedSession={canOpenSelectedSession}
      canResumeSelectedSession={canResumeSelectedSession}
      canSendSelectedSessionInput={canSendSelectedSessionInput}
      canStopSelectedSession={canStopSelectedSession}
      canWaitSelectedSession={canWaitSelectedSession}
      detailSummary={detailSummary}
      detailDisplay={detailDisplay}
      formatUpdatedAt={formatUpdatedAt}
      inlineDetailSectionClassName={inlineDetailSectionClassName}
      inlineTimelineEntryClassName={inlineTimelineEntryClassName}
      inlineTimelineFeedClassName={inlineTimelineFeedClassName}
      isChildSession={isChildSession}
      onOpenSelectedSession={() => void onOpenSubagentSession?.(selectedSession.id)}
      onSelectedSessionAction={onSelectedSessionAction}
      onSelectedSessionInputDraftChange={onSelectedSessionInputDraftChange}
      onSelectedSessionSendInput={onSelectedSessionSendInput}
      pendingAction={
        selectedActionPending ? pendingSessionAction?.action ?? null : null
      }
      selectedActionPending={selectedActionPending}
      selectedSession={selectedSession}
      selectedSessionActivityEntries={selectedSessionActivityState.entries}
      selectedSessionActivityPreview={selectedSessionActivityState.previewState}
      selectedSessionActivityPreviewText={selectedSessionActivityState.previewText}
      selectedSessionActivityShouldPoll={selectedSessionActivityState.shouldPoll}
      selectedSessionInputDraft={selectedSessionInputDraft}
      selectedSessionInputMessage={selectedSessionInputMessage}
      selectedSessionSupportsActivityPreview={
        selectedSessionActivityState.supportsPreview
      }
    />
  );
}
