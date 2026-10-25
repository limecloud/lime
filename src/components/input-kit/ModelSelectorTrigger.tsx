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
    `${selectedProviderLabel} / ${modelLabel}${reasoningLabel ? ` ${reasoningLabel}` : ""}`;
  const reasoning = reasoningLabel ? (
    <span
      data-testid="model-selector-effort"
      className="shrink-0 text-xs text-muted-foreground"
    >
      {reasoningLabel}
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
          ? "h-7 max-w-[224px] justify-start gap-1 rounded-md border-[0.5px] border-transparent bg-transparent font-normal text-foreground shadow-none hover:bg-muted"
          : "h-9 w-full min-w-0 justify-start gap-2 rounded-md border-[0.5px] border-border bg-background px-3 font-normal text-foreground shadow-none hover:border-border hover:bg-muted",
        compact &&
          (hideLabel ? "w-8 min-w-8 justify-center px-0" : "min-w-0 px-1"),
        compact && open && "border-border bg-muted text-foreground",
      )}
    >
      {compact && hideLabel ? (
        <ProviderIcon
          providerType={providerType}
          fallbackText={providerLabel}
          size={15}
        />
      ) : !compact ? (
        <Bot size={16} className="text-muted-foreground" />
      ) : null}
      {!hideLabel ? (
        placeholderLabel !== undefined || compact ? (
          <span
            className={
              compact
                ? "min-w-0 flex-1 flex items-center gap-1 text-xs font-medium"
                : "min-w-0 flex-1 font-medium text-left text-foreground"
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
            <span className="text-muted-foreground shrink-0">/</span>
            <span className="text-sm text-muted-foreground truncate">
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
              ? "h-3 w-3 shrink-0 text-muted-foreground opacity-80"
              : "ml-1 h-3 w-3 text-muted-foreground opacity-70"
          }
        />
      ) : null}
    </Button>
  );
});
