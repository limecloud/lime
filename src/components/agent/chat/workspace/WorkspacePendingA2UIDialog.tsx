import type {
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";
import { CHAT_A2UI_TASK_CARD_PRESET } from "@/lib/workspace/a2ui";
import { A2UITaskCard } from "../components/A2UITaskCard";
import {
  A2UISubmissionNotice,
  type A2UISubmissionNoticeData,
} from "../components/Inputbar/components/A2UISubmissionNotice";
import { useA2UISubmissionNotice } from "../components/Inputbar/hooks/useA2UISubmissionNotice";
import { useStickyA2UIForm } from "../components/Inputbar/hooks/useStickyA2UIForm";
import { readProgressiveA2UIProgressMeta } from "../utils/progressivePendingA2UI";

interface WorkspacePendingA2UIDialogProps {
  pendingA2UIForm?: A2UIResponse | null;
  onA2UISubmit?: (formData: A2UIFormData) => void;
  a2uiSubmissionNotice?: A2UISubmissionNoticeData | null;
}

const STALE_STATUS_LABEL = "同步中";
const STALE_FOOTER_TEXT = "正在同步最新上下文，表单暂时不可提交。";

export function WorkspacePendingA2UIDialog({
  pendingA2UIForm = null,
  onA2UISubmit,
  a2uiSubmissionNotice = null,
}: WorkspacePendingA2UIDialogProps) {
  const { visibleForm, isStale } = useStickyA2UIForm({
    form: pendingA2UIForm,
    clearImmediately: Boolean(a2uiSubmissionNotice),
  });
  const { visibleNotice, isVisible: isSubmissionNoticeVisible } =
    useA2UISubmissionNotice({
      notice: a2uiSubmissionNotice,
      enabled: Boolean(a2uiSubmissionNotice),
    });
  const shouldRender =
    Boolean(visibleNotice) || Boolean(visibleForm && onA2UISubmit);
  const toneClassName = visibleForm
    ? "border-slate-200/90 bg-white"
    : "border-emerald-200/90 bg-emerald-50/70";
  const progressMeta = readProgressiveA2UIProgressMeta(visibleForm);
  const statusLabel = isStale
    ? STALE_STATUS_LABEL
    : progressMeta
      ? `第 ${progressMeta.currentStep}/${progressMeta.totalSteps} 步`
      : undefined;
  const footerText = isStale
    ? STALE_FOOTER_TEXT
    : progressMeta && !progressMeta.isFinalStep
      ? "问题会分步出现，先完成这一步。"
      : undefined;

  if (!shouldRender) {
    return null;
  }

  return (
    <section
      data-testid="workspace-pending-a2ui-dialog"
      className={`mx-4 mb-3 shrink-0 space-y-3 rounded-[22px] border px-3 py-3 shadow-sm shadow-slate-950/5 ${toneClassName}`}
    >
      {visibleNotice ? (
        <div className="rounded-[18px] border border-emerald-200/90 bg-white px-2 py-2">
          <A2UISubmissionNotice
            notice={visibleNotice}
            visible={isSubmissionNoticeVisible}
          />
        </div>
      ) : null}

      {visibleForm && onA2UISubmit ? (
        <div
          data-testid="workspace-pending-a2ui-scroll-area"
          className="min-h-0 max-h-[min(44vh,420px)] overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable] [scrollbar-width:thin]"
        >
          <A2UITaskCard
            response={visibleForm}
            onSubmit={onA2UISubmit}
            submitDisabled={isStale}
            preset={CHAT_A2UI_TASK_CARD_PRESET}
            statusLabel={statusLabel}
            footerText={footerText}
            compact={true}
            surface="embedded"
            className="m-0"
          />
        </div>
      ) : null}
    </section>
  );
}
