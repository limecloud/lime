import { A2UIRenderer } from "@/lib/workspace/a2ui";
import { cn } from "@/lib/utils";
import type {
  A2UIFormData,
  A2UIResponse,
} from "@/lib/workspace/a2ui";
import {
  DEFAULT_A2UI_TASK_CARD_PRESET,
  type A2UITaskCardPreset,
} from "@/lib/workspace/a2ui";
import {
  A2UITaskCardBody,
  A2UITaskCardHeader,
  A2UITaskCardLoadingBody,
  A2UITaskCardShell,
  type A2UITaskCardSurface,
} from "@/lib/workspace/a2ui";

export interface A2UITaskCardProps {
  response: A2UIResponse;
  onSubmit?: (formData: A2UIFormData) => void;
  onFormStateChange?: (formData: A2UIFormData) => void;
  formId?: string;
  initialFormData?: A2UIFormData;
  onFormChange?: (formId: string, formData: A2UIFormData) => void;
  submitDisabled?: boolean;
  className?: string;
  compact?: boolean;
  preset?: A2UITaskCardPreset;
  title?: string;
  subtitle?: string;
  statusLabel?: string;
  footerText?: string;
  preview?: boolean;
  surface?: A2UITaskCardSurface;
}

interface A2UITaskLoadingCardProps {
  className?: string;
  compact?: boolean;
  preset?: A2UITaskCardPreset;
  title?: string;
  subtitle?: string;
  statusLabel?: string;
  loadingText?: string;
}

function getCardCopy(
  compact: boolean,
  preset: A2UITaskCardPreset,
  title?: string,
  subtitle?: string,
) {
  return {
    title: title || preset.title,
    subtitle:
      subtitle ||
      (compact ? preset.subtitle.replace("当前对话。", "。") : preset.subtitle),
  };
}

function getRendererClassName(
  compact: boolean,
  surface: A2UITaskCardSurface,
): string {
  return cn(
    compact ? "space-y-3" : "space-y-4",
    surface === "embedded" &&
      "space-y-2.5 text-[13px] leading-5 [&_.a2ui-text-h3]:text-[15px] [&_.a2ui-text-h3]:leading-6 [&_.a2ui-text-h3]:font-semibold [&_.a2ui-text-h4]:text-[13px] [&_.a2ui-text-h4]:leading-5 [&_.a2ui-text-h4]:font-medium [&_.a2ui-text-body]:text-[13px] [&_.a2ui-text-body]:leading-5 [&_.a2ui-text-body]:text-slate-700 [&_.a2ui-field-stack]:space-y-1.5 [&_.a2ui-field-label]:text-[12px] [&_.a2ui-field-label]:leading-5 [&_.a2ui-helper-text]:text-[11px] [&_.a2ui-helper-text]:leading-4 [&_.a2ui-option-list]:gap-2.5 [&_.a2ui-choice-option]:rounded-[16px] [&_.a2ui-choice-option]:px-3.5 [&_.a2ui-choice-option]:py-3 [&_.a2ui-choice-option]:text-[13px] [&_.a2ui-choice-option-title]:text-[13px] [&_.a2ui-choice-option-title]:leading-5 [&_.a2ui-option-description]:mt-1 [&_.a2ui-option-description]:text-[11px] [&_.a2ui-option-description]:leading-4 [&_.a2ui-text-input]:h-10 [&_.a2ui-text-input]:rounded-[16px] [&_.a2ui-text-input]:px-3 [&_.a2ui-text-input]:text-[13px] [&_.a2ui-textarea]:min-h-[84px] [&_.a2ui-textarea]:rounded-[16px] [&_.a2ui-textarea]:px-3 [&_.a2ui-textarea]:py-2.5 [&_.a2ui-textarea]:text-[13px] [&_.a2ui-textarea]:leading-5 [&_.a2ui-card-shell]:rounded-[16px] [&_.a2ui-card-shell]:border-slate-200/90 [&_.a2ui-card-shell]:bg-white [&_.a2ui-card-shell]:p-3 [&_.a2ui-card-shell]:shadow-none",
  );
}

export function A2UITaskCard({
  response,
  onSubmit,
  onFormStateChange,
  formId,
  initialFormData,
  onFormChange,
  submitDisabled = false,
  className,
  compact = false,
  preset = DEFAULT_A2UI_TASK_CARD_PRESET,
  title,
  subtitle,
  statusLabel = preset.statusLabel,
  footerText,
  preview = false,
  surface = "default",
}: A2UITaskCardProps) {
  const copy = getCardCopy(compact, preset, title, subtitle);
  const rendererClassName = getRendererClassName(compact, surface);
  const submitButtonClassName = cn(
    "w-full",
    surface === "embedded" && "h-10 rounded-[16px] px-4 text-[13px]",
  );

  return (
    <A2UITaskCardShell
      compact={compact}
      className={className}
      preview={preview}
      surface={surface}
      testId="agent-a2ui-task-card"
    >
      <A2UITaskCardHeader
        title={copy.title}
        subtitle={copy.subtitle}
        compact={compact}
        statusLabel={statusLabel}
        surface={surface}
      />

      <A2UITaskCardBody compact={compact} surface={surface}>
        <A2UIRenderer
          key={response.id}
          response={response}
          onSubmit={onSubmit}
          onFormStateChange={onFormStateChange}
          formId={formId}
          initialFormData={initialFormData}
          onFormChange={onFormChange}
          submitDisabled={submitDisabled}
          submitButtonClassName={submitButtonClassName}
          className={rendererClassName}
        />
      </A2UITaskCardBody>

      {footerText ? (
        <div className="mt-3 text-xs text-slate-500">{footerText}</div>
      ) : null}
    </A2UITaskCardShell>
  );
}

export function A2UITaskLoadingCard({
  className,
  compact = false,
  preset = DEFAULT_A2UI_TASK_CARD_PRESET,
  title,
  subtitle,
  statusLabel = preset.statusLabel,
  loadingText = preset.loadingText || DEFAULT_A2UI_TASK_CARD_PRESET.loadingText,
}: A2UITaskLoadingCardProps) {
  const copy = getCardCopy(compact, preset, title, subtitle);

  return (
    <A2UITaskCardShell
      compact={compact}
      className={className}
      testId="agent-a2ui-task-loading-card"
    >
      <A2UITaskCardHeader
        title={copy.title}
        subtitle={copy.subtitle}
        compact={compact}
        statusLabel={statusLabel}
      />

      <A2UITaskCardLoadingBody compact={compact} text={loadingText || ""} />
    </A2UITaskCardShell>
  );
}

export default A2UITaskCard;
