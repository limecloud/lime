import { useEffect } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import type { LimeThemeMode } from "@/lib/appearance/themeMode";
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsAction,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
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
  setUiFontFamily,
  useUiFontFamily,
  resolveUiFontFamily,
  type UiFontFamily,
} from "@/lib/appearance/uiFontFamily";
import {
  setContentFontFamily,
  useContentFontFamily,
  resolveContentFontFamily,
  type ContentFontFamily,
} from "@/lib/appearance/contentFontFamily";
import {
  ACCENT_COLORS,
  applyAccentColor,
  setAccentColor,
  useAccentColor,
  type AccentColor,
} from "@/lib/appearance/accent";
import {
  setSmartPunctuationEnabled,
  useSmartPunctuationEnabled,
} from "@/lib/appearance/smartPunctuation";
import {
  setSeparateAccentPreferences,
  useSeparateAccentPreferences,
} from "@/lib/appearance/separateAccent";
import { resetUiFontFamilyForTest } from "@/lib/appearance/uiFontFamily";
import { resetUiFontSizeForTest } from "@/lib/appearance/uiFontSize";
import { resetContentFontFamilyForTest } from "@/lib/appearance/contentFontFamily";
import { resetContentFontSizeForTest } from "@/lib/appearance/typography";
import { resetPointerCursorsForTest } from "@/lib/appearance/pointerCursor";
import { SettingsValueMenu } from "../../SettingsPrimitives";

export interface ThemeOption {
  id: LimeThemeMode;
  label: string;
}

interface AppearanceSettingsViewProps {
  theme: LimeThemeMode;
  themeOptions: readonly ThemeOption[];
  handleThemeChange: (theme: LimeThemeMode) => void;
}

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
  const smartPunctuation = useSmartPunctuationEnabled();
  const separateAccent = useSeparateAccentPreferences();
  useEffect(() => {
    if (!separateAccent.enabled) {
      applyAccentColor(accentColor);
      return () => applyAccentColor("default");
    }
    const applyForMode = () => {
      const dark =
        document.documentElement.dataset.limeThemeEffective === "dark";
      applyAccentColor(dark ? separateAccent.dark : separateAccent.light);
    };
    applyForMode();
    const observer = new MutationObserver(applyForMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-lime-theme-effective"],
    });
    return () => {
      observer.disconnect();
      applyAccentColor("default");
    };
  }, [accentColor, separateAccent]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--lime-content-font-family",
      resolveContentFontFamily(contentFontFamily),
    );
    return () => {
      document.documentElement.style.removeProperty("--lime-content-font-family");
    };
  }, [contentFontFamily]);
  useEffect(() => {
    document.body.style.fontFamily = resolveUiFontFamily(uiFontFamily);
    return () => {
      document.body.style.removeProperty("font-family");
    };
  }, [uiFontFamily]);
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiFontSize}px`;
    return () => {
      document.documentElement.style.removeProperty("font-size");
    };
  }, [uiFontSize]);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--lime-content-font-size",
      `${contentFontSize}px`,
    );
    return () => {
      document.documentElement.style.removeProperty("--lime-content-font-size");
    };
  }, [contentFontSize]);
  useEffect(() => {
    document.documentElement.dataset.pointerCursors = String(pointerCursors);
    return () => {
      delete document.documentElement.dataset.pointerCursors;
    };
  }, [pointerCursors]);
  return (
    <SettingsPageBody>
      <SettingsPageHeader title={t("settings.appearance.hero.title")} />
      <div className="flex justify-end">
        <SettingsAction
          type="button"
          data-testid="appearance-reset-defaults"
          onClick={() => {
            resetUiFontFamilyForTest();
            resetUiFontSizeForTest();
            resetContentFontFamilyForTest();
            resetContentFontSizeForTest();
            resetPointerCursorsForTest();
            setAccentColor("default");
            setSeparateAccentPreferences({ enabled: false });
          }}
        >
          {t("settings.appearance.resetToDefault")}
        </SettingsAction>
      </div>
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
              checked={separateAccent.enabled}
              onCheckedChange={(enabled) =>
                setSeparateAccentPreferences({ enabled })
              }
            />
          </SettingsRow>
          {separateAccent.enabled ? (
            <>
              <SettingsRow label={t("settings.appearance.lightAccent")}>
                <SettingsValueMenu
                  targetId="appearance-light-accent"
                  disabled={false}
                  value={separateAccent.light}
                  options={ACCENT_COLORS.map((color) => ({
                    value: color,
                    label: t(`settings.appearance.accent.${color}`),
                  }))}
                  onChange={(value) =>
                    setSeparateAccentPreferences({
                      light: value as AccentColor,
                    })
                  }
                />
              </SettingsRow>
              <SettingsRow label={t("settings.appearance.darkAccent")}>
                <SettingsValueMenu
                  targetId="appearance-dark-accent"
                  disabled={false}
                  value={separateAccent.dark}
                  options={ACCENT_COLORS.map((color) => ({
                    value: color,
                    label: t(`settings.appearance.accent.${color}`),
                  }))}
                  onChange={(value) =>
                    setSeparateAccentPreferences({
                      dark: value as AccentColor,
                    })
                  }
                />
              </SettingsRow>
            </>
          ) : null}
          <SettingsRow
            label={t("settings.appearance.accentColor")}
            description={t("settings.appearance.accentColorDescription")}
            targetId="appearance-accent-color"
          >
            <SettingsValueMenu
              targetId="appearance-accent-color"
              described
              value={accentColor}
              disabled={false}
              options={ACCENT_COLORS.map((color) => ({
                value: color,
                label: t(`settings.appearance.accent.${color}`),
              }))}
              onChange={(value) => setAccentColor(value as AccentColor)}
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.appearance.contentFontFamily")}
            description={t("settings.appearance.contentFontFamilyDescription")}
            targetId="appearance-content-font-family"
          >
            <SettingsValueMenu
              targetId="appearance-content-font-family"
              described
              value={contentFontFamily}
              disabled={false}
              options={(["system", "sans", "serif", "mono"] as const).map(
                (family) => ({
                  value: family,
                  label: t(`settings.appearance.fontFamily.${family}`),
                }),
              )}
              onChange={(value) =>
                setContentFontFamily(value as ContentFontFamily)
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.appearance.uiFontFamily")}
            description={t("settings.appearance.uiFontFamilyDescription")}
            targetId="appearance-ui-font-family"
          >
            <SettingsValueMenu
              targetId="appearance-ui-font-family"
              described
              value={uiFontFamily}
              disabled={false}
              options={(["system", "sans", "serif", "mono"] as const).map(
                (family) => ({
                  value: family,
                  label: t(`settings.appearance.fontFamily.${family}`),
                }),
              )}
              onChange={(value) =>
                setUiFontFamily(value as UiFontFamily)
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.appearance.uiFontSize")}
            description={t("settings.appearance.uiFontSizeDescription")}
            targetId="appearance-ui-font-size"
          >
            <SettingsValueMenu
              targetId="appearance-ui-font-size"
              described
              value={String(uiFontSize)}
              disabled={false}
              options={UI_FONT_SIZES.map((size) => ({
                value: String(size),
                label: t("settings.appearance.fontSizeValue", { size }),
              }))}
              onChange={(value) =>
                setUiFontSize(Number(value) as UiFontSize)
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.appearance.contentFontSize")}
            description={t("settings.appearance.contentFontSizeDescription")}
            targetId="appearance-content-font-size"
          >
            <SettingsValueMenu
              targetId="appearance-content-font-size"
              described
              value={String(contentFontSize)}
              disabled={false}
              options={CONTENT_FONT_SIZES.map((size) => ({
                value: String(size),
                label: t("settings.appearance.fontSizeValue", { size }),
              }))}
              onChange={(value) =>
                setContentFontSize(Number(value) as ContentFontSize)
              }
            />
          </SettingsRow>
          <SettingsRow
            label={t("settings.appearance.usePointerCursors")}
            description={t(
              "settings.appearance.usePointerCursorsDescription",
            )}
            targetId="appearance-pointer-cursors"
          >
            <SettingsSwitch
              aria-labelledby="appearance-pointer-cursors-label"
              aria-describedby="appearance-pointer-cursors-description"
              checked={pointerCursors}
              onCheckedChange={setPointerCursorsEnabled}
            />
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </SettingsPageBody>
  );
}
