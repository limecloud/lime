import styled from "styled-components";
import { useTranslation } from "react-i18next";
import type { LimeThemeMode } from "@/lib/appearance/themeMode";
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
} from "../../SettingsPrimitives";

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
      </SettingsSection>
    </SettingsPageBody>
  );
}
