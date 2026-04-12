import { Bot, Clock3 } from "lucide-react";
import type { SessionActivityPreviewState } from "../../team-workspace-runtime/activityPreviewSelectors";
import type { SelectedSessionDetailDisplayState } from "../../team-workspace-runtime/selectedSessionDetailSelectors";
import type { TeamWorkspaceActivityEntry } from "../../teamWorkspaceRuntime";
import { SelectedSessionInlineActivitySection } from "./SelectedSessionInlineActivitySection";
import { SelectedSessionInlineCollaborationSection } from "./SelectedSessionInlineCollaborationSection";
import { SelectedSessionInlineHeader } from "./SelectedSessionInlineHeader";

type SelectedSessionInlineDetailAction =
  | "close"
  | "interrupt_send"
  | "resume"
  | "send"
  | "wait";

interface SelectedSessionInlineDetailProps {
  canOpenSelectedSession: boolean;
  canResumeSelectedSession: boolean;
  canSendSelectedSessionInput: boolean;
  canStopSelectedSession: boolean;
  canWaitSelectedSession: boolean;
  detailSummary: string;
  detailDisplay: SelectedSessionDetailDisplayState;
  formatUpdatedAt: (updatedAt?: number) => string;
  inlineDetailSectionClassName: string;
  inlineTimelineEntryClassName: string;
  inlineTimelineFeedClassName: string;
  isChildSession: boolean;
  onOpenSelectedSession?: () => void;
  onSelectedSessionAction: (
    action: "close" | "resume" | "wait",
  ) => void | Promise<void>;
  onSelectedSessionInputDraftChange: (value: string) => void;
  onSelectedSessionSendInput: (interrupt: boolean) => void | Promise<void>;
  pendingAction: SelectedSessionInlineDetailAction | null;
  selectedActionPending: boolean;
  selectedSession: {
    id: string;
    isCurrent?: boolean;
    updatedAt?: number;
  };
  selectedSessionActivityEntries: TeamWorkspaceActivityEntry[];
  selectedSessionActivityPreview: SessionActivityPreviewState | null;
  selectedSessionActivityPreviewText: string | null;
  selectedSessionActivityShouldPoll: boolean;
  selectedSessionInputDraft: string;
  selectedSessionInputMessage: string;
  selectedSessionSupportsActivityPreview: boolean;
}

export function SelectedSessionInlineDetail({
  canOpenSelectedSession,
  canResumeSelectedSession,
  canSendSelectedSessionInput,
  canStopSelectedSession,
  canWaitSelectedSession,
  detailSummary,
  detailDisplay,
  formatUpdatedAt,
  inlineDetailSectionClassName,
  inlineTimelineEntryClassName,
  inlineTimelineFeedClassName,
  isChildSession,
  onOpenSelectedSession,
  onSelectedSessionAction,
  onSelectedSessionInputDraftChange,
  onSelectedSessionSendInput,
  pendingAction,
  selectedActionPending,
  selectedSession,
  selectedSessionActivityEntries,
  selectedSessionActivityPreview,
  selectedSessionActivityPreviewText,
  selectedSessionActivityShouldPoll,
  selectedSessionInputDraft,
  selectedSessionInputMessage,
  selectedSessionSupportsActivityPreview,
}: SelectedSessionInlineDetailProps) {
  return (
    <div
      className="mt-3 border-t border-slate-200 pt-3"
      data-testid={`team-workspace-member-detail-${selectedSession.id}`}
    >
      <SelectedSessionInlineHeader
        canOpenSelectedSession={canOpenSelectedSession}
        canResumeSelectedSession={canResumeSelectedSession}
        canStopSelectedSession={canStopSelectedSession}
        detailSummary={detailSummary}
        isChildSession={isChildSession}
        onOpenSelectedSession={onOpenSelectedSession}
        onSelectedSessionAction={onSelectedSessionAction}
        pendingAction={pendingAction}
        queueReason={detailDisplay.queueReason}
        runtimeDetailSummary={detailDisplay.runtimeDetailSummary}
        selectedActionPending={selectedActionPending}
        selectedSession={selectedSession}
      />

      {detailDisplay.hasSettings ? (
        <div className={inlineDetailSectionClassName}>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Bot className="h-3.5 w-3.5" />
            <span>任务分工</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {detailDisplay.settingBadges.map((badge) => (
              <span
                key={badge}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1"
              >
                {badge}
              </span>
            ))}
          </div>
          {detailDisplay.outputContract ? (
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {detailDisplay.outputContract}
            </p>
          ) : null}
          {detailDisplay.skillBadges.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {detailDisplay.skillBadges.map((skill) => (
                <span
                  key={`${selectedSession.id}-${skill.id}`}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600"
                  title={skill.title}
                >
                  {skill.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <SelectedSessionInlineCollaborationSection
        canSendSelectedSessionInput={canSendSelectedSessionInput}
        canWaitSelectedSession={canWaitSelectedSession}
        inlineDetailSectionClassName={inlineDetailSectionClassName}
        onSelectedSessionAction={onSelectedSessionAction}
        onSelectedSessionInputDraftChange={onSelectedSessionInputDraftChange}
        onSelectedSessionSendInput={onSelectedSessionSendInput}
        pendingAction={pendingAction}
        selectedActionPending={selectedActionPending}
        selectedSessionInputDraft={selectedSessionInputDraft}
        selectedSessionInputMessage={selectedSessionInputMessage}
      />

      <SelectedSessionInlineActivitySection
        inlineDetailSectionClassName={inlineDetailSectionClassName}
        inlineTimelineEntryClassName={inlineTimelineEntryClassName}
        inlineTimelineFeedClassName={inlineTimelineFeedClassName}
        selectedSessionActivityEntries={selectedSessionActivityEntries}
        selectedSessionActivityPreview={selectedSessionActivityPreview}
        selectedSessionActivityPreviewText={selectedSessionActivityPreviewText}
        selectedSessionActivityShouldPoll={selectedSessionActivityShouldPoll}
        selectedSessionSupportsActivityPreview={
          selectedSessionSupportsActivityPreview
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1">
          <Clock3 className="h-3.5 w-3.5" />
          更新于 {formatUpdatedAt(selectedSession.updatedAt)}
        </span>
        {detailDisplay.metadata.map((meta) => (
          <span
            key={meta}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1"
          >
            {meta}
          </span>
        ))}
      </div>
    </div>
  );
}
