import React, { useState, useEffect, useMemo } from "react";
import styled, { keyframes } from "styled-components";
import {
  Lightbulb,
  Globe,
  ListChecks,
  Settings2,
  Workflow,
} from "lucide-react";
import { getConfig } from "@/lib/api/appConfig";
import type { CreationMode } from "./types";
import { CREATION_MODE_CONFIG } from "./constants";
import { Button } from "@/components/ui/button";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { toast } from "sonner";
import {
  buildRecommendationPrompt,
  getContextualRecommendations,
  isTeamRuntimeRecommendation,
} from "../utils/contextualRecommendations";
import {
  listEntryRecommendedSolutions,
  recordEntryRecommendedSolutionUsage,
  type EntryRecommendedSolutionItem,
} from "../utils/entryRecommendedSolutions";
import { EmptyStateComposerPanel } from "./EmptyStateComposerPanel";
import { EmptyStateHero } from "./EmptyStateHero";
import { EmptyStateQuickActions } from "./EmptyStateQuickActions";
import {
  EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME,
  EMPTY_STATE_PAGE_CONTAINER_CLASSNAME,
} from "./emptyStateSurfaceTokens";
import { useActiveSkill } from "../skill-selection/useActiveSkill";
import type { SkillSelectionSourceProps } from "../skill-selection/skillSelectionBindings";
import type { Character } from "@/lib/api/memory";
import type { WorkspaceSettings } from "@/types/workspace";
import type { MessageImage } from "../types";
import type { TeamDefinition } from "../utils/teamDefinitions";
import { isGeneralResearchTheme } from "../utils/generalAgentPrompt";
import type { AgentAccessMode } from "../hooks/agentChatStorage";
import {
  getClipboardImageCandidates,
  readImageAttachment,
} from "../utils/imageAttachments";
import {
  getActiveSkillDisplayLabel,
  getSkillSelectionSummaryLabel,
} from "../skill-selection/skillSelectionDisplay";
import {
  getSiteSkillAutoLaunchExample,
  hasAutoLaunchableSiteSkill,
} from "../service-skills/siteSkillExamplePrompts";
import capabilitySkillsPlaceholder from "@/assets/entry-surface/capability-skills-lime.png";
import capabilityAutomationsPlaceholder from "@/assets/entry-surface/capability-automations-lime.png";
import capabilityAgentTeamsPlaceholder from "@/assets/entry-surface/capability-agent-teams-lime.png";
import capabilityBrowserAssistPlaceholder from "@/assets/entry-surface/capability-browser-assist-lime.png";

const contentReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(18px) scale(0.992);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const PageContainer = styled.div.attrs({
  className: EMPTY_STATE_PAGE_CONTAINER_CLASSNAME,
})`
  isolation: isolate;
`;

const ContentWrapper = styled.div.attrs({
  className: EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME,
})`
  display: flex;
  flex: 1 1 auto;
  min-height: 100%;
  animation: ${contentReveal} 560ms cubic-bezier(0.22, 1, 0.36, 1) both;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const RecommendationShelf = styled.div`
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  padding: 0 0.3rem 0.1rem;
`;

const RecommendationShelfHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
`;

const RecommendationShelfList = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const RecommendationShelfRow = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;

  & + & {
    margin-left: 0.55rem;
    padding-left: 0.55rem;
  }

  & + &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    width: 1px;
    height: 0.72rem;
    transform: translateY(-50%);
    background: rgba(203, 213, 225, 0.9);
  }
`;

const RecommendationShelfButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: none;
  background: transparent;
  padding: 0;
  text-align: left;
  color: rgb(100 116 139);
  transition: color 180ms ease;

  &:hover {
    color: rgb(15 23 42);
  }
`;

const RecommendationShelfTitle = styled.span`
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.55;
  color: currentColor;
`;

const RecommendationShelfMeta = styled.span`
  font-size: 9.5px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.01em;
  color: rgb(5 150 105 / 0.88);
`;

interface EmptyStateProps extends SkillSelectionSourceProps {
  input: string;
  setInput: (value: string) => void;
  onSend: (
    value: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
    images?: MessageImage[],
  ) => void;
  isLoading?: boolean;
  disabled?: boolean;
  /** 创作模式 */
  creationMode?: CreationMode;
  /** 创作模式变更回调 */
  onCreationModeChange?: (mode: CreationMode) => void;
  /** 当前激活的主题 */
  activeTheme?: string;
  /** 主题变更回调 */
  onThemeChange?: (theme: string) => void;
  /** 推荐标签点击回调 */
  onRecommendationClick?: (shortLabel: string, fullPrompt: string) => void;
  providerType: string;
  setProviderType: (type: string) => void;
  model: string;
  setModel: (model: string) => void;
  executionStrategy?: "react" | "code_orchestrated" | "auto";
  setExecutionStrategy?: (
    strategy: "react" | "code_orchestrated" | "auto",
  ) => void;
  accessMode?: AgentAccessMode;
  setAccessMode?: (mode: AgentAccessMode) => void;
  onManageProviders?: () => void;
  webSearchEnabled?: boolean;
  onWebSearchEnabledChange?: (enabled: boolean) => void;
  thinkingEnabled?: boolean;
  onThinkingEnabledChange?: (enabled: boolean) => void;
  subagentEnabled?: boolean;
  onSubagentEnabledChange?: (enabled: boolean) => void;
  selectedTeam?: TeamDefinition | null;
  onSelectTeam?: (team: TeamDefinition | null) => void;
  onEnableSuggestedTeam?: (suggestedPresetId?: string) => void;
  teamWorkspaceSettings?: WorkspaceSettings | null;
  onPersistCustomTeams?: (teams: TeamDefinition[]) => void | Promise<void>;
  hasCanvasContent?: boolean;
  hasContentId?: boolean;
  selectedText?: string;
  /** 角色列表（用于 @ 引用） */
  characters?: Character[];
  /** 启动浏览器协助 */
  onLaunchBrowserAssist?: () => void | Promise<void>;
  /** 浏览器协助启动中 */
  browserAssistLoading?: boolean;
  /** 当前项目 ID */
  projectId?: string | null;
  /** 项目切换 */
  onProjectChange?: (projectId: string) => void;
  /** 打开设置 */
  onOpenSettings?: () => void;
}

const GENERAL_CATEGORY_LABEL = "通用对话";

// 需要显示创作模式选择器的主题
const CREATION_THEMES: string[] = [];

const THEME_ICONS: Record<string, string> = {
  general: "✨",
};

const THEME_WORKBENCH_COPY: Record<
  string,
  {
    title: string;
    description: string;
    supportingDescription?: string;
  }
> = {
  general: {
    title: "",
    description: "说一句目标，剩下的交给 Lime。",
    supportingDescription:
      "文案、图片、视频、搜索、整理与网页执行可以围绕同一目标持续推进；成功做法会沉淀成技能，偏好、参考与成果会逐渐沉淀成个人资产。",
  },
};

function truncatePrompt(value: string, maxLength = 92) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trim()}…`;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  input,
  setInput,
  onSend,
  creationMode = "guided",
  onCreationModeChange,
  activeTheme = "general",
  onThemeChange,
  onRecommendationClick,
  providerType,
  setProviderType,
  model,
  setModel,
  executionStrategy = "react",
  setExecutionStrategy,
  accessMode,
  setAccessMode,
  onManageProviders,
  webSearchEnabled = false,
  onWebSearchEnabledChange,
  thinkingEnabled = false,
  onThinkingEnabledChange,
  subagentEnabled = false,
  onSubagentEnabledChange,
  selectedTeam = null,
  onSelectTeam,
  onEnableSuggestedTeam,
  teamWorkspaceSettings,
  onPersistCustomTeams,
  hasCanvasContent = false,
  hasContentId = false,
  selectedText = "",
  characters = [],
  skills,
  serviceSkills,
  isSkillsLoading,
  onSelectServiceSkill,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
  onLaunchBrowserAssist,
  browserAssistLoading = false,
  projectId = null,
  onProjectChange,
  onOpenSettings,
  isLoading = false,
  disabled = false,
}) => {
  const { wrapTextWithSkill, buildSkillSelection } = useActiveSkill();
  const skillSelection = buildSkillSelection({
    skills,
    serviceSkills,
    isSkillsLoading,
    onSelectServiceSkill,
    onNavigateToSettings,
    onImportSkill,
    onRefreshSkills,
  });
  const currentSkill = skillSelection.activeSkill;
  const clearSelectedSkill = skillSelection.onClearSkill;
  const skillOptionCount =
    skillSelection.skills.length + skillSelection.serviceSkills.length;
  const activeSkillDisplayLabel = getActiveSkillDisplayLabel(currentSkill);
  const skillSummaryLabel = getSkillSelectionSummaryLabel({
    activeSkill: currentSkill,
    skillCount: skillOptionCount,
  });
  const hasAutoLaunchSiteSkill = hasAutoLaunchableSiteSkill(serviceSkills);
  const siteSkillAutoLaunchExample =
    getSiteSkillAutoLaunchExample(serviceSkills);

  const [
    appendSelectedTextToRecommendation,
    setAppendSelectedTextToRecommendation,
  ] = useState(true);
  const [entryRecommendedSolutionsVersion, setEntryRecommendedSolutionsVersion] =
    useState(0);

  useEffect(() => {
    const loadConfigPreferences = async () => {
      try {
        const loadedConfig = await getConfig();
        setAppendSelectedTextToRecommendation(
          loadedConfig.chat_appearance
            ?.append_selected_text_to_recommendation ?? true,
        );
      } catch (e) {
        console.error("加载入口配置失败:", e);
      }
    };
    void loadConfigPreferences();

    const handleConfigChange = () => {
      void loadConfigPreferences();
    };
    window.addEventListener(
      "chat-appearance-config-changed",
      handleConfigChange,
    );

    return () => {
      window.removeEventListener(
        "chat-appearance-config-changed",
        handleConfigChange,
      );
    };
  }, []);

  // 使用外部传入的 activeTheme，如果有 onThemeChange 则使用受控模式
  const handleThemeChange = (theme: string) => {
    if (onThemeChange) {
      onThemeChange(theme === "general" ? theme : "general");
    }
  };

  // 判断当前主题是否需要显示创作模式选择器
  const showCreationModeSelector = CREATION_THEMES.includes(activeTheme);

  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const isGeneralTheme = isGeneralResearchTheme(activeTheme);
  const isComposerBusy = isLoading || disabled;

  const wrapTextWithDefaultSkill = (text: string) => {
    const wrappedByActiveSkill = wrapTextWithSkill(text);
    if (wrappedByActiveSkill !== text) {
      return wrappedByActiveSkill;
    }
    return text;
  };

  const recommendationSelectedText = appendSelectedTextToRecommendation
    ? selectedText
    : "";

  const currentRecommendations = useMemo(() => {
    return getContextualRecommendations({
      activeTheme,
      input,
      creationMode,
      hasCanvasContent,
      hasContentId,
      selectedText: recommendationSelectedText,
      subagentEnabled,
    });
  }, [
    activeTheme,
    input,
    creationMode,
    hasCanvasContent,
    hasContentId,
    recommendationSelectedText,
    subagentEnabled,
  ]);

  const entryRecommendedSolutions = useMemo(
    () => {
      void entryRecommendedSolutionsVersion;
      return listEntryRecommendedSolutions();
    },
    [entryRecommendedSolutionsVersion],
  );

  const selectedTextPreview = useMemo(() => {
    const normalized = (recommendationSelectedText || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!normalized) {
      return "";
    }

    return normalized.length > 56
      ? `${normalized.slice(0, 56).trim()}…`
      : normalized;
  }, [recommendationSelectedText]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach((file) => {
      void readImageAttachment(file)
        .then((image) => {
          setPendingImages((prev) => [...prev, image]);
        })
        .catch(() => {
          toast.error(`图片读取失败: ${file.name || "未命名图片"}`);
        });
    });

    e.target.value = "";
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = getClipboardImageCandidates(event.clipboardData);
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    imageFiles.forEach(({ file, mediaType }, index) => {
      void readImageAttachment(file, mediaType)
        .then((image) => {
          setPendingImages((prev) => [...prev, image]);
          if (index === 0) {
            toast.success("已粘贴图片");
          }
        })
        .catch(() => {
          toast.error(`图片读取失败: ${file.name || "未命名图片"}`);
        });
    });
  };

  const handleRemoveImage = (index: number) => {
    setPendingImages((prev) =>
      prev.filter((_, currentIndex) => currentIndex !== index),
    );
  };

  const handleSend = () => {
    if (isComposerBusy || (!input.trim() && pendingImages.length === 0)) {
      return;
    }
    const imagesToSend = pendingImages.length > 0 ? pendingImages : undefined;

    onSend(
      wrapTextWithDefaultSkill(input),
      executionStrategy,
      imagesToSend,
    );
    setPendingImages([]);
    clearSelectedSkill?.();
  };

  const planEnabled = executionStrategy === "code_orchestrated";
  const executionModeLabel = planEnabled ? "编排模式已开启" : "直接开工";

  const workbenchCopy =
    THEME_WORKBENCH_COPY[activeTheme] || THEME_WORKBENCH_COPY.general;

  // Dynamic Placeholder
  const getPlaceholder = () => {
    return hasAutoLaunchSiteSkill
      ? `直接说一句话，例如：${siteSkillAutoLaunchExample}`
      : "有什么我可以帮你的？";
  };

  const handleApplyRecommendation = (
    shortLabel: string,
    fullPrompt: string,
  ) => {
    const looksLikeTeamRuntimePrompt =
      activeTheme === "general" &&
      isTeamRuntimeRecommendation(shortLabel, fullPrompt);
    if (looksLikeTeamRuntimePrompt) {
      onSubagentEnabledChange?.(true);
    }

    const promptWithSelection = buildRecommendationPrompt(
      fullPrompt,
      selectedText,
      appendSelectedTextToRecommendation,
    );
    if (onRecommendationClick) {
      onRecommendationClick(shortLabel, promptWithSelection);
      return;
    }
    setInput(promptWithSelection);
  };

  const handleApplyEntryRecommendedSolution = (
    solution: EntryRecommendedSolutionItem,
  ) => {
    recordEntryRecommendedSolutionUsage(solution.id);
    setEntryRecommendedSolutionsVersion((previous) => previous + 1);

    if (solution.shouldEnableWebSearch && !webSearchEnabled) {
      onWebSearchEnabledChange?.(true);
    }

    if (solution.shouldEnableTeamMode && !subagentEnabled) {
      onSubagentEnabledChange?.(true);
    }

    if (solution.themeTarget) {
      handleThemeChange(solution.themeTarget);
    }

    if (solution.shouldLaunchBrowserAssist) {
      void onLaunchBrowserAssist?.();
    }

    const promptWithSelection = buildRecommendationPrompt(
      solution.prompt,
      selectedText,
      appendSelectedTextToRecommendation,
    );
    setInput(promptWithSelection);
  };

  const workspaceBadges = useMemo(() => {
    const badges: Array<{
      key: string;
      label: string;
      tone?: "slate" | "sky" | "emerald" | "amber" | "lime";
    }> = [
      {
        key: "theme",
        label: GENERAL_CATEGORY_LABEL,
        tone: "lime",
      },
      {
        key: "execution",
        label: executionModeLabel,
        tone: "lime",
      },
    ];

    if (showCreationModeSelector) {
      badges.push({
        key: "creation-mode",
        label: CREATION_MODE_CONFIG[creationMode].name,
        tone: "lime",
      });
    }

    if (webSearchEnabled) {
      badges.push({
        key: "web-search",
        label: "联网搜索已开启",
        tone: "lime",
      });
    }

    if (activeSkillDisplayLabel) {
      badges.push({
        key: "skill",
        label: activeSkillDisplayLabel,
        tone: "lime",
      });
    }

    return badges.slice(0, 5);
  }, [
    creationMode,
    executionModeLabel,
    showCreationModeSelector,
    webSearchEnabled,
    activeSkillDisplayLabel,
  ]);

  const workspaceCards = useMemo(() => {
    const cards: Array<{
      key: string;
      eyebrow: string;
      title: string;
      value: string;
      description: string;
      icon: React.ReactNode;
      imageSrc?: string;
      imageAlt?: string;
      tone?: "slate" | "sky" | "emerald" | "amber" | "lime";
      action?: React.ReactNode;
      onMediaAction?: () => void;
      mediaActionLabel?: string;
      mediaActionDisabled?: boolean;
    }> = [
      {
        key: "skills",
        eyebrow: "支撑能力",
        title: "技能",
        value: skillSummaryLabel,
        description:
          "把跑通过的提示、步骤和工具组合沉淀下来，下次遇到同类任务可以直接复用。",
        icon: <Lightbulb className="h-5 w-5" />,
        imageSrc: capabilitySkillsPlaceholder,
        imageAlt: "技能能力卡占位图",
        tone: "lime",
      },
      {
        key: "automation",
        eyebrow: "支撑能力",
        title: "自动化",
        value: planEnabled ? "当前会按步骤推进" : "重复流程可持续跑起来",
        description:
          "适合长链路处理、批量任务和持续产出，让重复动作不再每次都从头手动重做。",
        icon: <ListChecks className="h-5 w-5" />,
        imageSrc: capabilityAutomationsPlaceholder,
        imageAlt: "自动化能力卡占位图",
        tone: "lime",
      },
      {
        key: "agent-teams",
        eyebrow: "支撑能力",
        title: "多代理",
        value: subagentEnabled ? "当前任务支持并行协作" : "复杂任务可拆成并行分工",
        description:
          "当研究、方案和执行需要同时推进时，可把任务拆给多个代理并行处理，再统一回收结论。",
        icon: <Workflow className="h-5 w-5" />,
        imageSrc: capabilityAgentTeamsPlaceholder,
        imageAlt: "多代理协作能力卡占位图",
        tone: "lime",
      },
    ];

    cards.push({
      key: "browser",
      eyebrow: "支撑能力",
      title: "浏览器接入",
      value: browserAssistLoading
        ? "正在检查连接状态"
        : "CDP / 浏览器插件复用",
      description:
        "登录、验证和网页动作可直接复用 CDP 或浏览器插件连接，不必再切到单独工作台。",
      icon: <Globe className="h-5 w-5" />,
      imageSrc: capabilityBrowserAssistPlaceholder,
      imageAlt: "浏览器接入能力卡占位图",
      tone: "lime",
      onMediaAction: onLaunchBrowserAssist
        ? () => {
            void onLaunchBrowserAssist();
          }
        : undefined,
      mediaActionLabel: browserAssistLoading ? "浏览器连接准备中" : "连接浏览器",
      mediaActionDisabled: browserAssistLoading,
    });

    return cards;
  }, [
    browserAssistLoading,
    planEnabled,
    onLaunchBrowserAssist,
    skillSummaryLabel,
    subagentEnabled,
  ]);

  const quickActionItems = useMemo(
    () =>
      currentRecommendations.slice(0, 4).map(([shortLabel, fullPrompt]) => ({
        key: `${activeTheme}-${shortLabel}`,
        title: shortLabel,
        description: truncatePrompt(fullPrompt),
        badge: `${THEME_ICONS[activeTheme] || "✨"} 快速启动`,
        prompt: fullPrompt,
      })),
    [activeTheme, currentRecommendations],
  );

  const quickStartPresets = useMemo(() => {
    const presets = [
      {
        key: "generate-image",
        label: "生成配图",
        icon: "✨",
        prompt:
          "请帮我生成一张适合当前主题的高质量图片，并先帮我整理一版可直接用于生图模型的详细 Prompt。",
      },
      {
        key: "join-notebook",
        label: "整理为 Notebook",
        icon: "📒",
        prompt:
          "请把这个主题整理成 notebook 工作方式：背景、资料、思路、草稿、待办分栏组织。",
      },
      {
        key: "create-skill",
        label: "设计 Skill",
        icon: "🧩",
        prompt:
          "请帮我设计一个可复用的 Skill，先定义适用场景、输入输出、执行步骤和失败回退策略。",
      },
      {
        key: "create-slides",
        label: "生成演示稿",
        icon: "🖥️",
        prompt:
          "请基于当前主题生成一份演示文稿结构，包含封面、目录、核心论点、案例页和结论页。",
      },
      {
        key: "frontend-design",
        label: "前端界面方案",
        icon: "🌐",
        prompt:
          "请帮我设计一个前端界面方案，先给出信息架构、关键模块、视觉方向和组件层级。",
      },
      {
        key: "copymail-skill",
        label: "专业邮件草稿",
        icon: "✉️",
        prompt:
          "请帮我起草一封专业邮件，先确认收件对象、语气、目标和希望对方采取的下一步动作。",
      },
      {
        key: "research-skills",
        label: "进入研究模式",
        icon: "🔎",
        prompt:
          "请先进入研究模式，帮我围绕当前主题做信息收集、观点归纳、风险点识别和结论总结。",
      },
    ];

    return presets;
  }, []);

  const composerPanel = (
    <EmptyStateComposerPanel
      input={input}
      setInput={setInput}
      placeholder={getPlaceholder()}
      onSend={handleSend}
      activeTheme={activeTheme}
      providerType={providerType}
      setProviderType={setProviderType}
      model={model}
      setModel={setModel}
      executionStrategy={executionStrategy}
      setExecutionStrategy={setExecutionStrategy}
      accessMode={accessMode}
      setAccessMode={setAccessMode}
      onManageProviders={onManageProviders}
      isLoading={isComposerBusy}
      disabled={isComposerBusy}
      isGeneralTheme={isGeneralTheme}
      characters={characters}
      skillSelection={skillSelection}
      showCreationModeSelector={showCreationModeSelector}
      creationMode={creationMode}
      onCreationModeChange={onCreationModeChange}
      thinkingEnabled={thinkingEnabled}
      onThinkingEnabledChange={onThinkingEnabledChange}
      subagentEnabled={subagentEnabled}
      onSubagentEnabledChange={onSubagentEnabledChange}
      selectedTeam={selectedTeam}
      onSelectTeam={onSelectTeam}
      teamWorkspaceSettings={teamWorkspaceSettings}
      onPersistCustomTeams={onPersistCustomTeams}
      onEnableSuggestedTeam={onEnableSuggestedTeam}
      webSearchEnabled={webSearchEnabled}
      onWebSearchEnabledChange={onWebSearchEnabledChange}
      pendingImages={pendingImages}
      onFileSelect={handleFileSelect}
      onPaste={handlePaste}
      onRemoveImage={handleRemoveImage}
    />
  );

  const defaultQuickActionsPanel = (
    <EmptyStateQuickActions
      title="快速启动"
      description="先选一个任务模板，再在当前会话里继续补充和追问。"
      selectedTextPreview={selectedTextPreview}
      presets={quickStartPresets}
      items={quickActionItems}
      embedded
      onPresetAction={(item) =>
        handleApplyRecommendation(item.label, item.prompt)
      }
      onAction={(item) => handleApplyRecommendation(item.title, item.prompt)}
    />
  );

  const generalRecommendedSolutionsPanel = (
    <RecommendationShelf>
      <RecommendationShelfHeader>
        <div className="text-[11px] font-semibold tracking-[0.02em] text-slate-500">
          推荐方案
        </div>
        {selectedTextPreview ? (
          <span className="truncate text-[10px] text-slate-400">
            当前会带上选中内容
          </span>
        ) : null}
      </RecommendationShelfHeader>

      <RecommendationShelfList>
        {entryRecommendedSolutions.map((solution) => (
          <RecommendationShelfRow key={solution.id}>
            <RecommendationShelfButton
              type="button"
              data-testid={`entry-recommended-${solution.id}`}
              onClick={() => {
                handleApplyEntryRecommendedSolution(solution);
              }}
            >
              <RecommendationShelfTitle>{solution.title}</RecommendationShelfTitle>
              {solution.isRecent ? (
                <RecommendationShelfMeta>{solution.badge}</RecommendationShelfMeta>
              ) : null}
            </RecommendationShelfButton>
          </RecommendationShelfRow>
        ))}
      </RecommendationShelfList>
    </RecommendationShelf>
  );

  const headerControls = onProjectChange ? (
    <div className="flex w-full justify-start sm:w-auto sm:justify-end">
      <div className="inline-flex max-w-full items-center rounded-[24px] border border-slate-200/80 bg-white p-1 shadow-sm shadow-slate-950/5">
        <ProjectSelector
          value={projectId ?? null}
          onChange={onProjectChange}
          workspaceType={activeTheme}
          placeholder="选择项目"
          dropdownSide="bottom"
          dropdownAlign="end"
          enableManagement={activeTheme === "general"}
          density="compact"
          chrome="embedded"
          className="min-w-[180px] max-w-[260px]"
        />
        {onOpenSettings ? (
          <>
            <div
              className="mx-1 h-6 w-px shrink-0 bg-slate-200/80"
              aria-hidden="true"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-[18px] text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={onOpenSettings}
              aria-label="打开设置"
              title="打开设置"
            >
              <Settings2 size={18} />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  ) : null;

  return (
    <PageContainer>
      <ContentWrapper>
        <EmptyStateHero
          eyebrow="创作"
          title={workbenchCopy.title}
          slogan="青柠一下，灵感即来"
          description={workbenchCopy.description}
          supportingDescription={workbenchCopy.supportingDescription}
          badges={workspaceBadges}
          cards={workspaceCards}
          prioritySlot={composerPanel}
          supportingSlot={
            isGeneralTheme
              ? generalRecommendedSolutionsPanel
              : defaultQuickActionsPanel
          }
          headerControls={headerControls}
        />
      </ContentWrapper>
    </PageContainer>
  );
};
