export const A2UI_RENDERER_TOKENS = {
  container: "a2ui-container space-y-4",
  thinkingText: "text-sm text-muted-foreground italic",
  errorText: "text-red-500",
  submitRow: "flex justify-end",
  submitButton:
    "inline-flex h-11 items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:border-slate-800 hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:text-slate-400 disabled:hover:bg-slate-200",
  textVariants: {
    h1: "text-2xl font-bold",
    h2: "text-xl font-semibold",
    h3: "text-lg font-semibold",
    h4: "text-base font-medium",
    h5: "text-sm font-medium",
    body: "text-sm",
    caption: "text-xs text-muted-foreground",
  },
  imageBase: "block border border-slate-200 bg-slate-100 object-cover",
  imagePlaceholder:
    "flex items-center justify-center border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500",
  imageFit: {
    contain: "object-contain",
    cover: "object-cover",
    fill: "object-fill",
    none: "object-none",
    "scale-down": "object-scale-down",
  },
  imageVariants: {
    default: "w-full min-h-[140px] rounded-[20px]",
    icon: "h-12 w-12 rounded-2xl p-2",
    avatar: "h-12 w-12 rounded-full",
    smallFeature: "w-full h-28 rounded-[20px]",
    mediumFeature: "w-full h-40 rounded-[22px]",
    largeFeature: "w-full h-56 rounded-[24px]",
    header: "w-full h-48 rounded-[24px]",
  },
  iconShell:
    "inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 shadow-sm",
  iconFallback: "text-[10px] font-medium uppercase tracking-[0.08em]",
} as const;

export default A2UI_RENDERER_TOKENS;
