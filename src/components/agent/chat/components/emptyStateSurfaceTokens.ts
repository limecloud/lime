export type EmptyStateTone = "slate" | "sky" | "emerald" | "amber" | "lime";

export const EMPTY_STATE_PANEL_CLASSNAME =
  "rounded-[26px] border border-lime-200/80 bg-white p-4 shadow-sm shadow-slate-950/5 md:p-5";

export const EMPTY_STATE_PANEL_EMBEDDED_CLASSNAME =
  "rounded-[22px] border border-lime-200/80 bg-white p-3.5 shadow-sm shadow-slate-950/5";

export const EMPTY_STATE_CARD_SURFACE_CLASSNAME =
  "overflow-hidden rounded-[22px] border border-lime-200/80 bg-white p-3.5 shadow-sm shadow-slate-950/5";

export const EMPTY_STATE_BADGE_BASE_CLASSNAME =
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm shadow-slate-950/5";

export const EMPTY_STATE_BADGE_TONE_CLASSNAMES: Record<EmptyStateTone, string> =
  {
    slate: "border-slate-200 bg-white/90 text-slate-700",
    sky: "border-sky-200 bg-sky-50/90 text-sky-700",
    emerald: "border-emerald-200 bg-emerald-50/90 text-emerald-700",
    amber: "border-amber-200 bg-amber-50/90 text-amber-700",
    lime: "border-lime-200 bg-lime-50/90 text-lime-700",
  };

export const EMPTY_STATE_ICON_TONE_CLASSNAMES: Record<EmptyStateTone, string> =
  {
    slate: "border-slate-200 bg-slate-100/90 text-slate-700",
    sky: "border-sky-200 bg-sky-100/90 text-sky-700",
    emerald: "border-emerald-200 bg-emerald-100/90 text-emerald-700",
    amber: "border-amber-200 bg-amber-100/90 text-amber-700",
    lime: "border-lime-200 bg-lime-100/90 text-lime-700",
  };

export const EMPTY_STATE_META_PILL_CLASSNAME =
  "rounded-full border border-lime-200/80 bg-lime-50/50 px-2 py-0.5 text-[10px] font-medium text-slate-600";

export const EMPTY_STATE_PRESET_BUTTON_CLASSNAME =
  "inline-flex items-center gap-2 rounded-full border border-lime-200/80 bg-lime-50/50 px-3 py-1.5 text-[13px] text-slate-600 shadow-sm shadow-slate-950/5 transition-colors hover:border-lime-300 hover:bg-white hover:text-slate-900";

export const EMPTY_STATE_SECONDARY_ACTION_BUTTON_CLASSNAME =
  "h-8 w-full rounded-full border border-lime-200/80 bg-lime-50/50 text-xs text-slate-700 shadow-none transition-colors hover:border-lime-300 hover:bg-white";

export const EMPTY_STATE_PRIMARY_ACTION_BUTTON_CLASSNAME =
  "h-9 w-full rounded-full border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-5 text-white shadow-sm shadow-emerald-950/15 transition hover:opacity-95 sm:w-auto";

export const EMPTY_STATE_RECOMMENDATION_CARD_CLASSNAME =
  "group flex min-w-0 flex-col items-start gap-2 rounded-[20px] border border-lime-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.97)_0%,rgba(247,254,231,0.9)_100%)] px-3.5 py-3.5 text-left shadow-sm shadow-slate-950/5 transition-colors hover:border-lime-300 hover:bg-white";

export const EMPTY_STATE_PAGE_CONTAINER_CLASSNAME =
  "relative flex min-h-full flex-1 flex-col items-stretch justify-start overflow-y-auto bg-transparent px-2 pb-5 pt-[clamp(2px,0.6vw,6px)] md:px-3";

export const EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME =
  "relative z-[1] mx-auto flex min-h-full w-full max-w-[1360px] flex-1 flex-col items-stretch gap-3";

export const EMPTY_STATE_THEME_TABS_CONTAINER_CLASSNAME =
  "flex w-full max-w-full flex-nowrap justify-start gap-1.5 overflow-x-auto overflow-y-hidden rounded-[20px] border border-lime-200/80 bg-lime-50/50 p-[5px] shadow-[0_10px_24px_-22px_rgba(15,23,42,0.18)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const EMPTY_STATE_SELECT_TRIGGER_CLASSNAME =
  "h-8 rounded-full border-lime-200/80 bg-white/92 px-3 text-xs text-slate-700 shadow-none transition-colors hover:border-lime-300 hover:bg-white focus:ring-1 focus:ring-lime-200";

export const EMPTY_STATE_PASSIVE_BADGE_CLASSNAME =
  "h-8 rounded-full border border-lime-200/80 bg-lime-50/50 px-3 text-xs font-normal text-slate-600 shadow-none hover:border-lime-300 hover:bg-white hover:text-slate-900";

export const EMPTY_STATE_ICON_TOOL_BUTTON_CLASSNAME =
  "ml-1 h-8 w-8 rounded-full border-lime-200/80 bg-white text-slate-500 shadow-none transition-colors hover:border-lime-300 hover:bg-lime-50 hover:text-slate-700";

const EMPTY_STATE_TOOL_TOGGLE_TONE_CLASSNAMES: Record<EmptyStateTone, string> =
  {
    slate:
      "border-slate-400 bg-slate-200 text-slate-900 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.28)] hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900",
    sky: "border-sky-300 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700",
    emerald:
      "border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700",
    amber:
      "border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700",
    lime: "border-lime-300 bg-lime-50 text-lime-700 hover:border-lime-300 hover:bg-lime-50 hover:text-lime-700",
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
      ? "border-lime-300 bg-white/95 text-slate-900 shadow-[0_10px_22px_-20px_rgba(15,23,42,0.24)]"
      : "border-transparent text-slate-600 hover:border-lime-200/90 hover:bg-white/80 hover:text-slate-900",
  ].join(" ");
}

export function getEmptyStateThemeTabIconClassName(active: boolean) {
  return [
    "flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
    active
      ? "border-lime-200 bg-white text-slate-700"
      : "border-transparent bg-transparent text-slate-400",
  ].join(" ");
}
