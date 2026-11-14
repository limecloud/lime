import styled from "styled-components";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LIME_THEME_CHANGED_EVENT,
  getEffectiveLimeThemeMode,
  loadLimeThemeMode,
  type LimeEffectiveThemeMode,
  type LimeThemeMode,
} from "@/lib/appearance/themeMode";
import {
  getChromeThemeOptions,
  getCodeThemeOptions,
  getCodexThemePreset,
  type ChromeThemeId,
  type CodeThemeId,
} from "@/lib/appearance/codexThemePresets";
import {
  setChromeTheme,
  setCodeTheme,
  useChromeTheme,
  useCodeTheme,
} from "@/lib/appearance/themePresets";
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsAction,
  SettingsRow,
  SettingsSection,
  SettingsSegmentedControl,
  SettingsSwitch,
  SettingsValueMenu,
} from "../../SettingsPrimitives";
import {
  setPointerCursorsEnabled,
  usePointerCursorsEnabled,
} from "@/lib/appearance/pointerCursor";
import {
  CONTENT_FONT_SIZES,
  setContentFontSize,
  useContentFontSize,
  type ContentFontSize,
} from "@/lib/appearance/typography";
import {
  UI_FONT_SIZES,
  setUiFontSize,
  useUiFontSize,
  type UiFontSize,
} from "@/lib/appearance/uiFontSize";
import {
  UI_FONT_FAMILIES,
  setUiFontFamily,
  useUiFontFamily,
  type UiFontFamily,
} from "@/lib/appearance/uiFontFamily";
import {
  CONTENT_FONT_FAMILIES,
  setContentFontFamily,
  useContentFontFamily,
  type ContentFontFamily,
} from "@/lib/appearance/contentFontFamily";
import {
  ACCENT_COLORS,
  setAccentColor,
  useAccentColor,
  type AccentColor,
} from "@/lib/appearance/accent";
import {
  setSmartPunctuationEnabled,
  useSmartPunctuationEnabled,
} from "@/lib/appearance/smartPunctuation";
import {
  setSeparateModePreferences,
  setSeparateModesEnabled,
  useSeparateModePreferences,
} from "@/lib/appearance/separateModes";
import {
  setReducedMotionPreference,
  useReducedMotionPreference,
  type ReducedMotionPreference,
} from "@/lib/appearance/reducedMotion";
import {
  isMacOSPlatform,
  setFontSmoothingEnabled,
  useFontSmoothingEnabled,
} from "@/lib/appearance/fontSmoothing";
import {
  CODE_FONT_FAMILIES,
  setCodeFontFamily,
  useCodeFontFamily,
  type CodeFontFamily,
} from "@/lib/appearance/codeFontFamily";
import {
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  setCodeFontSize,
  useCodeFontSize,
} from "@/lib/appearance/codeFontSize";
import { resetAppearancePreferences } from "@/lib/appearance/reset";
import { FontSizeField } from "./FontSizeField";

const ModeChoices = styled.div`
  display: flex;
  gap: clamp(6px, 3cqw, 12px);
  button {
    width: clamp(48px, 20cqw, 80px);
    height: clamp(36px, 15cqw, 60px);
    padding: 4px;
    border: 0.5px solid var(--lime-surface-border, hsl(var(--border)));
    border-radius: 9px;
    background: var(--lime-surface-subtle, hsl(var(--muted)));
    cursor: pointer;
  }
  button[aria-checked="true"] {
    outline: 2px solid var(--lime-brand, hsl(var(--primary)));
    outline-offset: 1px;
  }
  button:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 3px;
  }
  .mode-preview {
    display: flex;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border: 0.5px solid var(--lime-surface-border);
    border-radius: 5px;
    background: var(--appearance-preview-light);
  }
  .mode-preview[data-mode="dark"] {
    background: var(--appearance-preview-dark);
  }
  .mode-preview[data-mode="system"] {
    background: linear-gradient(
      90deg,
      var(--appearance-preview-light) 50%,
      var(--appearance-preview-dark) 50%
    );
  }
  .preview-sidebar {
    width: 25%;
    background: var(--lime-surface-muted);
    border-right: 0.5px solid var(--lime-surface-border);
  }
  .preview-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6px;
    padding: 5px;
  }
  .preview-line {
    height: 2px;
    width: 75%;
    background: var(--lime-text-muted);
    opacity: 0.5;
  }
  .preview-message {
    height: 12px;
    width: 85%;
    border: 0.5px solid var(--lime-surface-border);
    border-radius: 4px;
  }
`;

function useEffectiveThemeVariant(
  theme: LimeThemeMode,
): LimeEffectiveThemeMode {
  const [variant, setVariant] = useState<LimeEffectiveThemeMode>(() =>
    getEffectiveLimeThemeMode(theme),
  );

  useEffect(() => {
    const update = () =>
      setVariant(getEffectiveLimeThemeMode(loadLimeThemeMode()));
    update();
    window.addEventListener(LIME_THEME_CHANGED_EVENT, update);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener(LIME_THEME_CHANGED_EVENT, update);
      media?.removeEventListener?.("change", update);
    };
  }, [theme]);

  return variant;
}

function ChromeThemeRow({
  label,
  description,
  targetId,
  variant,
  value,
  onChange,
  requireBothVariants = false,
}: {
  label: string;
  description?: string;
  targetId: string;
  variant: LimeEffectiveThemeMode;
  value: ChromeThemeId;
  onChange: (value: ChromeThemeId) => void;
  requireBothVariants?: boolean;
}) {
  const options = getChromeThemeOptions(variant, { requireBothVariants });
  if (!options.some((option) => option.id === value)) {
    options.unshift({ id: value, label: getCodexThemePreset(value).label });
  }
  return (
    <SettingsRow label={label} description={description} targetId={targetId}>
      <SettingsValueMenu
        targetId={targetId}
        described={Boolean(description)}
        value={value}
        disabled={false}
        options={options.map((option) => ({
          value: option.id as ChromeThemeId,
          label: option.label,
        }))}
        onChange={(next) => onChange(next as ChromeThemeId)}
      />
    </SettingsRow>
  );
}

function CodeThemeRow({
  label,
  description,
  targetId,
  variant,
  value,
  onChange,
  requireBothVariants = false,
}: {
  label: string;
  description?: string;
  targetId: string;
  variant: LimeEffectiveThemeMode;
  value: CodeThemeId;
  onChange: (value: CodeThemeId) => void;
  requireBothVariants?: boolean;
}) {
  const { t } = useTranslation("settings");
  const options = getCodeThemeOptions(variant, { requireBothVariants });
  if (!options.some((option) => option.id === value)) {
    options.unshift({ id: value, label: getCodexThemePreset(value).label });
  }
  return (
    <SettingsRow label={label} description={description} targetId={targetId}>
      <SettingsValueMenu
        targetId={targetId}
        described={Boolean(description)}
        value={value}
        disabled={false}
        options={options.map((option) => ({
          value: option.id as CodeThemeId,
          label:
            option.id === "codex"
              ? t("settings.appearance.codeTheme.chatgpt")
              : option.label,
        }))}
        onChange={(next) => onChange(next as CodeThemeId)}
      />
    </SettingsRow>
  );
}

function AccentRow({
  label,
  targetId,
  value,
  onChange,
}: {
  label: string;
  targetId: string;
  value: AccentColor;
  onChange: (value: AccentColor) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsRow label={label} targetId={targetId}>
      <SettingsValueMenu
        targetId={targetId}
        disabled={false}
        value={value}
        options={ACCENT_COLORS.map((color) => ({
          value: color,
          label: t(`settings.appearance.accent.${color}`),
        }))}
        onChange={(next) => onChange(next as AccentColor)}
      />
    </SettingsRow>
  );
}

function UiFontFamilyRow({
  label,
  description,
  targetId,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  targetId: string;
  value: UiFontFamily;
  onChange: (value: UiFontFamily) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsRow label={label} description={description} targetId={targetId}>
      <SettingsValueMenu
        targetId={targetId}
        described={Boolean(description)}
        value={value}
        disabled={false}
        options={UI_FONT_FAMILIES.map((family) => ({
          value: family,
          label: t(`settings.appearance.fontFamily.${family}`),
        }))}
        onChange={(next) => onChange(next as UiFontFamily)}
      />
    </SettingsRow>
  );
}

function ContentFontFamilyRow({
  label,
  description,
  targetId,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  targetId: string;
  value: ContentFontFamily;
  onChange: (value: ContentFontFamily) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsRow label={label} description={description} targetId={targetId}>
      <SettingsValueMenu
        targetId={targetId}
        described={Boolean(description)}
        value={value}
        disabled={false}
        options={CONTENT_FONT_FAMILIES.map((family) => ({
          value: family,
          label:
            family === "ui"
              ? t("settings.appearance.contentFontFamilySameAsUi")
              : t(`settings.appearance.fontFamily.${family}`),
        }))}
        onChange={(next) => onChange(next as ContentFontFamily)}
      />
    </SettingsRow>
  );
}

function CodeFontFamilyRow({
  label,
  description,
  targetId,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  targetId: string;
  value: CodeFontFamily;
  onChange: (value: CodeFontFamily) => void;
}) {
  const { t } = useTranslation("settings");
  return (
    <SettingsRow label={label} description={description} targetId={targetId}>
      <SettingsValueMenu
        targetId={targetId}
        described={Boolean(description)}
        value={value}
        disabled={false}
        options={CODE_FONT_FAMILIES.map((family) => ({
          value: family,
          label: t(`settings.appearance.codeFontFamilyOption.${family}`),
        }))}
        onChange={(next) => onChange(next as CodeFontFamily)}
      />
    </SettingsRow>
  );
}

function FontSizeRow({
  label,
  description,
  targetId,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  description: string;
  targetId: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsRow label={label} description={description} targetId={targetId}>
      <FontSizeField
        value={value}
        min={min}
        max={max}
        label={label}
        onChange={onChange}
      />
    </SettingsRow>
  );
}

export interface ThemeOption {
  id: LimeThemeMode;
  label: string;
}

interface AppearanceSettingsViewProps {
  theme: LimeThemeMode;
  themeOptions: readonly ThemeOption[];
  handleThemeChange: (theme: LimeThemeMode) => void;
}

export function AppearanceSettingsView({
  theme,
  themeOptions,
  handleThemeChange,
}: AppearanceSettingsViewProps) {
  const { t } = useTranslation("settings");
  const pointerCursors = usePointerCursorsEnabled();
  const contentFontSize = useContentFontSize();
  const uiFontSize = useUiFontSize();
  const uiFontFamily = useUiFontFamily();
  const contentFontFamily = useContentFontFamily();
  const accentColor = useAccentColor();
  const chromeTheme = useChromeTheme();
  const codeTheme = useCodeTheme();
  const effectiveVariant = useEffectiveThemeVariant(theme);
  const smartPunctuation = useSmartPunctuationEnabled();
  const separateModes = useSeparateModePreferences();
  const reducedMotion = useReducedMotionPreference();
  const fontSmoothing = useFontSmoothingEnabled();
  const codeFontFamily = useCodeFontFamily();
  const codeFontSize = useCodeFontSize();
  const showFontSmoothing = isMacOSPlatform();

  return (
    <SettingsPageBody>
      <SettingsPageHeader
        title={t("settings.appearance.hero.title")}
        actions={
          <SettingsAction
            type="button"
            data-testid="appearance-reset-defaults"
            onClick={resetAppearancePreferences}
          >
            {t("settings.appearance.resetToDefault")}
          </SettingsAction>
        }
      />
      <SettingsSection title={t("settings.desktop.visualStyle")}>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.desktop.mode")}
            targetId="appearance-theme"
          >
            <ModeChoices
              role="radiogroup"
              aria-label={t("settings.appearance.theme.title")}
            >
              {themeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.id}
                  aria-label={option.label}
                  title={option.label}
                  tabIndex={theme === option.id ? 0 : -1}
                  onKeyDown={(event) => {
                    if (event.altKey || event.ctrlKey || event.metaKey) return;
                    const index = themeOptions.indexOf(option);
                    const nextIndex =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? themeOptions.length - 1
                          : event.key === "ArrowRight" ||
                              event.key === "ArrowDown"
                            ? (index + 1) % themeOptions.length
                            : event.key === "ArrowLeft" ||
                                event.key === "ArrowUp"
                              ? (index + themeOptions.length - 1) %
                                themeOptions.length
                              : null;
                    if (nextIndex === null) return;
                    event.preventDefault();
                    handleThemeChange(themeOptions[nextIndex].id);
                    const radios =
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        '[role="radio"]',
                      );
                    radios?.item(nextIndex).focus();
                  }}
                  onClick={() => handleThemeChange(option.id)}
                >
                  <span
                    className="mode-preview"
                    data-mode={option.id}
                    aria-hidden="true"
                  >
                    <span className="preview-sidebar" />
                    <span className="preview-content">
                      <span className="preview-line" />
                      <span className="preview-message" />
                      <span className="preview-line" />
                    </span>
                  </span>
                </button>
              ))}
            </ModeChoices>
          </SettingsRow>
        </SettingsGroup>
        <SettingsGroup>
          <SettingsRow
            label={t("settings.appearance.smartPunctuation")}
            description={t("settings.appearance.smartPunctuationDescription")}
            targetId="appearance-smart-punctuation"
          >
            <SettingsSwitch
              aria-labelledby="appearance-smart-punctuation-label"
              aria-describedby="appearance-smart-punctuation-description"
              checked={smartPunctuation}
              onCheckedChange={setSmartPunctuationEnabled}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.appearance.separateModes")}
            description={t("settings.appearance.separateModesDescription")}
            targetId="appearance-separate-modes"
          >
            <SettingsSwitch
              checked={separateModes.enabled}
              onCheckedChange={setSeparateModesEnabled}
            />
          </SettingsRow>
          {separateModes.enabled ? (
            <>
              <ChromeThemeRow
                label={t("settings.appearance.lightChromeTheme")}
                targetId="appearance-light-chrome-theme"
                variant="light"
                value={separateModes.light.chromeTheme}
                onChange={(chromeTheme) =>
                  setSeparateModePreferences({ light: { chromeTheme } })
                }
              />
              <CodeThemeRow
                label={t("settings.appearance.lightCodeTheme")}
                targetId="appearance-light-code-theme"
                variant="light"
                value={separateModes.light.codeTheme}
                onChange={(codeTheme) =>
                  setSeparateModePreferences({ light: { codeTheme } })
                }
              />
              <AccentRow
                label={t("settings.appearance.lightAccent")}
                targetId="appearance-light-accent"
                value={separateModes.light.accent}
                onChange={(accent) =>
                  setSeparateModePreferences({ light: { accent } })
                }
              />
              <UiFontFamilyRow
                label={t("settings.appearance.lightUiFont")}
                targetId="appearance-light-ui-font"
                value={separateModes.light.uiFontFamily}
                onChange={(uiFontFamily) =>
                  setSeparateModePreferences({
                    light: { uiFontFamily },
                  })
                }
              />
              <ContentFontFamilyRow
                label={t("settings.appearance.lightContentFont")}
                targetId="appearance-light-content-font"
                value={separateModes.light.contentFontFamily}
                onChange={(contentFontFamily) =>
                  setSeparateModePreferences({
                    light: { contentFontFamily },
                  })
                }
              />
              <CodeFontFamilyRow
                label={t("settings.appearance.lightCodeFont")}
                targetId="appearance-light-code-font"
                value={separateModes.light.codeFontFamily}
                onChange={(codeFontFamily) =>
                  setSeparateModePreferences({
                    light: { codeFontFamily },
                  })
                }
              />
              <ChromeThemeRow
                label={t("settings.appearance.darkChromeTheme")}
                targetId="appearance-dark-chrome-theme"
                variant="dark"
                value={separateModes.dark.chromeTheme}
                onChange={(chromeTheme) =>
                  setSeparateModePreferences({ dark: { chromeTheme } })
                }
              />
              <CodeThemeRow
                label={t("settings.appearance.darkCodeTheme")}
                targetId="appearance-dark-code-theme"
                variant="dark"
                value={separateModes.dark.codeTheme}
                onChange={(codeTheme) =>
                  setSeparateModePreferences({ dark: { codeTheme } })
                }
              />
              <AccentRow
                label={t("settings.appearance.darkAccent")}
                targetId="appearance-dark-accent"
                value={separateModes.dark.accent}
                onChange={(accent) =>
                  setSeparateModePreferences({ dark: { accent } })
                }
              />
              <UiFontFamilyRow
                label={t("settings.appearance.darkUiFont")}
                targetId="appearance-dark-ui-font"
                value={separateModes.dark.uiFontFamily}
                onChange={(uiFontFamily) =>
                  setSeparateModePreferences({
                    dark: { uiFontFamily },
                  })
                }
              />
              <ContentFontFamilyRow
                label={t("settings.appearance.darkContentFont")}
                targetId="appearance-dark-content-font"
                value={separateModes.dark.contentFontFamily}
                onChange={(contentFontFamily) =>
                  setSeparateModePreferences({
                    dark: { contentFontFamily },
                  })
                }
              />
              <CodeFontFamilyRow
                label={t("settings.appearance.darkCodeFont")}
                targetId="appearance-dark-code-font"
                value={separateModes.dark.codeFontFamily}
                onChange={(codeFontFamily) =>
                  setSeparateModePreferences({
                    dark: { codeFontFamily },
                  })
                }
              />
            </>
          ) : (
            <>
              <ChromeThemeRow
                label={t("settings.appearance.chromeTheme")}
                description={t("settings.appearance.chromeThemeDescription")}
                targetId="appearance-chrome-theme"
                variant={effectiveVariant}
                value={chromeTheme}
                onChange={setChromeTheme}
                requireBothVariants
              />
              <CodeThemeRow
                label={t("settings.appearance.codeTheme")}
                description={t("settings.appearance.codeThemeDescription")}
                targetId="appearance-code-theme"
                variant={effectiveVariant}
                value={codeTheme}
                onChange={setCodeTheme}
                requireBothVariants
              />
              <AccentRow
                label={t("settings.appearance.accentColor")}
                targetId="appearance-accent-color"
                value={accentColor}
                onChange={setAccentColor}
              />
              <UiFontFamilyRow
                label={t("settings.appearance.uiFontFamily")}
                description={t("settings.appearance.uiFontFamilyDescription")}
                targetId="appearance-ui-font-family"
                value={uiFontFamily}
                onChange={setUiFontFamily}
              />
              <ContentFontFamilyRow
                label={t("settings.appearance.contentFontFamily")}
                description={t(
                  "settings.appearance.contentFontFamilyDescription",
                )}
                targetId="appearance-content-font-family"
                value={contentFontFamily}
                onChange={setContentFontFamily}
              />
              <CodeFontFamilyRow
                label={t("settings.appearance.codeFontFamily")}
                description={t("settings.appearance.codeFontFamilyDescription")}
                targetId="appearance-code-font-family"
                value={codeFontFamily}
                onChange={setCodeFontFamily}
              />
            </>
          )}
          <FontSizeRow
            label={t("settings.appearance.uiFontSize")}
            description={t("settings.appearance.uiFontSizeDescription")}
            targetId="appearance-ui-font-size"
            value={uiFontSize}
            min={UI_FONT_SIZES[0]}
            max={UI_FONT_SIZES[UI_FONT_SIZES.length - 1]}
            onChange={(value) => setUiFontSize(value as UiFontSize)}
          />
          <FontSizeRow
            label={t("settings.appearance.codeFontSize")}
            description={t("settings.appearance.codeFontSizeDescription")}
            targetId="appearance-code-font-size"
            value={codeFontSize}
            min={CODE_FONT_SIZE_MIN}
            max={CODE_FONT_SIZE_MAX}
            onChange={setCodeFontSize}
          />
          <FontSizeRow
            label={t("settings.appearance.contentFontSize")}
            description={t("settings.appearance.contentFontSizeDescription")}
            targetId="appearance-content-font-size"
            value={contentFontSize}
            min={CONTENT_FONT_SIZES[0]}
            max={CONTENT_FONT_SIZES[CONTENT_FONT_SIZES.length - 1]}
            onChange={(value) => setContentFontSize(value as ContentFontSize)}
          />
          <SettingsRow
            label={t("settings.appearance.usePointerCursors")}
            description={t("settings.appearance.usePointerCursorsDescription")}
            targetId="appearance-pointer-cursors"
          >
            <SettingsSwitch
              aria-labelledby="appearance-pointer-cursors-label"
              aria-describedby="appearance-pointer-cursors-description"
              checked={pointerCursors}
              onCheckedChange={setPointerCursorsEnabled}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.appearance.reducedMotion")}
            description={t("settings.appearance.reducedMotionDescription")}
            targetId="appearance-reduced-motion"
          >
            <SettingsSegmentedControl
              targetId="appearance-reduced-motion"
              described
              value={reducedMotion}
              disabled={false}
              options={[
                {
                  value: "system",
                  label: t("settings.appearance.reducedMotion.system"),
                },
                {
                  value: "on",
                  label: t("settings.appearance.reducedMotion.on"),
                },
                {
                  value: "off",
                  label: t("settings.appearance.reducedMotion.off"),
                },
              ]}
              onChange={(value) =>
                setReducedMotionPreference(value as ReducedMotionPreference)
              }
            />
          </SettingsRow>
          {showFontSmoothing ? (
            <SettingsRow
              label={t("settings.appearance.fontSmoothing")}
              description={t("settings.appearance.fontSmoothingDescription")}
              targetId="appearance-font-smoothing"
            >
              <SettingsSwitch
                aria-labelledby="appearance-font-smoothing-label"
                aria-describedby="appearance-font-smoothing-description"
                checked={fontSmoothing}
                onCheckedChange={setFontSmoothingEnabled}
              />
            </SettingsRow>
          ) : null}
        </SettingsGroup>
      </SettingsSection>
    </SettingsPageBody>
  );
}
