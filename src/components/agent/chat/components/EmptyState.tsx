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
  EMPTY_STATE_SECONDARY_ACTION_BUTTON_CLASSNAME,
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
import capabilitySkillsPlaceholder from "@/assets/entry-surface/capability-skills-placeholder.svg?url";
import capabilityAutomationsPlaceholder from "@/assets/entry-surface/capability-automations-placeholder.svg?url";
import capabilityAgentTeamsPlaceholder from "@/assets/entry-surface/capability-agent-teams-placeholder.svg?url";
import capabilityBrowserAssistPlaceholder from "@/assets/entry-surface/capability-browser-assist-placeholder.svg?url";

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
  animation: ${contentReveal} 560ms cubic-bezier(0.22, 1, 0.36, 1) both;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
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
    title: "青柠一下，灵感即来",
    description:
      "从一句想法，到成稿、成图、成片、成事。",
    supportingDescription:
      "Claw 工作台会围绕一个目标持续对话、检索网页、补充素材，并把结果沉淀到右侧画布，而不是只停留在一次性提问。",
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
  const executionModeLabel = planEnabled ? "Plan 已开启" : "直接执行";

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
      tone?: "slate" | "sky" | "emerald" | "amber";
    }> = [
      {
        key: "theme",
        label: GENERAL_CATEGORY_LABEL,
        tone: "slate",
      },
      {
        key: "execution",
        label: executionModeLabel,
        tone: "sky",
      },
    ];

    if (showCreationModeSelector) {
      badges.push({
        key: "creation-mode",
        label: CREATION_MODE_CONFIG[creationMode].name,
        tone: "emerald",
      });
    }

    if (webSearchEnabled) {
      badges.push({
        key: "web-search",
        label: "联网搜索已开启",
        tone: "sky",
      });
    }

    if (activeSkillDisplayLabel) {
      badges.push({
        key: "skill",
        label: activeSkillDisplayLabel,
        tone: "emerald",
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
      tone?: "slate" | "sky" | "emerald" | "amber";
      action?: React.ReactNode;
    }> = [
      {
        key: "skills",
        eyebrow: "能力层",
        title: "技能",
        value: skillSummaryLabel,
        description:
          "把技能当作任务能力层来用，可把固定工作流、提示链和工具调用打包进一次对话。",
        icon: <Lightbulb className="h-5 w-5" />,
        imageSrc: capabilitySkillsPlaceholder,
        imageAlt: "技能能力卡占位图",
        tone: "emerald",
      },
      {
        key: "automation",
        eyebrow: "能力层",
        title: "自动化",
        value: planEnabled ? "Plan 编排已开启" : "按当前对话直接执行",
        description:
          "支持把复杂任务按步骤推进，适合长链路处理、批量执行和需要持续产出的工作流。",
        icon: <ListChecks className="h-5 w-5" />,
        imageSrc: capabilityAutomationsPlaceholder,
        imageAlt: "自动化能力卡占位图",
        tone: "sky",
      },
      {
        key: "agent-teams",
        eyebrow: "能力层",
        title: "多代理",
        value: subagentEnabled ? "协作模式已开启" : "支持分工协作",
        description:
          "需要并行研究、拆解方案或多角色协同时，可让任务由多个代理分工处理并回收结论。",
        icon: <Workflow className="h-5 w-5" />,
        imageSrc: capabilityAgentTeamsPlaceholder,
        imageAlt: "多代理协作能力卡占位图",
        tone: "amber",
      },
    ];

    cards.push({
      key: "browser",
      eyebrow: "能力层",
      title: "浏览器工作台",
      value: browserAssistLoading
        ? "正在准备浏览器会话"
        : "网页登录 / 人工接管",
      description:
        "需要处理登录、验证码或复杂网页操作时，可切到浏览器工作台接管真实浏览器。",
      icon: <Globe className="h-5 w-5" />,
      imageSrc: capabilityBrowserAssistPlaceholder,
      imageAlt: "浏览器工作台能力卡占位图",
      tone: "slate",
      action: onLaunchBrowserAssist ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void onLaunchBrowserAssist()}
          disabled={browserAssistLoading}
          className={EMPTY_STATE_SECONDARY_ACTION_BUTTON_CLASSNAME}
        >
          <Globe className="mr-2 h-4 w-4" />
          {browserAssistLoading ? "启动中..." : "打开浏览器工作台"}
        </Button>
      ) : null,
    });

    return cards;
  }, [
    browserAssistLoading,
    planEnabled,
    onLaunchBrowserAssist,
    skillSummaryLabel,
    subagentEnabled,
  ]);

  const workspaceFeatures = useMemo(() => {
    const features = [
      {
        key: "context",
        title: "持续上下文",
        description:
          "一个任务可以连续推进，补充背景、改写结果和追问细节都留在同一会话里。",
      },
      {
        key: "canvas",
        title: "画布承接结果",
        description:
          hasCanvasContent || hasContentId
            ? "当前会话已经接入画布，生成内容可继续整理、扩写和汇总。"
            : "生成结果不会只停留在消息气泡里，而是继续进入工作台承接后续整理与交付。",
      },
    ];

    if (isGeneralTheme && onLaunchBrowserAssist) {
      features.push({
        key: "browser",
        title: "网页任务可接管",
        description:
          "遇到登录、验证码或复杂网页操作时，可切换到浏览器工作台继续完成任务。",
      });
    } else {
      features.push({
        key: "quick-start",
        title: "任务模板起步",
        description:
          "先点快速启动卡生成第一轮任务，再在输入框里继续细化，是更顺手的使用路径。",
      });
    }

    return features;
  }, [
    hasCanvasContent,
    hasContentId,
    isGeneralTheme,
    onLaunchBrowserAssist,
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
    <EmptyStateQuickActions
      title="推荐方案"
      description="先选一个方案，Claw 会自动进入对应工作模式并带好起始动作。"
      items={entryRecommendedSolutions.map((solution) => ({
        key: solution.id,
        title: solution.title,
        description: solution.summary,
        badge: solution.badge,
        prompt: solution.prompt,
        actionLabel: solution.actionLabel,
        outputHint: solution.outputHint,
        statusLabel: solution.statusLabel,
        statusTone: solution.statusTone,
        testId: `entry-recommended-${solution.id}`,
      }))}
      embedded
      onAction={(item) => {
        const solution = entryRecommendedSolutions.find(
          (candidate) => candidate.id === item.key,
        );
        if (solution) {
          handleApplyEntryRecommendedSolution(solution);
        }
      }}
    />
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
          eyebrow="新建任务"
          title={workbenchCopy.title}
          description={workbenchCopy.description}
          supportingDescription={workbenchCopy.supportingDescription}
          badges={workspaceBadges}
          cards={workspaceCards}
          features={workspaceFeatures}
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
