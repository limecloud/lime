import { cn } from "@/lib/utils";

export const A2UI_FORM_TOKENS = {
  fieldStack: "a2ui-field-stack space-y-2",
  fieldLabel: "a2ui-field-label text-sm font-medium text-slate-900",
  helperText: "a2ui-helper-text text-xs text-muted-foreground",
  optionList: "a2ui-option-list flex gap-3",
  optionBase:
    "a2ui-choice-option group rounded-[20px] border px-5 py-4 text-left text-sm transition-all",
  optionSelected:
    "border-primary/70 bg-white text-slate-900 shadow-[0_8px_24px_rgba(37,99,235,0.10)] ring-2 ring-primary/10",
  optionIdle:
    "border-slate-200 bg-white hover:border-primary/30 hover:bg-slate-50",
  optionTitle: "a2ui-choice-option-title flex items-center gap-2 font-medium",
  optionTitleSelected: "text-slate-900",
  optionTitleIdle: "text-slate-800",
  optionDescription:
    "a2ui-option-description mt-1.5 text-xs leading-5 text-muted-foreground",
  radioIndicatorBase:
    "mt-0.5 inline-flex h-6 w-6 shrink-0 rounded-full border transition-colors",
  radioIndicatorSelected:
    "border-primary bg-primary shadow-[inset_0_0_0_5px_white]",
  radioIndicatorIdle: "border-slate-300 bg-white group-hover:border-primary/60",
  checkboxIndicatorBase:
    "mt-0.5 inline-flex h-5 w-5 shrink-0 rounded-md border transition-colors",
  checkboxIndicatorSelected:
    "border-primary bg-primary shadow-[inset_0_0_0_4px_white]",
  checkboxIndicatorIdle:
    "border-slate-300 bg-white group-hover:border-primary/60",
  textInput:
    "a2ui-text-input h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm shadow-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10",
  textarea:
    "a2ui-textarea min-h-[96px] w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 shadow-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10",
  checkboxRow: "flex items-center gap-3 cursor-pointer",
  checkboxInput:
    "h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/10",
  checkboxText: "text-sm text-slate-800",
  sliderRow: "flex items-center justify-between",
  sliderValue: "text-sm text-muted-foreground",
  sliderInput: "w-full accent-primary",
  sliderMarks: "flex justify-between text-xs text-muted-foreground",
} as const;

export function getA2UIChoiceOptionClasses(
  isWrap: boolean,
  isSelected: boolean,
): string {
  return cn(
    A2UI_FORM_TOKENS.optionBase,
    isWrap ? "min-w-[180px] flex-1" : "w-full",
    isSelected ? A2UI_FORM_TOKENS.optionSelected : A2UI_FORM_TOKENS.optionIdle,
  );
}

export function getA2UIChoiceTitleClasses(isSelected: boolean): string {
  return cn(
    A2UI_FORM_TOKENS.optionTitle,
    isSelected
      ? A2UI_FORM_TOKENS.optionTitleSelected
      : A2UI_FORM_TOKENS.optionTitleIdle,
  );
}

export function getA2UIChoiceIndicatorClasses(
  isMutuallyExclusive: boolean,
  isSelected: boolean,
): string {
  if (isMutuallyExclusive) {
    return cn(
      A2UI_FORM_TOKENS.radioIndicatorBase,
      isSelected
        ? A2UI_FORM_TOKENS.radioIndicatorSelected
        : A2UI_FORM_TOKENS.radioIndicatorIdle,
    );
  }

  return cn(
    A2UI_FORM_TOKENS.checkboxIndicatorBase,
    isSelected
      ? A2UI_FORM_TOKENS.checkboxIndicatorSelected
      : A2UI_FORM_TOKENS.checkboxIndicatorIdle,
  );
}

export default A2UI_FORM_TOKENS;
