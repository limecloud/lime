import { Clock3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type SelectedSessionInlineDetailAction =
  | "close"
  | "interrupt_send"
  | "resume"
  | "send"
  | "wait";

interface SelectedSessionInlineCollaborationSectionProps {
  canSendSelectedSessionInput: boolean;
  canWaitSelectedSession: boolean;
  inlineDetailSectionClassName: string;
  onSelectedSessionAction: (
    action: "close" | "resume" | "wait",
  ) => void | Promise<void>;
  onSelectedSessionInputDraftChange: (value: string) => void;
  onSelectedSessionSendInput: (interrupt: boolean) => void | Promise<void>;
  pendingAction: SelectedSessionInlineDetailAction | null;
  selectedActionPending: boolean;
  selectedSessionInputDraft: string;
  selectedSessionInputMessage: string;
}

export function SelectedSessionInlineCollaborationSection({
  canSendSelectedSessionInput,
  canWaitSelectedSession,
  inlineDetailSectionClassName,
  onSelectedSessionAction,
  onSelectedSessionInputDraftChange,
  onSelectedSessionSendInput,
  pendingAction,
  selectedActionPending,
  selectedSessionInputDraft,
  selectedSessionInputMessage,
}: SelectedSessionInlineCollaborationSectionProps) {
  if (!canWaitSelectedSession && !canSendSelectedSessionInput) {
    return null;
  }

  return (
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
              disabled={selectedActionPending || !selectedSessionInputMessage}
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
              disabled={selectedActionPending || !selectedSessionInputMessage}
              onClick={() => void onSelectedSessionSendInput(true)}
            >
              {selectedActionPending && pendingAction === "interrupt_send" ? (
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
  );
}
