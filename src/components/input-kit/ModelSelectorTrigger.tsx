import { forwardRef, useContext, type ComponentProps } from "react";
import { Bot, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/icons/providers";
import { cn } from "@/lib/utils";
import { InlineControlLayoutContext } from "./InlineControlLayout";

interface ModelSelectorTriggerProps extends ComponentProps<typeof Button> {
  compact: boolean;
  open: boolean;
  providerType: string;
  providerLabel: string;
  modelLabel: string;
  reasoningLabel?: string;
  selectedProviderLabel: string;
  placeholderLabel?: string;
}

export const ModelSelectorTrigger = forwardRef<
  HTMLButtonElement,
  ModelSelectorTriggerProps
>(function ModelSelectorTrigger(
  {
    compact,
    open,
    providerType,
    providerLabel,
    modelLabel,
    reasoningLabel,
    selectedProviderLabel,
    placeholderLabel,
    ...props
  },
  ref,
) {
  const presentation = useContext(InlineControlLayoutContext);
  const hideLabel = compact && presentation === "compact";
  const label =
    placeholderLabel ??
    `${selectedProviderLabel} / ${modelLabel}${reasoningLabel ? ` · ${reasoningLabel}` : ""}`;
  const reasoning = reasoningLabel ? (
    <span data-testid="model-selector-effort" className="shrink-0 text-xs">
      · {reasoningLabel}
    </span>
  ) : null;
  return (
    <Button
      {...props}
      ref={ref}
      variant="outline"
      role="combobox"
      data-testid="model-selector"
      data-inline-control=""
      data-inline-control-label={hideLabel ? "hidden" : "visible"}
      aria-expanded={open}
      aria-label={label}
      title={compact ? label : undefined}
      className={cn(
        compact
          ? "h-8 max-w-[224px] justify-start gap-1.5 rounded-full border-slate-200/80 bg-white/92 text-slate-600 shadow-none transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-800"
          : "h-9 w-full min-w-0 justify-start gap-2 rounded-full border-slate-200/80 bg-white/92 px-3 font-normal text-slate-700 shadow-none transition-colors hover:border-slate-300 hover:bg-white",
        compact &&
          (hideLabel
            ? "w-8 min-w-8 justify-center px-0"
            : "min-w-[104px] px-2.5"),
        compact && open && "border-slate-300 bg-white text-slate-700",
      )}
    >
      {compact ? (
        <ProviderIcon
          providerType={providerType}
          fallbackText={providerLabel}
          size={15}
        />
      ) : (
        <Bot size={16} className="text-slate-500" />
      )}
      {!hideLabel ? (
        placeholderLabel !== undefined || compact ? (
          <span
            className={
              compact
                ? "min-w-0 flex-1 flex items-center gap-1 text-xs font-medium"
                : "min-w-0 flex-1 font-medium text-left text-slate-700"
            }
          >
            <span className="min-w-0 truncate">
              {compact ? modelLabel : placeholderLabel}
            </span>
            {compact ? reasoning : null}
          </span>
        ) : (
          <span className="min-w-0 flex-1 flex items-center gap-1.5">
            <span className="font-medium truncate">
              {selectedProviderLabel}
            </span>
            <span className="text-slate-300 shrink-0">/</span>
            <span className="text-sm text-slate-500 truncate">
              {modelLabel}
            </span>
            {reasoning}
          </span>
        )
      ) : null}
      {!hideLabel ? (
        <ChevronDown
          className={
            compact
              ? "h-3 w-3 shrink-0 text-slate-400 opacity-80"
              : "ml-1 h-3 w-3 text-slate-400 opacity-70"
          }
        />
      ) : null}
    </Button>
  );
});
