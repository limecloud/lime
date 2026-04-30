export const LIME_COLOR_SCHEME_STORAGE_KEY = "lime.appearance.color-scheme";
export const LIME_COLOR_SCHEME_CHANGED_EVENT = "lime-color-scheme-changed";

export const DEFAULT_LIME_COLOR_SCHEME_ID = "lime-classic";

export type LimeColorSchemeId =
  | "lime-classic"
  | "lime-forest"
  | "lime-ocean"
  | "lime-sand"
  | "lime-neon"
  | "lime-citron"
  | "lime-dusk"
  | "lime-minimal"
  | "lime-vivid"
  | "lime-literary"
  | "lime-luxury";

export interface LimeColorScheme {
  id: LimeColorSchemeId;
  label: string;
  description: string;
  swatches: readonly [string, string, string];
  variables: Record<string, string>;
}

export interface LimeColorSchemeChangedEventDetail {
  colorSchemeId: LimeColorSchemeId;
}

type LimeColorSchemeEffectiveThemeMode = "light" | "dark";

const classicVariables = {
  "--lime-text-strong": "#0f172a",
  "--lime-text": "#1a3b2b",
  "--lime-text-muted": "#6b826b",
  "--lime-surface": "#ffffff",
  "--lime-surface-subtle": "#fcfff9",
  "--lime-surface-soft": "#f8fcf9",
  "--lime-surface-muted": "#f2f7f3",
  "--lime-surface-hover": "#f4fdf4",
  "--lime-surface-border": "#e2f0e2",
  "--lime-surface-border-strong": "#c7e7d1",
  "--lime-shadow-color": "rgba(15, 23, 42, 0.12)",
  "--lime-app-bg": "#f4f7f1",
  "--lime-shell-surface": "linear-gradient(180deg, #f1f5ec 0%, #f7faf4 100%)",
  "--lime-stage-surface":
    "linear-gradient(180deg, #f8fcf7 0%, #f4f7f1 54%, #f8faf6 100%)",
  "--lime-stage-surface-soft":
    "linear-gradient(180deg, rgba(248, 252, 247, 0.98) 0%, rgba(244, 247, 241, 0.94) 100%)",
  "--lime-stage-surface-top": "#f8fcf7",
  "--lime-card-subtle":
    "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(249,251,246,0.98) 100%)",
  "--lime-card-subtle-border": "rgba(205, 216, 200, 0.76)",
  "--lime-divider-subtle": "rgba(143, 154, 132, 0.18)",
  "--lime-brand-strong": "#166534",
  "--lime-brand": "#10b981",
  "--lime-brand-muted": "#22c55e",
  "--lime-brand-soft": "#ecfdf5",
  "--lime-info": "#0284c7",
  "--lime-info-soft": "#f0f9ff",
  "--lime-info-border": "#bfdbfe",
  "--lime-warning": "#b45309",
  "--lime-warning-soft": "#fffbeb",
  "--lime-warning-border": "#fde68a",
  "--lime-danger": "#be123c",
  "--lime-danger-soft": "#fff1f2",
  "--lime-danger-border": "#fecdd3",
  "--lime-focus-ring": "rgba(52, 171, 103, 0.18)",
  "--lime-chrome-rail": "#eef3e9",
  "--lime-chrome-rail-surface":
    "linear-gradient(180deg, #edf2e8 0%, #eef3e9 100%)",
  "--lime-chrome-surface": "#f8fcf7",
  "--lime-chrome-active-tab": "#f8fcf7",
  "--lime-chrome-tab-hover": "#eef3e9",
  "--lime-chrome-tab-active-surface": "#f8fcf7",
  "--lime-chrome-border": "rgba(205, 224, 211, 0.62)",
  "--lime-chrome-divider": "rgba(205, 224, 211, 0.36)",
  "--lime-chrome-stage-blend":
    "radial-gradient(circle at 18% 100%, rgba(132, 204, 22, 0.035), transparent 42%), radial-gradient(circle at 78% 115%, rgba(186, 230, 253, 0.055), transparent 46%), linear-gradient(180deg, #f8fcf7 0%, #f8fcf7 58%, #f8fcf7 100%)",
  "--lime-chrome-stage-seam": "rgba(143, 154, 132, 0.08)",
  "--lime-chrome-shadow-subtle": "0 10px 22px -30px rgba(15, 23, 42, 0.28)",
  "--lime-chrome-text": "#1a3b2b",
  "--lime-chrome-muted": "#64748b",
  "--lime-sidebar-surface":
    "linear-gradient(180deg, #eef3e9 0%, #f4f7f0 46%, #f7faf4 100%)",
  "--lime-sidebar-surface-top": "#eef3e9",
  "--lime-sidebar-surface-middle": "#f4f7f0",
  "--lime-sidebar-surface-bottom": "#f7faf4",
  "--lime-sidebar-border": "rgba(203, 214, 196, 0.82)",
  "--lime-sidebar-divider": "rgba(143, 154, 132, 0.18)",
  "--lime-sidebar-hover": "#edf2e8",
  "--lime-sidebar-active": "#e7efe1",
  "--lime-sidebar-active-text": "#166534",
  "--lime-sidebar-search-bg": "#f9fbf6",
  "--lime-sidebar-search-hover": "#f1f5ec",
  "--lime-sidebar-search-border-hover": "#cbd8c4",
  "--lime-sidebar-card-surface":
    "linear-gradient(180deg, #f9fbf6 0%, #f2f6ee 100%)",
  "--lime-sidebar-card-border": "rgba(205, 216, 200, 0.72)",
  "--lime-sidebar-card-highlight": "rgba(255, 255, 255, 0.54)",
  "--lime-sidebar-card-shadow": "0 14px 28px -26px rgba(15, 23, 42, 0.32)",
  "--lime-sidebar-glow-primary": "rgba(132, 154, 107, 0.035)",
  "--lime-sidebar-glow-secondary": "rgba(47, 125, 80, 0.025)",
  "--lime-sidebar-glow-tertiary": "rgba(186, 230, 253, 0.035)",
  "--lime-home-bg-start": "#f8fcf7",
  "--lime-home-bg-mid": "#f9fbf8",
  "--lime-home-bg-end": "#f5faf7",
  "--lime-home-glow-primary": "rgba(132, 204, 22, 0.055)",
  "--lime-home-glow-secondary": "rgba(186, 230, 253, 0.11)",
  "--lime-home-title-gradient":
    "linear-gradient(90deg, #163b2c 0%, #23714b 34%, #6f955d 62%, #23714b 100%)",
  "--lime-home-title-shadow":
    "0 0 8px rgba(132, 204, 22, 0.1), 0 12px 24px rgba(46, 125, 78, 0.08)",
  "--lime-home-dot-gradient":
    "linear-gradient(135deg, rgba(124, 174, 72, 0.86), rgba(34, 142, 86, 0.78))",
  "--lime-home-dot-shadow":
    "0 0 0 12px rgba(132, 204, 22, 0.075), 0 0 18px rgba(34, 142, 86, 0.18)",
  "--lime-home-beam-gradient":
    "linear-gradient(90deg, rgba(132, 204, 22, 0) 0%, rgba(132, 204, 22, 0.075) 24%, rgba(255, 255, 255, 0.3) 50%, rgba(14, 165, 233, 0.08) 76%, rgba(132, 204, 22, 0) 100%)",
  "--lime-home-card-surface":
    "linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(247,254,231,0.9) 100%)",
  "--lime-home-card-surface-strong":
    "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,249,255,0.94))",
  "--lime-home-card-border": "rgba(197, 222, 213, 0.88)",
  "--lime-home-card-border-muted": "rgba(219, 234, 224, 0.92)",
  "--lime-home-card-hover-border": "#b7d9c6",
  "--lime-composer-surface":
    "linear-gradient(180deg, #fdfffb 0%, #f6fbf7 100%)",
  "--lime-composer-shell": "linear-gradient(180deg, #fdfffb 0%, #f6fbf7 100%)",
  "--lime-composer-surface-floating":
    "radial-gradient(circle at top right, rgba(220, 252, 231, 0.48), rgba(255, 255, 255, 0) 34%), linear-gradient(180deg, #ffffff 0%, #f7fcf8 100%)",
  "--lime-composer-surface-focus":
    "linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%)",
  "--lime-composer-border": "rgba(163, 213, 184, 0.72)",
  "--lime-composer-border-focus": "rgba(52, 171, 103, 0.52)",
  "--lime-primary-gradient":
    "linear-gradient(135deg,#0ea5e9 0%,#14b8a6 52%,#10b981 100%)",
  "--lime-primary-gradient-simple":
    "linear-gradient(135deg,#0ea5e9 0%,#10b981 100%)",
};

const darkThemeVariableOverrides = {
  "--lime-text-strong": "#f1f5f9",
  "--lime-text": "#d7e3df",
  "--lime-text-muted": "#94a3b8",
  "--lime-surface": "#0f172a",
  "--lime-surface-subtle": "#111827",
  "--lime-surface-soft": "#172033",
  "--lime-surface-muted": "#1f2937",
  "--lime-surface-hover": "#223047",
  "--lime-surface-border": "rgba(148, 163, 184, 0.22)",
  "--lime-surface-border-strong": "rgba(148, 163, 184, 0.36)",
  "--lime-shadow-color": "rgba(2, 8, 23, 0.44)",
  "--lime-app-bg": "#0b1120",
  "--lime-shell-surface": "linear-gradient(180deg, #0b1120 0%, #101827 100%)",
  "--lime-stage-surface":
    "linear-gradient(180deg, #101827 0%, #0b1120 56%, #101827 100%)",
  "--lime-stage-surface-soft":
    "linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(11,17,32,0.96) 100%)",
  "--lime-stage-surface-top": "#101827",
  "--lime-card-subtle":
    "linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(17,24,39,0.98) 100%)",
  "--lime-card-subtle-border": "rgba(148, 163, 184, 0.24)",
  "--lime-divider-subtle": "rgba(148, 163, 184, 0.16)",
  "--lime-brand-strong": "#86efac",
  "--lime-brand": "#34d399",
  "--lime-brand-muted": "#6ee7b7",
  "--lime-brand-soft": "rgba(16, 185, 129, 0.14)",
  "--lime-info": "#7dd3fc",
  "--lime-info-soft": "rgba(14, 165, 233, 0.14)",
  "--lime-info-border": "rgba(125, 211, 252, 0.28)",
  "--lime-warning": "#fbbf24",
  "--lime-warning-soft": "rgba(245, 158, 11, 0.16)",
  "--lime-warning-border": "rgba(251, 191, 36, 0.3)",
  "--lime-danger": "#fb7185",
  "--lime-danger-soft": "rgba(244, 63, 94, 0.14)",
  "--lime-danger-border": "rgba(251, 113, 133, 0.3)",
  "--lime-focus-ring": "rgba(125, 211, 252, 0.2)",
  "--lime-chrome-rail": "#0b1120",
  "--lime-chrome-rail-surface":
    "linear-gradient(180deg, #0b1120 0%, #111827 100%)",
  "--lime-chrome-surface": "#111827",
  "--lime-chrome-active-tab": "#182235",
  "--lime-chrome-tab-hover": "#172033",
  "--lime-chrome-tab-active-surface": "#182235",
  "--lime-chrome-border": "rgba(148, 163, 184, 0.22)",
  "--lime-chrome-divider": "rgba(148, 163, 184, 0.16)",
  "--lime-chrome-stage-blend":
    "radial-gradient(circle at 18% 100%, rgba(16, 185, 129, 0.07), transparent 42%), radial-gradient(circle at 78% 115%, rgba(56, 189, 248, 0.08), transparent 46%), linear-gradient(180deg, #111827 0%, #0f172a 58%, #0b1120 100%)",
  "--lime-chrome-stage-seam": "rgba(148, 163, 184, 0.1)",
  "--lime-chrome-shadow-subtle": "0 16px 34px -28px rgba(2, 8, 23, 0.72)",
  "--lime-chrome-text": "#e2e8f0",
  "--lime-chrome-muted": "#94a3b8",
  "--lime-sidebar-surface":
    "linear-gradient(180deg, #0b1120 0%, #101827 48%, #111827 100%)",
  "--lime-sidebar-surface-top": "#0b1120",
  "--lime-sidebar-surface-middle": "#101827",
  "--lime-sidebar-surface-bottom": "#111827",
  "--lime-sidebar-border": "rgba(148, 163, 184, 0.22)",
  "--lime-sidebar-divider": "rgba(148, 163, 184, 0.14)",
  "--lime-sidebar-hover": "#172033",
  "--lime-sidebar-active": "#183225",
  "--lime-sidebar-active-text": "#86efac",
  "--lime-sidebar-search-bg": "#111827",
  "--lime-sidebar-search-hover": "#172033",
  "--lime-sidebar-search-border-hover": "rgba(148, 163, 184, 0.34)",
  "--lime-sidebar-card-surface":
    "linear-gradient(180deg, #111827 0%, #172033 100%)",
  "--lime-sidebar-card-border": "rgba(148, 163, 184, 0.24)",
  "--lime-sidebar-card-highlight": "rgba(255,255,255,0.06)",
  "--lime-sidebar-card-shadow": "0 18px 34px -28px rgba(2, 8, 23, 0.72)",
  "--lime-sidebar-glow-primary": "rgba(16, 185, 129, 0.08)",
  "--lime-sidebar-glow-secondary": "rgba(20, 184, 166, 0.05)",
  "--lime-sidebar-glow-tertiary": "rgba(56, 189, 248, 0.08)",
  "--lime-home-bg-start": "#0b1120",
  "--lime-home-bg-mid": "#0f172a",
  "--lime-home-bg-end": "#111827",
  "--lime-home-glow-primary": "rgba(16, 185, 129, 0.11)",
  "--lime-home-glow-secondary": "rgba(56, 189, 248, 0.12)",
  "--lime-home-title-gradient":
    "linear-gradient(90deg, #f1f5f9 0%, #86efac 44%, #7dd3fc 100%)",
  "--lime-home-title-shadow": "0 14px 30px rgba(2, 8, 23, 0.34)",
  "--lime-home-dot-shadow":
    "0 0 0 10px rgba(16, 185, 129, 0.1), 0 0 20px rgba(56, 189, 248, 0.16)",
  "--lime-home-beam-gradient":
    "linear-gradient(90deg, rgba(16,185,129,0) 0%, rgba(16,185,129,0.12) 28%, rgba(255,255,255,0.16) 50%, rgba(56,189,248,0.12) 72%, rgba(16,185,129,0) 100%)",
  "--lime-home-card-surface":
    "linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(17,24,39,0.96) 100%)",
  "--lime-home-card-surface-strong":
    "linear-gradient(180deg, rgba(30,41,59,0.98), rgba(15,23,42,0.96))",
  "--lime-home-card-border": "rgba(148, 163, 184, 0.28)",
  "--lime-home-card-border-muted": "rgba(148, 163, 184, 0.2)",
  "--lime-home-card-hover-border": "rgba(125, 211, 252, 0.42)",
  "--lime-composer-surface":
    "linear-gradient(180deg, #111827 0%, #0f172a 100%)",
  "--lime-composer-shell": "linear-gradient(180deg, #111827 0%, #0f172a 100%)",
  "--lime-composer-surface-floating":
    "radial-gradient(circle at top right, rgba(16,185,129,0.14), rgba(15,23,42,0) 34%), linear-gradient(180deg, #111827 0%, #0f172a 100%)",
  "--lime-composer-surface-focus":
    "linear-gradient(180deg, #111827 0%, #132033 100%)",
  "--lime-composer-border": "rgba(148, 163, 184, 0.28)",
  "--lime-composer-border-focus": "rgba(125, 211, 252, 0.46)",
};

function withPalette(overrides: Partial<typeof classicVariables>) {
  return {
    ...classicVariables,
    ...overrides,
  };
}

export const LIME_COLOR_SCHEMES: readonly LimeColorScheme[] = [
  {
    id: "lime-classic",
    label: "墨绿",
    description: "经典深绿，温暖米色背景。",
    swatches: ["#f8fcf7", "#10b981", "#0ea5e9"],
    variables: classicVariables,
  },
  {
    id: "lime-forest",
    label: "自然",
    description: "舒适放松的清新自然风。",
    swatches: ["#f4f7f1", "#2f6f46", "#8aa16e"],
    variables: withPalette({
      "--lime-text": "#233c31",
      "--lime-text-muted": "#667564",
      "--lime-surface-soft": "#f4f7f1",
      "--lime-surface-muted": "#edf3e8",
      "--lime-surface-border": "#dce8d5",
      "--lime-surface-border-strong": "#c9d8bf",
      "--lime-brand-strong": "#234f36",
      "--lime-brand": "#2f6f46",
      "--lime-brand-muted": "#6f8f53",
      "--lime-brand-soft": "#eef4e8",
      "--lime-info": "#3b7066",
      "--lime-info-soft": "#edf6f3",
      "--lime-info-border": "#bcd8d0",
      "--lime-focus-ring": "rgba(111, 143, 83, 0.16)",
      "--lime-app-bg": "#f3f6ef",
      "--lime-shell-surface":
        "linear-gradient(180deg, #eef4e8 0%, #f7faf4 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #f7faf5 0%, #f3f6ef 56%, #f8faf5 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(247,250,245,0.96) 0%, rgba(243,246,239,0.92) 100%)",
      "--lime-stage-surface-top": "#f7faf5",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(246,249,242,0.98) 100%)",
      "--lime-card-subtle-border": "rgba(204, 218, 195, 0.72)",
      "--lime-divider-subtle": "rgba(111, 143, 83, 0.16)",
      "--lime-chrome-rail": "#f4f7f1",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #eef4e8 0%, #f4f7f1 100%)",
      "--lime-chrome-surface": "#f6f9f2",
      "--lime-chrome-active-tab": "#fbfdf8",
      "--lime-chrome-tab-hover": "#eef4e8",
      "--lime-chrome-tab-active-surface": "#fbfdf8",
      "--lime-chrome-border": "rgba(204, 218, 195, 0.74)",
      "--lime-chrome-divider": "rgba(204, 218, 195, 0.66)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(111, 143, 83, 0.026), transparent 42%), radial-gradient(circle at 78% 115%, rgba(188, 216, 208, 0.034), transparent 46%), linear-gradient(180deg, #fbfdf8 0%, #f9fbf6 58%, #f7faf5 100%)",
      "--lime-chrome-stage-seam": "rgba(111, 143, 83, 0.075)",
      "--lime-chrome-text": "#233c31",
      "--lime-chrome-muted": "#667564",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #eef4e8 0%, #f5f8f1 48%, #f9fbf6 100%)",
      "--lime-sidebar-surface-top": "#eef4e8",
      "--lime-sidebar-surface-middle": "#f5f8f1",
      "--lime-sidebar-surface-bottom": "#f9fbf6",
      "--lime-sidebar-border": "rgba(204, 218, 195, 0.72)",
      "--lime-sidebar-divider": "rgba(111, 143, 83, 0.12)",
      "--lime-sidebar-hover": "#e9f1e3",
      "--lime-sidebar-active": "#e1edd9",
      "--lime-sidebar-active-text": "#234f36",
      "--lime-sidebar-search-bg": "#fbfdf8",
      "--lime-sidebar-search-hover": "#eef4e8",
      "--lime-sidebar-search-border-hover": "#c9d8bf",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #fbfdf8 0%, #f3f6ef 100%)",
      "--lime-sidebar-card-border": "rgba(204, 218, 195, 0.7)",
      "--lime-sidebar-card-highlight": "rgba(255,255,255,0.56)",
      "--lime-sidebar-card-shadow": "0 14px 28px -26px rgba(15, 23, 42, 0.3)",
      "--lime-sidebar-glow-primary": "rgba(111, 143, 83, 0.032)",
      "--lime-sidebar-glow-secondary": "rgba(47, 111, 70, 0.024)",
      "--lime-sidebar-glow-tertiary": "rgba(188, 216, 208, 0.034)",
      "--lime-home-bg-start": "#f4f7f1",
      "--lime-home-bg-mid": "#f7faf5",
      "--lime-home-bg-end": "#f2f7ef",
      "--lime-home-glow-primary": "rgba(111, 143, 83, 0.032)",
      "--lime-home-glow-secondary": "rgba(188, 216, 208, 0.048)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #233c31 0%, #356b48 100%)",
      "--lime-home-title-shadow": "0 12px 26px rgba(15, 23, 42, 0.04)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #6f8f53, #2f6f46)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(111,143,83,0.045), 0 0 14px rgba(47,111,70,0.08)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(111,143,83,0) 0%, rgba(111,143,83,0.032) 32%, rgba(255,255,255,0.22) 50%, rgba(188,216,208,0.04) 68%, rgba(111,143,83,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(239,246,234,0.94) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(239,246,234,0.94))",
      "--lime-home-card-border": "rgba(204, 218, 195, 0.84)",
      "--lime-home-card-border-muted": "rgba(220, 232, 213, 0.9)",
      "--lime-home-card-hover-border": "#c9d8bf",
      "--lime-composer-surface":
        "linear-gradient(180deg, #ffffff 0%, #f4f8f1 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #ffffff 0%, #f4f8f1 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #ffffff 0%, #f4f8f1 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #ffffff 0%, #eef6e8 100%)",
      "--lime-composer-border": "rgba(201, 216, 191, 0.68)",
      "--lime-composer-border-focus": "rgba(111, 143, 83, 0.46)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#234f36 0%,#2f6f46 58%,#6f8f53 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#234f36 0%,#2f6f46 100%)",
    }),
  },
  {
    id: "lime-ocean",
    label: "海洋",
    description: "沉静专业的蓝色调。",
    swatches: ["#f3f8fa", "#0f766e", "#2563eb"],
    variables: withPalette({
      "--lime-text": "#173346",
      "--lime-text-muted": "#64748b",
      "--lime-surface-soft": "#f3f8fa",
      "--lime-surface-muted": "#edf5f7",
      "--lime-surface-border": "#d7e6ea",
      "--lime-surface-border-strong": "#bfd6dc",
      "--lime-brand-strong": "#0f766e",
      "--lime-brand": "#14b8a6",
      "--lime-brand-muted": "#5aa9b8",
      "--lime-brand-soft": "#ecfeff",
      "--lime-info": "#2f6f8f",
      "--lime-info-soft": "#eff6ff",
      "--lime-info-border": "#c9dde5",
      "--lime-focus-ring": "rgba(47, 111, 143, 0.16)",
      "--lime-app-bg": "#f2f7f9",
      "--lime-shell-surface":
        "linear-gradient(180deg, #eef6f8 0%, #f8fbfc 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #f8fcfd 0%, #f2f7f9 56%, #f9fcfd 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(248,252,253,0.96) 0%, rgba(242,247,249,0.92) 100%)",
      "--lime-stage-surface-top": "#f8fcfd",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(245,250,251,0.98) 100%)",
      "--lime-card-subtle-border": "rgba(202, 220, 225, 0.72)",
      "--lime-divider-subtle": "rgba(14, 116, 144, 0.14)",
      "--lime-chrome-rail": "#f4f8fa",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #edf5f7 0%, #f4f8fa 100%)",
      "--lime-chrome-surface": "#f7fbfc",
      "--lime-chrome-active-tab": "#fbfdfe",
      "--lime-chrome-tab-hover": "#edf5f7",
      "--lime-chrome-tab-active-surface": "#fbfdfe",
      "--lime-chrome-border": "rgba(202, 220, 225, 0.74)",
      "--lime-chrome-divider": "rgba(202, 220, 225, 0.66)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(20, 184, 166, 0.024), transparent 42%), radial-gradient(circle at 78% 115%, rgba(59, 130, 246, 0.032), transparent 46%), linear-gradient(180deg, #fbfdfe 0%, #fafdfd 58%, #f8fcfd 100%)",
      "--lime-chrome-stage-seam": "rgba(14, 116, 144, 0.065)",
      "--lime-chrome-text": "#173346",
      "--lime-chrome-muted": "#64748b",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #edf5f7 0%, #f5fafb 48%, #f8fcfd 100%)",
      "--lime-sidebar-surface-top": "#edf5f7",
      "--lime-sidebar-surface-middle": "#f5fafb",
      "--lime-sidebar-surface-bottom": "#f8fcfd",
      "--lime-sidebar-border": "rgba(202, 220, 225, 0.72)",
      "--lime-sidebar-divider": "rgba(14, 116, 144, 0.1)",
      "--lime-sidebar-hover": "#e6f2f5",
      "--lime-sidebar-active": "#dff5f4",
      "--lime-sidebar-active-text": "#0f766e",
      "--lime-sidebar-search-bg": "#fbfdfe",
      "--lime-sidebar-search-hover": "#edf5f7",
      "--lime-sidebar-search-border-hover": "#bfd6dc",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #fbfdfe 0%, #f1f7f9 100%)",
      "--lime-sidebar-card-border": "rgba(202, 220, 225, 0.7)",
      "--lime-sidebar-card-highlight": "rgba(255,255,255,0.56)",
      "--lime-sidebar-card-shadow": "0 14px 28px -26px rgba(15, 23, 42, 0.3)",
      "--lime-sidebar-glow-primary": "rgba(14,116,144,0.03)",
      "--lime-sidebar-glow-secondary": "rgba(20,184,166,0.022)",
      "--lime-sidebar-glow-tertiary": "rgba(59,130,246,0.032)",
      "--lime-home-bg-start": "#f3f8fa",
      "--lime-home-bg-mid": "#f8fcfd",
      "--lime-home-bg-end": "#eef7f9",
      "--lime-home-glow-primary": "rgba(20,184,166,0.028)",
      "--lime-home-glow-secondary": "rgba(59,130,246,0.042)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #173346 0%, #0f766e 100%)",
      "--lime-home-title-shadow": "0 12px 26px rgba(15, 23, 42, 0.04)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #5aa9b8, #0f766e)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(20,184,166,0.04), 0 0 14px rgba(47,111,143,0.075)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(20,184,166,0) 0%, rgba(20,184,166,0.032) 32%, rgba(255,255,255,0.22) 50%, rgba(47,111,143,0.04) 68%, rgba(20,184,166,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(239,246,255,0.94) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(236,254,255,0.94))",
      "--lime-home-card-border": "rgba(201, 221, 229, 0.86)",
      "--lime-home-card-border-muted": "rgba(219, 232, 237, 0.92)",
      "--lime-home-card-hover-border": "#b8d5dd",
      "--lime-composer-surface":
        "linear-gradient(180deg, #ffffff 0%, #f4f9fb 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #ffffff 0%, #f4f9fb 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #ffffff 0%, #f4f9fb 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #ffffff 0%, #edf7fa 100%)",
      "--lime-composer-border": "rgba(174, 205, 213, 0.7)",
      "--lime-composer-border-focus": "rgba(47, 111, 143, 0.46)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#0f766e 0%,#14b8a6 54%,#2f6f8f 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#0f766e 0%,#2f6f8f 100%)",
    }),
  },
  {
    id: "lime-sand",
    label: "复古",
    description: "温暖怀旧的琥珀色调。",
    swatches: ["#f7f3e8", "#2f4638", "#c9a46a"],
    variables: withPalette({
      "--lime-text": "#2f4638",
      "--lime-text-muted": "#6f7466",
      "--lime-surface": "#fffdf7",
      "--lime-surface-subtle": "#fbfaf4",
      "--lime-surface-soft": "#f7f3e8",
      "--lime-surface-muted": "#f3efe4",
      "--lime-surface-hover": "#f0eadc",
      "--lime-surface-border": "#d8d0bf",
      "--lime-surface-border-strong": "#c9d8bf",
      "--lime-brand-strong": "#233c31",
      "--lime-brand": "#2f6f46",
      "--lime-brand-muted": "#6f8f53",
      "--lime-brand-soft": "#eef4e8",
      "--lime-info": "#4f7664",
      "--lime-info-soft": "#eef4e8",
      "--lime-info-border": "#c9d8bf",
      "--lime-warning": "#7a5523",
      "--lime-warning-soft": "#f8edd5",
      "--lime-warning-border": "#e3c486",
      "--lime-focus-ring": "rgba(151, 123, 77, 0.16)",
      "--lime-app-bg": "#f2eee3",
      "--lime-shell-surface":
        "linear-gradient(180deg, #eee8dc 0%, #faf7ef 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #fbfaf4 0%, #f2eee3 56%, #fffdf7 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(251,250,244,0.96) 0%, rgba(242,238,227,0.92) 100%)",
      "--lime-stage-surface-top": "#fbfaf4",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,253,247,0.94) 0%, rgba(247,243,232,0.98) 100%)",
      "--lime-card-subtle-border": "rgba(216, 208, 191, 0.72)",
      "--lime-divider-subtle": "rgba(84, 104, 76, 0.16)",
      "--lime-chrome-rail": "#f4f0e7",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #eee8dc 0%, #f4f0e7 100%)",
      "--lime-chrome-surface": "#f7f3ea",
      "--lime-chrome-active-tab": "#fbfaf4",
      "--lime-chrome-tab-hover": "#f0eadc",
      "--lime-chrome-tab-active-surface": "#fbfaf4",
      "--lime-chrome-border": "rgba(216, 208, 191, 0.74)",
      "--lime-chrome-divider": "rgba(216, 208, 191, 0.66)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(112, 126, 83, 0.026), transparent 42%), radial-gradient(circle at 78% 115%, rgba(204, 190, 158, 0.036), transparent 46%), linear-gradient(180deg, #fbfaf4 0%, #fbfaf4 58%, #fbfaf4 100%)",
      "--lime-chrome-stage-seam": "rgba(84, 104, 76, 0.075)",
      "--lime-chrome-text": "#263f32",
      "--lime-chrome-muted": "#687062",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #eee9dd 0%, #f5f1e7 48%, #f8f4ea 100%)",
      "--lime-sidebar-surface-top": "#eee9dd",
      "--lime-sidebar-surface-middle": "#f5f1e7",
      "--lime-sidebar-surface-bottom": "#f8f4ea",
      "--lime-sidebar-border": "rgba(216, 208, 191, 0.74)",
      "--lime-sidebar-divider": "rgba(84,104,76,0.12)",
      "--lime-sidebar-hover": "#f0eadc",
      "--lime-sidebar-active": "#e5efdf",
      "--lime-sidebar-active-text": "#234f36",
      "--lime-sidebar-search-bg": "#fbfaf4",
      "--lime-sidebar-search-hover": "#f2ede2",
      "--lime-sidebar-search-border-hover": "#c9d8bf",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #fffdf7 0%, #f4efe2 100%)",
      "--lime-sidebar-card-border": "rgba(216, 208, 191, 0.7)",
      "--lime-sidebar-card-highlight": "rgba(255,253,247,0.58)",
      "--lime-sidebar-card-shadow": "0 14px 28px -26px rgba(15, 23, 42, 0.3)",
      "--lime-sidebar-glow-primary": "rgba(112,126,83,0.03)",
      "--lime-sidebar-glow-secondary": "rgba(72,111,78,0.022)",
      "--lime-sidebar-glow-tertiary": "rgba(204,190,158,0.04)",
      "--lime-home-bg-start": "#f3efe4",
      "--lime-home-bg-mid": "#f7f3e8",
      "--lime-home-bg-end": "#fbfaf4",
      "--lime-home-glow-primary": "rgba(112,126,83,0.032)",
      "--lime-home-glow-secondary": "rgba(204,190,158,0.052)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #233c31 0%, #3b6b4b 100%)",
      "--lime-home-title-shadow": "0 12px 26px rgba(15, 23, 42, 0.04)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #7d8b59, #3b6b4b)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(112,126,83,0.04), 0 0 14px rgba(47,111,70,0.075)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(112,126,83,0) 0%, rgba(112,126,83,0.032) 32%, rgba(255,255,255,0.22) 50%, rgba(204,190,158,0.04) 68%, rgba(112,126,83,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,253,247,0.98) 0%, rgba(244,239,226,0.92) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,253,247,0.98), rgba(244,239,226,0.94))",
      "--lime-home-card-border": "rgba(216,208,191,0.84)",
      "--lime-home-card-border-muted": "rgba(216,208,191,0.88)",
      "--lime-home-card-hover-border": "#c9d8bf",
      "--lime-composer-surface":
        "linear-gradient(180deg, #fffdf7 0%, #f6f1e6 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #fffdf7 0%, #f6f1e6 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #fffdf7 0%, #f6f1e6 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #fffdf7 0%, #eef4e8 100%)",
      "--lime-composer-border": "rgba(207, 198, 178, 0.72)",
      "--lime-composer-border-focus": "rgba(95, 138, 76, 0.46)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#233c31 0%,#2f6f46 58%,#6f8f53 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#233c31 0%,#2f6f46 100%)",
    }),
  },
  {
    id: "lime-neon",
    label: "霓虹",
    description: "赛博明亮的粉紫色调。",
    swatches: ["#fdf4ff", "#b026c6", "#22c55e"],
    variables: withPalette({
      "--lime-text": "#2f1b45",
      "--lime-text-muted": "#7c6a8a",
      "--lime-surface": "#fffaff",
      "--lime-surface-subtle": "#fef7ff",
      "--lime-surface-soft": "#fbf0ff",
      "--lime-surface-muted": "#f5e7fb",
      "--lime-surface-hover": "#f0ddfb",
      "--lime-surface-border": "#ead2f5",
      "--lime-surface-border-strong": "#dbb5eb",
      "--lime-brand-strong": "#86198f",
      "--lime-brand": "#c026d3",
      "--lime-brand-muted": "#22c55e",
      "--lime-brand-soft": "#fae8ff",
      "--lime-info": "#0e7490",
      "--lime-info-soft": "#ecfeff",
      "--lime-info-border": "#bae6fd",
      "--lime-focus-ring": "rgba(192, 38, 211, 0.16)",
      "--lime-app-bg": "#f8f2fb",
      "--lime-shell-surface":
        "linear-gradient(180deg, #f4e8fb 0%, #fffaff 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #fffaff 0%, #f8f2fb 56%, #fdf8ff 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(255,250,255,0.96) 0%, rgba(248,242,251,0.92) 100%)",
      "--lime-stage-surface-top": "#fffaff",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(251,240,255,0.94) 100%)",
      "--lime-card-subtle-border": "rgba(234, 210, 245, 0.76)",
      "--lime-divider-subtle": "rgba(134, 25, 143, 0.14)",
      "--lime-chrome-rail": "#fbf0ff",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #f4e8fb 0%, #fbf0ff 100%)",
      "--lime-chrome-surface": "#fef7ff",
      "--lime-chrome-active-tab": "#fffaff",
      "--lime-chrome-tab-hover": "#f0ddfb",
      "--lime-chrome-tab-active-surface": "#fffaff",
      "--lime-chrome-border": "rgba(234, 210, 245, 0.76)",
      "--lime-chrome-divider": "rgba(234, 210, 245, 0.66)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(192, 38, 211, 0.034), transparent 42%), radial-gradient(circle at 78% 115%, rgba(34, 197, 94, 0.04), transparent 46%), linear-gradient(180deg, #fffaff 0%, #fdf8ff 58%, #fffaff 100%)",
      "--lime-chrome-stage-seam": "rgba(134, 25, 143, 0.07)",
      "--lime-chrome-text": "#2f1b45",
      "--lime-chrome-muted": "#7c6a8a",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #f4e8fb 0%, #fbf4ff 48%, #fffaff 100%)",
      "--lime-sidebar-surface-top": "#f4e8fb",
      "--lime-sidebar-surface-middle": "#fbf4ff",
      "--lime-sidebar-surface-bottom": "#fffaff",
      "--lime-sidebar-border": "rgba(234, 210, 245, 0.72)",
      "--lime-sidebar-divider": "rgba(134,25,143,0.12)",
      "--lime-sidebar-hover": "#f0ddfb",
      "--lime-sidebar-active": "#fae8ff",
      "--lime-sidebar-active-text": "#86198f",
      "--lime-sidebar-search-bg": "#fffaff",
      "--lime-sidebar-search-hover": "#f5e7fb",
      "--lime-sidebar-search-border-hover": "#dbb5eb",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #fffaff 0%, #f5e7fb 100%)",
      "--lime-sidebar-card-border": "rgba(234, 210, 245, 0.7)",
      "--lime-home-bg-start": "#fbf0ff",
      "--lime-home-bg-mid": "#fffaff",
      "--lime-home-bg-end": "#f4fbf7",
      "--lime-home-glow-primary": "rgba(192,38,211,0.04)",
      "--lime-home-glow-secondary": "rgba(34,197,94,0.05)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #2f1b45 0%, #a21caf 54%, #15803d 100%)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #d946ef, #22c55e)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(192,38,211,0.045), 0 0 14px rgba(34,197,94,0.08)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(192,38,211,0) 0%, rgba(192,38,211,0.034) 32%, rgba(255,255,255,0.26) 50%, rgba(34,197,94,0.045) 68%, rgba(192,38,211,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(250,232,255,0.9) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(236,254,255,0.92))",
      "--lime-home-card-border": "rgba(234,210,245,0.86)",
      "--lime-home-card-border-muted": "rgba(234,210,245,0.84)",
      "--lime-home-card-hover-border": "#dbb5eb",
      "--lime-composer-surface":
        "linear-gradient(180deg, #ffffff 0%, #fbf0ff 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #ffffff 0%, #fbf0ff 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #ffffff 0%, #fbf0ff 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #ffffff 0%, #f5e7fb 100%)",
      "--lime-composer-border": "rgba(219, 181, 235, 0.7)",
      "--lime-composer-border-focus": "rgba(192, 38, 211, 0.44)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#86198f 0%,#c026d3 54%,#22c55e 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#86198f 0%,#c026d3 100%)",
    }),
  },
  {
    id: "lime-citron",
    label: "青柠",
    description: "活力清新的黄绿配紫。",
    swatches: ["#fbffe8", "#84cc16", "#6d4fb3"],
    variables: withPalette({
      "--lime-text": "#25351a",
      "--lime-text-muted": "#69735b",
      "--lime-surface": "#fffffb",
      "--lime-surface-subtle": "#fbffe8",
      "--lime-surface-soft": "#f4ffd2",
      "--lime-surface-muted": "#ecf7bf",
      "--lime-surface-hover": "#e3f2a8",
      "--lime-surface-border": "#d9e9a5",
      "--lime-surface-border-strong": "#c4d77d",
      "--lime-brand-strong": "#4d7c0f",
      "--lime-brand": "#84cc16",
      "--lime-brand-muted": "#6d4fb3",
      "--lime-brand-soft": "#f7fee7",
      "--lime-info": "#6d4fb3",
      "--lime-info-soft": "#f5f3ff",
      "--lime-info-border": "#ddd6fe",
      "--lime-focus-ring": "rgba(132, 204, 22, 0.18)",
      "--lime-app-bg": "#f5f8e9",
      "--lime-shell-surface":
        "linear-gradient(180deg, #edf7c7 0%, #fffffb 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #fffffb 0%, #f5f8e9 56%, #fbffe8 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(255,255,251,0.96) 0%, rgba(245,248,233,0.92) 100%)",
      "--lime-stage-surface-top": "#fffffb",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(247,254,231,0.94) 100%)",
      "--lime-card-subtle-border": "rgba(217, 233, 165, 0.76)",
      "--lime-divider-subtle": "rgba(77, 124, 15, 0.14)",
      "--lime-chrome-rail": "#f4ffd2",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #edf7c7 0%, #f4ffd2 100%)",
      "--lime-chrome-surface": "#fbffe8",
      "--lime-chrome-active-tab": "#fffffb",
      "--lime-chrome-tab-hover": "#ecf7bf",
      "--lime-chrome-tab-active-surface": "#fffffb",
      "--lime-chrome-border": "rgba(217, 233, 165, 0.76)",
      "--lime-chrome-divider": "rgba(217, 233, 165, 0.66)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(132, 204, 22, 0.035), transparent 42%), radial-gradient(circle at 78% 115%, rgba(109, 79, 179, 0.038), transparent 46%), linear-gradient(180deg, #fffffb 0%, #fbffe8 58%, #fffffb 100%)",
      "--lime-chrome-stage-seam": "rgba(77, 124, 15, 0.07)",
      "--lime-chrome-text": "#25351a",
      "--lime-chrome-muted": "#69735b",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #edf7c7 0%, #f8fbdc 48%, #fffffb 100%)",
      "--lime-sidebar-surface-top": "#edf7c7",
      "--lime-sidebar-surface-middle": "#f8fbdc",
      "--lime-sidebar-surface-bottom": "#fffffb",
      "--lime-sidebar-border": "rgba(217, 233, 165, 0.72)",
      "--lime-sidebar-divider": "rgba(77,124,15,0.12)",
      "--lime-sidebar-hover": "#ecf7bf",
      "--lime-sidebar-active": "#e3f2a8",
      "--lime-sidebar-active-text": "#4d7c0f",
      "--lime-sidebar-search-bg": "#fffffb",
      "--lime-sidebar-search-hover": "#f4ffd2",
      "--lime-sidebar-search-border-hover": "#c4d77d",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #fffffb 0%, #ecf7bf 100%)",
      "--lime-sidebar-card-border": "rgba(217, 233, 165, 0.7)",
      "--lime-home-bg-start": "#f4ffd2",
      "--lime-home-bg-mid": "#fffffb",
      "--lime-home-bg-end": "#f5f3ff",
      "--lime-home-glow-primary": "rgba(132,204,22,0.045)",
      "--lime-home-glow-secondary": "rgba(109,79,179,0.045)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #25351a 0%, #4d7c0f 54%, #6d4fb3 100%)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #84cc16, #6d4fb3)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(132,204,22,0.05), 0 0 14px rgba(109,79,179,0.075)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(132,204,22,0) 0%, rgba(132,204,22,0.038) 32%, rgba(255,255,255,0.24) 50%, rgba(109,79,179,0.042) 68%, rgba(132,204,22,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(247,254,231,0.92) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(245,243,255,0.92))",
      "--lime-home-card-border": "rgba(217,233,165,0.86)",
      "--lime-home-card-border-muted": "rgba(217,233,165,0.84)",
      "--lime-home-card-hover-border": "#c4d77d",
      "--lime-composer-surface":
        "linear-gradient(180deg, #ffffff 0%, #f4ffd2 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #ffffff 0%, #f4ffd2 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #ffffff 0%, #f4ffd2 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #ffffff 0%, #ecf7bf 100%)",
      "--lime-composer-border": "rgba(196, 215, 125, 0.7)",
      "--lime-composer-border-focus": "rgba(132, 204, 22, 0.46)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#4d7c0f 0%,#84cc16 54%,#6d4fb3 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#4d7c0f 0%,#84cc16 100%)",
    }),
  },
  {
    id: "lime-dusk",
    label: "黄昏",
    description: "柔和温暖的暮色调。",
    swatches: ["#fbf4e5", "#7c7f32", "#c1784a"],
    variables: withPalette({
      "--lime-text": "#3f3529",
      "--lime-text-muted": "#7a6f61",
      "--lime-surface": "#fffaf2",
      "--lime-surface-subtle": "#fbf4e5",
      "--lime-surface-soft": "#f7ead7",
      "--lime-surface-muted": "#efdfc8",
      "--lime-surface-hover": "#ead4ba",
      "--lime-surface-border": "#dcc8aa",
      "--lime-surface-border-strong": "#c9ad83",
      "--lime-brand-strong": "#65691f",
      "--lime-brand": "#7c7f32",
      "--lime-brand-muted": "#c1784a",
      "--lime-brand-soft": "#f7f3dd",
      "--lime-info": "#8a5a44",
      "--lime-info-soft": "#fff7ed",
      "--lime-info-border": "#fed7aa",
      "--lime-warning": "#9a5a1f",
      "--lime-warning-soft": "#fff7ed",
      "--lime-warning-border": "#fed7aa",
      "--lime-focus-ring": "rgba(124, 127, 50, 0.16)",
      "--lime-app-bg": "#f3eadc",
      "--lime-shell-surface":
        "linear-gradient(180deg, #eadfce 0%, #fffaf2 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #fffaf2 0%, #f3eadc 56%, #fbf4e5 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(255,250,242,0.96) 0%, rgba(243,234,220,0.92) 100%)",
      "--lime-stage-surface-top": "#fffaf2",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,250,242,0.96) 0%, rgba(247,234,215,0.94) 100%)",
      "--lime-card-subtle-border": "rgba(220, 200, 170, 0.76)",
      "--lime-divider-subtle": "rgba(124, 127, 50, 0.14)",
      "--lime-chrome-rail": "#f7ead7",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #eadfce 0%, #f7ead7 100%)",
      "--lime-chrome-surface": "#fbf4e5",
      "--lime-chrome-active-tab": "#fffaf2",
      "--lime-chrome-tab-hover": "#efdfc8",
      "--lime-chrome-tab-active-surface": "#fffaf2",
      "--lime-chrome-border": "rgba(220, 200, 170, 0.76)",
      "--lime-chrome-divider": "rgba(220, 200, 170, 0.66)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(124, 127, 50, 0.03), transparent 42%), radial-gradient(circle at 78% 115%, rgba(193, 120, 74, 0.038), transparent 46%), linear-gradient(180deg, #fffaf2 0%, #fbf4e5 58%, #fffaf2 100%)",
      "--lime-chrome-stage-seam": "rgba(124, 127, 50, 0.07)",
      "--lime-chrome-text": "#3f3529",
      "--lime-chrome-muted": "#7a6f61",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #eadfce 0%, #f6ecdc 48%, #fffaf2 100%)",
      "--lime-sidebar-surface-top": "#eadfce",
      "--lime-sidebar-surface-middle": "#f6ecdc",
      "--lime-sidebar-surface-bottom": "#fffaf2",
      "--lime-sidebar-border": "rgba(220, 200, 170, 0.72)",
      "--lime-sidebar-divider": "rgba(124,127,50,0.12)",
      "--lime-sidebar-hover": "#efdfc8",
      "--lime-sidebar-active": "#f0e8c3",
      "--lime-sidebar-active-text": "#65691f",
      "--lime-sidebar-search-bg": "#fffaf2",
      "--lime-sidebar-search-hover": "#f7ead7",
      "--lime-sidebar-search-border-hover": "#c9ad83",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #fffaf2 0%, #efdfc8 100%)",
      "--lime-sidebar-card-border": "rgba(220, 200, 170, 0.7)",
      "--lime-home-bg-start": "#f7ead7",
      "--lime-home-bg-mid": "#fffaf2",
      "--lime-home-bg-end": "#f7f3dd",
      "--lime-home-glow-primary": "rgba(124,127,50,0.04)",
      "--lime-home-glow-secondary": "rgba(193,120,74,0.05)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #3f3529 0%, #65691f 52%, #9a5a1f 100%)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #7c7f32, #c1784a)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(124,127,50,0.045), 0 0 14px rgba(193,120,74,0.08)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(124,127,50,0) 0%, rgba(124,127,50,0.034) 32%, rgba(255,255,255,0.24) 50%, rgba(193,120,74,0.044) 68%, rgba(124,127,50,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,250,242,0.98) 0%, rgba(247,234,215,0.92) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,250,242,0.98), rgba(247,243,221,0.92))",
      "--lime-home-card-border": "rgba(220,200,170,0.86)",
      "--lime-home-card-border-muted": "rgba(220,200,170,0.84)",
      "--lime-home-card-hover-border": "#c9ad83",
      "--lime-composer-surface":
        "linear-gradient(180deg, #fffaf2 0%, #f7ead7 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #fffaf2 0%, #f7ead7 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #fffaf2 0%, #f7ead7 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #fffaf2 0%, #efdfc8 100%)",
      "--lime-composer-border": "rgba(201, 173, 131, 0.72)",
      "--lime-composer-border-focus": "rgba(124, 127, 50, 0.44)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#65691f 0%,#7c7f32 54%,#c1784a 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#65691f 0%,#7c7f32 100%)",
    }),
  },
  {
    id: "lime-minimal",
    label: "极简",
    description: "清晰专业的深蓝商务风。",
    swatches: ["#f8fafc", "#334155", "#2563eb"],
    variables: withPalette({
      "--lime-text": "#1e293b",
      "--lime-text-muted": "#64748b",
      "--lime-surface": "#ffffff",
      "--lime-surface-subtle": "#f8fafc",
      "--lime-surface-soft": "#f1f5f9",
      "--lime-surface-muted": "#e2e8f0",
      "--lime-surface-hover": "#eef2f7",
      "--lime-surface-border": "#d8e0ea",
      "--lime-surface-border-strong": "#cbd5e1",
      "--lime-brand-strong": "#334155",
      "--lime-brand": "#2563eb",
      "--lime-brand-muted": "#0f766e",
      "--lime-brand-soft": "#eff6ff",
      "--lime-info": "#0369a1",
      "--lime-info-soft": "#f0f9ff",
      "--lime-info-border": "#bae6fd",
      "--lime-focus-ring": "rgba(37, 99, 235, 0.16)",
      "--lime-app-bg": "#f3f6fa",
      "--lime-shell-surface":
        "linear-gradient(180deg, #eef2f7 0%, #ffffff 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #ffffff 0%, #f3f6fa 56%, #f8fafc 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(243,246,250,0.92) 100%)",
      "--lime-stage-surface-top": "#ffffff",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)",
      "--lime-card-subtle-border": "rgba(216, 224, 234, 0.8)",
      "--lime-divider-subtle": "rgba(51, 65, 85, 0.12)",
      "--lime-chrome-rail": "#f1f5f9",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #eef2f7 0%, #f1f5f9 100%)",
      "--lime-chrome-surface": "#f8fafc",
      "--lime-chrome-active-tab": "#ffffff",
      "--lime-chrome-tab-hover": "#e2e8f0",
      "--lime-chrome-tab-active-surface": "#ffffff",
      "--lime-chrome-border": "rgba(216, 224, 234, 0.78)",
      "--lime-chrome-divider": "rgba(216, 224, 234, 0.68)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(37, 99, 235, 0.026), transparent 42%), radial-gradient(circle at 78% 115%, rgba(15, 118, 110, 0.028), transparent 46%), linear-gradient(180deg, #ffffff 0%, #f8fafc 58%, #ffffff 100%)",
      "--lime-chrome-stage-seam": "rgba(51, 65, 85, 0.065)",
      "--lime-chrome-text": "#1e293b",
      "--lime-chrome-muted": "#64748b",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #eef2f7 0%, #f8fafc 48%, #ffffff 100%)",
      "--lime-sidebar-surface-top": "#eef2f7",
      "--lime-sidebar-surface-middle": "#f8fafc",
      "--lime-sidebar-surface-bottom": "#ffffff",
      "--lime-sidebar-border": "rgba(216, 224, 234, 0.72)",
      "--lime-sidebar-divider": "rgba(51,65,85,0.1)",
      "--lime-sidebar-hover": "#e2e8f0",
      "--lime-sidebar-active": "#eaf2ff",
      "--lime-sidebar-active-text": "#1d4ed8",
      "--lime-sidebar-search-bg": "#ffffff",
      "--lime-sidebar-search-hover": "#f1f5f9",
      "--lime-sidebar-search-border-hover": "#cbd5e1",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #ffffff 0%, #eef2f7 100%)",
      "--lime-sidebar-card-border": "rgba(216, 224, 234, 0.72)",
      "--lime-home-bg-start": "#f1f5f9",
      "--lime-home-bg-mid": "#ffffff",
      "--lime-home-bg-end": "#eff6ff",
      "--lime-home-glow-primary": "rgba(37,99,235,0.032)",
      "--lime-home-glow-secondary": "rgba(15,118,110,0.032)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #1e293b 0%, #334155 54%, #2563eb 100%)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #334155, #2563eb)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(37,99,235,0.04), 0 0 14px rgba(51,65,85,0.07)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(37,99,235,0) 0%, rgba(37,99,235,0.032) 32%, rgba(255,255,255,0.24) 50%, rgba(15,118,110,0.032) 68%, rgba(37,99,235,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.94) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(239,246,255,0.92))",
      "--lime-home-card-border": "rgba(216,224,234,0.88)",
      "--lime-home-card-border-muted": "rgba(216,224,234,0.86)",
      "--lime-home-card-hover-border": "#cbd5e1",
      "--lime-composer-surface":
        "linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #ffffff 0%, #eff6ff 100%)",
      "--lime-composer-border": "rgba(203, 213, 225, 0.74)",
      "--lime-composer-border-focus": "rgba(37, 99, 235, 0.44)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#334155 0%,#2563eb 58%,#0f766e 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#334155 0%,#2563eb 100%)",
    }),
  },
  {
    id: "lime-vivid",
    label: "活力",
    description: "时尚有冲击力的现代科技风。",
    swatches: ["#f0fdfa", "#14b8a6", "#f97316"],
    variables: withPalette({
      "--lime-text": "#143d3a",
      "--lime-text-muted": "#607874",
      "--lime-surface": "#ffffff",
      "--lime-surface-subtle": "#f0fdfa",
      "--lime-surface-soft": "#e8fbf7",
      "--lime-surface-muted": "#d7f3ed",
      "--lime-surface-hover": "#c8eee7",
      "--lime-surface-border": "#bde7df",
      "--lime-surface-border-strong": "#98d7cd",
      "--lime-brand-strong": "#0f766e",
      "--lime-brand": "#14b8a6",
      "--lime-brand-muted": "#f97316",
      "--lime-brand-soft": "#ccfbf1",
      "--lime-info": "#0ea5e9",
      "--lime-info-soft": "#f0f9ff",
      "--lime-info-border": "#bae6fd",
      "--lime-warning": "#c2410c",
      "--lime-warning-soft": "#fff7ed",
      "--lime-warning-border": "#fed7aa",
      "--lime-focus-ring": "rgba(20, 184, 166, 0.18)",
      "--lime-app-bg": "#eef9f7",
      "--lime-shell-surface":
        "linear-gradient(180deg, #dff7f1 0%, #ffffff 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #ffffff 0%, #eef9f7 56%, #f0fdfa 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(238,249,247,0.92) 100%)",
      "--lime-stage-surface-top": "#ffffff",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(240,253,250,0.94) 100%)",
      "--lime-card-subtle-border": "rgba(189, 231, 223, 0.78)",
      "--lime-divider-subtle": "rgba(15, 118, 110, 0.13)",
      "--lime-chrome-rail": "#e8fbf7",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #dff7f1 0%, #e8fbf7 100%)",
      "--lime-chrome-surface": "#f0fdfa",
      "--lime-chrome-active-tab": "#ffffff",
      "--lime-chrome-tab-hover": "#d7f3ed",
      "--lime-chrome-tab-active-surface": "#ffffff",
      "--lime-chrome-border": "rgba(189, 231, 223, 0.78)",
      "--lime-chrome-divider": "rgba(189, 231, 223, 0.66)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(20, 184, 166, 0.034), transparent 42%), radial-gradient(circle at 78% 115%, rgba(249, 115, 22, 0.036), transparent 46%), linear-gradient(180deg, #ffffff 0%, #f0fdfa 58%, #ffffff 100%)",
      "--lime-chrome-stage-seam": "rgba(15, 118, 110, 0.07)",
      "--lime-chrome-text": "#143d3a",
      "--lime-chrome-muted": "#607874",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #dff7f1 0%, #f0fdfa 48%, #ffffff 100%)",
      "--lime-sidebar-surface-top": "#dff7f1",
      "--lime-sidebar-surface-middle": "#f0fdfa",
      "--lime-sidebar-surface-bottom": "#ffffff",
      "--lime-sidebar-border": "rgba(189, 231, 223, 0.72)",
      "--lime-sidebar-divider": "rgba(15,118,110,0.11)",
      "--lime-sidebar-hover": "#d7f3ed",
      "--lime-sidebar-active": "#ccfbf1",
      "--lime-sidebar-active-text": "#0f766e",
      "--lime-sidebar-search-bg": "#ffffff",
      "--lime-sidebar-search-hover": "#e8fbf7",
      "--lime-sidebar-search-border-hover": "#98d7cd",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #ffffff 0%, #d7f3ed 100%)",
      "--lime-sidebar-card-border": "rgba(189, 231, 223, 0.7)",
      "--lime-home-bg-start": "#e8fbf7",
      "--lime-home-bg-mid": "#ffffff",
      "--lime-home-bg-end": "#fff7ed",
      "--lime-home-glow-primary": "rgba(20,184,166,0.045)",
      "--lime-home-glow-secondary": "rgba(249,115,22,0.048)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #143d3a 0%, #0f766e 54%, #c2410c 100%)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #14b8a6, #f97316)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(20,184,166,0.045), 0 0 14px rgba(249,115,22,0.08)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(20,184,166,0) 0%, rgba(20,184,166,0.036) 32%, rgba(255,255,255,0.24) 50%, rgba(249,115,22,0.042) 68%, rgba(20,184,166,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(240,253,250,0.92) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(255,247,237,0.92))",
      "--lime-home-card-border": "rgba(189,231,223,0.88)",
      "--lime-home-card-border-muted": "rgba(189,231,223,0.84)",
      "--lime-home-card-hover-border": "#98d7cd",
      "--lime-composer-surface":
        "linear-gradient(180deg, #ffffff 0%, #e8fbf7 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #ffffff 0%, #e8fbf7 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #ffffff 0%, #e8fbf7 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #ffffff 0%, #d7f3ed 100%)",
      "--lime-composer-border": "rgba(152, 215, 205, 0.72)",
      "--lime-composer-border-focus": "rgba(20, 184, 166, 0.46)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#0f766e 0%,#14b8a6 54%,#f97316 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#0f766e 0%,#14b8a6 100%)",
    }),
  },
  {
    id: "lime-literary",
    label: "文艺",
    description: "宁静高雅的灰蓝文艺风。",
    swatches: ["#f5f7fb", "#53627a", "#8b7ab8"],
    variables: withPalette({
      "--lime-text": "#283244",
      "--lime-text-muted": "#6b7280",
      "--lime-surface": "#ffffff",
      "--lime-surface-subtle": "#f8fafc",
      "--lime-surface-soft": "#f2f5f9",
      "--lime-surface-muted": "#e8edf4",
      "--lime-surface-hover": "#e1e8f1",
      "--lime-surface-border": "#d7e0eb",
      "--lime-surface-border-strong": "#c3cedc",
      "--lime-brand-strong": "#475569",
      "--lime-brand": "#64748b",
      "--lime-brand-muted": "#8b7ab8",
      "--lime-brand-soft": "#f1f5f9",
      "--lime-info": "#66738f",
      "--lime-info-soft": "#eef2ff",
      "--lime-info-border": "#c7d2fe",
      "--lime-focus-ring": "rgba(100, 116, 139, 0.16)",
      "--lime-app-bg": "#f1f4f8",
      "--lime-shell-surface":
        "linear-gradient(180deg, #e8edf4 0%, #ffffff 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #ffffff 0%, #f1f4f8 56%, #f8fafc 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(241,244,248,0.92) 100%)",
      "--lime-stage-surface-top": "#ffffff",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(242,245,249,0.94) 100%)",
      "--lime-card-subtle-border": "rgba(215, 224, 235, 0.78)",
      "--lime-divider-subtle": "rgba(71, 85, 105, 0.12)",
      "--lime-chrome-rail": "#f2f5f9",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #e8edf4 0%, #f2f5f9 100%)",
      "--lime-chrome-surface": "#f8fafc",
      "--lime-chrome-active-tab": "#ffffff",
      "--lime-chrome-tab-hover": "#e8edf4",
      "--lime-chrome-tab-active-surface": "#ffffff",
      "--lime-chrome-border": "rgba(215, 224, 235, 0.78)",
      "--lime-chrome-divider": "rgba(215, 224, 235, 0.68)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(100, 116, 139, 0.026), transparent 42%), radial-gradient(circle at 78% 115%, rgba(139, 122, 184, 0.034), transparent 46%), linear-gradient(180deg, #ffffff 0%, #f8fafc 58%, #ffffff 100%)",
      "--lime-chrome-stage-seam": "rgba(71, 85, 105, 0.065)",
      "--lime-chrome-text": "#283244",
      "--lime-chrome-muted": "#6b7280",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #e8edf4 0%, #f5f7fb 48%, #ffffff 100%)",
      "--lime-sidebar-surface-top": "#e8edf4",
      "--lime-sidebar-surface-middle": "#f5f7fb",
      "--lime-sidebar-surface-bottom": "#ffffff",
      "--lime-sidebar-border": "rgba(215, 224, 235, 0.72)",
      "--lime-sidebar-divider": "rgba(71,85,105,0.1)",
      "--lime-sidebar-hover": "#e8edf4",
      "--lime-sidebar-active": "#eef2ff",
      "--lime-sidebar-active-text": "#475569",
      "--lime-sidebar-search-bg": "#ffffff",
      "--lime-sidebar-search-hover": "#f2f5f9",
      "--lime-sidebar-search-border-hover": "#c3cedc",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #ffffff 0%, #e8edf4 100%)",
      "--lime-sidebar-card-border": "rgba(215, 224, 235, 0.7)",
      "--lime-home-bg-start": "#f2f5f9",
      "--lime-home-bg-mid": "#ffffff",
      "--lime-home-bg-end": "#eef2ff",
      "--lime-home-glow-primary": "rgba(100,116,139,0.032)",
      "--lime-home-glow-secondary": "rgba(139,122,184,0.04)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #283244 0%, #53627a 54%, #8b7ab8 100%)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #53627a, #8b7ab8)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(100,116,139,0.04), 0 0 14px rgba(139,122,184,0.075)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(100,116,139,0) 0%, rgba(100,116,139,0.03) 32%, rgba(255,255,255,0.24) 50%, rgba(139,122,184,0.038) 68%, rgba(100,116,139,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(242,245,249,0.92) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(238,242,255,0.92))",
      "--lime-home-card-border": "rgba(215,224,235,0.88)",
      "--lime-home-card-border-muted": "rgba(215,224,235,0.84)",
      "--lime-home-card-hover-border": "#c3cedc",
      "--lime-composer-surface":
        "linear-gradient(180deg, #ffffff 0%, #f2f5f9 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #ffffff 0%, #f2f5f9 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #ffffff 0%, #f2f5f9 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #ffffff 0%, #eef2ff 100%)",
      "--lime-composer-border": "rgba(195, 206, 220, 0.72)",
      "--lime-composer-border-focus": "rgba(100, 116, 139, 0.44)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#475569 0%,#64748b 54%,#8b7ab8 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#475569 0%,#64748b 100%)",
    }),
  },
  {
    id: "lime-luxury",
    label: "奢华",
    description: "尊贵权威的黑金商务风。",
    swatches: ["#fbf8ef", "#1f2933", "#c9a23a"],
    variables: withPalette({
      "--lime-text": "#2c2a24",
      "--lime-text-muted": "#746f62",
      "--lime-surface": "#fffdf7",
      "--lime-surface-subtle": "#fbf8ef",
      "--lime-surface-soft": "#f4efe2",
      "--lime-surface-muted": "#ebe2cf",
      "--lime-surface-hover": "#e6dac2",
      "--lime-surface-border": "#d8cab0",
      "--lime-surface-border-strong": "#c9a23a",
      "--lime-brand-strong": "#1f2933",
      "--lime-brand": "#9d7a22",
      "--lime-brand-muted": "#c9a23a",
      "--lime-brand-soft": "#f8edd0",
      "--lime-info": "#58606a",
      "--lime-info-soft": "#f4f6f8",
      "--lime-info-border": "#d8dee6",
      "--lime-warning": "#8a5a10",
      "--lime-warning-soft": "#fff7e6",
      "--lime-warning-border": "#f3d28d",
      "--lime-focus-ring": "rgba(157, 122, 34, 0.16)",
      "--lime-app-bg": "#f1eadc",
      "--lime-shell-surface":
        "linear-gradient(180deg, #e8dec9 0%, #fffdf7 100%)",
      "--lime-stage-surface":
        "linear-gradient(180deg, #fffdf7 0%, #f1eadc 56%, #fbf8ef 100%)",
      "--lime-stage-surface-soft":
        "linear-gradient(180deg, rgba(255,253,247,0.96) 0%, rgba(241,234,220,0.92) 100%)",
      "--lime-stage-surface-top": "#fffdf7",
      "--lime-card-subtle":
        "linear-gradient(180deg, rgba(255,253,247,0.96) 0%, rgba(244,239,226,0.94) 100%)",
      "--lime-card-subtle-border": "rgba(216, 202, 176, 0.78)",
      "--lime-divider-subtle": "rgba(31, 41, 51, 0.12)",
      "--lime-chrome-rail": "#f4efe2",
      "--lime-chrome-rail-surface":
        "linear-gradient(180deg, #e8dec9 0%, #f4efe2 100%)",
      "--lime-chrome-surface": "#fbf8ef",
      "--lime-chrome-active-tab": "#fffdf7",
      "--lime-chrome-tab-hover": "#ebe2cf",
      "--lime-chrome-tab-active-surface": "#fffdf7",
      "--lime-chrome-border": "rgba(216, 202, 176, 0.78)",
      "--lime-chrome-divider": "rgba(216, 202, 176, 0.68)",
      "--lime-chrome-stage-blend":
        "radial-gradient(circle at 18% 100%, rgba(31, 41, 51, 0.026), transparent 42%), radial-gradient(circle at 78% 115%, rgba(201, 162, 58, 0.04), transparent 46%), linear-gradient(180deg, #fffdf7 0%, #fbf8ef 58%, #fffdf7 100%)",
      "--lime-chrome-stage-seam": "rgba(31, 41, 51, 0.07)",
      "--lime-chrome-text": "#2c2a24",
      "--lime-chrome-muted": "#746f62",
      "--lime-sidebar-surface":
        "linear-gradient(180deg, #e8dec9 0%, #f6f0e4 48%, #fffdf7 100%)",
      "--lime-sidebar-surface-top": "#e8dec9",
      "--lime-sidebar-surface-middle": "#f6f0e4",
      "--lime-sidebar-surface-bottom": "#fffdf7",
      "--lime-sidebar-border": "rgba(216, 202, 176, 0.72)",
      "--lime-sidebar-divider": "rgba(31,41,51,0.1)",
      "--lime-sidebar-hover": "#ebe2cf",
      "--lime-sidebar-active": "#f8edd0",
      "--lime-sidebar-active-text": "#1f2933",
      "--lime-sidebar-search-bg": "#fffdf7",
      "--lime-sidebar-search-hover": "#f4efe2",
      "--lime-sidebar-search-border-hover": "#c9a23a",
      "--lime-sidebar-card-surface":
        "linear-gradient(180deg, #fffdf7 0%, #ebe2cf 100%)",
      "--lime-sidebar-card-border": "rgba(216, 202, 176, 0.7)",
      "--lime-home-bg-start": "#f4efe2",
      "--lime-home-bg-mid": "#fffdf7",
      "--lime-home-bg-end": "#f8edd0",
      "--lime-home-glow-primary": "rgba(31,41,51,0.032)",
      "--lime-home-glow-secondary": "rgba(201,162,58,0.048)",
      "--lime-home-title-gradient":
        "linear-gradient(90deg, #1f2933 0%, #2c2a24 52%, #9d7a22 100%)",
      "--lime-home-dot-gradient": "linear-gradient(135deg, #1f2933, #c9a23a)",
      "--lime-home-dot-shadow":
        "0 0 0 8px rgba(31,41,51,0.038), 0 0 14px rgba(201,162,58,0.08)",
      "--lime-home-beam-gradient":
        "linear-gradient(90deg, rgba(31,41,51,0) 0%, rgba(31,41,51,0.03) 32%, rgba(255,255,255,0.24) 50%, rgba(201,162,58,0.044) 68%, rgba(31,41,51,0) 100%)",
      "--lime-home-card-surface":
        "linear-gradient(180deg, rgba(255,253,247,0.98) 0%, rgba(244,239,226,0.92) 100%)",
      "--lime-home-card-surface-strong":
        "linear-gradient(180deg, rgba(255,253,247,0.98), rgba(248,237,208,0.92))",
      "--lime-home-card-border": "rgba(216,202,176,0.88)",
      "--lime-home-card-border-muted": "rgba(216,202,176,0.84)",
      "--lime-home-card-hover-border": "#c9a23a",
      "--lime-composer-surface":
        "linear-gradient(180deg, #fffdf7 0%, #f4efe2 100%)",
      "--lime-composer-shell":
        "linear-gradient(180deg, #fffdf7 0%, #f4efe2 100%)",
      "--lime-composer-surface-floating":
        "linear-gradient(180deg, #fffdf7 0%, #f4efe2 100%)",
      "--lime-composer-surface-focus":
        "linear-gradient(180deg, #fffdf7 0%, #f8edd0 100%)",
      "--lime-composer-border": "rgba(201, 162, 58, 0.48)",
      "--lime-composer-border-focus": "rgba(157, 122, 34, 0.44)",
      "--lime-primary-gradient":
        "linear-gradient(135deg,#1f2933 0%,#2c2a24 54%,#c9a23a 100%)",
      "--lime-primary-gradient-simple":
        "linear-gradient(135deg,#1f2933 0%,#9d7a22 100%)",
    }),
  },
];

const colorSchemeIds = new Set<LimeColorSchemeId>(
  LIME_COLOR_SCHEMES.map((scheme) => scheme.id),
);

export function resolveLimeColorSchemeId(
  value: string | null | undefined,
): LimeColorSchemeId {
  return colorSchemeIds.has(value as LimeColorSchemeId)
    ? (value as LimeColorSchemeId)
    : DEFAULT_LIME_COLOR_SCHEME_ID;
}

export function getLimeColorScheme(
  id: string | null | undefined,
): LimeColorScheme {
  const resolvedId = resolveLimeColorSchemeId(id);
  return (
    LIME_COLOR_SCHEMES.find((scheme) => scheme.id === resolvedId) ??
    LIME_COLOR_SCHEMES[0]
  );
}

export function loadLimeColorSchemeId(): LimeColorSchemeId {
  if (typeof window === "undefined") {
    return DEFAULT_LIME_COLOR_SCHEME_ID;
  }

  return resolveLimeColorSchemeId(
    window.localStorage.getItem(LIME_COLOR_SCHEME_STORAGE_KEY),
  );
}

export function applyLimeColorScheme(
  id: string | null | undefined,
  options: { effectiveThemeMode?: LimeColorSchemeEffectiveThemeMode } = {},
): LimeColorSchemeId {
  if (typeof document === "undefined") {
    return resolveLimeColorSchemeId(id);
  }

  const scheme = getLimeColorScheme(id);
  const root = document.documentElement;
  root.dataset.limeColorScheme = scheme.id;

  Object.entries(scheme.variables).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });

  const effectiveThemeMode =
    options.effectiveThemeMode ??
    (root.dataset.limeThemeEffective === "dark" ||
    root.classList.contains("dark")
      ? "dark"
      : "light");

  if (effectiveThemeMode === "dark") {
    Object.entries(darkThemeVariableOverrides).forEach(([name, value]) => {
      root.style.setProperty(name, value);
    });
  }

  return scheme.id;
}

export function initializeLimeColorScheme(): LimeColorSchemeId {
  return applyLimeColorScheme(loadLimeColorSchemeId());
}

export function persistLimeColorScheme(id: string): LimeColorSchemeId {
  const resolvedId = applyLimeColorScheme(id);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(LIME_COLOR_SCHEME_STORAGE_KEY, resolvedId);
    const detail: LimeColorSchemeChangedEventDetail = {
      colorSchemeId: resolvedId,
    };
    window.dispatchEvent(
      new CustomEvent(LIME_COLOR_SCHEME_CHANGED_EVENT, { detail }),
    );
  }

  return resolvedId;
}
