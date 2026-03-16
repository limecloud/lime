import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface MediaPreferenceSectionModelOption {
  value: string;
  label: string;
}

export interface MediaPreferenceSectionProviderOption {
  value: string;
  label: string;
}

interface MediaPreferenceSectionProps {
  title: string;
  description: string;
  providerLabel: string;
  providerValue: string;
  providerAutoLabel: string;
  onProviderChange: (value: string) => void;
  providers: MediaPreferenceSectionProviderOption[];
  providerUnavailableLabel?: string;
  modelLabel: string;
  modelValue: string;
  modelAutoLabel: string;
  onModelChange: (value: string) => void;
  models: MediaPreferenceSectionModelOption[];
  modelUnavailableLabel?: string;
  modelHint: string;
  allowFallback: boolean;
  onAllowFallbackChange: (value: boolean) => void;
  fallbackTitle: string;
  fallbackDescription: string;
  emptyHint?: string;
  disabled?: boolean;
  modelDisabled?: boolean;
  resetLabel?: string;
  onReset?: () => void;
  resetDisabled?: boolean;
}

export function MediaPreferenceSection({
  title,
  description,
  providerLabel,
  providerValue,
  providerAutoLabel,
  onProviderChange,
  providers,
  providerUnavailableLabel,
  modelLabel,
  modelValue,
  modelAutoLabel,
  onModelChange,
  models,
  modelUnavailableLabel,
  modelHint,
  allowFallback,
  onAllowFallbackChange,
  fallbackTitle,
  fallbackDescription,
  emptyHint,
  disabled = false,
  modelDisabled = false,
  resetLabel,
  onReset,
  resetDisabled = false,
}: MediaPreferenceSectionProps) {
  return (
    <div className="space-y-5 rounded-[24px] border border-slate-200/80 bg-white/95 p-5 shadow-sm shadow-slate-950/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-slate-900">
            {title}
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
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

      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">
          {providerLabel}
        </Label>
        <Select
          value={providerValue}
          onValueChange={onProviderChange}
          disabled={disabled}
        >
          <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white text-slate-900 shadow-sm shadow-slate-950/5 focus:ring-slate-300">
            <SelectValue placeholder={providerLabel} />
          </SelectTrigger>
          <SelectContent className="rounded-2xl border-slate-200 bg-white p-1 shadow-xl shadow-slate-950/8">
            <SelectItem value="__auto__">{providerAutoLabel}</SelectItem>
            {providerUnavailableLabel ? (
              <SelectItem value={providerValue}>
                {providerUnavailableLabel}
              </SelectItem>
            ) : null}
            {providers.map((provider) => (
              <SelectItem key={provider.value} value={provider.value}>
                {provider.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {emptyHint ? (
          <p className="text-xs leading-5 text-slate-500">{emptyHint}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">
          {modelLabel}
        </Label>
        <Select
          value={modelValue}
          onValueChange={onModelChange}
          disabled={disabled || modelDisabled}
        >
          <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-white text-slate-900 shadow-sm shadow-slate-950/5 focus:ring-slate-300">
            <SelectValue placeholder={modelLabel} />
          </SelectTrigger>
          <SelectContent className="rounded-2xl border-slate-200 bg-white p-1 shadow-xl shadow-slate-950/8">
            <SelectItem value="__auto__">{modelAutoLabel}</SelectItem>
            {modelUnavailableLabel ? (
              <SelectItem value={modelValue}>
                {modelUnavailableLabel}
              </SelectItem>
            ) : null}
            {models.map((model) => (
              <SelectItem key={model.value} value={model.value}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs leading-5 text-slate-500">{modelHint}</p>
      </div>

      <div className="flex items-center justify-between rounded-[20px] border border-slate-200/80 bg-slate-50/80 px-4 py-4">
        <div className="space-y-1">
          <Label className="text-sm font-medium text-slate-800">
            {fallbackTitle}
          </Label>
          <p className="text-xs leading-5 text-slate-500">
            {fallbackDescription}
          </p>
        </div>
        <Switch
          checked={allowFallback}
          onCheckedChange={onAllowFallbackChange}
        />
      </div>
    </div>
  );
}

export default MediaPreferenceSection;
