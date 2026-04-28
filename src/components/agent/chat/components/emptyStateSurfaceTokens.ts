export type EmptyStateTone = "slate" | "sky" | "emerald" | "amber" | "lime";

export const EMPTY_STATE_PANEL_CLASSNAME =
  "rounded-[26px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-4 shadow-sm shadow-slate-950/5 md:p-5";

export const EMPTY_STATE_PANEL_EMBEDDED_CLASSNAME =
  "rounded-[22px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-3.5 shadow-sm shadow-slate-950/5";

export const EMPTY_STATE_CARD_SURFACE_CLASSNAME =
  "overflow-hidden rounded-[22px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] p-3.5 shadow-sm shadow-slate-950/5";

export const EMPTY_STATE_BADGE_BASE_CLASSNAME =
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm shadow-slate-950/5";

export const EMPTY_STATE_BADGE_TONE_CLASSNAMES: Record<EmptyStateTone, string> =
  {
    slate:
      "border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]",
    sky: "border-[color:var(--lime-info-border)] bg-[color:var(--lime-info-soft)] text-[color:var(--lime-info)]",
    emerald:
      "border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-brand-soft)] text-[color:var(--lime-brand-strong)]",
    amber:
      "border-[color:var(--lime-warning-border)] bg-[color:var(--lime-warning-soft)] text-[color:var(--lime-warning)]",
    lime: "border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-brand-soft)] text-[color:var(--lime-brand-strong)]",
  };

export const EMPTY_STATE_ICON_TONE_CLASSNAMES: Record<EmptyStateTone, string> =
  {
    slate:
      "border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-muted)] text-[color:var(--lime-text)]",
    sky: "border-[color:var(--lime-info-border)] bg-[color:var(--lime-info-soft)] text-[color:var(--lime-info)]",
    emerald:
      "border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-brand-soft)] text-[color:var(--lime-brand-strong)]",
    amber:
      "border-[color:var(--lime-warning-border)] bg-[color:var(--lime-warning-soft)] text-[color:var(--lime-warning)]",
    lime: "border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-brand-soft)] text-[color:var(--lime-brand-strong)]",
  };

export const EMPTY_STATE_META_PILL_CLASSNAME =
  "rounded-full border border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-brand-soft)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--lime-text)]";

export const EMPTY_STATE_PRESET_BUTTON_CLASSNAME =
  "inline-flex items-center gap-2 rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-soft)] px-3 py-1.5 text-[13px] text-[color:var(--lime-text)] shadow-sm shadow-slate-950/5 transition-colors hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]";

export const EMPTY_STATE_SECONDARY_ACTION_BUTTON_CLASSNAME =
  "h-8 w-full rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-soft)] text-xs text-[color:var(--lime-text)] shadow-none transition-colors hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-surface)]";

export const EMPTY_STATE_PRIMARY_ACTION_BUTTON_CLASSNAME =
  "h-9 w-full rounded-full border border-[color:var(--lime-surface-border-strong)] bg-[image:var(--lime-primary-gradient)] px-5 text-white shadow-sm shadow-emerald-950/15 transition hover:opacity-95 sm:w-auto";

export const EMPTY_STATE_RECOMMENDATION_CARD_CLASSNAME =
  "group flex min-w-0 flex-col items-start gap-2 rounded-[20px] border border-[color:var(--lime-surface-border)] bg-[image:var(--lime-home-card-surface)] px-3.5 py-3.5 text-left shadow-sm shadow-slate-950/5 transition-colors hover:border-[color:var(--lime-home-card-hover-border)] hover:bg-[color:var(--lime-surface)]";

export const EMPTY_STATE_PAGE_CONTAINER_CLASSNAME =
  "relative flex min-h-full flex-1 flex-col items-stretch justify-start overflow-y-auto bg-transparent px-2 pb-5 pt-[clamp(2px,0.6vw,6px)] md:px-3";

export const EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME =
  "relative z-[1] mx-auto flex min-h-full w-full max-w-[1360px] flex-1 flex-col items-stretch gap-3";

export const EMPTY_STATE_THEME_TABS_CONTAINER_CLASSNAME =
  "flex w-full max-w-full flex-nowrap justify-start gap-1.5 overflow-x-auto overflow-y-hidden rounded-[20px] border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-soft)] p-[5px] shadow-[0_10px_24px_-22px_rgba(15,23,42,0.18)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const EMPTY_STATE_SELECT_TRIGGER_CLASSNAME =
  "h-8 rounded-full border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] px-3 text-xs text-[color:var(--lime-text)] shadow-none transition-colors hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-surface)] focus:ring-1 focus:ring-[color:var(--lime-surface-border-strong)]";

export const EMPTY_STATE_PASSIVE_BADGE_CLASSNAME =
  "h-8 rounded-full border border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface-soft)] px-3 text-xs font-normal text-[color:var(--lime-text)] shadow-none hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]";

export const EMPTY_STATE_ICON_TOOL_BUTTON_CLASSNAME =
  "ml-1 h-8 w-8 rounded-full border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text-muted)] shadow-none transition-colors hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-brand-soft)] hover:text-[color:var(--lime-brand-strong)]";

const EMPTY_STATE_TOOL_TOGGLE_TONE_CLASSNAMES: Record<EmptyStateTone, string> =
  {
    slate:
      "border-slate-400 bg-slate-200 text-slate-900 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.28)] hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900",
    sky: "border-[color:var(--lime-info-border)] bg-[color:var(--lime-info-soft)] text-[color:var(--lime-info)] hover:border-[color:var(--lime-info-border)] hover:bg-[color:var(--lime-info-soft)] hover:text-[color:var(--lime-info)]",
    emerald:
      "border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-brand-soft)] text-[color:var(--lime-brand-strong)] hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-brand-soft)] hover:text-[color:var(--lime-brand-strong)]",
    amber:
      "border-[color:var(--lime-warning-border)] bg-[color:var(--lime-warning-soft)] text-[color:var(--lime-warning)] hover:border-[color:var(--lime-warning-border)] hover:bg-[color:var(--lime-warning-soft)] hover:text-[color:var(--lime-warning)]",
    lime: "border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-brand-soft)] text-[color:var(--lime-brand-strong)] hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-brand-soft)] hover:text-[color:var(--lime-brand-strong)]",
  };

export function getEmptyStateIconToolButtonClassName(
  enabled: boolean,
  tone: EmptyStateTone,
) {
  return [
    EMPTY_STATE_ICON_TOOL_BUTTON_CLASSNAME,
    enabled ? EMPTY_STATE_TOOL_TOGGLE_TONE_CLASSNAMES[tone] : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function getEmptyStateThemeTabClassName(active: boolean) {
  return [
    "flex flex-none items-center gap-1.5 rounded-xl border px-3 py-[7px] text-xs font-medium leading-none transition-[background-color,border-color,color,box-shadow]",
    active
      ? "border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text-strong)] shadow-[0_10px_22px_-20px_rgba(15,23,42,0.24)]"
      : "border-transparent text-[color:var(--lime-text)] hover:border-[color:var(--lime-surface-border)] hover:bg-[color:var(--lime-surface)] hover:text-[color:var(--lime-text-strong)]",
  ].join(" ");
}

export function getEmptyStateThemeTabIconClassName(active: boolean) {
  return [
    "flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
    active
      ? "border-[color:var(--lime-surface-border)] bg-[color:var(--lime-surface)] text-[color:var(--lime-text)]"
      : "border-transparent bg-transparent text-[color:var(--lime-text-muted)]",
  ].join(" ");
}
