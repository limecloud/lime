export type EmptyStateTone = "slate" | "sky" | "emerald" | "amber";

export const EMPTY_STATE_PANEL_CLASSNAME =
  "rounded-[26px] border border-slate-200/80 bg-white/84 p-4 shadow-sm shadow-slate-950/5 backdrop-blur-sm md:p-5";

export const EMPTY_STATE_PANEL_EMBEDDED_CLASSNAME =
  "rounded-[22px] border border-white/85 bg-white/76 p-3.5 shadow-sm shadow-slate-950/5 backdrop-blur-sm";

export const EMPTY_STATE_CARD_SURFACE_CLASSNAME =
  "overflow-hidden rounded-[22px] border border-white/90 bg-white/82 p-3.5 shadow-sm shadow-slate-950/5 backdrop-blur-sm";

export const EMPTY_STATE_BADGE_BASE_CLASSNAME =
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-sm shadow-slate-950/5";

export const EMPTY_STATE_BADGE_TONE_CLASSNAMES: Record<EmptyStateTone, string> =
  {
    slate: "border-slate-200 bg-white/90 text-slate-700",
    sky: "border-sky-200 bg-sky-50/90 text-sky-700",
    emerald: "border-emerald-200 bg-emerald-50/90 text-emerald-700",
    amber: "border-amber-200 bg-amber-50/90 text-amber-700",
  };

export const EMPTY_STATE_ICON_TONE_CLASSNAMES: Record<EmptyStateTone, string> =
  {
    slate: "border-slate-200 bg-slate-100/90 text-slate-700",
    sky: "border-sky-200 bg-sky-100/90 text-sky-700",
    emerald: "border-emerald-200 bg-emerald-100/90 text-emerald-700",
    amber: "border-amber-200 bg-amber-100/90 text-amber-700",
  };

export const EMPTY_STATE_META_PILL_CLASSNAME =
  "rounded-full border border-slate-200/80 bg-white/90 px-2 py-0.5 text-[10px] font-medium text-slate-500";

export const EMPTY_STATE_PRESET_BUTTON_CLASSNAME =
  "inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/92 px-3 py-1.5 text-[13px] text-slate-600 shadow-sm shadow-slate-950/5 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900";

export const EMPTY_STATE_SECONDARY_ACTION_BUTTON_CLASSNAME =
  "h-8 w-full rounded-full border-slate-200/80 bg-white/88 text-xs text-slate-700 shadow-none transition-colors hover:border-slate-300 hover:bg-white";

export const EMPTY_STATE_PRIMARY_ACTION_BUTTON_CLASSNAME =
  "h-9 w-full rounded-full bg-slate-900 px-5 text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-slate-800 sm:w-auto";

export const EMPTY_STATE_RECOMMENDATION_CARD_CLASSNAME =
  "group flex min-w-0 flex-col items-start gap-2 rounded-[20px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.97)_0%,rgba(248,250,252,0.9)_100%)] px-3.5 py-3.5 text-left shadow-sm shadow-slate-950/5 transition-colors hover:border-slate-300 hover:bg-white";

export const EMPTY_STATE_PAGE_CONTAINER_CLASSNAME =
  "relative flex flex-1 flex-col items-stretch justify-start overflow-y-auto bg-[linear-gradient(135deg,rgba(244,250,255,0.94)_0%,rgba(248,250,252,0.98)_44%,rgba(244,250,247,0.96)_100%)] px-3 pb-5 pt-[clamp(8px,1.1vw,12px)] md:px-4";

export const EMPTY_STATE_BACKGROUND_ORB_LEFT_CLASSNAME =
  "pointer-events-none absolute left-[-4%] top-[-14%] h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.09)_0%,transparent_70%)]";

export const EMPTY_STATE_BACKGROUND_ORB_RIGHT_CLASSNAME =
  "pointer-events-none absolute right-[-10%] top-[10%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.1)_0%,transparent_72%)]";

export const EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME =
  "relative z-[1] mx-auto flex w-full max-w-[1240px] flex-col items-stretch gap-2.5";

export const EMPTY_STATE_THEME_TABS_CONTAINER_CLASSNAME =
  "flex w-full max-w-full flex-nowrap justify-start gap-1.5 overflow-x-auto overflow-y-hidden rounded-[20px] border border-slate-200/80 bg-slate-50/80 p-[5px] shadow-[0_10px_24px_-22px_rgba(15,23,42,0.18)] backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const EMPTY_STATE_SELECT_TRIGGER_CLASSNAME =
  "h-8 rounded-full border-slate-200/80 bg-white/92 px-3 text-xs text-slate-700 shadow-none transition-colors hover:border-slate-300 hover:bg-white focus:ring-1 focus:ring-slate-200";

export const EMPTY_STATE_PASSIVE_BADGE_CLASSNAME =
  "h-8 rounded-full border border-slate-200/80 bg-white/92 px-3 text-xs font-normal text-slate-600 shadow-none hover:border-slate-300 hover:bg-white hover:text-slate-900";

export const EMPTY_STATE_ICON_TOOL_BUTTON_CLASSNAME =
  "ml-1 h-8 w-8 rounded-full border-slate-200/80 bg-white text-slate-500 shadow-none transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700";

const EMPTY_STATE_TOOL_TOGGLE_TONE_CLASSNAMES: Record<EmptyStateTone, string> = {
  slate:
    "border-slate-400 bg-slate-200 text-slate-900 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.28)] hover:border-slate-400 hover:bg-slate-200 hover:text-slate-900",
  sky:
    "border-sky-300 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700",
  emerald:
    "border-emerald-300 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700",
  amber:
    "border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700",
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
      ? "border-slate-300 bg-white/95 text-slate-900 shadow-[0_10px_22px_-20px_rgba(15,23,42,0.24)]"
      : "border-transparent text-slate-600 hover:border-slate-200/90 hover:bg-white/80 hover:text-slate-900",
  ].join(" ");
}

export function getEmptyStateThemeTabIconClassName(active: boolean) {
  return [
    "flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
    active
      ? "border-slate-200 bg-white text-slate-700"
      : "border-transparent bg-transparent text-slate-400",
  ].join(" ");
}
