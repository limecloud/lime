import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";
import { ArrowRight } from "lucide-react";
import { getConfig } from "@/lib/api/appConfig";
import type { CreationMode } from "./types";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  buildRecommendationPrompt,
  getContextualRecommendations,
  isTeamRuntimeRecommendation,
} from "../utils/contextualRecommendations";
import {
  buildCuratedTaskRecentUsageDescription,
  buildCuratedTaskCapabilityDescription,
  buildCuratedTaskLaunchPrompt,
  findCuratedTaskTemplateById,
  listCuratedTaskTemplates,
  listFeaturedHomeCuratedTaskTemplates,
  recordCuratedTaskTemplateUsage,
  replaceCuratedTaskLaunchPromptInInput,
  resolveCuratedTaskTemplateLaunchPrefill,
  subscribeCuratedTaskTemplateUsageChanged,
  type CuratedTaskInputValues,
  type CuratedTaskTemplateItem,
} from "../utils/curatedTaskTemplates";
import {
  listCuratedTaskRecommendationSignals,
  subscribeCuratedTaskRecommendationSignalsChanged,
} from "../utils/curatedTaskRecommendationSignals";
import { buildReviewFeedbackProjection } from "../utils/reviewFeedbackProjection";
import {
  extractCuratedTaskReferenceMemoryIds,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
} from "../utils/curatedTaskReferenceSelection";
import type {
  CuratedTaskReferenceEntry,
  CuratedTaskReferenceSelection,
} from "../utils/curatedTaskReferenceSelection";
import { CuratedTaskLauncherDialog } from "./CuratedTaskLauncherDialog";
import { CreationReplaySurfaceBanner } from "./CreationReplaySurfaceBanner";
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
  resolveInputCapabilityDispatch,
  type InputCapabilitySelection,
} from "../skill-selection/inputCapabilitySelection";
import {
  listSlashEntryUsage,
  subscribeSlashEntryUsageChanged,
} from "../skill-selection/slashEntryUsage";
import {
  getSiteSkillAutoLaunchExample,
  hasAutoLaunchableSiteSkill,
} from "../service-skills/siteSkillExamplePrompts";
import { resolveServiceSkillEntryDescription } from "../service-skills/entryAdapter";
import { listFeaturedHomeServiceSkills } from "../service-skills/homeEntrySkills";
import { buildServiceSkillCapabilityDescription } from "../service-skills/skillPresentation";
import {
  buildServiceSkillLaunchPrefillSummary,
  resolveServiceSkillLaunchPrefill,
} from "../service-skills/serviceSkillLaunchPrefill";
import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";
import type { RuntimeToolAvailability } from "../utils/runtimeToolAvailability";
import type { AgentTaskRuntimeCardModel } from "../utils/agentTaskRuntime";
import type { HandleSendOptions } from "../hooks/handleSendTypes";
import type { CreationReplaySurfaceModel } from "../utils/creationReplaySurface";
import { buildInstalledSkillCapabilityDescription } from "@/components/skills/installedSkillPresentation";
import {
  buildSceneAppExecutionReviewPrefillHighlights,
  buildSceneAppExecutionReviewPrefillSnapshot,
} from "../utils/sceneAppCuratedTaskReference";

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
  background:
    radial-gradient(
      circle at 8% 12%,
      var(--lime-home-glow-primary, rgba(132, 204, 22, 0.08)),
      transparent 28%
    ),
    radial-gradient(
      circle at 76% 16%,
      var(--lime-home-glow-secondary, rgba(186, 230, 253, 0.16)),
      transparent 30%
    ),
    linear-gradient(
      180deg,
      var(--lime-home-bg-start, #f8fcf7) 0%,
      var(--lime-home-bg-mid, #f9fbf8) 42%,
      var(--lime-home-bg-end, #f5faf7) 100%
    );
`;

const ContentWrapper = styled.div.attrs({
  className: EMPTY_STATE_CONTENT_WRAPPER_CLASSNAME,
})`
  display: flex;
  flex: 1 1 auto;
  min-height: 100%;
  animation: ${contentReveal} 560ms cubic-bezier(0.22, 1, 0.36, 1) both;
  padding: 0.45rem 0.25rem 1.25rem;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const RecommendationShelf = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.88rem;
  border-radius: 30px;
  border: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.92));
  background: linear-gradient(
    180deg,
    var(--lime-surface-subtle, #fcfffb) 0%,
    var(--lime-surface-soft, #f8fcfa) 100%
  );
  padding: 1rem 1.05rem 0.95rem;
  box-shadow: 0 22px 42px -38px var(--lime-shadow-color);
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
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--lime-text, rgb(71 85 105));
`;

const RecommendationShelfHeaderDescription = styled.div`
  font-size: 13px;
  line-height: 1.55;
  color: var(--lime-text-muted, rgb(100 116 139));
`;

const RecommendationShelfInlineBadge = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  border: 1px solid var(--lime-surface-border, rgb(226 232 240));
  background: var(--lime-surface-soft, rgb(248 250 252));
  padding: 0.1rem 0.38rem;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: var(--lime-text-muted, rgb(100 116 139));
`;

const RecommendationShelfBadge = styled.span`
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  border: 1px solid var(--lime-surface-border-strong, rgb(209 250 229));
  background: var(--lime-brand-soft, rgb(236 253 245));
  padding: 0.18rem 0.42rem;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  color: var(--lime-brand-strong, rgb(5 150 105));
`;

const RecommendationShelfEmptyState = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: var(--lime-text-muted, rgb(148 163 184));
  padding: 0.1rem 0;
`;

const RecommendationSignalBanner = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  border-radius: 18px;
  border: 1px solid var(--lime-home-card-border, rgba(191, 219, 254, 0.95));
  background:
    radial-gradient(
      circle at top right,
      var(--lime-home-glow-secondary, rgba(186, 230, 253, 0.26)),
      rgba(255, 255, 255, 0) 48%
    ),
    linear-gradient(
      180deg,
      var(--lime-surface-soft, rgba(248, 250, 252, 0.96)),
      var(--lime-surface, rgba(255, 255, 255, 0.98))
    );
  padding: 0.9rem 0.95rem;
`;

const RecommendationSignalBannerHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
`;

const RecommendationSignalBannerTitle = styled.div`
  font-size: 12px;
  font-weight: 600;
  line-height: 1.6;
  color: var(--lime-text-strong, rgb(15 23 42));
`;

const RecommendationSignalBannerSummary = styled.div`
  font-size: 12px;
  line-height: 1.65;
  color: var(--lime-text, rgb(71 85 105));
`;

const RecommendationSignalBannerFootnote = styled.div`
  font-size: 11px;
  line-height: 1.6;
  color: var(--lime-info, rgb(14 116 144));
`;

const RecommendationLeadCard = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.72rem;
  border-radius: 30px;
  border: 1px solid var(--lime-home-card-border, rgba(191, 219, 254, 0.92));
  background: var(--lime-home-card-surface-strong);
  padding: 1.22rem 1.25rem 1.18rem;
  text-align: left;
  color: var(--lime-text, rgb(51 65 85));
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;

  &:hover {
    border-color: var(--lime-home-card-hover-border, rgb(147 197 253));
    box-shadow: 0 18px 42px -30px var(--lime-shadow-color);
    transform: translateY(-1px);
  }
`;

const RecommendationLeadEyebrowRow = styled.div`
  display: flex;
  width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.55rem;
`;

const RecommendationLeadEyebrow = styled.span`
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--lime-info, rgb(3 105 161));
`;

const RecommendationLeadTitle = styled.div`
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--lime-text-strong, rgb(15 23 42));
`;

const RecommendationLeadSummary = styled.div`
  font-size: 13px;
  line-height: 1.65;
  color: var(--lime-text, rgb(71 85 105));
`;

const RecommendationLeadMeta = styled.div`
  font-size: 12px;
  line-height: 1.6;
  color: var(--lime-text-muted, rgb(100 116 139));
`;

const RecommendationLeadFooter = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 0.38rem;
  padding-top: 0.2rem;
  font-size: 12px;
  font-weight: 600;
  color: var(--lime-text-strong, rgb(15 23 42));
`;

const RecommendationAssistGroup = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.28rem;
`;

const RecommendationAssistLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--lime-text, rgb(71 85 105));
`;

const RecommendationAssistList = styled.div`
  display: grid;
  gap: 0.55rem;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;

  @media (min-width: 768px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @media (min-width: 1240px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`;

const RecommendationAssistCard = styled.button`
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.35rem;
  border-radius: 22px;
  border: 1px solid
    var(--lime-home-card-border-muted, rgba(219, 234, 254, 0.98));
  background: var(--lime-home-card-surface-strong);
  padding: 0.96rem 1rem;
  text-align: left;
  color: var(--lime-text, rgb(51 65 85));
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    transform 180ms ease;

  &:hover {
    border-color: var(--lime-home-card-hover-border, rgb(147 197 253));
    background: var(--lime-surface, rgb(255 255 255));
    transform: translateY(-1px);
  }
`;

const RecommendationAssistCardHeader = styled.div`
  display: flex;
  width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
`;

const RecommendationAssistCardTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  line-height: 1.45;
  color: var(--lime-text-strong, rgb(15 23 42));
`;

const RecommendationAssistCardSummary = styled.div`
  font-size: 12px;
  line-height: 1.55;
  color: var(--lime-text-muted, rgb(100 116 139));
`;

const RecommendationAssistFootnote = styled.div`
  font-size: 12px;
  line-height: 1.55;
  color: var(--lime-text-muted, rgb(148 163 184));
`;

const RecommendationSupplementalPanel = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.56rem;
  padding-top: 0.2rem;
  border-top: 1px solid var(--lime-surface-border, rgba(226, 232, 240, 0.88));
`;

const RecommendationSupplementalLabel = styled.div`
  font-size: 12px;
  line-height: 1.5;
  color: var(--lime-text-muted, rgb(148 163 184));
`;

const RecommendationSupplementalRow = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
`;

const RecommendationSupplementalLink = styled.button`
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  border: 1px solid var(--lime-surface-border, rgb(226 232 240));
  background: var(--lime-surface, rgb(255 255 255));
  padding: 0.42rem 0.78rem;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--lime-text, rgb(71 85 105));
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    color 180ms ease;

  &:hover {
    border-color: var(--lime-surface-border-strong, rgb(203 213 225));
    background: var(--lime-surface-soft, rgb(248 250 252));
    color: var(--lime-text-strong, rgb(15 23 42));
  }
`;

const RecommendationTabsRow = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
`;

const RecommendationTabsRail = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
`;

const RecommendationTabButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 36px;
  border-radius: 9999px;
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "var(--lime-surface-border-strong, rgba(134, 239, 172, 0.72))"
        : "var(--lime-surface-border, rgba(226, 232, 240, 0.94))"};
  background: ${({ $active }) =>
    $active
      ? "var(--lime-brand-soft, linear-gradient(180deg, rgba(240, 253, 244, 0.98), rgba(220, 252, 231, 0.92)))"
      : "var(--lime-surface, rgba(255, 255, 255, 0.94))"};
  padding: 0.5rem 0.85rem;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  color: ${({ $active }) =>
    $active
      ? "var(--lime-brand-strong, rgb(22 101 52))"
      : "var(--lime-text, rgb(71 85 105))"};
  transition:
    border-color 180ms ease,
    background-color 180ms ease,
    color 180ms ease,
    transform 180ms ease,
    box-shadow 180ms ease;

  &:hover {
    border-color: ${({ $active }) =>
      $active
        ? "var(--lime-surface-border-strong, rgba(110, 231, 183, 0.84))"
        : "var(--lime-surface-border, rgba(203, 213, 225, 0.96))"};
    color: var(--lime-text-strong, rgb(15 23 42));
    background: ${({ $active }) =>
      $active
        ? "var(--lime-brand-soft, linear-gradient(180deg, rgba(236, 253, 245, 1), rgba(220, 252, 231, 0.98)))"
        : "var(--lime-surface, rgb(255 255 255))"};
    box-shadow: 0 14px 28px -28px var(--lime-shadow-color);
    transform: translateY(-1px);
  }
`;

const RecommendationTabCount = styled.span<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.35rem;
  height: 1.35rem;
  border-radius: 9999px;
  background: ${({ $active }) =>
    $active
      ? "var(--lime-surface, rgba(255, 255, 255, 0.96))"
      : "var(--lime-surface-soft, rgba(248, 250, 252, 0.98))"};
  border: 1px solid
    ${({ $active }) =>
      $active
        ? "var(--lime-surface-border-strong, rgba(134, 239, 172, 0.64))"
        : "var(--lime-surface-border, rgba(226, 232, 240, 0.96))"};
  padding: 0 0.35rem;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: ${({ $active }) =>
    $active
      ? "var(--lime-brand-strong, rgb(21 128 61))"
      : "var(--lime-text-muted, rgb(100 116 139))"};
`;

const RecommendationTabCaption = styled.div`
  font-size: 12px;
  line-height: 1.6;
  color: var(--lime-text-muted, rgb(100 116 139));
`;

const RecommendationPanels = styled.div`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.8rem;
`;

const RecommendationTabPanel = styled.section`
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.78rem;

  &[hidden] {
    display: none;
  }
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
  /** 最近会话标题 */
  recentSessionTitle?: string | null;
  /** 最近会话摘要 */
  recentSessionSummary?: string | null;
  /** 最近会话恢复动作文案 */
  recentSessionActionLabel?: string;
  /** 恢复最近一次会话上下文 */
  onResumeRecentSession?: () => void;
  /** 打开 SceneApp 目录页 */
  onOpenSceneAppsDirectory?: () => void;
  /** 当前项目 ID */
  projectId?: string | null;
  /** 当前会话 ID */
  sessionId?: string | null;
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
  /** 当前结果模板默认带入的 memory 引用 id */
  defaultCuratedTaskReferenceMemoryIds?: string[];
  /** 当前结果模板默认带入的参考对象 */
  defaultCuratedTaskReferenceEntries?: CuratedTaskReferenceEntry[];
}

type RecommendationShelfItem =
  | {
      kind: "service-skill";
      key: string;
      title: string;
      summary: string;
      badge?: string;
      hint: string;
      meta: string;
      contextSummary?: string;
      reasonLabel?: string;
      reasonSummary?: string;
      testId: string;
      onSelect: () => void;
    }
  | {
      kind: "solution";
      key: string;
      title: string;
      summary: string;
      badge?: string;
      hint: string;
      meta: string;
      contextSummary?: string;
      reasonLabel?: string;
      reasonSummary?: string;
      testId: string;
      onSelect: () => void;
    };

interface ContinuationShelfItem {
  key: string;
  title: string;
  summary: string;
  badge?: string;
  usedAt: number;
  testId: string;
  onSelect: () => void;
}

type LaunchDeckTab = "recommended" | "continuation" | "methods";

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
    description: "说一句目标，Lime 就接着帮你做。",
    supportingDescription:
      "文案、图片、视频、搜索和网页任务围绕同一目标持续推进，并沉淀上下文、偏好和做法。",
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

function resolveResultShelfTitle(
  creationReplaySurface?: CreationReplaySurfaceModel | null,
): string {
  return creationReplaySurface ? "沿着当前上下文继续" : "先开始这一轮";
}

function resolveResultShelfDescription(
  creationReplaySurface?: CreationReplaySurfaceModel | null,
): string {
  if (!creationReplaySurface) {
    return "先选一个结果起手；后面的补参考、改方向和续做，都留在这一轮里继续推进。";
  }

  if (creationReplaySurface.kind === "skill_scaffold") {
    return "这轮会先沿着当前带入的做法草稿继续生成；先拿一个结果开工，跑顺后再回到我的方法继续整理。";
  }

  return "这轮会默认带着当前参考一起生成；你选的结果模板会自动沿用这份上下文。";
}

function resolveLeadRecommendationEyebrow(
  creationReplaySurface?: CreationReplaySurfaceModel | null,
): string {
  if (!creationReplaySurface) {
    return "先从这个开始";
  }

  return creationReplaySurface.kind === "skill_scaffold"
    ? "先沿着当前做法开工"
    : "先沿着当前参考继续";
}

function resolveLaunchDeckTabCaption(tab: LaunchDeckTab): string {
  switch (tab) {
    case "continuation":
      return "把最近跑过的模板、方法和会话接回这一轮，省掉重复起手。";
    case "methods":
      return "不想先选结果模板时，也可以直接沿着现成做法开工。";
    case "recommended":
    default:
      return "先从结果入口起手，后面的补参考、改方向和续做都留在这一轮里。";
  }
}

function buildRecommendationContextSummary(
  segments: Array<string | null | undefined>,
): string | undefined {
  const normalizedSegments = segments
    .map((segment) => segment?.trim())
    .filter((segment): segment is string => Boolean(segment));

  if (normalizedSegments.length === 0) {
    return undefined;
  }

  return normalizedSegments.join(" · ");
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
  recentSessionTitle = null,
  recentSessionSummary = null,
  recentSessionActionLabel = "继续最近会话",
  onResumeRecentSession,
  onOpenSceneAppsDirectory,
  projectId = null,
  sessionId = null,
  isLoading = false,
  disabled = false,
  creationReplaySurface = null,
  defaultCuratedTaskReferenceMemoryIds,
  defaultCuratedTaskReferenceEntries,
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
  const effectiveDefaultCuratedTaskReferenceMemoryIds = useMemo(
    () =>
      defaultCuratedTaskReferenceMemoryIds ??
      creationReplaySurface?.defaultReferenceMemoryIds ??
      [],
    [
      creationReplaySurface?.defaultReferenceMemoryIds,
      defaultCuratedTaskReferenceMemoryIds,
    ],
  );
  const effectiveDefaultCuratedTaskReferenceEntries = useMemo(
    () =>
      defaultCuratedTaskReferenceEntries ??
      creationReplaySurface?.defaultReferenceEntries ??
      [],
    [
      creationReplaySurface?.defaultReferenceEntries,
      defaultCuratedTaskReferenceEntries,
    ],
  );
  const currentSkill =
    activeCapability?.kind === "installed_skill"
      ? activeCapability.skill
      : null;
  const clearSelectedSkill = useCallback(() => {
    setActiveCapability(null);
  }, []);
  const handleSelectInputCapability = useCallback(
    (capability: InputCapabilitySelection) => {
      if (capability.kind === "service_skill") {
        setActiveCapability(null);
        onSelectServiceSkill?.(capability.skill);
        return;
      }
      setActiveCapability(capability);
    },
    [onSelectServiceSkill],
  );
  const skillSelection = buildSkillSelectionProps({
    skills,
    serviceSkills,
    serviceSkillGroups,
    isSkillsLoading,
    activeSkill: currentSkill,
    onSelectInputCapability: handleSelectInputCapability,
    onClearSkill: clearSelectedSkill,
    onNavigateToSettings,
    onImportSkill,
    onRefreshSkills,
  });
  const hasAutoLaunchSiteSkill = hasAutoLaunchableSiteSkill(serviceSkills);
  const siteSkillAutoLaunchExample =
    getSiteSkillAutoLaunchExample(serviceSkills);

  const [
    appendSelectedTextToRecommendation,
    setAppendSelectedTextToRecommendation,
  ] = useState(true);
  const [curatedTaskTemplatesVersion, setCuratedTaskTemplatesVersion] =
    useState(0);
  const [
    curatedTaskRecommendationSignalsVersion,
    setCuratedTaskRecommendationSignalsVersion,
  ] = useState(0);
  const [slashEntryUsageVersion, setSlashEntryUsageVersion] = useState(0);
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
  const [curatedTaskLauncherPrefillHint, setCuratedTaskLauncherPrefillHint] =
    useState<string | null>(null);

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
    return subscribeCuratedTaskTemplateUsageChanged(() => {
      setCuratedTaskTemplatesVersion((previous) => previous + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeCuratedTaskRecommendationSignalsChanged(() => {
      setCuratedTaskRecommendationSignalsVersion((previous) => previous + 1);
    });
  }, []);

  useEffect(() => {
    return subscribeSlashEntryUsageChanged(() => {
      setSlashEntryUsageVersion((previous) => previous + 1);
    });
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
  }, [curatedTaskRecommendationSignalsVersion, curatedTaskTemplatesVersion]);

  const latestReviewRecommendationSignal = useMemo(() => {
    void curatedTaskRecommendationSignalsVersion;
    return (
      listCuratedTaskRecommendationSignals({
        projectId,
      })
        .filter((signal) => signal.source === "review_feedback")
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
    );
  }, [curatedTaskRecommendationSignalsVersion, projectId]);

  const recentSceneUsageBySceneKey = useMemo(() => {
    void slashEntryUsageVersion;
    return new Map(
      listSlashEntryUsage()
        .filter((record) => record.kind === "scene")
        .map((record) => [record.entryId, record] as const),
    );
  }, [slashEntryUsageVersion]);

  const recentInstalledSkillUsageBySkillKey = useMemo(() => {
    void slashEntryUsageVersion;
    return new Map(
      listSlashEntryUsage()
        .filter((record) => record.kind === "skill")
        .map((record) => [record.entryId, record] as const),
    );
  }, [slashEntryUsageVersion]);

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

  const handleSend = (inputOverride = input) => {
    if (
      isComposerBusy ||
      (!inputOverride.trim() && pendingImages.length === 0)
    ) {
      return;
    }
    const imagesToSend = pendingImages.length > 0 ? pendingImages : undefined;
    const capabilityDispatch = resolveInputCapabilityDispatch(
      activeCapability,
      inputOverride,
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
      onSend(inputOverride, executionStrategy, imagesToSend, sendOptions);
    } else {
      onSend(inputOverride, executionStrategy, imagesToSend);
    }
    setPendingImages([]);
    clearSelectedSkill?.();
  };

  const workbenchCopy =
    THEME_WORKBENCH_COPY[activeTheme] || THEME_WORKBENCH_COPY.general;

  // Dynamic Placeholder
  const getPlaceholder = () => {
    return hasAutoLaunchSiteSkill
      ? `直接说一句话，例如：${siteSkillAutoLaunchExample}`
      : "先说这轮要做什么，目标、对象或限制都可以。";
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
      prefillHint?: string | null,
    ) => {
      const mergedReferenceEntries = mergeCuratedTaskReferenceEntries([
        ...(initialReferenceEntries ?? []),
        ...effectiveDefaultCuratedTaskReferenceEntries,
      ]);
      const mergedReferenceMemoryIds =
        normalizeCuratedTaskReferenceMemoryIds([
          ...(initialReferenceMemoryIds ?? []),
          ...(extractCuratedTaskReferenceMemoryIds(mergedReferenceEntries) ??
            []),
          ...effectiveDefaultCuratedTaskReferenceMemoryIds,
        ]) ?? null;
      setCuratedTaskLauncherTask(template);
      setCuratedTaskLauncherInitialInputValues(initialInputValues ?? null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(mergedReferenceMemoryIds);
      setCuratedTaskLauncherInitialReferenceEntries(mergedReferenceEntries);
      setCuratedTaskLauncherPrefillHint(prefillHint ?? null);
    },
    [
      effectiveDefaultCuratedTaskReferenceEntries,
      effectiveDefaultCuratedTaskReferenceMemoryIds,
    ],
  );

  const handleCuratedTaskLauncherOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setCuratedTaskLauncherTask(null);
      setCuratedTaskLauncherInitialInputValues(null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(null);
      setCuratedTaskLauncherInitialReferenceEntries(null);
      setCuratedTaskLauncherPrefillHint(null);
    }
  }, []);
  const handleApplyLauncherReviewSuggestion = useCallback(
    (
      template: CuratedTaskTemplateItem,
      options: {
        inputValues: CuratedTaskInputValues;
        referenceSelection: CuratedTaskReferenceSelection;
      },
    ) => {
      setCuratedTaskLauncherTask(template);
      setCuratedTaskLauncherInitialInputValues(options.inputValues);
      setCuratedTaskLauncherInitialReferenceMemoryIds(
        options.referenceSelection.referenceMemoryIds,
      );
      setCuratedTaskLauncherInitialReferenceEntries(
        options.referenceSelection.referenceEntries,
      );
      setCuratedTaskLauncherPrefillHint(
        `已按最近判断切到更适合的结果模板，你可以继续改后再进入生成。`,
      );
    },
    [],
  );

  const handleApplyCuratedTaskTemplate = useCallback(
    (
      template: CuratedTaskTemplateItem,
      inputValues: CuratedTaskInputValues,
      referenceSelection: CuratedTaskReferenceSelection,
    ) => {
      recordCuratedTaskTemplateUsage({
        templateId: template.id,
        launchInputValues: inputValues,
        referenceMemoryIds: referenceSelection.referenceMemoryIds,
        referenceEntries: referenceSelection.referenceEntries,
      });
      setCuratedTaskTemplatesVersion((previous) => previous + 1);
      setCuratedTaskLauncherTask(null);
      setCuratedTaskLauncherInitialInputValues(null);
      setCuratedTaskLauncherInitialReferenceMemoryIds(null);
      setCuratedTaskLauncherInitialReferenceEntries(null);
      setCuratedTaskLauncherPrefillHint(null);

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

      const resolvedTemplate =
        findCuratedTaskTemplateById(template.id) ?? template;
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
          activeCuratedTask?.id === template.id
            ? activeCuratedTask.prompt
            : null,
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

  const recommendationShelfItems = useMemo<RecommendationShelfItem[]>(() => {
    const curatedTemplateRecommendations = listFeaturedHomeCuratedTaskTemplates(
      curatedTaskTemplates,
      {
        projectId,
        referenceEntries: effectiveDefaultCuratedTaskReferenceEntries,
      },
    ).map((featured) => {
      const template = featured.template;
      const launchPrefill = resolveCuratedTaskTemplateLaunchPrefill(template);
      const reviewPrefillSnapshot = buildSceneAppExecutionReviewPrefillSnapshot(
        {
          referenceEntries: [
            ...effectiveDefaultCuratedTaskReferenceEntries,
            ...(launchPrefill?.referenceEntries ?? []),
          ],
          taskId: template.id,
        },
      );
      const metaPrefix = featured.reasonSummary
        ? `${featured.reasonSummary} · `
        : "";

      return {
        kind: "solution" as const,
        key: template.id,
        title: template.title,
        summary: template.summary,
        hint: template.outputHint,
        meta: `${metaPrefix}${buildCuratedTaskCapabilityDescription(template, {
          includeSummary: false,
          includeResultDestination: true,
          includeFollowUpActions: true,
          followUpLimit: 1,
        })}`,
        contextSummary: buildRecommendationContextSummary(
          reviewPrefillSnapshot
            ? [
                `当前结果基线：${reviewPrefillSnapshot.sourceTitle}`,
                reviewPrefillSnapshot.statusLabel
                  ? `当前判断：${reviewPrefillSnapshot.statusLabel}`
                  : null,
                reviewPrefillSnapshot.failureSignalLabel
                  ? `当前卡点：${reviewPrefillSnapshot.failureSignalLabel}`
                  : null,
                reviewPrefillSnapshot.destinationsLabel
                  ? `更适合去向：${reviewPrefillSnapshot.destinationsLabel}`
                  : reviewPrefillSnapshot.operatingAction
                    ? `经营动作：${reviewPrefillSnapshot.operatingAction}`
                    : null,
              ]
            : buildSceneAppExecutionReviewPrefillHighlights(
                reviewPrefillSnapshot,
              ),
        ),
        reasonLabel: featured.reasonLabel,
        reasonSummary: featured.reasonSummary,
        testId: `entry-recommended-${template.id}`,
        onSelect: () =>
          handleCuratedTaskLauncherRequest(
            template,
            null,
            effectiveDefaultCuratedTaskReferenceMemoryIds,
            effectiveDefaultCuratedTaskReferenceEntries,
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
            hint: requiresSlots
              ? "补齐这一步后开始"
              : `${skill.actionLabel} · 当前对话继续`,
            meta: buildServiceSkillCapabilityDescription(skill, {
              includeSummary: false,
            }),
            testId: `entry-service-skill-${skill.id}`,
            onSelect: () =>
              handleSelectInputCapability({
                kind: "service_skill",
                skill,
              }),
          };
        })
      : [];

    return [...curatedTemplateRecommendations, ...serviceSkillRecommendations];
  }, [
    curatedTaskTemplates,
    effectiveDefaultCuratedTaskReferenceEntries,
    effectiveDefaultCuratedTaskReferenceMemoryIds,
    handleCuratedTaskLauncherRequest,
    handleSelectInputCapability,
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

  const leadRecommendationItem = useMemo(
    () =>
      primaryRecommendationItems[0] ??
      recommendationSolutionItems[0] ??
      recommendationShelfItems[0] ??
      null,
    [
      primaryRecommendationItems,
      recommendationShelfItems,
      recommendationSolutionItems,
    ],
  );

  const alternativeRecommendationItems = useMemo(() => {
    const leadKey = leadRecommendationItem?.key;
    return recommendationSolutionItems
      .filter((item) => item.key !== leadKey)
      .slice(0, 5);
  }, [leadRecommendationItem?.key, recommendationSolutionItems]);

  const reviewFeedbackBanner = useMemo(() => {
    if (!latestReviewRecommendationSignal) {
      return null;
    }

    const projection = buildReviewFeedbackProjection({
      signal: latestReviewRecommendationSignal,
    });
    const highlightedRecommendations = recommendationSolutionItems
      .filter((item) => item.reasonLabel === "围绕最近判断")
      .slice(0, 2);
    if (highlightedRecommendations.length === 0) {
      return null;
    }
    const primarySuggestedRecommendation =
      (projection?.suggestedTasks[0]
        ? highlightedRecommendations.find(
            (item) => item.key === projection.suggestedTasks[0]?.taskId,
          )
        : null) ?? highlightedRecommendations[0];

    return {
      title: latestReviewRecommendationSignal.title,
      summary: truncatePrompt(
        [
          latestReviewRecommendationSignal.summary,
          projection?.suggestionText ?? "",
        ]
          .filter((segment) => segment.trim().length > 0)
          .join(" "),
        152,
      ),
      nextSteps: highlightedRecommendations
        .map((item) => item.title)
        .join(" / "),
      actionLabel: primarySuggestedRecommendation
        ? `继续去「${primarySuggestedRecommendation.title}」`
        : null,
      onAction: primarySuggestedRecommendation?.onSelect ?? null,
    };
  }, [latestReviewRecommendationSignal, recommendationSolutionItems]);

  const continuationShelfItems = useMemo<ContinuationShelfItem[]>(() => {
    const recentTemplateItems = curatedTaskTemplates
      .filter(
        (template) =>
          template.isRecent && typeof template.recentUsedAt === "number",
      )
      .map((template) => {
        const launchPrefill = resolveCuratedTaskTemplateLaunchPrefill(template);
        return {
          key: `solution-${template.id}`,
          title: template.title,
          summary: [
            buildCuratedTaskRecentUsageDescription({
              task: template,
              prefill: launchPrefill,
            }),
            buildCuratedTaskCapabilityDescription(template, {
              includeSummary: false,
              includeResultDestination: true,
              includeFollowUpActions: true,
              followUpLimit: 1,
            }),
          ]
            .filter((segment) => segment.length > 0)
            .join(" · "),
          usedAt: template.recentUsedAt as number,
          testId: `entry-continuation-solution-${template.id}`,
          onSelect: () =>
            handleCuratedTaskLauncherRequest(
              template,
              launchPrefill?.inputValues ?? null,
              launchPrefill?.referenceMemoryIds ??
                effectiveDefaultCuratedTaskReferenceMemoryIds,
              launchPrefill?.referenceEntries ??
                effectiveDefaultCuratedTaskReferenceEntries,
              launchPrefill?.hint ?? null,
            ),
        };
      });

    const recentInstalledSkillItems = skillSelection.skills
      .map((skill) => {
        const usage = recentInstalledSkillUsageBySkillKey.get(skill.key);
        const usedAt = usage?.usedAt ?? 0;

        if (usedAt <= 0) {
          return null;
        }

        return {
          key: `installed-skill-${skill.key}`,
          title: skill.name,
          summary: [
            usage?.replayText
              ? `上次目标：${truncatePrompt(usage.replayText, 56)}`
              : "",
            buildInstalledSkillCapabilityDescription(skill),
          ]
            .filter((segment) => segment.length > 0)
            .join(" · "),
          usedAt,
          testId: `entry-continuation-method-${skill.key}`,
          onSelect: () => {
            handleSelectInputCapability({
              kind: "installed_skill",
              skill,
            });
            if (usage?.replayText) {
              setInput(usage.replayText);
            }
          },
        };
      })
      .filter((item): item is ContinuationShelfItem => item !== null);

    const recentServiceSkillItems =
      typeof onSelectServiceSkill === "function"
        ? (serviceSkills ?? [])
            .map((skill) => {
              const recentPrefill = resolveServiceSkillLaunchPrefill({
                skill,
              });
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
                summary: [
                  buildServiceSkillLaunchPrefillSummary({
                    skill,
                    slotValues: recentPrefill?.slotValues,
                    launchUserInput: recentPrefill?.launchUserInput,
                  }),
                  buildServiceSkillCapabilityDescription(skill, {
                    includeSummary: false,
                  }),
                ]
                  .filter((segment) => segment.length > 0)
                  .join(" · "),
                usedAt,
                testId: `entry-continuation-method-${skill.id}`,
                onSelect: () =>
                  handleSelectInputCapability({
                    kind: "service_skill",
                    skill,
                  }),
              };
            })
            .filter((item): item is ContinuationShelfItem => item !== null)
        : [];

    return [
      ...recentTemplateItems,
      ...recentInstalledSkillItems,
      ...recentServiceSkillItems,
    ]
      .sort(compareRecentShelfItems)
      .slice(0, 4);
  }, [
    curatedTaskTemplates,
    effectiveDefaultCuratedTaskReferenceEntries,
    effectiveDefaultCuratedTaskReferenceMemoryIds,
    handleCuratedTaskLauncherRequest,
    handleSelectInputCapability,
    onSelectServiceSkill,
    recentInstalledSkillUsageBySkillKey,
    recentSceneUsageBySceneKey,
    serviceSkills,
    setInput,
    skillSelection.skills,
  ]);

  const directMethodItems = useMemo(() => {
    return recommendationServiceSkillItems.slice(0, 3).map((item) => ({
      key: item.key,
      title: item.title,
      summary: item.meta,
      badge: item.badge,
      testId: item.testId,
      onSelect: item.onSelect,
    }));
  }, [recommendationServiceSkillItems]);

  const preferredLaunchDeckTab = useMemo<LaunchDeckTab>(() => {
    if (leadRecommendationItem) {
      return "recommended";
    }
    if (continuationShelfItems.length > 0) {
      return "continuation";
    }
    if (directMethodItems.length > 0) {
      return "methods";
    }
    return "recommended";
  }, [
    continuationShelfItems.length,
    directMethodItems.length,
    leadRecommendationItem,
  ]);

  const [launchDeckTab, setLaunchDeckTab] = useState<LaunchDeckTab>(
    preferredLaunchDeckTab,
  );

  useEffect(() => {
    const availableTabs = new Set<LaunchDeckTab>();
    if (leadRecommendationItem || alternativeRecommendationItems.length > 0) {
      availableTabs.add("recommended");
    }
    if (continuationShelfItems.length > 0) {
      availableTabs.add("continuation");
    }
    if (directMethodItems.length > 0) {
      availableTabs.add("methods");
    }

    if (availableTabs.size === 0 || availableTabs.has(launchDeckTab)) {
      return;
    }

    setLaunchDeckTab(preferredLaunchDeckTab);
  }, [
    alternativeRecommendationItems.length,
    continuationShelfItems.length,
    directMethodItems.length,
    launchDeckTab,
    leadRecommendationItem,
    preferredLaunchDeckTab,
  ]);

  const launchDeckTabCaption = resolveLaunchDeckTabCaption(launchDeckTab);

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
                  effectiveDefaultCuratedTaskReferenceMemoryIds,
                activeCuratedTaskReferenceEntries ||
                  effectiveDefaultCuratedTaskReferenceEntries,
              )
          : undefined
      }
      onApplyCuratedTaskReviewSuggestion={
        activeCuratedTask
          ? (task) =>
              handleCuratedTaskLauncherRequest(
                task,
                activeCuratedTaskLaunchInputValues,
                activeCuratedTaskReferenceMemoryIds ||
                  effectiveDefaultCuratedTaskReferenceMemoryIds,
                activeCuratedTaskReferenceEntries ||
                  effectiveDefaultCuratedTaskReferenceEntries,
                "已按最近判断切到更适合的结果模板，你可以继续改后再进入生成。",
              )
          : undefined
      }
      creationReplaySurface={creationReplaySurface}
      projectId={projectId}
      sessionId={sessionId}
      defaultCuratedTaskReferenceMemoryIds={
        effectiveDefaultCuratedTaskReferenceMemoryIds
      }
      defaultCuratedTaskReferenceEntries={
        effectiveDefaultCuratedTaskReferenceEntries
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
            {resolveResultShelfTitle(creationReplaySurface)}
          </RecommendationShelfHeaderTitle>
          <RecommendationShelfHeaderDescription>
            {resolveResultShelfDescription(creationReplaySurface)}
          </RecommendationShelfHeaderDescription>
        </RecommendationShelfHeaderBody>
        {selectedTextPreview ? (
          <RecommendationShelfInlineBadge
            as="span"
            className="max-w-full truncate"
          >
            当前会带上选中内容
          </RecommendationShelfInlineBadge>
        ) : null}
      </RecommendationShelfHeader>

      {creationReplaySurface ? (
        <CreationReplaySurfaceBanner surface={creationReplaySurface} />
      ) : null}

      {reviewFeedbackBanner ? (
        <RecommendationSignalBanner data-testid="entry-review-feedback-banner">
          <RecommendationSignalBannerHeader>
            <RecommendationSignalBannerTitle>
              最近判断已更新：{reviewFeedbackBanner.title}
            </RecommendationSignalBannerTitle>
          </RecommendationSignalBannerHeader>
          <RecommendationSignalBannerSummary>
            {reviewFeedbackBanner.summary}
          </RecommendationSignalBannerSummary>
          <RecommendationSignalBannerFootnote>
            更适合继续：{reviewFeedbackBanner.nextSteps}
          </RecommendationSignalBannerFootnote>
          {reviewFeedbackBanner.actionLabel && reviewFeedbackBanner.onAction ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-full border-[color:var(--lime-surface-border-strong)] bg-[color:var(--lime-surface)] px-3 text-xs font-medium text-[color:var(--lime-text)] hover:border-[color:var(--lime-surface-border-strong)] hover:bg-[color:var(--lime-brand-soft)]"
                data-testid="entry-review-feedback-banner-action"
                onClick={() => reviewFeedbackBanner.onAction?.()}
              >
                {reviewFeedbackBanner.actionLabel}
              </Button>
            </div>
          ) : null}
        </RecommendationSignalBanner>
      ) : null}

      <RecommendationTabsRow>
        <RecommendationTabsRail role="tablist" aria-label="首页起手入口">
          {(leadRecommendationItem ||
            alternativeRecommendationItems.length > 0) && (
            <RecommendationTabButton
              type="button"
              role="tab"
              aria-selected={launchDeckTab === "recommended"}
              data-testid="entry-launch-tab-recommended"
              $active={launchDeckTab === "recommended"}
              onClick={() => setLaunchDeckTab("recommended")}
            >
              先开始这一轮
              <RecommendationTabCount $active={launchDeckTab === "recommended"}>
                {recommendationSolutionItems.length}
              </RecommendationTabCount>
            </RecommendationTabButton>
          )}

          {continuationShelfItems.length > 0 ? (
            <RecommendationTabButton
              type="button"
              role="tab"
              aria-selected={launchDeckTab === "continuation"}
              data-testid="entry-launch-tab-continuation"
              $active={launchDeckTab === "continuation"}
              onClick={() => setLaunchDeckTab("continuation")}
            >
              继续这轮
              <RecommendationTabCount
                $active={launchDeckTab === "continuation"}
              >
                {continuationShelfItems.length}
              </RecommendationTabCount>
            </RecommendationTabButton>
          ) : null}

          {directMethodItems.length > 0 ? (
            <RecommendationTabButton
              type="button"
              role="tab"
              aria-selected={launchDeckTab === "methods"}
              data-testid="entry-launch-tab-methods"
              $active={launchDeckTab === "methods"}
              onClick={() => setLaunchDeckTab("methods")}
            >
              直接开工
              <RecommendationTabCount $active={launchDeckTab === "methods"}>
                {directMethodItems.length}
              </RecommendationTabCount>
            </RecommendationTabButton>
          ) : null}
        </RecommendationTabsRail>

        <RecommendationTabCaption>
          {launchDeckTabCaption}
        </RecommendationTabCaption>
      </RecommendationTabsRow>

      <RecommendationPanels>
        <RecommendationTabPanel hidden={launchDeckTab !== "recommended"}>
          {leadRecommendationItem ? (
            <RecommendationLeadCard
              type="button"
              data-testid={leadRecommendationItem.testId}
              title={[
                leadRecommendationItem.summary,
                leadRecommendationItem.meta,
              ]
                .filter((segment) => segment.trim().length > 0)
                .join(" · ")}
              onClick={() => {
                leadRecommendationItem.onSelect();
              }}
            >
              <RecommendationLeadEyebrowRow>
                <RecommendationLeadEyebrow>
                  {resolveLeadRecommendationEyebrow(creationReplaySurface)}
                </RecommendationLeadEyebrow>
                {leadRecommendationItem.badge ? (
                  <RecommendationShelfInlineBadge>
                    {leadRecommendationItem.badge}
                  </RecommendationShelfInlineBadge>
                ) : null}
              </RecommendationLeadEyebrowRow>
              <RecommendationLeadTitle>
                {leadRecommendationItem.title}
              </RecommendationLeadTitle>
              <RecommendationLeadSummary>
                {leadRecommendationItem.summary}
              </RecommendationLeadSummary>
              {leadRecommendationItem.contextSummary ? (
                <RecommendationLeadMeta>
                  {leadRecommendationItem.contextSummary}
                </RecommendationLeadMeta>
              ) : null}
              <RecommendationLeadMeta>
                {leadRecommendationItem.meta}
              </RecommendationLeadMeta>
              <RecommendationLeadFooter>
                开始这一轮
                <ArrowRight className="h-3.5 w-3.5" />
              </RecommendationLeadFooter>
            </RecommendationLeadCard>
          ) : (
            <RecommendationShelfEmptyState>
              先描述目标，Lime 会帮你把这一轮组织起来。
            </RecommendationShelfEmptyState>
          )}

          {alternativeRecommendationItems.length > 0 ? (
            <RecommendationAssistGroup>
              <RecommendationAssistLabel>
                其他起手结果
              </RecommendationAssistLabel>
              <RecommendationAssistList>
                {alternativeRecommendationItems.map((item) => (
                  <RecommendationAssistCard
                    key={item.key}
                    type="button"
                    data-testid={item.testId}
                    title={[item.summary, item.meta]
                      .filter((segment) => segment.trim().length > 0)
                      .join(" · ")}
                    onClick={() => {
                      item.onSelect();
                    }}
                  >
                    <RecommendationAssistCardHeader>
                      <RecommendationAssistCardTitle>
                        {item.title}
                      </RecommendationAssistCardTitle>
                      {item.badge ? (
                        <RecommendationShelfInlineBadge>
                          {item.badge}
                        </RecommendationShelfInlineBadge>
                      ) : null}
                    </RecommendationAssistCardHeader>
                    <RecommendationAssistCardSummary>
                      {item.contextSummary
                        ? `${item.contextSummary} · ${item.meta}`
                        : item.meta}
                    </RecommendationAssistCardSummary>
                  </RecommendationAssistCard>
                ))}
              </RecommendationAssistList>
            </RecommendationAssistGroup>
          ) : null}
        </RecommendationTabPanel>

        <RecommendationTabPanel hidden={launchDeckTab !== "continuation"}>
          <RecommendationAssistGroup>
            <RecommendationAssistLabel>继续上次做法</RecommendationAssistLabel>
            {continuationShelfItems.length > 0 ? (
              <RecommendationAssistList>
                {continuationShelfItems.map((item) => (
                  <RecommendationAssistCard
                    key={item.key}
                    type="button"
                    data-testid={item.testId}
                    title={item.summary}
                    onClick={() => {
                      item.onSelect();
                    }}
                  >
                    <RecommendationAssistCardHeader>
                      <RecommendationAssistCardTitle>
                        {item.title}
                      </RecommendationAssistCardTitle>
                      {item.badge ? (
                        <RecommendationShelfBadge>
                          {item.badge}
                        </RecommendationShelfBadge>
                      ) : null}
                    </RecommendationAssistCardHeader>
                    <RecommendationAssistCardSummary>
                      {item.summary}
                    </RecommendationAssistCardSummary>
                  </RecommendationAssistCard>
                ))}
              </RecommendationAssistList>
            ) : (
              <RecommendationShelfEmptyState>
                最近跑通过的结果模板和方法会留在这里。
              </RecommendationShelfEmptyState>
            )}
          </RecommendationAssistGroup>
        </RecommendationTabPanel>

        <RecommendationTabPanel hidden={launchDeckTab !== "methods"}>
          <RecommendationAssistGroup>
            <RecommendationAssistLabel>
              也可以直接按做法开工
            </RecommendationAssistLabel>
            {directMethodItems.length > 0 ? (
              <RecommendationAssistList>
                {directMethodItems.map((item) => (
                  <RecommendationAssistCard
                    key={item.key}
                    type="button"
                    data-testid={item.testId}
                    title={item.summary}
                    onClick={() => {
                      item.onSelect();
                    }}
                  >
                    <RecommendationAssistCardHeader>
                      <RecommendationAssistCardTitle>
                        {item.title}
                      </RecommendationAssistCardTitle>
                      {item.badge ? (
                        <RecommendationShelfBadge>
                          {item.badge}
                        </RecommendationShelfBadge>
                      ) : null}
                    </RecommendationAssistCardHeader>
                    <RecommendationAssistCardSummary>
                      {item.summary}
                    </RecommendationAssistCardSummary>
                  </RecommendationAssistCard>
                ))}
              </RecommendationAssistList>
            ) : (
              <RecommendationShelfEmptyState>
                当前还没有可直接复用的做法，先选一个结果起手也可以。
              </RecommendationShelfEmptyState>
            )}
          </RecommendationAssistGroup>
        </RecommendationTabPanel>
      </RecommendationPanels>

      <RecommendationAssistFootnote data-testid="entry-result-destination-hint">
        {projectId
          ? "本轮产出会沉淀到当前项目，后续继续也会优先从这里接回。"
          : "本轮产出会先写回当前任务，后续继续也会优先从这里接回。"}
      </RecommendationAssistFootnote>
    </RecommendationShelf>
  );

  const hasRecentSessionContinuation = Boolean(
    recentSessionTitle && onResumeRecentSession,
  );
  const shouldShowContinuationSupplemental =
    shouldShowSceneAppsPanel ||
    hasRecentSessionContinuation ||
    Boolean(onOpenSceneAppsDirectory);
  const shouldShowSupplementalPanel =
    shouldShowContinuationSupplemental || Boolean(onLaunchBrowserAssist);
  const recentSessionLinkLabel = useMemo(() => {
    const normalizedTitle = truncatePrompt(recentSessionTitle || "", 18);
    if (!normalizedTitle) {
      return recentSessionActionLabel;
    }
    return `${recentSessionActionLabel} · ${normalizedTitle}`;
  }, [recentSessionActionLabel, recentSessionTitle]);
  const recentSessionLinkTitle = useMemo(
    () =>
      [recentSessionTitle, recentSessionSummary]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
        .join(" · "),
    [recentSessionSummary, recentSessionTitle],
  );

  const supplementalSceneAppItems = useMemo(
    () => featuredSceneApps.slice(0, 2),
    [featuredSceneApps],
  );

  const generalSupplementalPanel = shouldShowSupplementalPanel ? (
    <RecommendationSupplementalPanel data-testid="entry-supplemental-panel">
      <RecommendationSupplementalLabel>
        {shouldShowContinuationSupplemental
          ? "也可以直接续上这一轮。"
          : "需要网页登录时，也可以先把浏览器接上。"}
      </RecommendationSupplementalLabel>
      <RecommendationSupplementalRow>
        {recentSessionTitle && onResumeRecentSession ? (
          <RecommendationSupplementalLink
            type="button"
            data-testid="entry-recent-session-resume"
            title={recentSessionLinkTitle || undefined}
            onClick={onResumeRecentSession}
          >
            {recentSessionLinkLabel}
          </RecommendationSupplementalLink>
        ) : null}

        {canResumeRecentSceneApp && onResumeRecentSceneApp ? (
          <RecommendationSupplementalLink
            type="button"
            data-testid="entry-sceneapp-resume"
            onClick={onResumeRecentSceneApp}
          >
            继续最近做法
          </RecommendationSupplementalLink>
        ) : null}

        <EmptyStateSceneAppsPanel
          items={supplementalSceneAppItems}
          loading={sceneAppsLoading}
          launchingSceneAppId={sceneAppLaunchingId}
          onLaunchSceneApp={onLaunchSceneApp}
        />

        {onOpenSceneAppsDirectory ? (
          <RecommendationSupplementalLink
            type="button"
            data-testid="entry-sceneapps-directory"
            onClick={onOpenSceneAppsDirectory}
          >
            查看全部做法
          </RecommendationSupplementalLink>
        ) : null}

        {onLaunchBrowserAssist ? (
          <RecommendationSupplementalLink
            type="button"
            data-testid="entry-connect-browser"
            onClick={() => {
              void onLaunchBrowserAssist();
            }}
          >
            {browserAssistLoading ? "浏览器连接准备中" : "连接浏览器"}
          </RecommendationSupplementalLink>
        ) : null}
      </RecommendationSupplementalRow>
    </RecommendationSupplementalPanel>
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
          cards={[]}
          prioritySlot={composerPanel}
          supportingSlot={
            isGeneralTheme ? (
              <>
                {generalResultShelfPanel}
                {generalSupplementalPanel}
              </>
            ) : (
              defaultQuickActionsPanel
            )
          }
        />
      </ContentWrapper>
      <CuratedTaskLauncherDialog
        open={Boolean(curatedTaskLauncherTask)}
        task={curatedTaskLauncherTask}
        projectId={projectId}
        sessionId={sessionId}
        initialInputValues={curatedTaskLauncherInitialInputValues}
        initialReferenceMemoryIds={curatedTaskLauncherInitialReferenceMemoryIds}
        initialReferenceEntries={curatedTaskLauncherInitialReferenceEntries}
        prefillHint={curatedTaskLauncherPrefillHint}
        onOpenChange={handleCuratedTaskLauncherOpenChange}
        onApplyReviewSuggestion={handleApplyLauncherReviewSuggestion}
        onConfirm={handleApplyCuratedTaskTemplate}
      />
    </PageContainer>
  );
};
