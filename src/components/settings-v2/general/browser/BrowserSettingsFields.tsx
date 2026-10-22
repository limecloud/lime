import type { ReactNode } from "react";

export function BrowserSettingsSection({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-medium">
          {title}
        </h2>
        {action}
      </div>
      <div className="rounded-xl border border-border bg-background px-4">
        {children}
      </div>
    </section>
  );
}

export function BrowserSettingsRow({
  id,
  label,
  description,
  leading,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      data-settings-search-target={id}
      tabIndex={-1}
      aria-labelledby={`${id}-label`}
      className="flex min-h-16 items-center justify-between gap-5 border-b border-border py-3 last:border-0"
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div id={`${id}-label`} className="text-sm">
          {label}
        </div>
        {description ? (
          <p
            id={`${id}-description`}
            className="mt-0.5 text-xs text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function BrowserSettingsSwitch({
  id,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-description`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 block size-4 rounded-full bg-primary-foreground shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

export const BROWSER_SETTINGS_BUTTON =
  "shrink-0 rounded-lg bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";
