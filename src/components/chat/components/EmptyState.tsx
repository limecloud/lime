/**
 * @file 空状态组件
 * @description 无消息时显示的欢迎界面
 * @module components/chat/components/EmptyState
 * @requirements 4.1, 4.4
 */

import React, { memo, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  MessageSquare,
  Sparkles,
  Code,
  Languages,
  Lightbulb,
} from "lucide-react";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { getConfig } from "@/lib/api/appConfig";
import type { ThemeType } from "../types";
import {
  buildRecommendationPrompt,
  getContextualRecommendations,
} from "@/components/agent/chat/utils/contextualRecommendations";

const Container = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px;
  text-align: center;
`;

const IconWrapper = styled.div`
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  border-radius: 16px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
`;

const Title = styled.h2`
  font-size: 24px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 8px;
`;

const Subtitle = styled.p`
  font-size: 15px;
  color: hsl(var(--muted-foreground));
  margin-bottom: 32px;
  max-width: 400px;
`;

const SuggestionsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  max-width: 600px;
  width: 100%;
`;

const SuggestionCard = styled.button`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--card));
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: hsl(var(--primary));
    background: hsl(var(--primary) / 0.05);
  }
`;

const SuggestionIcon = styled.div`
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  flex-shrink: 0;
`;

const SuggestionContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const SuggestionTitle = styled.div`
  font-size: 14px;
  font-weight: 500;
  color: hsl(var(--foreground));
  margin-bottom: 4px;
`;

const SuggestionDesc = styled.div`
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ProjectSelectorWrapper = styled.div`
  margin-bottom: 24px;
  width: 100%;
  max-width: 280px;
`;

const SelectionHint = styled.div`
  width: 100%;
  max-width: 600px;
  margin-bottom: 12px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  background: hsl(var(--muted) / 0.35);
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  padding: 8px 10px;
  text-align: left;
`;

const CHAT_THEME_TO_RECOMMENDATION_THEME: Record<ThemeType, string> = {
  general: "general",
  knowledge: "knowledge",
  planning: "planning",
  "social-media": "social-media",
  poster: "poster",
  document: "document",
  paper: "knowledge",
  novel: "novel",
  script: "video",
  music: "music",
  video: "video",
};

const SUGGESTION_ICONS = [Code, Lightbulb, Languages, Sparkles];

interface EmptyStateProps {
  /** 点击建议时的回调 */
  onSuggestionClick?: (prompt: string) => void;
  /** 当前选中的项目 ID */
  selectedProjectId?: string | null;
  /** 项目选择变化回调 */
  onProjectChange?: (projectId: string) => void;
  /** 当前主题 */
  activeTheme?: ThemeType;
  /** 当前选中的文本（用于推荐上下文） */
  selectedText?: string;
}

/**
 * 空状态组件
 *
 * 显示欢迎信息、项目选择器和快捷建议
 */
export const EmptyState: React.FC<EmptyStateProps> = memo(
  ({
    onSuggestionClick,
    selectedProjectId,
    onProjectChange,
    activeTheme = "general",
    selectedText = "",
  }) => {
    const [localProjectId, setLocalProjectId] = useState<string | null>(
      selectedProjectId || null,
    );
    const [
      appendSelectedTextToRecommendation,
      setAppendSelectedTextToRecommendation,
    ] = useState(true);

    useEffect(() => {
      const loadConfigPreferences = async () => {
        try {
          const config = await getConfig();
          setAppendSelectedTextToRecommendation(
            config.chat_appearance?.append_selected_text_to_recommendation ??
              true,
          );
        } catch (error) {
          console.error("加载聊天外观配置失败:", error);
        }
      };

      loadConfigPreferences();
      window.addEventListener(
        "chat-appearance-config-changed",
        loadConfigPreferences,
      );

      return () => {
        window.removeEventListener(
          "chat-appearance-config-changed",
          loadConfigPreferences,
        );
      };
    }, []);

    const recommendationTheme = CHAT_THEME_TO_RECOMMENDATION_THEME[activeTheme];
    const recommendationSelectedText = appendSelectedTextToRecommendation
      ? selectedText
      : "";

    const suggestions = useMemo(() => {
      const recommendationTuples = getContextualRecommendations({
        activeTheme: recommendationTheme,
        input: "",
        creationMode: "guided",
        entryTaskType: "direct",
        platform: "xiaohongshu",
        hasCanvasContent: false,
        hasContentId: false,
        selectedText: recommendationSelectedText,
      });

      return recommendationTuples.slice(0, 4).map(([title, prompt], index) => ({
        icon: SUGGESTION_ICONS[index % SUGGESTION_ICONS.length],
        title,
        desc: prompt,
        prompt: buildRecommendationPrompt(
          prompt,
          selectedText,
          appendSelectedTextToRecommendation,
        ),
      }));
    }, [
      recommendationTheme,
      recommendationSelectedText,
      selectedText,
      appendSelectedTextToRecommendation,
    ]);

    const selectedTextPreview = useMemo(() => {
      const normalized = recommendationSelectedText.trim().replace(/\s+/g, " ");
      if (!normalized) {
        return "";
      }

      return normalized.length > 60
        ? `${normalized.slice(0, 60).trim()}…`
        : normalized;
    }, [recommendationSelectedText]);

    const handleProjectChange = (projectId: string) => {
      setLocalProjectId(projectId);
      onProjectChange?.(projectId);
    };

    return (
      <Container>
        <IconWrapper>
          <MessageSquare size={32} />
        </IconWrapper>

        <Title>有什么我可以帮你的？</Title>
        <Subtitle>
          我是你的 AI 助手，可以帮你解答问题、编写代码、翻译文本、头脑风暴等
        </Subtitle>

        <ProjectSelectorWrapper>
          <ProjectSelector
            value={localProjectId}
            onChange={handleProjectChange}
            placeholder="选择项目"
          />
        </ProjectSelectorWrapper>

        {selectedTextPreview && (
          <SelectionHint>
            已检测到选中内容，点击推荐会自动附带上下文：
            <span style={{ marginLeft: 4, color: "hsl(var(--foreground))" }}>
              “{selectedTextPreview}”
            </span>
          </SelectionHint>
        )}

        <SuggestionsGrid>
          {suggestions.map((item) => (
            <SuggestionCard
              key={item.title}
              onClick={() => onSuggestionClick?.(item.prompt)}
            >
              <SuggestionIcon>
                <item.icon size={18} />
              </SuggestionIcon>
              <SuggestionContent>
                <SuggestionTitle>{item.title}</SuggestionTitle>
                <SuggestionDesc>{item.desc}</SuggestionDesc>
              </SuggestionContent>
            </SuggestionCard>
          ))}
        </SuggestionsGrid>
      </Container>
    );
  },
);

EmptyState.displayName = "EmptyState";
