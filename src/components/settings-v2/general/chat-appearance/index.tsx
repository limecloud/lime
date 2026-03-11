/**
 * @file index.tsx
 * @description 通用设置 - 聊天外观与模块定制
 */

import { useState, useEffect } from "react";
import styled from "styled-components";
import { Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { getConfig, saveConfig, type Config } from "@/lib/api/appConfig";
import { Switch } from "@/components/ui/switch";

const ALL_CONTENT_THEMES = [
  { id: "general", label: "通用" },
  { id: "social-media", label: "社媒内容" },
  { id: "poster", label: "图文海报" },
  { id: "music", label: "歌词曲谱" },
  { id: "video", label: "短视频" },
  { id: "novel", label: "小说" },
  { id: "knowledge", label: "知识探索" },
  { id: "planning", label: "计划规划" },
  { id: "document", label: "办公文档" },
] as const;

const DEFAULT_ENABLED_THEMES = [
  "general",
  "social-media",
  "poster",
  "music",
  "video",
  "novel",
];

const ALL_NAV_ITEMS = [
  { id: "home-general", label: "首页" },
  { id: "video", label: "视频" },
  { id: "image-gen", label: "插图" },
  { id: "batch", label: "批量任务" },
  { id: "terminal", label: "终端" },
  { id: "plugins", label: "插件中心" },
  { id: "tools", label: "工具箱" },
] as const;

const DEFAULT_ENABLED_NAV_ITEMS = ["home-general", "video", "image-gen"];

const ALL_NAV_ITEM_ID_SET = new Set<string>(
  ALL_NAV_ITEMS.map((item) => item.id),
);

const LEGACY_DEFAULT_NAV_ITEM_SETS: string[][] = [
  ["home-general", "video", "image-gen", "plugins"],
  ["home-general", "video", "image-gen", "terminal", "plugins"],
];

const normalizeEnabledNavItems = (items: string[]): string[] => {
  const unique = Array.from(new Set(items));
  return unique.filter((item) => ALL_NAV_ITEM_ID_SET.has(item));
};

const hasSameMembers = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
};

const isLegacyDefaultEnabledItems = (items: string[]): boolean => {
  return LEGACY_DEFAULT_NAV_ITEM_SETS.some((legacyItems) =>
    hasSameMembers(items, legacyItems),
  );
};

const resolveEnabledNavItems = (savedItems?: string[]): string[] => {
  if (!savedItems || savedItems.length === 0) {
    return [...DEFAULT_ENABLED_NAV_ITEMS];
  }
  const normalized = normalizeEnabledNavItems(savedItems);
  if (isLegacyDefaultEnabledItems(normalized)) {
    return [...DEFAULT_ENABLED_NAV_ITEMS];
  }
  return normalized;
};

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
  flex-direction: column;
  padding: 16px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  gap: 16px;
`;

const SettingHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
`;

const SettingIcon = styled.div`
  color: hsl(var(--muted-foreground));
  padding-top: 2px;
`;

const SettingInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const SettingLabel = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
`;

const SettingDescription = styled.div`
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
`;

const TagsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: 36px;
`;

const ToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-left: 36px;
  gap: 12px;
`;

const ToggleInfo = styled.div`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
`;

const TagButton = styled.button<{ $active: boolean }>`
  px: 12px;
  py: 6px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.2s;
  ${({ $active }) =>
    $active
      ? `
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    border: none;
  `
      : `
    background: hsl(var(--muted));
    color: hsl(var(--muted-foreground));
    border: 1px solid transparent;
    &:hover {
      background: hsl(var(--muted)/0.8);
    }
  `}
`;

export function ChatAppearanceSettings() {
  const [enabledThemes, setEnabledThemes] = useState<string[]>(
    DEFAULT_ENABLED_THEMES,
  );
  const [enabledNavItems, setEnabledNavItems] = useState<string[]>(
    DEFAULT_ENABLED_NAV_ITEMS,
  );
  const [
    appendSelectedTextToRecommendation,
    setAppendSelectedTextToRecommendation,
  ] = useState(true);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const c = await getConfig();
      setConfig(c);
      setEnabledThemes(
        c.content_creator?.enabled_themes || DEFAULT_ENABLED_THEMES,
      );
      setEnabledNavItems(resolveEnabledNavItems(c.navigation?.enabled_items));
      setAppendSelectedTextToRecommendation(
        c.chat_appearance?.append_selected_text_to_recommendation ?? true,
      );
    } catch (e) {
      console.error("加载配置失败:", e);
    }
  };

  const handleThemeToggle = async (themeId: string) => {
    if (!config) return;
    const newThemes = enabledThemes.includes(themeId)
      ? enabledThemes.filter((t) => t !== themeId)
      : [...enabledThemes, themeId];

    if (newThemes.length === 0) return;

    setEnabledThemes(newThemes);
    try {
      const newConfig = {
        ...config,
        content_creator: { enabled_themes: newThemes },
      };
      await saveConfig(newConfig);
      setConfig(newConfig);
      window.dispatchEvent(new CustomEvent("theme-config-changed"));
    } catch (err) {
      console.error("保存主题设置失败:", err);
      setEnabledThemes(enabledThemes);
    }
  };

  const handleNavItemToggle = async (itemId: string) => {
    if (!config) return;
    const newItems = enabledNavItems.includes(itemId)
      ? enabledNavItems.filter((i) => i !== itemId)
      : [...enabledNavItems, itemId];

    if (newItems.length === 0) return;

    setEnabledNavItems(newItems);
    try {
      const newConfig = {
        ...config,
        navigation: { enabled_items: newItems },
      };
      await saveConfig(newConfig);
      setConfig(newConfig);
      window.dispatchEvent(new CustomEvent("nav-config-changed"));
    } catch (err) {
      console.error("保存导航设置失败:", err);
      setEnabledNavItems(enabledNavItems);
    }
  };

  const handleRecommendationSelectionToggle = async (checked: boolean) => {
    if (!config) return;
    const previousValue = appendSelectedTextToRecommendation;
    setAppendSelectedTextToRecommendation(checked);

    try {
      const newConfig = {
        ...config,
        chat_appearance: {
          ...(config.chat_appearance || {}),
          append_selected_text_to_recommendation: checked,
        },
      };
      await saveConfig(newConfig);
      setConfig(newConfig);
      window.dispatchEvent(new CustomEvent("chat-appearance-config-changed"));
    } catch (err) {
      console.error("保存推荐上下文设置失败:", err);
      setAppendSelectedTextToRecommendation(previousValue);
    }
  };

  return (
    <Container>
      <Section>
        <SectionTitle>工作区定制</SectionTitle>

        <SettingItem>
          <SettingHeader>
            <SettingIcon>
              <Palette size={20} />
            </SettingIcon>
            <SettingInfo>
              <SettingLabel>创作模式卡片</SettingLabel>
              <SettingDescription>
                选择您希望在创建新项目时可以使用的快捷内容创作模板，它们会在新对话页面展现。
              </SettingDescription>
            </SettingInfo>
          </SettingHeader>

          <TagsContainer>
            {ALL_CONTENT_THEMES.map((t) => (
              <TagButton
                key={t.id}
                $active={enabledThemes.includes(t.id)}
                onClick={() => handleThemeToggle(t.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  enabledThemes.includes(t.id)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {t.label}
              </TagButton>
            ))}
          </TagsContainer>
        </SettingItem>

        <SettingItem>
          <SettingHeader>
            <SettingIcon>
              <Palette size={20} />
            </SettingIcon>
            <SettingInfo>
              <SettingLabel>左侧边栏导航</SettingLabel>
              <SettingDescription>
                定制主视图左侧边栏启用的常驻导航图标入口，最少须保留一个。
              </SettingDescription>
            </SettingInfo>
          </SettingHeader>

          <TagsContainer>
            {ALL_NAV_ITEMS.map((item) => (
              <TagButton
                key={item.id}
                $active={enabledNavItems.includes(item.id)}
                onClick={() => handleNavItemToggle(item.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  enabledNavItems.includes(item.id)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {item.label}
              </TagButton>
            ))}
          </TagsContainer>
        </SettingItem>

        <SettingItem>
          <SettingHeader>
            <SettingIcon>
              <Palette size={20} />
            </SettingIcon>
            <SettingInfo>
              <SettingLabel>推荐自动附带选中内容</SettingLabel>
              <SettingDescription>
                开启后，点击推荐提示词会自动追加当前编辑器选中文本作为上下文。
              </SettingDescription>
            </SettingInfo>
          </SettingHeader>

          <ToggleRow>
            <ToggleInfo>
              建议开启：更贴合当前段落；关闭可避免附加额外上下文。
            </ToggleInfo>
            <Switch
              checked={appendSelectedTextToRecommendation}
              onCheckedChange={handleRecommendationSelectionToggle}
            />
          </ToggleRow>
        </SettingItem>
      </Section>
    </Container>
  );
}

export default ChatAppearanceSettings;
