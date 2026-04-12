import { Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type SelectedSessionInlineDetailAction =
  | "close"
  | "interrupt_send"
  | "resume"
  | "send"
  | "wait";

interface SelectedSessionInlineHeaderProps {
  canOpenSelectedSession: boolean;
  canResumeSelectedSession: boolean;
  canStopSelectedSession: boolean;
  detailSummary: string;
  isChildSession: boolean;
  onOpenSelectedSession?: () => void;
  onSelectedSessionAction: (
    action: "close" | "resume" | "wait",
  ) => void | Promise<void>;
  pendingAction: SelectedSessionInlineDetailAction | null;
  queueReason?: string | null;
  runtimeDetailSummary?: string | null;
  selectedActionPending: boolean;
  selectedSession: {
    id: string;
    isCurrent?: boolean;
  };
}

export function SelectedSessionInlineHeader({
  canOpenSelectedSession,
  canResumeSelectedSession,
  canStopSelectedSession,
  detailSummary,
  isChildSession,
  onOpenSelectedSession,
  onSelectedSessionAction,
  pendingAction,
  queueReason,
  runtimeDetailSummary,
  selectedActionPending,
  selectedSession,
}: SelectedSessionInlineHeaderProps) {
  return (
    <>
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

      {runtimeDetailSummary ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
            {runtimeDetailSummary}
          </span>
        </div>
      ) : null}
      {queueReason ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
          {queueReason}
        </div>
      ) : null}
    </>
  );
}
