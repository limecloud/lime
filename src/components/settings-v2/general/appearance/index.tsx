/**
 * @file index.tsx
 * @description 通用设置 - 外观与语言
 */

import { useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { Moon, Sun, Monitor, Volume2, RotateCcw } from "lucide-react";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import { useOnboardingState } from "@/components/onboarding";
import {
  LanguageSelector,
  Language,
} from "../../shared/language/LanguageSelector";
import { useI18nPatch } from "@/i18n/I18nPatchProvider";
import { useSoundContext } from "@/contexts/useSoundContext";

type Theme = "light" | "dark" | "system";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid hsl(var(--border));
`;

const SettingItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
`;

const SettingInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const SettingLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
`;

const SettingDescription = styled.div`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const ThemeButtonGroup = styled.div`
  display: flex;
  gap: 4px;
  background: hsl(var(--muted));
  padding: 4px;
  border-radius: 8px;
`;

const ThemeButton = styled.button<{ $active: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  background: ${({ $active }) =>
    $active ? "hsl(var(--background))" : "transparent"};
  color: ${({ $active }) =>
    $active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"};
  box-shadow: ${({ $active }) =>
    $active ? "0 1px 3px rgba(0,0,0,0.1)" : "none"};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    color: hsl(var(--foreground));
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

export function AppearanceSettings() {
  const [theme, setTheme] = useState<Theme>("system");
  const [language, setLanguageState] = useState<Language>("zh");
  const [config, setConfig] = useState<Config | null>(null);

  const { setLanguage: setI18nLanguage } = useI18nPatch();
  const { soundEnabled, setSoundEnabled, playToolcallSound } =
    useSoundContext();
  const { resetOnboarding } = useOnboardingState();

  useEffect(() => {
    const savedTheme = localStorage.getItem("theme") as Theme | null;
    if (savedTheme) {
      setTheme(savedTheme);
    }
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const c = await getConfig();
      setConfig(c);
      setLanguageState((c.language || "zh") as Language);
    } catch (e) {
      console.error("加载配置失败:", e);
    }
  };

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    const root = document.documentElement;
    if (newTheme === "system") {
      const systemDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      root.classList.toggle("dark", systemDark);
    } else {
      root.classList.toggle("dark", newTheme === "dark");
    }
  };

  const handleLanguageChange = async (newLanguage: Language) => {
    if (!config) return;
    try {
      const newConfig = { ...config, language: newLanguage };
      await saveConfig(newConfig);
      setConfig(newConfig);
      setLanguageState(newLanguage);
      setI18nLanguage(newLanguage);
    } catch (err) {
      console.error("保存语言设置失败:", err);
    }
  };

  const handleResetOnboarding = useCallback(() => {
    resetOnboarding();
    window.location.reload();
  }, [resetOnboarding]);

  const themeOptions = [
    { id: "light" as Theme, label: "浅色", icon: Sun },
    { id: "dark" as Theme, label: "深色", icon: Moon },
    { id: "system" as Theme, label: "系统", icon: Monitor },
  ];

  return (
    <Container>
      <Section>
        <SectionTitle>基础外观</SectionTitle>

        <SettingItem>
          <SettingInfo>
            <SettingLabel>主题模式</SettingLabel>
            <SettingDescription>选择应用的主题颜色体系</SettingDescription>
          </SettingInfo>
          <ThemeButtonGroup>
            {themeOptions.map((option) => (
              <ThemeButton
                key={option.id}
                $active={theme === option.id}
                onClick={() => handleThemeChange(option.id)}
              >
                <option.icon />
                {option.label}
              </ThemeButton>
            ))}
          </ThemeButtonGroup>
        </SettingItem>

        <SettingItem>
          <SettingInfo>
            <SettingLabel>语言</SettingLabel>
            <SettingDescription>选择应用的显示语言</SettingDescription>
          </SettingInfo>
          <LanguageSelector
            currentLanguage={language}
            onLanguageChange={handleLanguageChange}
          />
        </SettingItem>

        <SettingItem>
          <SettingInfo>
            <SettingLabel>
              <Volume2 className="h-4 w-4" />
              提示音效
            </SettingLabel>
            <SettingDescription>
              在工具调用和消息生成时播放提示音
            </SettingDescription>
          </SettingInfo>
          <input
            type="checkbox"
            checked={soundEnabled}
            onChange={(e) => {
              setSoundEnabled(e.target.checked);
              if (e.target.checked) {
                playToolcallSound();
              }
            }}
            className="w-4 h-4 rounded border-gray-300"
          />
        </SettingItem>
      </Section>

      <Section>
        <SectionTitle>初始化</SectionTitle>
        <SettingItem>
          <SettingInfo>
            <SettingLabel>重置向导设置</SettingLabel>
            <SettingDescription>
              遇到问题或想重新选择启动选项时，可重新运行初始化向导
            </SettingDescription>
          </SettingInfo>
          <button
            onClick={handleResetOnboarding}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-input bg-background hover:bg-accent hover:text-accent-foreground text-sm font-medium transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重新运行引导
          </button>
        </SettingItem>
      </Section>
    </Container>
  );
}

export default AppearanceSettings;
