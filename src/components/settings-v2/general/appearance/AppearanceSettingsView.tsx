import styled from "styled-components";
import { Shuffle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  LimeColorSchemeId,
  LIME_COLOR_SCHEMES,
} from "@/lib/appearance/colorSchemes";
import type { LimeThemeMode } from "@/lib/appearance/themeMode";
import type { LucideIcon } from "lucide-react";
import {
  SettingsAction,
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "../../SettingsPrimitives";

export interface ThemeOption {
  id: LimeThemeMode;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface AppearanceSettingsViewProps {
  theme: LimeThemeMode;
  colorSchemeId: LimeColorSchemeId;
  themeOptions: readonly ThemeOption[];
  colorSchemeOptions: readonly (Omit<
    (typeof LIME_COLOR_SCHEMES)[number],
    "label" | "description"
  > & { label: string; description: string })[];
  handleThemeChange: (theme: LimeThemeMode) => void;
  handleColorSchemeChange: (id: LimeColorSchemeId) => void;
  handleRandomColorScheme: () => void;
}

const ModeChoices = styled.div`
  display: flex;
  gap: clamp(6px, 3cqw, 12px);
  button {
    width: clamp(48px, 20cqw, 80px);
    height: clamp(36px, 15cqw, 60px);
    padding: 4px;
    border: 1px solid var(--lime-surface-border, hsl(var(--border)));
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
    border: 1px solid rgb(0 0 0 / 10%);
    border-radius: 5px;
    background: #fff;
  }
  .mode-preview[data-mode="dark"] {
    background: #181818;
  }
  .mode-preview[data-mode="system"] {
    background: linear-gradient(90deg, #fff 50%, #181818 50%);
  }
  .preview-sidebar {
    width: 25%;
    background: rgb(120 120 120 / 14%);
    border-right: 1px solid rgb(120 120 120 / 18%);
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
    background: #aaa;
    opacity: 0.5;
  }
  .preview-message {
    height: 12px;
    width: 85%;
    border: 1px solid rgb(120 120 120 / 25%);
    border-radius: 4px;
  }
`;

export function AppearanceSettingsView({
  theme,
  colorSchemeId,
  themeOptions,
  colorSchemeOptions,
  handleThemeChange,
  handleColorSchemeChange,
  handleRandomColorScheme,
}: AppearanceSettingsViewProps) {
  const { t } = useTranslation("settings");
  return (
    <SettingsPageBody>
      <SettingsPageHeader title={t("settings.appearance.hero.title")} />
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
        <SettingsGroup className="mt-4">
          <SettingsRow
            label={t("settings.appearance.colorScheme.title")}
            targetId="appearance-skin"
          >
            <SettingsAction
              type="button"
              aria-label={t("settings.appearance.colorScheme.random.title")}
              title={t("settings.appearance.colorScheme.random.title")}
              onClick={handleRandomColorScheme}
            >
              <Shuffle />
            </SettingsAction>
            <SettingsSelect
              aria-label={t("settings.appearance.colorScheme.title")}
              value={colorSchemeId}
              onChange={(event) =>
                handleColorSchemeChange(event.target.value as LimeColorSchemeId)
              }
            >
              {colorSchemeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </SettingsSelect>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </SettingsPageBody>
  );
}
