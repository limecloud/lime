import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { WorkbenchInfoTip } from "@/components/media/WorkbenchInfoTip";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingModelSelectorField } from "./SettingModelSelectorField";

type SelectorFieldProps = ComponentProps<typeof SettingModelSelectorField>;

interface MediaPreferenceSectionProps
  extends Pick<
    SelectorFieldProps,
    | "activeTheme"
    | "disabled"
    | "emptyStateDescription"
    | "emptyStateTitle"
    | "model"
    | "modelFilter"
    | "providerFilter"
    | "providerType"
    | "setModel"
    | "setProviderType"
  > {
  title: string;
  description: string;
  selectorLabel: string;
  selectorDescription: string;
  selectionWarningText?: string;
  allowFallback: boolean;
  onAllowFallbackChange: (value: boolean) => void;
  fallbackTitle: string;
  fallbackDescription: string;
  resetLabel?: string;
  onReset?: () => void;
  resetDisabled?: boolean;
}

export function MediaPreferenceSection({
  title,
  description,
  selectorLabel,
  selectorDescription,
  selectionWarningText,
  allowFallback,
  onAllowFallbackChange,
  fallbackTitle,
  fallbackDescription,
  activeTheme,
  disabled = false,
  emptyStateTitle,
  emptyStateDescription,
  providerType,
  setProviderType,
  model,
  setModel,
  providerFilter,
  modelFilter,
  resetLabel,
  onReset,
  resetDisabled = false,
}: MediaPreferenceSectionProps) {
  return (
    <section className="overflow-visible rounded-[24px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            {title}
          </h3>
          <WorkbenchInfoTip
            ariaLabel={`${title}说明`}
            content={description}
            tone="slate"
          />
        </div>
        {onReset ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={disabled || resetDisabled}
            className="rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          >
            {resetLabel ?? "恢复默认"}
          </Button>
        ) : null}
      </div>

      <div className="divide-y divide-slate-200/80 border-t border-slate-200/80">
        <SettingModelSelectorField
          label={selectorLabel}
          description={selectorDescription}
          warningText={selectionWarningText}
          disabled={disabled}
          emptyStateTitle={emptyStateTitle}
          emptyStateDescription={emptyStateDescription}
          activeTheme={activeTheme}
          providerType={providerType}
          setProviderType={setProviderType}
          model={model}
          setModel={setModel}
          providerFilter={providerFilter}
          modelFilter={modelFilter}
          placeholderLabel="自动选择"
          layoutLabelWidthClassName="md:grid-cols-[180px_minmax(0,1fr)]"
        />

        <div className="grid gap-3 px-5 py-4 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
          <div className="space-y-1">
            <Label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <span>{fallbackTitle}</span>
              <WorkbenchInfoTip
                ariaLabel={`${fallbackTitle}说明`}
                content={fallbackDescription}
                tone="slate"
              />
            </Label>
          </div>
          <div className="flex items-center justify-start md:justify-end">
            <Switch
              checked={allowFallback}
              onCheckedChange={onAllowFallbackChange}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
