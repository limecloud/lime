import React, { useState, useEffect, useMemo, useRef } from "react";
import styled, { keyframes, css } from "styled-components";
import {
  ArrowRight,
  Paperclip,
  Lightbulb,
  ImageIcon,
  Video,
  FileText,
  PenTool,
  BrainCircuit,
  CalendarRange,
  ChevronDown,
  Search,
  Globe,
  Music,
  Code2,
} from "lucide-react";
import { getConfig } from "@/lib/api/appConfig";
import type { CreationMode, EntryTaskSlotValues, EntryTaskType } from "./types";
import { CREATION_MODE_CONFIG } from "./constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
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
import { ChatModelSelector } from "./ChatModelSelector";
import { CharacterMention } from "./Inputbar/components/CharacterMention";
import { SkillBadge } from "./Inputbar/components/SkillBadge";
import { useActiveSkill } from "./Inputbar/hooks/useActiveSkill";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { MessageImage } from "../types";

// Import Assets
import iconXhs from "@/assets/platforms/xhs.png";
import iconGzh from "@/assets/platforms/gzh.png";
import iconZhihu from "@/assets/platforms/zhihu.png";
import iconToutiao from "@/assets/platforms/toutiao.png";
import iconJuejin from "@/assets/platforms/juejin.png";
import iconCsdn from "@/assets/platforms/csdn.png";

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
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 40px 20px;
  background-color: hsl(var(--background));
  overflow-y: auto;
  position: relative;

  // Subtle mesh background effect
  &::before {
    content: "";
    position: absolute;
    top: -10%;
    left: 20%;
    width: 600px;
    height: 600px;
    background: radial-gradient(
      circle,
      hsl(var(--primary) / 0.05) 0%,
      transparent 70%
    );
    border-radius: 50%;
    pointer-events: none;
    z-index: 0;
  }
`;

const ContentWrapper = styled.div`
  max-width: 900px;
  width: 100%;
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 36px;
  animation: ${fadeIn} 0.5s ease-out;
`;

const Header = styled.div`
  text-align: center;
  margin-bottom: 8px;
`;

const shimmer = keyframes`
  0% { background-position: 0% 50%; filter: brightness(100%); }
  50% { background-position: 100% 50%; filter: brightness(120%); }
  100% { background-position: 0% 50%; filter: brightness(100%); }
`;

const MainTitle = styled.h1`
  font-size: 42px;
  font-weight: 800;
  color: hsl(var(--foreground));
  margin-bottom: 16px;
  letter-spacing: -1px;
  line-height: 1.15;

  // Advanced Light & Shadow Gradient
  background: linear-gradient(
    135deg,
    hsl(var(--foreground)) 0%,
    #8b5cf6 25%,
    #ec4899 50%,
    #8b5cf6 75%,
    hsl(var(--foreground)) 100%
  );
  background-size: 300% auto;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;

  // Animation
  animation: ${shimmer} 5s ease-in-out infinite;

  // Optical Glow
  filter: drop-shadow(0 0 20px rgba(139, 92, 246, 0.3));

  span {
    display: block; // Force new line for the second part naturally if needed, or keep inline
    background: linear-gradient(to right, #6366f1, #a855f7, #ec4899);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`;

// --- Custom Tabs ---
const TabsContainer = styled.div`
  display: flex;
  gap: 8px;
  padding: 6px;
  background-color: hsl(var(--muted) / 0.4);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  border: 1px solid hsl(var(--border) / 0.5);
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.01),
    0 2px 4px -1px rgba(0, 0, 0, 0.01);
  overflow-x: auto;
  max-width: 100%;
  scrollbar-width: none; // hide scrollbar
`;

const TabItem = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.25s cubic-bezier(0.25, 1, 0.5, 1);
  white-space: nowrap;

  ${(props) =>
    props.$active
      ? css`
          background-color: hsl(var(--background));
          color: hsl(var(--foreground));
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
          transform: scale(1.02);
        `
      : css`
          color: hsl(var(--muted-foreground));
          &:hover {
            background-color: hsl(var(--muted) / 0.5);
            color: hsl(var(--foreground));
          }
        `}
`;

// --- Input Card ---
const InputCard = styled.div`
  width: 100%;
  position: relative;
  background-color: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.6);
  border-radius: 20px;
  box-shadow:
    0 20px 40px -5px rgba(0, 0, 0, 0.03),
    0 8px 16px -4px rgba(0, 0, 0, 0.03);
  overflow: visible; // Allow dropdowns to overflow
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  &:hover {
    box-shadow:
      0 25px 50px -12px rgba(0, 0, 0, 0.06),
      0 12px 24px -6px rgba(0, 0, 0, 0.04);
    border-color: hsl(var(--primary) / 0.3);
  }

  &:focus-within {
    border-color: hsl(var(--primary));
    box-shadow:
      0 0 0 4px hsl(var(--primary) / 0.1),
      0 25px 50px -12px rgba(0, 0, 0, 0.08);
  }
`;

const StyledTextarea = styled(Textarea)`
  min-height: 150px;
  padding: 24px 28px;
  border: none;
  font-size: 16px;
  line-height: 1.6;
  resize: none;
  background: transparent;
  color: hsl(var(--foreground));

  &::placeholder {
    color: hsl(var(--muted-foreground) / 0.7);
    font-weight: 300;
  }

  &:focus-visible {
    ring: 0;
    outline: none;
    box-shadow: none;
  }
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px 16px 20px;
  background: linear-gradient(to bottom, transparent, hsl(var(--muted) / 0.2));
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
`;

const ToolLoginLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

// --- Styles for Selectors ---
const ColorDot = styled.div<{ $color: string }>`
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background-color: ${(props) => props.$color};
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1) inset;
`;

const GridSelect = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 8px;
`;

const GridItem = styled.div<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid
    ${(props) => (props.$active ? "hsl(var(--primary))" : "transparent")};
  background-color: ${(props) =>
    props.$active ? "hsl(var(--primary)/0.08)" : "hsl(var(--muted)/0.3)"};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: hsl(var(--primary) / 0.05);
  }
`;

const EntryTaskContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 20px 4px 20px;
  border-bottom: 1px dashed hsl(var(--border) / 0.8);
`;

const EntryTaskTabs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const EntryTaskTab = styled.button<{ $active?: boolean }>`
  height: 32px;
  padding: 0 12px;
  border-radius: 9999px;
  font-size: 12px;
  border: 1px solid
    ${(props) =>
      props.$active ? "hsl(var(--primary))" : "hsl(var(--border) / 0.8)"};
  color: ${(props) =>
    props.$active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"};
  background: ${(props) =>
    props.$active ? "hsl(var(--primary) / 0.08)" : "hsl(var(--background))"};
  transition: all 0.2s ease;

  &:hover {
    border-color: hsl(var(--primary) / 0.6);
    color: hsl(var(--foreground));
  }
`;

const EntryTaskPreview = styled.div`
  font-size: 14px;
  line-height: 1.6;
  color: hsl(var(--foreground));
`;

const SlotToken = styled.span`
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.12);
  border-radius: 8px;
  padding: 2px 8px;
  font-size: 13px;
`;

const SlotGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
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
  hasCanvasContent?: boolean;
  hasContentId?: boolean;
  selectedText?: string;
  /** 角色列表（用于 @ 引用） */
  characters?: Character[];
  /** 技能列表（用于 @ 引用） */
  skills?: Skill[];
  /** 跳转到设置页安装技能 */
  onNavigateToSettings?: () => void;
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

const THEME_HEADLINES: Record<string, { lead: string; focus: string }> = {
  general: {
    lead: "你想在这个平台",
    focus: "完成什么？",
  },
  "social-media": {
    lead: "今天想做什么",
    focus: "社媒爆款内容？",
  },
  poster: {
    lead: "今天想生成什么",
    focus: "视觉海报作品？",
  },
  video: {
    lead: "今天要打磨哪条",
    focus: "短视频脚本？",
  },
  music: {
    lead: "今天想写一首什么样的",
    focus: "歌曲故事？",
  },
  novel: {
    lead: "今天想开启哪段",
    focus: "小说剧情？",
  },
  document: {
    lead: "今天要输出哪份",
    focus: "办公文档？",
  },
  knowledge: {
    lead: "今天想深入研究什么",
    focus: "知识主题？",
  },
  planning: {
    lead: "今天要规划什么",
    focus: "行动方案？",
  },
};

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
  hasCanvasContent = false,
  hasContentId = false,
  selectedText = "",
  characters = [],
  skills = [],
  onNavigateToSettings,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Popover 打开状态
  const [ratioPopoverOpen, setRatioPopoverOpen] = useState(false);
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const executionStrategyLabel =
    executionStrategy === "auto"
      ? "Auto"
      : executionStrategy === "code_orchestrated"
        ? "Plan"
        : "ReAct";

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

  // Helper to get platform icon
  const getPlatformIcon = (val: string) => {
    if (val === "xiaohongshu") return iconXhs;
    if (val === "wechat") return iconGzh;
    if (val === "zhihu") return iconZhihu;
    if (val === "toutiao") return iconToutiao;
    if (val === "juejin") return iconJuejin;
    if (val === "csdn") return iconCsdn;
    return undefined;
  };

  // Helper to get platform label
  const getPlatformLabel = (val: string) => {
    if (val === "xiaohongshu") return "小红书";
    if (val === "wechat") return "公众号";
    if (val === "zhihu") return "知乎";
    if (val === "toutiao") return "头条";
    if (val === "juejin") return "掘金";
    if (val === "csdn") return "CSDN";
    return val;
  };

  const themeHeadline = THEME_HEADLINES[activeTheme] || THEME_HEADLINES.general;

  return (
    <Container>
      <ContentWrapper>
        <Header>
          <MainTitle>
            {themeHeadline.lead}
            <span>{themeHeadline.focus}</span>
          </MainTitle>
        </Header>

        {showThemeTabs && (
          <TabsContainer>
            {categories.map((cat) => (
              <TabItem
                key={cat.id}
                $active={activeTheme === cat.id}
                onClick={() => handleThemeChange(cat.id)}
              >
                <span
                  className={
                    activeTheme === cat.id ? "text-primary" : "opacity-70"
                  }
                >
                  {cat.icon}
                </span>
                {cat.label}
              </TabItem>
            ))}
          </TabsContainer>
        )}

        {/* 输入卡片 */}
        <InputCard>
          {isEntryTheme && (
            <EntryTaskContainer>
              <EntryTaskTabs>
                {SOCIAL_MEDIA_ENTRY_TASKS.map((task) => {
                  const template = getEntryTaskTemplate(task);
                  return (
                    <EntryTaskTab
                      key={task}
                      $active={entryTaskType === task}
                      onClick={() => setEntryTaskType(task)}
                      title={template.description}
                    >
                      {template.label}
                    </EntryTaskTab>
                  );
                })}
              </EntryTaskTabs>

              <EntryTaskPreview>
                {entryPreview.split(/(\[[^\]]+\])/g).map((chunk, index) => {
                  const isToken = /^\[[^\]]+\]$/.test(chunk);
                  if (!chunk) return null;
                  if (!isToken) {
                    return (
                      <React.Fragment key={`${chunk}-${index}`}>
                        {chunk}
                      </React.Fragment>
                    );
                  }

                  return (
                    <SlotToken key={`${chunk}-${index}`}>{chunk}</SlotToken>
                  );
                })}
              </EntryTaskPreview>

              <SlotGrid>
                {entryTemplate.slots.map((slot) => (
                  <Input
                    key={slot.key}
                    value={entrySlotValues[slot.key] ?? ""}
                    onChange={(event) =>
                      handleEntrySlotChange(slot.key, event.target.value)
                    }
                    placeholder={slot.placeholder}
                    className="h-9 text-xs"
                  />
                ))}
              </SlotGrid>
            </EntryTaskContainer>
          )}

          {activeSkill && (
            <SkillBadge skill={activeSkill} onClear={clearActiveSkill} />
          )}
          <StyledTextarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
          />
          <CharacterMention
            characters={characters}
            skills={skills}
            inputRef={textareaRef}
            value={input}
            onChange={setInput}
            onSelectSkill={setActiveSkill}
            onNavigateToSettings={onNavigateToSettings}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
          {pendingImages.length > 0 && (
            <div className="px-6 pb-2 text-xs text-muted-foreground">
              已添加图片 {pendingImages.length} 张
            </div>
          )}

          <Toolbar>
            <ToolLoginLeft>
              <ChatModelSelector
                providerType={providerType}
                setProviderType={setProviderType}
                model={model}
                setModel={setModel}
                activeTheme={activeTheme}
                compactTrigger
                popoverSide="top"
                onManageProviders={onManageProviders}
              />

              {activeTheme === "social-media" && (
                <>
                  <Select
                    value={platform}
                    onValueChange={setPlatform}
                    closeOnMouseLeave
                  >
                    <SelectTrigger className="h-8 text-xs bg-background border shadow-sm min-w-[120px]">
                      <div className="flex items-center gap-2">
                        {getPlatformIcon(platform) && (
                          <img
                            src={getPlatformIcon(platform)}
                            className="w-4 h-4 rounded-full"
                          />
                        )}
                        <span>{getPlatformLabel(platform)}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent className="p-1" side="top">
                      <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
                        选择要创作的内容平台
                      </div>
                      <SelectItem value="xiaohongshu">
                        <div className="flex items-center gap-2">
                          <img src={iconXhs} className="w-4 h-4 rounded-full" />{" "}
                          小红书
                        </div>
                      </SelectItem>
                      <SelectItem value="wechat">
                        <div className="flex items-center gap-2">
                          <img src={iconGzh} className="w-4 h-4 rounded-full" />{" "}
                          公众号
                        </div>
                      </SelectItem>
                      <SelectItem value="toutiao">
                        <div className="flex items-center gap-2">
                          <img
                            src={iconToutiao}
                            className="w-4 h-4 rounded-full"
                          />{" "}
                          今日头条
                        </div>
                      </SelectItem>
                      <SelectItem value="zhihu">
                        <div className="flex items-center gap-2">
                          <img
                            src={iconZhihu}
                            className="w-4 h-4 rounded-full"
                          />{" "}
                          知乎
                        </div>
                      </SelectItem>
                      <SelectItem value="juejin">
                        <div className="flex items-center gap-2">
                          <img
                            src={iconJuejin}
                            className="w-4 h-4 rounded-full"
                          />{" "}
                          掘金
                        </div>
                      </SelectItem>
                      <SelectItem value="csdn">
                        <div className="flex items-center gap-2">
                          <img
                            src={iconCsdn}
                            className="w-4 h-4 rounded-full"
                          />{" "}
                          CSDN
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}

              {/* 创作模式选择器 - 针对内容创作类主题 */}
              {showCreationModeSelector && (
                <Select
                  value={creationMode}
                  onValueChange={(val) =>
                    onCreationModeChange?.(val as CreationMode)
                  }
                >
                  <SelectTrigger className="h-8 text-xs bg-background border shadow-sm min-w-[120px]">
                    <div className="flex items-center gap-2">
                      {CREATION_MODE_CONFIG[creationMode].icon}
                      <span>{CREATION_MODE_CONFIG[creationMode].name}</span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="p-1 min-w-[200px]" side="top">
                    <div className="px-2 py-1.5 text-xs text-muted-foreground font-medium">
                      选择创作模式
                    </div>
                    {(
                      Object.entries(CREATION_MODE_CONFIG) as [
                        CreationMode,
                        (typeof CREATION_MODE_CONFIG)[CreationMode],
                      ][]
                    ).map(([key, config]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-3">
                          <span className="flex-shrink-0">{config.icon}</span>
                          <span className="font-medium">{config.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {activeTheme === "knowledge" && (
                <>
                  <Badge
                    variant="secondary"
                    className="cursor-pointer hover:bg-muted font-normal h-8 px-3 gap-1"
                  >
                    <Search className="w-3.5 h-3.5 mr-1" />
                    联网搜索
                  </Badge>
                  <Select value={depth} onValueChange={setDepth}>
                    <SelectTrigger className="h-8 text-xs bg-background border-input shadow-sm w-[110px]">
                      <BrainCircuit className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                      <SelectValue placeholder="深度" />
                    </SelectTrigger>
                    <SelectContent side="top">
                      <SelectItem value="deep">深度解析</SelectItem>
                      <SelectItem value="quick">快速概览</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}

              {activeTheme === "planning" && (
                <Badge
                  variant="outline"
                  className="h-8 font-normal text-muted-foreground gap-1"
                >
                  <Globe className="w-3.5 h-3.5 mr-1" />
                  旅行/职业/活动
                </Badge>
              )}

              {activeTheme === "poster" && (
                <>
                  <Popover
                    open={ratioPopoverOpen}
                    onOpenChange={(open) => {
                      setRatioPopoverOpen(open);
                      if (open) setStylePopoverOpen(false);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-normal"
                      >
                        <div className="w-3.5 h-3.5 border border-current rounded-[2px] mr-2 flex items-center justify-center text-[6px]">
                          3:4
                        </div>
                        {ratio}
                        <ChevronDown className="w-3 h-3 ml-1 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-64 p-2 bg-background border shadow-lg"
                      align="start"
                      side="top"
                    >
                      <div className="text-xs font-medium mb-2 px-2 text-muted-foreground">
                        宽高比
                      </div>
                      <GridSelect>
                        {["1:1", "3:4", "4:3", "9:16", "16:9", "21:9"].map(
                          (r) => (
                            <GridItem
                              key={r}
                              $active={ratio === r}
                              onClick={() => {
                                setRatio(r);
                                setRatioPopoverOpen(false);
                              }}
                            >
                              <div className="w-5 h-5 border-2 border-current rounded-sm mb-1 opacity-50"></div>
                              <span className="text-xs">{r}</span>
                            </GridItem>
                          ),
                        )}
                      </GridSelect>
                    </PopoverContent>
                  </Popover>

                  <Popover
                    open={stylePopoverOpen}
                    onOpenChange={(open) => {
                      setStylePopoverOpen(open);
                      if (open) setRatioPopoverOpen(false);
                    }}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs font-normal"
                      >
                        <ColorDot $color="#3b82f6" className="mr-2" />
                        {style === "minimal"
                          ? "极简风格"
                          : style === "tech"
                            ? "科技质感"
                            : "温暖治愈"}
                        <ChevronDown className="w-3 h-3 ml-1 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-48 p-1 bg-background border shadow-lg"
                      align="start"
                      side="top"
                    >
                      <div className="p-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start h-8"
                          onClick={() => {
                            setStyle("minimal");
                            setStylePopoverOpen(false);
                          }}
                        >
                          <ColorDot $color="#e2e8f0" className="mr-2" />{" "}
                          极简风格
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start h-8"
                          onClick={() => {
                            setStyle("tech");
                            setStylePopoverOpen(false);
                          }}
                        >
                          <ColorDot $color="#3b82f6" className="mr-2" />{" "}
                          科技质感
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start h-8"
                          onClick={() => {
                            setStyle("warm");
                            setStylePopoverOpen(false);
                          }}
                        >
                          <ColorDot $color="#f59e0b" className="mr-2" />{" "}
                          温暖治愈
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </>
              )}

              {activeTheme === "general" && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 rounded-full ml-1 bg-background shadow-sm hover:bg-muted"
                    onClick={() => imageInputRef.current?.click()}
                    title="上传文件"
                  >
                    <Paperclip className="w-4 h-4 opacity-70" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className={`h-8 w-8 rounded-full ml-1 bg-background shadow-sm hover:bg-muted ${
                      thinkingEnabled
                        ? "border-yellow-500 text-yellow-600 bg-yellow-50 dark:bg-yellow-950/30"
                        : ""
                    }`}
                    onClick={() => onThinkingEnabledChange?.(!thinkingEnabled)}
                    aria-pressed={thinkingEnabled}
                    title={thinkingEnabled ? "关闭深度思考" : "开启深度思考"}
                  >
                    <Lightbulb className="w-4 h-4 opacity-70" />
                  </Button>
                </>
              )}

              <Button
                variant="outline"
                size="icon"
                className={`h-8 w-8 rounded-full ml-1 bg-background shadow-sm hover:bg-muted ${
                  webSearchEnabled
                    ? "border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950/30"
                    : ""
                }`}
                onClick={() => onWebSearchEnabledChange?.(!webSearchEnabled)}
                aria-pressed={webSearchEnabled}
                title={webSearchEnabled ? "关闭联网搜索" : "开启联网搜索"}
              >
                <Globe className="w-4 h-4 opacity-70" />
              </Button>

              {setExecutionStrategy && (
                <Select
                  value={executionStrategy}
                  onValueChange={(value) =>
                    setExecutionStrategy(
                      value as "react" | "code_orchestrated" | "auto",
                    )
                  }
                >
                  <SelectTrigger className="h-8 text-xs bg-background border shadow-sm min-w-[124px]">
                    <div className="flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="whitespace-nowrap">
                        {executionStrategyLabel}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent side="top" className="p-1 w-[176px]">
                    <SelectItem value="react">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Code2 className="w-3.5 h-3.5" />
                        ReAct
                      </div>
                    </SelectItem>
                    <SelectItem value="code_orchestrated">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Code2 className="w-3.5 h-3.5" />
                        Plan
                      </div>
                    </SelectItem>
                    <SelectItem value="auto">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Code2 className="w-3.5 h-3.5" />
                        Auto
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </ToolLoginLeft>

            <Button
              size="sm"
              onClick={handleSend}
              disabled={
                !input.trim() && !isEntryTheme && pendingImages.length === 0
              }
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-5 rounded-xl shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95 whitespace-nowrap"
            >
              开始生成
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Toolbar>
        </InputCard>

        {/* Dynamic Inspiration/Tips based on Tab - Styled nicely */}
        {selectedTextPreview && (
          <div className="w-full max-w-[800px] text-xs text-muted-foreground bg-muted/30 border border-border/70 rounded-lg px-3 py-2">
            已检测到选中内容，点击推荐会自动附带上下文：
            <span className="ml-1 text-foreground">
              “{selectedTextPreview}”
            </span>
          </div>
        )}
        <div className="w-full max-w-[800px] flex flex-wrap gap-3 justify-center">
          {currentRecommendations.map(([shortLabel, fullPrompt]) => (
            <Badge
              key={shortLabel}
              variant="secondary"
              className="px-4 py-2 text-xs font-normal cursor-pointer hover:bg-muted-foreground/10 transition-colors"
              title={fullPrompt}
              onClick={() => {
                const promptWithSelection = buildRecommendationPrompt(
                  fullPrompt,
                  selectedText,
                  appendSelectedTextToRecommendation,
                );
                if (onRecommendationClick) {
                  onRecommendationClick(shortLabel, promptWithSelection);
                } else {
                  setInput(promptWithSelection);
                }
              }}
            >
              {THEME_ICONS[activeTheme] || "✨"} {shortLabel}
            </Badge>
          ))}
        </div>
      </ContentWrapper>
    </Container>
  );
};
