import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  buildCuratedTaskCapabilityDescription,
  buildCuratedTaskLaunchPrompt,
  findCuratedTaskTemplateById,
  listCuratedTaskTemplates,
  listFeaturedHomeCuratedTaskTemplates,
  recordCuratedTaskTemplateUsage,
  replaceCuratedTaskLaunchPromptInInput,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "../utils/curatedTaskTemplates";
import { CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT } from "../utils/curatedTaskRecommendationSignals";
import type {
  CuratedTaskReferenceEntry,
  CuratedTaskReferenceSelection,
} from "../utils/curatedTaskReferenceSelection";
import { CuratedTaskLauncherDialog } from "./CuratedTaskLauncherDialog";
import { EmptyStateComposerPanel } from "./EmptyStateComposerPanel";
import { EmptyStateHero } from "./EmptyStateHero";
import { EmptyStateQuickActions } from "./EmptyStateQuickActions";
import { EmptyStateSceneAppsPanel } from "./EmptyStateSceneAppsPanel";
import {
  EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME,
  EMPTY_STATE_PAGE_CONTAINER_CLASSNAME,
} from "./emptyStateSurfaceTokens";
import {
  buildSkillSelectionProps,
  type SkillSelectionSourceProps,
} from "../skill-selection/skillSelectionBindings";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { WorkspaceSettings } from "@/types/workspace";
import type { ServiceSkillHomeItem } from "../service-skills/types";
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
  resolveInputCapabilityDispatch,
  type InputCapabilitySelection,
} from "../skill-selection/inputCapabilitySelection";
import { listSlashEntryUsage } from "../skill-selection/slashEntryUsage";
import {
  getSiteSkillAutoLaunchExample,
  hasAutoLaunchableSiteSkill,
} from "../service-skills/siteSkillExamplePrompts";
import { resolveServiceSkillEntryDescription } from "../service-skills/entryAdapter";
import { listFeaturedHomeServiceSkills } from "../service-skills/homeEntrySkills";
import { buildServiceSkillCapabilityDescription } from "../service-skills/skillPresentation";
import capabilitySkillsPlaceholder from "@/assets/entry-surface/capability-skills-lime.png";
import capabilityAutomationsPlaceholder from "@/assets/entry-surface/capability-automations-lime.png";
import capabilityAgentTeamsPlaceholder from "@/assets/entry-surface/capability-agent-teams-lime.png";
import capabilityBrowserAssistPlaceholder from "@/assets/entry-surface/capability-browser-assist-lime.png";
import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";
import type { RuntimeToolAvailability } from "../utils/runtimeToolAvailability";
import type { AgentTaskRuntimeCardModel } from "../utils/agentTaskRuntime";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { CreationReplaySurfaceModel } from "../utils/creationReplaySurface";

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
  min-width: 0;
  flex-direction: column;
  gap: 0.28rem;
  padding: 0 0.2rem 0.05rem;
`;

const RecommendationShelfHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-width: 0;
`;

const RecommendationShelfHeaderBody = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  min-width: 0;
  flex: 1 1 auto;
`;

const RecommendationShelfHeaderTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgb(100 116 139);
`;

const RecommendationShelfHeaderDescription = styled.div`
  font-size: 11px;
  line-height: 1.45;
  color: rgb(148 163 184);
`;

const RecommendationShelfList = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.38rem;
  min-width: 0;
  overflow: visible;
  white-space: normal;
  padding-bottom: 0.1rem;
`;

const RecommendationShelfRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  min-width: 0;
`;

const RecommendationShelfButton = styled.button`
  display: inline-flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
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

const RecommendationShelfTitleRow = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  flex-wrap: wrap;
`;

const RecommendationShelfTitle = styled.span`
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  color: currentColor;
`;

const RecommendationShelfInlineBadge = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  border: 1px solid rgb(226 232 240);
  background: rgb(248 250 252);
  padding: 0.1rem 0.38rem;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: rgb(100 116 139);
`;

const RecommendationShelfMeta = styled.span`
  max-width: 100%;
  font-size: 11px;
  line-height: 1.45;
  white-space: normal;
  color: rgb(148 163 184);
`;

const RecommendationShelfHint = styled.span`
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  line-height: 1;
  color: rgb(148 163 184);
`;

const RecommendationShelfBadge = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  border: 1px solid rgb(209 250 229);
  background: rgb(236 253 245);
  padding: 0.18rem 0.42rem;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: rgb(5 150 105);
`;

const RecommendationShelfEmptyState = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: rgb(148 163 184);
  padding: 0.1rem 0;
`;

const RecommendationShelfSections = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.45rem;
`;

const RecommendationShelfSection = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.22rem;
`;

const RecommendationShelfSectionHeader = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
`;

const RecommendationShelfSectionTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgb(100 116 139);
`;

const RecommendationShelfSectionDescription = styled.div`
  font-size: 11px;
  line-height: 1.45;
  color: rgb(148 163 184);
`;

const RecommendationShelfSectionDivider = styled.div`
  height: 1px;
  width: 100%;
  background: rgb(241 245 249);
`;

const RecommendationShelfSubsection = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.28rem;
`;

const RecommendationShelfSubsectionHeader = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
`;

const RecommendationShelfSubsectionTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: rgb(71 85 105);
`;

const RecommendationShelfSubsectionDescription = styled.div`
  font-size: 11px;
  line-height: 1.45;
  color: rgb(148 163 184);
`;

const RecommendationShelfPrimaryGrid = styled.div`
  display: grid;
  gap: 0.5rem;
  grid-template-columns: minmax(0, 1fr);

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const RecommendationShelfPrimaryCard = styled.button`
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.32rem;
  border-radius: 16px;
  border: 1px solid rgb(226 232 240);
  background: linear-gradient(180deg, rgb(255 255 255), rgb(248 250 252));
  padding: 0.7rem 0.78rem;
  text-align: left;
  color: rgb(51 65 85);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;

  &:hover {
    border-color: rgb(203 213 225);
    box-shadow: 0 10px 24px -24px rgba(15, 23, 42, 0.18);
    transform: translateY(-1px);
  }
`;

const RecommendationShelfPrimaryCardTop = styled.div`
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem;
`;

const RecommendationShelfPrimaryCardTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  color: rgb(15 23 42);
`;

const RecommendationShelfPrimaryCardSummary = styled.div`
  font-size: 11px;
  line-height: 1.55;
  color: rgb(100 116 139);
`;

const RecommendationShelfPrimaryCardMeta = styled.div`
  font-size: 11px;
  line-height: 1.5;
  color: rgb(148 163 184);
`;

const RecommendationShelfRouteHint = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  padding-top: 0.1rem;
  font-size: 11px;
  line-height: 1.5;
  color: rgb(148 163 184);
`;

const RecommendationShelfRouteLabel = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  border: 1px solid rgb(226 232 240);
  background: rgb(248 250 252);
  padding: 0.1rem 0.38rem;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: rgb(100 116 139);
`;

interface EmptyStateProps extends SkillSelectionSourceProps {
  input: string;
  setInput: (value: string) => void;
  onSend: (
    value: string,
    executionStrategy?: "react" | "code_orchestrated" | "auto",
    images?: MessageImage[],
    sendOptions?: HandleSendOptions,
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
  /** 首页推荐的 SceneApp 入口 */
  featuredSceneApps?: SceneAppEntryCardItem[];
  /** SceneApp 入口加载中 */
  sceneAppsLoading?: boolean;
  /** 当前正在启动的 SceneApp */
  sceneAppLaunchingId?: string | null;
  /** 启动 SceneApp */
  onLaunchSceneApp?: (sceneappId: string) => void | Promise<void>;
  /** 是否存在可恢复的最近 SceneApp */
  canResumeRecentSceneApp?: boolean;
  /** 恢复最近一次 SceneApp 上下文 */
  onResumeRecentSceneApp?: () => void;
  /** 打开 SceneApp 目录页 */
  onOpenSceneAppsDirectory?: () => void;
  /** 当前项目 ID */
  projectId?: string | null;
  /** 项目切换 */
  onProjectChange?: (projectId: string) => void;
  /** 打开设置 */
  onOpenSettings?: () => void;
  /** 当前 runtime tool surface */
  runtimeToolAvailability?: RuntimeToolAvailability | null;
  /** 当前执行态摘要 */
  runtimeTaskCard?: AgentTaskRuntimeCardModel | null;
  /** 打开记忆工作台 */
  onOpenMemoryWorkbench?: () => void;
  /** 打开消息渠道 */
  onOpenChannels?: () => void;
  /** 打开浏览器连接器 */
  onOpenChromeRelay?: () => void;
  /** 打开 OpenClaw 兼容入口 */
  onOpenOpenClaw?: () => void;
  /** 当前带入的 creation replay 前台投影 */
  creationReplaySurface?: CreationReplaySurfaceModel | null;
}

type RecommendationShelfItem =
  | {
      kind: "service-skill";
      key: string;
      title: string;
      summary: string;
      badge: string;
      hint: string;
      meta: string;
      testId: string;
      onSelect: () => void;
    }
  | {
      kind: "solution";
      key: string;
      title: string;
      summary: string;
      badge: string;
      hint: string;
      meta: string;
      testId: string;
      onSelect: () => void;
    };

interface ContinuationShelfItem {
  key: string;
  title: string;
  summary: string;
  badge: string;
  usedAt: number;
  testId: string;
  onSelect: () => void;
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
      "文案、图片、视频、搜索和网页任务，会围绕同一个目标持续推进。跑通过的方法会沉淀成常用做法、偏好和项目上下文，下次不用重新开始。",
  },
};

function truncatePrompt(value: string, maxLength = 92) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trim()}…`;
}

function compareRecentShelfItems<
  T extends {
    title: string;
    usedAt: number;
  },
>(left: T, right: T): number {
  if (left.usedAt !== right.usedAt) {
    return right.usedAt - left.usedAt;
  }

  return left.title.localeCompare(right.title, "zh-CN");
}

function formatMethodSummaryLabel(summaryLabel: string): string {
  const countMatch = summaryLabel.match(/^(\d+)\s+项技能可挂载$/);
  if (countMatch) {
    return `${countMatch[1]} 套做法可直接复用`;
  }

  if (summaryLabel === "按需挂载任务能力") {
    return "按需挂上常用做法";
  }

  return summaryLabel;
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
  serviceSkillGroups,
  isSkillsLoading,
  onSelectServiceSkill,
  onNavigateToSettings,
  onImportSkill,
  onRefreshSkills,
  onLaunchBrowserAssist,
  browserAssistLoading = false,
  featuredSceneApps = [],
  sceneAppsLoading = false,
  sceneAppLaunchingId = null,
  onLaunchSceneApp,
  canResumeRecentSceneApp = false,
  onResumeRecentSceneApp,
  onOpenSceneAppsDirectory,
  projectId = null,
  onProjectChange,
  onOpenSettings,
  isLoading = false,
  disabled = false,
  creationReplaySurface = null,
}) => {
  const [activeCapability, setActiveCapability] =
    useState<InputCapabilitySelection | null>(null);
  const activeCuratedTaskCapability =
    activeCapability?.kind === "curated_task" ? activeCapability : null;
  const activeCuratedTask = activeCuratedTaskCapability?.task ?? null;
  const activeCuratedTaskLaunchInputValues =
    activeCuratedTaskCapability?.launchInputValues;
  const activeCuratedTaskReferenceMemoryIds =
    activeCuratedTaskCapability?.referenceMemoryIds;
  const activeCuratedTaskReferenceEntries =
    activeCuratedTaskCapability?.referenceEntries;
  const currentSkill =
    activeCapability?.kind === "installed_skill"
      ? activeCapability.skill
      : null;
  const clearSelectedSkill = useCallback(() => {
    setActiveCapability(null);
  }, []);
  const handleSelectInstalledSkill = useCallback((skill: Skill) => {
    setActiveCapability({
      kind: "installed_skill",
      skill,
    });
  }, []);
  const handleSelectInputCapability = useCallback(
    (capability: InputCapabilitySelection) => {
      setActiveCapability(capability);
    },
    [],
  );
  const handleSelectServiceSkill = useCallback(
    (skill: ServiceSkillHomeItem) => {
      setActiveCapability(null);
      onSelectServiceSkill?.(skill);
    },
    [onSelectServiceSkill],
  );
  const skillSelection = buildSkillSelectionProps({
    skills,
    serviceSkills,
    serviceSkillGroups,
    isSkillsLoading,
    activeSkill: currentSkill,
    onSelectSkill: handleSelectInstalledSkill,
    onSelectServiceSkill: handleSelectServiceSkill,
    onClearSkill: clearSelectedSkill,
    onNavigateToSettings,
    onImportSkill,
    onRefreshSkills,
  });
  const skillOptionCount =
    skillSelection.skills.length + skillSelection.serviceSkills.length;
  const activeSkillDisplayLabel = getActiveSkillDisplayLabel(currentSkill);
  const skillSummaryLabel = getSkillSelectionSummaryLabel({
    activeSkill: currentSkill,
    skillCount: skillOptionCount,
  });
  const methodSummaryLabel = formatMethodSummaryLabel(skillSummaryLabel);
  const hasAutoLaunchSiteSkill = hasAutoLaunchableSiteSkill(serviceSkills);
  const siteSkillAutoLaunchExample =
    getSiteSkillAutoLaunchExample(serviceSkills);

  const [
    appendSelectedTextToRecommendation,
    setAppendSelectedTextToRecommendation,
  ] = useState(true);
  const [
    curatedTaskTemplatesVersion,
    setCuratedTaskTemplatesVersion,
  ] = useState(0);
  const [
    curatedTaskRecommendationSignalsVersion,
    setCuratedTaskRecommendationSignalsVersion,
  ] = useState(0);
  const [curatedTaskLauncherTask, setCuratedTaskLauncherTask] =
    useState<CuratedTaskTemplateItem | null>(null);
  const [
    curatedTaskLauncherInitialInputValues,
    setCuratedTaskLauncherInitialInputValues,
  ] = useState<CuratedTaskInputValues | null>(null);
  const [
    curatedTaskLauncherInitialReferenceMemoryIds,
    setCuratedTaskLauncherInitialReferenceMemoryIds,
  ] = useState<string[] | null>(null);
  const [
    curatedTaskLauncherInitialReferenceEntries,
    setCuratedTaskLauncherInitialReferenceEntries,
  ] = useState<CuratedTaskReferenceEntry[] | null>(null);
  const [showCapabilityCards, setShowCapabilityCards] = useState(false);

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

  useEffect(() => {
    const handleRecommendationSignalsChange = () => {
      setCuratedTaskRecommendationSignalsVersion((previous) => previous + 1);
    };

    window.addEventListener(
      CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT,
      handleRecommendationSignalsChange,
    );

    return () => {
      window.removeEventListener(
        CURATED_TASK_RECOMMENDATION_SIGNAL_EVENT,
        handleRecommendationSignalsChange,
      );
    };
  }, []);

  // 使用外部传入的 activeTheme，如果有 onThemeChange 则使用受控模式
  const handleThemeChange = useCallback(
    (theme: string) => {
      if (onThemeChange) {
        onThemeChange(theme === "general" ? theme : "general");
      }
    },
    [onThemeChange],
  );

  // 判断当前主题是否需要显示创作模式选择器
  const showCreationModeSelector = CREATION_THEMES.includes(activeTheme);

  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const isGeneralTheme = isGeneralResearchTheme(activeTheme);
  const isComposerBusy = isLoading || disabled;

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

  const curatedTaskTemplates = useMemo(() => {
    void curatedTaskTemplatesVersion;
    void curatedTaskRecommendationSignalsVersion;
    return listCuratedTaskTemplates();
  }, [
    curatedTaskRecommendationSignalsVersion,
    curatedTaskTemplatesVersion,
  ]);

  const recentSceneUsageBySceneKey = useMemo(() => {
    return new Map(
      listSlashEntryUsage()
        .filter((record) => record.kind === "scene")
        .map((record) => [record.entryId, record] as const),
    );
  }, []);

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
    const capabilityDispatch = resolveInputCapabilityDispatch(
      activeCapability,
      input,
    );
    const sendOptions =
      capabilityDispatch.capabilityRoute ||
      capabilityDispatch.displayContent ||
      capabilityDispatch.requestMetadata
        ? {
            capabilityRoute: capabilityDispatch.capabilityRoute,
            displayContent: capabilityDispatch.displayContent,
            requestMetadata: capabilityDispatch.requestMetadata,
          }
        : undefined;

    if (sendOptions) {
      onSend(input, executionStrategy, imagesToSend, sendOptions);
    } else {
      onSend(input, executionStrategy, imagesToSend);
    }
    setPendingImages([]);
    clearSelectedSkill?.();
  };

  const planEnabled = executionStrategy === "code_orchestrated";
  const workbenchCopy =
    THEME_WORKBENCH_COPY[activeTheme] || THEME_WORKBENCH_COPY.general;

  // Dynamic Placeholder
  const getPlaceholder = () => {
    return hasAutoLaunchSiteSkill
      ? `直接说一句话，例如：${siteSkillAutoLaunchExample}`
      : "有什么我可以帮你的？";
  };

  const handleApplyRecommendation = useCallback(
    (shortLabel: string, fullPrompt: string) => {
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
    },
    [
      activeTheme,
      appendSelectedTextToRecommendation,
      onRecommendationClick,
      onSubagentEnabledChange,
      selectedText,
      setInput,
    ],
  );

  const handleCuratedTaskLauncherRequest = useCallback(
    (
      template: CuratedTaskTemplateItem,
      initialInputValues?: CuratedTaskInputValues | null,
      initialReferenceMemoryIds?: string[] | null,
      initialReferenceEntries?: CuratedTaskReferenceEntry[] | null,
    ) => {
      setCuratedTaskLauncherTask(template);
      setCuratedTaskLauncherInitialInputValues(initialInputValues ?? null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(
        initialReferenceMemoryIds ?? null,
      );
      setCuratedTaskLauncherInitialReferenceEntries(
        initialReferenceEntries ?? null,
      );
    },
    [],
  );

  const handleCuratedTaskLauncherOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setCuratedTaskLauncherTask(null);
      setCuratedTaskLauncherInitialInputValues(null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(null);
      setCuratedTaskLauncherInitialReferenceEntries(null);
    }
  }, []);

  const handleApplyCuratedTaskTemplate = useCallback(
    (
      template: CuratedTaskTemplateItem,
      inputValues: CuratedTaskInputValues,
      referenceSelection: CuratedTaskReferenceSelection,
    ) => {
      recordCuratedTaskTemplateUsage(template.id);
      setCuratedTaskTemplatesVersion((previous) => previous + 1);
      setCuratedTaskLauncherTask(null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(null);
      setCuratedTaskLauncherInitialReferenceEntries(null);

      if (template.shouldEnableWebSearch && !webSearchEnabled) {
        onWebSearchEnabledChange?.(true);
      }

      if (template.shouldEnableTeamMode && !subagentEnabled) {
        onSubagentEnabledChange?.(true);
      }

      if (template.themeTarget) {
        handleThemeChange(template.themeTarget);
      }

      if (template.shouldLaunchBrowserAssist) {
        void onLaunchBrowserAssist?.();
      }

      const resolvedTemplate = findCuratedTaskTemplateById(template.id) ?? template;
      const launchPrompt = buildCuratedTaskLaunchPrompt({
        task: resolvedTemplate,
        inputValues,
        referenceEntries: referenceSelection.referenceEntries,
      });
      const nextPrompt = buildRecommendationPrompt(
        launchPrompt,
        selectedText,
        appendSelectedTextToRecommendation,
      );
      const promptWithSelection = replaceCuratedTaskLaunchPromptInInput({
        currentInput: input,
        previousPrompt:
          activeCuratedTask?.id === template.id ? activeCuratedTask.prompt : null,
        nextPrompt,
      });
      setActiveCapability({
        kind: "curated_task",
        task: {
          ...resolvedTemplate,
          prompt: nextPrompt,
        },
        launchInputValues: inputValues,
        referenceMemoryIds: referenceSelection.referenceMemoryIds,
        referenceEntries: referenceSelection.referenceEntries,
      });
      setInput(promptWithSelection);
    },
    [
      activeCuratedTask,
      appendSelectedTextToRecommendation,
      handleThemeChange,
      input,
      onLaunchBrowserAssist,
      onSubagentEnabledChange,
      onWebSearchEnabledChange,
      selectedText,
      setInput,
      subagentEnabled,
      webSearchEnabled,
    ],
  );

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
    ];

    if (showCreationModeSelector) {
      badges.push({
        key: "creation-mode",
        label: CREATION_MODE_CONFIG[creationMode].name,
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
  }, [creationMode, showCreationModeSelector, activeSkillDisplayLabel]);

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
        eyebrow: "沉淀能力",
        title: "我的方法",
        value: methodSummaryLabel,
        description:
          "把跑通过的常用做法沉淀下来，下次遇到同类任务可以直接续上。",
        icon: <Lightbulb className="h-5 w-5" />,
        imageSrc: capabilitySkillsPlaceholder,
        imageAlt: "方法能力卡占位图",
        tone: "lime",
      },
      {
        key: "automation",
        eyebrow: "沉淀能力",
        title: "持续流程",
        value: planEnabled ? "当前任务会按步骤推进" : "重复任务可持续复用",
        description:
          "适合批量任务和重复流程，让一套做法可以自己持续往下跑，不再每次从头开始。",
        icon: <ListChecks className="h-5 w-5" />,
        imageSrc: capabilityAutomationsPlaceholder,
        imageAlt: "持续流程能力卡占位图",
        tone: "lime",
      },
      {
        key: "agent-teams",
        eyebrow: "支撑能力",
        title: "任务拆分",
        value: subagentEnabled
          ? "当前任务支持分工推进"
          : "复杂任务可拆分并行推进",
        description:
          "当一个目标需要调研、方案和执行同时推进时，可以拆成多个分工后统一回收结论。",
        icon: <Workflow className="h-5 w-5" />,
        imageSrc: capabilityAgentTeamsPlaceholder,
        imageAlt: "任务拆分能力卡占位图",
        tone: "lime",
      },
    ];

    cards.push({
      key: "browser",
      eyebrow: "支撑能力",
      title: "浏览器接入",
      value: browserAssistLoading ? "正在检查连接状态" : "网页登录与网页执行",
      description:
        "登录、验证和网页操作可以直接在当前任务里继续，不必再切到单独工作台。",
      icon: <Globe className="h-5 w-5" />,
      imageSrc: capabilityBrowserAssistPlaceholder,
      imageAlt: "浏览器接入能力卡占位图",
      tone: "lime",
      onMediaAction: onLaunchBrowserAssist
        ? () => {
            void onLaunchBrowserAssist();
          }
        : undefined,
      mediaActionLabel: browserAssistLoading
        ? "浏览器连接准备中"
        : "连接浏览器",
      mediaActionDisabled: browserAssistLoading,
    });

    return cards;
  }, [
    browserAssistLoading,
    planEnabled,
    methodSummaryLabel,
    onLaunchBrowserAssist,
    subagentEnabled,
  ]);

  const recommendationShelfItems = useMemo<RecommendationShelfItem[]>(() => {
    const curatedTemplateRecommendations = listFeaturedHomeCuratedTaskTemplates(
      curatedTaskTemplates,
      {
        projectId,
        referenceEntries: creationReplaySurface?.defaultReferenceEntries,
      },
    ).map((featured) => {
      const template = featured.template;
      const metaPrefix = featured.reasonSummary
        ? `${featured.reasonSummary} · `
        : "";

      return {
          kind: "solution" as const,
          key: template.id,
          title: template.title,
          summary: template.summary,
          badge: featured.badgeLabel,
          hint: template.outputHint,
          meta: `${metaPrefix}${buildCuratedTaskCapabilityDescription(template, {
            includeSummary: false,
          })}`,
          testId: `entry-recommended-${template.id}`,
          onSelect: () =>
            handleCuratedTaskLauncherRequest(
              template,
              null,
              creationReplaySurface?.defaultReferenceMemoryIds,
              creationReplaySurface?.defaultReferenceEntries,
            ),
        };
      });

    const featuredServiceSkills = listFeaturedHomeServiceSkills(
      serviceSkills ?? [],
    );

    const serviceSkillRecommendations = isGeneralTheme
      ? featuredServiceSkills.map((skill) => {
          const requiresSlots = skill.slotSchema.some((slot) => slot.required);

          return {
            kind: "service-skill" as const,
            key: `service-skill-${skill.id}`,
            title: skill.title,
            summary:
              skill.summary?.trim() ||
              resolveServiceSkillEntryDescription(skill),
            badge: skill.isRecent ? "最近使用" : skill.badge,
            hint: requiresSlots
              ? "对话内补参后开始"
              : `${skill.actionLabel} · 当前对话继续`,
            meta: buildServiceSkillCapabilityDescription(skill, {
              includeSummary: false,
            }),
            testId: `entry-service-skill-${skill.id}`,
            onSelect: () => {
              handleSelectServiceSkill(skill);
            },
          };
        })
      : [];

    return [...curatedTemplateRecommendations, ...serviceSkillRecommendations];
  }, [
    creationReplaySurface,
    curatedTaskTemplates,
    handleCuratedTaskLauncherRequest,
    handleSelectServiceSkill,
    isGeneralTheme,
    projectId,
    serviceSkills,
  ]);

  const recommendationSolutionItems = useMemo(
    () => recommendationShelfItems.filter((item) => item.kind === "solution"),
    [recommendationShelfItems],
  );

  const recommendationServiceSkillItems = useMemo(
    () =>
      recommendationShelfItems.filter((item) => item.kind === "service-skill"),
    [recommendationShelfItems],
  );

  const primaryRecommendationItems = useMemo(
    () => recommendationSolutionItems.slice(0, 2),
    [recommendationSolutionItems],
  );

  const secondaryRecommendationItems = useMemo(
    () => recommendationSolutionItems.slice(2),
    [recommendationSolutionItems],
  );

  const continuationShelfItems = useMemo<ContinuationShelfItem[]>(() => {
    const recentTemplateItems = curatedTaskTemplates
      .filter(
        (template) =>
          template.isRecent && typeof template.recentUsedAt === "number",
      )
      .map((template) => ({
        key: `solution-${template.id}`,
        title: template.title,
        summary: buildCuratedTaskCapabilityDescription(template, {
          includeSummary: false,
        }),
        badge: "结果模板",
        usedAt: template.recentUsedAt as number,
        testId: `entry-continuation-solution-${template.id}`,
        onSelect: () =>
          handleCuratedTaskLauncherRequest(
            template,
            null,
            creationReplaySurface?.defaultReferenceMemoryIds,
            creationReplaySurface?.defaultReferenceEntries,
          ),
      }));

    const recentMethodItems =
      typeof onSelectServiceSkill === "function"
        ? (serviceSkills ?? [])
            .map((skill) => {
              const serviceSkillUsedAt =
                typeof skill.recentUsedAt === "number" ? skill.recentUsedAt : 0;
              const sceneUsedAt = skill.sceneBinding?.sceneKey
                ? (recentSceneUsageBySceneKey.get(skill.sceneBinding.sceneKey)
                    ?.usedAt ?? 0)
                : 0;
              const usedAt = Math.max(serviceSkillUsedAt, sceneUsedAt);

              if (usedAt <= 0) {
                return null;
              }

              return {
                key: `method-${skill.id}`,
                title: skill.title,
                summary: buildServiceSkillCapabilityDescription(skill, {
                  includeSummary: false,
                }),
                badge: "我的方法",
                usedAt,
                testId: `entry-continuation-method-${skill.id}`,
                onSelect: () => {
                  handleSelectServiceSkill(skill);
                },
              };
            })
            .filter((item): item is ContinuationShelfItem => item !== null)
        : [];

    return [...recentTemplateItems, ...recentMethodItems]
      .sort(compareRecentShelfItems)
      .slice(0, 4);
  }, [
    creationReplaySurface,
    curatedTaskTemplates,
    handleCuratedTaskLauncherRequest,
    handleSelectServiceSkill,
    onSelectServiceSkill,
    recentSceneUsageBySceneKey,
    serviceSkills,
  ]);

  const hasReusableMethodContinuation = useMemo(
    () => continuationShelfItems.some((item) => item.badge === "我的方法"),
    [continuationShelfItems],
  );

  const shouldShowSceneAppsPanel =
    sceneAppsLoading || featuredSceneApps.length > 0 || canResumeRecentSceneApp;

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
      activeCapability={activeCapability}
      onSelectInputCapability={handleSelectInputCapability}
      onClearInputCapability={clearSelectedSkill}
      onEditCuratedTask={
        activeCuratedTask
          ? () =>
              handleCuratedTaskLauncherRequest(
                activeCuratedTask,
                activeCuratedTaskLaunchInputValues,
                activeCuratedTaskReferenceMemoryIds ||
                  creationReplaySurface?.defaultReferenceMemoryIds,
                activeCuratedTaskReferenceEntries ||
                  creationReplaySurface?.defaultReferenceEntries,
              )
          : undefined
      }
      creationReplaySurface={creationReplaySurface}
      defaultCuratedTaskReferenceMemoryIds={
        creationReplaySurface?.defaultReferenceMemoryIds
      }
      defaultCuratedTaskReferenceEntries={
        creationReplaySurface?.defaultReferenceEntries
      }
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

  const generalResultShelfPanel = (
    <RecommendationShelf>
      <RecommendationShelfHeader>
        <RecommendationShelfHeaderBody>
          <RecommendationShelfHeaderTitle>
            结果入口
          </RecommendationShelfHeaderTitle>
          <RecommendationShelfHeaderDescription>
            先选你想拿到什么结果；最近跑通过的结果模板和常用做法也会留在这里，下一次不用重新开始。
          </RecommendationShelfHeaderDescription>
        </RecommendationShelfHeaderBody>
        {selectedTextPreview ? (
          <span className="truncate text-[10px] text-slate-400">
            当前会带上选中内容
          </span>
        ) : null}
      </RecommendationShelfHeader>

      <RecommendationShelfSections>
        <RecommendationShelfSection>
          <RecommendationShelfSectionHeader>
            <RecommendationShelfSectionTitle>
              结果模板
            </RecommendationShelfSectionTitle>
            <RecommendationShelfSectionDescription>
              先选你想拿到什么结果，再按需要补充快捷做法；首页默认先把最常用的结果放前面。
            </RecommendationShelfSectionDescription>
          </RecommendationShelfSectionHeader>

          {primaryRecommendationItems.length > 0 ? (
            <RecommendationShelfSubsection>
              <RecommendationShelfSubsectionHeader>
                <RecommendationShelfSubsectionTitle>
                  首选结果
                </RecommendationShelfSubsectionTitle>
                <RecommendationShelfSubsectionDescription>
                  默认先看这里，适合直接开工。
                </RecommendationShelfSubsectionDescription>
              </RecommendationShelfSubsectionHeader>

              <RecommendationShelfPrimaryGrid>
                {primaryRecommendationItems.map((item) => (
                  <RecommendationShelfPrimaryCard
                    key={item.key}
                    type="button"
                    data-testid={item.testId}
                    title={`${item.badge} · ${item.summary} · ${item.meta}`}
                    onClick={() => {
                      item.onSelect();
                    }}
                  >
                    <RecommendationShelfPrimaryCardTop>
                      <RecommendationShelfPrimaryCardTitle>
                        {item.title}
                      </RecommendationShelfPrimaryCardTitle>
                      <RecommendationShelfInlineBadge>
                        {item.badge}
                      </RecommendationShelfInlineBadge>
                    </RecommendationShelfPrimaryCardTop>
                    <RecommendationShelfPrimaryCardSummary>
                      {item.summary}
                    </RecommendationShelfPrimaryCardSummary>
                    <RecommendationShelfPrimaryCardMeta>
                      {item.meta}
                    </RecommendationShelfPrimaryCardMeta>
                  </RecommendationShelfPrimaryCard>
                ))}
              </RecommendationShelfPrimaryGrid>
            </RecommendationShelfSubsection>
          ) : null}

          {secondaryRecommendationItems.length > 0 ? (
            <RecommendationShelfSubsection>
              <RecommendationShelfSubsectionHeader>
                <RecommendationShelfSubsectionTitle>
                  更多结果
                </RecommendationShelfSubsectionTitle>
                <RecommendationShelfSubsectionDescription>
                  需要更具体的起手结果时，再从这里继续选。
                </RecommendationShelfSubsectionDescription>
              </RecommendationShelfSubsectionHeader>

              <RecommendationShelfList>
                {secondaryRecommendationItems.map((item, index) => (
                  <RecommendationShelfRow key={item.key}>
                    {index > 0 ? (
                      <RecommendationShelfHint aria-hidden="true">
                        |
                      </RecommendationShelfHint>
                    ) : null}
                    <RecommendationShelfButton
                      type="button"
                      data-testid={item.testId}
                      title={`${item.badge} · ${item.summary} · ${item.meta}`}
                      onClick={() => {
                        item.onSelect();
                      }}
                    >
                      <RecommendationShelfTitleRow>
                        <RecommendationShelfTitle>{item.title}</RecommendationShelfTitle>
                        <RecommendationShelfInlineBadge>
                          {item.badge}
                        </RecommendationShelfInlineBadge>
                      </RecommendationShelfTitleRow>
                      <RecommendationShelfMeta>{item.meta}</RecommendationShelfMeta>
                    </RecommendationShelfButton>
                  </RecommendationShelfRow>
                ))}
              </RecommendationShelfList>
            </RecommendationShelfSubsection>
          ) : null}

          {recommendationServiceSkillItems.length > 0 ? (
            <RecommendationShelfSubsection>
              <RecommendationShelfSubsectionHeader>
                <RecommendationShelfSubsectionTitle>
                  快捷做法
                </RecommendationShelfSubsectionTitle>
                <RecommendationShelfSubsectionDescription>
                  已经有现成做法时，可以直接走捷径，不必重选结果模板。
                </RecommendationShelfSubsectionDescription>
              </RecommendationShelfSubsectionHeader>

              <RecommendationShelfList>
                {recommendationServiceSkillItems.map((item, index) => (
                  <RecommendationShelfRow key={item.key}>
                    {index > 0 ? (
                      <RecommendationShelfHint aria-hidden="true">
                        |
                      </RecommendationShelfHint>
                    ) : null}
                    <RecommendationShelfButton
                      type="button"
                      data-testid={item.testId}
                      title={`${item.badge} · ${item.summary} · ${item.meta}`}
                      onClick={() => {
                        item.onSelect();
                      }}
                    >
                      <RecommendationShelfTitleRow>
                        <RecommendationShelfTitle>{item.title}</RecommendationShelfTitle>
                        <RecommendationShelfInlineBadge>
                          {item.badge}
                        </RecommendationShelfInlineBadge>
                      </RecommendationShelfTitleRow>
                      <RecommendationShelfMeta>{item.meta}</RecommendationShelfMeta>
                    </RecommendationShelfButton>
                  </RecommendationShelfRow>
                ))}
              </RecommendationShelfList>
            </RecommendationShelfSubsection>
          ) : null}
        </RecommendationShelfSection>

        <RecommendationShelfSectionDivider aria-hidden="true" />

        <RecommendationShelfSection>
          <RecommendationShelfSectionHeader>
            <RecommendationShelfSectionTitle>
              继续上次做法
            </RecommendationShelfSectionTitle>
            <RecommendationShelfSectionDescription>
              {continuationShelfItems.length > 0
                ? "最近跑通过的结果模板和常用做法会留在这里，这次可以直接续上。"
                : "最近跑通过的结果模板和常用做法会留在这里，下一次不用重新开始。"}
            </RecommendationShelfSectionDescription>
          </RecommendationShelfSectionHeader>

          {continuationShelfItems.length > 0 ? (
            <RecommendationShelfList>
              {continuationShelfItems.map((item, index) => (
                <RecommendationShelfRow key={item.key}>
                  {index > 0 ? (
                    <RecommendationShelfHint aria-hidden="true">
                      |
                    </RecommendationShelfHint>
                  ) : null}
                  <RecommendationShelfButton
                    type="button"
                    data-testid={item.testId}
                    title={`${item.badge} · ${item.summary}`}
                    onClick={() => {
                      item.onSelect();
                    }}
                  >
                    <RecommendationShelfBadge>
                      {item.badge}
                    </RecommendationShelfBadge>
                    <RecommendationShelfTitle>
                      {item.title}
                    </RecommendationShelfTitle>
                    <RecommendationShelfMeta>{item.summary}</RecommendationShelfMeta>
                  </RecommendationShelfButton>
                </RecommendationShelfRow>
              ))}
            </RecommendationShelfList>
          ) : (
            <RecommendationShelfEmptyState>
              你最近跑通过的结果模板和方法，会出现在这里。
            </RecommendationShelfEmptyState>
          )}
        </RecommendationShelfSection>
      </RecommendationShelfSections>

      <RecommendationShelfRouteHint data-testid="entry-result-destination-hint">
        <RecommendationShelfRouteLabel>结果去向</RecommendationShelfRouteLabel>
        {projectId
          ? "本轮产出会沉淀到当前项目；跑通过的方法会回到“继续上次做法”；参考与反馈会继续影响下一轮推荐。"
          : "本轮产出会沉淀到当前任务；跑通过的方法会回到“继续上次做法”；参考与反馈会继续影响下一轮推荐。"}
      </RecommendationShelfRouteHint>
    </RecommendationShelf>
  );

  const generalSceneAppsPanel = shouldShowSceneAppsPanel ? (
    <EmptyStateSceneAppsPanel
      items={featuredSceneApps}
      loading={sceneAppsLoading}
      launchingSceneAppId={sceneAppLaunchingId}
      onLaunchSceneApp={onLaunchSceneApp}
      canResumeRecentSceneApp={canResumeRecentSceneApp}
      onResumeRecentSceneApp={onResumeRecentSceneApp}
      onOpenSceneAppsDirectory={onOpenSceneAppsDirectory}
    />
  ) : null;

  const shouldShowCapabilitySummaryPanel =
    showCapabilityCards ||
    Boolean(onLaunchBrowserAssist) ||
    hasAutoLaunchSiteSkill ||
    hasReusableMethodContinuation;

  const generalCapabilitySummaryPanel = (
    <RecommendationShelf>
      <RecommendationShelfHeader>
        <RecommendationShelfHeaderBody>
          <RecommendationShelfHeaderTitle>
            支撑能力
          </RecommendationShelfHeaderTitle>
          <RecommendationShelfHeaderDescription>
            当前已有 {methodSummaryLabel}
            ；持续流程、任务拆分和浏览器接入会按需要自动挂上，你不用先选能力。
          </RecommendationShelfHeaderDescription>
        </RecommendationShelfHeaderBody>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onLaunchBrowserAssist ? (
            <button
              type="button"
              data-testid="entry-connect-browser"
              className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-900"
              onClick={() => {
                void onLaunchBrowserAssist();
              }}
            >
              连接浏览器
            </button>
          ) : null}
          <button
            type="button"
            data-testid="entry-capability-toggle"
            className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-white hover:text-slate-900"
            onClick={() => {
              setShowCapabilityCards((previous) => !previous);
            }}
          >
            {showCapabilityCards ? "收起支撑能力" : "查看支撑能力"}
          </button>
        </div>
      </RecommendationShelfHeader>
      <RecommendationShelfEmptyState>
        {showCapabilityCards
          ? "下方已展开当前会自动接入的能力说明。"
          : "默认先聚焦结果入口，只有在你想确认能力边界时再展开。"}
      </RecommendationShelfEmptyState>
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
          cards={isGeneralTheme && !showCapabilityCards ? [] : workspaceCards}
          prioritySlot={composerPanel}
          supportingSlot={
            isGeneralTheme ? (
              <>
                {generalResultShelfPanel}
                {generalSceneAppsPanel}
                {shouldShowCapabilitySummaryPanel
                  ? generalCapabilitySummaryPanel
                  : null}
              </>
            ) : (
              defaultQuickActionsPanel
            )
          }
          headerControls={headerControls}
        />
      </ContentWrapper>
      <CuratedTaskLauncherDialog
        open={Boolean(curatedTaskLauncherTask)}
        task={curatedTaskLauncherTask}
        initialInputValues={curatedTaskLauncherInitialInputValues}
        initialReferenceMemoryIds={curatedTaskLauncherInitialReferenceMemoryIds}
        initialReferenceEntries={curatedTaskLauncherInitialReferenceEntries}
        onOpenChange={handleCuratedTaskLauncherOpenChange}
        onConfirm={handleApplyCuratedTaskTemplate}
      />
    </PageContainer>
  );
};
