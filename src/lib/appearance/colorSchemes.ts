export const LIME_COLOR_SCHEME_STORAGE_KEY = "lime.appearance.color-scheme";
export const LIME_COLOR_SCHEME_CHANGED_EVENT = "lime-color-scheme-changed";

export const DEFAULT_LIME_COLOR_SCHEME_ID = "lime-classic";

export type LimeColorSchemeId =
  | "lime-classic"
  | "lime-forest"
  | "lime-ocean"
  | "lime-sand";

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
    label: "Lime 经典",
    description: "保留当前高识别度的 Lime 绿色、浅青与清亮界面。",
    swatches: ["#f8fcf7", "#10b981", "#0ea5e9"],
    variables: classicVariables,
  },
  {
    id: "lime-forest",
    label: "森林",
    description: "降低饱和度，保留绿色主轴，适合长时间创作。",
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
    label: "海雾",
    description: "偏冷静的蓝绿灰，适合信息密集和工程型工作流。",
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
    label: "砂岩",
    description: "暖灰纸面与稳重墨绿，作为柔和低饱和备选。",
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
