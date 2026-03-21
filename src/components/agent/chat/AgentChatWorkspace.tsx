/**
 * AI Agent 聊天页面
 *
 * 包含聊天区域和侧边栏（任务列表）
 * 支持内容创作模式下的布局过渡和步骤引导
 * 当主题为 general 时，使用 GeneralChat 组件实现
 */

import {
  startTransition,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  memo,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import styled from "styled-components";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  type LucideIcon,
  PanelLeftOpen,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { safeListen } from "@/lib/dev-bridge";
import { readFilePreview } from "@/lib/api/fileBrowser";
import {
  openPathWithDefaultApp,
  revealPathInFinder,
} from "@/lib/api/fileSystem";
import {
  uploadImageToSession,
  importDocument,
  resolveFilePath as resolveSessionFilePath,
} from "@/lib/api/session-files";
import {
  useAgentChatUnified,
  useArtifactAutoPreviewSync,
  useCompatSubagentRuntime,
  useTeamWorkspaceRuntime,
  useThemeContextWorkspace,
  useTopicBranchBoard,
} from "./hooks";
import {
  buildLiveTaskSnapshot,
  type TaskStatusReason,
} from "./hooks/agentChatShared";
import {
  settleLiveArtifactAfterStreamStops,
  useArtifactDisplayState,
} from "./hooks/useArtifactDisplayState";
import type { SidebarActivityLog } from "./hooks/useThemeContextWorkspace";
import type { TopicBranchStatus } from "./hooks/useTopicBranchBoard";
import { useSessionFiles } from "./hooks/useSessionFiles";
import { useContentSync, type SyncStatus } from "./hooks/useContentSync";
import { getDefaultGuidePromptByTheme } from "./utils/defaultGuidePrompt";
import { useTrayModelShortcuts } from "./hooks/useTrayModelShortcuts";
import {
  isTeamWorkspaceTerminalStatus,
  resolveTeamWorkspaceRuntimeStatusLabel,
  summarizeTeamWorkspaceExecution,
  type TeamWorkspaceControlSummary,
  type TeamWorkspaceWaitSummary,
} from "./teamWorkspaceRuntime";
import { notifyProjectRuntimeAgentsGuide } from "@/components/workspace/services/runtimeAgentsGuideService";
import { ChatNavbar } from "./components/ChatNavbar";
import { ChatSidebar } from "./components/ChatSidebar";
import { ThemeWorkbenchSidebar } from "./components/ThemeWorkbenchSidebar";
import type { ThemeWorkbenchCreationTaskEvent } from "./components/themeWorkbenchWorkflowData";
import { AgentRuntimeStrip } from "./components/AgentRuntimeStrip";
import { HarnessStatusPanel } from "./components/HarnessStatusPanel";
import { SocialMediaHarnessCard } from "./components/SocialMediaHarnessCard";
import { TeamWorkspaceDock } from "./components/TeamWorkspaceDock";
import { TeamWorkspaceBoard } from "./components/TeamWorkspaceBoard";
import { TeamWorkbenchSummaryPanel } from "./components/TeamWorkbenchSummaryPanel";
import { ThemeWorkbenchEntryPromptAccessory } from "./components/ThemeWorkbenchEntryPromptAccessory";
import { MessageList } from "./components/MessageList";
import { Inputbar } from "./components/Inputbar";
import { RuntimeStyleControlBar } from "./components/RuntimeStyleControlBar";
import { EmptyState } from "./components/EmptyState";
import {
  CanvasWorkbenchLayout,
  type CanvasWorkbenchDefaultPreview,
  type CanvasWorkbenchLayoutMode,
  type CanvasWorkbenchPreviewTarget,
} from "./components/CanvasWorkbenchLayout";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { CreationMode } from "./components/types";
import { type TaskFile } from "./components/TaskFiles";
import { LayoutTransition } from "@/components/content-creator/core/LayoutTransition/LayoutTransition";
import { StepProgress } from "@/components/content-creator/core/StepGuide/StepProgress";
import { useWorkflow } from "@/components/content-creator/hooks/useWorkflow";
import { CanvasFactory } from "@/components/content-creator/canvas/CanvasFactory";
import {
  createInitialCanvasState,
  type CanvasStateUnion,
} from "@/components/content-creator/canvas/canvasUtils";
import { createInitialDocumentState } from "@/components/content-creator/canvas/document";
import {
  COVER_IMAGE_REPLACED_EVENT,
  type CoverImageReplacedDetail,
} from "@/components/content-creator/canvas/document/platforms/CoverImagePlaceholder";
import type {
  AutoContinueRunPayload,
  ContentReviewRunPayload,
  DocumentVersion,
  TextStylizeRunPayload,
} from "@/components/content-creator/canvas/document/types";
import { parseAIResponse } from "@/components/content-creator/a2ui/parser";
import {
  buildActionRequestA2UI,
  buildActionRequestSubmissionPayload,
  isActionRequestA2UICompatible,
  summarizeActionRequestSubmission,
} from "./utils/actionRequestA2UI";
import {
  buildLegacyQuestionnaireSubmissionPayload,
  buildLegacyQuestionnaireA2UI,
} from "./utils/legacyQuestionnaireA2UI";
import { CanvasPanel as GeneralCanvasPanel } from "@/components/general-chat/bridge";
import {
  type CanvasState as GeneralCanvasState,
  DEFAULT_CANVAS_STATE,
} from "@/components/general-chat/bridge";
import {
  artifactsAtom,
  selectedArtifactAtom,
  selectedArtifactIdAtom,
} from "@/lib/artifact/store";
import {
  ArtifactCanvasOverlay,
  ArtifactRenderer,
  ArtifactToolbar,
} from "@/components/artifact";
import type { Artifact } from "@/lib/artifact/types";
import { useAtomValue, useSetAtom } from "jotai";
import { createInitialMusicState } from "@/components/content-creator/canvas/music/types";
import {
  createInitialNovelState,
  countWords as countNovelWords,
} from "@/components/content-creator/canvas/novel/types";
import { parseLyrics } from "@/components/content-creator/canvas/music/utils/lyricsParser";
import {
  generateContentCreationPrompt,
  isContentCreationTheme,
} from "@/components/content-creator/utils/systemPrompt";
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import { generateProjectMemoryPrompt } from "@/components/content-creator/utils/projectPrompt";
import { resolveSocialMediaArtifactDescriptor } from "@/components/content-creator/utils/socialMediaHarness";
import {
  getProject,
  getDefaultProject,
  getOrCreateDefaultProject,
  getContent,
  getThemeWorkbenchDocumentState,
  ensureWorkspaceReady,
  updateProject as updateProjectById,
  updateContent,
  type Project,
  type ProjectType,
  type ThemeWorkbenchDocumentState,
} from "@/lib/api/project";
import {
  getProjectMemory,
  type ProjectMemory,
  type Character,
} from "@/lib/api/memory";
import { logAgentDebug } from "@/lib/agentDebug";
import { browserExecuteAction, launchBrowserSession } from "@/lib/webview-api";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import { loadConfiguredProviders } from "@/hooks/useConfiguredProviders";
import {
  executionRunGet,
  executionRunGetThemeWorkbenchState,
  executionRunListThemeWorkbenchHistory,
  type AgentRun,
  type ThemeWorkbenchRunTodoItem,
  type ThemeWorkbenchRunTerminalItem,
  type ThemeWorkbenchRunState as BackendThemeWorkbenchRunState,
} from "@/lib/api/executionRun";
import {
  contentWorkflowApi,
} from "@/lib/api/content-workflow";
import { setActiveContentTarget } from "@/lib/activeContentTarget";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import { listMaterials, uploadMaterial } from "@/lib/api/materials";
import { setStoredResourceProjectId } from "@/lib/resourceProjectSelection";
import { resolveProviderModelCompatibility } from "./utils/providerModelCompatibility";
import { loadProviderModels } from "@/hooks/useProviderModels";
import {
  isReasoningModel,
  resolveBaseModelOnThinkingOff,
  resolveThinkingModel,
} from "@/lib/model/thinkingModelResolver";
import { resolveVisionModel } from "@/lib/model/visionModelResolver";
import {
  loadRememberedBaseModel,
  saveRememberedBaseModel,
} from "@/lib/model/thinkingBaseModelMemory";
import type {
  AgentRuntimeToolInventory,
  AsterSubagentSessionInfo,
  AutoContinueRequestPayload,
} from "@/lib/api/agentRuntime";
import {
  closeAgentRuntimeSubagent,
  getAgentRuntimeToolInventory,
  resumeAgentRuntimeSubagent,
  sendAgentRuntimeSubagentInput,
  waitAgentRuntimeSubagents,
} from "@/lib/api/agentRuntime";
import type { ToolCallState } from "@/lib/api/agentStream";
import {
  skillExecutionApi,
  type SkillDetailInfo,
} from "@/lib/api/skill-execution";

import type {
  BrowserAssistSessionState,
  Message,
  MessageImage,
  WriteArtifactContext,
} from "./types";
import type {
  ThemeType,
  LayoutMode,
  StepStatus,
} from "@/components/content-creator/types";
import type { A2UIFormData } from "@/components/content-creator/a2ui/types";
import { getFileToStepMap } from "./utils/workflowMapping";
import { normalizeProjectId } from "./utils/topicProjectResolution";
import {
  buildGeneralChatResourceDescription,
  buildGeneralChatResourceHash,
  buildGeneralChatResourceTags,
  extractGeneralChatResourceHash,
  inferGeneralChatResourceMaterialType,
} from "./utils/generalResourceSync";
import {
  extractStyleActionContent,
  resolveStyleActionFileName,
} from "./utils/styleRuntime";
import { resolveTopicSwitchProject } from "./utils/topicProjectSwitch";
import {
  saveChatToolPreferences,
} from "./utils/chatToolPreferences";
import {
  buildHarnessRequestMetadata,
  extractExistingHarnessMetadata,
} from "./utils/harnessRequestMetadata";
import { isTeamRuntimeRecommendation } from "./utils/contextualRecommendations";
import { deriveHarnessSessionState } from "./utils/harnessState";
import {
  buildArtifactFromWrite,
  mergeArtifacts,
  resolveDefaultArtifactViewMode,
} from "./utils/messageArtifacts";
import {
  buildRealSubagentTimelineItems,
  buildSyntheticSubagentTimelineItems,
} from "./utils/subagentTimeline";
import { resolveThemeWorkbenchLayoutBottomSpacing } from "./utils/themeWorkbenchLayout";
import {
  resolveCanvasTaskFileTarget,
  shouldDeferCanvasSyncWhileEditing,
} from "./utils/taskFileCanvasSync";
import { parseSkillSlashCommand } from "./hooks/skillCommand";
import {
  buildGeneralAgentSystemPrompt,
  resolveAgentChatMode,
} from "./utils/generalAgentPrompt";
import { loadPersistedProjectId } from "./hooks/agentProjectStorage";
import { useSelectedTeamPreference } from "./hooks/useSelectedTeamPreference";
import { useThemeScopedChatToolPreferences } from "./hooks/useThemeScopedChatToolPreferences";
import { useLimeSkills } from "./hooks/useLimeSkills";
import { useWorkspaceProjectSelection } from "./hooks/useWorkspaceProjectSelection";
import {
  useBootstrapDispatchPreview,
} from "./hooks/useBootstrapDispatchPreview";
import {
  shouldPrepareRuntimeTeamBeforeSend,
  useRuntimeTeamFormation,
} from "./hooks/useRuntimeTeamFormation";
import { useThemeWorkbenchEntryPrompt } from "./hooks/useThemeWorkbenchEntryPrompt";
import { useThemeWorkbenchEntryPromptActions } from "./hooks/useThemeWorkbenchEntryPromptActions";
import {
  useThemeWorkbenchSendBoundary,
} from "./hooks/useThemeWorkbenchSendBoundary";
import type {
  BrowserTaskPreflight,
  HandleSendOptions,
} from "./hooks/handleSendTypes";
import {
  areBrowserAssistSessionStatesEqual,
  clearBrowserAssistSessionState,
  createBrowserAssistSessionState,
  extractBrowserAssistSessionFromArtifact,
  findLatestBrowserAssistSessionInMessages,
  loadBrowserAssistSessionState,
  mergeBrowserAssistSessionStates,
  resolveBrowserAssistSessionScopeKey,
  saveBrowserAssistSessionState,
} from "./utils/browserAssistSession";
import {
  extractExplicitUrlFromText,
  resolveBrowserAssistLaunchUrl,
} from "./utils/browserAssistIntent";
import { preheatBrowserAssistInBackground } from "./utils/browserAssistPreheat";
import { mergeThreadItems } from "./utils/threadTimelineView";
import { subscribeDocumentEditorFocus } from "@/lib/documentEditorFocusEvents";
import {
  DEFAULT_STYLE_PROFILE,
  buildRuntimeStyleOverridePrompt,
  buildStyleAuditPrompt,
  buildStyleRewritePrompt,
  getStyleProfileFromGuide,
  type RuntimeStyleSelection,
} from "@/lib/style-guide";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import { collectConversationSkillNames } from "./utils/harnessSkills";

const SUPPORTED_ENTRY_THEMES: ThemeType[] = [
  "general",
  "social-media",
  "poster",
  "music",
  "knowledge",
  "planning",
  "document",
  "video",
  "novel",
];

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";
const GENERAL_BROWSER_ASSIST_ARTIFACT_ID = "browser-assist:general";

function isResumableBrowserTaskReason(
  statusReason?: TaskStatusReason,
): boolean {
  return (
    statusReason === "browser_launching" ||
    statusReason === "browser_awaiting_user" ||
    statusReason === "browser_failed"
  );
}

interface HarnessFilePreviewResult {
  path: string;
  content: string | null;
  isBinary: boolean;
  size: number;
  error: string | null;
}

function extractFileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || path;
}

function normalizeInitialTheme(value?: string): ThemeType {
  if (!value) return "general";
  if (SUPPORTED_ENTRY_THEMES.includes(value as ThemeType)) {
    return value as ThemeType;
  }
  return "general";
}

function shouldPreserveGeneralArtifact(artifact: Artifact): boolean {
  return artifact.meta.persistOutsideMessages === true;
}

function deriveCurrentSessionRuntimeStatus(params: {
  isSending: boolean;
  queuedTurnCount: number;
  turns: Array<{ status: string }>;
}): AsterSubagentSessionInfo["runtime_status"] | undefined {
  if (
    params.isSending ||
    params.turns.some((turn) => turn.status === "running")
  ) {
    return "running";
  }
  if (params.queuedTurnCount > 0) {
    return "queued";
  }

  const latestStatus = params.turns[params.turns.length - 1]?.status;
  switch (latestStatus) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    default:
      return undefined;
  }
}

function deriveLatestTurnRuntimeStatus(
  turns: Array<{ status: string }>,
): AsterSubagentSessionInfo["runtime_status"] | undefined {
  switch (turns[turns.length - 1]?.status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "aborted":
      return "aborted";
    default:
      return undefined;
  }
}

function normalizeUniqueSessionIds(ids: string[]): string[] {
  return Array.from(
    new Set(ids.map((sessionId) => sessionId.trim()).filter(Boolean)),
  );
}

function buildTeamControlSummary(params: {
  action: TeamWorkspaceControlSummary["action"];
  requestedSessionIds: string[];
  cascadeSessionIds?: string[];
  affectedSessionIds?: string[];
}): TeamWorkspaceControlSummary {
  return {
    action: params.action,
    requestedSessionIds: normalizeUniqueSessionIds(params.requestedSessionIds),
    cascadeSessionIds: normalizeUniqueSessionIds(
      params.cascadeSessionIds ?? [],
    ),
    affectedSessionIds: normalizeUniqueSessionIds(
      params.affectedSessionIds ?? [],
    ),
    updatedAt: Date.now(),
  };
}

function buildBrowserAssistArtifact(params: {
  scopeKey: string;
  profileKey: string;
  browserSessionId: string;
  url: string;
  title?: string;
  targetId?: string;
  transportKind?: string;
  lifecycleState?: string;
  controlMode?: string;
}): Artifact {
  const now = Date.now();

  return {
    id: GENERAL_BROWSER_ASSIST_ARTIFACT_ID,
    type: "browser_assist",
    title: params.title?.trim() || "浏览器协助",
    content: "",
    status: "complete",
    error: undefined,
    meta: {
      persistOutsideMessages: true,
      browserAssistScopeKey: params.scopeKey,
      profileKey: params.profileKey,
      sessionId: params.browserSessionId,
      url: params.url,
      launchState: "ready",
      launchHint: undefined,
      launchError: undefined,
      ...(params.targetId ? { targetId: params.targetId } : {}),
      ...(params.transportKind ? { transportKind: params.transportKind } : {}),
      ...(params.lifecycleState
        ? { lifecycleState: params.lifecycleState }
        : {}),
      ...(params.controlMode ? { controlMode: params.controlMode } : {}),
    },
    position: { start: 0, end: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

function buildPendingBrowserAssistArtifact(params: {
  scopeKey: string;
  profileKey: string;
  url: string;
  title?: string;
}): Artifact {
  const now = Date.now();

  return {
    id: GENERAL_BROWSER_ASSIST_ARTIFACT_ID,
    type: "browser_assist",
    title: params.title?.trim() || "浏览器协助",
    content: "",
    status: "pending",
    error: undefined,
    meta: {
      persistOutsideMessages: true,
      browserAssistScopeKey: params.scopeKey,
      profileKey: params.profileKey,
      url: params.url,
      launchState: "launching",
      launchHint:
        "正在启动 Chrome、连接调试通道并等待首帧画面，通常需要 3–8 秒。",
      launchError: undefined,
    },
    position: { start: 0, end: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

function buildFailedBrowserAssistArtifact(params: {
  scopeKey: string;
  profileKey: string;
  url: string;
  title?: string;
  error: string;
}): Artifact {
  const now = Date.now();

  return {
    id: GENERAL_BROWSER_ASSIST_ARTIFACT_ID,
    type: "browser_assist",
    title: params.title?.trim() || "浏览器协助",
    content: "",
    status: "error",
    error: params.error,
    meta: {
      persistOutsideMessages: true,
      browserAssistScopeKey: params.scopeKey,
      profileKey: params.profileKey,
      url: params.url,
      launchState: "failed",
      launchHint: undefined,
      launchError: params.error,
    },
    position: { start: 0, end: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readFirstString(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return undefined;
}

function resolveBrowserAssistArtifactScopeKey(
  artifact: Pick<Artifact, "type" | "meta"> | null | undefined,
): string | null {
  if (!artifact || artifact.type !== "browser_assist") {
    return null;
  }

  const meta = asRecord(artifact.meta);
  return (
    readFirstString(meta ? [meta] : [], [
      "browserAssistScopeKey",
      "browser_assist_scope_key",
    ]) || null
  );
}
function resolveArtifactFilePath(
  artifact: Pick<Artifact, "title" | "meta">,
): string {
  if (
    typeof artifact.meta.filePath === "string" &&
    artifact.meta.filePath.trim()
  ) {
    return artifact.meta.filePath.trim();
  }
  if (
    typeof artifact.meta.filename === "string" &&
    artifact.meta.filename.trim()
  ) {
    return artifact.meta.filename.trim();
  }
  return artifact.title;
}

function resolveAbsoluteWorkspacePath(
  workspaceRoot: string | null | undefined,
  filePath: string | null | undefined,
): string | undefined {
  const normalizedFilePath = filePath?.trim();
  if (!normalizedFilePath) {
    return undefined;
  }

  if (
    normalizedFilePath.startsWith("/") ||
    normalizedFilePath.startsWith("~/") ||
    normalizedFilePath.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(normalizedFilePath)
  ) {
    return normalizedFilePath;
  }

  const normalizedWorkspaceRoot = workspaceRoot?.trim();
  if (!normalizedWorkspaceRoot) {
    return normalizedFilePath;
  }

  return `${normalizedWorkspaceRoot.replace(/[\\/]+$/, "")}/${normalizedFilePath.replace(/^[\\/]+/, "")}`;
}

function resolvePreviousDocumentVersionContent(
  version: DocumentVersion | null | undefined,
  versions: DocumentVersion[],
): string | null {
  if (!version) {
    return null;
  }

  const parentVersionId = version.metadata?.parentVersionId?.trim();
  if (parentVersionId) {
    const parentVersion = versions.find((item) => item.id === parentVersionId);
    if (parentVersion) {
      return parentVersion.content;
    }
  }

  const currentIndex = versions.findIndex((item) => item.id === version.id);
  if (currentIndex > 0) {
    return versions[currentIndex - 1]?.content || null;
  }

  return null;
}

function wrapPreviewWithWorkbenchTrigger(
  preview: ReactNode,
  stackedWorkbenchTrigger?: ReactNode,
) {
  if (!stackedWorkbenchTrigger) {
    return preview;
  }

  return (
    <div className="relative h-full">
      {preview}
      <div className="pointer-events-none absolute bottom-4 right-4 z-20">
        <div className="pointer-events-auto">{stackedWorkbenchTrigger}</div>
      </div>
    </div>
  );
}

function mergeMessageArtifactsIntoStore(
  messageArtifacts: Artifact[],
  currentArtifacts: Artifact[],
  browserAssistScopeKey: string | null,
): Artifact[] {
  const preservedArtifacts = currentArtifacts.filter(
    (artifact) =>
      shouldPreserveGeneralArtifact(artifact) &&
      (artifact.type !== "browser_assist" ||
        resolveBrowserAssistArtifactScopeKey(artifact) ===
          browserAssistScopeKey),
  );

  if (messageArtifacts.length === 0) {
    return mergeArtifacts(preservedArtifacts);
  }

  const currentArtifactsById = new Map(
    currentArtifacts.map((artifact) => [artifact.id, artifact]),
  );

  return mergeArtifacts([
    ...messageArtifacts.map((artifact) => {
      const existing = currentArtifactsById.get(artifact.id);
      if (!existing) {
        return artifact;
      }

      const shouldReuseExistingContent =
        existing.content.length > 0 &&
        (artifact.content.length === 0 ||
          (artifact.status === "streaming" &&
            artifact.content.length < existing.content.length &&
            existing.content.startsWith(artifact.content)));

      return {
        ...existing,
        ...artifact,
        content: shouldReuseExistingContent
          ? existing.content
          : artifact.content,
        meta: {
          ...existing.meta,
          ...artifact.meta,
        },
        createdAt: Math.min(existing.createdAt, artifact.createdAt),
        updatedAt: Math.max(existing.updatedAt, artifact.updatedAt),
      };
    }),
    ...preservedArtifacts,
  ]);
}

const PageContainer = styled.div<{ $compact?: boolean }>`
  display: flex;
  height: 100%;
  width: 100%;
  position: relative;
  min-height: 0;
  gap: ${({ $compact }) => ($compact ? "8px" : "14px")};
  padding: ${({ $compact }) => ($compact ? "8px" : "14px")};
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(
      circle at 14% 18%,
      rgba(56, 189, 248, 0.1),
      transparent 30%
    ),
    radial-gradient(
      circle at 86% 14%,
      rgba(16, 185, 129, 0.08),
      transparent 28%
    ),
    radial-gradient(
      circle at 72% 84%,
      rgba(245, 158, 11, 0.06),
      transparent 24%
    ),
    linear-gradient(
      180deg,
      rgba(248, 250, 252, 0.98) 0%,
      rgba(248, 250, 252, 0.96) 42%,
      rgba(242, 251, 247, 0.94) 100%
    );

  > * {
    position: relative;
    z-index: 1;
  }
`;

const MainArea = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: ${({ $compact }) => ($compact ? "24px" : "32px")};
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.96) 0%,
    rgba(248, 250, 252, 0.94) 56%,
    rgba(248, 250, 252, 0.88) 100%
  );
  box-shadow:
    0 24px 72px -36px rgba(15, 23, 42, 0.18),
    0 16px 28px -24px rgba(15, 23, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
  backdrop-filter: blur(18px);
`;

function resolveContentSyncTone(status: SyncStatus): {
  text: string;
  background: string;
  border: string;
} {
  switch (status) {
    case "syncing":
      return {
        text: "#475569",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.92) 100%)",
        border: "rgba(226, 232, 240, 0.9)",
      };
    case "success":
      return {
        text: "#047857",
        background:
          "linear-gradient(180deg, rgba(236,253,245,0.98) 0%, rgba(220,252,231,0.92) 100%)",
        border: "rgba(167, 243, 208, 0.95)",
      };
    case "error":
      return {
        text: "#be123c",
        background:
          "linear-gradient(180deg, rgba(255,241,242,0.98) 0%, rgba(255,228,230,0.92) 100%)",
        border: "rgba(254, 205, 211, 0.95)",
      };
    case "idle":
    default:
      return {
        text: "#475569",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.9) 100%)",
        border: "rgba(226, 232, 240, 0.88)",
      };
  }
}

const ContentSyncNotice = styled.div<{ $status: SyncStatus }>`
  ${({ $status }) => {
    const tone = resolveContentSyncTone($status);
    return `
      display: flex;
      align-items: center;
      gap: 8px;
      margin: -2px 14px 10px;
      padding: 8px 12px;
      border: 1px solid ${tone.border};
      border-radius: 14px;
      background: ${tone.background};
      color: ${tone.text};
      box-shadow: 0 10px 24px hsl(var(--foreground) / 0.03);
    `;
  }}
`;

const ContentSyncNoticeText = styled.span`
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
`;

const ChatContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
`;

const ChatContainerInner = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    rgba(248, 250, 252, 0.78) 0%,
    rgba(255, 255, 255, 0.12) 18%,
    rgba(255, 255, 255, 0) 100%
  );
`;

const EntryBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 12px 0;
  padding: 10px 12px;
  border-radius: 18px;
  border: 1px solid rgba(191, 219, 254, 0.9);
  background: linear-gradient(
    180deg,
    rgba(239, 246, 255, 0.96) 0%,
    rgba(248, 250, 252, 0.92) 100%
  );
  color: #0f172a;
  font-size: 13px;
  box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.16);
`;

const EntryBannerClose = styled.button`
  margin-left: auto;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font-size: 13px;
`;

const ChatContent = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: ${({ $compact }) => ($compact ? "0 6px 6px" : "0 10px 10px")};
  overflow: hidden;
  height: 100%;
  position: relative;
`;

const MessageViewport = styled.div<{ $bottomPadding?: string }>`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding-bottom: ${({ $bottomPadding }) => $bottomPadding || "128px"};
`;

const ThemeWorkbenchInputOverlay = styled.div<{
  $hasPendingA2UIForm?: boolean;
}>`
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 20px;
  z-index: 25;
  pointer-events: none;
  display: flex;
  justify-content: center;
  box-sizing: border-box;

  > * {
    pointer-events: auto;
    width: ${({ $hasPendingA2UIForm }) =>
      $hasPendingA2UIForm
        ? "min(calc(100% - 24px), 880px)"
        : "min(calc(100% - 16px), 480px)"};
    max-width: 100%;
  }
`;

const ThemeWorkbenchLayoutShell = styled.div<{ $bottomInset: string }>`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding-bottom: ${({ $bottomInset }) => $bottomInset};
  transition: padding-bottom 0.2s ease;
`;

const ThemeWorkbenchCanvasHost = styled.div`
  flex: 1;
  min-height: 0;

  > * {
    height: 100%;
  }
`;

interface LayoutTransitionRenderGateProps {
  mode: LayoutMode;
  chatContent: ReactNode;
  canvasContent: ReactNode;
  chatPanelWidth?: string;
  chatPanelMinWidth?: string;
}

const LayoutTransitionRenderGate = memo(
  ({
    mode,
    chatContent,
    canvasContent,
    chatPanelWidth,
    chatPanelMinWidth,
  }: LayoutTransitionRenderGateProps) => (
    <ThemeWorkbenchCanvasHost>
      <LayoutTransition
        mode={mode}
        chatContent={chatContent}
        canvasContent={canvasContent}
        chatPanelChrome="plain"
        chatPanelWidth={chatPanelWidth}
        chatPanelMinWidth={chatPanelMinWidth}
      />
    </ThemeWorkbenchCanvasHost>
  ),
  (previous, next) =>
    previous.mode === next.mode &&
    previous.chatContent === next.chatContent &&
    previous.canvasContent === next.canvasContent &&
    previous.chatPanelWidth === next.chatPanelWidth &&
    previous.chatPanelMinWidth === next.chatPanelMinWidth,
);
LayoutTransitionRenderGate.displayName = "LayoutTransitionRenderGate";

const TEAM_PRIMARY_CHAT_PANEL_WIDTH = "min(100%, clamp(360px, 30%, 460px))";
const TEAM_PRIMARY_CHAT_PANEL_MIN_WIDTH = "360px";

interface RuntimeTeamDispatchPreviewSnapshot {
  key: string;
  prompt: string;
  images: MessageImage[];
  baseMessageCount: number;
  status: "forming" | "failed";
  failureMessage?: string | null;
}

function buildRuntimeTeamDispatchPreviewMessages(
  snapshot: RuntimeTeamDispatchPreviewSnapshot,
): Message[] {
  const normalizedPrompt = snapshot.prompt.trim();
  const timestamp = new Date();
  const assistantRuntimeStatus =
    snapshot.status === "failed"
      ? {
          phase: "failed" as const,
          title: "Team 调度准备失败",
          detail:
            snapshot.failureMessage?.trim() ||
            "本轮 Team 组建失败，已回退到普通对话发送。",
        }
      : {
          phase: "routing" as const,
          title: "正在组建 Team",
          detail: "系统正在根据本轮任务准备成员，并切换到 Team 画布。",
          checkpoints: ["记录本轮调度", "生成成员蓝图", "等待角色接管轨道"],
        };

  return [
    {
      id: `runtime-team-dispatch:${snapshot.key}:user`,
      role: "user",
      content: normalizedPrompt,
      images: snapshot.images.length > 0 ? snapshot.images : undefined,
      timestamp,
    },
    {
      id: `runtime-team-dispatch:${snapshot.key}:assistant`,
      role: "assistant",
      content:
        snapshot.status === "failed"
          ? "本轮 Team 调度准备失败，已回退到普通执行。"
          : "本轮已进入 Team 调度，正在组建成员…",
      timestamp: new Date(timestamp.getTime() + 1),
      isThinking: snapshot.status === "forming",
      runtimeStatus: assistantRuntimeStatus,
    },
  ];
}

const ThemeWorkbenchLeftExpandButton = styled.button`
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 78px;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 14px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.94) 0%,
    rgba(248, 250, 252, 0.9) 100%
  );
  color: #64748b;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 30;
  box-shadow: 0 14px 28px -24px rgba(15, 23, 42, 0.2);

  &:hover {
    color: #0f172a;
    border-color: rgba(148, 163, 184, 0.84);
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.98) 0%,
      rgba(241, 245, 249, 0.92) 100%
    );
  }
`;

function resolveContentSyncNotice(status: Exclude<SyncStatus, "idle">): {
  label: string;
  Icon: LucideIcon;
  animated?: boolean;
} {
  switch (status) {
    case "syncing":
      return {
        label: "正在同步到当前内容…",
        Icon: Loader2,
        animated: true,
      };
    case "success":
      return {
        label: "内容已同步",
        Icon: CheckCircle2,
      };
    case "error":
    default:
      return {
        label: "同步失败，将自动重试",
        Icon: AlertTriangle,
      };
  }
}

/**
 * 将 ProjectType 转换为 ThemeType
 * 由于类型已统一，大部分情况下直接返回即可
 */
function projectTypeToTheme(projectType: ProjectType): ThemeType {
  // ProjectType 和 ThemeType 现在是统一的
  // 系统类型 persistent/temporary 映射到 general
  if (projectType === "persistent" || projectType === "temporary") {
    return "general";
  }
  return projectType as ThemeType;
}

const TOPIC_PROJECT_KEY_PREFIX = "agent_session_workspace_";
const THEME_WORKBENCH_DOCUMENT_META_KEY = "theme_workbench_document_v1";
const MAX_PERSISTED_DOCUMENT_VERSIONS = 40;
const SOCIAL_ARTICLE_SKILL_KEY = "social_post_with_cover";
const THEME_WORKBENCH_CREATION_TASK_EVENT_NAME =
  "lime://creation_task_submitted";
const MAX_THEME_WORKBENCH_CREATION_TASK_EVENTS = 120;

interface CreationTaskSubmittedPayload {
  task_id?: string;
  task_type?: string;
  path?: string;
  absolute_path?: string;
}

function normalizeThemeWorkbenchCreationTaskEvent(
  payload: CreationTaskSubmittedPayload,
): ThemeWorkbenchCreationTaskEvent | null {
  const taskId = payload.task_id?.trim();
  const taskType = payload.task_type?.trim();
  const path = payload.path?.trim();
  if (!taskId || !taskType || !path) {
    return null;
  }
  const createdAt = Date.now();
  return {
    taskId,
    taskType,
    path,
    absolutePath: payload.absolute_path?.trim() || undefined,
    createdAt,
    timeLabel: new Date(createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}

function hasActiveBrowserAssistSession(
  sessionState: BrowserAssistSessionState | null,
): boolean {
  if (!sessionState) {
    return false;
  }

  if (!sessionState.sessionId && !sessionState.profileKey) {
    return false;
  }

  const lifecycleState = sessionState.lifecycleState?.trim().toLowerCase();
  return !["failed", "closed", "terminated"].includes(lifecycleState || "");
}

function buildBrowserPreflightMessages(
  preflight: BrowserTaskPreflight,
): Message[] {
  const timestamp = new Date(preflight.createdAt);
  const actionRequired = {
    requestId: preflight.requestId,
    actionType: "ask_user" as const,
    uiKind: "browser_preflight" as const,
    browserRequirement: preflight.requirement,
    browserPrepState: preflight.phase,
    prompt: preflight.reason,
    detail: preflight.detail,
    allowCapabilityFallback: false,
  };

  return [
    {
      id: `${preflight.requestId}:user`,
      role: "user",
      content: preflight.sourceText,
      images: preflight.images.length > 0 ? preflight.images : undefined,
      timestamp,
    },
    {
      id: `${preflight.requestId}:assistant`,
      role: "assistant",
      content: "",
      timestamp: new Date(preflight.createdAt + 1),
      actionRequests: [actionRequired],
      contentParts: [{ type: "action_required", actionRequired }],
    },
  ];
}

function isLegacyQuestionnaireSummaryMessage(message?: Message): boolean {
  return (
    message?.role === "user" && message.content.trim().startsWith("我的选择：")
  );
}

function collapseLegacyQuestionnaireMessages(messages: Message[]): Message[] {
  let mutated = false;
  const collapsedMessages = messages.map((message, index) => {
    if (message.role !== "assistant") {
      return message;
    }

    if ((message.actionRequests || []).length > 0) {
      return message;
    }

    const legacyForm = buildLegacyQuestionnaireA2UI(message.content || "");
    if (!legacyForm) {
      return message;
    }

    const nextMessage = messages[index + 1];
    const isPendingQuestionnaire = index === messages.length - 1;
    const hasSubmittedSummary =
      isLegacyQuestionnaireSummaryMessage(nextMessage);

    if (!isPendingQuestionnaire && !hasSubmittedSummary) {
      return message;
    }

    mutated = true;
    return {
      ...message,
      content: hasSubmittedSummary
        ? "补充信息表单已提交。"
        : "已整理为补充信息表单，请在输入区完成填写。",
    };
  });

  return mutated ? collapsedMessages : messages;
}

function resolveThemeWorkbenchRunStepStatus(
  status: "queued" | "running" | "success" | "error" | "canceled" | "timeout",
): StepStatus {
  if (status === "running") {
    return "active";
  }
  if (status === "queued") {
    return "pending";
  }
  if (status === "success") {
    return "completed";
  }
  return "error";
}

function parseThemeWorkbenchToolArguments(
  argumentsJson?: string,
): Record<string, unknown> {
  if (!argumentsJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsJson);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function truncateThemeWorkbenchLabel(value: string, limit = 28): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function resolveThemeWorkbenchTextArg(
  args: Record<string, unknown>,
  keys: string[],
): string {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const firstString = value.find(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      );
      if (firstString) {
        return firstString.trim();
      }
    }
  }
  return "";
}

function getThemeWorkbenchFileLabel(pathValue: string): string {
  const normalized = pathValue.trim();
  if (!normalized) {
    return "主稿文件";
  }
  const segments = normalized.split(/[/\\]/).filter(Boolean);
  if (segments.length >= 2) {
    return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  }
  return segments[0] || normalized;
}

function resolveThemeWorkbenchToolTaskTitle(toolCall: ToolCallState): string {
  const normalized = toolCall.name.trim().toLowerCase();
  const args = parseThemeWorkbenchToolArguments(toolCall.arguments);
  const queryValue = resolveThemeWorkbenchTextArg(args, [
    "query",
    "q",
    "keyword",
    "pattern",
    "text",
  ]);
  const urlValue = resolveThemeWorkbenchTextArg(args, ["url", "href"]);
  const elementValue = resolveThemeWorkbenchTextArg(args, [
    "element",
    "name",
    "label",
    "ref",
  ]);

  if (normalized.includes("social_generate_cover_image")) {
    const size = resolveThemeWorkbenchTextArg(args, ["size"]);
    return size ? `生成封面图（${size}）` : "生成封面图";
  }
  if (normalized.includes("write_file") || normalized.includes("create_file")) {
    const pathValue = resolveThemeWorkbenchTextArg(args, [
      "path",
      "file_path",
      "filePath",
    ]);
    return pathValue
      ? `写入 ${getThemeWorkbenchFileLabel(pathValue)}`
      : "写入主稿文件";
  }
  if (normalized.includes("websearch")) {
    return queryValue
      ? `检索 ${truncateThemeWorkbenchLabel(queryValue)}`
      : "检索参考资料";
  }
  if (
    normalized.includes("browser_navigate") ||
    (normalized.includes("navigate") && urlValue)
  ) {
    return urlValue
      ? `打开 ${truncateThemeWorkbenchLabel(urlValue, 36)}`
      : "打开网页";
  }
  if (normalized.includes("browser_click") || normalized === "click") {
    return elementValue
      ? `点击「${truncateThemeWorkbenchLabel(elementValue, 20)}」`
      : "点击页面元素";
  }
  if (normalized.includes("browser_hover") || normalized === "hover") {
    return elementValue
      ? `定位「${truncateThemeWorkbenchLabel(elementValue, 20)}」`
      : "定位页面元素";
  }
  if (normalized.includes("browser_type") || normalized === "type") {
    return elementValue
      ? `填写「${truncateThemeWorkbenchLabel(elementValue, 20)}」`
      : queryValue
        ? `填写 ${truncateThemeWorkbenchLabel(queryValue, 18)}`
        : "填写页面内容";
  }
  if (
    normalized.includes("browser_select_option") ||
    normalized.includes("select_option")
  ) {
    const value = resolveThemeWorkbenchTextArg(args, [
      "value",
      "values",
      "option",
    ]);
    return value
      ? `选择 ${truncateThemeWorkbenchLabel(value, 20)}`
      : elementValue
        ? `选择「${truncateThemeWorkbenchLabel(elementValue, 20)}」`
        : "选择页面选项";
  }
  if (
    normalized.includes("browser_press_key") ||
    normalized.includes("press_key")
  ) {
    const keyValue = resolveThemeWorkbenchTextArg(args, ["key"]);
    return keyValue ? `触发按键 ${keyValue}` : "触发页面快捷键";
  }
  if (normalized.includes("browser_drag") || normalized.includes("drag")) {
    const endValue = resolveThemeWorkbenchTextArg(args, [
      "endElement",
      "endRef",
    ]);
    return endValue
      ? `拖拽到「${truncateThemeWorkbenchLabel(endValue, 18)}」`
      : "拖拽页面元素";
  }
  if (
    normalized.includes("browser_snapshot") ||
    normalized.includes("screenshot")
  ) {
    return elementValue
      ? `分析页面区域：${truncateThemeWorkbenchLabel(elementValue, 20)}`
      : urlValue
        ? `分析页面 ${truncateThemeWorkbenchLabel(urlValue, 30)}`
        : "分析页面内容";
  }
  if (normalized.includes("bash") || normalized.includes("shell")) {
    const commandValue = resolveThemeWorkbenchTextArg(args, ["command", "cmd"]);
    const commandProbe = commandValue.toLowerCase();
    if (commandProbe.includes("ffmpeg")) {
      return "处理音视频素材";
    }
    if (commandProbe.includes("curl") || commandProbe.includes("wget")) {
      return "下载远程资源";
    }
    if (
      commandProbe.includes("python") ||
      commandProbe.includes("node") ||
      commandProbe.includes("tsx") ||
      commandProbe.includes("npm")
    ) {
      return "执行自动化脚本";
    }
    return commandValue
      ? `执行命令：${truncateThemeWorkbenchLabel(commandValue, 22)}`
      : "执行终端命令";
  }
  if (normalized.includes("browser")) {
    return urlValue
      ? `采集 ${truncateThemeWorkbenchLabel(urlValue, 36)}`
      : elementValue
        ? `处理页面元素：${truncateThemeWorkbenchLabel(elementValue, 20)}`
        : "采集网页信息";
  }
  return toolCall.name.replace(/[_-]+/g, " ").trim() || "执行工具";
}

function resolveThemeWorkbenchPrimaryTaskTitle(
  skillName: string,
  detail?: SkillDetailInfo | null,
): string {
  if (skillName === SOCIAL_ARTICLE_SKILL_KEY) {
    return "生成社媒主稿";
  }

  const displayName = detail?.display_name?.trim();
  if (displayName) {
    return displayName;
  }

  return skillName.replace(/[_-]+/g, " ").trim() || "执行任务";
}

function extractThemeWorkbenchWorkflowMarkerIndex(
  content: string,
): number | null {
  const matches = [...content.matchAll(/\*\*步骤\s+(\d+)\/(\d+):/g)];
  if (matches.length === 0) {
    return null;
  }
  const last = matches[matches.length - 1];
  const value = Number(last[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value - 1;
}

function findLatestThemeWorkbenchExecution(messages: Message[]): {
  assistantMessage: Message;
  skillName: string | null;
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      continue;
    }

    const hasToolCalls = (message.toolCalls?.length || 0) > 0;
    const hasPendingAction =
      message.actionRequests?.some(
        (request) => request.status !== "submitted",
      ) || false;
    if (!message.isThinking && !hasToolCalls && !hasPendingAction) {
      continue;
    }

    let skillName: string | null = null;
    for (let userIndex = index - 1; userIndex >= 0; userIndex -= 1) {
      const candidate = messages[userIndex];
      if (candidate.role !== "user") {
        continue;
      }
      skillName = parseSkillSlashCommand(candidate.content)?.skillName || null;
      break;
    }

    return {
      assistantMessage: message,
      skillName,
    };
  }

  return null;
}

function buildThemeWorkbenchLiveWorkflowSteps(
  messages: Message[],
  skillDetailMap: Record<string, SkillDetailInfo | null>,
  isSending: boolean,
): Array<{ id: string; title: string; status: StepStatus }> {
  const activeExecution = findLatestThemeWorkbenchExecution(messages);
  if (!activeExecution) {
    return [];
  }

  const { assistantMessage, skillName } = activeExecution;
  if (!skillName) {
    return [];
  }

  const skillDetail = skillDetailMap[skillName] || null;
  const workflowSteps = skillDetail?.workflow_steps || [];
  if (workflowSteps.length > 0) {
    const latestAssistantContent =
      messages
        .slice()
        .reverse()
        .find((m) => m.role === "assistant")?.content || "";
    const activeIndex =
      extractThemeWorkbenchWorkflowMarkerIndex(latestAssistantContent) ?? 0;
    return workflowSteps.map((step, index) => ({
      id: step.id,
      title: step.name,
      status:
        index < activeIndex
          ? ("completed" as StepStatus)
          : index == activeIndex
            ? ("active" as StepStatus)
            : ("pending" as StepStatus),
    }));
  }

  const toolCalls = assistantMessage.toolCalls || [];
  const steps: Array<{ id: string; title: string; status: StepStatus }> = [];
  const primaryTaskTitle = resolveThemeWorkbenchPrimaryTaskTitle(
    skillName,
    skillDetail,
  );
  const hasRunningTool = toolCalls.some(
    (toolCall) => toolCall.status === "running",
  );
  const hasFailedTool = toolCalls.some(
    (toolCall) => toolCall.status === "failed",
  );
  const hasCompletedPrimaryWrite = toolCalls.some((toolCall) => {
    if (toolCall.status !== "completed") {
      return false;
    }
    const normalizedName = toolCall.name.trim().toLowerCase();
    return (
      normalizedName.includes("write_file") ||
      normalizedName.includes("create_file")
    );
  });

  steps.push({
    id: `${skillName}:primary`,
    title: primaryTaskTitle,
    status: hasCompletedPrimaryWrite
      ? ("completed" as StepStatus)
      : hasFailedTool
        ? ("error" as StepStatus)
        : toolCalls.length > 0
          ? ("completed" as StepStatus)
          : assistantMessage.isThinking || isSending
            ? ("active" as StepStatus)
            : ("pending" as StepStatus),
  });

  toolCalls.forEach((toolCall, index) => {
    steps.push({
      id: toolCall.id || `${skillName}:tool:${index}`,
      title: resolveThemeWorkbenchToolTaskTitle(toolCall),
      status:
        toolCall.status === "running"
          ? ("active" as StepStatus)
          : toolCall.status === "completed"
            ? ("completed" as StepStatus)
            : ("error" as StepStatus),
    });
  });

  if (isSending && toolCalls.length > 0 && !hasRunningTool) {
    steps.push({
      id: `${skillName}:finalize`,
      title: "整理最终结果",
      status: "active",
    });
  }

  return steps;
}

function resolveThemeWorkbenchQueueItemTitle(
  item: ThemeWorkbenchRunTodoItem,
  skillDetailMap: Record<string, SkillDetailInfo | null>,
): string {
  const sourceRef = resolveThemeWorkbenchSkillSourceRef(item);
  if (sourceRef) {
    return resolveThemeWorkbenchPrimaryTaskTitle(
      sourceRef,
      skillDetailMap[sourceRef],
    );
  }
  return item.title?.trim() || "执行任务";
}
const THEME_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS = 45 * 1000;
const THEME_WORKBENCH_HISTORY_PAGE_SIZE = 20;

function resolveThemeWorkbenchSkillSourceRef(
  item:
    | ThemeWorkbenchRunTodoItem
    | ThemeWorkbenchRunTerminalItem
    | { source?: string | null; source_ref?: string | null },
): string | null {
  if ((item.source || "").trim() !== "skill") {
    return null;
  }
  const sourceRef = item.source_ref?.trim();
  return sourceRef || null;
}

interface PersistedThemeWorkbenchDocument {
  versions: DocumentVersion[];
  currentVersionId: string;
  versionStatusMap: Record<string, TopicBranchStatus>;
}

function isTopicBranchStatus(value: unknown): value is TopicBranchStatus {
  return (
    value === "in_progress" ||
    value === "pending" ||
    value === "merged" ||
    value === "candidate"
  );
}

function normalizeDocumentVersion(value: unknown): DocumentVersion | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const content =
    typeof candidate.content === "string" ? candidate.content : "";
  const createdAt =
    typeof candidate.createdAt === "number"
      ? candidate.createdAt
      : typeof candidate.created_at === "number"
        ? candidate.created_at
        : NaN;
  const description =
    typeof candidate.description === "string"
      ? candidate.description
      : undefined;
  const metadata =
    candidate.metadata && typeof candidate.metadata === "object"
      ? (candidate.metadata as DocumentVersion["metadata"])
      : undefined;

  if (!id || Number.isNaN(createdAt)) {
    return null;
  }

  return {
    id,
    content,
    createdAt,
    description,
    metadata,
  };
}

function buildPersistedThemeWorkbenchDocument(
  state: CanvasStateUnion,
  statusMap: Record<string, TopicBranchStatus>,
): PersistedThemeWorkbenchDocument | null {
  if (state.type !== "document" || state.versions.length === 0) {
    return null;
  }

  const normalizedVersions = state.versions
    .map((version) => normalizeDocumentVersion(version))
    .filter((version): version is DocumentVersion => !!version);

  if (normalizedVersions.length === 0) {
    return null;
  }

  const latestVersions = normalizedVersions.slice(
    -MAX_PERSISTED_DOCUMENT_VERSIONS,
  );
  const versionIdSet = new Set(latestVersions.map((version) => version.id));
  let currentVersionId = state.currentVersionId;

  if (!versionIdSet.has(currentVersionId)) {
    currentVersionId =
      latestVersions[latestVersions.length - 1]?.id || latestVersions[0].id;
  }

  const persistedVersions = latestVersions.map((version) =>
    version.id === currentVersionId ? { ...version, content: "" } : version,
  );

  const versionStatusMap = Object.fromEntries(
    Object.entries(statusMap).filter(
      ([versionId, status]) =>
        versionIdSet.has(versionId) && isTopicBranchStatus(status),
    ),
  ) as Record<string, TopicBranchStatus>;

  return {
    versions: persistedVersions,
    currentVersionId,
    versionStatusMap,
  };
}

function readPersistedThemeWorkbenchDocument(
  metadata?: Record<string, unknown>,
): PersistedThemeWorkbenchDocument | null {
  const raw = metadata?.[THEME_WORKBENCH_DOCUMENT_META_KEY];
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  const versionsRaw = Array.isArray(candidate.versions)
    ? candidate.versions
    : [];
  const versions = versionsRaw
    .map((version) => normalizeDocumentVersion(version))
    .filter((version): version is DocumentVersion => !!version)
    .slice(-MAX_PERSISTED_DOCUMENT_VERSIONS);
  if (versions.length === 0) {
    return null;
  }

  const versionIdSet = new Set(versions.map((version) => version.id));
  const currentVersionIdRaw = candidate.currentVersionId;
  const currentVersionId =
    typeof currentVersionIdRaw === "string" &&
    versionIdSet.has(currentVersionIdRaw)
      ? currentVersionIdRaw
      : versions[versions.length - 1]?.id || versions[0].id;

  const statusRaw = candidate.versionStatusMap;
  const statusEntries =
    statusRaw && typeof statusRaw === "object" ? statusRaw : {};
  const versionStatusMap = Object.fromEntries(
    Object.entries(statusEntries).filter(
      ([versionId, status]) =>
        versionIdSet.has(versionId) && isTopicBranchStatus(status),
    ),
  ) as Record<string, TopicBranchStatus>;

  return {
    versions,
    currentVersionId,
    versionStatusMap,
  };
}

function applyBackendThemeWorkbenchDocumentState(
  state: CanvasStateUnion,
  backendState: ThemeWorkbenchDocumentState,
  currentBody: string,
): {
  state: CanvasStateUnion;
  statusMap: Record<string, TopicBranchStatus>;
} | null {
  if (state.type !== "document" || backendState.versions.length === 0) {
    return null;
  }

  const versions = backendState.versions
    .map((version, index) => ({
      id: version.id,
      content: version.is_current ? currentBody : "",
      createdAt: version.created_at,
      description: version.description?.trim() || `版本 ${index + 1}`,
    }))
    .slice(-MAX_PERSISTED_DOCUMENT_VERSIONS);

  if (versions.length === 0) {
    return null;
  }

  const currentVersion =
    versions.find(
      (version) => version.id === backendState.current_version_id,
    ) || versions[versions.length - 1];

  const statusMap = Object.fromEntries(
    backendState.versions
      .filter(
        (
          version,
        ): version is ThemeWorkbenchDocumentState["versions"][number] & {
          status: TopicBranchStatus;
        } => isTopicBranchStatus(version.status),
      )
      .map((version) => [version.id, version.status]),
  ) as Record<string, TopicBranchStatus>;

  return {
    state: {
      ...state,
      versions,
      currentVersionId: currentVersion.id,
      content: currentVersion.content,
    },
    statusMap,
  };
}

function inferThemeWorkbenchGateFromQueueItem(
  queueItem: ThemeWorkbenchRunTodoItem | null,
): {
  key: "topic_select" | "write_mode" | "publish_confirm";
  title: string;
  description: string;
} {
  const gateKey = queueItem?.gate_key;
  if (gateKey === "publish_confirm") {
    return {
      key: "publish_confirm",
      title: "发布闸门",
      description: queueItem?.title || "正在准备发布前检查与平台适配结果。",
    };
  }
  if (gateKey === "topic_select") {
    return {
      key: "topic_select",
      title: "选题闸门",
      description: queueItem?.title || "正在整理选题方向并生成可确认方案。",
    };
  }
  if (gateKey === "write_mode") {
    return {
      key: "write_mode",
      title: "写作闸门",
      description: queueItem?.title || "正在执行主稿写作与插图生成流程。",
    };
  }

  if (!queueItem) {
    return {
      key: "topic_select",
      title: "选题闸门",
      description: "正在整理选题方向并生成可确认方案。",
    };
  }

  const probe =
    `${queueItem.title} ${queueItem.source_ref || ""} ${queueItem.source}`.toLowerCase();
  const looksLikePublish =
    /publish|adapt|distribution|release|发布|分发|平台适配/.test(probe);
  if (looksLikePublish) {
    return {
      key: "publish_confirm",
      title: "发布闸门",
      description: queueItem.title || "正在准备发布前检查与平台适配结果。",
    };
  }

  const looksLikeTopic = /topic|research|trend|idea|选题|方向|调研|洞察/.test(
    probe,
  );
  if (looksLikeTopic) {
    return {
      key: "topic_select",
      title: "选题闸门",
      description: queueItem.title || "正在整理选题方向并生成可确认方案。",
    };
  }

  return {
    key: "write_mode",
    title: "写作闸门",
    description: queueItem.title || "正在执行主稿写作与插图生成流程。",
  };
}

function resolveThemeWorkbenchGateByKey(
  gateKey: "topic_select" | "write_mode" | "publish_confirm",
  fallbackTitle?: string,
): {
  key: "topic_select" | "write_mode" | "publish_confirm";
  title: string;
  description: string;
} {
  if (gateKey === "publish_confirm") {
    return {
      key: "publish_confirm",
      title: "发布闸门",
      description: fallbackTitle || "正在准备发布前检查与平台适配结果。",
    };
  }
  if (gateKey === "topic_select") {
    return {
      key: "topic_select",
      title: "选题闸门",
      description: fallbackTitle || "正在整理选题方向并生成可确认方案。",
    };
  }
  return {
    key: "write_mode",
    title: "写作闸门",
    description: fallbackTitle || "正在执行主稿写作与插图生成流程。",
  };
}

function formatThemeWorkbenchRunTimeLabel(
  raw: string | null | undefined,
): string {
  if (!raw) {
    return "--:--";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "--:--";
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatThemeWorkbenchRunDurationLabel(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): string | undefined {
  if (!startedAt || !finishedAt) {
    return undefined;
  }

  const started = new Date(startedAt);
  const finished = new Date(finishedAt);
  if (Number.isNaN(started.getTime()) || Number.isNaN(finished.getTime())) {
    return undefined;
  }

  const durationMs = finished.getTime() - started.getTime();
  if (durationMs < 0) {
    return undefined;
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(durationMs / 60000)}m${Math.round(
    (durationMs % 60000) / 1000,
  )}s`;
}

function resolveThemeWorkbenchApplyTargetByGateKey(
  gateKey: "topic_select" | "write_mode" | "publish_confirm" | "idle",
): string {
  if (gateKey === "topic_select") {
    return "选题池";
  }
  if (gateKey === "publish_confirm") {
    return "发布产物";
  }
  if (gateKey === "write_mode") {
    return "版本主稿";
  }
  return "主稿内容";
}

function extractExecutionIdFromSocialToolId(toolCallId: string): string | null {
  const normalized = toolCallId.trim();
  if (!normalized.startsWith("social-write-")) {
    return null;
  }
  const match = normalized.match(/^social-write-(.+)-[0-9a-f]{8}$/i);
  const executionId = match?.[1]?.trim();
  if (!executionId) {
    return null;
  }
  return executionId;
}

function resolveExecutionIdCandidatesForActivityLog(
  log: SidebarActivityLog,
): string[] {
  const candidates: string[] = [];
  const pushCandidate = (value?: string | null) => {
    const normalized = value?.trim();
    if (!normalized) {
      return;
    }
    if (!candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  pushCandidate(log.executionId);
  pushCandidate(log.messageId);

  const normalizedLogId = log.id.trim();
  if (normalizedLogId) {
    let toolCallIdProbe = normalizedLogId;
    if (log.messageId) {
      const messagePrefix = `${log.messageId}-`;
      if (normalizedLogId.startsWith(messagePrefix)) {
        toolCallIdProbe = normalizedLogId.slice(messagePrefix.length);
      }
    }
    pushCandidate(extractExecutionIdFromSocialToolId(toolCallIdProbe));
  }

  return candidates;
}

function isThemeWorkbenchPrimaryDocumentArtifact(fileName: string): boolean {
  const normalized = fileName.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized.endsWith(".md") || normalized.endsWith(".markdown");
}

function inferTaskFileType(fileName: string): TaskFile["type"] {
  const normalized = fileName.trim().toLowerCase();
  const extension = normalized.split(".").pop() || "";

  if (extension === "md" || extension === "markdown" || extension === "txt") {
    return "document";
  }
  if (
    ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"].includes(
      extension,
    )
  ) {
    return "image";
  }
  if (
    ["mp3", "wav", "aac", "flac", "m4a", "ogg", "mid", "midi"].includes(
      extension,
    )
  ) {
    return "audio";
  }
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(extension)) {
    return "video";
  }
  return "other";
}

function looksLikeSocialPublishPayload(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return (
      typeof parsed.article_path === "string" ||
      typeof parsed.cover_meta_path === "string" ||
      Array.isArray(parsed.pipeline) ||
      Array.isArray(parsed.recommended_channels)
    );
  } catch {
    return false;
  }
}

function looksLikeThemeWorkbenchErrorPayload(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.startsWith("ran into this error:") ||
    normalized.startsWith("request failed:") ||
    normalized.includes(
      "please retry if you think this is a transient or recoverable error.",
    ) ||
    normalized.includes("api key not valid")
  );
}

function isCorruptedThemeWorkbenchDocumentContent(
  content?: string | null,
): boolean {
  if (typeof content !== "string") {
    return false;
  }

  return (
    looksLikeSocialPublishPayload(content) ||
    looksLikeThemeWorkbenchErrorPayload(content)
  );
}

function resolveTaskFileType(
  fileName: string,
  content?: string | null,
): TaskFile["type"] {
  const inferredType = inferTaskFileType(fileName);
  if (
    inferredType === "document" &&
    isCorruptedThemeWorkbenchDocumentContent(content)
  ) {
    return "other";
  }
  return inferredType;
}

function normalizeSessionTaskFileType(
  fileType: string,
  fileName: string,
  content?: string | null,
): TaskFile["type"] {
  const normalized = fileType.trim().toLowerCase();
  if (
    normalized === "document" ||
    normalized === "image" ||
    normalized === "audio" ||
    normalized === "video" ||
    normalized === "other"
  ) {
    const resolvedByContent = resolveTaskFileType(fileName, content);
    if (normalized === "document" && resolvedByContent !== "document") {
      return resolvedByContent;
    }
    return normalized;
  }
  return resolveTaskFileType(fileName, content);
}

function isRenderableTaskFile(
  file: Pick<TaskFile, "name" | "type">,
  isThemeWorkbench: boolean,
): boolean {
  if (file.type !== "document") {
    return false;
  }
  if (!isThemeWorkbench) {
    return true;
  }
  return isThemeWorkbenchPrimaryDocumentArtifact(file.name);
}

function buildThemeWorkbenchWorkflowSteps(
  messages: Message[],
  backendRunState: BackendThemeWorkbenchRunState | null,
  isSending: boolean,
  skillDetailMap: Record<string, SkillDetailInfo | null>,
): Array<{ id: string; title: string; status: StepStatus }> {
  const liveSteps = buildThemeWorkbenchLiveWorkflowSteps(
    messages,
    skillDetailMap,
    isSending,
  );
  if (liveSteps.length > 0) {
    return liveSteps;
  }

  const queueItems = backendRunState?.queue_items || [];
  if (queueItems.length > 0) {
    if (queueItems.length === 1) {
      const item = queueItems[0];
      const sourceRef = resolveThemeWorkbenchSkillSourceRef(item);
      const workflowSteps = sourceRef
        ? skillDetailMap[sourceRef]?.workflow_steps || []
        : [];
      if (workflowSteps.length > 0) {
        const latestAssistantContent =
          messages
            .slice()
            .reverse()
            .find((m) => m.role === "assistant")?.content || "";
        const activeIndex =
          extractThemeWorkbenchWorkflowMarkerIndex(latestAssistantContent) ?? 0;
        return workflowSteps.map((step, index) => ({
          id: `${item.run_id}-${step.id}`,
          title: step.name,
          status:
            index < activeIndex
              ? ("completed" as StepStatus)
              : index === activeIndex
                ? ("active" as StepStatus)
                : ("pending" as StepStatus),
        }));
      }
    }
    return queueItems.map((item) => ({
      id: item.run_id,
      title: resolveThemeWorkbenchQueueItemTitle(item, skillDetailMap),
      status: resolveThemeWorkbenchRunStepStatus(item.status),
    }));
  }

  const latestTerminal = backendRunState?.latest_terminal;
  if (latestTerminal && backendRunState?.run_state !== "auto_running") {
    return [
      {
        id: latestTerminal.run_id,
        title: resolveThemeWorkbenchQueueItemTitle(
          latestTerminal,
          skillDetailMap,
        ),
        status: resolveThemeWorkbenchRunStepStatus(latestTerminal.status),
      },
    ];
  }

  return [];
}

function loadPersistedBoolean(key: string, fallback = false): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(stored);
      return typeof parsed === "boolean" ? parsed : fallback;
    } catch {
      return stored === "true";
    }
  } catch {
    return fallback;
  }
}

function savePersistedBoolean(key: string, value: boolean) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore write errors
  }
}

export interface WorkflowProgressSnapshot {
  steps: Array<{
    id: string;
    title: string;
    status: StepStatus;
  }>;
  currentIndex: number;
}

export interface AgentChatWorkspaceProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  contentId?: string;
  agentEntry?: "new-task" | "claw";
  immersiveHome?: boolean;
  theme?: string;
  initialCreationMode?: CreationMode;
  lockTheme?: boolean;
  fromResources?: boolean;
  hideHistoryToggle?: boolean;
  showChatPanel?: boolean;
  hideTopBar?: boolean;
  topBarChrome?: "full" | "workspace-compact";
  onBackToProjectManagement?: () => void;
  hideInlineStepProgress?: boolean;
  onWorkflowProgressChange?: (
    snapshot: WorkflowProgressSnapshot | null,
  ) => void;
  initialUserPrompt?: string;
  initialUserImages?: MessageImage[];
  initialSessionName?: string;
  entryBannerMessage?: string;
  onInitialUserPromptConsumed?: () => void;
  newChatAt?: number;
  onRecommendationClick?: (shortLabel: string, fullPrompt: string) => void;
  onHasMessagesChange?: (hasMessages: boolean) => void;
  onSessionChange?: (sessionId: string | null) => void;
  preferContentReviewInRightRail?: boolean;
  openBrowserAssistOnMount?: boolean;
}

/**
 * 判断画布状态是否为空
 * 用于决定是否自动触发 AI 引导
 */
const HARNESS_PANEL_VISIBILITY_KEY = "lime.chat.harness-panel.visible.v1";

function isCanvasStateEmpty(state: CanvasStateUnion | null): boolean {
  if (!state) return true;

  switch (state.type) {
    case "document":
      // 文档画布：检查 content 是否为空
      return !state.content || state.content.trim() === "";
    case "novel":
      // 小说画布：检查第一章内容是否为空
      return (
        state.chapters.length === 0 ||
        !state.chapters[0].content ||
        state.chapters[0].content.trim() === ""
      );
    case "script":
      // 剧本画布：检查场景是否有实际内容
      return (
        state.scenes.length === 0 ||
        (state.scenes.length === 1 &&
          state.scenes[0].dialogues.length === 0 &&
          !state.scenes[0].description)
      );
    case "music":
      // 音乐画布：检查 sections 是否为空
      return !state.sections || state.sections.length === 0;
    case "poster":
      // 海报画布：检查页面中是否有图层
      return (
        state.pages.length === 0 ||
        (state.pages.length === 1 && state.pages[0].layers.length === 0)
      );
    default:
      return true;
  }
}

function serializeCanvasStateForSync(state: CanvasStateUnion): string {
  switch (state.type) {
    case "document":
      return state.content || "";
    case "novel":
      return JSON.stringify(state.chapters);
    case "script":
      return JSON.stringify(state.scenes);
    case "music":
      return JSON.stringify(state.sections);
    case "poster":
      return JSON.stringify(state.pages);
    default:
      return JSON.stringify(state);
  }
}

function isSyncContentEmpty(content: string): boolean {
  return !content || content === "[]" || content === "{}";
}

function resolveThemeWorkbenchRecentTerminals(
  state: BackendThemeWorkbenchRunState | null,
): ThemeWorkbenchRunTerminalItem[] {
  if (!state) {
    return [];
  }

  const rawTerminals =
    Array.isArray(state.recent_terminals) && state.recent_terminals.length > 0
      ? state.recent_terminals
      : state.latest_terminal
        ? [state.latest_terminal]
        : [];

  const seenRunIds = new Set<string>();
  return rawTerminals.filter((item) => {
    const runId = item.run_id?.trim();
    if (!runId || seenRunIds.has(runId)) {
      return false;
    }
    seenRunIds.add(runId);
    return true;
  });
}

function mergeThemeWorkbenchTerminalItems(
  ...groups: ThemeWorkbenchRunTerminalItem[][]
): ThemeWorkbenchRunTerminalItem[] {
  const merged: ThemeWorkbenchRunTerminalItem[] = [];
  const seenRunIds = new Set<string>();

  groups.forEach((items) => {
    items.forEach((item) => {
      const runId = item.run_id?.trim();
      if (!runId || seenRunIds.has(runId)) {
        return;
      }
      seenRunIds.add(runId);
      merged.push(item);
    });
  });

  return merged;
}

function buildThemeWorkbenchRunStateSignature(
  state: BackendThemeWorkbenchRunState | null,
): string {
  if (!state) {
    return "null";
  }

  const queueSignature = (state.queue_items || [])
    .map((item) =>
      [
        item.run_id,
        item.execution_id || "",
        item.status,
        item.gate_key || "",
        item.source || "",
        item.source_ref || "",
      ].join(":"),
    )
    .join("|");

  const terminalSignature = resolveThemeWorkbenchRecentTerminals(state)
    .map((item) =>
      [
        item.run_id,
        item.execution_id || "",
        item.status,
        item.gate_key || "",
        item.source || "",
        item.source_ref || "",
      ].join(":"),
    )
    .join("|");

  return [
    state.run_state,
    state.current_gate_key || "",
    queueSignature,
    terminalSignature,
  ].join("||");
}

export function AgentChatWorkspace({
  onNavigate: _onNavigate,
  projectId: externalProjectId,
  contentId,
  agentEntry = "claw",
  theme: initialTheme,
  initialCreationMode,
  lockTheme = false,
  fromResources = false,
  hideHistoryToggle = false,
  showChatPanel = true,
  hideTopBar = false,
  topBarChrome = "full",
  onBackToProjectManagement,
  hideInlineStepProgress = false,
  onWorkflowProgressChange,
  initialUserPrompt,
  initialUserImages,
  initialSessionName,
  entryBannerMessage,
  onInitialUserPromptConsumed,
  newChatAt,
  onRecommendationClick: _onRecommendationClick,
  onHasMessagesChange,
  onSessionChange,
  preferContentReviewInRightRail = false,
  openBrowserAssistOnMount = false,
}: AgentChatWorkspaceProps) {
  const normalizedEntryTheme = normalizeInitialTheme(initialTheme);
  const shouldAutoCollapseClassicClawSidebar =
    agentEntry === "claw" && !lockTheme && normalizedEntryTheme === "general";
  const defaultTopicSidebarVisible =
    showChatPanel && !shouldAutoCollapseClassicClawSidebar;
  const [showSidebar, setShowSidebar] = useState(
    () => defaultTopicSidebarVisible,
  );
  const [themeWorkbenchSidebarCollapsed, setThemeWorkbenchSidebarCollapsed] =
    useState(false);
  const [input, setInput] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [entryBannerVisible, setEntryBannerVisible] = useState(
    Boolean(entryBannerMessage),
  );
  const shouldBootstrapCanvasOnEntry =
    Boolean(contentId) && isContentCreationTheme(normalizedEntryTheme);

  // 内容创作相关状态
  const [activeTheme, setActiveTheme] = useState<string>(normalizedEntryTheme);
  const [creationMode, setCreationMode] = useState<CreationMode>(
    initialCreationMode ?? "guided",
  );
  const { chatToolPreferences, setChatToolPreferences } =
    useThemeScopedChatToolPreferences(activeTheme);
  const {
    projectId,
    shouldDisableSessionRestore,
    hasHandledNewChatRequest,
    markNewChatRequestHandled,
    rememberProjectId,
    getRememberedProjectId,
    applyProjectSelection,
    resetProjectSelection,
    clearProjectSelectionRuntime,
    startTopicProjectResolution,
    finishTopicProjectResolution,
    deferTopicSwitch,
    consumePendingTopicSwitch,
  } = useWorkspaceProjectSelection({
    externalProjectId,
    newChatAt,
  });
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    shouldBootstrapCanvasOnEntry ? "canvas" : "chat",
  );
  const [isInitialContentLoading, setIsInitialContentLoading] = useState(
    shouldBootstrapCanvasOnEntry,
  );
  const [initialContentLoadError, setInitialContentLoadError] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!initialTheme) return;
    setActiveTheme(normalizeInitialTheme(initialTheme));
  }, [initialTheme]);

  useEffect(() => {
    if (!initialCreationMode) return;
    setCreationMode(initialCreationMode);
  }, [initialCreationMode]);

  useEffect(() => {
    setEntryBannerVisible(Boolean(entryBannerMessage));
  }, [entryBannerMessage]);

  const openBrowserAssistOnMountHandledRef = useRef(false);
  const pageMountedAtRef = useRef(Date.now());

  useEffect(() => {
    const mountedAt = pageMountedAtRef.current;
    logAgentDebug("AgentChatPage", "mount", {
      agentEntry,
      contentId: contentId ?? null,
      externalProjectId: externalProjectId ?? null,
      initialCreationMode: initialCreationMode ?? null,
      initialTheme: initialTheme ?? null,
      lockTheme,
    });

    return () => {
      logAgentDebug(
        "AgentChatPage",
        "unmount",
        {
          contentId: contentId ?? null,
          externalProjectId: externalProjectId ?? null,
          lifetimeMs: Date.now() - mountedAt,
        },
        { consoleOnly: true },
      );
    };
  }, [
    agentEntry,
    contentId,
    externalProjectId,
    initialCreationMode,
    initialTheme,
    lockTheme,
  ]);

  // 画布状态（支持多种画布类型）
  const [canvasState, setCanvasState] = useState<CanvasStateUnion | null>(
    () => {
      if (!shouldBootstrapCanvasOnEntry) {
        return null;
      }

      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    },
  );
  const [documentVersionStatusMap, setDocumentVersionStatusMap] = useState<
    Record<string, TopicBranchStatus>
  >({});
  const contentMetadataRef = useRef<Record<string, unknown>>({});
  const persistedWorkbenchSnapshotRef = useRef("");
  const lastCanvasSyncRequestRef = useRef<{
    contentId: string;
    body: string;
  } | null>(null);
  const themeWorkbenchRunStateSignatureRef = useRef("");
  const [novelChapterListCollapsed, setNovelChapterListCollapsed] =
    useState(false);
  const [themeWorkbenchBackendRunState, setThemeWorkbenchBackendRunState] =
    useState<BackendThemeWorkbenchRunState | null>(null);
  const [themeWorkbenchHistoryTerminals, setThemeWorkbenchHistoryTerminals] =
    useState<ThemeWorkbenchRunTerminalItem[]>([]);
  const [themeWorkbenchHistoryHasMore, setThemeWorkbenchHistoryHasMore] =
    useState(false);
  const [themeWorkbenchHistoryNextOffset, setThemeWorkbenchHistoryNextOffset] =
    useState<number | null>(null);
  const [themeWorkbenchHistoryLoading, setThemeWorkbenchHistoryLoading] =
    useState(false);
  const [themeWorkbenchSkillDetailMap, setThemeWorkbenchSkillDetailMap] =
    useState<Record<string, SkillDetailInfo | null>>({});
  const [selectedThemeWorkbenchRunId, setSelectedThemeWorkbenchRunId] =
    useState<string | null>(null);
  const themeWorkbenchHistoryLoadingRef = useRef(false);
  const [selectedThemeWorkbenchRunDetail, setSelectedThemeWorkbenchRunDetail] =
    useState<AgentRun | null>(null);
  const [themeWorkbenchRunDetailLoading, setThemeWorkbenchRunDetailLoading] =
    useState(false);
  const [
    themeWorkbenchCreationTaskEvents,
    setThemeWorkbenchCreationTaskEvents,
  ] = useState<ThemeWorkbenchCreationTaskEvent[]>([]);
  const documentEditorFocusedRef = useRef(false);
  const {
    selectedTeam,
    setSelectedTeam: handleSelectTeam,
    enableSuggestedTeam: handleEnableSuggestedTeam,
    preferredTeamPresetId,
    selectedTeamLabel,
    selectedTeamSummary,
  } = useSelectedTeamPreference(activeTheme);

  useEffect(() => {
    setActiveContentTarget(projectId, contentId, canvasState?.type ?? null);
  }, [canvasState?.type, contentId, projectId]);

  useEffect(() => {
    persistedWorkbenchSnapshotRef.current = "";
    contentMetadataRef.current = {};
    lastCanvasSyncRequestRef.current = null;
    if (!contentId) {
      setDocumentVersionStatusMap({});
    }
  }, [contentId]);

  // General 主题专用画布状态
  const [generalCanvasState, setGeneralCanvasState] =
    useState<GeneralCanvasState>(DEFAULT_CANVAS_STATE);

  // 任务文件状态
  const [taskFiles, setTaskFiles] = useState<TaskFile[]>([]);
  const [taskFilesExpanded, setTaskFilesExpanded] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const taskFilesRef = useRef<TaskFile[]>([]);
  const socialStageLogRef = useRef<Record<string, string>>({});
  const generalResourceHashesRef = useRef<Map<string, Set<string>>>(new Map());
  const generalResourceSyncInFlightRef = useRef<Set<string>>(new Set());

  // 项目上下文状态
  const [project, setProject] = useState<Project | null>(null);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(
    null,
  );
  const [runtimeStyleSelection, setRuntimeStyleSelection] =
    useState<RuntimeStyleSelection>({
      presetId: "project-default",
      strength: DEFAULT_STYLE_PROFILE.simulationStrength,
      customNotes: "",
      source: "project-default",
      sourceLabel: undefined,
      sourceProfile: null,
    });

  useEffect(() => {
    taskFilesRef.current = taskFiles;
  }, [taskFiles]);

  useEffect(() => {
    setRuntimeStyleSelection((previous) => {
      if (
        previous.presetId !== "project-default" ||
        previous.customNotes.trim()
      ) {
        return previous;
      }

      const nextStrength =
        getStyleProfileFromGuide(projectMemory?.style_guide)
          ?.simulationStrength || DEFAULT_STYLE_PROFILE.simulationStrength;

      return previous.strength === nextStrength
        ? previous
        : {
            ...previous,
            strength: nextStrength,
          };
    });
  }, [projectMemory?.style_guide]);

  // 主动 workspace 健康检查失败标记（区别于 workspacePathMissing 发送失败场景）
  const [workspaceHealthError, setWorkspaceHealthError] = useState(false);

  // 引用的角色列表（用于注入到消息中）
  const [mentionedCharacters, setMentionedCharacters] = useState<Character[]>(
    [],
  );

  // 技能列表（用于 @ 引用）
  const {
    skills,
    skillsLoading,
    refreshSkills: loadSkills,
  } = useLimeSkills({
    autoLoad: "immediate",
    logScope: "AgentChatPage",
    onError: (error) => {
      console.warn("[AgentChatPage] 加载 skills 失败:", error);
    },
  });

  // Workbench Store（用于主题工作台右侧面板状态同步）
  const pendingSkillKey = useWorkbenchStore((state) => state.pendingSkillKey);
  const clearThemeSkillsRailState = useWorkbenchStore(
    (state) => state.clearThemeSkillsRailState,
  );
  const consumePendingSkill = useWorkbenchStore(
    (state) => state.consumePendingSkill,
  );

  // 用于追踪已处理的消息 ID，避免重复处理
  const processedMessageIds = useRef<Set<string>>(new Set());
  // 文件写入回调 ref（用于传递给统一聊天主链 Hook）
  const handleWriteFileRef =
    useRef<
      (
        content: string,
        fileName: string,
        context?: WriteArtifactContext,
      ) => void
    >();

  // 工作流状态（仅在内容创作模式下使用）
  const mappedTheme = activeTheme as ThemeType;

  useEffect(() => {
    setRuntimeStyleSelection({
      presetId: "project-default",
      strength: DEFAULT_STYLE_PROFILE.simulationStrength,
      customNotes: "",
    });
  }, [mappedTheme, projectId]);
  const { steps, currentStepIndex, goToStep, completeStep } = useWorkflow(
    mappedTheme,
    creationMode,
  );

  // 内容同步 Hook
  const { syncContent, syncStatus } = useContentSync({
    debounceMs: 2000,
    autoRetry: true,
    retryDelayMs: 5000,
  });

  // 判断是否为内容创作模式
  const isContentCreationMode = isContentCreationTheme(activeTheme);

  // Artifact 状态 - 用于在画布中显示
  const artifacts = useAtomValue(artifactsAtom);
  const selectedArtifact = useAtomValue(selectedArtifactAtom);
  const setArtifacts = useSetAtom(artifactsAtom);
  const setSelectedArtifactId = useSetAtom(selectedArtifactIdAtom);
  const liveArtifact = useMemo(
    () =>
      selectedArtifact ||
      (artifacts.length > 0 ? artifacts[artifacts.length - 1] : null),
    [artifacts, selectedArtifact],
  );

  // Artifact 预览状态
  const [artifactViewMode, setArtifactViewMode] = useState<
    "source" | "preview"
  >("source");
  const [artifactPreviewSize, setArtifactPreviewSize] = useState<
    "mobile" | "tablet" | "desktop"
  >("desktop");
  const [canvasWorkbenchLayoutMode, setCanvasWorkbenchLayoutMode] =
    useState<CanvasWorkbenchLayoutMode>("split");
  const [browserAssistLaunching, setBrowserAssistLaunching] = useState(false);
  const [browserAssistSessionState, setBrowserAssistSessionState] =
    useState<BrowserAssistSessionState | null>(null);
  const [browserTaskPreflight, setBrowserTaskPreflight] =
    useState<BrowserTaskPreflight | null>(null);
  const autoOpenedBrowserAssistSessionIdRef = useRef<string>("");
  const autoLaunchingBrowserAssistKeyRef = useRef<string>("");
  const browserAssistLaunchRequestIdRef = useRef(0);
  const browserTaskPreflightLaunchIdRef = useRef("");
  const autoCollapsedTopicSidebarRef = useRef(false);
  const browserAssistAutoOpenDismissedScopeRef = useRef<string | null>(null);
  const browserAssistScopeTrackerRef = useRef<string | null>(null);

  // 当有新的 artifact 时，自动打开画布
  useEffect(() => {
    if (activeTheme !== "general") return;
    if (artifacts.length === 0) return;
    const hasNonBrowserAssistArtifact = artifacts.some(
      (artifact) => artifact.type !== "browser_assist",
    );
    const hasBoundBrowserAssistSession = Boolean(
      browserAssistSessionState?.sessionId ||
      browserAssistSessionState?.profileKey,
    );
    if (!hasNonBrowserAssistArtifact && !hasBoundBrowserAssistSession) {
      return;
    }

    if (
      !hasNonBrowserAssistArtifact &&
      browserAssistAutoOpenDismissedScopeRef.current
    ) {
      return;
    }

    // 自动打开画布显示 artifact
    setLayoutMode("chat-canvas");
  }, [
    activeTheme,
    artifacts,
    browserAssistSessionState?.profileKey,
    browserAssistSessionState?.sessionId,
  ]);

  const isBrowserAssistReady = useMemo(
    () => hasActiveBrowserAssistSession(browserAssistSessionState),
    [browserAssistSessionState],
  );
  const browserAssistEntryLabel = useMemo(() => {
    if (browserTaskPreflight?.phase === "launching" || browserAssistLaunching) {
      return "浏览器启动中";
    }
    if (
      browserTaskPreflight?.phase === "awaiting_user" ||
      browserTaskPreflight?.phase === "ready_to_resume"
    ) {
      return "等待登录";
    }
    if (browserTaskPreflight?.phase === "failed") {
      return "浏览器未连接";
    }
    if (isBrowserAssistReady) {
      return "浏览器已就绪";
    }
    return "浏览器协助";
  }, [
    browserAssistLaunching,
    browserTaskPreflight?.phase,
    isBrowserAssistReady,
  ]);
  const browserAssistAttentionLevel = useMemo(() => {
    if (browserTaskPreflight?.phase === "launching" || browserAssistLaunching) {
      return "info" as const;
    }

    if (
      browserTaskPreflight?.phase === "awaiting_user" ||
      browserTaskPreflight?.phase === "ready_to_resume" ||
      browserTaskPreflight?.phase === "failed"
    ) {
      return "warning" as const;
    }

    return "idle" as const;
  }, [browserAssistLaunching, browserTaskPreflight?.phase]);

  const openBrowserAssistCanvas = useCallback(
    (artifactId = GENERAL_BROWSER_ASSIST_ARTIFACT_ID) => {
      browserAssistAutoOpenDismissedScopeRef.current = null;
      setSelectedArtifactId(artifactId);
      setLayoutMode("chat-canvas");
    },
    [setSelectedArtifactId],
  );

  const autoOpenBrowserAssistCanvas = useCallback(
    (artifactId = GENERAL_BROWSER_ASSIST_ARTIFACT_ID) => {
      if (
        activeTheme === "general" &&
        browserAssistAutoOpenDismissedScopeRef.current
      ) {
        return false;
      }

      setSelectedArtifactId(artifactId);
      setLayoutMode("chat-canvas");
      return true;
    },
    [activeTheme, setSelectedArtifactId],
  );

  const suppressBrowserAssistCanvasAutoOpen = useCallback(() => {
    if (activeTheme !== "general") {
      return;
    }

    browserAssistAutoOpenDismissedScopeRef.current = "__dismissed__";
  }, [activeTheme]);

  useEffect(() => {
    if (activeTheme === "general") {
      return;
    }
    setBrowserTaskPreflight(null);
  }, [activeTheme]);

  // 跳转到设置页安装技能
  const handleNavigateToSkillSettings = useCallback(() => {
    _onNavigate?.("settings", { tab: SettingsTabs.Skills });
  }, [_onNavigate]);

  const handleRefreshSkills = useCallback(async () => {
    await loadSkills(true);
  }, [loadSkills]);

  // 加载项目、Memory 和内容
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      const startedAt = Date.now();
      logAgentDebug("AgentChatPage", "loadData.start", {
        contentId: contentId ?? null,
        lockTheme,
        projectId: projectId ?? null,
      });

      if (contentId) {
        setIsInitialContentLoading(true);
        setInitialContentLoadError(null);
      } else {
        setIsInitialContentLoading(false);
        setInitialContentLoadError(null);
      }

      if (!projectId) {
        if (cancelled) {
          return;
        }
        logAgentDebug("AgentChatPage", "loadData.noProject", {
          contentId: contentId ?? null,
          durationMs: Date.now() - startedAt,
        });
        setProject(null);
        setProjectMemory(null);
        setIsInitialContentLoading(false);
        return;
      }

      try {
        const p = await getProject(projectId);
        if (!p) {
          if (cancelled) {
            return;
          }
          logAgentDebug(
            "AgentChatPage",
            "loadData.projectMissing",
            {
              contentId: contentId ?? null,
              durationMs: Date.now() - startedAt,
              projectId,
            },
            { level: "warn" },
          );
          setProject(null);
          setProjectMemory(null);
          if (contentId) {
            setInitialContentLoadError("当前项目不存在或已被删除");
          }
          return;
        }

        if (cancelled) {
          return;
        }

        setProject(p);
        const theme = projectTypeToTheme(p.workspaceType);
        logAgentDebug("AgentChatPage", "loadData.projectLoaded", {
          durationMs: Date.now() - startedAt,
          projectId: p.id,
          theme,
          workspaceType: p.workspaceType,
        });
        if (!lockTheme || !initialTheme) {
          setActiveTheme(theme);
        }

        const memory = await getProjectMemory(projectId);
        if (cancelled) {
          return;
        }
        setProjectMemory(memory);
        logAgentDebug("AgentChatPage", "loadData.memoryLoaded", {
          charactersCount: memory?.characters?.length ?? 0,
          durationMs: Date.now() - startedAt,
          hasOutline: Boolean(memory?.outline?.length),
          hasStyleGuide: Boolean(memory?.style_guide),
          projectId,
        });

        if (!contentId) {
          logAgentDebug("AgentChatPage", "loadData.projectOnlyComplete", {
            durationMs: Date.now() - startedAt,
            projectId,
          });
          return;
        }

        const content = await getContent(contentId);
        if (cancelled) {
          return;
        }

        if (!content) {
          logAgentDebug(
            "AgentChatPage",
            "loadData.contentMissing",
            {
              contentId,
              durationMs: Date.now() - startedAt,
              projectId,
            },
            { level: "warn" },
          );
          setInitialContentLoadError("文稿不存在或读取失败");
          return;
        }

        logAgentDebug("AgentChatPage", "loadData.contentLoaded", {
          bodyLength: content.body?.length ?? 0,
          contentId: content.id,
          durationMs: Date.now() - startedAt,
          projectId,
        });

        contentMetadataRef.current = content.metadata || {};
        const canvasTheme = (
          lockTheme && initialTheme
            ? normalizeInitialTheme(initialTheme)
            : theme
        ) as ThemeType;
        const rawBody = content.body || "";
        const sanitizedBody = isCorruptedThemeWorkbenchDocumentContent(rawBody)
          ? ""
          : rawBody;

        if (rawBody && sanitizedBody !== rawBody) {
          setInitialContentLoadError(
            "当前文稿未生成有效主稿，请重新生成或稍后重试",
          );
        } else {
          setInitialContentLoadError(null);
        }

        let initialState =
          createInitialCanvasState(canvasTheme, sanitizedBody) ||
          createInitialDocumentState(sanitizedBody);

        if (initialState.type === "document") {
          const backendDocumentState = await getThemeWorkbenchDocumentState(
            content.id,
          ).catch((error) => {
            console.warn(
              "[AgentChatPage] 读取主题工作台版本状态失败，降级为 metadata 解析:",
              error,
            );
            logAgentDebug(
              "AgentChatPage",
              "loadData.documentStateError",
              {
                contentId: content.id,
                durationMs: Date.now() - startedAt,
                error,
              },
              { level: "warn" },
            );
            return null;
          });
          logAgentDebug("AgentChatPage", "loadData.documentStateLoaded", {
            contentId: content.id,
            durationMs: Date.now() - startedAt,
            hasBackendDocumentState: Boolean(backendDocumentState),
          });
          const backendApplied = backendDocumentState
            ? applyBackendThemeWorkbenchDocumentState(
                initialState,
                backendDocumentState,
                sanitizedBody,
              )
            : null;

          if (backendApplied) {
            initialState = backendApplied.state;
            setDocumentVersionStatusMap(backendApplied.statusMap);
          } else {
            const persisted = readPersistedThemeWorkbenchDocument(
              content.metadata,
            );
            if (persisted) {
              const restoredVersions = persisted.versions.map((version) =>
                version.id === persisted.currentVersionId
                  ? { ...version, content: sanitizedBody || version.content }
                  : version,
              );
              const currentVersion =
                restoredVersions.find(
                  (version) => version.id === persisted.currentVersionId,
                ) || restoredVersions[restoredVersions.length - 1];
              initialState = {
                ...initialState,
                versions: restoredVersions,
                currentVersionId: currentVersion.id,
                content: currentVersion.content,
              };
              setDocumentVersionStatusMap(persisted.versionStatusMap);
            } else {
              setDocumentVersionStatusMap({});
            }
          }
        } else {
          setDocumentVersionStatusMap({});
        }

        lastCanvasSyncRequestRef.current = {
          contentId: content.id,
          body: serializeCanvasStateForSync(initialState),
        };
        setCanvasState(initialState);
        setLayoutMode("canvas");
        logAgentDebug("AgentChatPage", "loadData.complete", {
          contentId: content.id,
          durationMs: Date.now() - startedAt,
          initialStateType: initialState.type,
          projectId,
        });
      } catch (error) {
        console.error("[AgentChatPage] 加载项目或文稿失败:", error);
        logAgentDebug(
          "AgentChatPage",
          "loadData.error",
          {
            contentId: contentId ?? null,
            durationMs: Date.now() - startedAt,
            error,
            projectId: projectId ?? null,
          },
          { level: "error" },
        );
        if (!cancelled && contentId) {
          setInitialContentLoadError("文稿加载失败，请稍后重试");
        }
      } finally {
        if (!cancelled) {
          setIsInitialContentLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [projectId, contentId, lockTheme, initialTheme]);

  useEffect(() => {
    if (!shouldBootstrapCanvasOnEntry) {
      return;
    }

    setLayoutMode("canvas");
    setCanvasState((previous) => {
      if (previous) {
        return previous;
      }

      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    });
  }, [normalizedEntryTheme, shouldBootstrapCanvasOnEntry]);

  // 当 projectId 变化时主动检查 workspace 目录健康状态
  // 静默修复（auto-created）或显示 banner 提示用户重新选择
  useEffect(() => {
    setWorkspaceHealthError(false);
    const normalizedId = normalizeProjectId(projectId);
    if (!normalizedId) return;

    const startedAt = Date.now();
    logAgentDebug("AgentChatPage", "workspaceCheck.start", {
      projectId: normalizedId,
    });
    ensureWorkspaceReady(normalizedId)
      .then(({ repaired, rootPath }) => {
        if (repaired) {
          recordWorkspaceRepair({
            workspaceId: normalizedId,
            rootPath,
            source: "agent_chat_page",
          });
          console.info("[AgentChatPage] workspace 目录已自动修复:", rootPath);
        }
        logAgentDebug("AgentChatPage", "workspaceCheck.success", {
          durationMs: Date.now() - startedAt,
          projectId: normalizedId,
          repaired,
          rootPath,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("[AgentChatPage] workspace 目录检查失败:", message);
        logAgentDebug(
          "AgentChatPage",
          "workspaceCheck.error",
          {
            durationMs: Date.now() - startedAt,
            error: err,
            projectId: normalizedId,
          },
          { level: "warn" },
        );
        setWorkspaceHealthError(true);
      });
  }, [projectId]);

  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId) {
      return;
    }

    if (project && project.id === normalizedProjectId && !project.isArchived) {
      rememberProjectId(normalizedProjectId);
      return;
    }

    getProject(normalizedProjectId)
      .then((resolvedProject) => {
        if (!resolvedProject || resolvedProject.isArchived) {
          return;
        }
        rememberProjectId(resolvedProject.id);
      })
      .catch((error) => {
        console.warn("[AgentChatPage] 记录最近项目失败:", error);
      });
  }, [project, projectId, rememberProjectId]);

  const runtimeStylePrompt = useMemo(
    () =>
      buildRuntimeStyleOverridePrompt({
        projectStyleGuide: projectMemory?.style_guide,
        selection: runtimeStyleSelection,
        activeTheme: mappedTheme,
      }),
    [mappedTheme, projectMemory?.style_guide, runtimeStyleSelection],
  );

  const runtimeStyleMessagePrompt = useMemo(() => {
    const projectDefaultStrength =
      getStyleProfileFromGuide(projectMemory?.style_guide)
        ?.simulationStrength || DEFAULT_STYLE_PROFILE.simulationStrength;
    const hasPresetOverride =
      runtimeStyleSelection.presetId !== "project-default" ||
      runtimeStyleSelection.source === "library";
    const hasCustomNotes = runtimeStyleSelection.customNotes.trim().length > 0;
    const hasStrengthOverride =
      runtimeStyleSelection.strength !== projectDefaultStrength;

    return hasPresetOverride || hasCustomNotes || hasStrengthOverride
      ? runtimeStylePrompt
      : "";
  }, [projectMemory?.style_guide, runtimeStylePrompt, runtimeStyleSelection]);

  const chatMode = useMemo(
    () => resolveAgentChatMode(mappedTheme, isContentCreationMode),
    [isContentCreationMode, mappedTheme],
  );

  // 生成系统提示词（包含项目 Memory）
  const systemPrompt = useMemo(() => {
    let prompt = "";

    if (chatMode === "general") {
      prompt = buildGeneralAgentSystemPrompt(mappedTheme, {
        toolPreferences: chatToolPreferences,
        harness: {
          browserAssistEnabled: true,
          browserAssistProfileKey: GENERAL_BROWSER_ASSIST_PROFILE_KEY,
          contentId: contentId || null,
        },
      });
    } else if (isContentCreationMode) {
      prompt = generateContentCreationPrompt(mappedTheme, creationMode);
    }

    // 注入项目 Memory
    if (projectMemory) {
      const memoryPrompt = generateProjectMemoryPrompt(projectMemory);
      if (memoryPrompt) {
        prompt = prompt ? `${prompt}\n\n${memoryPrompt}` : memoryPrompt;
      }
    }

    return prompt || undefined;
  }, [
    chatMode,
    chatToolPreferences,
    contentId,
    creationMode,
    isContentCreationMode,
    mappedTheme,
    projectMemory,
  ]);

  // 使用 Agent Chat Hook（传递系统提示词）
  const {
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    messages = [],
    currentTurnId,
    turns = [],
    threadItems = [],
    todoItems = [],
    childSubagentSessions = [],
    subagentParentContext = null,
    queuedTurns = [],
    isSending,
    sendMessage,
    stopSending,
    promoteQueuedTurn = async () => false,
    removeQueuedTurn = async () => false,
    clearMessages,
    deleteMessage,
    editMessage,
    handlePermissionResponse,
    pendingActions = [],
    triggerAIGuide,
    topics = [],
    sessionId,
    createFreshSession,
    switchTopic: originalSwitchTopic,
    deleteTopic,
    renameTopic,
    updateTopicSnapshot = () => undefined,
    workspacePathMissing = false,
    fixWorkspacePathAndRetry,
    dismissWorkspacePathError,
  } = useAgentChatUnified({
    systemPrompt,
    onWriteFile: (content, fileName, context) => {
      // 使用 ref 调用最新的 handleWriteFile
      handleWriteFileRef.current?.(content, fileName, context);
    },
    workspaceId: projectId ?? "",
    disableSessionRestore: shouldDisableSessionRestore,
  });
  const handleOpenSubagentSession = useCallback(
    (subagentSessionId: string) => {
      void originalSwitchTopic(subagentSessionId);
    },
    [originalSwitchTopic],
  );
  const handleReturnToParentSession = useCallback(() => {
    const parentSessionId = subagentParentContext?.parent_session_id?.trim();
    if (!parentSessionId) {
      return;
    }
    void originalSwitchTopic(parentSessionId);
  }, [originalSwitchTopic, subagentParentContext?.parent_session_id]);
  const hasRealTeamGraph =
    childSubagentSessions.length > 0 || Boolean(subagentParentContext);
  const [teamWaitSummary, setTeamWaitSummary] =
    useState<TeamWorkspaceWaitSummary | null>(null);
  const [teamControlSummary, setTeamControlSummary] =
    useState<TeamWorkspaceControlSummary | null>(null);
  const {
    runtimeTeamState,
    clearRuntimeTeamState,
    prepareRuntimeTeamBeforeSend,
  } = useRuntimeTeamFormation({
    activeTheme,
    projectId,
    sessionId,
    selectedTeam,
    subagentEnabled: chatToolPreferences.subagent,
    hasRealTeamGraph,
  });
  const handleCloseSubagentSession = useCallback(
    async (subagentSessionId: string) => {
      try {
        const response = await closeAgentRuntimeSubagent({
          id: subagentSessionId,
        });
        const summary = buildTeamControlSummary({
          action: "close",
          requestedSessionIds: [subagentSessionId],
          cascadeSessionIds: response.cascade_session_ids,
          affectedSessionIds: response.changed_session_ids,
        });
        if (summary.affectedSessionIds.length > 0) {
          setTeamControlSummary(summary);
        }

        if (summary.affectedSessionIds.length > 1) {
          toast.success(
            `已级联关闭 ${summary.affectedSessionIds.length} 位协作成员`,
          );
        } else if (summary.affectedSessionIds.length === 1) {
          toast.success("协作成员已关闭");
        } else {
          toast.info(
            `当前成员状态为${resolveTeamWorkspaceRuntimeStatusLabel(response.previous_status.kind)}，未发生新的关闭变更`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "关闭协作成员失败";
        toast.error(message);
        throw error;
      }
    },
    [],
  );
  const handleResumeSubagentSession = useCallback(
    async (subagentSessionId: string) => {
      try {
        const response = await resumeAgentRuntimeSubagent({
          id: subagentSessionId,
        });
        const summary = buildTeamControlSummary({
          action: "resume",
          requestedSessionIds: [subagentSessionId],
          cascadeSessionIds: response.cascade_session_ids,
          affectedSessionIds: response.changed_session_ids,
        });
        if (summary.affectedSessionIds.length > 0) {
          setTeamControlSummary(summary);
        }

        if (summary.affectedSessionIds.length > 1) {
          toast.success(
            `已级联恢复 ${summary.affectedSessionIds.length} 位协作成员`,
          );
        } else if (summary.affectedSessionIds.length === 1) {
          toast.success("协作成员已恢复");
        } else {
          toast.info(
            `当前成员状态为${resolveTeamWorkspaceRuntimeStatusLabel(response.status.kind)}，未发生新的恢复变更`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "恢复协作成员失败";
        toast.error(message);
        throw error;
      }
    },
    [],
  );
  const handleWaitSubagentSession = useCallback(
    async (subagentSessionId: string, timeoutMs = 30_000) => {
      try {
        const response = await waitAgentRuntimeSubagents({
          ids: [subagentSessionId],
          timeout_ms: timeoutMs,
        });
        if (response.timed_out) {
          toast.info("等待超时，该成员仍未进入最终状态");
          return;
        }

        const status = response.status[subagentSessionId];
        toast.success(
          `该成员已进入${resolveTeamWorkspaceRuntimeStatusLabel(status?.kind)}状态`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "等待成员失败";
        toast.error(message);
        throw error;
      }
    },
    [],
  );
  const handleWaitActiveTeamSessions = useCallback(
    async (subagentSessionIds: string[], timeoutMs = 30_000) => {
      const normalizedSessionIds =
        normalizeUniqueSessionIds(subagentSessionIds);

      if (normalizedSessionIds.length === 0) {
        const error = new Error("没有可等待的活跃成员");
        toast.error(error.message);
        throw error;
      }

      try {
        const response = await waitAgentRuntimeSubagents({
          ids: normalizedSessionIds,
          timeout_ms: timeoutMs,
        });
        if (response.timed_out) {
          setTeamWaitSummary({
            awaitedSessionIds: normalizedSessionIds,
            timedOut: true,
            updatedAt: Date.now(),
          });
          toast.info("等待超时，团队内活跃成员仍未进入最终状态");
          return;
        }

        const resolvedSessionId =
          normalizedSessionIds.find((sessionId) =>
            isTeamWorkspaceTerminalStatus(response.status[sessionId]?.kind),
          ) ?? normalizedSessionIds[0];
        const resolvedStatus = resolvedSessionId
          ? response.status[resolvedSessionId]?.kind
          : undefined;

        setTeamWaitSummary({
          awaitedSessionIds: normalizedSessionIds,
          timedOut: false,
          resolvedSessionId,
          resolvedStatus,
          updatedAt: Date.now(),
        });
        toast.success(
          `团队成员已进入${resolveTeamWorkspaceRuntimeStatusLabel(resolvedStatus)}状态`,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "等待团队成员失败";
        toast.error(message);
        throw error;
      }
    },
    [],
  );
  const handleCloseCompletedTeamSessions = useCallback(
    async (subagentSessionIds: string[]) => {
      const normalizedSessionIds =
        normalizeUniqueSessionIds(subagentSessionIds);

      if (normalizedSessionIds.length === 0) {
        const error = new Error("没有可关闭的已完成成员");
        toast.error(error.message);
        throw error;
      }

      const results = await Promise.allSettled(
        normalizedSessionIds.map((sessionId) =>
          closeAgentRuntimeSubagent({ id: sessionId }),
        ),
      );
      const successfulResponses = results
        .filter(
          (
            result,
          ): result is PromiseFulfilledResult<
            Awaited<ReturnType<typeof closeAgentRuntimeSubagent>>
          > => result.status === "fulfilled",
        )
        .map((result) => result.value);
      const succeededCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const affectedSessionIds = normalizeUniqueSessionIds(
        successfulResponses.flatMap((response) => response.changed_session_ids),
      );
      const cascadeSessionIds = normalizeUniqueSessionIds(
        successfulResponses.flatMap((response) => response.cascade_session_ids),
      );
      const failedResults = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );

      if (successfulResponses.length > 0) {
        setTeamControlSummary(
          buildTeamControlSummary({
            action: "close_completed",
            requestedSessionIds: normalizedSessionIds,
            cascadeSessionIds,
            affectedSessionIds,
          }),
        );
      }

      if (succeededCount > 0) {
        toast.success(
          affectedSessionIds.length > 0
            ? `已级联关闭 ${affectedSessionIds.length} 个会话`
            : `已关闭 ${succeededCount} 位已完成成员`,
        );
      }

      if (failedResults.length > 0) {
        const firstFailure = failedResults[0]?.reason;
        const message =
          firstFailure instanceof Error
            ? firstFailure.message
            : "部分已完成成员关闭失败";
        toast.error(message);
        if (succeededCount === 0) {
          throw firstFailure instanceof Error
            ? firstFailure
            : new Error(message);
        }
      }
    },
    [],
  );
  const handleSendSubagentInput = useCallback(
    async (
      subagentSessionId: string,
      message: string,
      options?: { interrupt?: boolean },
    ) => {
      const normalizedMessage = message.trim();
      if (!normalizedMessage) {
        const error = new Error("请输入要发送给成员的内容");
        toast.error(error.message);
        throw error;
      }

      try {
        await sendAgentRuntimeSubagentInput({
          id: subagentSessionId,
          message: normalizedMessage,
          interrupt: options?.interrupt === true,
        });
        toast.success(
          options?.interrupt === true
            ? "已中断当前执行并发送新说明"
            : "已向成员发送补充说明",
        );
      } catch (error) {
        const messageText =
          error instanceof Error ? error.message : "发送成员说明失败";
        toast.error(messageText);
        throw error;
      }
    },
    [],
  );
  const currentSessionTitle = useMemo(
    () => topics.find((topic) => topic.id === sessionId)?.title ?? null,
    [sessionId, topics],
  );
  const showTeamWorkspaceBoard =
    chatToolPreferences.subagent ||
    hasRealTeamGraph ||
    Boolean(runtimeTeamState);
  const currentSessionRuntimeStatus = useMemo(
    () =>
      deriveCurrentSessionRuntimeStatus({
        isSending,
        queuedTurnCount: queuedTurns.length,
        turns,
      }),
    [isSending, queuedTurns.length, turns],
  );
  const currentSessionLatestTurnStatus = useMemo(
    () => deriveLatestTurnRuntimeStatus(turns),
    [turns],
  );
  const {
    liveRuntimeBySessionId: teamLiveRuntimeBySessionId,
    liveActivityBySessionId: teamLiveActivityBySessionId,
    activityRefreshVersionBySessionId: teamActivityRefreshVersionBySessionId,
  } = useTeamWorkspaceRuntime({
    currentSessionId: sessionId,
    currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus,
    currentSessionQueuedTurnCount: queuedTurns.length,
    childSubagentSessions,
    subagentParentContext,
  });
  const [teamWorkbenchAutoFocusToken, setTeamWorkbenchAutoFocusToken] =
    useState(0);
  const previousTeamWorkbenchSessionIdRef = useRef<string | null>(
    sessionId ?? null,
  );
  const previousRealTeamGraphRef = useRef(hasRealTeamGraph);
  const previousTeamWorkbenchLayoutModeRef = useRef<LayoutMode>(layoutMode);
  const lastAutoActivatedRuntimeTeamRequestIdRef = useRef<string | null>(null);
  const dismissedRuntimeTeamRequestIdRef = useRef<string | null>(null);
  const handleActivateTeamWorkbench = useCallback(() => {
    setTeamWorkbenchAutoFocusToken((current) => current + 1);
    setLayoutMode((current) => (current === "chat" ? "chat-canvas" : current));
  }, []);
  useEffect(() => {
    const previousLayoutMode = previousTeamWorkbenchLayoutModeRef.current;
    const activeRuntimeTeamRequestId = runtimeTeamState?.requestId ?? null;

    if (
      activeRuntimeTeamRequestId &&
      previousLayoutMode !== "chat" &&
      layoutMode === "chat"
    ) {
      dismissedRuntimeTeamRequestIdRef.current = activeRuntimeTeamRequestId;
    }

    previousTeamWorkbenchLayoutModeRef.current = layoutMode;
  }, [layoutMode, runtimeTeamState?.requestId]);
  useEffect(() => {
    const normalizedSessionId = sessionId ?? null;
    const activeRuntimeTeamRequestId = runtimeTeamState?.requestId ?? null;
    const shouldAutoActivateRuntimeTeam =
      Boolean(activeRuntimeTeamRequestId) &&
      runtimeTeamState?.status !== "failed" &&
      dismissedRuntimeTeamRequestIdRef.current !== activeRuntimeTeamRequestId &&
      lastAutoActivatedRuntimeTeamRequestIdRef.current !==
        activeRuntimeTeamRequestId;

    if (previousTeamWorkbenchSessionIdRef.current !== normalizedSessionId) {
      previousTeamWorkbenchSessionIdRef.current = normalizedSessionId;
      previousRealTeamGraphRef.current = hasRealTeamGraph;
      previousTeamWorkbenchLayoutModeRef.current = layoutMode;
      lastAutoActivatedRuntimeTeamRequestIdRef.current = null;
      dismissedRuntimeTeamRequestIdRef.current = null;
      return;
    }

    if (shouldAutoActivateRuntimeTeam && activeRuntimeTeamRequestId) {
      lastAutoActivatedRuntimeTeamRequestIdRef.current =
        activeRuntimeTeamRequestId;
      handleActivateTeamWorkbench();
    }

    const shouldSkipGraphAutoActivate =
      activeRuntimeTeamRequestId !== null &&
      dismissedRuntimeTeamRequestIdRef.current === activeRuntimeTeamRequestId;

    if (
      hasRealTeamGraph &&
      !previousRealTeamGraphRef.current &&
      !shouldSkipGraphAutoActivate
    ) {
      handleActivateTeamWorkbench();
    }

    previousRealTeamGraphRef.current = hasRealTeamGraph;
  }, [
    handleActivateTeamWorkbench,
    hasRealTeamGraph,
    layoutMode,
    runtimeTeamState?.requestId,
    runtimeTeamState?.status,
    sessionId,
  ]);
  useEffect(() => {
    logAgentDebug(
      "AgentChatPage",
      "stateSnapshot",
      {
        activeTheme,
        contentId: contentId ?? null,
        initialContentLoadError: initialContentLoadError ?? null,
        isInitialContentLoading,
        isSending,
        layoutMode,
        messagesCount: messages.length,
        projectId: projectId ?? null,
        sessionId: sessionId ?? null,
        skillsCount: skills.length,
        skillsLoading,
        topicsCount: topics.length,
        workspaceHealthError,
      },
      {
        dedupeKey: JSON.stringify({
          activeTheme,
          contentId: contentId ?? null,
          initialContentLoadError: initialContentLoadError ?? null,
          isInitialContentLoading,
          isSending,
          layoutMode,
          messagesCount: messages.length,
          projectId: projectId ?? null,
          sessionId: sessionId ?? null,
          skillsCount: skills.length,
          skillsLoading,
          topicsCount: topics.length,
          workspaceHealthError,
        }),
        throttleMs: 800,
      },
    );
  }, [
    activeTheme,
    contentId,
    initialContentLoadError,
    isInitialContentLoading,
    isSending,
    layoutMode,
    messages.length,
    projectId,
    sessionId,
    skills.length,
    skillsLoading,
    topics.length,
    workspaceHealthError,
  ]);
  const settledLiveArtifact = useMemo(
    () =>
      settleLiveArtifactAfterStreamStops(liveArtifact, {
        streamActive: isSending,
      }),
    [isSending, liveArtifact],
  );
  const settledWorkbenchArtifacts = useMemo(() => {
    if (!settledLiveArtifact) {
      return artifacts;
    }

    let updated = false;
    const nextArtifacts = artifacts.map((artifact) => {
      if (artifact.id !== settledLiveArtifact.id) {
        return artifact;
      }

      updated = updated || artifact !== settledLiveArtifact;
      return settledLiveArtifact;
    });

    return updated ? nextArtifacts : artifacts;
  }, [artifacts, settledLiveArtifact]);
  const artifactDisplayState = useArtifactDisplayState(
    settledLiveArtifact,
    artifacts,
  );
  const currentCanvasArtifact = artifactDisplayState.liveArtifact;
  const displayedCanvasArtifact = artifactDisplayState.displayArtifact;
  const currentBrowserAssistScopeKey = useMemo(
    () =>
      activeTheme === "general"
        ? resolveBrowserAssistSessionScopeKey(projectId, sessionId)
        : null,
    [activeTheme, projectId, sessionId],
  );
  const browserAssistArtifact = useMemo(
    () =>
      artifacts.find(
        (artifact) =>
          artifact.id === GENERAL_BROWSER_ASSIST_ARTIFACT_ID &&
          artifact.type === "browser_assist" &&
          resolveBrowserAssistArtifactScopeKey(artifact) ===
            currentBrowserAssistScopeKey,
      ) || null,
    [artifacts, currentBrowserAssistScopeKey],
  );
  const latestBrowserAssistSessionFromMessages = useMemo(
    () => findLatestBrowserAssistSessionInMessages(messages),
    [messages],
  );
  const browserAssistSessionFromArtifact = useMemo(
    () => extractBrowserAssistSessionFromArtifact(browserAssistArtifact),
    [browserAssistArtifact],
  );
  const browserAssistStorageKey = useMemo(
    () =>
      activeTheme === "general"
        ? `${projectId || "global"}:${sessionId || "active"}`
        : null,
    [activeTheme, projectId, sessionId],
  );
  const isBrowserAssistCanvasVisible =
    activeTheme === "general" &&
    layoutMode !== "chat" &&
    currentCanvasArtifact?.type === "browser_assist";

  useEffect(() => {
    if (activeTheme !== "general") {
      browserAssistScopeTrackerRef.current = null;
      browserAssistAutoOpenDismissedScopeRef.current = null;
      return;
    }

    if (!currentBrowserAssistScopeKey) {
      return;
    }

    if (
      browserAssistScopeTrackerRef.current &&
      browserAssistScopeTrackerRef.current !== currentBrowserAssistScopeKey
    ) {
      browserAssistAutoOpenDismissedScopeRef.current = null;
    }

    browserAssistScopeTrackerRef.current = currentBrowserAssistScopeKey;
  }, [activeTheme, currentBrowserAssistScopeKey]);

  const compatSubagentRuntime = useCompatSubagentRuntime(sessionId);
  const realSubagentTimelineItems = useMemo(
    () =>
      buildRealSubagentTimelineItems({
        threadId: sessionId,
        turns,
        childSessions: childSubagentSessions,
      }),
    [childSubagentSessions, sessionId, turns],
  );
  const syntheticSubagentItems = useMemo(
    () =>
      buildSyntheticSubagentTimelineItems({
        threadId: sessionId,
        turnId: currentTurnId,
        events: compatSubagentRuntime.events,
      }),
    [compatSubagentRuntime.events, currentTurnId, sessionId],
  );
  const effectiveThreadItems = useMemo(
    () =>
      mergeThreadItems(
        threadItems,
        realSubagentTimelineItems,
        realSubagentTimelineItems.length > 0
          ? undefined
          : syntheticSubagentItems,
      ),
    [realSubagentTimelineItems, syntheticSubagentItems, threadItems],
  );
  const harnessState = useMemo(
    () =>
      deriveHarnessSessionState(
        messages,
        pendingActions,
        effectiveThreadItems,
        todoItems,
      ),
    [effectiveThreadItems, messages, pendingActions, todoItems],
  );
  const activeRuntimeStatusTitle = useMemo(() => {
    if (!isSending) {
      return null;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant" && message.runtimeStatus?.title) {
        return message.runtimeStatus.title;
      }
    }

    return "Agent 正在准备执行";
  }, [isSending, messages]);
  const [harnessPanelVisible, setHarnessPanelVisible] = useState(() =>
    loadPersistedBoolean(HARNESS_PANEL_VISIBILITY_KEY, false),
  );
  const [toolInventory, setToolInventory] =
    useState<AgentRuntimeToolInventory | null>(null);
  const [toolInventoryLoading, setToolInventoryLoading] = useState(false);
  const [toolInventoryError, setToolInventoryError] = useState<string | null>(
    null,
  );
  const toolInventoryRequestIdRef = useRef(0);
  const thinkingVariantWarnedRef = useRef<Set<string>>(new Set());
  const resolveSendProviderContext = useCallback(async () => {
    const configuredProviders = await loadConfiguredProviders();
    const selectedProvider =
      configuredProviders.find((provider) => provider.key === providerType) ||
      null;
    const providerModels = await loadProviderModels(selectedProvider);

    return {
      selectedProvider,
      providerModels,
    };
  }, [providerType]);

  useEffect(() => {
    onSessionChange?.(sessionId ?? null);
  }, [onSessionChange, sessionId]);

  useEffect(() => {
    if (activeTheme !== "general") {
      setArtifacts([]);
      return;
    }

    const messageArtifacts = mergeArtifacts(
      messages.flatMap((message) => message.artifacts || []),
    );
    setArtifacts((currentArtifacts) =>
      mergeMessageArtifactsIntoStore(
        messageArtifacts,
        currentArtifacts,
        currentBrowserAssistScopeKey,
      ),
    );
  }, [activeTheme, currentBrowserAssistScopeKey, messages, setArtifacts]);

  useEffect(() => {
    if (activeTheme !== "general") {
      setSelectedArtifactId(null);
      return;
    }

    if (artifacts.length === 0) {
      if (selectedArtifact) {
        setSelectedArtifactId(null);
      }
      return;
    }

    if (!selectedArtifact) {
      setSelectedArtifactId(artifacts[artifacts.length - 1]?.id || null);
      return;
    }

    const selectedStillExists = artifacts.some(
      (artifact) => artifact.id === selectedArtifact.id,
    );
    if (!selectedStillExists) {
      setSelectedArtifactId(artifacts[artifacts.length - 1]?.id || null);
    }
  }, [activeTheme, artifacts, selectedArtifact, setSelectedArtifactId]);

  useEffect(() => {
    if (activeTheme !== "general" || !displayedCanvasArtifact) {
      return;
    }
    setArtifactViewMode(
      resolveDefaultArtifactViewMode(displayedCanvasArtifact),
    );
  }, [activeTheme, displayedCanvasArtifact]);

  useEffect(() => {
    savePersistedBoolean(HARNESS_PANEL_VISIBILITY_KEY, harnessPanelVisible);
  }, [harnessPanelVisible]);

  const contextWorkspace = useThemeContextWorkspace({
    projectId,
    activeTheme,
    messages,
    providerType,
    model,
  });
  const isThemeWorkbench = contextWorkspace.enabled;
  const harnessSkillNames = useMemo(
    () => collectConversationSkillNames(messages),
    [messages],
  );
  const harnessPendingCount = harnessState.pendingApprovals.length;
  const shouldAlwaysShowHarnessToggle =
    contextWorkspace.enabled && mappedTheme === "social-media";
  const shouldAlwaysShowGeneralWorkbenchToggle =
    chatMode === "general" && !contextWorkspace.enabled;
  const hasHarnessActivity =
    harnessPanelVisible ||
    harnessState.hasSignals ||
    compatSubagentRuntime.isRunning;
  const showHarnessToggle =
    shouldAlwaysShowHarnessToggle ||
    shouldAlwaysShowGeneralWorkbenchToggle ||
    hasHarnessActivity;
  const harnessAttentionLevel =
    harnessPendingCount > 0
      ? "warning"
      : hasHarnessActivity
        ? "active"
        : "idle";
  const navbarHarnessPanelVisible = harnessPanelVisible;
  const visibleContextItems = useMemo(() => {
    const activeItems = contextWorkspace.sidebarContextItems.filter(
      (item) => item.active,
    );
    return activeItems.length > 0
      ? activeItems
      : contextWorkspace.sidebarContextItems;
  }, [contextWorkspace.sidebarContextItems]);
  const harnessEnvironment = useMemo(
    () => ({
      skillsCount: harnessSkillNames.length,
      skillNames: harnessSkillNames.slice(0, 4),
      memorySignals: [
        projectMemory?.characters.length ? "角色" : null,
        projectMemory?.world_building ? "世界观" : null,
        projectMemory?.style_guide ? "风格" : null,
        projectMemory?.outline.length ? "大纲" : null,
      ].filter((item): item is string => item !== null),
      contextItemsCount: contextWorkspace.sidebarContextItems.length,
      activeContextCount: contextWorkspace.sidebarContextItems.filter(
        (item) => item.active,
      ).length,
      contextItemNames: visibleContextItems
        .map((item) => item.name)
        .filter((name) => !!name.trim())
        .slice(0, 4),
      contextEnabled: contextWorkspace.enabled,
    }),
    [
      contextWorkspace.enabled,
      contextWorkspace.sidebarContextItems,
      harnessSkillNames,
      projectMemory?.characters.length,
      projectMemory?.outline.length,
      projectMemory?.style_guide,
      projectMemory?.world_building,
      visibleContextItems,
    ],
  );
  const shouldUseCompactThemeWorkbench =
    isThemeWorkbench && (mappedTheme === "video" || mappedTheme === "poster");
  const shouldSkipThemeWorkbenchAutoGuideWithoutPrompt =
    isThemeWorkbench &&
    (shouldUseCompactThemeWorkbench || mappedTheme === "novel");
  const enableThemeWorkbenchPanelCollapse =
    isThemeWorkbench && mappedTheme === "social-media";
  const handleToggleHarnessPanel = useCallback(() => {
    setHarnessPanelVisible((current) => !current);
  }, []);

  // 主题工作台模式：同步 skills 状态到 store
  // 注意：不再设置 themeSkillsRailState，避免"操作面板"覆盖默认 Skills Rail
  // 默认 Skills Rail 已包含完整的技能分类（文字多搜索、视觉生成、音频生成等）
  useEffect(() => {
    if (!isThemeWorkbench) {
      clearThemeSkillsRailState();
    }
  }, [isThemeWorkbench, clearThemeSkillsRailState]);

  // 组件卸载时清理 store 状态
  useEffect(() => {
    return () => {
      clearThemeSkillsRailState();
    };
  }, [clearThemeSkillsRailState]);

  useEffect(() => {
    if (!isThemeWorkbench) {
      setThemeWorkbenchCreationTaskEvents([]);
    }
  }, [isThemeWorkbench]);

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      return;
    }

    setThemeWorkbenchCreationTaskEvents([]);

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    safeListen<CreationTaskSubmittedPayload>(
      THEME_WORKBENCH_CREATION_TASK_EVENT_NAME,
      (event) => {
        if (cancelled) {
          return;
        }
        const normalized = normalizeThemeWorkbenchCreationTaskEvent(
          event.payload || {},
        );
        if (!normalized) {
          return;
        }
        setThemeWorkbenchCreationTaskEvents((previous) => {
          const deduplicated = previous.filter(
            (item) =>
              item.taskId !== normalized.taskId &&
              item.path !== normalized.path,
          );
          return [normalized, ...deduplicated].slice(
            0,
            MAX_THEME_WORKBENCH_CREATION_TASK_EVENTS,
          );
        });
      },
    )
      .then((dispose) => {
        if (cancelled) {
          void dispose();
          return;
        }
        unlisten = dispose;
      })
      .catch((error) => {
        console.warn("[AgentChatPage] 监听任务提交事件失败:", error);
      });

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [isThemeWorkbench, sessionId]);

  useEffect(() => {
    if (!isThemeWorkbench || canvasState) {
      return;
    }

    const initialThemeWorkbenchCanvas =
      createInitialCanvasState(mappedTheme, "") ||
      createInitialDocumentState("");
    if (!initialThemeWorkbenchCanvas) {
      return;
    }

    setCanvasState(initialThemeWorkbenchCanvas);
    setLayoutMode((previous) => (previous === "chat" ? "canvas" : previous));
  }, [canvasState, isThemeWorkbench, mappedTheme]);

  useEffect(() => {
    if (enableThemeWorkbenchPanelCollapse) {
      return;
    }
    setThemeWorkbenchSidebarCollapsed(false);
  }, [enableThemeWorkbenchPanelCollapse]);
  const versionTopics = useMemo(() => {
    if (!isThemeWorkbench || !canvasState || canvasState.type !== "document") {
      return [];
    }
    return canvasState.versions.map((version, index) => ({
      id: version.id,
      title: version.description?.trim() || `版本 ${index + 1}`,
      messagesCount: version.content.trim() ? 2 : 0,
    }));
  }, [canvasState, isThemeWorkbench]);
  const currentVersionId =
    isThemeWorkbench && canvasState?.type === "document"
      ? canvasState.currentVersionId
      : null;
  const { branchItems, setTopicStatus } = useTopicBranchBoard({
    enabled: isThemeWorkbench && canvasState?.type === "document",
    projectId,
    currentTopicId: currentVersionId,
    topics: versionTopics,
    externalStatusMap: documentVersionStatusMap,
    onStatusMapChange: setDocumentVersionStatusMap,
  });

  useEffect(() => {
    if (
      !isThemeWorkbench ||
      !contentId ||
      !canvasState ||
      canvasState.type !== "document"
    ) {
      return;
    }

    const persisted = buildPersistedThemeWorkbenchDocument(
      canvasState,
      documentVersionStatusMap,
    );
    if (!persisted) {
      return;
    }

    const snapshot = JSON.stringify(persisted);
    if (snapshot === persistedWorkbenchSnapshotRef.current) {
      return;
    }

    const nextMetadata = {
      ...(contentMetadataRef.current || {}),
      [THEME_WORKBENCH_DOCUMENT_META_KEY]: persisted,
    };

    const timer = setTimeout(() => {
      updateContent(contentId, {
        metadata: nextMetadata,
      })
        .then((updated) => {
          contentMetadataRef.current = updated.metadata || nextMetadata;
          persistedWorkbenchSnapshotRef.current = snapshot;
        })
        .catch((error) => {
          console.warn("[AgentChatPage] 保存文稿版本状态失败:", error);
        });
    }, 1000);

    return () => clearTimeout(timer);
  }, [canvasState, contentId, documentVersionStatusMap, isThemeWorkbench]);

  const pendingActionRequest = useMemo(() => {
    const latestPendingMessage = [...messages]
      .reverse()
      .find((message) =>
        message.actionRequests?.some((request) => request.status === "pending"),
      );

    if (!latestPendingMessage?.actionRequests) {
      return null;
    }

    return (
      [...latestPendingMessage.actionRequests]
        .reverse()
        .find((request) => request.status === "pending") || null
    );
  }, [messages]);

  // 提取最新的 A2UI Form（从最后一条 assistant 消息的 content 解析）
  const pendingMessageA2UIForm = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (msg.role === "user") {
        return null;
      }

      if (msg.role === "assistant" && msg.content) {
        try {
          const parsed = parseAIResponse(msg.content, false);
          if (parsed.hasA2UI) {
            for (let j = parsed.parts.length - 1; j >= 0; j--) {
              const part = parsed.parts[j];
              if (part.type === "a2ui" && typeof part.content !== "string") {
                return part.content;
              }
            }
          }
        } catch {
          // 解析失败，忽略
        }
      }
    }
    return null;
  }, [messages]);

  const pendingPromotedA2UIActionRequest = useMemo(() => {
    if (pendingMessageA2UIForm) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      const pendingRequest = [...(message.actionRequests || [])]
        .reverse()
        .find(
          (request) =>
            request.status === "pending" &&
            isActionRequestA2UICompatible(request),
        );

      if (pendingRequest) {
        return pendingRequest;
      }
    }

    return null;
  }, [messages, pendingMessageA2UIForm]);

  const pendingLegacyQuestionnaireA2UIForm = useMemo(() => {
    if (pendingMessageA2UIForm || pendingActionRequest) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];

      if (message.role === "user") {
        return null;
      }

      if (message.role !== "assistant") {
        continue;
      }

      if ((message.actionRequests || []).length > 0) {
        return null;
      }

      return buildLegacyQuestionnaireA2UI(message.content || "");
    }

    return null;
  }, [messages, pendingActionRequest, pendingMessageA2UIForm]);

  const pendingA2UIForm = useMemo(() => {
    if (pendingMessageA2UIForm) {
      return pendingMessageA2UIForm;
    }

    if (pendingPromotedA2UIActionRequest) {
      return buildActionRequestA2UI(pendingPromotedA2UIActionRequest);
    }

    return pendingLegacyQuestionnaireA2UIForm;
  }, [
    pendingLegacyQuestionnaireA2UIForm,
    pendingMessageA2UIForm,
    pendingPromotedA2UIActionRequest,
  ]);

  const a2uiSubmissionNotice = useMemo(() => {
    if (pendingA2UIForm) {
      return null;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant") {
        const submittedActionRequest = [...(msg.actionRequests || [])]
          .reverse()
          .find(
            (request) =>
              request.status === "submitted" &&
              isActionRequestA2UICompatible(request),
          );

        if (submittedActionRequest) {
          const summary = summarizeActionRequestSubmission(
            submittedActionRequest,
          );
          return {
            title: "补充信息已确认",
            summary: summary || "已收到你的补充信息，正在继续推进下一步。",
          };
        }

        continue;
      }

      if (msg.role !== "user") {
        continue;
      }

      const content = msg.content.trim();
      if (!content.startsWith("我的选择：")) {
        return null;
      }

      const summary = content
        .split("\n")
        .slice(1)
        .map((line) => line.replace(/^[-•]\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(" · ");

      return {
        title: "需求已确认",
        summary: summary || "已收到你的补充信息，正在继续推进下一步。",
      };
    }

    return null;
  }, [messages, pendingA2UIForm]);

  useEffect(() => {
    const unsubscribe = subscribeDocumentEditorFocus((focused) => {
      documentEditorFocusedRef.current = focused;
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      themeWorkbenchRunStateSignatureRef.current = "";
      setThemeWorkbenchBackendRunState(null);
      return;
    }

    let disposed = false;
    let inFlight = false;
    let timer: number | null = null;
    const activePollIntervalMs = isSending ? 1000 : 3000;
    const idlePollIntervalMs = isSending ? 1000 : 10000;
    const focusedPollIntervalMs = isSending ? 1000 : 15000;

    const scheduleNext = (delayMs: number) => {
      if (disposed) {
        return;
      }
      timer = window.setTimeout(() => {
        void fetchRunState();
      }, delayMs);
    };

    const fetchRunState = async () => {
      if (disposed || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const state = await executionRunGetThemeWorkbenchState(sessionId, 3);
        if (!disposed) {
          const nextSignature = buildThemeWorkbenchRunStateSignature(state);
          if (themeWorkbenchRunStateSignatureRef.current !== nextSignature) {
            themeWorkbenchRunStateSignatureRef.current = nextSignature;
            setThemeWorkbenchBackendRunState(state);
          }

          const hasFreshRunningQueueItem = (state.queue_items || []).some(
            (item) => {
              if (item.status !== "running") {
                return false;
              }
              const startedAt = new Date(item.started_at);
              if (Number.isNaN(startedAt.getTime())) {
                return false;
              }
              return (
                Date.now() - startedAt.getTime() <=
                THEME_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS
              );
            },
          );

          const latestTerminalRunning =
            state.latest_terminal?.status === "running";
          const hasActiveBackendRun =
            state.run_state === "auto_running" ||
            hasFreshRunningQueueItem ||
            latestTerminalRunning;
          const isEditorFocused = documentEditorFocusedRef.current;
          scheduleNext(
            hasActiveBackendRun
              ? activePollIntervalMs
              : isEditorFocused
                ? focusedPollIntervalMs
                : idlePollIntervalMs,
          );
        }
      } catch (error) {
        if (!disposed) {
          console.warn("[AgentChatPage] 拉取主题工作台运行状态失败:", error);
          if (themeWorkbenchRunStateSignatureRef.current !== "null") {
            themeWorkbenchRunStateSignatureRef.current = "null";
            setThemeWorkbenchBackendRunState(null);
          }
          scheduleNext(
            documentEditorFocusedRef.current
              ? focusedPollIntervalMs
              : activePollIntervalMs,
          );
        }
      } finally {
        inFlight = false;
      }
    };

    void fetchRunState();

    return () => {
      disposed = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isSending, isThemeWorkbench, sessionId]);

  const loadThemeWorkbenchHistory = useCallback(
    async (offset: number, replace: boolean) => {
      if (
        !isThemeWorkbench ||
        !sessionId ||
        themeWorkbenchHistoryLoadingRef.current
      ) {
        return;
      }

      themeWorkbenchHistoryLoadingRef.current = true;
      setThemeWorkbenchHistoryLoading(true);
      try {
        const page = await executionRunListThemeWorkbenchHistory(
          sessionId,
          THEME_WORKBENCH_HISTORY_PAGE_SIZE,
          offset,
        );
        setThemeWorkbenchHistoryTerminals((previous) =>
          replace
            ? mergeThemeWorkbenchTerminalItems(page.items || [])
            : mergeThemeWorkbenchTerminalItems(previous, page.items || []),
        );
        setThemeWorkbenchHistoryHasMore(Boolean(page.has_more));
        setThemeWorkbenchHistoryNextOffset(page.next_offset ?? null);
      } catch (error) {
        console.warn("[AgentChatPage] 拉取主题工作台历史日志失败:", error);
        if (replace) {
          setThemeWorkbenchHistoryTerminals([]);
          setThemeWorkbenchHistoryHasMore(false);
          setThemeWorkbenchHistoryNextOffset(null);
        }
      } finally {
        themeWorkbenchHistoryLoadingRef.current = false;
        setThemeWorkbenchHistoryLoading(false);
      }
    },
    [isThemeWorkbench, sessionId],
  );

  useEffect(() => {
    if (!isThemeWorkbench || !sessionId) {
      themeWorkbenchHistoryLoadingRef.current = false;
      setThemeWorkbenchHistoryTerminals([]);
      setThemeWorkbenchHistoryHasMore(false);
      setThemeWorkbenchHistoryNextOffset(null);
      setThemeWorkbenchHistoryLoading(false);
      return;
    }

    void loadThemeWorkbenchHistory(0, true);
  }, [isThemeWorkbench, loadThemeWorkbenchHistory, sessionId]);

  const themeWorkbenchRequiredSkillNames = useMemo(() => {
    if (!isThemeWorkbench) {
      return [] as string[];
    }

    const requiredSkillNames = new Set<string>();
    messages.forEach((message) => {
      if (message.role !== "user") {
        return;
      }
      const skillName = parseSkillSlashCommand(message.content)?.skillName;
      if (skillName) {
        requiredSkillNames.add(skillName);
      }
    });
    (themeWorkbenchBackendRunState?.queue_items || []).forEach((item) => {
      const sourceRef = resolveThemeWorkbenchSkillSourceRef(item);
      if (sourceRef) {
        requiredSkillNames.add(sourceRef);
      }
    });
    const terminalSourceRef = resolveThemeWorkbenchSkillSourceRef(
      themeWorkbenchBackendRunState?.latest_terminal || {},
    );
    if (terminalSourceRef) {
      requiredSkillNames.add(terminalSourceRef);
    }

    return [...requiredSkillNames].sort();
  }, [
    isThemeWorkbench,
    messages,
    themeWorkbenchBackendRunState?.latest_terminal,
    themeWorkbenchBackendRunState?.queue_items,
  ]);

  useEffect(() => {
    if (!isThemeWorkbench) {
      setThemeWorkbenchSkillDetailMap((prev) =>
        Object.keys(prev).length === 0 ? prev : {},
      );
      return;
    }

    const missingSkillNames = themeWorkbenchRequiredSkillNames.filter(
      (skillName) => !(skillName in themeWorkbenchSkillDetailMap),
    );
    if (missingSkillNames.length === 0) {
      return;
    }

    let disposed = false;
    Promise.all(
      missingSkillNames.map(async (skillName) => {
        try {
          const detail = await skillExecutionApi.getSkillDetail(skillName);
          return [skillName, detail] as const;
        } catch (error) {
          console.warn(
            "[AgentChatPage] 加载 Skill 详情失败:",
            skillName,
            error,
          );
          return [skillName, null] as const;
        }
      }),
    ).then((entries) => {
      if (disposed) {
        return;
      }
      setThemeWorkbenchSkillDetailMap((prev) => {
        const next = { ...prev };
        entries.forEach(([skillName, detail]) => {
          next[skillName] = detail;
        });
        return next;
      });
    });

    return () => {
      disposed = true;
    };
  }, [
    isThemeWorkbench,
    themeWorkbenchRequiredSkillNames,
    themeWorkbenchSkillDetailMap,
  ]);

  const themeWorkbenchWorkflowSteps = useMemo(
    () =>
      buildThemeWorkbenchWorkflowSteps(
        messages,
        themeWorkbenchBackendRunState,
        isSending,
        themeWorkbenchSkillDetailMap,
      ),
    [
      isSending,
      messages,
      themeWorkbenchBackendRunState,
      themeWorkbenchSkillDetailMap,
    ],
  );

  const themeWorkbenchActiveQueueItem = useMemo(() => {
    const queueItems = themeWorkbenchBackendRunState?.queue_items || [];
    return (
      queueItems.find((item) => item.status === "running") ||
      queueItems[0] ||
      null
    );
  }, [themeWorkbenchBackendRunState?.queue_items]);

  const themeWorkbenchMergedTerminals = useMemo(
    () =>
      mergeThemeWorkbenchTerminalItems(
        resolveThemeWorkbenchRecentTerminals(themeWorkbenchBackendRunState),
        themeWorkbenchHistoryTerminals,
      ),
    [themeWorkbenchBackendRunState, themeWorkbenchHistoryTerminals],
  );

  const themeWorkbenchExecutionRunMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!isThemeWorkbench || !themeWorkbenchBackendRunState) {
      return map;
    }

    const register = (executionId?: string | null, runId?: string | null) => {
      const normalizedExecutionId = executionId?.trim();
      const normalizedRunId = runId?.trim();
      if (!normalizedExecutionId || !normalizedRunId) {
        return;
      }
      map.set(normalizedExecutionId, normalizedRunId);
    };

    (themeWorkbenchBackendRunState.queue_items || []).forEach((item) => {
      register(item.execution_id, item.run_id);
    });
    themeWorkbenchMergedTerminals.forEach((item) => {
      register(item.execution_id, item.run_id);
    });

    return map;
  }, [
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
    themeWorkbenchMergedTerminals,
  ]);

  const themeWorkbenchBackendActivityLogs = useMemo<
    SidebarActivityLog[]
  >(() => {
    if (!isThemeWorkbench || !themeWorkbenchBackendRunState) {
      return [];
    }

    const runningLogs = (themeWorkbenchBackendRunState.queue_items || []).map(
      (item) => {
        const gateKey =
          item.gate_key || inferThemeWorkbenchGateFromQueueItem(item).key;
        return {
          id: `run-queue-${item.run_id}`,
          name: item.title || "执行主题工作台编排",
          status: "running" as const,
          timeLabel: formatThemeWorkbenchRunTimeLabel(item.started_at),
          applyTarget: resolveThemeWorkbenchApplyTargetByGateKey(gateKey),
          runId: item.run_id,
          executionId: item.execution_id || undefined,
          sessionId: item.session_id || undefined,
          artifactPaths:
            Array.isArray(item.artifact_paths) && item.artifact_paths.length > 0
              ? item.artifact_paths
              : undefined,
          gateKey,
          source: item.source,
          sourceRef: item.source_ref || undefined,
        };
      },
    );

    const terminalLogs: SidebarActivityLog[] =
      themeWorkbenchMergedTerminals.map((terminal) => ({
        id: `run-terminal-${terminal.run_id}`,
        name: terminal.title || "执行主题工作台编排",
        status: terminal.status === "success" ? "completed" : "failed",
        timeLabel: formatThemeWorkbenchRunTimeLabel(
          terminal.finished_at || terminal.started_at,
        ),
        durationLabel: formatThemeWorkbenchRunDurationLabel(
          terminal.started_at,
          terminal.finished_at,
        ),
        applyTarget: resolveThemeWorkbenchApplyTargetByGateKey(
          terminal.gate_key || "idle",
        ),
        runId: terminal.run_id,
        executionId: terminal.execution_id || undefined,
        sessionId: terminal.session_id || undefined,
        artifactPaths:
          Array.isArray(terminal.artifact_paths) &&
          terminal.artifact_paths.length > 0
            ? terminal.artifact_paths
            : undefined,
        gateKey: terminal.gate_key || "idle",
        source: terminal.source,
        sourceRef: terminal.source_ref || undefined,
      }));

    return [...runningLogs, ...terminalLogs];
  }, [
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
    themeWorkbenchMergedTerminals,
  ]);

  const handleLoadMoreThemeWorkbenchHistory = useCallback(() => {
    const nextOffset =
      themeWorkbenchHistoryNextOffset ?? themeWorkbenchHistoryTerminals.length;
    void loadThemeWorkbenchHistory(nextOffset, false);
  }, [
    loadThemeWorkbenchHistory,
    themeWorkbenchHistoryNextOffset,
    themeWorkbenchHistoryTerminals.length,
  ]);

  const themeWorkbenchActivityLogs = useMemo<SidebarActivityLog[]>(() => {
    if (!isThemeWorkbench) {
      return contextWorkspace.activityLogs;
    }
    const enrichedContextLogs = contextWorkspace.activityLogs.map((log) => {
      const normalizedRunId = log.runId?.trim();
      if (normalizedRunId) {
        return {
          ...log,
          runId: normalizedRunId,
        };
      }

      const candidateExecutionIds =
        resolveExecutionIdCandidatesForActivityLog(log);
      for (const executionId of candidateExecutionIds) {
        const mappedRunId = themeWorkbenchExecutionRunMap.get(executionId);
        if (!mappedRunId) {
          continue;
        }
        return {
          ...log,
          executionId,
          runId: mappedRunId,
        };
      }

      return log;
    });

    return [...themeWorkbenchBackendActivityLogs, ...enrichedContextLogs];
  }, [
    contextWorkspace.activityLogs,
    isThemeWorkbench,
    themeWorkbenchBackendActivityLogs,
    themeWorkbenchExecutionRunMap,
  ]);

  const handleViewThemeWorkbenchRunDetail = useCallback((runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      return;
    }
    setSelectedThemeWorkbenchRunId(normalizedRunId);
  }, []);

  const handleViewContextDetail = useCallback(
    (contextId: string) => {
      const detail = contextWorkspace.getContextDetail(contextId);
      if (!detail) {
        toast.error("无法找到上下文详情");
        return;
      }

      // 显示上下文详情
      const sourceLabel =
        detail.source === "material"
          ? "素材库"
          : detail.source === "content"
            ? "历史内容"
            : "搜索结果";

      toast.info(
        <div style={{ maxWidth: "500px" }}>
          <div style={{ fontWeight: 600, marginBottom: "8px" }}>
            {detail.name}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "hsl(var(--muted-foreground))",
              marginBottom: "8px",
            }}
          >
            来源: {sourceLabel} · 约 {detail.estimatedTokens} tokens
          </div>
          <div
            style={{
              fontSize: "13px",
              lineHeight: "1.5",
              maxHeight: "300px",
              overflow: "auto",
            }}
          >
            {detail.bodyText || detail.previewText}
          </div>
        </div>,
        { duration: 10000 },
      );
    },
    [contextWorkspace],
  );

  useEffect(() => {
    if (!isThemeWorkbench || !selectedThemeWorkbenchRunId) {
      setThemeWorkbenchRunDetailLoading(false);
      setSelectedThemeWorkbenchRunDetail(null);
      return;
    }

    let cancelled = false;
    setThemeWorkbenchRunDetailLoading(true);
    executionRunGet(selectedThemeWorkbenchRunId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedThemeWorkbenchRunDetail(detail);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSelectedThemeWorkbenchRunDetail(null);
        console.warn("[AgentChatPage] 加载运行详情失败:", error);
      })
      .finally(() => {
        if (!cancelled) {
          setThemeWorkbenchRunDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isThemeWorkbench, selectedThemeWorkbenchRunId]);

  const currentGateBase = useMemo(() => {
    if (!isThemeWorkbench) {
      return {
        key: "idle",
        title: "编排待启动",
        requiresUserDecision: false,
        description: "输入目标后将自动进入编排执行。",
      };
    }

    if (pendingActionRequest) {
      const prompt =
        pendingActionRequest.prompt ||
        pendingActionRequest.questions?.[0]?.question ||
        "等待你的决策以继续执行后续节点。";
      return {
        key: pendingActionRequest.actionType,
        title: "人工闸门",
        requiresUserDecision: true,
        description: prompt,
      };
    }

    if (themeWorkbenchBackendRunState?.run_state === "auto_running") {
      const backendGateKey = themeWorkbenchBackendRunState.current_gate_key;
      if (
        backendGateKey === "topic_select" ||
        backendGateKey === "write_mode" ||
        backendGateKey === "publish_confirm"
      ) {
        const backendGate = resolveThemeWorkbenchGateByKey(
          backendGateKey,
          themeWorkbenchActiveQueueItem?.title,
        );
        return {
          key: backendGate.key,
          title: backendGate.title,
          requiresUserDecision: false,
          description: backendGate.description,
        };
      }
      const backendGate = inferThemeWorkbenchGateFromQueueItem(
        themeWorkbenchActiveQueueItem,
      );
      return {
        key: backendGate.key,
        title: backendGate.title,
        requiresUserDecision: false,
        description: backendGate.description,
      };
    }

    return {
      key: "idle",
      title: "编排待启动",
      requiresUserDecision: false,
      description: "输入目标后将自动进入编排执行。",
    };
  }, [
    isThemeWorkbench,
    pendingActionRequest,
    themeWorkbenchActiveQueueItem,
    themeWorkbenchBackendRunState?.current_gate_key,
    themeWorkbenchBackendRunState?.run_state,
  ]);

  const themeWorkbenchRunState = useMemo<
    "idle" | "auto_running" | "await_user_decision"
  >(() => {
    if (!isThemeWorkbench) {
      return "idle";
    }
    if (currentGateBase.requiresUserDecision) {
      return "await_user_decision";
    }
    if (themeWorkbenchBackendRunState) {
      if (themeWorkbenchBackendRunState.run_state !== "auto_running") {
        return "idle";
      }

      const hasFreshRunningQueueItem = (
        themeWorkbenchBackendRunState.queue_items || []
      ).some((item) => {
        if (item.status !== "running") {
          return false;
        }
        const startedAt = new Date(item.started_at);
        if (Number.isNaN(startedAt.getTime())) {
          return false;
        }
        return (
          Date.now() - startedAt.getTime() <=
          THEME_WORKBENCH_ACTIVE_RUN_MAX_AGE_MS
        );
      });

      if (hasFreshRunningQueueItem || isSending) {
        return "auto_running";
      }
      return "idle";
    }
    return isSending ? "auto_running" : "idle";
  }, [
    currentGateBase.requiresUserDecision,
    isThemeWorkbench,
    themeWorkbenchBackendRunState,
    isSending,
  ]);

  const currentGate = useMemo(() => {
    const status = currentGateBase.requiresUserDecision
      ? ("waiting" as const)
      : themeWorkbenchRunState === "auto_running"
        ? ("running" as const)
        : ("idle" as const);

    return {
      key: currentGateBase.key,
      title: currentGateBase.title,
      description: currentGateBase.description,
      status,
    };
  }, [currentGateBase, themeWorkbenchRunState]);
  const harnessRequestMetadata = useMemo(
    () =>
      buildHarnessRequestMetadata({
        theme: mappedTheme,
        creationMode,
        chatMode,
        webSearchEnabled: chatToolPreferences.webSearch,
        thinkingEnabled: chatToolPreferences.thinking,
        taskModeEnabled: chatToolPreferences.task,
        subagentModeEnabled: chatToolPreferences.subagent,
        sessionMode: isThemeWorkbench ? "theme_workbench" : "default",
        gateKey: isThemeWorkbench ? currentGate.key : undefined,
        runTitle: themeWorkbenchActiveQueueItem?.title?.trim() || undefined,
        contentId: contentId || undefined,
        browserAssistProfileKey:
          mappedTheme === "general"
            ? GENERAL_BROWSER_ASSIST_PROFILE_KEY
            : undefined,
        preferredTeamPresetId,
        selectedTeamId: selectedTeam?.id,
        selectedTeamSource: selectedTeam?.source,
        selectedTeamLabel,
        selectedTeamSummary,
        selectedTeamRoles: selectedTeam?.roles,
      }),
    [
      chatMode,
      chatToolPreferences.subagent,
      chatToolPreferences.task,
      chatToolPreferences.thinking,
      chatToolPreferences.webSearch,
      contentId,
      creationMode,
      currentGate.key,
      isThemeWorkbench,
      mappedTheme,
      preferredTeamPresetId,
      selectedTeam?.id,
      selectedTeam?.roles,
      selectedTeam?.source,
      selectedTeamLabel,
      selectedTeamSummary,
      themeWorkbenchActiveQueueItem?.title,
    ],
  );
  const refreshToolInventory = useCallback(async () => {
    const requestId = toolInventoryRequestIdRef.current + 1;
    toolInventoryRequestIdRef.current = requestId;
    setToolInventoryLoading(true);
    setToolInventoryError(null);

    try {
      const nextInventory = await getAgentRuntimeToolInventory({
        caller: "assistant",
        creator: chatMode === "creator",
        browserAssist: mappedTheme === "general",
        metadata: {
          harness: harnessRequestMetadata,
        },
      });

      if (toolInventoryRequestIdRef.current !== requestId) {
        return;
      }

      setToolInventory(nextInventory);
    } catch (error) {
      if (toolInventoryRequestIdRef.current !== requestId) {
        return;
      }

      setToolInventoryError(
        error instanceof Error ? error.message : "读取工具库存失败",
      );
    } finally {
      if (toolInventoryRequestIdRef.current === requestId) {
        setToolInventoryLoading(false);
      }
    }
  }, [chatMode, harnessRequestMetadata, mappedTheme]);

  useEffect(() => {
    if (!harnessPanelVisible) {
      return;
    }

    void refreshToolInventory();
  }, [harnessPanelVisible, refreshToolInventory]);

  const socialMediaHarnessSummary = useMemo(() => {
    if (!isThemeWorkbench || mappedTheme !== "social-media") {
      return null;
    }

    const latestTerminal =
      themeWorkbenchBackendRunState?.latest_terminal ?? null;
    const activeRun = themeWorkbenchActiveQueueItem ?? latestTerminal;
    const artifactPaths =
      Array.isArray(themeWorkbenchActiveQueueItem?.artifact_paths) &&
      themeWorkbenchActiveQueueItem.artifact_paths.length > 0
        ? themeWorkbenchActiveQueueItem.artifact_paths
        : Array.isArray(latestTerminal?.artifact_paths) &&
            latestTerminal.artifact_paths.length > 0
          ? latestTerminal.artifact_paths
          : [];

    return {
      runState: themeWorkbenchRunState,
      stageTitle: currentGate.title,
      stageDescription: currentGate.description,
      runTitle: activeRun?.title || null,
      artifactCount: artifactPaths.length,
      updatedAt:
        themeWorkbenchBackendRunState?.updated_at ||
        latestTerminal?.finished_at ||
        latestTerminal?.started_at ||
        themeWorkbenchActiveQueueItem?.started_at ||
        null,
      pendingCount: harnessPendingCount,
    };
  }, [
    currentGate.description,
    currentGate.title,
    harnessPendingCount,
    isThemeWorkbench,
    mappedTheme,
    themeWorkbenchActiveQueueItem,
    themeWorkbenchBackendRunState?.latest_terminal,
    themeWorkbenchBackendRunState?.updated_at,
    themeWorkbenchRunState,
  ]);

  useEffect(() => {
    if (!isThemeWorkbench || themeWorkbenchRunState !== "idle") {
      return;
    }
    if (!canvasState || canvasState.type !== "document") {
      return;
    }

    setDocumentVersionStatusMap((previous) => {
      const latestTerminal = themeWorkbenchBackendRunState?.latest_terminal;
      if (latestTerminal) {
        const terminalVersionId = latestTerminal.run_id;
        const terminalVersionExists = canvasState.versions.some(
          (version) => version.id === terminalVersionId,
        );
        if (terminalVersionExists) {
          const terminalStatus: TopicBranchStatus =
            latestTerminal.status === "success" ? "merged" : "candidate";
          if (previous[terminalVersionId] !== terminalStatus) {
            return {
              ...previous,
              [terminalVersionId]: terminalStatus,
            };
          }
        }
      }

      const currentVersionId = canvasState.currentVersionId;
      if (!currentVersionId || previous[currentVersionId] !== "in_progress") {
        return previous;
      }
      return {
        ...previous,
        [currentVersionId]: "pending",
      };
    });
  }, [
    canvasState,
    isThemeWorkbench,
    themeWorkbenchBackendRunState?.latest_terminal,
    themeWorkbenchRunState,
  ]);

  // 会话文件持久化 hook
  const {
    saveFile: saveSessionFile,
    files: sessionFiles,
    readFile: readSessionFile,
    meta: sessionMeta,
  } = useSessionFiles({
    sessionId,
    theme: mappedTheme,
    creationMode,
    autoInit: true,
  });

  const syncResourceProjectSelection = useCallback(
    (targetProjectId: string | null | undefined) => {
      const normalizedProjectId = normalizeProjectId(targetProjectId);
      if (!normalizedProjectId) {
        return;
      }

      setStoredResourceProjectId(normalizedProjectId, {
        source: "general-chat",
        emitEvent: true,
      });
    },
    [],
  );

  const ensureGeneralResourceHashes = useCallback(
    async (targetProjectId: string) => {
      const existingHashes =
        generalResourceHashesRef.current.get(targetProjectId);
      if (existingHashes) {
        return existingHashes;
      }

      const nextHashes = new Set<string>();

      try {
        const materials = await listMaterials(targetProjectId);
        materials.forEach((material) => {
          const hash = extractGeneralChatResourceHash(material);
          if (hash) {
            nextHashes.add(hash);
          }
        });
      } catch (error) {
        console.warn("[AgentChatPage] 读取资源去重缓存失败:", error);
      }

      generalResourceHashesRef.current.set(targetProjectId, nextHashes);
      return nextHashes;
    },
    [],
  );

  const resolveGeneralArtifactSyncPath = useCallback(
    async (rawFilePath: string): Promise<string | null> => {
      const normalizedFilePath = rawFilePath.trim();
      if (!normalizedFilePath) {
        return null;
      }

      if (
        normalizedFilePath.startsWith("/") ||
        normalizedFilePath.startsWith("~/") ||
        normalizedFilePath.startsWith("\\\\") ||
        /^[A-Za-z]:[\\/]/.test(normalizedFilePath)
      ) {
        return normalizedFilePath;
      }

      if (sessionId) {
        try {
          return await resolveSessionFilePath(sessionId, normalizedFilePath);
        } catch (error) {
          console.warn("[AgentChatPage] 解析会话文件路径失败:", error);
        }
      }

      return (
        resolveAbsoluteWorkspacePath(project?.rootPath, normalizedFilePath) ||
        null
      );
    },
    [project?.rootPath, sessionId],
  );

  const syncGeneralArtifactToResource = useCallback(
    async (input: { rawFilePath: string; preferredName?: string }) => {
      if (activeTheme !== "general") {
        return;
      }

      const normalizedProjectId = normalizeProjectId(projectId);
      const normalizedRawFilePath = input.rawFilePath.trim();
      if (!normalizedProjectId || !normalizedRawFilePath) {
        return;
      }

      const materialType = inferGeneralChatResourceMaterialType(
        normalizedRawFilePath,
      );
      if (!materialType) {
        return;
      }

      const resolvedFilePath = await resolveGeneralArtifactSyncPath(
        normalizedRawFilePath,
      );
      const normalizedResolvedFilePath = resolvedFilePath?.trim();
      if (!normalizedResolvedFilePath) {
        return;
      }

      const pathHash = buildGeneralChatResourceHash(normalizedResolvedFilePath);
      const dedupeKey = `${normalizedProjectId}:${pathHash}`;
      if (generalResourceSyncInFlightRef.current.has(dedupeKey)) {
        return;
      }

      const knownHashes =
        await ensureGeneralResourceHashes(normalizedProjectId);
      if (knownHashes.has(pathHash)) {
        return;
      }

      generalResourceSyncInFlightRef.current.add(dedupeKey);
      try {
        await uploadMaterial({
          projectId: normalizedProjectId,
          name:
            input.preferredName?.trim() ||
            extractFileNameFromPath(normalizedResolvedFilePath),
          type: materialType,
          filePath: normalizedResolvedFilePath,
          tags: buildGeneralChatResourceTags(
            normalizedResolvedFilePath,
            sessionId,
          ),
          description: buildGeneralChatResourceDescription(sessionId),
        });

        knownHashes.add(pathHash);
        syncResourceProjectSelection(normalizedProjectId);
      } catch (error) {
        console.warn("[AgentChatPage] 自动补录资源失败:", error);
      } finally {
        generalResourceSyncInFlightRef.current.delete(dedupeKey);
      }
    },
    [
      activeTheme,
      ensureGeneralResourceHashes,
      projectId,
      resolveGeneralArtifactSyncPath,
      sessionId,
      syncResourceProjectSelection,
    ],
  );

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    syncResourceProjectSelection(projectId);
  }, [activeTheme, projectId, syncResourceProjectSelection]);

  // 监听画布状态变化，自动同步到 Content
  useEffect(() => {
    if (!canvasState || !contentId) {
      return;
    }

    try {
      const content = serializeCanvasStateForSync(canvasState);
      if (isSyncContentEmpty(content)) {
        return;
      }

      const previousRequest = lastCanvasSyncRequestRef.current;
      if (
        previousRequest?.contentId === contentId &&
        previousRequest.body === content
      ) {
        return;
      }

      lastCanvasSyncRequestRef.current = { contentId, body: content };
      syncContent(contentId, content);
    } catch (error) {
      console.error("提取画布内容失败:", error);
    }
  }, [canvasState, contentId, syncContent]);

  // 追踪已恢复元数据和文件的会话 ID
  const restoredMetaSessionId = useRef<string | null>(null);
  const restoredFilesSessionId = useRef<string | null>(null);
  // 用于追踪是否已触发过 AI 引导
  const hasTriggeredGuide = useRef(false);
  const consumedInitialPromptRef = useRef<string | null>(null);
  const [runtimeTeamDispatchPreview, setRuntimeTeamDispatchPreview] =
    useState<RuntimeTeamDispatchPreviewSnapshot | null>(null);
  const {
    initialDispatchKey,
    isBootstrapDispatchPending,
    bootstrapDispatchPreviewMessages,
  } = useBootstrapDispatchPreview({
    initialUserPrompt,
    initialUserImages,
    messagesCount: messages.length,
    isSending,
    queuedTurnCount: queuedTurns.length,
    consumedInitialPromptKey: consumedInitialPromptRef.current,
    shouldUseCompactThemeWorkbench,
  });
  const {
    themeWorkbenchEntryPrompt,
    themeWorkbenchEntryCheckPending,
    clearThemeWorkbenchEntryPrompt,
    dismissThemeWorkbenchEntryPrompt,
  } = useThemeWorkbenchEntryPrompt({
    activeTheme,
    contentId: contentId ?? undefined,
    sessionId: sessionId ?? undefined,
    isThemeWorkbench,
    shouldUseCompactThemeWorkbench,
    messagesCount: messages.length,
    initialDispatchKey,
    initialUserPrompt,
    initialUserImages,
    consumedInitialPromptKey: consumedInitialPromptRef.current,
    onHydrateInitialPrompt: useCallback((prompt: string) => {
      hasTriggeredGuide.current = true;
      setInput((previous) => previous.trim() || prompt);
    }, []),
  });
  useEffect(() => {
    setRuntimeTeamDispatchPreview(null);
  }, [sessionId]);
  useEffect(() => {
    if (!runtimeTeamDispatchPreview) {
      return;
    }

    if (messages.length > runtimeTeamDispatchPreview.baseMessageCount) {
      setRuntimeTeamDispatchPreview(null);
    }
  }, [messages.length, runtimeTeamDispatchPreview]);
  useEffect(() => {
    if (
      !runtimeTeamDispatchPreview ||
      runtimeTeamDispatchPreview.status === "failed" ||
      runtimeTeamState?.status !== "failed"
    ) {
      return;
    }

    setRuntimeTeamDispatchPreview((current) =>
      current
        ? {
            ...current,
            status: "failed",
            failureMessage: runtimeTeamState.errorMessage?.trim() || null,
          }
        : null,
    );
  }, [runtimeTeamDispatchPreview, runtimeTeamState]);
  const consumeInitialPrompt = useCallback(
    (dispatchKey: string) => {
      consumedInitialPromptRef.current = dispatchKey;
      onInitialUserPromptConsumed?.();
    },
    [onInitialUserPromptConsumed],
  );
  const resetConsumedInitialPrompt = useCallback(() => {
    consumedInitialPromptRef.current = null;
  }, []);
  const prepareBrowserTaskPreflight = useCallback(
    (preflight: BrowserTaskPreflight) => {
      setInput("");
      setMentionedCharacters([]);
      setBrowserTaskPreflight(preflight);
    },
    [],
  );
  const {
    resolveSendBoundary,
    isBlockedByBrowserPreflight,
    maybeStartBrowserTaskPreflight,
    finalizeAfterSendSuccess,
    rollbackAfterSendFailure,
  } = useThemeWorkbenchSendBoundary({
    isThemeWorkbench,
    contentId,
    initialDispatchKey,
    consumedInitialPromptKey: consumedInitialPromptRef.current,
    initialUserImages,
    mappedTheme,
    socialArticleSkillKey: SOCIAL_ARTICLE_SKILL_KEY,
    isBrowserAssistReady,
    browserTaskPreflight,
    onConsumeInitialPrompt: consumeInitialPrompt,
    onResetConsumedInitialPrompt: resetConsumedInitialPrompt,
    onClearEntryPrompt: clearThemeWorkbenchEntryPrompt,
    onPrepareBrowserTaskPreflight: prepareBrowserTaskPreflight,
  });

  // 当 sessionMeta 加载完成时，恢复主题和创建模式
  useEffect(() => {
    if (!sessionId || !sessionMeta) {
      return;
    }

    // 检查 sessionMeta 是否属于当前 sessionId
    if (sessionMeta.sessionId !== sessionId) {
      return;
    }

    // 避免重复恢复
    if (restoredMetaSessionId.current === sessionId) {
      return;
    }

    console.log("[AgentChatPage] 恢复会话元数据:", sessionId, sessionMeta);

    // 从会话元数据恢复主题（类型已统一，直接使用）
    if (sessionMeta.theme && (!lockTheme || !initialTheme)) {
      // 通用对话入口（initialTheme 为空或 "general"）不应恢复为内容创作主题，
      // 避免切换历史任务时错误激活社媒等创作模式
      const entryIsGeneral = !initialTheme || initialTheme === "general";
      const restoredIsCreation = isContentCreationTheme(sessionMeta.theme);
      if (entryIsGeneral && restoredIsCreation) {
        console.log(
          "[AgentChatPage] 通用对话入口，跳过恢复内容创作主题:",
          sessionMeta.theme,
        );
      } else {
        console.log("[AgentChatPage] 恢复主题:", sessionMeta.theme);
        setActiveTheme(sessionMeta.theme);
      }
    }

    // 从会话元数据恢复创建模式
    if (sessionMeta.creationMode) {
      console.log("[AgentChatPage] 恢复创建模式:", sessionMeta.creationMode);
      setCreationMode(sessionMeta.creationMode as CreationMode);
    }

    restoredMetaSessionId.current = sessionId;
  }, [sessionId, sessionMeta, lockTheme, initialTheme]);

  // 当 sessionFiles 加载完成时，恢复文件到 taskFiles
  useEffect(() => {
    if (!sessionId || sessionFiles.length === 0) {
      return;
    }

    // 避免重复恢复
    if (restoredFilesSessionId.current === sessionId) {
      return;
    }

    // 如果当前已有 taskFiles，说明是本次会话新生成的文件，不需要从持久化恢复
    if (taskFiles.length > 0) {
      restoredFilesSessionId.current = sessionId;
      return;
    }

    console.log(
      "[AgentChatPage] 开始恢复文件:",
      sessionId,
      sessionFiles.length,
      "个文件",
    );

    // 恢复文件到 taskFiles
    const restoreFiles = async () => {
      const restoredFiles: TaskFile[] = [];

      for (const file of sessionFiles) {
        try {
          const content = await readSessionFile(file.name);
          if (content) {
            restoredFiles.push({
              id: crypto.randomUUID(),
              name: file.name,
              type: normalizeSessionTaskFileType(
                file.fileType,
                file.name,
                content,
              ),
              content,
              version: 1,
              createdAt: file.createdAt,
              updatedAt: file.updatedAt,
            });
          }
        } catch (err) {
          console.error("[AgentChatPage] 恢复文件失败:", file.name, err);
        }
      }

      if (restoredFiles.length > 0) {
        console.log(
          "[AgentChatPage] 从持久化存储恢复",
          restoredFiles.length,
          "个文件",
        );
        setTaskFiles(restoredFiles);
      }
      restoredFilesSessionId.current = sessionId;
    };

    restoreFiles();
  }, [sessionId, sessionFiles, readSessionFile, taskFiles.length]);

  const resetTopicLocalState = useCallback(() => {
    setLayoutMode("chat");
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    clearRuntimeTeamState();
    setBrowserTaskPreflight(null);
    setSelectedFileId(undefined);
    processedMessageIds.current.clear();
    restoredMetaSessionId.current = null;
    restoredFilesSessionId.current = null;
    hasTriggeredGuide.current = false;
    consumedInitialPromptRef.current = null;
  }, [clearRuntimeTeamState]);

  const runTopicSwitch = useCallback(
    async (topicId: string) => {
      const startedAt = Date.now();
      logAgentDebug("AgentChatPage", "runTopicSwitch.start", {
        currentProjectId: projectId ?? null,
        topicId,
      });
      resetTopicLocalState();
      try {
        await originalSwitchTopic(topicId);
        logAgentDebug("AgentChatPage", "runTopicSwitch.success", {
          durationMs: Date.now() - startedAt,
          topicId,
        });
      } catch (error) {
        logAgentDebug(
          "AgentChatPage",
          "runTopicSwitch.error",
          {
            durationMs: Date.now() - startedAt,
            error,
            topicId,
          },
          { level: "error" },
        );
        throw error;
      }
    },
    [originalSwitchTopic, projectId, resetTopicLocalState],
  );

  const switchTopic = useCallback(
    async (topicId: string) => {
      if (!startTopicProjectResolution()) {
        logAgentDebug(
          "AgentChatPage",
          "switchTopic.skipWhileResolving",
          { topicId },
          { level: "warn", throttleMs: 1000 },
        );
        return;
      }

      try {
        logAgentDebug("AgentChatPage", "switchTopic.start", {
          currentProjectId: projectId ?? null,
          externalProjectId: externalProjectId ?? null,
          topicId,
        });
        const decision = await resolveTopicSwitchProject({
          lockedProjectId: externalProjectId ?? null,
          topicBoundProjectId: loadPersistedProjectId(
            `${TOPIC_PROJECT_KEY_PREFIX}${topicId}`,
          ),
          lastProjectId: getRememberedProjectId(),
          loadProjectById: async (candidateProjectId) => {
            const project = await getProject(candidateProjectId);
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
          loadDefaultProject: async () => {
            const project = await getDefaultProject();
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
          createDefaultProject: async () => {
            const project = await getOrCreateDefaultProject();
            return project
              ? { id: project.id, isArchived: project.isArchived }
              : null;
          },
        });
        logAgentDebug("AgentChatPage", "switchTopic.decision", {
          createdDefault:
            decision.status === "ok" ? decision.createdDefault : false,
          decisionStatus: decision.status,
          projectId: decision.status === "ok" ? decision.projectId : null,
          topicId,
        });

        if (decision.status === "blocked") {
          toast.error("该任务绑定了其他项目，请先切换到对应项目");
          return;
        }

        if (decision.status === "missing") {
          toast.error("未找到可用项目，请先创建项目");
          return;
        }

        const targetProjectId = decision.projectId;
        if (decision.createdDefault) {
          toast.info("未找到可用项目，已自动创建默认项目");
        }

        const currentProjectId = normalizeProjectId(projectId);
        if (currentProjectId !== targetProjectId) {
          deferTopicSwitch(topicId, targetProjectId);
          logAgentDebug("AgentChatPage", "switchTopic.deferUntilProjectReady", {
            currentProjectId,
            targetProjectId,
            topicId,
          });
          return;
        }

        rememberProjectId(targetProjectId);
        await runTopicSwitch(topicId);
      } catch (error) {
        console.error("[AgentChatPage] 解析任务项目失败:", error);
        logAgentDebug(
          "AgentChatPage",
          "switchTopic.error",
          {
            error,
            projectId: projectId ?? null,
            topicId,
          },
          { level: "error" },
        );
        toast.error("切换任务失败，请稍后重试");
      } finally {
        finishTopicProjectResolution();
      }
    },
    [
      deferTopicSwitch,
      externalProjectId,
      finishTopicProjectResolution,
      getRememberedProjectId,
      projectId,
      rememberProjectId,
      runTopicSwitch,
      startTopicProjectResolution,
    ],
  );

  useTrayModelShortcuts({
    providerType,
    setProviderType,
    model,
    setModel,
    activeTheme: mappedTheme,
    deferInitialSync: false,
  });

  useEffect(() => {
    const pending = consumePendingTopicSwitch(projectId);
    if (!pending) {
      return;
    }

    const currentProjectId = normalizeProjectId(projectId);
    logAgentDebug("AgentChatPage", "switchTopic.resumePending", {
      projectId: currentProjectId,
      topicId: pending.topicId,
    });
    runTopicSwitch(pending.topicId).catch((error) => {
      console.error("[AgentChatPage] 执行待切换任务失败:", error);
      logAgentDebug(
        "AgentChatPage",
        "switchTopic.resumePendingError",
        {
          error,
          projectId: currentProjectId,
          topicId: pending.topicId,
        },
        { level: "error" },
      );
      toast.error("加载任务失败，请重试");
    });
  }, [consumePendingTopicSwitch, projectId, runTopicSwitch]);

  /**
   * 从 AI 响应中提取文档内容
   * 支持多种格式：
   * 1. <document>...</document> 标签（推荐）
   * 2. ```markdown ... ``` 代码块
   * 3. 以 # 开头的 Markdown 内容（仅非主题工作台）
   */
  const extractDocumentContent = useCallback(
    (content: string): string | null => {
      // 1. 检查 <document> 标签
      const documentMatch = content.match(/<document>([\s\S]*?)<\/document>/);
      if (documentMatch) {
        return documentMatch[1].trim();
      }

      // 2. 检查 markdown 代码块
      const markdownMatch = content.match(/```(?:markdown|md)\n([\s\S]*?)```/);
      if (markdownMatch) {
        return markdownMatch[1].trim();
      }

      // 3. 主题工作台：不使用启发式规则，避免误判普通回复
      if (isThemeWorkbench) {
        return null;
      }

      // 4. 非主题工作台：如果整个内容以 # 开头且长度超过 200 字符，认为是文档
      if (content.trim().startsWith("#") && content.length > 200) {
        return content.trim();
      }

      return null;
    },
    [isThemeWorkbench],
  );

  const looksLikeSerializedNovelState = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return false;

    const jsonCandidate =
      trimmed.match(/^```json\s*([\s\S]*?)```$/i)?.[1] || trimmed;

    if (!(jsonCandidate.startsWith("[") || jsonCandidate.startsWith("{"))) {
      return false;
    }

    return (
      jsonCandidate.includes('"title"') &&
      (jsonCandidate.includes('"number"') ||
        jsonCandidate.includes('"chapters"'))
    );
  }, []);

  const upsertNovelCanvasState = useCallback(
    (prev: CanvasStateUnion | null, content: string) => {
      if (!prev || prev.type !== "novel") {
        return createInitialNovelState(content);
      }

      if (looksLikeSerializedNovelState(content)) {
        return createInitialNovelState(content);
      }

      const targetChapterId =
        prev.currentChapterId || prev.chapters[0]?.id || crypto.randomUUID();
      const now = Date.now();

      if (prev.chapters.length === 0) {
        const initialized = createInitialNovelState(content);
        return {
          ...initialized,
          currentChapterId: initialized.chapters[0]?.id || targetChapterId,
        };
      }

      return {
        ...prev,
        chapters: prev.chapters.map((chapter) =>
          chapter.id === targetChapterId
            ? {
                ...chapter,
                content,
                wordCount: countNovelWords(content),
                updatedAt: now,
              }
            : chapter,
        ),
      };
    },
    [looksLikeSerializedNovelState],
  );

  // 监听 AI 消息变化，自动提取文档内容
  useEffect(() => {
    if (!isContentCreationMode) return;

    // 找到最新的 assistant 消息
    const lastAssistantMsg = [...messages]
      .reverse()
      .find(
        (msg) =>
          msg.role === "assistant" &&
          !msg.isThinking &&
          msg.content &&
          msg.purpose !== "content_review" &&
          msg.purpose !== "style_audit",
      );

    if (!lastAssistantMsg) return;

    // 主题工作台 fallback：仅在 AI 未使用 write_file 且画布为空时提取
    if (isThemeWorkbench) {
      const hasWriteFileToolCall = lastAssistantMsg.toolCalls?.some((tc) => {
        const name = (tc.name || "").toLowerCase();
        return name.includes("write") || name.includes("create_file");
      });
      if (hasWriteFileToolCall) return;
      if (canvasState && !isCanvasStateEmpty(canvasState)) return;
    }

    // 检查是否已处理过
    if (processedMessageIds.current.has(lastAssistantMsg.id)) return;

    // 提取文档内容
    const docContent = extractDocumentContent(lastAssistantMsg.content);
    if (docContent) {
      // 标记为已处理
      processedMessageIds.current.add(lastAssistantMsg.id);

      // 更新画布内容（仅文档类型画布支持流式更新）
      setCanvasState((prev) => {
        // 如果是海报主题，不自动更新画布
        if (mappedTheme === "poster") {
          return prev;
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(prev, docContent);
        }

        if (!prev || prev.type !== "document") {
          return createInitialDocumentState(docContent);
        }
        // 添加新版本
        const newVersion = {
          id: crypto.randomUUID(),
          content: docContent,
          createdAt: Date.now(),
          description: `AI 生成 - 版本 ${prev.versions.length + 1}`,
        };
        return {
          ...prev,
          content: docContent,
          versions: [...prev.versions, newVersion],
          currentVersionId: newVersion.id,
        };
      });

      // 自动打开画布
      setLayoutMode("chat-canvas");
    }
  }, [
    messages,
    isContentCreationMode,
    isThemeWorkbench,
    extractDocumentContent,
    mappedTheme,
    upsertNovelCanvasState,
    canvasState,
  ]);

  const ensureBrowserAssistCanvasRef = useRef<
    (
      sourceText: string,
      options?: {
        silent?: boolean;
        navigationMode?: "none" | "explicit-url" | "best-effort";
      },
    ) => Promise<boolean>
  >(async () => false);

  const runBrowserTaskPreflight = useCallback(
    async (preflight: BrowserTaskPreflight) => {
      setBrowserTaskPreflight((current) =>
        current?.requestId === preflight.requestId
          ? {
              ...current,
              phase: "launching",
              detail: current.detail,
            }
          : current,
      );

      const launchInput = preflight.launchUrl || preflight.sourceText;
      const navigationMode =
        preflight.launchUrl && preflight.launchUrl !== preflight.sourceText
          ? ("explicit-url" as const)
          : ("best-effort" as const);

      try {
        const launched = await ensureBrowserAssistCanvasRef.current(
          launchInput,
          {
            silent: false,
            navigationMode,
          },
        );

        setBrowserTaskPreflight((current) => {
          if (current?.requestId !== preflight.requestId) {
            return current;
          }

          if (!launched) {
            return {
              ...current,
              phase: "failed",
              detail:
                "还没有建立可用的浏览器会话。请确认本机浏览器/CDP 可用后重试。",
            };
          }

          return {
            ...current,
            phase: "awaiting_user",
            detail:
              preflight.requirement === "required_with_user_step"
                ? `已为你打开${preflight.platformLabel || "浏览器协助"}。请先在右侧浏览器完成登录、扫码、验证码或授权，再继续当前任务。`
                : "浏览器已经准备好。请确认右侧页面可操作后继续当前任务。",
          };
        });
      } catch (error) {
        setBrowserTaskPreflight((current) => {
          if (current?.requestId !== preflight.requestId) {
            return current;
          }

          return {
            ...current,
            phase: "failed",
            detail:
              error instanceof Error && error.message
                ? error.message
                : "启动浏览器协助失败，请稍后重试。",
          };
        });
      }
    },
    [],
  );

  const handleSend = useCallback(
    async (
      images?: MessageImage[],
      webSearch?: boolean,
      thinking?: boolean,
      textOverride?: string,
      sendExecutionStrategy?: "react" | "code_orchestrated" | "auto",
      autoContinuePayload?: AutoContinueRequestPayload,
      sendOptions?: HandleSendOptions,
    ) => {
      let sourceText = textOverride ?? input;
      if (!sourceText.trim() && (!images || images.length === 0)) return false;
      const sendBoundary = resolveSendBoundary({
        sourceText,
        sendOptions,
      });
      sourceText = sendBoundary.sourceText;
      if (isBlockedByBrowserPreflight(sendOptions)) {
        toast.info("请先完成当前浏览器准备后，再继续发送新的任务");
        return false;
      }
      const effectiveToolPreferences =
        sendOptions?.toolPreferencesOverride ?? chatToolPreferences;

      const { browserRequirementMatch } = sendBoundary;
      const requestedWebSearch =
        webSearch ?? effectiveToolPreferences.webSearch;
      const effectiveWebSearch =
        browserRequirementMatch &&
        browserRequirementMatch.requirement !== "optional"
          ? false
          : requestedWebSearch;
      const effectiveThinking = thinking ?? effectiveToolPreferences.thinking;

      if (!projectId) {
        sendOptions?.observer?.onError?.("请先选择项目后再开始对话");
        toast.error("请先选择项目后再开始对话");
        return false;
      }

      if (
        maybeStartBrowserTaskPreflight({
          boundary: sendBoundary,
          images,
          webSearch,
          thinking,
          sendExecutionStrategy,
          autoContinuePayload,
          sendOptions,
        })
      ) {
        return true;
      }

      let text = sourceText;

      const preparedActiveContextPrompt = contextWorkspace.enabled
        ? await contextWorkspace.prepareActiveContextPrompt()
        : "";

      if (contextWorkspace.enabled && preparedActiveContextPrompt) {
        const slashCommandMatch = text.match(
          /^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/,
        );
        if (slashCommandMatch) {
          const [, skillName, skillArgs] = slashCommandMatch;
          const mergedArgs = [preparedActiveContextPrompt, skillArgs.trim()]
            .filter((part) => part.length > 0)
            .join("\n\n");
          text = `/${skillName} ${mergedArgs}`.trim();
        } else {
          text = `${preparedActiveContextPrompt}\n\n${text}`;
        }
      }

      // 如果有引用的角色，注入角色信息
      if (mentionedCharacters.length > 0) {
        const characterContext = mentionedCharacters
          .map((char) => {
            let context = `角色：${char.name}`;
            if (char.description) context += `\n简介：${char.description}`;
            if (char.personality) context += `\n性格：${char.personality}`;
            if (char.background) context += `\n背景：${char.background}`;
            return context;
          })
          .join("\n\n");

        text = `[角色上下文]\n${characterContext}\n\n[用户输入]\n${text}`;
      }

      if (!sendOptions?.purpose && runtimeStyleMessagePrompt) {
        text = `[本次任务风格要求]\n${runtimeStyleMessagePrompt}\n\n[用户输入]\n${text}`;
      }

      if (browserRequirementMatch) {
        void ensureBrowserAssistCanvasRef
          .current(browserRequirementMatch.launchUrl || sourceText, {
            silent: true,
            navigationMode:
              browserRequirementMatch.launchUrl &&
              browserRequirementMatch.launchUrl !== sourceText
                ? "explicit-url"
                : "best-effort",
          })
          .catch((error) => {
            console.warn(
              "[AgentChatPage] 强浏览器任务发送前准备浏览器失败，继续由主流程处理:",
              error,
            );
          });
      } else {
        preheatBrowserAssistInBackground({
          activeTheme,
          sourceText,
          ensureBrowserAssistCanvas: ensureBrowserAssistCanvasRef.current,
          onError: (error) => {
            console.warn(
              "[AgentChatPage] 发送前预热浏览器协助失败，继续发送消息:",
              error,
            );
          },
        });
      }

      setRuntimeTeamDispatchPreview(null);

      try {
        const { selectedProvider, providerModels } =
          await resolveSendProviderContext();
        const memoryParams = {
          scope: "aster" as const,
          workspaceId: projectId,
          sessionId,
          providerKey: providerType,
        };
        const rememberedBaseModel = loadRememberedBaseModel(memoryParams);
        let effectiveModel = model;

        if (effectiveThinking) {
          if (!isReasoningModel(model, providerModels)) {
            saveRememberedBaseModel({
              ...memoryParams,
              modelId: model,
            });
          }

          const thinkingResult = resolveThinkingModel({
            currentModelId: model,
            models: providerModels,
          });
          effectiveModel = thinkingResult.targetModelId;

          if (thinkingResult.switched) {
            setModel(thinkingResult.targetModelId);
          } else if (
            thinkingResult.reason === "no_variant" &&
            providerModels.length > 0
          ) {
            const warnKey = `${providerType}:${model}`;
            if (!thinkingVariantWarnedRef.current.has(warnKey)) {
              thinkingVariantWarnedRef.current.add(warnKey);
              toast.warning(
                "当前 Provider 没有可用的 Thinking 模型，已保持原模型",
              );
            }
          }
        } else {
          const restoreResult = resolveBaseModelOnThinkingOff({
            currentModelId: model,
            models: providerModels,
            rememberedBaseModel,
          });
          effectiveModel = restoreResult.targetModelId;

          if (restoreResult.switched) {
            setModel(restoreResult.targetModelId);
          }
        }

        const compatibilityResult = resolveProviderModelCompatibility({
          providerType,
          configuredProviderType: selectedProvider?.type,
          model: effectiveModel,
        });
        if (compatibilityResult.changed) {
          effectiveModel = compatibilityResult.model;
          if (model !== compatibilityResult.model) {
            setModel(compatibilityResult.model);
          }
          if (compatibilityResult.reason) {
            toast.warning(compatibilityResult.reason);
          }
        }

        if ((images?.length || 0) > 0) {
          const visionResult = resolveVisionModel({
            currentModelId: effectiveModel,
            models: providerModels,
          });

          if (visionResult.reason === "no_vision_model") {
            toast.error(
              "当前 Provider 没有可用的多模态模型，请切换到支持多模态的 Provider 或模型后再发送图片",
            );
            return false;
          }

          if (visionResult.reason !== "already_vision") {
            const suggestedModel = visionResult.targetModelId.trim();
            toast.error(
              suggestedModel
                ? `当前模型 ${effectiveModel} 不支持多模态图片理解，请切换到 ${suggestedModel} 或其他支持多模态的模型后再发送图片`
                : `当前模型 ${effectiveModel} 不支持多模态图片理解，请切换到支持多模态的模型后再发送图片`,
            );
            return false;
          }
        }

        const shouldPrepareRuntimeTeam = shouldPrepareRuntimeTeamBeforeSend({
          subagentEnabled: effectiveToolPreferences.subagent,
          projectId,
          input: sourceText,
          purpose: sendOptions?.purpose,
        });

        if (shouldPrepareRuntimeTeam) {
          setRuntimeTeamDispatchPreview({
            key: crypto.randomUUID(),
            prompt: sourceText,
            images: images || [],
            baseMessageCount: messages.length,
            status: "forming",
          });
        }

        const preparedRuntimeTeamState = await prepareRuntimeTeamBeforeSend({
          input: sourceText,
          providerType,
          model: effectiveModel,
          executionStrategy: sendExecutionStrategy ?? executionStrategy,
          purpose: sendOptions?.purpose,
          subagentEnabled: effectiveToolPreferences.subagent,
        });
        const turnTeamBlueprint =
          preparedRuntimeTeamState?.status === "formed" &&
          preparedRuntimeTeamState.members.length > 0
            ? {
                label: preparedRuntimeTeamState.label?.trim() || undefined,
                description:
                  preparedRuntimeTeamState.summary?.trim() || undefined,
                roles: preparedRuntimeTeamState.members.map((member) => ({
                  id: member.id,
                  label: member.label,
                  summary: member.summary,
                  profileId: member.profileId,
                  roleKey: member.roleKey,
                  skillIds: [...member.skillIds],
                })),
              }
            : undefined;
        const turnTeamDecision =
          preparedRuntimeTeamState?.status === "formed"
            ? "team_prepared"
            : "single_agent";
        const turnTeamReason =
          preparedRuntimeTeamState?.status === "formed"
            ? "runtime_team_prepared"
            : preparedRuntimeTeamState?.status === "failed"
              ? "runtime_team_generation_failed"
              : !effectiveToolPreferences.subagent
                ? "subagent_disabled"
                : sendOptions?.purpose
                  ? "turn_purpose_override"
                  : "single_agent_direct";

        setInput("");
        setMentionedCharacters([]); // 清空引用的角色

        const existingHarnessMetadata = extractExistingHarnessMetadata(
          sendOptions?.requestMetadata,
        );
        const nextSendOptions: HandleSendOptions = {
          ...(sendOptions || {}),
          requestMetadata: {
            ...(sendOptions?.requestMetadata || {}),
            harness: buildHarnessRequestMetadata({
              base: existingHarnessMetadata,
              theme: mappedTheme,
              creationMode,
              chatMode,
              webSearchEnabled: effectiveWebSearch,
              thinkingEnabled: effectiveThinking,
              taskModeEnabled: effectiveToolPreferences.task,
              subagentModeEnabled: effectiveToolPreferences.subagent,
              sessionMode: isThemeWorkbench ? "theme_workbench" : "default",
              gateKey: isThemeWorkbench ? currentGate.key : undefined,
              runTitle:
                themeWorkbenchActiveQueueItem?.title?.trim() || undefined,
              contentId: contentId || undefined,
              browserRequirement: browserRequirementMatch?.requirement,
              browserRequirementReason: browserRequirementMatch?.reason,
              browserLaunchUrl: browserRequirementMatch?.launchUrl,
              browserAssistProfileKey:
                mappedTheme === "general"
                  ? GENERAL_BROWSER_ASSIST_PROFILE_KEY
                  : undefined,
              preferredTeamPresetId,
              selectedTeamId: selectedTeam?.id,
              selectedTeamSource: selectedTeam?.source,
              selectedTeamLabel,
              selectedTeamSummary,
              selectedTeamRoles: selectedTeam?.roles,
              turnTeamDecision,
              turnTeamReason,
              turnTeamBlueprint,
            }),
          },
        };

        if (autoContinuePayload) {
          await sendMessage(
            text,
            images || [],
            effectiveWebSearch,
            effectiveThinking,
            false,
            sendExecutionStrategy,
            effectiveModel,
            autoContinuePayload,
            nextSendOptions,
          );
        } else {
          await sendMessage(
            text,
            images || [],
            effectiveWebSearch,
            effectiveThinking,
            false,
            sendExecutionStrategy,
            effectiveModel,
            undefined,
            nextSendOptions,
          );
        }

        finalizeAfterSendSuccess(sendBoundary);

        return true;
      } catch (error) {
        rollbackAfterSendFailure(sendBoundary);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        setRuntimeTeamDispatchPreview((current) =>
          current
            ? {
                ...current,
                status: "failed",
                failureMessage: errorMessage,
              }
            : null,
        );
        sendOptions?.observer?.onError?.(errorMessage);
        console.error("[AgentChat] 发送消息失败:", error);
        toast.error(`发送失败: ${errorMessage}`);
        // 恢复输入内容，让用户可以重试
        setInput(sourceText);
        return false;
      }
    },
    [
      chatToolPreferences,
      contextWorkspace,
      input,
      creationMode,
      contentId,
      currentGate.key,
      chatMode,
      isThemeWorkbench,
      mentionedCharacters,
      mappedTheme,
      activeTheme,
      executionStrategy,
      messages.length,
      model,
      projectId,
      preferredTeamPresetId,
      selectedTeam?.id,
      selectedTeam?.roles,
      selectedTeam?.source,
      selectedTeamLabel,
      selectedTeamSummary,
      providerType,
      finalizeAfterSendSuccess,
      isBlockedByBrowserPreflight,
      maybeStartBrowserTaskPreflight,
      prepareRuntimeTeamBeforeSend,
      resolveSendBoundary,
      resolveSendProviderContext,
      rollbackAfterSendFailure,
      runtimeStyleMessagePrompt,
      sendMessage,
      sessionId,
      setModel,
      themeWorkbenchActiveQueueItem?.title,
    ],
  );

  const handleRecommendationClick = useCallback(
    (shortLabel: string, fullPrompt: string) => {
      setInput(fullPrompt);

      if (
        activeTheme !== "general" ||
        !isTeamRuntimeRecommendation(shortLabel, fullPrompt)
      ) {
        return;
      }

      const nextToolPreferences = chatToolPreferences.subagent
        ? chatToolPreferences
        : {
            ...chatToolPreferences,
            subagent: true,
          };

      if (!chatToolPreferences.subagent) {
        setChatToolPreferences(nextToolPreferences);
      }
      saveChatToolPreferences(nextToolPreferences, activeTheme);
      void handleSend(
        [],
        nextToolPreferences.webSearch,
        nextToolPreferences.thinking,
        fullPrompt,
        executionStrategy,
        undefined,
        {
          toolPreferencesOverride: nextToolPreferences,
        },
      );
    },
    [
      activeTheme,
      chatToolPreferences,
      executionStrategy,
      handleSend,
      setChatToolPreferences,
    ],
  );

  const handleSendRef = useRef(handleSend);
  const webSearchPreferenceRef = useRef(chatToolPreferences.webSearch);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  useEffect(() => {
    webSearchPreferenceRef.current = chatToolPreferences.webSearch;
  }, [chatToolPreferences.webSearch]);

  const { handleContinueThemeWorkbenchEntryPrompt,
    handleRestartThemeWorkbenchEntryPrompt } =
    useThemeWorkbenchEntryPromptActions({
      themeWorkbenchEntryPrompt,
      input,
      initialDispatchKey,
      onContinuePrompt: async (promptToSend) => {
        await handleSendRef.current(
          [],
          webSearchPreferenceRef.current,
          chatToolPreferences.thinking,
          promptToSend,
        );
      },
      dismissThemeWorkbenchEntryPrompt,
      onConsumeInitialPrompt: (dispatchKey) => {
        consumedInitialPromptRef.current = dispatchKey;
        onInitialUserPromptConsumed?.();
      },
      onInputChange: setInput,
      onRequirePrompt: () => {
        toast.info("请先补充要继续执行的内容");
      },
    });

  const themeWorkbenchEntryPromptAccessory = useMemo(
    () =>
      themeWorkbenchEntryPrompt ? (
        <ThemeWorkbenchEntryPromptAccessory
          prompt={themeWorkbenchEntryPrompt}
          onRestart={handleRestartThemeWorkbenchEntryPrompt}
          onContinue={handleContinueThemeWorkbenchEntryPrompt}
        />
      ) : null,
    [
      handleContinueThemeWorkbenchEntryPrompt,
      handleRestartThemeWorkbenchEntryPrompt,
      themeWorkbenchEntryPrompt,
    ],
  );

  useEffect(() => {
    if (!browserTaskPreflight) {
      return;
    }

    if (isBrowserAssistReady) {
      if (
        browserTaskPreflight.phase === "launching" ||
        browserTaskPreflight.phase === "failed"
      ) {
        setBrowserTaskPreflight((current) =>
          current?.requestId === browserTaskPreflight.requestId
            ? {
                ...current,
                phase: "awaiting_user",
                detail:
                  current.requirement === "required_with_user_step"
                    ? `浏览器已经连接。请先在右侧完成${current.platformLabel || "目标站点"}登录、扫码或验证码，然后继续当前任务。`
                    : "浏览器已经连接，请确认页面可操作后继续当前任务。",
              }
            : current,
        );
      }
      return;
    }

    if (
      browserTaskPreflight.phase === "awaiting_user" ||
      browserTaskPreflight.phase === "ready_to_resume"
    ) {
      setBrowserTaskPreflight((current) =>
        current?.requestId === browserTaskPreflight.requestId
          ? {
              ...current,
              phase: "failed",
              detail: "浏览器会话已断开，请重新启动浏览器后再继续。",
            }
          : current,
      );
    }
  }, [browserTaskPreflight, isBrowserAssistReady]);

  const handlePermissionResponseWithBrowserPreflight = useCallback(
    async (response: {
      requestId: string;
      confirmed: boolean;
      response?: string;
      actionType?: "tool_confirmation" | "ask_user" | "elicitation";
      userData?: unknown;
    }) => {
      if (
        !browserTaskPreflight ||
        response.requestId !== browserTaskPreflight.requestId
      ) {
        await handlePermissionResponse(response);
        return;
      }

      const userData =
        response.userData && typeof response.userData === "object"
          ? (response.userData as Record<string, unknown>)
          : null;
      const browserAction =
        typeof userData?.browserAction === "string"
          ? userData.browserAction
          : "";

      if (browserAction === "launch") {
        await runBrowserTaskPreflight(browserTaskPreflight);
        return;
      }

      if (browserAction === "continue") {
        if (!isBrowserAssistReady) {
          setBrowserTaskPreflight((current) =>
            current?.requestId === browserTaskPreflight.requestId
              ? {
                  ...current,
                  phase: "failed",
                  detail: "尚未检测到可用的浏览器会话，请先启动或恢复浏览器。",
                }
              : current,
          );
          toast.error("浏览器还没有准备好，请先完成启动或恢复浏览器");
          return;
        }

        const pending = browserTaskPreflight;
        setBrowserTaskPreflight(null);
        await handleSendRef.current(
          pending.images,
          pending.webSearch,
          pending.thinking,
          pending.sourceText,
          pending.sendExecutionStrategy,
          pending.autoContinuePayload,
          {
            ...(pending.sendOptions || {}),
            browserPreflightConfirmed: true,
          },
        );
        return;
      }

      await handlePermissionResponse(response);
    },
    [
      browserTaskPreflight,
      handlePermissionResponse,
      isBrowserAssistReady,
      runBrowserTaskPreflight,
    ],
  );

  const handleDocumentThinkingEnabledChange = useCallback(
    (enabled: boolean) => {
      setChatToolPreferences((previous) =>
        previous.thinking === enabled
          ? previous
          : {
              ...previous,
              thinking: enabled,
            },
      );
    },
    [setChatToolPreferences],
  );

  const handleDocumentAutoContinueRun = useCallback(
    async (payload: AutoContinueRunPayload) => {
      await handleSendRef.current(
        [],
        webSearchPreferenceRef.current,
        payload.thinkingEnabled,
        payload.prompt,
        undefined,
        {
          enabled: payload.settings.enabled,
          fast_mode_enabled: payload.settings.fastModeEnabled,
          continuation_length: payload.settings.continuationLength,
          sensitivity: payload.settings.sensitivity,
          source: "theme_workbench_document_auto_continue",
        },
      );
    },
    [],
  );

  const handleDocumentContentReviewRun = useCallback(
    async (payload: ContentReviewRunPayload) => {
      return await new Promise<string>((resolve, reject) => {
        void handleSendRef
          .current(
            [],
            webSearchPreferenceRef.current,
            payload.thinkingEnabled,
            payload.prompt,
            undefined,
            undefined,
            {
              skipThemeSkillPrefix: true,
              purpose: "content_review",
              observer: {
                onComplete: resolve,
                onError: (message) => reject(new Error(message)),
              },
            },
          )
          .catch((error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    },
    [],
  );

  const handleDocumentTextStylizeRun = useCallback(
    async (payload: TextStylizeRunPayload) => {
      return await new Promise<string>((resolve, reject) => {
        void handleSendRef
          .current(
            [],
            webSearchPreferenceRef.current,
            payload.thinkingEnabled,
            payload.prompt,
            undefined,
            undefined,
            {
              skipThemeSkillPrefix: true,
              purpose: "text_stylize",
              observer: {
                onComplete: resolve,
                onError: (message) => reject(new Error(message)),
              },
            },
          )
          .catch((error) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      });
    },
    [],
  );

  // 监听主题工作台技能触发
  useEffect(() => {
    if (!pendingSkillKey || !isThemeWorkbench) {
      return;
    }

    // 立即消费，避免重复触发
    consumePendingSkill();

    // 触发技能命令
    const command = `/${pendingSkillKey}`;
    console.log("[AgentChatPage] 执行技能命令:", command);
    handleSend([], false, false, command);
  }, [pendingSkillKey, isThemeWorkbench, consumePendingSkill, handleSend]);

  const handleClearMessages = useCallback(() => {
    clearMessages();
    setInput("");
    setSelectedText("");
    setBrowserTaskPreflight(null);
    // 重置布局模式
    setLayoutMode("chat");
    autoCollapsedTopicSidebarRef.current = false;
    setShowSidebar(defaultTopicSidebarVisible);
    // 清理画布和文件状态
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    setSelectedFileId(undefined);
    processedMessageIds.current.clear();
    clearProjectSelectionRuntime();
  }, [clearMessages, clearProjectSelectionRuntime, defaultTopicSidebarVisible]);

  const handleSwitchBranchVersion = useCallback(
    (versionId: string) => {
      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          return previous;
        }

        const targetVersion = previous.versions.find(
          (version) => version.id === versionId,
        );
        if (!targetVersion) {
          return previous;
        }

        return {
          ...previous,
          currentVersionId: targetVersion.id,
          content: targetVersion.content,
        };
      });
    },
    [setCanvasState],
  );

  const handleCreateVersionSnapshot = useCallback(() => {
    setCanvasState((previous) => {
      if (!previous || previous.type !== "document") {
        toast.info("当前没有可管理的文稿版本");
        return previous;
      }

      const content = previous.content.trim();
      if (!content) {
        toast.info("主稿为空，无法创建版本快照");
        return previous;
      }

      const nextIndex = previous.versions.length + 1;
      const newVersion = {
        id: crypto.randomUUID(),
        content: previous.content,
        createdAt: Date.now(),
        description: `手动快照 - 版本 ${nextIndex}`,
      };

      toast.success("已创建版本快照");
      return {
        ...previous,
        versions: [...previous.versions, newVersion],
        currentVersionId: newVersion.id,
      };
    });
  }, [setCanvasState]);

  const handleSetBranchStatus = useCallback(
    (
      topicId: string,
      status: "in_progress" | "pending" | "merged" | "candidate",
    ) => {
      setTopicStatus(topicId, status);
      if (status === "merged") {
        toast.success("已将该版本标记为主稿");
      } else if (status === "pending") {
        toast.info("已将该版本标记为待评审");
      }
    },
    [setTopicStatus],
  );

  const handleAddImage = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: "图片",
            extensions: ["jpg", "jpeg", "png", "gif", "webp"],
          },
        ],
      });

      if (!selected) {
        return;
      }

      const filePath = selected;
      if (!filePath) {
        toast.error("未选择文件");
        return;
      }

      if (!sessionId) {
        toast.error("会话未就绪");
        return;
      }

      toast.info("正在上传图片...");

      // 上传图片到会话
      const imageUrl = await uploadImageToSession(sessionId, filePath);

      // 插入图片到文档
      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          toast.error("当前不在文档编辑模式");
          return previous;
        }

        const fileName = filePath.split(/[\\/]/).pop() || "image";
        const imageMarkdown = `\n\n![${fileName}](${imageUrl})\n\n`;

        return {
          ...previous,
          content: previous.content + imageMarkdown,
        };
      });

      toast.success("图片已添加");
    } catch (error) {
      console.error("添加图片失败:", error);
      toast.error(error instanceof Error ? error.message : "添加图片失败");
    }
  }, [sessionId, setCanvasState]);

  const handleImportDocument = useCallback(async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          {
            name: "文档",
            extensions: ["md", "txt"],
          },
        ],
      });

      if (!selected) {
        return;
      }

      const filePath = selected;
      if (!filePath) {
        toast.error("未选择文件");
        return;
      }

      toast.info("正在导入文稿...");

      // 调用后端解析接口
      const content = await importDocument(filePath);

      // 加载到文档
      setCanvasState((previous) => {
        if (!previous || previous.type !== "document") {
          toast.error("当前不在文档编辑模式");
          return previous;
        }

        return {
          ...previous,
          content: content,
        };
      });

      toast.success("文稿已导入");
    } catch (error) {
      console.error("导入文稿失败:", error);
      toast.error(error instanceof Error ? error.message : "导入文稿失败");
    }
  }, [setCanvasState]);

  // 响应首页导航触发的新会话请求
  useEffect(() => {
    if (!newChatAt) {
      return;
    }

    const requestKey = String(newChatAt);
    if (hasHandledNewChatRequest(requestKey)) {
      return;
    }
    markNewChatRequestHandled(requestKey);

    clearMessages({
      showToast: false,
    });
    setInput("");
    setSelectedText("");
    setBrowserTaskPreflight(null);
    setLayoutMode("chat");
    autoCollapsedTopicSidebarRef.current = false;
    setShowSidebar(defaultTopicSidebarVisible);
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    setSelectedFileId(undefined);
    setMentionedCharacters([]);
    processedMessageIds.current.clear();
    clearProjectSelectionRuntime();
    restoredMetaSessionId.current = null;
    restoredFilesSessionId.current = null;
    hasTriggeredGuide.current = false;
    consumedInitialPromptRef.current = null;

    if (!externalProjectId) {
      resetProjectSelection();
      setProject(null);
      setProjectMemory(null);
      setActiveTheme(normalizeInitialTheme(initialTheme));
      setCreationMode(initialCreationMode ?? "guided");
    }

    const toastId = initialSessionName
      ? "openclaw-agent-handoff"
      : "agent-new-chat";
    const canCreateFreshSession = Boolean(projectId?.trim());

    if (!canCreateFreshSession) {
      return;
    }

    void (async () => {
      const newSessionId = await createFreshSession(initialSessionName);
      if (newSessionId) {
        toast.success(
          initialSessionName
            ? `已创建新任务：${initialSessionName}`
            : "已创建新任务",
          { id: toastId },
        );
      } else {
        toast.error("创建新任务失败，请重试。", { id: toastId });
      }
    })();
  }, [
    createFreshSession,
    initialSessionName,
    newChatAt,
    clearMessages,
    defaultTopicSidebarVisible,
    externalProjectId,
    hasHandledNewChatRequest,
    initialTheme,
    initialCreationMode,
    markNewChatRequestHandled,
    projectId,
    clearProjectSelectionRuntime,
    resetProjectSelection,
  ]);

  const handleBackHome = useCallback(() => {
    clearMessages({
      showToast: false,
    });
    setInput("");
    setSelectedText("");
    setLayoutMode("chat");
    setShowSidebar(true);
    setCanvasState(null);
    setGeneralCanvasState(DEFAULT_CANVAS_STATE);
    setTaskFiles([]);
    setSelectedFileId(undefined);
    processedMessageIds.current.clear();
    resetProjectSelection();
    setProject(null);
    setProjectMemory(null);
    setActiveTheme("general");
    setCreationMode("guided");
    _onNavigate?.("agent", buildHomeAgentParams());
  }, [clearMessages, _onNavigate, resetProjectSelection]);

  const displayMessages = useMemo(() => {
    const collapsedMessages = collapseLegacyQuestionnaireMessages(messages);
    const runtimeTeamDispatchPreviewMessages = runtimeTeamDispatchPreview
      ? buildRuntimeTeamDispatchPreviewMessages(runtimeTeamDispatchPreview)
      : [];
    if (browserTaskPreflight) {
      return [
        ...collapsedMessages,
        ...buildBrowserPreflightMessages(browserTaskPreflight),
      ];
    }

    if (runtimeTeamDispatchPreviewMessages.length > 0) {
      return [...collapsedMessages, ...runtimeTeamDispatchPreviewMessages];
    }

    if (
      collapsedMessages.length === 0 &&
      bootstrapDispatchPreviewMessages.length > 0
    ) {
      return bootstrapDispatchPreviewMessages;
    }

    return collapsedMessages;
  }, [
    bootstrapDispatchPreviewMessages,
    browserTaskPreflight,
    messages,
    runtimeTeamDispatchPreview,
  ]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    updateTopicSnapshot(
      sessionId,
      buildLiveTaskSnapshot({
        messages: displayMessages,
        isSending,
        pendingActionCount: pendingActions.length,
        queuedTurnCount: queuedTurns.length,
        workspaceError: Boolean(workspacePathMissing || workspaceHealthError),
      }),
    );
  }, [
    displayMessages,
    isSending,
    pendingActions.length,
    queuedTurns.length,
    sessionId,
    updateTopicSnapshot,
    workspaceHealthError,
    workspacePathMissing,
  ]);

  // 当开始对话时自动折叠侧边栏
  const hasMessages = messages.length > 0;
  const hasDisplayMessages = displayMessages.length > 0;

  const handleCanvasSelectionTextChange = useCallback((text: string) => {
    const normalized = text.trim().replace(/\s+/g, " ");
    const nextValue =
      normalized.length > 500 ? normalized.slice(0, 500) : normalized;
    startTransition(() => {
      setSelectedText((previous) =>
        previous === nextValue ? previous : nextValue,
      );
    });
  }, []);

  useEffect(() => {
    setSelectedText("");
  }, [activeTheme, contentId]);

  useEffect(() => {
    if (!canvasState || canvasState.type !== "novel") {
      setNovelChapterListCollapsed(false);
    }
  }, [canvasState]);

  useEffect(() => {
    autoCollapsedTopicSidebarRef.current = false;
    setShowSidebar(defaultTopicSidebarVisible);
  }, [defaultTopicSidebarVisible]);

  useEffect(() => {
    if (showChatPanel) {
      setLayoutMode((previous) =>
        previous === "canvas" ? "chat-canvas" : previous,
      );
      return;
    }

    setShowSidebar(false);

    if (layoutMode === "canvas") {
      return;
    }

    if (layoutMode === "chat-canvas") {
      setLayoutMode("canvas");
      return;
    }

    const fallbackContent = "# 新文档\n\n在这里开始编写内容...";

    if (activeTheme === "general") {
      setGeneralCanvasState((previous) => ({
        ...previous,
        isOpen: true,
        contentType:
          previous.contentType === "empty" ? "markdown" : previous.contentType,
        content: previous.content || fallbackContent,
      }));
    } else if (!canvasState) {
      const initialState =
        createInitialCanvasState(mappedTheme, fallbackContent) ||
        createInitialDocumentState(fallbackContent);
      setCanvasState(initialState);
    }

    setLayoutMode("canvas");
  }, [showChatPanel, layoutMode, activeTheme, canvasState, mappedTheme]);

  useEffect(() => {
    if (
      isThemeWorkbench ||
      activeTheme !== "general" ||
      layoutMode !== "chat-canvas"
    ) {
      setCanvasWorkbenchLayoutMode("split");
    }
  }, [activeTheme, isThemeWorkbench, layoutMode]);

  useEffect(() => {
    const shouldAutoHideTopicSidebar =
      showChatPanel &&
      !isThemeWorkbench &&
      activeTheme === "general" &&
      layoutMode === "chat-canvas" &&
      canvasWorkbenchLayoutMode === "stacked";

    if (shouldAutoHideTopicSidebar) {
      if (showSidebar) {
        autoCollapsedTopicSidebarRef.current = true;
        setShowSidebar(false);
      }
      return;
    }

    if (autoCollapsedTopicSidebarRef.current) {
      autoCollapsedTopicSidebarRef.current = false;
      setShowSidebar(true);
    }
  }, [
    activeTheme,
    canvasWorkbenchLayoutMode,
    isThemeWorkbench,
    layoutMode,
    showChatPanel,
    showSidebar,
  ]);

  useEffect(() => {
    onHasMessagesChange?.(hasMessages);
  }, [hasMessages, onHasMessagesChange]);

  // 当有可渲染主稿文件时，仅在需要时同步到画布，避免打断当前编辑
  useEffect(() => {
    const renderableFiles = taskFiles.filter((file) =>
      isRenderableTaskFile(file, isThemeWorkbench),
    );
    if (renderableFiles.length === 0) {
      return;
    }

    const { targetFile, nextSelectedFileId } = resolveCanvasTaskFileTarget(
      renderableFiles,
      selectedFileId,
    );
    if (!targetFile?.content) {
      return;
    }

    if (nextSelectedFileId) {
      setSelectedFileId((previous) =>
        previous === nextSelectedFileId ? previous : nextSelectedFileId,
      );
    }

    if (
      shouldDeferCanvasSyncWhileEditing({
        canvasType: canvasState?.type ?? null,
        editorFocused: documentEditorFocusedRef.current,
      })
    ) {
      return;
    }

    const targetContent = targetFile.content;
    setCanvasState((prev) => {
      if (mappedTheme === "music") {
        const sections = parseLyrics(targetContent);
        if (!prev || prev.type !== "music") {
          const musicState = createInitialMusicState();
          musicState.sections = sections;
          const titleMatch = targetContent.match(/^#\s*(.+)$/m);
          if (titleMatch) {
            musicState.spec.title = titleMatch[1].trim();
          }
          return musicState;
        }
        return { ...prev, sections };
      }

      if (mappedTheme === "novel") {
        return upsertNovelCanvasState(prev, targetContent);
      }

      if (!prev || prev.type !== "document") {
        return createInitialDocumentState(targetContent);
      }
      if (prev.content === targetContent) {
        return prev;
      }
      return { ...prev, content: targetContent };
    });
    setLayoutMode("chat-canvas");
  }, [
    taskFiles,
    isThemeWorkbench,
    mappedTheme,
    upsertNovelCanvasState,
    selectedFileId,
    canvasState?.type,
  ]);

  const handleToggleSidebar = useCallback(() => {
    if (!showChatPanel) {
      return;
    }
    setShowSidebar((prev) => !prev);
  }, [showChatPanel]);

  const handleToggleNovelChapterList = useCallback(() => {
    setNovelChapterListCollapsed((prev) => !prev);
  }, []);

  const handleAddNovelChapter = useCallback(() => {
    setCanvasState((prev) => {
      if (!prev || prev.type !== "novel") {
        return prev;
      }

      const now = Date.now();
      const chapterNumber = prev.chapters.length + 1;
      const title = `第${chapterNumber}章`;
      const newChapter = {
        id: crypto.randomUUID(),
        number: chapterNumber,
        title,
        content: `# ${title}\n\n`,
        wordCount: 0,
        status: "draft" as const,
        createdAt: now,
        updatedAt: now,
      };

      return {
        ...prev,
        chapters: [...prev.chapters, newChapter],
        currentChapterId: newChapter.id,
      };
    });
    setNovelChapterListCollapsed(false);
  }, []);

  // 切换画布显示
  const handleToggleCanvas = useCallback(() => {
    // General 主题使用专门的画布
    if (activeTheme === "general") {
      if (layoutMode !== "chat" && isBrowserAssistCanvasVisible) {
        suppressBrowserAssistCanvasAutoOpen();
      }
      setGeneralCanvasState((prev) => ({
        ...prev,
        isOpen: !prev.isOpen,
        contentType:
          prev.contentType === "empty" ? "markdown" : prev.contentType,
        content: prev.content || "# 新文档\n\n在这里开始编写内容...",
      }));
      setLayoutMode((prev) => (prev === "chat" ? "chat-canvas" : "chat"));
      return;
    }

    setLayoutMode((prev) => {
      if (prev === "chat") {
        // 打开画布时，如果没有画布状态则创建初始状态
        if (!canvasState) {
          const initialState =
            createInitialCanvasState(
              mappedTheme,
              "# 新文档\n\n在这里开始编写内容...",
            ) ||
            createInitialDocumentState("# 新文档\n\n在这里开始编写内容...");
          setCanvasState(initialState);
        }
        return "chat-canvas";
      }
      return "chat";
    });
  }, [
    activeTheme,
    canvasState,
    isBrowserAssistCanvasVisible,
    layoutMode,
    mappedTheme,
    suppressBrowserAssistCanvasAutoOpen,
  ]);

  // 关闭画布
  const handleCloseCanvas = useCallback(() => {
    if (
      activeTheme === "general" &&
      currentCanvasArtifact?.type === "browser_assist"
    ) {
      suppressBrowserAssistCanvasAutoOpen();
    }
    setLayoutMode("chat");
    setNovelChapterListCollapsed(false);
    // General 主题关闭画布状态
    if (activeTheme === "general") {
      setGeneralCanvasState((prev) => ({ ...prev, isOpen: false }));
    }
  }, [
    activeTheme,
    currentCanvasArtifact?.type,
    suppressBrowserAssistCanvasAutoOpen,
  ]);

  const resolvedCanvasState = useMemo<CanvasStateUnion | null>(() => {
    if (canvasState) {
      return canvasState;
    }

    if (shouldBootstrapCanvasOnEntry) {
      return (
        createInitialCanvasState(normalizedEntryTheme, "") ||
        createInitialDocumentState("")
      );
    }

    if (isThemeWorkbench && isContentCreationTheme(activeTheme)) {
      return (
        createInitialCanvasState(mappedTheme, "") ||
        createInitialDocumentState("")
      );
    }

    return null;
  }, [
    activeTheme,
    canvasState,
    isThemeWorkbench,
    mappedTheme,
    normalizedEntryTheme,
    shouldBootstrapCanvasOnEntry,
  ]);

  const showNovelNavbarControls =
    layoutMode !== "chat" && resolvedCanvasState?.type === "novel";

  const upsertGeneralArtifact = useCallback(
    (artifact: Artifact) => {
      setArtifacts((currentArtifacts) =>
        mergeArtifacts([...currentArtifacts, artifact]),
      );
    },
    [setArtifacts],
  );

  useEffect(() => {
    if (
      activeTheme !== "general" ||
      !liveArtifact ||
      !settledLiveArtifact ||
      liveArtifact === settledLiveArtifact
    ) {
      return;
    }

    upsertGeneralArtifact(settledLiveArtifact);
  }, [activeTheme, liveArtifact, settledLiveArtifact, upsertGeneralArtifact]);

  const commitBrowserAssistSessionState = useCallback(
    (candidate: BrowserAssistSessionState | null) => {
      if (activeTheme !== "general" || !candidate) {
        return;
      }

      setBrowserAssistSessionState((current) => {
        const next = mergeBrowserAssistSessionStates(current, candidate);
        return areBrowserAssistSessionStatesEqual(current, next)
          ? current
          : next;
      });
    },
    [activeTheme],
  );

  useEffect(() => {
    if (activeTheme !== "general") {
      setBrowserAssistSessionState(null);
      return;
    }

    setBrowserAssistSessionState(
      loadBrowserAssistSessionState(projectId, sessionId),
    );
  }, [activeTheme, browserAssistStorageKey, projectId, sessionId]);

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    commitBrowserAssistSessionState(browserAssistSessionFromArtifact);
  }, [
    activeTheme,
    browserAssistSessionFromArtifact,
    commitBrowserAssistSessionState,
  ]);

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    commitBrowserAssistSessionState(latestBrowserAssistSessionFromMessages);
  }, [
    activeTheme,
    commitBrowserAssistSessionState,
    latestBrowserAssistSessionFromMessages,
  ]);

  useEffect(() => {
    if (activeTheme !== "general") {
      return;
    }

    if (browserAssistSessionState) {
      saveBrowserAssistSessionState(
        projectId,
        sessionId,
        browserAssistSessionState,
      );
      return;
    }

    clearBrowserAssistSessionState(projectId, sessionId);
  }, [
    activeTheme,
    browserAssistSessionState,
    browserAssistStorageKey,
    projectId,
    sessionId,
  ]);

  const navigateBrowserAssistCanvasToUrl = useCallback(
    async (url: string, options?: { silent?: boolean }): Promise<boolean> => {
      if (activeTheme !== "general" || !url.trim()) {
        return false;
      }

      const artifactMeta = asRecord(browserAssistArtifact?.meta);
      const profileKey =
        browserAssistSessionState?.profileKey ||
        readFirstString(artifactMeta ? [artifactMeta] : [], [
          "profileKey",
          "profile_key",
        ]) ||
        GENERAL_BROWSER_ASSIST_PROFILE_KEY;
      const currentUrl =
        browserAssistSessionState?.url ||
        readFirstString(artifactMeta ? [artifactMeta] : [], [
          "url",
          "launchUrl",
        ]) ||
        "";
      const fallbackTitle =
        browserAssistSessionState?.title ||
        browserAssistArtifact?.title?.trim() ||
        "浏览器协助";

      if (currentUrl === url) {
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
        return true;
      }

      setBrowserAssistLaunching(true);

      try {
        const result = await browserExecuteAction({
          profile_key: profileKey,
          backend: "cdp_direct",
          action: "navigate",
          args: {
            action: "goto",
            url,
            wait_for_page_info: true,
          },
          timeout_ms: 20000,
        });

        if (!result.success) {
          throw new Error(result.error || "浏览器导航失败");
        }

        const resultData = asRecord(result.data);
        const pageInfo =
          asRecord(resultData?.page_info) || asRecord(resultData?.pageInfo);
        const nextUrl =
          readFirstString(
            [pageInfo, resultData],
            ["url", "target_url", "targetUrl"],
          ) || url;
        const nextTitle =
          readFirstString(
            [pageInfo, resultData],
            ["title", "target_title", "targetTitle"],
          ) || fallbackTitle;

        commitBrowserAssistSessionState(
          createBrowserAssistSessionState({
            sessionId:
              result.session_id ||
              browserAssistSessionState?.sessionId ||
              undefined,
            profileKey: profileKey,
            url: nextUrl,
            title: nextTitle,
            targetId:
              result.target_id ||
              browserAssistSessionState?.targetId ||
              undefined,
            transportKind: browserAssistSessionState?.transportKind,
            lifecycleState: browserAssistSessionState?.lifecycleState || "live",
            controlMode: browserAssistSessionState?.controlMode,
            source: "runtime_launch",
            updatedAt: Date.now(),
          }),
        );
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);

        if (!options?.silent) {
          toast.success(`已切换浏览器页面：${nextTitle}`);
        }
        return true;
      } catch (error) {
        if (!options?.silent) {
          toast.error(
            `切换浏览器页面失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return false;
      } finally {
        setBrowserAssistLaunching(false);
      }
    },
    [
      activeTheme,
      browserAssistArtifact,
      browserAssistSessionState,
      commitBrowserAssistSessionState,
      openBrowserAssistCanvas,
    ],
  );

  const ensureBrowserAssistCanvas = useCallback(
    async (
      sourceText: string,
      options?: {
        silent?: boolean;
        navigationMode?: "none" | "explicit-url" | "best-effort";
      },
    ): Promise<boolean> => {
      if (activeTheme !== "general") {
        return false;
      }

      const navigationMode = options?.navigationMode || "best-effort";
      const targetUrl =
        navigationMode === "explicit-url"
          ? extractExplicitUrlFromText(sourceText)
          : navigationMode === "best-effort"
            ? resolveBrowserAssistLaunchUrl(sourceText)
            : null;
      const artifactMeta = asRecord(browserAssistArtifact?.meta);
      const hasSessionContext = Boolean(
        browserAssistSessionState?.sessionId ||
        browserAssistSessionState?.profileKey ||
        readFirstString(artifactMeta ? [artifactMeta] : [], [
          "sessionId",
          "session_id",
          "profileKey",
          "profile_key",
        ]) ||
        browserAssistArtifact,
      );

      if (hasSessionContext) {
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
        if (!targetUrl) {
          return true;
        }
        return navigateBrowserAssistCanvasToUrl(targetUrl, options);
      }

      if (!targetUrl) {
        return false;
      }

      const browserAssistScopeKey =
        currentBrowserAssistScopeKey ||
        resolveBrowserAssistSessionScopeKey(projectId, sessionId);
      const launchKey = `${GENERAL_BROWSER_ASSIST_PROFILE_KEY}:${targetUrl}`;
      if (autoLaunchingBrowserAssistKeyRef.current === launchKey) {
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
        return true;
      }
      autoLaunchingBrowserAssistKeyRef.current = launchKey;
      upsertGeneralArtifact(
        buildPendingBrowserAssistArtifact({
          scopeKey: browserAssistScopeKey,
          profileKey: GENERAL_BROWSER_ASSIST_PROFILE_KEY,
          url: targetUrl,
          title: "浏览器协助",
        }),
      );
      openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
      setBrowserAssistLaunching(true);

      try {
        const result = await launchBrowserSession({
          profile_key: GENERAL_BROWSER_ASSIST_PROFILE_KEY,
          url: targetUrl,
          open_window: false,
          stream_mode: "both",
        });

        commitBrowserAssistSessionState(
          createBrowserAssistSessionState({
            sessionId: result.session.session_id,
            profileKey: result.session.profile_key,
            url:
              result.session.last_page_info?.url?.trim() ||
              result.session.target_url?.trim() ||
              targetUrl,
            title:
              result.session.last_page_info?.title?.trim() ||
              result.session.target_title?.trim() ||
              "浏览器协助",
            targetId: result.session.target_id,
            transportKind: result.session.transport_kind,
            lifecycleState: result.session.lifecycle_state,
            controlMode: result.session.control_mode,
            source: "runtime_launch",
            updatedAt: Date.now(),
          }),
        );
        openBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);

        if (!options?.silent) {
          toast.success(
            `浏览器协助已启动：${
              result.session.target_title ||
              result.session.target_url ||
              targetUrl
            }`,
          );
        }
        return true;
      } catch (error) {
        upsertGeneralArtifact(
          buildFailedBrowserAssistArtifact({
            scopeKey: browserAssistScopeKey,
            profileKey: GENERAL_BROWSER_ASSIST_PROFILE_KEY,
            url: targetUrl,
            title: "浏览器协助",
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        autoLaunchingBrowserAssistKeyRef.current = "";
        if (!options?.silent) {
          toast.error(
            `启动浏览器协助失败: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        return false;
      } finally {
        setBrowserAssistLaunching(false);
      }
    },
    [
      activeTheme,
      browserAssistArtifact,
      browserAssistSessionState?.profileKey,
      browserAssistSessionState?.sessionId,
      commitBrowserAssistSessionState,
      navigateBrowserAssistCanvasToUrl,
      currentBrowserAssistScopeKey,
      openBrowserAssistCanvas,
      projectId,
      sessionId,
      upsertGeneralArtifact,
    ],
  );

  const handleOpenBrowserAssistInCanvas = useCallback(async () => {
    await ensureBrowserAssistCanvas(input, {
      navigationMode: "best-effort",
    });
  }, [ensureBrowserAssistCanvas, input]);

  useEffect(() => {
    if (
      !openBrowserAssistOnMount ||
      openBrowserAssistOnMountHandledRef.current
    ) {
      return;
    }

    openBrowserAssistOnMountHandledRef.current = true;
    void ensureBrowserAssistCanvas(initialUserPrompt || "", {
      navigationMode: "best-effort",
    });
  }, [ensureBrowserAssistCanvas, initialUserPrompt, openBrowserAssistOnMount]);

  const handleResumeSidebarTask = useCallback(
    async (topicId: string, statusReason?: TaskStatusReason) => {
      if (topicId === sessionId && isResumableBrowserTaskReason(statusReason)) {
        await handleOpenBrowserAssistInCanvas();
        return;
      }

      await switchTopic(topicId);
    },
    [handleOpenBrowserAssistInCanvas, sessionId, switchTopic],
  );

  useEffect(() => {
    ensureBrowserAssistCanvasRef.current = ensureBrowserAssistCanvas;
  }, [ensureBrowserAssistCanvas]);

  useEffect(() => {
    if (!browserTaskPreflight || browserTaskPreflight.phase !== "launching") {
      if (!browserTaskPreflight) {
        browserTaskPreflightLaunchIdRef.current = "";
      }
      return;
    }

    if (
      browserTaskPreflightLaunchIdRef.current === browserTaskPreflight.requestId
    ) {
      return;
    }

    browserTaskPreflightLaunchIdRef.current = browserTaskPreflight.requestId;
    void runBrowserTaskPreflight(browserTaskPreflight);
  }, [browserTaskPreflight, runBrowserTaskPreflight]);

  useEffect(() => {
    if (activeTheme !== "general") {
      autoOpenedBrowserAssistSessionIdRef.current = "";
      autoLaunchingBrowserAssistKeyRef.current = "";
      browserAssistLaunchRequestIdRef.current += 1;
      return;
    }

    if (
      !browserAssistSessionState?.sessionId &&
      !browserAssistSessionState?.profileKey
    ) {
      return;
    }

    const artifactMeta = asRecord(browserAssistArtifact?.meta);
    const currentSessionId = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["sessionId", "session_id"],
    );
    const currentProfileKey = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["profileKey", "profile_key"],
    );
    const currentUrl = readFirstString(artifactMeta ? [artifactMeta] : [], [
      "url",
      "launchUrl",
    ]);
    const currentTargetId = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["targetId", "target_id"],
    );
    const currentTransportKind = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["transportKind", "transport_kind"],
    );
    const currentLifecycleState = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["lifecycleState", "lifecycle_state"],
    );
    const currentControlMode = readFirstString(
      artifactMeta ? [artifactMeta] : [],
      ["controlMode", "control_mode"],
    );
    const currentTitle = browserAssistArtifact?.title?.trim();

    const nextArtifact = buildBrowserAssistArtifact({
      scopeKey:
        currentBrowserAssistScopeKey ||
        resolveBrowserAssistSessionScopeKey(projectId, sessionId),
      profileKey:
        browserAssistSessionState.profileKey ||
        currentProfileKey ||
        GENERAL_BROWSER_ASSIST_PROFILE_KEY,
      browserSessionId:
        browserAssistSessionState.sessionId || currentSessionId || "",
      url:
        browserAssistSessionState.url || currentUrl || "https://www.google.com",
      title: browserAssistSessionState.title || currentTitle || "浏览器协助",
      targetId: browserAssistSessionState.targetId || currentTargetId,
      transportKind:
        browserAssistSessionState.transportKind || currentTransportKind,
      lifecycleState:
        browserAssistSessionState.lifecycleState || currentLifecycleState,
      controlMode: browserAssistSessionState.controlMode || currentControlMode,
    });

    const nextMeta = asRecord(nextArtifact.meta);
    const nextSessionId = readFirstString(nextMeta ? [nextMeta] : [], [
      "sessionId",
      "session_id",
    ]);
    const nextProfileKey = readFirstString(nextMeta ? [nextMeta] : [], [
      "profileKey",
      "profile_key",
    ]);
    const nextUrl = readFirstString(nextMeta ? [nextMeta] : [], [
      "url",
      "launchUrl",
    ]);
    const nextTargetId = readFirstString(nextMeta ? [nextMeta] : [], [
      "targetId",
      "target_id",
    ]);
    const nextTransportKind = readFirstString(nextMeta ? [nextMeta] : [], [
      "transportKind",
      "transport_kind",
    ]);
    const nextLifecycleState = readFirstString(nextMeta ? [nextMeta] : [], [
      "lifecycleState",
      "lifecycle_state",
    ]);
    const nextControlMode = readFirstString(nextMeta ? [nextMeta] : [], [
      "controlMode",
      "control_mode",
    ]);
    const currentScopeKey = resolveBrowserAssistArtifactScopeKey(
      browserAssistArtifact,
    );
    const nextScopeKey = resolveBrowserAssistArtifactScopeKey(nextArtifact);

    const shouldUpsertArtifact =
      !browserAssistArtifact ||
      currentScopeKey !== nextScopeKey ||
      currentSessionId !== nextSessionId ||
      currentProfileKey !== nextProfileKey ||
      currentUrl !== nextUrl ||
      currentTargetId !== nextTargetId ||
      currentTransportKind !== nextTransportKind ||
      currentLifecycleState !== nextLifecycleState ||
      currentControlMode !== nextControlMode ||
      currentTitle !== nextArtifact.title;

    if (shouldUpsertArtifact) {
      upsertGeneralArtifact(nextArtifact);
    }

    const autoOpenKey =
      browserAssistSessionState.sessionId ||
      `${
        browserAssistSessionState.profileKey ||
        GENERAL_BROWSER_ASSIST_PROFILE_KEY
      }:${browserAssistSessionState.url || currentUrl || "pending"}`;
    if (autoOpenedBrowserAssistSessionIdRef.current !== autoOpenKey) {
      autoOpenedBrowserAssistSessionIdRef.current = autoOpenKey;
      autoOpenBrowserAssistCanvas(nextArtifact.id);
    }
  }, [
    activeTheme,
    autoOpenBrowserAssistCanvas,
    browserAssistArtifact,
    currentBrowserAssistScopeKey,
    browserAssistSessionState,
    projectId,
    sessionId,
    upsertGeneralArtifact,
  ]);

  useEffect(() => {
    if (activeTheme !== "general") {
      autoLaunchingBrowserAssistKeyRef.current = "";
      browserAssistLaunchRequestIdRef.current += 1;
      return;
    }

    if (
      !browserAssistSessionState?.sessionId &&
      !browserAssistSessionState?.profileKey
    ) {
      return;
    }

    const nextSessionId = browserAssistSessionState.sessionId || "";
    const nextProfileKey =
      browserAssistSessionState.profileKey ||
      GENERAL_BROWSER_ASSIST_PROFILE_KEY;
    const nextUrl = browserAssistSessionState.url || "https://www.google.com";
    const nextTitle = browserAssistSessionState.title || "浏览器协助";

    if (nextSessionId || !nextProfileKey || !nextUrl) {
      return;
    }

    const launchKey = `${nextProfileKey}:${nextUrl}`;
    if (autoLaunchingBrowserAssistKeyRef.current === launchKey) {
      return;
    }
    autoLaunchingBrowserAssistKeyRef.current = launchKey;
    const browserAssistScopeKey =
      currentBrowserAssistScopeKey ||
      resolveBrowserAssistSessionScopeKey(projectId, sessionId);
    upsertGeneralArtifact(
      buildPendingBrowserAssistArtifact({
        scopeKey: browserAssistScopeKey,
        profileKey: nextProfileKey,
        url: nextUrl,
        title: nextTitle,
      }),
    );
    autoOpenBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
    const launchRequestId = browserAssistLaunchRequestIdRef.current + 1;
    browserAssistLaunchRequestIdRef.current = launchRequestId;
    void (async () => {
      try {
        setBrowserAssistLaunching(true);
        const result = await launchBrowserSession({
          profile_key: nextProfileKey,
          url: nextUrl,
          open_window: false,
          stream_mode: "both",
        });
        if (browserAssistLaunchRequestIdRef.current !== launchRequestId) {
          return;
        }

        commitBrowserAssistSessionState(
          createBrowserAssistSessionState({
            sessionId: result.session.session_id,
            profileKey: result.session.profile_key,
            url:
              result.session.last_page_info?.url?.trim() ||
              result.session.target_url?.trim() ||
              nextUrl,
            title:
              result.session.last_page_info?.title?.trim() ||
              result.session.target_title?.trim() ||
              nextTitle,
            targetId: result.session.target_id,
            transportKind: result.session.transport_kind,
            lifecycleState: result.session.lifecycle_state,
            controlMode: result.session.control_mode,
            source: "runtime_launch",
            updatedAt: Date.now(),
          }),
        );
        autoOpenBrowserAssistCanvas(GENERAL_BROWSER_ASSIST_ARTIFACT_ID);
      } catch (error) {
        upsertGeneralArtifact(
          buildFailedBrowserAssistArtifact({
            scopeKey: browserAssistScopeKey,
            profileKey: nextProfileKey,
            url: nextUrl,
            title: nextTitle,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        autoLaunchingBrowserAssistKeyRef.current = "";
        console.warn("[AgentChatPage] 自动拉起浏览器协助实时会话失败:", error);
      } finally {
        if (browserAssistLaunchRequestIdRef.current === launchRequestId) {
          setBrowserAssistLaunching(false);
        }
      }
    })();
  }, [
    activeTheme,
    autoOpenBrowserAssistCanvas,
    browserAssistSessionState,
    commitBrowserAssistSessionState,
    currentBrowserAssistScopeKey,
    projectId,
    sessionId,
    upsertGeneralArtifact,
  ]);

  // 处理文件写入 - 同名文件更新内容，不同名文件独立保存
  const handleWriteFile = useCallback(
    (content: string, fileName: string, context?: WriteArtifactContext) => {
      console.log(
        "[AgentChatPage] 收到文件写入:",
        fileName,
        content.length,
        "字符",
      );

      // General 主题使用专门的画布处理
      if (activeTheme === "general") {
        const existingArtifact = artifacts.find((artifact) => {
          if (context?.artifactId && artifact.id === context.artifactId) {
            return true;
          }

          if (context?.artifact?.id && artifact.id === context.artifact.id) {
            return true;
          }

          return (
            typeof artifact.meta.filePath === "string" &&
            artifact.meta.filePath === fileName
          );
        });
        const nextContent =
          content.length > 0
            ? content
            : context?.artifact?.content || existingArtifact?.content || "";
        const nextArtifact = context?.artifact
          ? {
              ...(existingArtifact || {}),
              ...context.artifact,
              content: nextContent,
              status:
                context.status ||
                context.artifact.status ||
                existingArtifact?.status ||
                "pending",
              meta: {
                ...(existingArtifact?.meta || {}),
                ...context.artifact.meta,
                ...(context.metadata || {}),
              },
              updatedAt: Date.now(),
            }
          : buildArtifactFromWrite({
              filePath: fileName,
              content: nextContent,
              context: {
                ...context,
                artifact: existingArtifact,
                status:
                  context?.status ||
                  (nextContent.length > 0 ? "complete" : "pending"),
              },
            });

        const syncResource = () => {
          if (nextArtifact.status !== "complete") {
            return;
          }

          void syncGeneralArtifactToResource({
            rawFilePath: resolveArtifactFilePath(nextArtifact),
            preferredName: nextArtifact.title,
          });
        };

        if (nextContent.length > 0) {
          void saveSessionFile(fileName, nextContent)
            .then(() => {
              syncResource();
            })
            .catch((error) => {
              console.error("[AgentChatPage] 持久化 artifact 失败:", error);
              syncResource();
            });
        } else {
          syncResource();
        }

        upsertGeneralArtifact(nextArtifact);
        setSelectedArtifactId(nextArtifact.id);
        setArtifactViewMode(resolveDefaultArtifactViewMode(nextArtifact));
        setLayoutMode("chat-canvas");
        return;
      }

      const now = Date.now();
      const nextFileType = resolveTaskFileType(fileName, content);
      const activeQueueItem = themeWorkbenchActiveQueueItem;
      const activeRunVersionId = activeQueueItem?.run_id?.trim() || null;
      const activeRunDescription =
        activeQueueItem?.title?.trim() || `产物更新 - ${fileName}`;
      const socialGateKey =
        currentGate.key === "idle" ||
        currentGate.key === "topic_select" ||
        currentGate.key === "write_mode" ||
        currentGate.key === "publish_confirm"
          ? currentGate.key
          : undefined;
      const socialArtifact =
        mappedTheme === "social-media"
          ? resolveSocialMediaArtifactDescriptor({
              fileName,
              gateKey: socialGateKey,
              runTitle: activeRunDescription,
            })
          : null;
      const isThemeWorkbenchPrimaryArtifact =
        !isThemeWorkbench || isThemeWorkbenchPrimaryDocumentArtifact(fileName);
      const shouldApplyToMainDocument =
        nextFileType === "document" &&
        isThemeWorkbenchPrimaryArtifact &&
        (!isThemeWorkbench || currentGate.key !== "topic_select");
      const effectiveDocumentVersionId =
        activeRunVersionId ||
        ((isThemeWorkbench || mappedTheme === "social-media") &&
        shouldApplyToMainDocument
          ? `artifact:${fileName}`
          : null);
      const effectiveVersionDescription =
        socialArtifact?.versionLabel || activeRunDescription;
      const baseVersionMetadata =
        socialArtifact && shouldApplyToMainDocument
          ? {
              artifactId: socialArtifact.artifactId,
              artifactType: socialArtifact.artifactType,
              stage: socialArtifact.stage,
              platform: socialArtifact.platform,
              sourceFileName: fileName,
              runId: activeRunVersionId || undefined,
              correlationId:
                effectiveDocumentVersionId || activeRunVersionId || undefined,
            }
          : undefined;
      const existingTaskFile = taskFilesRef.current.find(
        (file) => file.name === fileName,
      );
      const hasTaskFileChanged = existingTaskFile?.content !== content;

      if (isThemeWorkbench && effectiveDocumentVersionId) {
        const nextStatus: TopicBranchStatus =
          activeQueueItem?.status === "running" ? "in_progress" : "pending";
        setDocumentVersionStatusMap((previous) => {
          if (previous[effectiveDocumentVersionId] === nextStatus) {
            return previous;
          }
          return {
            ...previous,
            [effectiveDocumentVersionId]: nextStatus,
          };
        });
      }

      // 持久化文件到会话目录
      saveSessionFile(fileName, content).catch((err) => {
        console.error("[AgentChatPage] 持久化文件失败:", err);
      });

      // 同步内容到项目（如果有 contentId，先验证存在性）
      if (contentId && shouldApplyToMainDocument) {
        getContent(contentId)
          .then((existingContent) => {
            if (existingContent) {
              updateContent(contentId, {
                body: content,
              }).catch((err) => {
                console.error("[AgentChatPage] 同步内容到项目失败:", err);
              });
            } else {
              console.warn(
                "[AgentChatPage] contentId 对应的内容不存在，跳过同步:",
                contentId,
              );
            }
          })
          .catch((err) => {
            console.error("[AgentChatPage] 检查内容存在性失败:", err);
          });
      } else if (isThemeWorkbench && !shouldApplyToMainDocument) {
        console.log("[AgentChatPage] 主题工作台非成文阶段，跳过主稿写入:", {
          gate: currentGate.key,
          fileName,
          isPrimaryArtifact: isThemeWorkbenchPrimaryArtifact,
        });
      }

      // 根据文件名推进工作流步骤（使用动态映射）
      const fileToStepMap = getFileToStepMap(mappedTheme);
      const stepIndex = fileToStepMap[fileName];
      if (
        stepIndex !== undefined &&
        stepIndex === currentStepIndex &&
        isContentCreationMode
      ) {
        console.log(
          "[AgentChatPage] 推进工作流步骤:",
          stepIndex,
          "->",
          stepIndex + 1,
        );
        completeStep({
          aiOutput: { fileName, preview: content.slice(0, 100) },
        });
      }

      if (socialArtifact && hasTaskFileChanged) {
        activityLogger.log({
          eventType: existingTaskFile ? "file_update" : "file_create",
          status: "success",
          title: `${existingTaskFile ? "更新" : "生成"}${socialArtifact.versionLabel}`,
          description: fileName,
          workspaceId: projectId || undefined,
          sessionId: sessionId || undefined,
          source: "aster-chat",
          correlationId:
            effectiveDocumentVersionId || activeRunVersionId || fileName,
          metadata: {
            ...baseVersionMetadata,
            stageLabel: socialArtifact.stageLabel,
            isAuxiliary: socialArtifact.isAuxiliary,
          },
        });

        const stageLogKey = `${
          effectiveDocumentVersionId || socialArtifact.artifactId
        }:${socialArtifact.stage}`;
        if (
          !socialArtifact.isAuxiliary &&
          socialStageLogRef.current[stageLogKey] !== socialArtifact.stage
        ) {
          socialStageLogRef.current[stageLogKey] = socialArtifact.stage;
          activityLogger.log({
            eventType: "step_complete",
            status: "success",
            title: socialArtifact.stageLabel,
            description: `${socialArtifact.versionLabel}已进入版本链`,
            workspaceId: projectId || undefined,
            sessionId: sessionId || undefined,
            source: "aster-chat",
            correlationId:
              effectiveDocumentVersionId || activeRunVersionId || fileName,
            metadata: {
              ...baseVersionMetadata,
              stageLabel: socialArtifact.stageLabel,
            },
          });
        }
      }

      // 更新或创建文件
      setTaskFiles((prev) => {
        // 查找同名文件
        const existingIndex = prev.findIndex((f) => f.name === fileName);

        if (existingIndex >= 0) {
          // 同名文件存在 - 直接更新内容（不创建新版本）
          const existing = prev[existingIndex];

          // 如果内容完全相同，跳过
          if (existing.content === content) {
            console.log("[AgentChatPage] 文件内容相同，跳过:", fileName);
            setSelectedFileId(existing.id);
            return prev;
          }

          // 更新文件内容
          console.log("[AgentChatPage] 更新文件:", fileName);
          const updated = [...prev];
          updated[existingIndex] = {
            ...existing,
            type: nextFileType,
            content,
            updatedAt: now,
            metadata: socialArtifact
              ? {
                  ...(existing.metadata || {}),
                  ...baseVersionMetadata,
                  stageLabel: socialArtifact.stageLabel,
                  versionLabel: socialArtifact.versionLabel,
                }
              : existing.metadata,
          };
          setSelectedFileId(existing.id);
          return updated;
        }

        // 新文件 - 添加到列表
        console.log("[AgentChatPage] 创建新文件:", fileName);
        const newFile: TaskFile = {
          id: crypto.randomUUID(),
          name: fileName,
          type: nextFileType,
          content,
          version: 1,
          createdAt: now,
          updatedAt: now,
          metadata: socialArtifact
            ? {
                ...baseVersionMetadata,
                stageLabel: socialArtifact.stageLabel,
                versionLabel: socialArtifact.versionLabel,
              }
            : undefined,
        };
        setSelectedFileId(newFile.id);
        return [...prev, newFile];
      });

      if (!shouldApplyToMainDocument) {
        return;
      }

      // 更新画布内容
      setCanvasState((prev) => {
        console.log("[AgentChatPage] 更新画布状态:", {
          prevType: prev?.type,
          mappedTheme,
          contentLength: content.length,
        });

        // 海报主题不自动更新画布
        if (mappedTheme === "poster") {
          return prev;
        }

        // 音乐主题：解析歌词并更新 sections
        if (mappedTheme === "music") {
          const sections = parseLyrics(content);
          if (!prev || prev.type !== "music") {
            const musicState = createInitialMusicState();
            musicState.sections = sections;
            // 尝试从内容中提取歌曲名称
            const titleMatch = content.match(/^#\s*(.+)$/m);
            if (titleMatch) {
              musicState.spec.title = titleMatch[1].trim();
            }
            console.log("[AgentChatPage] 创建新音乐状态");
            return musicState;
          }
          // 更新现有音乐状态的 sections
          return {
            ...prev,
            sections,
          };
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(prev, content);
        }

        // 文档类型画布
        if (!prev || prev.type !== "document") {
          console.log("[AgentChatPage] 创建新文档状态");
          const initialDocumentState = createInitialDocumentState(content);
          if (!effectiveDocumentVersionId) {
            if (!socialArtifact) {
              return initialDocumentState;
            }
            return {
              ...initialDocumentState,
              platform:
                socialArtifact.platform || initialDocumentState.platform,
              versions: initialDocumentState.versions.map((version) => ({
                ...version,
                description: effectiveVersionDescription,
                metadata: baseVersionMetadata,
              })),
            };
          }
          if (!isThemeWorkbench && mappedTheme !== "social-media") {
            return initialDocumentState;
          }
          return {
            ...initialDocumentState,
            platform: socialArtifact?.platform || initialDocumentState.platform,
            versions: [
              {
                id: effectiveDocumentVersionId,
                content,
                createdAt: now,
                description: effectiveVersionDescription,
                metadata: baseVersionMetadata,
              },
            ],
            currentVersionId: effectiveDocumentVersionId,
            content,
          };
        }

        if (effectiveDocumentVersionId) {
          const existingIndex = prev.versions.findIndex(
            (version) => version.id === effectiveDocumentVersionId,
          );

          if (existingIndex >= 0) {
            const nextVersions = [...prev.versions];
            const currentVersion = nextVersions[existingIndex];
            nextVersions[existingIndex] = {
              ...currentVersion,
              content,
              description:
                currentVersion.description || effectiveVersionDescription,
              metadata: {
                ...(currentVersion.metadata || {}),
                ...(baseVersionMetadata || {}),
              },
            };
            return {
              ...prev,
              content,
              platform: socialArtifact?.platform || prev.platform,
              versions: nextVersions,
              currentVersionId: effectiveDocumentVersionId,
            };
          }

          const parentVersion =
            prev.versions.find(
              (version) => version.id === prev.currentVersionId,
            ) || prev.versions[prev.versions.length - 1];
          const nextVersions = [
            ...prev.versions,
            {
              id: effectiveDocumentVersionId,
              content,
              createdAt: now,
              description: effectiveVersionDescription,
              metadata: {
                ...(baseVersionMetadata || {}),
                parentVersionId:
                  parentVersion &&
                  parentVersion.id !== effectiveDocumentVersionId
                    ? parentVersion.id
                    : undefined,
                parentArtifactId: parentVersion?.metadata?.artifactId,
              },
            },
          ].slice(-MAX_PERSISTED_DOCUMENT_VERSIONS);

          return {
            ...prev,
            content,
            platform: socialArtifact?.platform || prev.platform,
            versions: nextVersions,
            currentVersionId: effectiveDocumentVersionId,
          };
        }
        console.log("[AgentChatPage] 更新现有文档状态");
        return {
          ...prev,
          content,
          platform: socialArtifact?.platform || prev.platform,
        };
      });

      // 自动打开画布显示流式内容
      setLayoutMode("chat-canvas");
    },
    [
      activeTheme, // 添加 activeTheme 依赖
      artifacts,
      setArtifactViewMode,
      setSelectedArtifactId,
      currentGate.key,
      contentId,
      currentStepIndex,
      isContentCreationMode,
      isThemeWorkbench,
      completeStep,
      mappedTheme,
      projectId,
      saveSessionFile,
      sessionId,
      syncGeneralArtifactToResource,
      themeWorkbenchActiveQueueItem,
      upsertGeneralArtifact,
      upsertNovelCanvasState,
    ],
  );

  // 更新 ref，供统一聊天主链 Hook 使用
  useEffect(() => {
    handleWriteFileRef.current = handleWriteFile;
  }, [handleWriteFile]);

  const handleHarnessLoadFilePreview = useCallback(
    async (path: string): Promise<HarnessFilePreviewResult> => {
      const normalizedPath = path.trim();
      const createFallbackResult = (
        overrides: Partial<HarnessFilePreviewResult> = {},
      ): HarnessFilePreviewResult => ({
        path: normalizedPath,
        content: null,
        isBinary: false,
        size: 0,
        error: null,
        ...overrides,
      });

      if (!normalizedPath) {
        return createFallbackResult({ error: "文件路径为空" });
      }

      const fileName = extractFileNameFromPath(normalizedPath);
      const candidateNames = [...new Set([normalizedPath, fileName])];

      const matchedTaskFile = taskFiles.find((file) =>
        candidateNames.includes(file.name),
      );
      if (matchedTaskFile) {
        const content = matchedTaskFile.content ?? "";
        return createFallbackResult({
          path: matchedTaskFile.name,
          content,
          size: content.length,
        });
      }

      const matchedSessionFile = sessionFiles.find((file) =>
        candidateNames.includes(file.name),
      );
      if (matchedSessionFile) {
        const content = await readSessionFile(matchedSessionFile.name);
        if (content !== null) {
          return createFallbackResult({
            path: matchedSessionFile.name,
            content,
            size: content.length,
          });
        }
      }

      try {
        const result = await readFilePreview(normalizedPath, 64 * 1024);

        return createFallbackResult({
          path: result.path || normalizedPath,
          content: result.content ?? null,
          isBinary: result.isBinary ?? false,
          size: result.size ?? 0,
          error: result.error ?? null,
        });
      } catch (error) {
        return createFallbackResult({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [readSessionFile, sessionFiles, taskFiles],
  );

  useArtifactAutoPreviewSync({
    enabled: activeTheme === "general",
    artifact: currentCanvasArtifact,
    loadPreview: handleHarnessLoadFilePreview,
    onSyncArtifact: upsertGeneralArtifact,
  });

  const openArtifactInWorkbench = useCallback(
    async (artifact: Artifact) => {
      let nextArtifact = artifact;
      const artifactPath = resolveArtifactFilePath(artifact);
      const shouldLoadPreview = artifact.content.length === 0 && artifactPath;

      if (shouldLoadPreview) {
        const preview = await handleHarnessLoadFilePreview(artifactPath);
        if (preview.error) {
          toast.error(`读取产物失败: ${preview.error}`);
        } else if (preview.isBinary) {
          toast.info("该产物为二进制文件，暂不支持在工作台预览");
        } else if (typeof preview.content === "string") {
          nextArtifact = {
            ...artifact,
            content: preview.content,
            meta: {
              ...artifact.meta,
              filePath: preview.path || artifactPath,
              filename:
                artifact.meta.filename ||
                extractFileNameFromPath(preview.path || artifactPath),
            },
            updatedAt: Date.now(),
          };
          upsertGeneralArtifact(nextArtifact);
        }
      }

      setSelectedArtifactId(nextArtifact.id);
      setArtifactViewMode(resolveDefaultArtifactViewMode(nextArtifact));
      setLayoutMode("chat-canvas");
    },
    [
      handleHarnessLoadFilePreview,
      setSelectedArtifactId,
      upsertGeneralArtifact,
    ],
  );

  const handleArtifactClick = useCallback(
    (artifact: Artifact) => {
      void openArtifactInWorkbench(artifact);
    },
    [openArtifactInWorkbench],
  );

  const findArtifactForCodeBlock = useCallback(
    (code: string) => {
      const normalizedCode = code.replace(/\r\n/g, "\n").trimEnd();
      if (!normalizedCode) {
        return undefined;
      }

      return artifacts.find((artifact) => {
        if (typeof artifact.content !== "string") {
          return false;
        }
        return (
          artifact.content.replace(/\r\n/g, "\n").trimEnd() === normalizedCode
        );
      });
    },
    [artifacts],
  );

  // 处理文件点击 - 在画布中显示文件内容
  const handleFileClick = useCallback(
    (fileName: string, content: string) => {
      console.log("[AgentChatPage] 文件点击:", fileName, "主题:", activeTheme);

      // General 主题统一走 artifact 工作台
      if (activeTheme === "general") {
        const matchingArtifact = artifacts.find((artifact) => {
          const artifactPath = resolveArtifactFilePath(artifact);
          return (
            artifactPath === fileName ||
            artifact.title === extractFileNameFromPath(fileName) ||
            (content.trim().length > 0 && artifact.content === content)
          );
        });
        const nextArtifact =
          matchingArtifact ||
          buildArtifactFromWrite({
            filePath: fileName,
            content,
            context: {
              source: "message_content",
              status: content.length > 0 ? "complete" : "pending",
            },
          });

        if (!matchingArtifact) {
          upsertGeneralArtifact(nextArtifact);
        }

        void openArtifactInWorkbench(nextArtifact);
        return;
      }

      // 查找或创建任务文件
      const nextFileType = resolveTaskFileType(fileName, content);
      setTaskFiles((prev) => {
        const existingFile = prev.find((f) => f.name === fileName);
        if (existingFile) {
          setSelectedFileId(existingFile.id);
          return prev;
        }
        // 如果文件不存在，添加到列表
        const newFile: TaskFile = {
          id: crypto.randomUUID(),
          name: fileName,
          type: nextFileType,
          content,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setSelectedFileId(newFile.id);
        return [...prev, newFile];
      });

      if (
        !isRenderableTaskFile(
          { name: fileName, type: nextFileType },
          isThemeWorkbench,
        )
      ) {
        toast.info("该文件为辅助产物，暂不在主稿画布渲染");
        return;
      }

      // 更新画布内容
      setCanvasState((prev) => {
        // 音乐主题：解析歌词并更新 sections
        if (mappedTheme === "music") {
          const sections = parseLyrics(content);
          if (!prev || prev.type !== "music") {
            const musicState = createInitialMusicState();
            musicState.sections = sections;
            const titleMatch = content.match(/^#\s*(.+)$/m);
            if (titleMatch) {
              musicState.spec.title = titleMatch[1].trim();
            }
            return musicState;
          }
          return { ...prev, sections };
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(prev, content);
        }

        // 文档类型画布
        if (!prev || prev.type !== "document") {
          return createInitialDocumentState(content);
        }
        return {
          ...prev,
          content,
        };
      });

      // 打开画布
      setLayoutMode("chat-canvas");
    },
    [
      activeTheme,
      artifacts,
      isThemeWorkbench,
      mappedTheme,
      openArtifactInWorkbench,
      upsertGeneralArtifact,
      upsertNovelCanvasState,
    ],
  );

  // 处理代码块点击 - 在画布中显示代码（General 主题专用）
  const handleCodeBlockClick = useCallback(
    (language: string, code: string) => {
      console.log("[AgentChatPage] 代码块点击:", language);

      const matchingArtifact = findArtifactForCodeBlock(code);
      if (!matchingArtifact) {
        console.warn(
          "[AgentChatPage] 代码块未匹配到 artifact，保持内联渲染:",
          language,
        );
        return;
      }

      console.log("[AgentChatPage] 找到匹配的 artifact:", matchingArtifact.id);
      void openArtifactInWorkbench(matchingArtifact);
    },
    [findArtifactForCodeBlock, openArtifactInWorkbench],
  );

  // 判断是否应该折叠代码块（当画布打开且有 artifact 时）
  const shouldCollapseCodeBlocks = useMemo(() => {
    if (activeTheme !== "general") return false;
    if (layoutMode === "chat") return false;
    // 当画布打开时折叠代码块
    return artifacts.length > 0 || generalCanvasState.isOpen;
  }, [activeTheme, layoutMode, artifacts.length, generalCanvasState.isOpen]);

  const shouldCollapseCodeBlockInChat = useCallback(
    (language: string, code: string) => {
      if (!shouldCollapseCodeBlocks) {
        return false;
      }

      const normalizedLanguage = language.trim().toLowerCase();
      if (
        ["", "text", "plaintext", "plain", "txt", "markdown", "md"].includes(
          normalizedLanguage,
        )
      ) {
        return false;
      }

      return Boolean(findArtifactForCodeBlock(code));
    },
    [findArtifactForCodeBlock, shouldCollapseCodeBlocks],
  );

  // 处理任务文件点击 - 在画布中显示文件内容
  const handleTaskFileClick = useCallback(
    (file: TaskFile) => {
      setSelectedFileId(file.id);

      if (
        !isRenderableTaskFile(file, isThemeWorkbench) ||
        looksLikeSocialPublishPayload(file.content || "") ||
        !file.content?.trim()
      ) {
        toast.info("该文件为辅助产物，暂不在主稿画布渲染");
        return;
      }

      const fileContent = file.content ?? "";

      setCanvasState((prev) => {
        // 音乐主题：解析歌词并更新 sections
        if (mappedTheme === "music") {
          const sections = parseLyrics(fileContent);
          if (!prev || prev.type !== "music") {
            const musicState = createInitialMusicState();
            musicState.sections = sections;
            const titleMatch = fileContent.match(/^#\s*(.+)$/m);
            if (titleMatch) {
              musicState.spec.title = titleMatch[1].trim();
            }
            return musicState;
          }
          return { ...prev, sections };
        }

        if (mappedTheme === "novel") {
          return upsertNovelCanvasState(prev, fileContent);
        }

        // 文档类型画布
        if (!prev || prev.type !== "document") {
          return createInitialDocumentState(fileContent);
        }
        return {
          ...prev,
          content: fileContent,
        };
      });
      // 只打开画布，不关闭文件列表（让用户自己关闭）
      setLayoutMode("chat-canvas");
    },
    [isThemeWorkbench, mappedTheme, upsertNovelCanvasState],
  );

  // A2UI 表单提交处理
  const handleA2UISubmit = useCallback(
    async (formData: A2UIFormData, _messageId: string) => {
      console.log("[AgentChatPage] A2UI 表单提交:", formData);

      // 将表单数据格式化为用户消息
      const formattedData = Object.entries(formData)
        .map(([key, value]) => {
          if (Array.isArray(value)) {
            return `- ${key}: ${value.join(", ")}`;
          }
          return `- ${key}: ${value}`;
        })
        .join("\n");

      const userMessage = `我的选择：\n${formattedData}`;

      // 发送用户消息
      await sendMessage(userMessage, [], false, false);
    },
    [sendMessage],
  );

  // 包装 A2UI 表单提交，适配 Inputbar 的签名
  const handleInputbarA2UISubmit = useCallback(
    (formData: A2UIFormData) => {
      if (pendingPromotedA2UIActionRequest) {
        const payload = buildActionRequestSubmissionPayload(
          pendingPromotedA2UIActionRequest,
          formData,
        );

        void handlePermissionResponseWithBrowserPreflight({
          requestId: pendingPromotedA2UIActionRequest.requestId,
          confirmed: true,
          actionType: pendingPromotedA2UIActionRequest.actionType,
          response: payload.responseText,
          userData: payload.userData,
        });
        return;
      }

      if (pendingLegacyQuestionnaireA2UIForm) {
        const submissionPayload = buildLegacyQuestionnaireSubmissionPayload(
          pendingLegacyQuestionnaireA2UIForm,
          formData,
        );

        if (!submissionPayload) {
          toast.info("请至少补充一项信息后再继续");
          return;
        }

        void sendMessage(
          submissionPayload.formattedMessage,
          [],
          false,
          false,
          false,
          undefined,
          undefined,
          undefined,
          {
            requestMetadata: submissionPayload.requestMetadata,
          },
        );
        return;
      }

      void handleA2UISubmit(formData, "");
    },
    [
      handleA2UISubmit,
      handlePermissionResponseWithBrowserPreflight,
      pendingLegacyQuestionnaireA2UIForm,
      pendingPromotedA2UIActionRequest,
      sendMessage,
    ],
  );

  // 存储 triggerAIGuide 函数引用，避免在 useEffect 依赖中包含函数
  const triggerAIGuideRef = useRef(triggerAIGuide);
  triggerAIGuideRef.current = triggerAIGuide;

  // 当从项目进入且有 contentId 时，自动启动创作引导
  useEffect(() => {
    if (shouldUseCompactThemeWorkbench) {
      return;
    }

    // 条件：
    // - 有 contentId（从项目创建内容进入）
    // - 没有消息（messages.length === 0）
    // - 项目已加载
    // - 系统提示词已准备好
    // - 不在发送中
    // - 画布内容为空（canvasState 没有实际内容）
    // - 尚未触发过引导
    const canvasEmpty = isCanvasStateEmpty(canvasState);
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];
    const defaultGuidePrompt =
      contentId && canvasEmpty && !isThemeWorkbench
        ? getDefaultGuidePromptByTheme(mappedTheme)
        : undefined;

    if (
      contentId &&
      messages.length === 0 &&
      project &&
      systemPrompt &&
      !isSending &&
      canvasEmpty
    ) {
      if (!initialDispatchKey && themeWorkbenchEntryCheckPending) {
        return;
      }

      if (initialDispatchKey) {
        if (isThemeWorkbench && pendingInitialImages.length === 0) {
          return;
        }
        if (consumedInitialPromptRef.current === initialDispatchKey) {
          return;
        }
        consumedInitialPromptRef.current = initialDispatchKey;
        hasTriggeredGuide.current = true;
        console.log("[AgentChatPage] 自动发送首条创作意图消息");
        void (async () => {
          const started = await handleSend(
            pendingInitialImages,
            chatToolPreferences.webSearch,
            chatToolPreferences.thinking,
            pendingInitialPrompt,
          );
          if (!started) {
            consumedInitialPromptRef.current = null;
            return;
          }
          onInitialUserPromptConsumed?.();
        })();
        return;
      }

      if (hasTriggeredGuide.current) {
        return;
      }

      if (themeWorkbenchEntryPrompt?.kind === "resume") {
        return;
      }

      if (defaultGuidePrompt) {
        hasTriggeredGuide.current = true;
        setInput((previous) => previous.trim() || defaultGuidePrompt);
        return;
      }

      if (isThemeWorkbench) {
        if (shouldSkipThemeWorkbenchAutoGuideWithoutPrompt) {
          return;
        }
        hasTriggeredGuide.current = true;
        console.log("[AgentChatPage] 主题工作台：触发 AI 引导，创建后端工作流");
        // 同步创建后端工作流（不阻塞触发）
        void (async () => {
          try {
            const themeForApi = mappedTheme as Parameters<
              typeof contentWorkflowApi.create
            >[1];
            const modeForApi =
              (creationMode as Parameters<typeof contentWorkflowApi.create>[2]) ??
              "guided";
            await contentWorkflowApi.create(
              contentId!,
              themeForApi,
              modeForApi,
            );
            console.log("[AgentChatPage] 后端工作流创建成功");
          } catch (e) {
            console.warn(
              "[AgentChatPage] 后端工作流创建失败（不影响主流程）:",
              e,
            );
          }
        })();
        triggerAIGuideRef.current();
        return;
      }

      hasTriggeredGuide.current = true;
      console.log("[AgentChatPage] 自动触发 AI 创作引导");
      triggerAIGuideRef.current();
    }
  }, [
    activeTheme,
    contentId,
    mappedTheme,
    creationMode,
    messages.length,
    project,
    systemPrompt,
    isSending,
    canvasState,
    initialUserPrompt,
    initialUserImages,
    setInput,
    isThemeWorkbench,
    handleSend,
    chatToolPreferences,
    initialDispatchKey,
    onInitialUserPromptConsumed,
    shouldUseCompactThemeWorkbench,
    shouldSkipThemeWorkbenchAutoGuideWithoutPrompt,
    themeWorkbenchEntryCheckPending,
    themeWorkbenchEntryPrompt,
  ]);

  // 通用聊天场景：若带有 initialUserPrompt，则自动新建并发送首条消息
  useEffect(() => {
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];
    if (
      shouldUseCompactThemeWorkbench ||
      !initialDispatchKey ||
      contentId ||
      !sessionId ||
      messages.length > 0 ||
      isSending
    ) {
      return;
    }

    if (consumedInitialPromptRef.current === initialDispatchKey) {
      return;
    }

    consumedInitialPromptRef.current = initialDispatchKey;
    void (async () => {
      const started = await handleSend(
        pendingInitialImages,
        chatToolPreferences.webSearch,
        chatToolPreferences.thinking,
        pendingInitialPrompt,
      );
      if (!started) {
        consumedInitialPromptRef.current = null;
        return;
      }
      onInitialUserPromptConsumed?.();
    })();
  }, [
    chatToolPreferences,
    contentId,
    handleSend,
    initialDispatchKey,
    initialUserPrompt,
    initialUserImages,
    isSending,
    messages.length,
    onInitialUserPromptConsumed,
    sessionId,
    shouldUseCompactThemeWorkbench,
  ]);

  // 当 contentId 变化时重置引导状态
  useEffect(() => {
    hasTriggeredGuide.current = false;
    consumedInitialPromptRef.current = null;
  }, [contentId]);

  // 当 contentId 变化且是主题工作台时，尝试从后端恢复工作流
  useEffect(() => {
    if (!contentId || !isThemeWorkbench) return;

    void (async () => {
      try {
        const workflow = await contentWorkflowApi.getByContent(contentId);
        if (workflow) {
          const completedCount = workflow.steps.filter(
            (s) => s.status === "completed" || s.status === "skipped",
          ).length;
          console.log(
            `[AgentChatPage] 找到已有工作流: ${workflow.id}，已完成步骤 ${completedCount}/${workflow.steps.length}`,
          );
        }
      } catch (e) {
        // 查询失败不影响主流程
        console.debug("[AgentChatPage] 查询后端工作流失败:", e);
      }
    })();
  }, [contentId, isThemeWorkbench]);

  // 监听封面图重新生成成功事件，将占位 URL 替换为真实图片 URL
  useEffect(() => {
    const handler = (e: Event) => {
      const { placeholder, imageUrl } = (
        e as CustomEvent<CoverImageReplacedDetail>
      ).detail;
      if (!placeholder || !imageUrl) return;
      setCanvasState((prev) => {
        if (!prev || prev.type !== "document") return prev;
        const updatedContent = prev.content.split(placeholder).join(imageUrl);
        if (updatedContent === prev.content) return prev;
        return { ...prev, content: updatedContent };
      });
    };
    window.addEventListener(COVER_IMAGE_REPLACED_EVENT, handler);
    return () =>
      window.removeEventListener(COVER_IMAGE_REPLACED_EVENT, handler);
  }, []);

  // 主题工作台始终使用聊天布局与浮层输入，不走旧 EmptyState 输入流程
  const hasUnconsumedInitialDispatch =
    !shouldUseCompactThemeWorkbench && isBootstrapDispatchPending;
  const showChatLayout =
    agentEntry === "claw" ||
    hasDisplayMessages ||
    isThemeWorkbench ||
    hasUnconsumedInitialDispatch ||
    isSending ||
    queuedTurns.length > 0 ||
    Boolean(browserTaskPreflight);
  const shouldHideThemeWorkbenchInputForTheme = shouldUseCompactThemeWorkbench;
  const shouldShowThemeWorkbenchFloatingInputOverlay =
    isThemeWorkbench &&
    showChatLayout &&
    !shouldHideThemeWorkbenchInputForTheme;
  const shouldShowThemeWorkbenchSidebarForTheme =
    !shouldUseCompactThemeWorkbench;
  const showThemeWorkbenchSidebar =
    showChatPanel &&
    showSidebar &&
    isThemeWorkbench &&
    shouldShowThemeWorkbenchSidebarForTheme &&
    (!enableThemeWorkbenchPanelCollapse || !themeWorkbenchSidebarCollapsed);
  const showThemeWorkbenchLeftExpandButton =
    showChatPanel &&
    showSidebar &&
    shouldShowThemeWorkbenchSidebarForTheme &&
    enableThemeWorkbenchPanelCollapse &&
    themeWorkbenchSidebarCollapsed;
  const handleThemeWorkbenchDeleteTopic = useCallback(() => {}, []);
  const handleThemeWorkbenchSidebarCollapse = useCallback(() => {
    setThemeWorkbenchSidebarCollapsed(true);
  }, []);
  const themeWorkbenchSidebarCollapseHandler = useMemo(
    () =>
      enableThemeWorkbenchPanelCollapse
        ? handleThemeWorkbenchSidebarCollapse
        : undefined,
    [enableThemeWorkbenchPanelCollapse, handleThemeWorkbenchSidebarCollapse],
  );
  const themeWorkbenchHarnessHeaderAction = useMemo(() => {
    if (!isThemeWorkbench || !socialMediaHarnessSummary) {
      return null;
    }

    return (
      <SocialMediaHarnessCard
        runState={socialMediaHarnessSummary.runState}
        stageTitle={socialMediaHarnessSummary.stageTitle}
        stageDescription={socialMediaHarnessSummary.stageDescription}
        runTitle={socialMediaHarnessSummary.runTitle}
        artifactCount={socialMediaHarnessSummary.artifactCount}
        updatedAt={socialMediaHarnessSummary.updatedAt}
        pendingCount={socialMediaHarnessSummary.pendingCount}
        harnessPanelVisible={harnessPanelVisible}
        layout="icon"
        onToggleHarnessPanel={handleToggleHarnessPanel}
      />
    );
  }, [
    handleToggleHarnessPanel,
    harnessPanelVisible,
    isThemeWorkbench,
    socialMediaHarnessSummary,
  ]);
  const themeWorkbenchHarnessSlot = useMemo(() => {
    return null;
  }, []);
  const themeWorkbenchHarnessDialog = useMemo(() => {
    if (!isThemeWorkbench) {
      return null;
    }

    return (
      <Dialog open={harnessPanelVisible} onOpenChange={setHarnessPanelVisible}>
        <DialogContent
          maxWidth="max-w-7xl"
          className="flex h-[90vh] max-h-[90vh] flex-col overflow-hidden p-0"
          draggable={true}
          dragHandleSelector='[data-harness-drag-handle="true"]'
        >
          <HarnessStatusPanel
            harnessState={harnessState}
            compatSubagentRuntime={compatSubagentRuntime}
            environment={harnessEnvironment}
            childSubagentSessions={childSubagentSessions}
            selectedTeamLabel={selectedTeamLabel}
            selectedTeamSummary={selectedTeamSummary}
            selectedTeamRoles={selectedTeam?.roles}
            toolInventory={toolInventory}
            toolInventoryLoading={toolInventoryLoading}
            toolInventoryError={toolInventoryError}
            onRefreshToolInventory={refreshToolInventory}
            layout="dialog"
            onOpenSubagentSession={handleOpenSubagentSession}
            onLoadFilePreview={handleHarnessLoadFilePreview}
            onOpenFile={handleFileClick}
          />
        </DialogContent>
      </Dialog>
    );
  }, [
    handleFileClick,
    handleHarnessLoadFilePreview,
    handleOpenSubagentSession,
    childSubagentSessions,
    harnessEnvironment,
    harnessPanelVisible,
    harnessState,
    isThemeWorkbench,
    refreshToolInventory,
    compatSubagentRuntime,
    selectedTeam?.roles,
    selectedTeamLabel,
    selectedTeamSummary,
    toolInventory,
    toolInventoryError,
    toolInventoryLoading,
  ]);
  const themeWorkbenchSidebarNode = useMemo(() => {
    if (!showThemeWorkbenchSidebar) {
      return null;
    }
    return (
      <ThemeWorkbenchSidebar
        branchMode="version"
        onNewTopic={handleCreateVersionSnapshot}
        onSwitchTopic={handleSwitchBranchVersion}
        onDeleteTopic={handleThemeWorkbenchDeleteTopic}
        branchItems={branchItems}
        onSetBranchStatus={handleSetBranchStatus}
        workflowSteps={themeWorkbenchWorkflowSteps}
        contextSearchQuery={contextWorkspace.contextSearchQuery}
        onContextSearchQueryChange={contextWorkspace.setContextSearchQuery}
        contextSearchMode={contextWorkspace.contextSearchMode}
        onContextSearchModeChange={contextWorkspace.setContextSearchMode}
        contextSearchLoading={contextWorkspace.contextSearchLoading}
        contextSearchError={contextWorkspace.contextSearchError}
        contextSearchBlockedReason={contextWorkspace.contextSearchBlockedReason}
        onSubmitContextSearch={contextWorkspace.submitContextSearch}
        onAddTextContext={contextWorkspace.addTextContext}
        onAddLinkContext={contextWorkspace.addLinkContext}
        onAddFileContext={contextWorkspace.addFileContext}
        onAddImage={handleAddImage}
        onImportDocument={handleImportDocument}
        contextItems={contextWorkspace.sidebarContextItems}
        onToggleContextActive={contextWorkspace.toggleContextActive}
        onViewContextDetail={handleViewContextDetail}
        contextBudget={contextWorkspace.contextBudget}
        activityLogs={themeWorkbenchActivityLogs}
        creationTaskEvents={themeWorkbenchCreationTaskEvents}
        onViewRunDetail={handleViewThemeWorkbenchRunDetail}
        activeRunDetail={selectedThemeWorkbenchRunDetail}
        activeRunDetailLoading={themeWorkbenchRunDetailLoading}
        onRequestCollapse={themeWorkbenchSidebarCollapseHandler}
        historyHasMore={themeWorkbenchHistoryHasMore}
        historyLoading={themeWorkbenchHistoryLoading}
        onLoadMoreHistory={
          themeWorkbenchHistoryHasMore
            ? handleLoadMoreThemeWorkbenchHistory
            : undefined
        }
        skillDetailMap={themeWorkbenchSkillDetailMap}
        headerActionSlot={themeWorkbenchHarnessHeaderAction}
        topSlot={themeWorkbenchHarnessSlot}
        messages={messages}
      />
    );
  }, [
    branchItems,
    contextWorkspace.addFileContext,
    contextWorkspace.addLinkContext,
    contextWorkspace.addTextContext,
    contextWorkspace.contextBudget,
    contextWorkspace.contextSearchBlockedReason,
    contextWorkspace.contextSearchError,
    contextWorkspace.contextSearchLoading,
    contextWorkspace.contextSearchMode,
    contextWorkspace.contextSearchQuery,
    contextWorkspace.setContextSearchMode,
    contextWorkspace.setContextSearchQuery,
    contextWorkspace.sidebarContextItems,
    contextWorkspace.submitContextSearch,
    contextWorkspace.toggleContextActive,
    handleAddImage,
    handleImportDocument,
    handleCreateVersionSnapshot,
    handleSetBranchStatus,
    handleSwitchBranchVersion,
    handleThemeWorkbenchDeleteTopic,
    handleViewContextDetail,
    handleLoadMoreThemeWorkbenchHistory,
    handleViewThemeWorkbenchRunDetail,
    selectedThemeWorkbenchRunDetail,
    showThemeWorkbenchSidebar,
    themeWorkbenchHarnessHeaderAction,
    themeWorkbenchHarnessSlot,
    themeWorkbenchCreationTaskEvents,
    themeWorkbenchActivityLogs,
    themeWorkbenchHistoryHasMore,
    themeWorkbenchHistoryLoading,
    themeWorkbenchRunDetailLoading,
    themeWorkbenchSidebarCollapseHandler,
    themeWorkbenchSkillDetailMap,
    themeWorkbenchWorkflowSteps,
    messages,
  ]);

  const workflowProgressSignature = useMemo(() => {
    const shouldShow = isContentCreationMode && hasMessages && steps.length > 0;
    if (!shouldShow) {
      return "hidden";
    }

    const stepSignature = steps
      .map((step) => `${step.id}:${step.status}:${step.title}`)
      .join("|");
    return `${currentStepIndex}:${stepSignature}`;
  }, [isContentCreationMode, hasMessages, steps, currentStepIndex]);

  const lastWorkflowProgressSignatureRef = useRef<string>("");
  useEffect(() => {
    if (!onWorkflowProgressChange) return;
    if (
      lastWorkflowProgressSignatureRef.current === workflowProgressSignature
    ) {
      return;
    }
    lastWorkflowProgressSignatureRef.current = workflowProgressSignature;

    const shouldShow = isContentCreationMode && hasMessages && steps.length > 0;
    if (!shouldShow) {
      onWorkflowProgressChange(null);
      return;
    }

    onWorkflowProgressChange({
      currentIndex: currentStepIndex,
      steps: steps.map((step) => ({
        id: step.id,
        title: step.title,
        status: step.status,
      })),
    });
  }, [
    onWorkflowProgressChange,
    workflowProgressSignature,
    isContentCreationMode,
    hasMessages,
    steps,
    currentStepIndex,
  ]);

  useEffect(() => {
    return () => {
      onWorkflowProgressChange?.(null);
    };
  }, [onWorkflowProgressChange]);

  const handleManageProviders = useCallback(() => {
    _onNavigate?.("settings", {
      tab: SettingsTabs.Providers,
    });
  }, [_onNavigate]);

  const handleBackToResources = useCallback(() => {
    _onNavigate?.("resources");
  }, [_onNavigate]);

  const handleProjectChange = useCallback(
    (newProjectId: string) => {
      applyProjectSelection(newProjectId);
    },
    [applyProjectSelection],
  );

  const handleSelectWorkspaceDirectory = useCallback(async () => {
    const newPath = await openDialog({ directory: true, multiple: false });
    if (!newPath) return;
    if (workspacePathMissing) {
      // 发送失败场景：更新路径并重试原来的消息
      await fixWorkspacePathAndRetry(newPath);
    } else if (projectId) {
      // 主动健康检查发现问题：只更新路径，不需要重试
      try {
        await updateProjectById(projectId, { rootPath: newPath });
        setWorkspaceHealthError(false);
        notifyProjectRuntimeAgentsGuide(
          {
            id: projectId,
            rootPath: newPath,
          },
          {
            successMessage: "工作区目录已更新",
          },
        );
      } catch (err) {
        toast.error(
          `更新路径失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }, [fixWorkspacePathAndRetry, projectId, workspacePathMissing]);

  const handleSelectCharacter = useCallback((character: Character) => {
    setMentionedCharacters((prev) => {
      if (prev.find((c) => c.id === character.id)) {
        return prev;
      }
      return [...prev, character];
    });
  }, []);

  const handleToggleTaskFiles = useCallback(() => {
    setTaskFilesExpanded((previous) => !previous);
  }, []);

  const visibleTaskFiles = useMemo(
    () =>
      taskFiles.filter((file) => isRenderableTaskFile(file, isThemeWorkbench)),
    [taskFiles, isThemeWorkbench],
  );

  const visibleSelectedFileId = useMemo(() => {
    if (!selectedFileId) {
      return undefined;
    }
    return visibleTaskFiles.some((file) => file.id === selectedFileId)
      ? selectedFileId
      : undefined;
  }, [selectedFileId, visibleTaskFiles]);

  const activeCanvasTaskFile = useMemo(() => {
    return resolveCanvasTaskFileTarget(visibleTaskFiles, visibleSelectedFileId)
      .targetFile;
  }, [visibleSelectedFileId, visibleTaskFiles]);

  const styleActionContent = useMemo(
    () =>
      extractStyleActionContent({
        activeTheme: mappedTheme,
        generalCanvasState,
        resolvedCanvasState,
        taskFiles: visibleTaskFiles,
        selectedFileId: visibleSelectedFileId,
      }),
    [
      generalCanvasState,
      mappedTheme,
      resolvedCanvasState,
      visibleSelectedFileId,
      visibleTaskFiles,
    ],
  );

  const styleActionFileName = useMemo(
    () =>
      resolveStyleActionFileName({
        activeTheme: mappedTheme,
        generalCanvasState,
        resolvedCanvasState,
        taskFiles: visibleTaskFiles,
        selectedFileId: visibleSelectedFileId,
      }),
    [
      generalCanvasState,
      mappedTheme,
      resolvedCanvasState,
      visibleSelectedFileId,
      visibleTaskFiles,
    ],
  );

  const styleActionsDisabled =
    !projectId || !runtimeStylePrompt || !styleActionContent.trim();

  const handleRunStyleRewrite = useCallback(() => {
    if (!styleActionContent.trim()) {
      toast.error("当前画布还没有可重写的正文内容");
      return;
    }

    if (!runtimeStylePrompt) {
      toast.error("请先选择项目默认风格或任务风格");
      return;
    }

    void handleSend(
      [],
      chatToolPreferences.webSearch,
      chatToolPreferences.thinking,
      buildStyleRewritePrompt({
        content: styleActionContent,
        stylePrompt: runtimeStylePrompt,
        fileName: styleActionFileName,
      }),
      undefined,
      undefined,
      {
        skipThemeSkillPrefix: true,
        purpose: "style_rewrite",
      },
    );
  }, [
    chatToolPreferences.thinking,
    chatToolPreferences.webSearch,
    handleSend,
    runtimeStylePrompt,
    styleActionContent,
    styleActionFileName,
  ]);

  const handleRunStyleAudit = useCallback(() => {
    if (!styleActionContent.trim()) {
      toast.error("当前画布还没有可检查的正文内容");
      return;
    }

    if (!runtimeStylePrompt) {
      toast.error("请先选择项目默认风格或任务风格");
      return;
    }

    void handleSend(
      [],
      chatToolPreferences.webSearch,
      chatToolPreferences.thinking,
      buildStyleAuditPrompt({
        content: styleActionContent,
        stylePrompt: runtimeStylePrompt,
      }),
      undefined,
      undefined,
      {
        skipThemeSkillPrefix: true,
        purpose: "style_audit",
      },
    );
  }, [
    chatToolPreferences.thinking,
    chatToolPreferences.webSearch,
    handleSend,
    runtimeStylePrompt,
    styleActionContent,
  ]);

  const inputbarNode = useMemo(
    () => (
      <Inputbar
        input={input}
        setInput={setInput}
        variant={isThemeWorkbench ? "theme_workbench" : "default"}
        themeWorkbenchGate={isThemeWorkbench ? currentGate : null}
        pendingA2UIForm={pendingA2UIForm || null}
        onA2UISubmit={handleInputbarA2UISubmit}
        a2uiSubmissionNotice={a2uiSubmissionNotice}
        workflowSteps={isThemeWorkbench ? themeWorkbenchWorkflowSteps : steps}
        themeWorkbenchRunState={themeWorkbenchRunState}
        onSend={handleSend}
        onStop={stopSending}
        isLoading={isSending || queuedTurns.length > 0}
        providerType={providerType}
        setProviderType={setProviderType}
        model={model}
        setModel={setModel}
        workspaceId={projectId ?? null}
        executionStrategy={executionStrategy}
        setExecutionStrategy={setExecutionStrategy}
        activeTheme={activeTheme}
        onManageProviders={handleManageProviders}
        selectedTeam={selectedTeam}
        onSelectTeam={handleSelectTeam}
        onEnableSuggestedTeam={handleEnableSuggestedTeam}
        disabled={!projectId}
        onClearMessages={handleClearMessages}
        onToggleCanvas={handleToggleCanvas}
        isCanvasOpen={layoutMode !== "chat"}
        taskFiles={visibleTaskFiles}
        selectedFileId={visibleSelectedFileId}
        taskFilesExpanded={taskFilesExpanded}
        onToggleTaskFiles={handleToggleTaskFiles}
        onTaskFileClick={handleTaskFileClick}
        overlayAccessory={
          <>
            {themeWorkbenchEntryPromptAccessory}
            {shouldShowThemeWorkbenchFloatingInputOverlay &&
            showTeamWorkspaceBoard &&
            layoutMode === "chat" ? (
              <TeamWorkspaceDock
                placement="inline"
                shellVisible={chatToolPreferences.subagent}
                onActivateWorkbench={handleActivateTeamWorkbench}
                currentSessionId={sessionId}
                currentSessionName={currentSessionTitle}
                currentSessionRuntimeStatus={currentSessionRuntimeStatus}
                currentSessionLatestTurnStatus={currentSessionLatestTurnStatus}
                currentSessionQueuedTurnCount={queuedTurns.length}
                childSubagentSessions={childSubagentSessions}
                subagentParentContext={subagentParentContext}
                liveRuntimeBySessionId={teamLiveRuntimeBySessionId}
                liveActivityBySessionId={teamLiveActivityBySessionId}
                activityRefreshVersionBySessionId={
                  teamActivityRefreshVersionBySessionId
                }
                onSendSubagentInput={handleSendSubagentInput}
                onWaitSubagentSession={handleWaitSubagentSession}
                onWaitActiveTeamSessions={handleWaitActiveTeamSessions}
                onCloseCompletedTeamSessions={handleCloseCompletedTeamSessions}
                onCloseSubagentSession={handleCloseSubagentSession}
                onResumeSubagentSession={handleResumeSubagentSession}
                onOpenSubagentSession={handleOpenSubagentSession}
                onReturnToParentSession={handleReturnToParentSession}
                teamWaitSummary={teamWaitSummary}
                teamControlSummary={teamControlSummary}
                selectedTeamLabel={selectedTeamLabel}
                selectedTeamSummary={selectedTeamSummary}
                selectedTeamRoles={selectedTeam?.roles}
                runtimeTeamState={runtimeTeamState}
              />
            ) : null}
          </>
        }
        characters={projectMemory?.characters || []}
        skills={skills}
        isSkillsLoading={skillsLoading}
        toolStates={chatToolPreferences}
        onToolStatesChange={setChatToolPreferences}
        onSelectCharacter={handleSelectCharacter}
        onNavigateToSettings={handleNavigateToSkillSettings}
        onRefreshSkills={handleRefreshSkills}
        queuedTurns={queuedTurns}
        onPromoteQueuedTurn={promoteQueuedTurn}
        onRemoveQueuedTurn={removeQueuedTurn}
      />
    ),
    [
      activeTheme,
      chatToolPreferences,
      currentGate,
      executionStrategy,
      handleClearMessages,
      handleActivateTeamWorkbench,
      handleManageProviders,
      handleNavigateToSkillSettings,
      handleRefreshSkills,
      handleSelectCharacter,
      handleSend,
      handleTaskFileClick,
      handleToggleCanvas,
      handleToggleTaskFiles,
      input,
      queuedTurns,
      isSending,
      isThemeWorkbench,
      layoutMode,
      model,
      projectId,
      projectMemory?.characters,
      promoteQueuedTurn,
      providerType,
      removeQueuedTurn,
      setExecutionStrategy,
      setInput,
      setChatToolPreferences,
      setModel,
      setProviderType,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      shouldShowThemeWorkbenchFloatingInputOverlay,
      skills,
      skillsLoading,
      showTeamWorkspaceBoard,
      steps,
      stopSending,
      visibleSelectedFileId,
      visibleTaskFiles,
      taskFilesExpanded,
      themeWorkbenchRunState,
      themeWorkbenchEntryPromptAccessory,
      themeWorkbenchWorkflowSteps,
      handleInputbarA2UISubmit,
      childSubagentSessions,
      currentSessionLatestTurnStatus,
      currentSessionRuntimeStatus,
      currentSessionTitle,
      handleCloseCompletedTeamSessions,
      handleCloseSubagentSession,
      handleEnableSuggestedTeam,
      handleOpenSubagentSession,
      handleResumeSubagentSession,
      handleReturnToParentSession,
      handleSendSubagentInput,
      handleSelectTeam,
      handleWaitActiveTeamSessions,
      handleWaitSubagentSession,
      pendingA2UIForm,
      sessionId,
      subagentParentContext,
      teamControlSummary,
      teamWaitSummary,
      teamActivityRefreshVersionBySessionId,
      teamLiveActivityBySessionId,
      teamLiveRuntimeBySessionId,
      runtimeTeamState,
      a2uiSubmissionNotice,
    ],
  );

  const generalWorkbenchDialog = useMemo(() => {
    if (chatMode !== "general" || isThemeWorkbench) {
      return null;
    }

    return (
      <Dialog open={harnessPanelVisible} onOpenChange={setHarnessPanelVisible}>
        <DialogContent
          maxWidth="max-w-6xl"
          className="flex h-[90vh] max-h-[90vh] flex-col overflow-hidden p-0"
          draggable={true}
          dragHandleSelector='[data-harness-drag-handle="true"]'
        >
          <HarnessStatusPanel
            harnessState={harnessState}
            compatSubagentRuntime={compatSubagentRuntime}
            environment={harnessEnvironment}
            childSubagentSessions={childSubagentSessions}
            selectedTeamLabel={selectedTeamLabel}
            selectedTeamSummary={selectedTeamSummary}
            selectedTeamRoles={selectedTeam?.roles}
            toolInventory={toolInventory}
            toolInventoryLoading={toolInventoryLoading}
            toolInventoryError={toolInventoryError}
            onRefreshToolInventory={refreshToolInventory}
            layout="dialog"
            title="Agent 工作台"
            description="集中查看计划、审批、协作成员、文件活动与工具产物。"
            toggleLabel="工作台详情"
            leadContent={
              <AgentRuntimeStrip
                activeTheme={mappedTheme}
                toolPreferences={chatToolPreferences}
                harnessState={harnessState}
                childSubagentSessions={childSubagentSessions}
                compatSubagentRuntime={compatSubagentRuntime}
                variant="embedded"
                isSending={isSending}
                runtimeStatusTitle={activeRuntimeStatusTitle}
                selectedTeamLabel={selectedTeamLabel}
                selectedTeamSummary={selectedTeamSummary}
                selectedTeamRoleCount={selectedTeam?.roles.length || 0}
              />
            }
            onOpenSubagentSession={handleOpenSubagentSession}
            onLoadFilePreview={handleHarnessLoadFilePreview}
            onOpenFile={handleFileClick}
          />
        </DialogContent>
      </Dialog>
    );
  }, [
    chatMode,
    chatToolPreferences,
    activeRuntimeStatusTitle,
    childSubagentSessions,
    handleFileClick,
    handleHarnessLoadFilePreview,
    handleOpenSubagentSession,
    harnessPanelVisible,
    harnessEnvironment,
    harnessState,
    isSending,
    isThemeWorkbench,
    mappedTheme,
    refreshToolInventory,
    compatSubagentRuntime,
    selectedTeam?.roles,
    selectedTeamLabel,
    selectedTeamSummary,
    toolInventory,
    toolInventoryError,
    toolInventoryLoading,
  ]);

  const canvasRenderTheme = useMemo(
    () =>
      (shouldBootstrapCanvasOnEntry
        ? normalizedEntryTheme
        : mappedTheme) as ThemeType,
    [mappedTheme, normalizedEntryTheme, shouldBootstrapCanvasOnEntry],
  );

  const shouldShowCanvasLoadingState = useMemo(
    () =>
      (!canvasState &&
        (shouldBootstrapCanvasOnEntry ||
          isInitialContentLoading ||
          Boolean(initialContentLoadError))) ||
      (resolvedCanvasState?.type === "document" &&
        !resolvedCanvasState.content.trim() &&
        (isInitialContentLoading || Boolean(initialContentLoadError))),
    [
      canvasState,
      initialContentLoadError,
      isInitialContentLoading,
      resolvedCanvasState,
      shouldBootstrapCanvasOnEntry,
    ],
  );

  const canvasWorkbenchDefaultPreview =
    useMemo<CanvasWorkbenchDefaultPreview | null>(() => {
      const workspaceRoot = project?.rootPath || null;

      if (canvasRenderTheme === "general") {
        if (!generalCanvasState.isOpen || !generalCanvasState.content.trim()) {
          return null;
        }

        const filePath = generalCanvasState.filename?.trim() || undefined;
        return {
          title: filePath ? extractFileNameFromPath(filePath) : "当前画布草稿",
          content: generalCanvasState.content,
          filePath,
          absolutePath: resolveAbsoluteWorkspacePath(workspaceRoot, filePath),
          previousContent: null,
        };
      }

      if (!resolvedCanvasState || isCanvasStateEmpty(resolvedCanvasState)) {
        return null;
      }

      const taskFile = activeCanvasTaskFile;
      const taskSelectionKey = taskFile ? `task:${taskFile.id}` : undefined;

      if (resolvedCanvasState.type === "document") {
        const currentVersion =
          resolvedCanvasState.versions.find(
            (item) => item.id === resolvedCanvasState.currentVersionId,
          ) ||
          resolvedCanvasState.versions[
            resolvedCanvasState.versions.length - 1
          ] ||
          null;
        const filePath =
          taskFile?.name || currentVersion?.metadata?.sourceFileName;

        return {
          selectionKey:
            taskSelectionKey ||
            (currentVersion ? `version:${currentVersion.id}` : undefined),
          title: filePath ? extractFileNameFromPath(filePath) : "当前文稿",
          content: resolvedCanvasState.content,
          filePath,
          absolutePath: resolveAbsoluteWorkspacePath(workspaceRoot, filePath),
          previousContent: resolvePreviousDocumentVersionContent(
            currentVersion,
            resolvedCanvasState.versions,
          ),
        };
      }

      const filePath = taskFile?.name;
      return {
        selectionKey: taskSelectionKey,
        title: filePath ? extractFileNameFromPath(filePath) : "当前画布",
        content: serializeCanvasStateForSync(resolvedCanvasState),
        filePath,
        absolutePath: resolveAbsoluteWorkspacePath(workspaceRoot, filePath),
        previousContent: null,
      };
    }, [
      activeCanvasTaskFile,
      canvasRenderTheme,
      generalCanvasState.content,
      generalCanvasState.filename,
      generalCanvasState.isOpen,
      project?.rootPath,
      resolvedCanvasState,
    ]);

  const handleOpenCanvasWorkbenchPath = useCallback(async (path: string) => {
    try {
      await openPathWithDefaultApp(path);
    } catch (error) {
      toast.error(
        `打开文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const handleRevealCanvasWorkbenchPath = useCallback(async (path: string) => {
    try {
      await revealPathInFinder(path);
    } catch (error) {
      toast.error(
        `定位文件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const renderArtifactWorkbenchPreview = useCallback(
    (artifact: Artifact, stackedWorkbenchTrigger?: ReactNode) => {
      const isLiveSelectedArtifact =
        currentCanvasArtifact?.id === artifact.id &&
        displayedCanvasArtifact !== null;
      const toolbarArtifact =
        isLiveSelectedArtifact && currentCanvasArtifact
          ? currentCanvasArtifact
          : artifact;
      const previewArtifact =
        isLiveSelectedArtifact && displayedCanvasArtifact
          ? displayedCanvasArtifact
          : artifact;
      const isBrowserAssistArtifact = previewArtifact.type === "browser_assist";

      if (isBrowserAssistArtifact) {
        return wrapPreviewWithWorkbenchTrigger(
          <div className="relative h-full min-h-0 overflow-hidden rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)]">
            <ArtifactRenderer
              artifact={previewArtifact}
              isStreaming={Boolean(
                isLiveSelectedArtifact &&
                currentCanvasArtifact &&
                displayedCanvasArtifact &&
                currentCanvasArtifact.id === displayedCanvasArtifact.id &&
                currentCanvasArtifact.id === previewArtifact.id &&
                currentCanvasArtifact.status === "streaming",
              )}
              hideToolbar={true}
              viewMode={artifactViewMode}
              previewSize={artifactPreviewSize}
              tone="light"
            />
            {isLiveSelectedArtifact && artifactDisplayState.overlay ? (
              <ArtifactCanvasOverlay overlay={artifactDisplayState.overlay} />
            ) : null}
          </div>,
          stackedWorkbenchTrigger,
        );
      }

      return (
        <div className="flex h-full flex-col rounded-[24px] border border-slate-200 bg-white shadow-sm shadow-slate-950/5">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ArtifactToolbar
              artifact={toolbarArtifact}
              onClose={handleCloseCanvas}
              isStreaming={Boolean(
                isLiveSelectedArtifact &&
                currentCanvasArtifact?.status === "streaming",
              )}
              viewMode={artifactViewMode}
              onViewModeChange={setArtifactViewMode}
              previewSize={artifactPreviewSize}
              onPreviewSizeChange={setArtifactPreviewSize}
              tone="light"
              displayBadgeLabel={
                isLiveSelectedArtifact &&
                artifactDisplayState.showPreviousVersionBadge
                  ? "预览上一版本"
                  : undefined
              }
              actionsSlot={stackedWorkbenchTrigger}
            />
            <div className="relative flex-1 overflow-auto bg-white">
              <ArtifactRenderer
                artifact={previewArtifact}
                isStreaming={Boolean(
                  isLiveSelectedArtifact &&
                  currentCanvasArtifact &&
                  displayedCanvasArtifact &&
                  currentCanvasArtifact.id === displayedCanvasArtifact.id &&
                  currentCanvasArtifact.id === previewArtifact.id &&
                  currentCanvasArtifact.status === "streaming",
                )}
                hideToolbar={true}
                viewMode={artifactViewMode}
                previewSize={artifactPreviewSize}
                tone="light"
              />
              {isLiveSelectedArtifact && artifactDisplayState.overlay ? (
                <ArtifactCanvasOverlay overlay={artifactDisplayState.overlay} />
              ) : null}
            </div>
          </div>
        </div>
      );
    },
    [
      artifactDisplayState.overlay,
      artifactDisplayState.showPreviousVersionBadge,
      artifactPreviewSize,
      artifactViewMode,
      currentCanvasArtifact,
      displayedCanvasArtifact,
      handleCloseCanvas,
      setArtifactPreviewSize,
      setArtifactViewMode,
    ],
  );

  const renderLiveCanvasPreview = useCallback(
    (stackedWorkbenchTrigger?: ReactNode) => {
      if (
        canvasRenderTheme === "general" &&
        currentCanvasArtifact &&
        displayedCanvasArtifact
      ) {
        return renderArtifactWorkbenchPreview(
          currentCanvasArtifact,
          stackedWorkbenchTrigger,
        );
      }

      if (canvasRenderTheme === "general") {
        if (generalCanvasState.isOpen) {
          return (
            <GeneralCanvasPanel
              state={generalCanvasState}
              onClose={handleCloseCanvas}
              onContentChange={(content) =>
                setGeneralCanvasState((prev) => ({ ...prev, content }))
              }
              toolbarActions={stackedWorkbenchTrigger}
            />
          );
        }
        return null;
      }

      if (shouldShowCanvasLoadingState) {
        return wrapPreviewWithWorkbenchTrigger(
          <div
            data-testid="canvas-loading-state"
            className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500"
          >
            {isInitialContentLoading
              ? "正在加载文稿内容..."
              : initialContentLoadError || "正在准备文稿画布..."}
          </div>,
          stackedWorkbenchTrigger,
        );
      }

      if (!resolvedCanvasState) {
        return null;
      }

      return wrapPreviewWithWorkbenchTrigger(
        <CanvasFactory
          theme={canvasRenderTheme}
          state={resolvedCanvasState}
          onStateChange={setCanvasState}
          onBackHome={handleBackHome}
          onClose={handleCloseCanvas}
          isStreaming={isSending}
          onSelectionTextChange={handleCanvasSelectionTextChange}
          projectId={projectId ?? null}
          contentId={contentId ?? null}
          autoImageTopic={project?.name || undefined}
          autoContinueProviderType={providerType}
          onAutoContinueProviderTypeChange={setProviderType}
          autoContinueModel={model}
          onAutoContinueModelChange={setModel}
          autoContinueThinkingEnabled={chatToolPreferences.thinking}
          onAutoContinueThinkingEnabledChange={
            handleDocumentThinkingEnabledChange
          }
          onAutoContinueRun={handleDocumentAutoContinueRun}
          onAddImage={handleAddImage}
          onImportDocument={handleImportDocument}
          onContentReviewRun={handleDocumentContentReviewRun}
          onTextStylizeRun={handleDocumentTextStylizeRun}
          documentContentReviewPlacement={
            preferContentReviewInRightRail ? "external-rail" : "inline"
          }
          novelControls={
            resolvedCanvasState.type === "novel"
              ? {
                  useExternalToolbar: true,
                  chapterListCollapsed: novelChapterListCollapsed,
                  onChapterListCollapsedChange: setNovelChapterListCollapsed,
                }
              : null
          }
        />,
        stackedWorkbenchTrigger,
      );
    },
    [
      canvasRenderTheme,
      chatToolPreferences.thinking,
      contentId,
      currentCanvasArtifact,
      displayedCanvasArtifact,
      generalCanvasState,
      handleAddImage,
      handleBackHome,
      handleCloseCanvas,
      handleCanvasSelectionTextChange,
      handleDocumentAutoContinueRun,
      handleDocumentContentReviewRun,
      handleDocumentThinkingEnabledChange,
      handleDocumentTextStylizeRun,
      handleImportDocument,
      initialContentLoadError,
      isInitialContentLoading,
      isSending,
      model,
      novelChapterListCollapsed,
      preferContentReviewInRightRail,
      project?.name,
      projectId,
      providerType,
      renderArtifactWorkbenchPreview,
      resolvedCanvasState,
      setModel,
      setProviderType,
      shouldShowCanvasLoadingState,
    ],
  );

  const renderTeamWorkbenchPreview = useCallback(
    (stackedWorkbenchTrigger?: ReactNode) =>
      wrapPreviewWithWorkbenchTrigger(
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-sm shadow-slate-950/5">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <TeamWorkspaceBoard
              embedded={true}
              shellVisible={chatToolPreferences.subagent}
              defaultShellExpanded={true}
              currentSessionId={sessionId}
              currentSessionName={currentSessionTitle}
              currentSessionRuntimeStatus={currentSessionRuntimeStatus}
              currentSessionLatestTurnStatus={currentSessionLatestTurnStatus}
              currentSessionQueuedTurnCount={queuedTurns.length}
              childSubagentSessions={childSubagentSessions}
              subagentParentContext={subagentParentContext}
              liveRuntimeBySessionId={teamLiveRuntimeBySessionId}
              liveActivityBySessionId={teamLiveActivityBySessionId}
              activityRefreshVersionBySessionId={
                teamActivityRefreshVersionBySessionId
              }
              onSendSubagentInput={handleSendSubagentInput}
              onWaitSubagentSession={handleWaitSubagentSession}
              onWaitActiveTeamSessions={handleWaitActiveTeamSessions}
              onCloseCompletedTeamSessions={handleCloseCompletedTeamSessions}
              onCloseSubagentSession={handleCloseSubagentSession}
              onResumeSubagentSession={handleResumeSubagentSession}
              onOpenSubagentSession={handleOpenSubagentSession}
              onReturnToParentSession={handleReturnToParentSession}
              teamWaitSummary={teamWaitSummary}
              teamControlSummary={teamControlSummary}
              selectedTeamLabel={selectedTeamLabel}
              selectedTeamSummary={selectedTeamSummary}
              selectedTeamRoles={selectedTeam?.roles}
              runtimeTeamState={runtimeTeamState}
            />
          </div>
        </div>,
        stackedWorkbenchTrigger,
      ),
    [
      chatToolPreferences.subagent,
      childSubagentSessions,
      currentSessionLatestTurnStatus,
      currentSessionRuntimeStatus,
      currentSessionTitle,
      handleCloseCompletedTeamSessions,
      handleCloseSubagentSession,
      handleOpenSubagentSession,
      handleResumeSubagentSession,
      handleReturnToParentSession,
      handleSendSubagentInput,
      handleWaitActiveTeamSessions,
      handleWaitSubagentSession,
      queuedTurns.length,
      sessionId,
      subagentParentContext,
      teamActivityRefreshVersionBySessionId,
      teamControlSummary,
      teamLiveActivityBySessionId,
      teamLiveRuntimeBySessionId,
      teamWaitSummary,
      runtimeTeamState,
      selectedTeam?.roles,
      selectedTeamLabel,
      selectedTeamSummary,
    ],
  );

  const teamWorkbenchSummaryPanel = useMemo(
    () => (
      <TeamWorkbenchSummaryPanel
        currentSessionId={sessionId}
        currentSessionRuntimeStatus={currentSessionRuntimeStatus}
        currentSessionLatestTurnStatus={currentSessionLatestTurnStatus}
        currentSessionQueuedTurnCount={queuedTurns.length}
        childSubagentSessions={childSubagentSessions}
        subagentParentContext={subagentParentContext}
        liveRuntimeBySessionId={teamLiveRuntimeBySessionId}
        liveActivityBySessionId={teamLiveActivityBySessionId}
        teamWaitSummary={teamWaitSummary}
        teamControlSummary={teamControlSummary}
        selectedTeamLabel={selectedTeamLabel}
        selectedTeamSummary={selectedTeamSummary}
        selectedTeamRoles={selectedTeam?.roles}
        runtimeTeamState={runtimeTeamState}
      />
    ),
    [
      childSubagentSessions,
      currentSessionLatestTurnStatus,
      currentSessionRuntimeStatus,
      queuedTurns.length,
      selectedTeam?.roles,
      selectedTeamLabel,
      selectedTeamSummary,
      sessionId,
      subagentParentContext,
      teamControlSummary,
      teamLiveActivityBySessionId,
      teamLiveRuntimeBySessionId,
      teamWaitSummary,
      runtimeTeamState,
    ],
  );

  const teamWorkbenchExecutionSummary = useMemo(
    () =>
      summarizeTeamWorkspaceExecution({
        currentSessionId: sessionId,
        currentSessionRuntimeStatus,
        currentSessionLatestTurnStatus,
        currentSessionQueuedTurnCount: queuedTurns.length,
        childSubagentSessions,
        subagentParentContext,
        liveRuntimeBySessionId: teamLiveRuntimeBySessionId,
      }),
    [
      childSubagentSessions,
      currentSessionLatestTurnStatus,
      currentSessionRuntimeStatus,
      queuedTurns.length,
      sessionId,
      subagentParentContext,
      teamLiveRuntimeBySessionId,
    ],
  );

  const teamWorkbenchTriggerState = useMemo(() => {
    if (!showTeamWorkspaceBoard) {
      return null;
    }

    if (runtimeTeamState?.status === "failed") {
      return { tone: "error" as const, label: "失败" };
    }

    if (runtimeTeamState?.status === "forming") {
      return { tone: "active" as const, label: "组建中" };
    }

    if (teamWorkbenchExecutionSummary.runningSessionCount > 0) {
      return {
        tone: "active" as const,
        label:
          teamWorkbenchExecutionSummary.runningSessionCount > 1
            ? `${teamWorkbenchExecutionSummary.runningSessionCount} 运行中`
            : "运行中",
      };
    }

    if (teamWorkbenchExecutionSummary.queuedSessionCount > 0) {
      return {
        tone: "active" as const,
        label:
          teamWorkbenchExecutionSummary.queuedSessionCount > 1
            ? `${teamWorkbenchExecutionSummary.queuedSessionCount} 排队`
            : "排队中",
      };
    }

    if (runtimeTeamState?.status === "formed" && !hasRealTeamGraph) {
      return { tone: "active" as const, label: "已就绪" };
    }

    if (
      Object.values(teamLiveActivityBySessionId).some(
        (entries) => (entries?.length ?? 0) > 0,
      ) ||
      Boolean(teamWaitSummary) ||
      Boolean(teamControlSummary)
    ) {
      return { tone: "active" as const, label: "有更新" };
    }

    return { tone: "idle" as const, label: null };
  }, [
    hasRealTeamGraph,
    runtimeTeamState,
    showTeamWorkspaceBoard,
    teamControlSummary,
    teamLiveActivityBySessionId,
    teamWaitSummary,
    teamWorkbenchExecutionSummary.queuedSessionCount,
    teamWorkbenchExecutionSummary.runningSessionCount,
  ]);

  const renderCanvasWorkbenchPreview = useCallback(
    (
      target: CanvasWorkbenchPreviewTarget,
      options?: {
        stackedWorkbenchTrigger?: ReactNode;
      },
    ) => {
      switch (target.kind) {
        case "default-canvas":
          return renderLiveCanvasPreview(options?.stackedWorkbenchTrigger);
        case "artifact":
        case "synthetic-artifact":
          return renderArtifactWorkbenchPreview(
            target.artifact,
            options?.stackedWorkbenchTrigger,
          );
        case "loading":
          return wrapPreviewWithWorkbenchTrigger(
            <div
              data-testid="canvas-workbench-preview-loading"
              className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500"
            >
              正在准备预览...
            </div>,
            options?.stackedWorkbenchTrigger,
          );
        case "unsupported":
          return wrapPreviewWithWorkbenchTrigger(
            <div
              data-testid="canvas-workbench-preview-unsupported"
              className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-6 text-sm text-slate-500"
            >
              {target.reason}
            </div>,
            options?.stackedWorkbenchTrigger,
          );
        case "empty":
          return wrapPreviewWithWorkbenchTrigger(
            <div
              data-testid="canvas-workbench-preview-empty"
              className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500"
            >
              暂无可预览内容
            </div>,
            options?.stackedWorkbenchTrigger,
          );
        case "team-workbench":
          return renderTeamWorkbenchPreview(options?.stackedWorkbenchTrigger);
        default:
          return null;
      }
    },
    [
      renderArtifactWorkbenchPreview,
      renderLiveCanvasPreview,
      renderTeamWorkbenchPreview,
    ],
  );

  const shouldRenderInlineA2UI = isContentCreationMode;
  const isWorkspaceCompactChrome = topBarChrome === "workspace-compact";
  const shouldRenderBrandedEmptyState = !showChatLayout;
  const shouldRenderTopBar = !hideTopBar && !shouldRenderBrandedEmptyState;
  const teamWorkbenchView = useMemo(
    () =>
      showTeamWorkspaceBoard
        ? {
            enabled: true,
            title:
              runtimeTeamState?.label?.trim() ||
              runtimeTeamState?.blueprint?.label?.trim() ||
              selectedTeamLabel ||
              "Team Workbench",
            subtitle: hasRealTeamGraph
              ? "主对话保留调度记录，画布按角色分别展示执行过程与结果。"
              : runtimeTeamState?.status === "forming"
                ? "正在为本轮任务组建成员，画布会先展示蓝图轨道，真实角色加入后自动接管。"
                : runtimeTeamState?.status === "formed"
                  ? "本轮 Team 已就绪，主对话仅保留调度记录，执行正文继续留在各角色轨道。"
                  : runtimeTeamState?.status === "failed"
                    ? runtimeTeamState.errorMessage?.trim() ||
                      "本轮 Team 准备失败，可直接查看失败原因并继续当前对话。"
                    : "Team 模式已启用，等待系统创建真实团队成员。",
            autoFocusToken: teamWorkbenchAutoFocusToken,
            triggerState: teamWorkbenchTriggerState,
            renderPreview: (options?: { stackedWorkbenchTrigger?: ReactNode }) =>
              renderTeamWorkbenchPreview(options?.stackedWorkbenchTrigger),
            renderPanel: () => teamWorkbenchSummaryPanel,
          }
        : null,
    [
      hasRealTeamGraph,
      renderTeamWorkbenchPreview,
      runtimeTeamState,
      selectedTeamLabel,
      showTeamWorkspaceBoard,
      teamWorkbenchTriggerState,
      teamWorkbenchAutoFocusToken,
      teamWorkbenchSummaryPanel,
    ],
  );
  const shouldUseTeamPrimaryChatPanelWidth =
    layoutMode === "chat-canvas" &&
    showTeamWorkspaceBoard &&
    (hasRealTeamGraph || Boolean(runtimeTeamState));
  const layoutTransitionChatPanelWidth = shouldUseTeamPrimaryChatPanelWidth
    ? TEAM_PRIMARY_CHAT_PANEL_WIDTH
    : undefined;
  const layoutTransitionChatPanelMinWidth = shouldUseTeamPrimaryChatPanelWidth
    ? TEAM_PRIMARY_CHAT_PANEL_MIN_WIDTH
    : undefined;
  const themeWorkbenchLayoutBottomSpacing =
    resolveThemeWorkbenchLayoutBottomSpacing({
      contextWorkspaceEnabled: contextWorkspace.enabled,
      showFloatingInputOverlay: shouldShowThemeWorkbenchFloatingInputOverlay,
      hasCanvasContent: layoutMode !== "chat",
      themeWorkbenchRunState,
      gateStatus: currentGate.status,
    });

  // 聊天区域内容
  const chatContent = useMemo(
    () => (
      <ChatContainer>
        <ChatContainerInner>
          {entryBannerVisible && entryBannerMessage ? (
            <EntryBanner>
              <Info className="h-4 w-4 shrink-0" />
              <span>{entryBannerMessage}</span>
              <EntryBannerClose
                type="button"
                onClick={() => setEntryBannerVisible(false)}
                aria-label="关闭入口提示"
              >
                关闭
              </EntryBannerClose>
            </EntryBanner>
          ) : null}
          {!hideInlineStepProgress &&
            isContentCreationMode &&
            hasMessages &&
            steps.length > 0 && (
              <StepProgress
                steps={steps}
                currentIndex={currentStepIndex}
                onStepClick={goToStep}
              />
            )}

          {isContentCreationMode && projectId ? (
            <RuntimeStyleControlBar
              projectId={projectId}
              activeTheme={mappedTheme}
              projectStyleGuide={projectMemory?.style_guide}
              selection={runtimeStyleSelection}
              onSelectionChange={setRuntimeStyleSelection}
              onRewrite={handleRunStyleRewrite}
              onAudit={handleRunStyleAudit}
              actionsDisabled={styleActionsDisabled}
            />
          ) : null}
          {showChatLayout ? (
            <ChatContent $compact={isWorkspaceCompactChrome}>
              <>
                {contextWorkspace.enabled ? (
                  <MessageViewport
                    $bottomPadding={
                      themeWorkbenchLayoutBottomSpacing.messageViewportBottomPadding
                    }
                  >
                    <MessageList
                      messages={displayMessages}
                      turns={turns}
                      threadItems={effectiveThreadItems}
                      currentTurnId={currentTurnId}
                      onDeleteMessage={deleteMessage}
                      onEditMessage={editMessage}
                      onA2UISubmit={handleA2UISubmit}
                      onWriteFile={handleWriteFile}
                      onFileClick={handleFileClick}
                      onArtifactClick={handleArtifactClick}
                      onOpenSubagentSession={handleOpenSubagentSession}
                      onPermissionResponse={
                        handlePermissionResponseWithBrowserPreflight
                      }
                      promoteActionRequestsToA2UI={Boolean(
                        pendingPromotedA2UIActionRequest,
                      )}
                      renderA2UIInline={shouldRenderInlineA2UI}
                      collapseCodeBlocks={shouldCollapseCodeBlocks}
                      shouldCollapseCodeBlock={shouldCollapseCodeBlockInChat}
                      onCodeBlockClick={handleCodeBlockClick}
                    />
                  </MessageViewport>
                ) : (
                  <MessageList
                    messages={displayMessages}
                    turns={turns}
                    threadItems={effectiveThreadItems}
                    currentTurnId={currentTurnId}
                    onDeleteMessage={deleteMessage}
                    onEditMessage={editMessage}
                    onA2UISubmit={handleA2UISubmit}
                    onWriteFile={handleWriteFile}
                    onFileClick={handleFileClick}
                    onArtifactClick={handleArtifactClick}
                    onOpenSubagentSession={handleOpenSubagentSession}
                    onPermissionResponse={
                      handlePermissionResponseWithBrowserPreflight
                    }
                    promoteActionRequestsToA2UI={Boolean(
                      pendingPromotedA2UIActionRequest,
                    )}
                    renderA2UIInline={shouldRenderInlineA2UI}
                    collapseCodeBlocks={shouldCollapseCodeBlocks}
                    shouldCollapseCodeBlock={shouldCollapseCodeBlockInChat}
                    onCodeBlockClick={handleCodeBlockClick}
                  />
                )}
                {showTeamWorkspaceBoard &&
                !shouldShowThemeWorkbenchFloatingInputOverlay &&
                layoutMode === "chat" ? (
                  <TeamWorkspaceDock
                    shellVisible={chatToolPreferences.subagent}
                    onActivateWorkbench={handleActivateTeamWorkbench}
                    withBottomOverlay={
                      isThemeWorkbench &&
                      showChatLayout &&
                      !shouldHideThemeWorkbenchInputForTheme
                    }
                    currentSessionId={sessionId}
                    currentSessionName={currentSessionTitle}
                    currentSessionRuntimeStatus={currentSessionRuntimeStatus}
                    currentSessionLatestTurnStatus={
                      currentSessionLatestTurnStatus
                    }
                    currentSessionQueuedTurnCount={queuedTurns.length}
                    childSubagentSessions={childSubagentSessions}
                    subagentParentContext={subagentParentContext}
                    liveRuntimeBySessionId={teamLiveRuntimeBySessionId}
                    liveActivityBySessionId={teamLiveActivityBySessionId}
                    activityRefreshVersionBySessionId={
                      teamActivityRefreshVersionBySessionId
                    }
                    onSendSubagentInput={handleSendSubagentInput}
                    onWaitSubagentSession={handleWaitSubagentSession}
                    onWaitActiveTeamSessions={handleWaitActiveTeamSessions}
                    onCloseCompletedTeamSessions={
                      handleCloseCompletedTeamSessions
                    }
                    onCloseSubagentSession={handleCloseSubagentSession}
                    onResumeSubagentSession={handleResumeSubagentSession}
                    onOpenSubagentSession={handleOpenSubagentSession}
                    onReturnToParentSession={handleReturnToParentSession}
                    teamWaitSummary={teamWaitSummary}
                    teamControlSummary={teamControlSummary}
                    selectedTeamLabel={selectedTeamLabel}
                    selectedTeamSummary={selectedTeamSummary}
                    selectedTeamRoles={selectedTeam?.roles}
                    runtimeTeamState={runtimeTeamState}
                  />
                ) : null}
              </>
            </ChatContent>
          ) : (
            <EmptyState
              input={input}
              setInput={setInput}
              onSend={(text, sendExecutionStrategy, images) => {
                handleSend(
                  images || [],
                  chatToolPreferences.webSearch,
                  chatToolPreferences.thinking,
                  text,
                  sendExecutionStrategy,
                );
              }}
              providerType={providerType}
              setProviderType={setProviderType}
              model={model}
              setModel={setModel}
              executionStrategy={executionStrategy}
              setExecutionStrategy={setExecutionStrategy}
              onManageProviders={handleManageProviders}
              webSearchEnabled={chatToolPreferences.webSearch}
              onWebSearchEnabledChange={(enabled) =>
                setChatToolPreferences((prev) => ({
                  ...prev,
                  webSearch: enabled,
                }))
              }
              thinkingEnabled={chatToolPreferences.thinking}
              onThinkingEnabledChange={(enabled) =>
                setChatToolPreferences((prev) => ({
                  ...prev,
                  thinking: enabled,
                }))
              }
              taskEnabled={chatToolPreferences.task}
              onTaskEnabledChange={(enabled) =>
                setChatToolPreferences((prev) => ({
                  ...prev,
                  task: enabled,
                }))
              }
              subagentEnabled={chatToolPreferences.subagent}
              onSubagentEnabledChange={(enabled) =>
                setChatToolPreferences((prev) => ({
                  ...prev,
                  subagent: enabled,
                }))
              }
              selectedTeam={selectedTeam}
              onSelectTeam={handleSelectTeam}
              onEnableSuggestedTeam={handleEnableSuggestedTeam}
              creationMode={creationMode}
              onCreationModeChange={setCreationMode}
              activeTheme={activeTheme}
              onThemeChange={(theme) => {
                if (!lockTheme) {
                  setActiveTheme(theme);
                }
              }}
              showThemeTabs={false}
              hasCanvasContent={
                activeTheme === "general"
                  ? artifacts.length > 0 ||
                    Boolean(generalCanvasState.content?.trim())
                  : !isCanvasStateEmpty(resolvedCanvasState)
              }
              hasContentId={Boolean(contentId)}
              selectedText={selectedText}
              onRecommendationClick={handleRecommendationClick}
              characters={projectMemory?.characters || []}
              skills={skills}
              isSkillsLoading={skillsLoading}
              onNavigateToSettings={handleNavigateToSkillSettings}
              onRefreshSkills={handleRefreshSkills}
              onLaunchBrowserAssist={handleOpenBrowserAssistInCanvas}
              browserAssistLoading={browserAssistLaunching}
              projectId={projectId ?? null}
              onProjectChange={handleProjectChange}
              onOpenSettings={() => {
                _onNavigate?.("settings", {
                  tab: SettingsTabs.Appearance,
                });
              }}
            />
          )}

          {showChatLayout && (
            <>
              {(workspacePathMissing || workspaceHealthError) && (
                <div className="mx-4 mb-2 flex items-center gap-2 rounded-[18px] border border-amber-200/90 bg-amber-50/86 px-3.5 py-2.5 text-sm text-amber-800 shadow-sm shadow-amber-950/5 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  <span className="flex-1">
                    工作区目录不存在，请重新选择一个本地目录后继续
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleSelectWorkspaceDirectory()}
                    className="shrink-0 rounded-xl border border-amber-200 bg-white/84 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:border-amber-300 hover:bg-white dark:bg-amber-800 dark:text-amber-100 dark:hover:bg-amber-700"
                  >
                    重新选择目录
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setWorkspaceHealthError(false);
                      dismissWorkspacePathError();
                    }}
                    className="shrink-0 text-amber-600 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>
              )}
              {!contextWorkspace.enabled &&
              !shouldHideThemeWorkbenchInputForTheme
                ? inputbarNode
                : null}
            </>
          )}
        </ChatContainerInner>
      </ChatContainer>
    ),
    [
      _onNavigate,
      activeTheme,
      artifacts.length,
      browserAssistLaunching,
      chatToolPreferences,
      contentId,
      contextWorkspace.enabled,
      creationMode,
      currentStepIndex,
      currentTurnId,
      deleteMessage,
      dismissWorkspacePathError,
      entryBannerMessage,
      entryBannerVisible,
      editMessage,
      executionStrategy,
      generalCanvasState.content,
      goToStep,
      handleA2UISubmit,
      handleActivateTeamWorkbench,
      handleArtifactClick,
      handleCloseCompletedTeamSessions,
      handleCloseSubagentSession,
      handleCodeBlockClick,
      handleFileClick,
      handleEnableSuggestedTeam,
      handleManageProviders,
      handleNavigateToSkillSettings,
      handleOpenBrowserAssistInCanvas,
      handleOpenSubagentSession,
      handleReturnToParentSession,
      handleResumeSubagentSession,
      handleSendSubagentInput,
      handleWaitActiveTeamSessions,
      handleWaitSubagentSession,
      handleProjectChange,
      handleRecommendationClick,
      handleRefreshSkills,
      handlePermissionResponseWithBrowserPreflight,
      handleSelectTeam,
      handleSelectWorkspaceDirectory,
      handleSend,
      handleWriteFile,
      hideInlineStepProgress,
      input,
      inputbarNode,
      isContentCreationMode,
      isThemeWorkbench,
      isWorkspaceCompactChrome,
      layoutMode,
      lockTheme,
      displayMessages,
      model,
      turns,
      projectId,
      projectMemory?.characters,
      projectMemory?.style_guide,
      providerType,
      pendingPromotedA2UIActionRequest,
      setCreationMode,
      setExecutionStrategy,
      setChatToolPreferences,
      setInput,
      setModel,
      setProviderType,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      setWorkspaceHealthError,
      shouldCollapseCodeBlocks,
      selectedText,
      setEntryBannerVisible,
      showChatLayout,
      effectiveThreadItems,
      handleRunStyleAudit,
      handleRunStyleRewrite,
      hasMessages,
      childSubagentSessions,
      currentSessionLatestTurnStatus,
      currentSessionRuntimeStatus,
      currentSessionTitle,
      mappedTheme,
      runtimeStyleSelection,
      sessionId,
      showTeamWorkspaceBoard,
      teamActivityRefreshVersionBySessionId,
      teamLiveActivityBySessionId,
      teamLiveRuntimeBySessionId,
      styleActionsDisabled,
      skills,
      skillsLoading,
      steps,
      subagentParentContext,
      teamControlSummary,
      teamWaitSummary,
      runtimeTeamState,
      workspaceHealthError,
      workspacePathMissing,
      resolvedCanvasState,
      shouldHideThemeWorkbenchInputForTheme,
      shouldCollapseCodeBlockInChat,
      shouldShowThemeWorkbenchFloatingInputOverlay,
      themeWorkbenchLayoutBottomSpacing.messageViewportBottomPadding,
      queuedTurns.length,
      shouldRenderInlineA2UI,
    ],
  );

  // 画布区域内容
  const canvasContent = useMemo(() => {
    const liveCanvasPreview = renderLiveCanvasPreview();
    if (!liveCanvasPreview && !teamWorkbenchView) {
      return null;
    }

    if (
      !teamWorkbenchView &&
      (shouldShowCanvasLoadingState || isBrowserAssistCanvasVisible)
    ) {
      return liveCanvasPreview;
    }

    return (
      <CanvasWorkbenchLayout
        artifacts={settledWorkbenchArtifacts}
        canvasState={resolvedCanvasState}
        taskFiles={taskFiles}
        selectedFileId={selectedFileId}
        workspaceRoot={project?.rootPath || null}
        workspaceUnavailable={Boolean(
          workspacePathMissing || workspaceHealthError,
        )}
        defaultPreview={canvasWorkbenchDefaultPreview}
        loadFilePreview={handleHarnessLoadFilePreview}
        onOpenPath={handleOpenCanvasWorkbenchPath}
        onRevealPath={handleRevealCanvasWorkbenchPath}
        renderPreview={renderCanvasWorkbenchPreview}
        onLayoutModeChange={setCanvasWorkbenchLayoutMode}
        teamView={teamWorkbenchView}
      />
    );
  }, [
    canvasWorkbenchDefaultPreview,
    handleHarnessLoadFilePreview,
    handleOpenCanvasWorkbenchPath,
    handleRevealCanvasWorkbenchPath,
    project,
    renderCanvasWorkbenchPreview,
    renderLiveCanvasPreview,
    resolvedCanvasState,
    selectedFileId,
    settledWorkbenchArtifacts,
    shouldShowCanvasLoadingState,
    isBrowserAssistCanvasVisible,
    setCanvasWorkbenchLayoutMode,
    taskFiles,
    teamWorkbenchView,
    workspaceHealthError,
    workspacePathMissing,
  ]);

  const mainAreaNode = useMemo(
    () => (
      <MainArea $compact={isWorkspaceCompactChrome}>
        {shouldRenderTopBar && (
          <>
            <ChatNavbar
              isRunning={isSending}
              chrome={topBarChrome}
              onToggleHistory={handleToggleSidebar}
              showHistoryToggle={!hideHistoryToggle && showChatPanel}
              onToggleFullscreen={() => {}}
              onBackToProjectManagement={onBackToProjectManagement}
              onBackToResources={
                fromResources ? handleBackToResources : undefined
              }
              showCanvasToggle={!isThemeWorkbench}
              isCanvasOpen={layoutMode !== "chat"}
              onToggleCanvas={handleToggleCanvas}
              projectId={projectId ?? null}
              onProjectChange={handleProjectChange}
              workspaceType={activeTheme}
              onBackHome={handleBackHome}
              showBrowserAssistEntry={
                chatMode === "general" && !isThemeWorkbench
              }
              browserAssistActive={isBrowserAssistCanvasVisible}
              browserAssistLoading={browserAssistLaunching}
              browserAssistAttentionLevel={browserAssistAttentionLevel}
              browserAssistLabel={browserAssistEntryLabel}
              onOpenBrowserAssist={() => {
                void handleOpenBrowserAssistInCanvas();
              }}
              showHarnessToggle={showHarnessToggle}
              harnessPanelVisible={navbarHarnessPanelVisible}
              onToggleHarnessPanel={handleToggleHarnessPanel}
              harnessPendingCount={harnessPendingCount}
              harnessAttentionLevel={harnessAttentionLevel}
              harnessToggleLabel={
                chatMode === "general" && !isThemeWorkbench
                  ? "工作台"
                  : undefined
              }
              onToggleSettings={() => {
                _onNavigate?.("settings", {
                  tab: SettingsTabs.Appearance,
                });
              }}
              novelCanvasControls={
                showNovelNavbarControls
                  ? {
                      chapterListCollapsed: novelChapterListCollapsed,
                      onToggleChapterList: handleToggleNovelChapterList,
                      onAddChapter: handleAddNovelChapter,
                      onCloseCanvas: handleCloseCanvas,
                    }
                  : null
              }
            />

            {!isThemeWorkbench &&
              contentId &&
              syncStatus !== "idle" &&
              (() => {
                const notice = resolveContentSyncNotice(syncStatus);
                const NoticeIcon = notice.Icon;

                return (
                  <ContentSyncNotice $status={syncStatus}>
                    <NoticeIcon
                      className={
                        notice.animated
                          ? "h-3.5 w-3.5 animate-spin"
                          : "h-3.5 w-3.5"
                      }
                    />
                    <ContentSyncNoticeText>
                      {notice.label}
                    </ContentSyncNoticeText>
                  </ContentSyncNotice>
                );
              })()}
          </>
        )}

        <ThemeWorkbenchLayoutShell
          $bottomInset={themeWorkbenchLayoutBottomSpacing.shellBottomInset}
        >
          <LayoutTransitionRenderGate
            mode={isThemeWorkbench && canvasContent ? "canvas" : layoutMode}
            chatContent={chatContent}
            canvasContent={canvasContent}
            chatPanelWidth={layoutTransitionChatPanelWidth}
            chatPanelMinWidth={layoutTransitionChatPanelMinWidth}
          />
        </ThemeWorkbenchLayoutShell>
        {generalWorkbenchDialog}
        {themeWorkbenchHarnessDialog}
        {shouldShowThemeWorkbenchFloatingInputOverlay ? (
          <ThemeWorkbenchInputOverlay
            $hasPendingA2UIForm={Boolean(pendingA2UIForm)}
          >
            {inputbarNode}
          </ThemeWorkbenchInputOverlay>
        ) : null}
      </MainArea>
    ),
    [
      _onNavigate,
      activeTheme,
      canvasContent,
      chatContent,
      browserAssistAttentionLevel,
      browserAssistEntryLabel,
      browserAssistLaunching,
      contentId,
      fromResources,
      handleAddNovelChapter,
      handleBackHome,
      handleBackToResources,
      handleCloseCanvas,
      handleOpenBrowserAssistInCanvas,
      handleProjectChange,
      handleToggleHarnessPanel,
      handleToggleNovelChapterList,
      handleToggleCanvas,
      handleToggleSidebar,
      hideHistoryToggle,
      inputbarNode,
      isSending,
      isWorkspaceCompactChrome,
      isThemeWorkbench,
      chatMode,
      generalWorkbenchDialog,
      harnessAttentionLevel,
      isBrowserAssistCanvasVisible,
      navbarHarnessPanelVisible,
      harnessPendingCount,
      layoutTransitionChatPanelMinWidth,
      layoutTransitionChatPanelWidth,
      layoutMode,
      novelChapterListCollapsed,
      onBackToProjectManagement,
      pendingA2UIForm,
      projectId,
      shouldShowThemeWorkbenchFloatingInputOverlay,
      showChatPanel,
      showHarnessToggle,
      showNovelNavbarControls,
      shouldRenderTopBar,
      syncStatus,
      themeWorkbenchHarnessDialog,
      themeWorkbenchLayoutBottomSpacing.shellBottomInset,
      topBarChrome,
    ],
  );

  // ========== 渲染逻辑 ==========

  // 所有主题统一使用 useAgentChatUnified / useAsterAgentChat 的状态和渲染逻辑
  // General 主题与其他主题的区别仅在于不显示步骤进度条
  return (
    <PageContainer $compact={isWorkspaceCompactChrome}>
      {isThemeWorkbench ? (
        themeWorkbenchSidebarNode
      ) : showChatPanel && showSidebar ? (
        <ChatSidebar
          onNewChat={handleBackHome}
          topics={topics}
          currentTopicId={sessionId}
          onSwitchTopic={switchTopic}
          onResumeTask={handleResumeSidebarTask}
          onDeleteTopic={deleteTopic}
          onRenameTopic={renameTopic}
          currentMessages={displayMessages}
          isSending={isSending}
          pendingActionCount={pendingActions.length}
          queuedTurnCount={queuedTurns.length}
          workspaceError={Boolean(workspacePathMissing || workspaceHealthError)}
          childSubagentSessions={childSubagentSessions}
          subagentParentContext={subagentParentContext}
          onOpenSubagentSession={handleOpenSubagentSession}
          onReturnToParentSession={handleReturnToParentSession}
        />
      ) : null}
      {showThemeWorkbenchLeftExpandButton ? (
        <ThemeWorkbenchLeftExpandButton
          type="button"
          aria-label="展开上下文侧栏"
          onClick={() => setThemeWorkbenchSidebarCollapsed(false)}
          title="展开上下文侧栏"
        >
          <PanelLeftOpen size={14} />
        </ThemeWorkbenchLeftExpandButton>
      ) : null}

      {mainAreaNode}
    </PageContainer>
  );
}
