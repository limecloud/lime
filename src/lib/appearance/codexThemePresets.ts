import presetData from "./codexThemePresets.json";
import { CODE_THEME_TOKEN_CLASSES } from "./codeThemeTokens";
import { hexToHslTriplet, mixHexColor, readableTextColor } from "./color";

/**
 * Codex Desktop appearance presets extracted from the installed ChatGPT ASAR.
 *
 * Evidence (see internal/exec-plans/appearance-codex-theme-presets-20261114.md):
 * - app.asar SHA-256 3695c17edcab8d66c1e5f2faa03e07826a59a39bf78b369ec87854547d4843c1
 * - webview/assets/async/93122.85c7ebe8fb.js: theme ids, labels, variants
 * - webview/assets/async/98815.7ebfedd002.js: chrome palette table and code theme application
 * - webview/assets/async/11993.408ed5ae74.js: code theme registration names
 * - per-theme chunks: editor background/foreground and token colors
 *
 * The JSON keeps the exact chrome accent/ink/surface/semantic/palette anchors
 * and code editor/syntax colors. Lime derives its semantic CSS variables from
 * those anchors; it does not invent replacement preset colors.
 */

export type CodexThemeId =
  | "absolutely"
  | "ayu"
  | "catppuccin"
  | "codex"
  | "dracula"
  | "everforest"
  | "github"
  | "gruvbox"
  | "linear"
  | "lobster"
  | "material"
  | "matrix"
  | "monokai"
  | "night-owl"
  | "nord"
  | "notion"
  | "og"
  | "one"
  | "oscurange"
  | "proof"
  | "raycast"
  | "rose-pine"
  | "sentry"
  | "solarized"
  | "temple"
  | "tokyo-night"
  | "vercel"
  | "vscode-plus"
  | "xcode";

export type ChromeThemeId = CodexThemeId;
export type CodeThemeId = CodexThemeId;
export type CodexThemeVariant = "light" | "dark";

export const CODEX_THEME_IDS: readonly CodexThemeId[] = [
  "absolutely",
  "ayu",
  "catppuccin",
  "codex",
  "dracula",
  "everforest",
  "github",
  "gruvbox",
  "linear",
  "lobster",
  "material",
  "matrix",
  "monokai",
  "night-owl",
  "nord",
  "notion",
  "og",
  "one",
  "oscurange",
  "proof",
  "raycast",
  "rose-pine",
  "sentry",
  "solarized",
  "temple",
  "tokyo-night",
  "vercel",
  "vscode-plus",
  "xcode",
];

export const DEFAULT_CHROME_THEME_ID: ChromeThemeId = "codex";
export const DEFAULT_CODE_THEME_ID: CodeThemeId = "codex";

export interface CodexTokenStyle {
  color: string;
  italic?: boolean;
  bold?: boolean;
}

export interface CodexChromeSemanticColors {
  diffAdded?: string;
  diffRemoved?: string;
  skill?: string;
}

export interface CodexChromeTheme {
  accent: string;
  ink: string;
  surface: string;
  semanticColors?: CodexChromeSemanticColors;
  palette?: Record<string, string>;
  fonts?: { code?: string | null; content?: string | null; ui?: string | null };
  opaqueWindows?: boolean;
  contrast?: number;
}

export interface CodexThemeVariantPreset {
  codeThemeName: string;
  background: string;
  foreground: string;
  tokens: Record<string, CodexTokenStyle>;
  chrome: CodexChromeTheme | null;
}

export interface CodexThemePreset {
  label: string;
  variants: Partial<Record<CodexThemeVariant, CodexThemeVariantPreset>>;
}

export interface ThemeOption {
  id: CodexThemeId;
  label: string;
}

const PRESETS = presetData as unknown as Record<CodexThemeId, CodexThemePreset>;
const labelCollator = new Intl.Collator("en", { sensitivity: "base" });

export function isCodexThemeId(value: unknown): value is CodexThemeId {
  return (
    typeof value === "string" &&
    (CODEX_THEME_IDS as readonly string[]).includes(value)
  );
}

export function getCodexThemePreset(id: CodexThemeId): CodexThemePreset {
  return PRESETS[id] ?? PRESETS[DEFAULT_CODE_THEME_ID];
}

export function hasThemeVariant(
  id: CodexThemeId,
  variant: CodexThemeVariant,
): boolean {
  return Boolean(getCodexThemePreset(id).variants[variant]);
}

export function getThemeOptions(
  variant: CodexThemeVariant,
  options: { requireBothVariants?: boolean } = {},
): ThemeOption[] {
  return CODEX_THEME_IDS.map((id) => ({
    id,
    label: getCodexThemePreset(id).label,
  }))
    .filter(({ id }) => {
      const variants = getCodexThemePreset(id).variants;
      if (!variants[variant]) return false;
      return (
        !options.requireBothVariants || Boolean(variants.light && variants.dark)
      );
    })
    .sort((first, second) => labelCollator.compare(first.label, second.label));
}

export function getChromeThemeOptions(
  variant: CodexThemeVariant,
  options: { requireBothVariants?: boolean } = {},
): ThemeOption[] {
  return getThemeOptions(variant, options);
}

export function getCodeThemeOptions(
  variant: CodexThemeVariant,
  options: { requireBothVariants?: boolean } = {},
): ThemeOption[] {
  return getThemeOptions(variant, options);
}

export function getCodeThemeName(
  id: CodeThemeId,
  variant: CodexThemeVariant,
): string {
  const preset = getCodexThemePreset(id).variants[variant];
  return (
    preset?.codeThemeName ??
    getCodexThemePreset(DEFAULT_CODE_THEME_ID).variants[variant]
      ?.codeThemeName ??
    id
  );
}

export function resolveChromeTheme(
  id: ChromeThemeId,
  variant: CodexThemeVariant,
): CodexChromeTheme | null {
  const chrome = getCodexThemePreset(id).variants[variant]?.chrome;
  if (!chrome || !chrome.accent || !chrome.ink || !chrome.surface) {
    return null;
  }
  return chrome;
}

export function resolveCodeTheme(
  id: CodeThemeId,
  variant: CodexThemeVariant,
): CodexThemeVariantPreset {
  return (
    getCodexThemePreset(id).variants[variant] ??
    getCodexThemePreset(DEFAULT_CODE_THEME_ID).variants[variant] ??
    getCodexThemePreset(DEFAULT_CODE_THEME_ID).variants.light ??
    getCodexThemePreset(DEFAULT_CODE_THEME_ID).variants.dark!
  );
}

function set(variables: Record<string, string>, name: string, value: string) {
  variables[name] = value;
}

function clampContrast(value: number | undefined, variant: CodexThemeVariant) {
  const fallback = variant === "light" ? 45 : 60;
  if (value === undefined || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, value));
}

/**
 * Projects a Codex chrome preset onto Lime's semantic palette. The preset
 * anchors (accent, ink, surface, diff colors, palette) are exact ASAR values;
 * the intermediate surface/border/text steps are Lime's contrast derivation.
 */
export function buildChromeThemeVariables(
  theme: CodexChromeTheme,
  variant: CodexThemeVariant,
  options: { useThemeAccent?: boolean } = {},
): Record<string, string> {
  const variables: Record<string, string> = {};
  const { accent, ink, surface } = theme;
  const contrast = clampContrast(theme.contrast, variant);
  const subtle = mixHexColor(surface, ink, 0.02 + contrast * 0.0002);
  const soft = mixHexColor(surface, ink, 0.04 + contrast * 0.0004);
  const mutedSurface = mixHexColor(surface, ink, 0.07 + contrast * 0.0006);
  const hover = mixHexColor(surface, ink, 0.06 + contrast * 0.0005);
  const border = mixHexColor(surface, ink, 0.12 + contrast * 0.0008);
  const borderStrong = mixHexColor(surface, ink, 0.24 + contrast * 0.001);
  const mutedText = mixHexColor(ink, surface, 0.32);
  const faintText = mixHexColor(ink, surface, 0.48);

  const palette = theme.palette ?? {};
  const fallback = (light: string, dark: string) =>
    variant === "light" ? light : dark;
  const info = palette.blue ?? fallback("#0d74ce", "#70b8ff");
  const success = palette.green ?? fallback("#218358", "#3dd68c");
  const warning =
    palette.yellow ?? palette.orange ?? fallback("#ab6400", "#ffca16");
  const danger = palette.red ?? fallback("#ce2c31", "#ff9592");
  const diffAdded = theme.semanticColors?.diffAdded ?? palette.green ?? success;
  const diffRemoved =
    theme.semanticColors?.diffRemoved ?? palette.red ?? danger;

  // Tailwind/shadcn HSL variables consumed directly by existing components.
  set(variables, "--background", hexToHslTriplet(surface));
  set(variables, "--foreground", hexToHslTriplet(ink));
  set(variables, "--card", hexToHslTriplet(surface));
  set(variables, "--card-foreground", hexToHslTriplet(ink));
  set(variables, "--popover", hexToHslTriplet(surface));
  set(variables, "--popover-foreground", hexToHslTriplet(ink));
  set(variables, "--primary", hexToHslTriplet(ink));
  set(variables, "--primary-foreground", hexToHslTriplet(surface));
  set(variables, "--secondary", hexToHslTriplet(soft));
  set(variables, "--secondary-foreground", hexToHslTriplet(ink));
  set(variables, "--muted", hexToHslTriplet(soft));
  set(variables, "--muted-foreground", hexToHslTriplet(mutedText));
  set(variables, "--accent", hexToHslTriplet(hover));
  set(variables, "--accent-foreground", hexToHslTriplet(ink));
  set(variables, "--border", hexToHslTriplet(border));
  set(variables, "--input", hexToHslTriplet(border));
  set(
    variables,
    "--ring",
    hexToHslTriplet(options.useThemeAccent ? accent : borderStrong),
  );
  set(variables, "--destructive", hexToHslTriplet(danger));
  set(
    variables,
    "--destructive-foreground",
    hexToHslTriplet(readableTextColor(danger)),
  );

  // Lime semantic surfaces.
  set(variables, "--lime-text-strong", ink);
  set(variables, "--lime-text", ink);
  set(variables, "--lime-text-muted", mutedText);
  set(variables, "--lime-text-soft", mixHexColor(mutedText, ink, 0.35));
  set(variables, "--lime-text-faint", faintText);
  set(variables, "--lime-surface", surface);
  set(variables, "--lime-surface-subtle", subtle);
  set(variables, "--lime-surface-soft", soft);
  set(variables, "--lime-surface-muted", mutedSurface);
  set(variables, "--lime-surface-hover", hover);
  set(variables, "--lime-surface-border", border);
  set(variables, "--lime-surface-border-strong", borderStrong);
  set(variables, "--lime-shadow-color", "transparent");
  set(variables, "--lime-app-bg", subtle);
  set(variables, "--lime-shell-surface", soft);
  set(variables, "--lime-stage-surface", surface);
  set(variables, "--lime-stage-surface-soft", subtle);
  set(variables, "--lime-stage-surface-top", surface);
  set(variables, "--lime-card-subtle", subtle);
  set(variables, "--lime-card-subtle-border", border);
  set(variables, "--lime-divider-subtle", border);
  set(variables, "--lime-settings-surface", surface);

  if (options.useThemeAccent) {
    set(variables, "--lime-brand", accent);
    set(variables, "--lime-brand-strong", mixHexColor(accent, ink, 0.3));
    set(variables, "--lime-brand-muted", mixHexColor(accent, ink, 0.55));
    set(
      variables,
      "--lime-brand-soft",
      mixHexColor(surface, accent, variant === "light" ? 0.1 : 0.18),
    );
    set(variables, "--lime-focus-ring", accent);
  } else {
    set(variables, "--lime-focus-ring", borderStrong);
  }
  set(variables, "--lime-primary-gradient", ink);
  set(variables, "--lime-primary-gradient-simple", ink);

  set(variables, "--lime-info", info);
  set(variables, "--lime-info-soft", mixHexColor(surface, info, 0.12));
  set(variables, "--lime-info-border", mixHexColor(surface, info, 0.42));
  set(variables, "--lime-warning", warning);
  set(variables, "--lime-warning-soft", mixHexColor(surface, warning, 0.12));
  set(variables, "--lime-warning-border", mixHexColor(surface, warning, 0.42));
  set(variables, "--lime-success", success);
  set(variables, "--lime-success-soft", mixHexColor(surface, success, 0.12));
  set(variables, "--lime-success-border", mixHexColor(surface, success, 0.42));
  set(variables, "--lime-danger", danger);
  set(variables, "--lime-danger-soft", mixHexColor(surface, danger, 0.12));
  set(variables, "--lime-danger-border", mixHexColor(surface, danger, 0.42));

  set(variables, "--lime-diff-add-border", diffAdded);
  set(variables, "--lime-diff-add-bg", mixHexColor(surface, diffAdded, 0.12));
  set(
    variables,
    "--lime-diff-add-number-bg",
    mixHexColor(surface, diffAdded, 0.2),
  );
  set(variables, "--lime-diff-remove-border", diffRemoved);
  set(
    variables,
    "--lime-diff-remove-bg",
    mixHexColor(surface, diffRemoved, 0.12),
  );
  set(
    variables,
    "--lime-diff-remove-number-bg",
    mixHexColor(surface, diffRemoved, 0.2),
  );

  // App chrome and sidebar surfaces.
  set(variables, "--lime-chrome-rail", soft);
  set(variables, "--lime-chrome-rail-surface", soft);
  set(variables, "--lime-chrome-surface", subtle);
  set(variables, "--lime-chrome-active-tab", surface);
  set(variables, "--lime-chrome-tab-hover", hover);
  set(variables, "--lime-chrome-tab-active-surface", surface);
  set(variables, "--lime-chrome-border", border);
  set(variables, "--lime-chrome-divider", border);
  set(variables, "--lime-chrome-stage-blend", surface);
  set(variables, "--lime-chrome-stage-seam", border);
  set(variables, "--lime-chrome-shadow-subtle", "none");
  set(variables, "--lime-chrome-text", ink);
  set(variables, "--lime-chrome-muted", mutedText);
  set(variables, "--lime-sidebar-surface", subtle);
  set(variables, "--lime-sidebar-surface-top", subtle);
  set(variables, "--lime-sidebar-surface-middle", subtle);
  set(variables, "--lime-sidebar-surface-bottom", subtle);
  set(variables, "--lime-sidebar-border", border);
  set(variables, "--lime-sidebar-divider", border);
  set(variables, "--lime-sidebar-hover", soft);
  set(variables, "--lime-sidebar-active", hover);
  set(variables, "--lime-sidebar-active-text", ink);
  set(variables, "--lime-sidebar-search-bg", subtle);
  set(variables, "--lime-sidebar-search-hover", soft);
  set(variables, "--lime-sidebar-search-border-hover", borderStrong);
  set(variables, "--lime-sidebar-card-surface", subtle);
  set(variables, "--lime-sidebar-card-border", border);
  set(variables, "--lime-sidebar-card-highlight", "transparent");
  set(variables, "--lime-sidebar-card-shadow", "none");
  set(variables, "--lime-composer-surface", surface);
  set(variables, "--lime-composer-surface-floating", surface);
  set(variables, "--lime-composer-surface-focus", surface);
  set(variables, "--lime-composer-shell", surface);
  set(variables, "--lime-composer-context-surface", soft);
  set(variables, "--lime-composer-context-surface-focus", soft);
  set(variables, "--lime-composer-border", border);
  set(variables, "--lime-composer-border-focus", borderStrong);

  // Legacy semantic aliases still consumed by older components.
  set(variables, "--surface", surface);
  set(variables, "--surface-secondary", subtle);
  set(variables, "--surface-tertiary", soft);
  set(variables, "--surface-cream", subtle);
  set(variables, "--ink-900", ink);
  set(variables, "--ink-700", ink);
  set(variables, "--ink-600", mutedText);
  set(variables, "--ink-400", faintText);
  set(variables, "--claude-accent", ink);
  set(variables, "--claude-accent-hover", mutedText);
  set(variables, "--claude-accent-subtle", soft);
  set(variables, "--success", success);
  set(variables, "--info", info);
  set(variables, "--tooltip-bg", surface);
  set(variables, "--tooltip-foreground", ink);
  set(variables, "--tooltip-border", border);
  set(variables, "--tooltip-shadow", "none");

  return variables;
}

/**
 * Projects the selected Codex code theme onto code-block/diff CSS variables.
 * Editor background/foreground and token colors are exact ASAR values.
 */
export function buildCodeThemeVariables(
  theme: CodexThemeVariantPreset,
): Record<string, string> {
  const variables: Record<string, string> = {};
  const background = theme.background;
  const foreground = theme.foreground;
  const border = mixHexColor(background, foreground, 0.16);
  const muted =
    theme.tokens.comment?.color ?? mixHexColor(foreground, background, 0.4);

  set(variables, "--lime-code-surface", background);
  set(variables, "--lime-code-diff-surface", background);
  set(variables, "--lime-code-text", foreground);
  set(variables, "--lime-code-diff-text", foreground);
  set(variables, "--lime-code-muted", muted);
  set(variables, "--lime-code-border", border);
  set(
    variables,
    "--lime-code-header-surface",
    mixHexColor(background, foreground, 0.04),
  );
  set(
    variables,
    "--lime-code-button-surface",
    mixHexColor(background, foreground, 0.06),
  );
  set(
    variables,
    "--lime-code-button-hover-surface",
    mixHexColor(background, foreground, 0.1),
  );
  set(
    variables,
    "--lime-code-inline-surface",
    mixHexColor(background, foreground, 0.04),
  );
  set(
    variables,
    "--lime-code-selection",
    mixHexColor(background, foreground, 0.22),
  );
  set(variables, "--lime-code-theme-name", theme.codeThemeName);

  for (const token of CODE_THEME_TOKEN_CLASSES) {
    set(
      variables,
      `--lime-code-syntax-${token}`,
      theme.tokens[token]?.color ?? foreground,
    );
  }

  return variables;
}
