import { Activity, Bot, Clock3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SessionActivityPreviewState } from "../../team-workspace-runtime/activityPreviewSelectors";
import type { SelectedSessionDetailDisplayState } from "../../team-workspace-runtime/selectedSessionDetailSelectors";
import type { TeamWorkspaceActivityEntry } from "../../teamWorkspaceRuntime";

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            <Bot className="h-3.5 w-3.5" />
            <span>当前查看</span>
            {selectedSession.isCurrent ? (
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                当前对话
              </span>
            ) : null}
          </div>
          <p
            className="mt-2 text-sm leading-6 text-slate-600"
            data-testid="team-workspace-session-summary"
          >
            {detailSummary}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canResumeSelectedSession ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedActionPending}
              onClick={() => void onSelectedSessionAction("resume")}
            >
              {selectedActionPending && pendingAction === "resume" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {selectedActionPending && pendingAction === "resume"
                ? "继续中..."
                : "继续处理"}
            </Button>
          ) : null}
          {canStopSelectedSession ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={selectedActionPending}
              onClick={() => void onSelectedSessionAction("close")}
            >
              {selectedActionPending && pendingAction === "close" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {selectedActionPending && pendingAction === "close"
                ? "暂停中..."
                : "暂停处理"}
            </Button>
          ) : null}
          {canOpenSelectedSession ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onOpenSelectedSession?.()}
            >
              {isChildSession ? "切换会话" : "打开对话"}
            </Button>
          ) : null}
        </div>
      </div>

      {detailDisplay.runtimeDetailSummary ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
            {detailDisplay.runtimeDetailSummary}
          </span>
        </div>
      ) : null}
      {detailDisplay.queueReason ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
          {detailDisplay.queueReason}
        </div>
      ) : null}

      {detailDisplay.hasSettings ? (
        <div className={inlineDetailSectionClassName}>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Bot className="h-3.5 w-3.5" />
            <span>协作设置</span>
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

      {canWaitSelectedSession || canSendSelectedSessionInput ? (
        <div className={inlineDetailSectionClassName}>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Clock3 className="h-3.5 w-3.5" />
            <span>继续协作</span>
            {canWaitSelectedSession ? (
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                可直接查看结果
              </span>
            ) : null}
          </div>
          {canWaitSelectedSession ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectedActionPending}
                onClick={() => void onSelectedSessionAction("wait")}
              >
                {selectedActionPending && pendingAction === "wait" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {selectedActionPending && pendingAction === "wait"
                  ? "等待中..."
                  : "等待结果 30 秒"}
              </Button>
              <span className="text-xs leading-5 text-slate-500">
                仅在当前内容确实依赖这位成员结果时使用。
              </span>
            </div>
          ) : null}
          {canSendSelectedSessionInput ? (
            <div className="mt-3 space-y-3">
              <Textarea
                value={selectedSessionInputDraft}
                onChange={(event) =>
                  onSelectedSessionInputDraftChange(event.target.value)
                }
                placeholder="给这位协作成员补充说明、补充约束，或请它继续推进下一步。"
                className="min-h-[96px] resize-y border-slate-200 bg-white text-sm text-slate-700 placeholder:text-slate-400"
                data-testid="team-workspace-send-input-textarea"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    selectedActionPending || !selectedSessionInputMessage
                  }
                  onClick={() => void onSelectedSessionSendInput(false)}
                >
                  {selectedActionPending && pendingAction === "send" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {selectedActionPending && pendingAction === "send"
                    ? "发送中..."
                    : "发送说明"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    selectedActionPending || !selectedSessionInputMessage
                  }
                  onClick={() => void onSelectedSessionSendInput(true)}
                >
                  {selectedActionPending &&
                  pendingAction === "interrupt_send" ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {selectedActionPending && pendingAction === "interrupt_send"
                    ? "中断中..."
                    : "立即插入说明"}
                </Button>
                <span className="text-xs leading-5 text-slate-500">
                  这条说明只会发送给当前成员，不影响其他协作成员。
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedSessionSupportsActivityPreview ? (
        <div className={inlineDetailSectionClassName}>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <Activity className="h-3.5 w-3.5" />
            <span>完整进展</span>
            {selectedSessionActivityShouldPoll ? (
              <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-medium tracking-normal text-sky-700 normal-case">
                处理中自动刷新
              </span>
            ) : null}
          </div>
          {selectedSessionActivityPreviewText ? (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
              {selectedSessionActivityPreviewText}
            </p>
          ) : selectedSessionActivityPreview?.status === "error" ? (
            <p className="mt-2 text-sm leading-6 text-rose-600">
              最新进展暂不可用：
              {selectedSessionActivityPreview.errorMessage ?? "同步失败"}
            </p>
          ) : selectedSessionActivityPreview?.status === "ready" ? (
            <p className="mt-2 text-sm leading-6 text-slate-500">
              这位成员暂时还没有可展示的新进展。
            </p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-500">
              正在同步这位成员的最新进展...
            </p>
          )}

          {selectedSessionActivityEntries.length > 0 ? (
            <div
              className={inlineTimelineFeedClassName}
              data-testid="team-workspace-activity-feed"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                <span>进展记录</span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium tracking-normal text-slate-600 normal-case">
                  {selectedSessionActivityEntries.length} 条
                </span>
              </div>
              <div className="mt-3 space-y-2.5">
                {selectedSessionActivityEntries.map((entry) => (
                  <div key={entry.id} className={inlineTimelineEntryClassName}>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-semibold text-slate-800">
                        {entry.title}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-medium",
                          entry.badgeClassName,
                        )}
                      >
                        {entry.statusLabel}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                      {entry.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

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
