import { useEffect, useRef, useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import {
  updateBrowserDesignChange,
  type BrowserDesignChange,
  type BrowserDesignLabels,
  type BrowserDesignSnapshot,
} from "@/lib/api/browserDesign";

export function BrowserDesignEditor({
  snapshot,
  change,
  labels,
  disabled,
  onChange,
  onInvalid,
}: {
  snapshot: BrowserDesignSnapshot;
  change: BrowserDesignChange | null;
  labels: BrowserDesignLabels;
  disabled: boolean;
  onChange: (change: BrowserDesignChange | null) => void;
  onInvalid: (invalid: boolean) => void;
}) {
  const invalid = useRef(new Set<string>());
  const [reset, setReset] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const update = (property: string, value: string, valid: boolean) => {
    if (valid) invalid.current.delete(property);
    else invalid.current.add(property);
    setInvalidCount(invalid.current.size);
    onInvalid(invalid.current.size > 0);
    if (valid)
      onChange(updateBrowserDesignChange(snapshot, change, property, value));
  };
  return (
    <details
      className="min-h-0 shrink overflow-hidden border-t border-border pt-2"
      data-testid="browser-design-editor"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground">
        <SlidersHorizontal className="size-3.5" aria-hidden="true" />
        {labels.title}
      </summary>
      <div className="mt-2 max-h-[200px] space-y-2 overflow-y-auto pr-1">
        {snapshot.text ? (
          <DesignField
            key={`text-${reset}`}
            property="text"
            label={labels.text}
            value={change?.text?.value ?? snapshot.text.value}
            disabled={disabled}
            invalidLabel={labels.invalid}
            onChange={update}
          />
        ) : null}
        {snapshot.declarations.map((item) => (
          <DesignField
            key={`${item.property}-${reset}`}
            property={item.property}
            label={item.property}
            value={
              change?.declarations.find(
                (declaration) => declaration.property === item.property,
              )?.value ?? item.value
            }
            disabled={disabled}
            invalidLabel={labels.invalid}
            onChange={update}
          />
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || (!change && !invalidCount)}
        className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-50"
        onClick={() => {
          invalid.current.clear();
          setInvalidCount(0);
          onInvalid(false);
          setReset((value) => value + 1);
          onChange(null);
        }}
      >
        <RotateCcw className="size-3" aria-hidden="true" />
        {labels.reset}
      </button>
    </details>
  );
}

function DesignField({
  property,
  label,
  value,
  disabled,
  invalidLabel,
  onChange,
}: {
  property: string;
  label: string;
  value: string;
  disabled: boolean;
  invalidLabel: string;
  onChange: (property: string, value: string, valid: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);
  const change = (next: string) => {
    let valid = next.length <= (property === "text" ? 20_000 : 4096);
    if (property !== "text") {
      const style = document.createElement("span").style;
      style.setProperty(property, next, "important");
      valid =
        valid &&
        !!next.trim() &&
        !/[;{}<>]/u.test(next) &&
        !!style.getPropertyValue(property);
    }
    setDraft(next);
    setInvalid(!valid);
    onChange(property, next, valid);
  };
  return (
    <label className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-x-2 gap-y-1 text-xs">
      <span className="break-words">{label}</span>
      {property === "text" ? (
        <textarea
          aria-label={label}
          rows={2}
          maxLength={20_000}
          disabled={disabled}
          value={draft}
          aria-invalid={invalid}
          onChange={(event) => change(event.target.value)}
          className="min-w-0 resize-y rounded-md border border-input bg-background px-2 py-1"
        />
      ) : (
        <input
          aria-label={label}
          disabled={disabled}
          value={draft}
          aria-invalid={invalid}
          onChange={(event) => change(event.target.value)}
          className="min-w-0 rounded-md border border-input bg-background px-2 py-1"
        />
      )}
      {invalid ? (
        <span role="alert" className="col-span-2 text-destructive">
          {invalidLabel}
        </span>
      ) : null}
    </label>
  );
}
