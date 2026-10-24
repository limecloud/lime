import { useState } from "react";
import {
  browserDeviceLimits,
  clampBrowserDeviceDimension,
} from "@/lib/browserDeviceLayout";

export function BrowserDeviceDimension({
  dimension,
  value,
  label,
  onChange,
}: {
  dimension: "width" | "height";
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const { min, max } = browserDeviceLimits[dimension];
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={1}
      aria-label={label}
      title={label}
      data-testid={`browser-device-${dimension}`}
      className="h-6 w-[72px] rounded-lg border border-transparent bg-foreground/5 px-2 text-center text-sm font-semibold tabular-nums outline-none hover:bg-muted focus:border-ring focus:bg-background"
      value={draft ?? String(value)}
      onFocus={() => setDraft(String(value))}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
        const number = event.currentTarget.valueAsNumber;
        if (Number.isFinite(number) && number >= min && number <= max)
          onChange(clampBrowserDeviceDimension(dimension, number));
      }}
      onBlur={(event) => {
        const number = event.currentTarget.valueAsNumber;
        setDraft(null);
        if (Number.isFinite(number))
          onChange(clampBrowserDeviceDimension(dimension, number));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
