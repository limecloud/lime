import React, { useState, useEffect, useMemo } from "react";
import styled, { keyframes, css } from "styled-components";
import {
  Lightbulb,
  ImageIcon,
  Video,
  FileText,
  PenTool,
  BrainCircuit,
  CalendarRange,
  Globe,
  Music,
  ListChecks,
  Workflow,
} from "lucide-react";
import { getConfig } from "@/lib/api/appConfig";
import type { CreationMode, EntryTaskSlotValues, EntryTaskType } from "./types";
import { CREATION_MODE_CONFIG } from "./constants";
import { Button } from "@/components/ui/button";
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
} from "../utils/contextualRecommendations";
import { EmptyStateComposerPanel } from "./EmptyStateComposerPanel";
import { EmptyStateHero } from "./EmptyStateHero";
import { EmptyStateQuickActions } from "./EmptyStateQuickActions";
import { useActiveSkill } from "./Inputbar/hooks/useActiveSkill";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { MessageImage } from "../types";
import { isGeneralResearchTheme } from "../utils/generalAgentPrompt";

// Import Assets
import capabilitySkillsPlaceholder from "@/assets/claw-home/capability-skills-placeholder.svg";
import capabilityAutomationsPlaceholder from "@/assets/claw-home/capability-automations-placeholder.svg";
import capabilityAgentTeamsPlaceholder from "@/assets/claw-home/capability-agent-teams-placeholder.svg";
import capabilityBrowserAssistPlaceholder from "@/assets/claw-home/capability-browser-assist-placeholder.svg";

const SOCIAL_ARTICLE_SKILL_KEY = "social_post_with_cover";

// --- Animations ---
const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

// --- Styled Components ---

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  flex: 1;
  padding: clamp(8px, 1.2vw, 14px) 14px 20px;
  background: linear-gradient(
    180deg,
    hsl(var(--background) / 0.72) 0%,
    hsl(var(--background) / 0.92) 16%,
    hsl(var(--muted) / 0.24) 100%
  );
  overflow-y: auto;
  position: relative;

  &::before {
    content: "";
    position: absolute;
    top: -18%;
    left: 8%;
    width: 640px;
    height: 640px;
    background: radial-gradient(
      circle,
      hsl(var(--primary) / 0.055) 0%,
      transparent 70%
    );
    border-radius: 50%;
    pointer-events: none;
    z-index: 0;
  }

  &::after {
    content: "";
    position: absolute;
    right: -12%;
    top: 14%;
    width: 520px;
    height: 520px;
    background: radial-gradient(
      circle,
      hsl(199 89% 72% / 0.06) 0%,
      transparent 72%
    );
    border-radius: 50%;
    pointer-events: none;
    z-index: 0;
  }
`;

const ContentWrapper = styled.div`
  max-width: 1120px;
  width: 100%;
  margin: 0 auto;
  padding-top: 2px;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  animation: ${fadeIn} 0.5s ease-out;
`;

// --- Custom Tabs ---
const TabsContainer = styled.div`
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-start;
  gap: 6px;
  padding: 5px;
  background: linear-gradient(
    180deg,
    hsl(var(--background) / 0.8) 0%,
    hsl(var(--muted) / 0.24) 100%
  );
  backdrop-filter: blur(10px);
  border-radius: 18px;
  border: 1px solid hsl(var(--border) / 0.58);
  box-shadow: 0 8px 20px -18px rgba(0, 0, 0, 0.12);
  overflow-x: auto;
  overflow-y: hidden;
  width: min(100%, 780px);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 768px) {
    justify-content: center;
  }
`;

const TabItem = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 12px;
  border: 1px solid transparent;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
  white-space: nowrap;
  flex: 0 0 auto;

  ${(props) =>
    props.$active
      ? css`
          background-color: hsl(var(--background) / 0.94);
          border-color: hsl(var(--border) / 0.72);
          color: hsl(var(--foreground));
          box-shadow: 0 10px 20px -18px rgba(0, 0, 0, 0.2);
        `
      : css`
          color: hsl(var(--muted-foreground));
          &:hover {
            background-color: hsl(var(--background) / 0.72);
            border-color: hsl(var(--border) / 0.5);
            color: hsl(var(--foreground));
          }
        `}
`;

interface EmptyStateProps {
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
  onManageProviders?: () => void;
  webSearchEnabled?: boolean;
  onWebSearchEnabledChange?: (enabled: boolean) => void;
  thinkingEnabled?: boolean;
  onThinkingEnabledChange?: (enabled: boolean) => void;
  taskEnabled?: boolean;
  onTaskEnabledChange?: (enabled: boolean) => void;
  subagentEnabled?: boolean;
  onSubagentEnabledChange?: (enabled: boolean) => void;
  hasCanvasContent?: boolean;
  hasContentId?: boolean;
  selectedText?: string;
  /** 角色列表（用于 @ 引用） */
  characters?: Character[];
  /** 技能列表（用于 @ 引用） */
  skills?: Skill[];
  /** 技能列表加载状态 */
  isSkillsLoading?: boolean;
  /** 跳转到设置页安装技能 */
  onNavigateToSettings?: () => void;
  /** 导入本地技能 */
  onImportSkill?: () => void | Promise<void>;
  /** 刷新技能 */
  onRefreshSkills?: () => void | Promise<void>;
  /** 启动浏览器协助 */
  onLaunchBrowserAssist?: () => void | Promise<void>;
  /** 浏览器协助启动中 */
  browserAssistLoading?: boolean;
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
  { id: "poster", label: "图文海报", icon: <ImageIcon className="w-4 h-4" /> },
  { id: "music", label: "歌词曲谱", icon: <Music className="w-4 h-4" /> },
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
  { id: "novel", label: "小说创作", icon: <PenTool className="w-4 h-4" /> },
];

/** 默认启用的主题 */
const DEFAULT_ENABLED_THEMES = [
  "general",
  "social-media",
  "poster",
  "music",
  "video",
  "novel",
];

// 需要显示创作模式选择器的主题
const CREATION_THEMES = [
  "social-media",
  "poster",
  "document",
  "video",
  "music",
  "novel",
];

// 主题对应的图标
const THEME_ICONS: Record<string, string> = {
  "social-media": "✨",
  poster: "🎨",
  knowledge: "🔍",
  planning: "📅",
  music: "🎵",
  novel: "📖",
};

const THEME_WORKBENCH_COPY: Record<
  string,
  {
    title: string;
    description: string;
    outputLabel: string;
  }
> = {
  general: {
    title: "Claw 工作台",
    description:
      "围绕一个目标持续对话、检索网页、补充素材，并把结果沉淀到右侧画布，而不是只发一条一次性提问。",
    outputLabel: "方案 / 摘要 / TODO",
  },
  "social-media": {
    title: "社媒内容工作台",
    description:
      "把选题、平台适配、正文生成和后续改写放在同一条会话里，减少来回切页和重复输入。",
    outputLabel: "标题 / 结构 / 成稿",
  },
  poster: {
    title: "视觉海报工作台",
    description:
      "在同一个创作面板里统一管理构图要求、风格偏好和素材补充，适合持续迭代视觉方向。",
    outputLabel: "画面描述 / 风格指令",
  },
  video: {
    title: "短视频脚本工作台",
    description:
      "围绕一个视频目标持续生成钩子、分镜、口播和封面文案，让脚本迭代留在上下文里。",
    outputLabel: "钩子 / 分镜 / 口播",
  },
  music: {
    title: "音乐创作工作台",
    description:
      "将主题、情绪、旋律方向与歌词草案组织在同一个空间里，更适合反复推敲表达。",
    outputLabel: "歌词 / 情绪 / 节奏",
  },
  novel: {
    title: "小说创作工作台",
    description:
      "让世界观、人物设定、章节推进和重写请求持续留在一个会话内，适合长线创作。",
    outputLabel: "设定 / 章节 / 重写",
  },
  document: {
    title: "办公文档工作台",
    description:
      "把会议纪要、汇报提纲、邮件草稿与正式文稿组织在一起，便于后续继续补充和润色。",
    outputLabel: "纪要 / 提纲 / 邮件",
  },
  knowledge: {
    title: "知识探索工作台",
    description:
      "把搜索、阅读、提炼、总结和观点整理放在一个持续上下文中，降低研究过程中的信息丢失。",
    outputLabel: "检索 / 摘要 / 结论",
  },
  planning: {
    title: "规划拆解工作台",
    description:
      "围绕目标持续拆分计划、整理约束和产出行动清单，让方案迭代更像项目推进而不是单轮问答。",
    outputLabel: "路线 / 风险 / 清单",
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
  onManageProviders,
  webSearchEnabled = false,
  onWebSearchEnabledChange,
  thinkingEnabled = false,
  onThinkingEnabledChange,
  taskEnabled = false,
  onTaskEnabledChange,
  subagentEnabled = false,
  onSubagentEnabledChange,
  hasCanvasContent = false,
  hasContentId = false,
  selectedText = "",
  characters = [],
  skills = [],
  isSkillsLoading = false,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
  onLaunchBrowserAssist,
  browserAssistLoading = false,
}) => {
  const { activeSkill, setActiveSkill, clearActiveSkill, wrapTextWithSkill } =
    useActiveSkill();

  // 从配置中读取启用的主题
  const [enabledThemes, setEnabledThemes] = useState<string[]>(
    DEFAULT_ENABLED_THEMES,
  );
  const [
    appendSelectedTextToRecommendation,
    setAppendSelectedTextToRecommendation,
  ] = useState(true);

  // 加载配置
  useEffect(() => {
    const loadConfigPreferences = async () => {
      try {
        const loadedConfig = await getConfig();
        if (loadedConfig.content_creator?.enabled_themes) {
          setEnabledThemes(loadedConfig.content_creator.enabled_themes);
        }
        setAppendSelectedTextToRecommendation(
          loadedConfig.chat_appearance
            ?.append_selected_text_to_recommendation ?? true,
        );
      } catch (e) {
        console.error("加载主题配置失败:", e);
      }
    };
    loadConfigPreferences();

    // 监听配置变更事件
    const handleConfigChange = () => {
      loadConfigPreferences();
    };
    window.addEventListener("theme-config-changed", handleConfigChange);
    window.addEventListener(
      "chat-appearance-config-changed",
      handleConfigChange,
    );

    return () => {
      window.removeEventListener("theme-config-changed", handleConfigChange);
      window.removeEventListener(
        "chat-appearance-config-changed",
        handleConfigChange,
      );
    };
  }, []);

  // 过滤后的主题列表
  const categories = ALL_CATEGORIES.filter((cat) =>
    enabledThemes.includes(cat.id),
  );

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
  const [ratio, setRatio] = useState("3:4");
  const [style, setStyle] = useState("minimal");
  const [depth, setDepth] = useState("deep");
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const [entryTaskType, setEntryTaskType] = useState<EntryTaskType>("direct");
  const [entrySlotValues, setEntrySlotValues] = useState<EntryTaskSlotValues>(
    () => createDefaultEntrySlotValues("direct"),
  );
  // Popover 打开状态
  const [ratioPopoverOpen, setRatioPopoverOpen] = useState(false);
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false);
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
  ]);

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
      if (!file.type.startsWith("image/")) {
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        const base64Data = base64.split(",")[1];
        setPendingImages((prev) => [
          ...prev,
          {
            data: base64Data,
            mediaType: file.type,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });

    e.target.value = "";
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
          ratio,
          style,
          depth,
        },
      });

      onSend(
        wrapTextWithDefaultSkill(composedPrompt),
        executionStrategy,
        imagesToSend,
      );
      setPendingImages([]);
      clearActiveSkill();
      return;
    }

    let prefix = "";
    if (activeTheme === "social-media") prefix = `[社媒创作: ${platform}] `;
    if (activeTheme === "poster") prefix = `[图文生成: ${ratio}, ${style}] `;
    if (activeTheme === "video") prefix = `[视频脚本] `;
    if (activeTheme === "document") prefix = `[办公文档] `;
    if (activeTheme === "music") prefix = `[歌词曲谱] `;
    if (activeTheme === "novel") prefix = `[小说创作] `;
    if (activeTheme === "knowledge")
      prefix = `[知识探索: ${depth === "deep" ? "深度" : "快速"}] `;
    if (activeTheme === "planning") prefix = `[计划规划] `;

    onSend(
      wrapTextWithDefaultSkill(prefix + input),
      executionStrategy,
      imagesToSend,
    );
    setPendingImages([]);
    clearActiveSkill();
  };

  const executionStrategyLabel =
    executionStrategy === "auto"
      ? "Auto"
      : executionStrategy === "code_orchestrated"
        ? "Plan"
        : "ReAct";

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
      case "poster":
        return "描述画面主体、风格、构图，生成精美海报或插画...";
      case "video":
        return "输入视频主题，生成分镜脚本和口播文案...";
      case "document":
        return "输入需求，生成周报、汇报PPT大纲或商务邮件...";
      case "music":
        return "输入歌曲主题或情感，帮你创作歌词、设计旋律...";
      case "novel":
        return "输入小说主题或情节，帮你创作章节内容...";
      case "general":
        return "有什么我可以帮你的？";
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

  const themeTabs = showThemeTabs ? (
    <TabsContainer>
      {categories.map((cat) => (
        <TabItem
          key={cat.id}
          $active={activeTheme === cat.id}
          onClick={() => handleThemeChange(cat.id)}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
              activeTheme === cat.id
                ? "border-slate-200 bg-white text-slate-700"
                : "border-transparent bg-transparent text-slate-400"
            }`}
          >
            {cat.icon}
          </span>
          {cat.label}
        </TabItem>
      ))}
    </TabsContainer>
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
        label: `执行 ${executionStrategyLabel}`,
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

    if (activeSkill) {
      badges.push({
        key: "skill",
        label: `技能 ${activeSkill.name}`,
        tone: "emerald",
      });
    }

    return badges.slice(0, 5);
  }, [
    activeCategory.label,
    activeSkill,
    activeTheme,
    creationMode,
    depth,
    executionStrategyLabel,
    platform,
    showCreationModeSelector,
    webSearchEnabled,
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
        value: activeSkill
          ? `当前技能 ${activeSkill.name}`
          : skills.length > 0
            ? `${skills.length} 项技能可用`
            : "按需挂载能力",
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
        value: taskEnabled
          ? "后台任务已开启"
          : executionStrategy === "auto"
            ? "自动执行策略"
            : `${executionStrategyLabel} 执行`,
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
      title: "浏览器协助",
      value: browserAssistLoading
        ? "正在准备远程浏览器"
        : "网页操作 / 登录接管",
      description:
        "需要处理登录、验证码或网页操作时，可直接在右侧画布接管远程浏览器。",
      icon: <Globe className="h-5 w-5" />,
      imageSrc: capabilityBrowserAssistPlaceholder,
      imageAlt: "浏览器协助能力卡占位图",
      tone: "slate",
      action: onLaunchBrowserAssist ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => void onLaunchBrowserAssist()}
          disabled={browserAssistLoading}
          className="h-8 w-full rounded-full border-slate-200/80 bg-white/88 text-xs text-slate-700 shadow-none transition-colors hover:border-slate-300 hover:bg-white"
        >
          <Globe className="mr-2 h-4 w-4" />
          {browserAssistLoading ? "启动中..." : "打开浏览器协助"}
        </Button>
      ) : null,
    });

    return cards;
  }, [
    activeSkill,
    browserAssistLoading,
    executionStrategyLabel,
    executionStrategy,
    onLaunchBrowserAssist,
    skills.length,
    subagentEnabled,
    taskEnabled,
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
            : "生成结果不会只停留在消息气泡里，而是继续进入右侧画布承接后续工作。",
      },
    ];

    if (isGeneralTheme && onLaunchBrowserAssist) {
      features.push({
        key: "browser",
        title: "网页任务可接管",
        description:
          "遇到登录、验证码或复杂网页操作时，可切换到浏览器协助继续完成任务。",
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
    } else if (activeTheme === "poster") {
      features.push({
        key: "visual-params",
        title: "视觉参数集中管理",
        description:
          "尺寸、风格和素材补充都集中在同一输入区，减少视觉任务切换成本。",
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

  const quickStartPresets = useMemo(
    () => [
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
    ],
    [],
  );

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
      executionStrategyLabel={executionStrategyLabel}
      setExecutionStrategy={setExecutionStrategy}
      onManageProviders={onManageProviders}
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
      skills={skills}
      activeSkill={activeSkill}
      setActiveSkill={setActiveSkill}
      clearActiveSkill={clearActiveSkill}
      isSkillsLoading={isSkillsLoading}
      onNavigateToSettings={onNavigateToSettings}
      onImportSkill={onImportSkill}
      onRefreshSkills={onRefreshSkills}
      showCreationModeSelector={showCreationModeSelector}
      creationMode={creationMode}
      onCreationModeChange={onCreationModeChange}
      platform={platform}
      setPlatform={setPlatform}
      depth={depth}
      setDepth={setDepth}
      ratio={ratio}
      setRatio={setRatio}
      style={style}
      setStyle={setStyle}
      ratioPopoverOpen={ratioPopoverOpen}
      setRatioPopoverOpen={setRatioPopoverOpen}
      stylePopoverOpen={stylePopoverOpen}
      setStylePopoverOpen={setStylePopoverOpen}
      thinkingEnabled={thinkingEnabled}
      onThinkingEnabledChange={onThinkingEnabledChange}
      taskEnabled={taskEnabled}
      onTaskEnabledChange={onTaskEnabledChange}
      subagentEnabled={subagentEnabled}
      onSubagentEnabledChange={onSubagentEnabledChange}
      webSearchEnabled={webSearchEnabled}
      onWebSearchEnabledChange={onWebSearchEnabledChange}
      pendingImagesCount={pendingImages.length}
      onFileSelect={handleFileSelect}
    />
  );

  const quickActionsPanel = (
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

  return (
    <Container>
      <ContentWrapper>
        <EmptyStateHero
          eyebrow="CLAW WORKSPACE"
          title={workbenchCopy.title}
          description={workbenchCopy.description}
          badges={workspaceBadges}
          cards={workspaceCards}
          features={workspaceFeatures}
          prioritySlot={composerPanel}
          supportingSlot={quickActionsPanel}
          themeTabs={themeTabs}
        />
      </ContentWrapper>
    </Container>
  );
};
