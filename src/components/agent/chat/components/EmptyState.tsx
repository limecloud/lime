import React, { useState, useEffect, useMemo } from "react";
import styled, { keyframes } from "styled-components";
import {
  Lightbulb,
  Video,
  FileText,
  PenTool,
  BrainCircuit,
  CalendarRange,
  Globe,
  ListChecks,
  Settings2,
  Workflow,
} from "lucide-react";
import { getConfig } from "@/lib/api/appConfig";
import type { CreationMode, EntryTaskSlotValues, EntryTaskType } from "./types";
import { CREATION_MODE_CONFIG } from "./constants";
import { Button } from "@/components/ui/button";
import { ProjectSelector } from "@/components/projects/ProjectSelector";
import { toast } from "sonner";
import {
  composeEntryPrompt,
  createDefaultEntrySlotValues,
  formatEntryTaskPreview,
  getEntryTaskTemplate,
  SOCIAL_MEDIA_ENTRY_TASKS,
  validateEntryTaskSlots,
} from "../utils/entryPromptComposer";
import {
  buildRecommendationPrompt,
  getContextualRecommendations,
  isTeamRuntimeRecommendation,
} from "../utils/contextualRecommendations";
import {
  listHomeRecommendedSolutions,
  recordHomeRecommendedSolutionUsage,
  type HomeRecommendedSolutionItem,
} from "../utils/homeRecommendedSolutions";
import { EmptyStateComposerPanel } from "./EmptyStateComposerPanel";
import { EmptyStateHero } from "./EmptyStateHero";
import { EmptyStateQuickActions } from "./EmptyStateQuickActions";
import {
  EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME,
  EMPTY_STATE_PAGE_CONTAINER_CLASSNAME,
  EMPTY_STATE_SECONDARY_ACTION_BUTTON_CLASSNAME,
  EMPTY_STATE_THEME_TABS_CONTAINER_CLASSNAME,
  getEmptyStateThemeTabClassName,
  getEmptyStateThemeTabIconClassName,
} from "./emptyStateSurfaceTokens";
import { useActiveSkill } from "./Inputbar/hooks/useActiveSkill";
import type { SkillSelectionSourceProps } from "./Inputbar/components/skillSelectionBindings";
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
} from "./Inputbar/components/skillSelectionDisplay";
import {
  getSiteSkillAutoLaunchExample,
  hasAutoLaunchableSiteSkill,
} from "../service-skills/siteSkillExamplePrompts";

// Import Assets
import capabilitySkillsPlaceholder from "@/assets/claw-home/capability-skills-placeholder.svg";
import capabilityAutomationsPlaceholder from "@/assets/claw-home/capability-automations-placeholder.svg";
import capabilityAgentTeamsPlaceholder from "@/assets/claw-home/capability-agent-teams-placeholder.svg";
import capabilityBrowserAssistPlaceholder from "@/assets/claw-home/capability-browser-assist-placeholder.svg";
import type { ModelSelectorProps } from "@/components/input-kit";

const SOCIAL_ARTICLE_SKILL_KEY = "social_post_with_cover";
const CONFIG_LOAD_IDLE_TIMEOUT_MS = 1_500;
const CONFIG_LOAD_FALLBACK_DELAY_MS = 180;

function scheduleDeferredConfigLoad(task: () => void): () => void {
  if (typeof window === "undefined") {
    task();
    return () => undefined;
  }

  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => task(), {
      timeout: CONFIG_LOAD_IDLE_TIMEOUT_MS,
    });
    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = window.setTimeout(task, CONFIG_LOAD_FALLBACK_DELAY_MS);
  return () => {
    window.clearTimeout(timeoutId);
  };
}

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
  /** 创作模式 */
  creationMode?: CreationMode;
  /** 创作模式变更回调 */
  onCreationModeChange?: (mode: CreationMode) => void;
  /** 当前激活的主题 */
  activeTheme?: string;
  /** 主题变更回调 */
  onThemeChange?: (theme: string) => void;
  /** 是否显示主题切换 Tabs */
  showThemeTabs?: boolean;
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
  /** 是否跳过首页项目选择器的默认项目目录检查 */
  skipProjectSelectorWorkspaceReadyCheck?: boolean;
  /** 是否延后首页项目列表加载到展开时 */
  deferProjectSelectorListLoad?: boolean;
  /** 模型选择器后台预加载策略 */
  modelSelectorBackgroundPreload?: ModelSelectorProps["backgroundPreload"];
  /** 配置读取策略 */
  configLoadStrategy?: "immediate" | "idle";
  /** 覆盖默认支持面板 */
  supportingSlotOverride?: React.ReactNode;
}

const ENTRY_THEME_ID = "social-media";

// Scenarios Configuration - 与 ProjectType 统一
const ALL_CATEGORIES = [
  {
    id: "general",
    label: "通用对话",
    icon: <Globe className="w-4 h-4" />,
  },
  {
    id: "social-media",
    label: "社媒内容",
    icon: <PenTool className="w-4 h-4" />,
  },
  {
    id: "knowledge",
    label: "知识探索",
    icon: <BrainCircuit className="w-4 h-4" />,
  },
  {
    id: "planning",
    label: "计划规划",
    icon: <CalendarRange className="w-4 h-4" />,
  },
  { id: "document", label: "办公文档", icon: <FileText className="w-4 h-4" /> },
  { id: "video", label: "短视频", icon: <Video className="w-4 h-4" /> },
];

// 需要显示创作模式选择器的主题
const CREATION_THEMES = ["social-media", "document", "video"];

// 主题对应的图标
const THEME_ICONS: Record<string, string> = {
  "social-media": "✨",
  knowledge: "🔍",
  planning: "📅",
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
    title: "开始一个新任务",
    description:
      "把目标、上下文和限制告诉我，我会围绕当前任务持续推进，而不是只回答一次。",
    supportingDescription:
      "你可以直接输入需求，也可以先挂载技能、开启联网搜索或浏览器工作台，再开始执行。",
  },
  "social-media": {
    title: "社媒内容工作台",
    description:
      "把选题、平台适配、正文生成和后续改写放在同一条会话里，减少来回切页和重复输入。",
  },
  video: {
    title: "短视频脚本工作台",
    description:
      "围绕一个视频目标持续生成钩子、分镜、口播和封面文案，让脚本迭代留在上下文里。",
  },
  document: {
    title: "办公文档工作台",
    description:
      "把会议纪要、汇报提纲、邮件草稿与正式文稿组织在一起，便于后续继续补充和润色。",
  },
  knowledge: {
    title: "知识探索工作台",
    description:
      "把搜索、阅读、提炼、总结和观点整理放在一个持续上下文中，降低研究过程中的信息丢失。",
  },
  planning: {
    title: "规划拆解工作台",
    description:
      "围绕目标持续拆分计划、整理约束和产出行动清单，让方案迭代更像项目推进而不是单轮问答。",
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
  showThemeTabs = false,
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
  skipProjectSelectorWorkspaceReadyCheck = false,
  deferProjectSelectorListLoad = false,
  modelSelectorBackgroundPreload = "immediate",
  configLoadStrategy = "immediate",
  supportingSlotOverride,
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
  const [homeRecommendedSolutionsVersion, setHomeRecommendedSolutionsVersion] =
    useState(0);

  // 加载配置
  useEffect(() => {
    const loadConfigPreferences = async () => {
      try {
        const loadedConfig = await getConfig();
        setAppendSelectedTextToRecommendation(
          loadedConfig.chat_appearance
            ?.append_selected_text_to_recommendation ?? true,
        );
      } catch (e) {
        console.error("加载首页配置失败:", e);
      }
    };
    let cancelPendingLoad: () => void = () => undefined;

    if (configLoadStrategy === "idle") {
      cancelPendingLoad = scheduleDeferredConfigLoad(() => {
        void loadConfigPreferences();
      });
    } else {
      void loadConfigPreferences();
    }

    // 监听配置变更事件
    const handleConfigChange = () => {
      if (configLoadStrategy === "idle") {
        cancelPendingLoad();
        cancelPendingLoad = scheduleDeferredConfigLoad(() => {
          void loadConfigPreferences();
        });
        return;
      }

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
      cancelPendingLoad();
    };
  }, [configLoadStrategy]);

  // 过滤后的主题列表
  const categories = ALL_CATEGORIES;

  // 使用外部传入的 activeTheme，如果有 onThemeChange 则使用受控模式
  const handleThemeChange = (theme: string) => {
    if (onThemeChange) {
      onThemeChange(theme);
    }
  };

  // 判断当前主题是否需要显示创作模式选择器
  const showCreationModeSelector = CREATION_THEMES.includes(activeTheme);

  // Local state for parameters (Mocking visual state)
  const [platform, setPlatform] = useState("xiaohongshu");
  const [depth, setDepth] = useState("deep");
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const [entryTaskType, setEntryTaskType] = useState<EntryTaskType>("direct");
  const [entrySlotValues, setEntrySlotValues] = useState<EntryTaskSlotValues>(
    () => createDefaultEntrySlotValues("direct"),
  );
  const isGeneralTheme = isGeneralResearchTheme(activeTheme);

  const wrapTextWithDefaultSkill = (text: string) => {
    const wrappedByActiveSkill = wrapTextWithSkill(text);
    if (wrappedByActiveSkill !== text) {
      return wrappedByActiveSkill;
    }
    if (activeTheme === "social-media" && !text.trimStart().startsWith("/")) {
      return `/${SOCIAL_ARTICLE_SKILL_KEY} ${text}`.trim();
    }
    return text;
  };

  const isEntryTheme = activeTheme === ENTRY_THEME_ID;

  useEffect(() => {
    if (!isEntryTheme) {
      return;
    }

    if (!SOCIAL_MEDIA_ENTRY_TASKS.includes(entryTaskType)) {
      setEntryTaskType("direct");
      setEntrySlotValues(createDefaultEntrySlotValues("direct"));
    }
  }, [isEntryTheme, entryTaskType]);

  useEffect(() => {
    setEntrySlotValues(createDefaultEntrySlotValues(entryTaskType));
  }, [entryTaskType]);

  const entryTemplate = useMemo(
    () => getEntryTaskTemplate(entryTaskType),
    [entryTaskType],
  );

  const entryPreview = useMemo(
    () => formatEntryTaskPreview(entryTaskType, entrySlotValues),
    [entryTaskType, entrySlotValues],
  );

  const recommendationSelectedText = appendSelectedTextToRecommendation
    ? selectedText
    : "";

  const currentRecommendations = useMemo(() => {
    return getContextualRecommendations({
      activeTheme,
      input,
      creationMode,
      entryTaskType,
      platform,
      hasCanvasContent,
      hasContentId,
      selectedText: recommendationSelectedText,
      subagentEnabled,
    });
  }, [
    activeTheme,
    input,
    creationMode,
    entryTaskType,
    platform,
    hasCanvasContent,
    hasContentId,
    recommendationSelectedText,
    subagentEnabled,
  ]);

  const homeRecommendedSolutions = useMemo(
    () => {
      void homeRecommendedSolutionsVersion;
      return listHomeRecommendedSolutions();
    },
    [homeRecommendedSolutionsVersion],
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

  const handleEntrySlotChange = (key: string, value: string) => {
    setEntrySlotValues((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

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
    if (!input.trim() && !isEntryTheme && pendingImages.length === 0) return;
    const imagesToSend = pendingImages.length > 0 ? pendingImages : undefined;

    if (isEntryTheme) {
      const validation = validateEntryTaskSlots(entryTaskType, entrySlotValues);
      if (!validation.valid) {
        const missingFields = validation.missing
          .map((slot) => slot.label)
          .join("、");
        toast.error(`请先填写：${missingFields}`);
        return;
      }

      const composedPrompt = composeEntryPrompt({
        taskType: entryTaskType,
        slotValues: entrySlotValues,
        userInput: input,
        activeTheme,
        creationMode,
        context: {
          platform: getPlatformLabel(platform),
        },
      });

      onSend(
        wrapTextWithDefaultSkill(composedPrompt),
        executionStrategy,
        imagesToSend,
      );
      setPendingImages([]);
      clearSelectedSkill?.();
      return;
    }

    let prefix = "";
    if (activeTheme === "social-media") prefix = `[社媒创作: ${platform}] `;
    if (activeTheme === "video") prefix = `[视频脚本] `;
    if (activeTheme === "document") prefix = `[办公文档] `;
    if (activeTheme === "knowledge")
      prefix = `[知识探索: ${depth === "deep" ? "深度" : "快速"}] `;
    if (activeTheme === "planning") prefix = `[计划规划] `;

    onSend(
      wrapTextWithDefaultSkill(prefix + input),
      executionStrategy,
      imagesToSend,
    );
    setPendingImages([]);
    clearSelectedSkill?.();
  };

  const planEnabled = executionStrategy === "code_orchestrated";
  const executionModeLabel = planEnabled ? "Plan 已开启" : "直接执行";

  const activeCategory =
    ALL_CATEGORIES.find((category) => category.id === activeTheme) ||
    ALL_CATEGORIES[0];
  const workbenchCopy =
    THEME_WORKBENCH_COPY[activeTheme] || THEME_WORKBENCH_COPY.general;

  // Dynamic Placeholder
  const getPlaceholder = () => {
    switch (activeTheme) {
      case "knowledge":
        return "想了解什么？我可以帮你深度搜索、解析概念或总结长文...";
      case "planning":
        return "告诉我你的目标，无论是旅行计划、职业规划还是活动筹备...";
      case "social-media":
        return "输入主题，帮你创作小红书爆款文案、公众号文章...";
      case "video":
        return "输入视频主题，生成分镜脚本和口播文案...";
      case "document":
        return "输入需求，生成周报、汇报PPT大纲或商务邮件...";
      case "general":
        return hasAutoLaunchSiteSkill
          ? `直接说一句话，例如：${siteSkillAutoLaunchExample}`
          : "有什么我可以帮你的？";
      default:
        return "输入你的想法...";
    }
  };

  // Helper to get platform label
  const getPlatformLabel = (val: string) => {
    if (val === "xiaohongshu") return "小红书";
    if (val === "wechat") return "公众号";
    if (val === "zhihu") return "知乎";
    if (val === "toutiao") return "今日头条";
    if (val === "juejin") return "掘金";
    if (val === "csdn") return "CSDN";
    return val;
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

  const handleApplyHomeRecommendedSolution = (
    solution: HomeRecommendedSolutionItem,
  ) => {
    recordHomeRecommendedSolutionUsage(solution.id);
    setHomeRecommendedSolutionsVersion((previous) => previous + 1);

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

  const themeTabs = showThemeTabs ? (
    <div className={EMPTY_STATE_THEME_TABS_CONTAINER_CLASSNAME}>
      {categories.map((cat) => (
        <button
          key={cat.id}
          type="button"
          className={getEmptyStateThemeTabClassName(activeTheme === cat.id)}
          aria-pressed={activeTheme === cat.id}
          onClick={() => handleThemeChange(cat.id)}
        >
          <span
            className={getEmptyStateThemeTabIconClassName(
              activeTheme === cat.id,
            )}
          >
            {cat.icon}
          </span>
          {cat.label}
        </button>
      ))}
    </div>
  ) : null;

  const workspaceBadges = useMemo(() => {
    const badges: Array<{
      key: string;
      label: string;
      tone?: "slate" | "sky" | "emerald" | "amber";
    }> = [
      {
        key: "theme",
        label: activeCategory.label,
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

    if (activeTheme === "social-media") {
      badges.push({
        key: "platform",
        label: getPlatformLabel(platform),
        tone: "amber",
      });
    }

    if (activeTheme === "knowledge") {
      badges.push({
        key: "depth",
        label: depth === "deep" ? "深度解析" : "快速概览",
        tone: "amber",
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
    activeCategory.label,
    activeTheme,
    creationMode,
    depth,
    executionModeLabel,
    platform,
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
    } else if (activeTheme === "social-media") {
      features.push({
        key: "platform-fit",
        title: "平台语境适配",
        description: `当前按 ${getPlatformLabel(platform)} 组织任务，更适合做平台口吻和结构优化。`,
      });
    } else if (activeTheme === "knowledge") {
      features.push({
        key: "research",
        title: "研究深度可调",
        description: `当前为${depth === "deep" ? "深度解析" : "快速概览"}模式，可按任务成本调节研究粒度。`,
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
    activeTheme,
    depth,
    hasCanvasContent,
    hasContentId,
    isGeneralTheme,
    onLaunchBrowserAssist,
    platform,
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
      workspaceId={projectId}
      executionStrategy={executionStrategy}
      setExecutionStrategy={setExecutionStrategy}
      accessMode={accessMode}
      setAccessMode={setAccessMode}
      onManageProviders={onManageProviders}
      modelSelectorBackgroundPreload={modelSelectorBackgroundPreload}
      isGeneralTheme={isGeneralTheme}
      isEntryTheme={isEntryTheme}
      entryTaskType={entryTaskType}
      entryTaskTypes={SOCIAL_MEDIA_ENTRY_TASKS}
      getEntryTaskTemplate={getEntryTaskTemplate}
      entryTemplate={entryTemplate}
      entryPreview={entryPreview}
      entrySlotValues={entrySlotValues}
      onEntryTaskTypeChange={setEntryTaskType}
      onEntrySlotChange={handleEntrySlotChange}
      characters={characters}
      skillSelection={skillSelection}
      showCreationModeSelector={showCreationModeSelector}
      creationMode={creationMode}
      onCreationModeChange={onCreationModeChange}
      platform={platform}
      setPlatform={setPlatform}
      depth={depth}
      setDepth={setDepth}
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
      items={homeRecommendedSolutions.map((solution) => ({
        key: solution.id,
        title: solution.title,
        description: solution.summary,
        badge: solution.badge,
        prompt: solution.prompt,
        actionLabel: solution.actionLabel,
        outputHint: solution.outputHint,
        statusLabel: solution.statusLabel,
        statusTone: solution.statusTone,
        testId: `home-recommended-${solution.id}`,
      }))}
      embedded
      onAction={(item) => {
        const solution = homeRecommendedSolutions.find(
          (candidate) => candidate.id === item.key,
        );
        if (solution) {
          handleApplyHomeRecommendedSolution(solution);
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
          skipDefaultWorkspaceReadyCheck={
            skipProjectSelectorWorkspaceReadyCheck
          }
          deferProjectListLoad={deferProjectSelectorListLoad}
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
          eyebrow={activeTheme === "general" ? "新建任务" : "主题工作台"}
          title={workbenchCopy.title}
          description={workbenchCopy.description}
          supportingDescription={workbenchCopy.supportingDescription}
          badges={workspaceBadges}
          cards={workspaceCards}
          features={workspaceFeatures}
          prioritySlot={composerPanel}
          supportingSlot={
            supportingSlotOverride ??
            (isGeneralTheme
              ? generalRecommendedSolutionsPanel
              : defaultQuickActionsPanel)
          }
          themeTabs={themeTabs}
          headerControls={headerControls}
        />
      </ContentWrapper>
    </PageContainer>
  );
};
