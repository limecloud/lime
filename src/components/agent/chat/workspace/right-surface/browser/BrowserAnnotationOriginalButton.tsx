import type { BrowserTabState } from "@/lib/api/browserTab";
import { useEffect } from "react";
import { useBrowserAnnotationOriginal } from "./useBrowserAnnotationOriginal";

export function BrowserAnnotationOriginalButton({
  selected,
  disabled,
  label,
  hint,
  onFailure,
  onError,
}: {
  selected: BrowserTabState | null;
  disabled: boolean;
  label: string;
  hint: string;
  onFailure: (failed: boolean) => void;
  onError: (error: unknown) => void;
}) {
  const original = useBrowserAnnotationOriginal(selected, !disabled, onError);
  useEffect(() => {
    onFailure(original.failure);
  }, [onFailure, original.failure]);
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={hint}
      title={hint}
      aria-pressed={original.pressed}
      className="inline-flex h-7 items-center rounded-md px-2 text-xs text-[color:var(--lime-text-muted)] hover:bg-[color:var(--lime-surface-hover)] aria-pressed:bg-[color:var(--lime-surface-hover)] disabled:opacity-35"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        original.start();
      }}
      onPointerUp={(event) => {
        if (event.button === 0) original.stop();
      }}
      onPointerCancel={original.stop}
      onLostPointerCapture={original.stop}
      onBlur={original.stop}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) original.start();
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        original.stop();
      }}
      onClick={(event) => event.preventDefault()}
    >
      {label}
    </button>
  );
}
