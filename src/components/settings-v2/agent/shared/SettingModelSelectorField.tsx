import type { ComponentProps } from "react";
import { ModelSelector } from "@/components/input-kit";
import { Label } from "@/components/ui/label";

type SelectorProps = ComponentProps<typeof ModelSelector>;

interface SettingModelSelectorFieldProps
  extends Pick<
    SelectorProps,
    | "activeTheme"
    | "allowAutoModel"
    | "allowAutoProvider"
    | "autoModelLabel"
    | "autoProviderLabel"
    | "disabled"
    | "emptyStateDescription"
    | "emptyStateTitle"
    | "model"
    | "modelFilter"
    | "onManageProviders"
    | "placeholderLabel"
    | "popoverSide"
    | "providerFilter"
    | "providerType"
    | "setModel"
    | "setProviderType"
    | "suppressAutoSelection"
  > {
  label: string;
  description: string;
  warningText?: string;
  layoutLabelWidthClassName?: string;
}

export function SettingModelSelectorField({
  label,
  description,
  warningText,
  layoutLabelWidthClassName = "md:grid-cols-[220px_minmax(0,1fr)]",
  popoverSide = "bottom",
  allowAutoProvider = true,
  allowAutoModel = true,
  placeholderLabel = "自动选择",
  suppressAutoSelection = true,
  ...selectorProps
}: SettingModelSelectorFieldProps) {
  return (
    <div
      className={`grid gap-3 px-5 py-4 ${layoutLabelWidthClassName} md:items-center`}
    >
      <div className="space-y-1.5">
        <Label className="text-sm font-medium text-slate-800">{label}</Label>
        <p className="text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="space-y-2">
        <ModelSelector
          {...selectorProps}
          className="w-full"
          popoverSide={popoverSide}
          allowAutoProvider={allowAutoProvider}
          allowAutoModel={allowAutoModel}
          placeholderLabel={placeholderLabel}
          suppressAutoSelection={suppressAutoSelection}
        />
        {warningText ? (
          <p className="text-xs leading-5 text-amber-700">{warningText}</p>
        ) : null}
      </div>
    </div>
  );
}
