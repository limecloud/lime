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
} from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { useAgentChatUnified } from "./hooks";
import {
  resolveRecentTopicActionLabel,
  resolveRecentTopicCandidate,
  type TaskStatusReason,
} from "./hooks/agentChatShared";
import {
  settleLiveArtifactAfterStreamStops,
  useArtifactDisplayState,
} from "./hooks/useArtifactDisplayState";
import type { TopicBranchStatus } from "./hooks/useTopicBranchBoard";
import { useSessionFiles } from "./hooks/useSessionFiles";
import { useContentSync } from "./hooks/useContentSync";
import { useDeveloperFeatureFlags } from "@/hooks/useDeveloperFeatureFlags";
import { useGlobalMediaGenerationDefaults } from "@/hooks/useGlobalMediaGenerationDefaults";
import { useConfiguredProviders } from "@/hooks/useConfiguredProviders";
import { useServiceModelsConfig } from "@/hooks/useServiceModelsConfig";
import { useTrayModelShortcuts } from "./hooks/useTrayModelShortcuts";
import { type CanvasWorkbenchLayoutMode } from "./components/CanvasWorkbenchLayout";
import type { CreationMode } from "./components/types";
import { type TaskFile } from "./components/TaskFiles";
import { useWorkflow } from "@/lib/workspace/workbenchWorkflow";
import {
  createInitialCanvasState,
  createInitialVideoState,
  type CanvasStateUnion,
} from "@/lib/workspace/workbenchCanvas";
import { createInitialDocumentState } from "@/lib/workspace/workbenchCanvas";
import {
  type CanvasState as GeneralCanvasState,
  DEFAULT_CANVAS_STATE,
} from "@/components/general-chat/bridge";
import {
  artifactsAtom,
  selectedArtifactAtom,
  selectedArtifactIdAtom,
} from "@/lib/artifact/store";
import type { Artifact } from "@/lib/artifact/types";
import { useAtomValue, useSetAtom } from "jotai";
import { generateGeneralWorkbenchPrompt } from "@/lib/workspace/workbenchPrompt";
import { generateProjectMemoryPrompt } from "@/lib/workspace/workbenchPrompt";
import {
  getProject,
  getContent,
  getGeneralWorkbenchDocumentState,
  ensureWorkspaceReady,
  getOrCreateDefaultProject,
  type Project,
} from "@/lib/api/project";
import { executionRunGetGeneralWorkbenchState } from "@/lib/api/executionRun";
import {
  cancelMediaTaskArtifact,
  createImageGenerationTaskArtifact,
  getMediaTaskArtifact,
} from "@/lib/api/mediaTasks";
import {
  exportAgentRuntimeReviewDecisionTemplate,
  saveAgentRuntimeReviewDecision,
  updateAgentRuntimeSession,
  type AgentRuntimeReviewDecisionTemplate,
  type AgentRuntimeSaveReviewDecisionRequest,
} from "@/lib/api/agentRuntime";
import type { AgentRuntimeUpdateSessionRequest } from "@/lib/api/agentRuntime/types";
import {
  prepareSceneAppRunGovernanceArtifact,
  prepareSceneAppRunGovernanceArtifacts,
} from "@/lib/api/sceneapp";
import {
  getProjectMemory,
  type ProjectMemory,
  type Character,
} from "@/lib/api/memory";
import { logAgentDebug } from "@/lib/agentDebug";
import { recordAgentUiPerformanceMetric } from "@/lib/agentUiPerformanceMetrics";
import { setActiveContentTarget } from "@/lib/activeContentTarget";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import { mergeAgentUiPerformanceTraceMetadata } from "./hooks/agentStreamPerformanceMetrics";
import { startupTracker } from "@/lib/diagnostics/startupPerformance";
import { useImageGen } from "@/components/image-gen/useImageGen";
import { resolveMediaGenerationPreference } from "@/lib/mediaGeneration";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import {
  buildTeamMemoryShadowRequestMetadata,
  readTeamMemorySnapshot,
} from "@/lib/teamMemorySync";

import type {
  Message,
  MessageImage,
  MessagePathReference,
  MessagePreviewTarget,
  SiteSavedContentTarget,
  WriteArtifactContext,
} from "./types";
import {
  isSpecializedWorkbenchTheme,
  type LayoutMode,
  type ThemeType,
} from "@/lib/workspace/workbenchContract";
import {
  isDefaultProjectIdAlias,
  isLegacyDefaultProjectId,
  normalizeProjectId,
} from "./utils/topicProjectResolution";
import { isHiddenInternalArtifactPath } from "./utils/internalArtifactVisibility";
import { buildHarnessRequestMetadata } from "./utils/harnessRequestMetadata";
import { deriveHarnessSessionState } from "./utils/harnessState";
import { resolveWorkflowLayoutBottomSpacing } from "./utils/workflowLayout";
import {
  alignChatToolPreferencesWithExecutionStrategy,
  loadChatToolPreferences,
} from "./utils/chatToolPreferences";
import { mergeArtifacts } from "./utils/messageArtifacts";
import {
  createChatToolPreferencesFromExecutionRuntime,
  createSessionRecentPreferencesFromChatToolPreferences,
  createSessionRecentTeamSelectionFromTeamDefinition,
} from "./utils/sessionExecutionRuntime";
import { buildRealSubagentTimelineItems } from "./utils/subagentTimeline";
import {
  buildGeneralAgentSystemPrompt,
  resolveAgentChatMode,
} from "./utils/generalAgentPrompt";
import { shouldUseAgentFastResponseSelection } from "./utils/fastResponseModel";
import { loadPersisted, savePersisted } from "./hooks/agentChatStorage";
import { loadPersistedProjectId } from "./hooks/agentProjectStorage";
import { loadPersistedSessionWorkspaceId } from "./hooks/agentProjectStorage";
import { useSelectedTeamPreference } from "./hooks/useSelectedTeamPreference";
import { useTeamMemoryShadowSync } from "./hooks/useTeamMemoryShadowSync";
import { useThemeScopedChatToolPreferences } from "./hooks/useThemeScopedChatToolPreferences";
import { useLimeSkills } from "./hooks/useLimeSkills";
import { useServiceSkills } from "./service-skills/useServiceSkills";
import { useWorkspaceProjectSelection } from "./hooks/useWorkspaceProjectSelection";
import type { HandleSendOptions } from "./hooks/handleSendTypes";
import { useRuntimeTeamFormation } from "./hooks/useRuntimeTeamFormation";
import { mergeThreadItems } from "./utils/threadTimelineView";
import { openCanvasForReason } from "./workspace/canvasOpenPolicy";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  asRecord,
  GENERAL_BROWSER_ASSIST_ARTIFACT_ID,
  mergeMessageArtifactsIntoStore,
  readFirstString,
} from "./workspace/browserAssistArtifact";
import { SceneAppExecutionSummaryCard } from "./workspace/SceneAppExecutionSummaryCard";
import { ServiceSkillExecutionCard } from "./workspace/ServiceSkillExecutionCard";
import { useWorkspaceBrowserAssistRuntime } from "./workspace/useWorkspaceBrowserAssistRuntime";
import { useWorkspaceA2UISubmitActions } from "./workspace/useWorkspaceA2UISubmitActions";
import { useWorkspaceContextHarnessRuntime } from "./workspace/useWorkspaceContextHarnessRuntime";
import { useWorkspaceHarnessInventoryRuntime } from "./workspace/useWorkspaceHarnessInventoryRuntime";
import { useWorkspaceCanvasWorkflowActions } from "./workspace/useWorkspaceCanvasWorkflowActions";
import { useWorkspaceCanvasSceneRuntime } from "./workspace/useWorkspaceCanvasSceneRuntime";
import { useWorkspaceCanvasMessageSyncRuntime } from "./workspace/useWorkspaceCanvasMessageSyncRuntime";
import { useWorkspaceConversationSceneRuntime } from "./workspace/useWorkspaceConversationSceneRuntime";
import { useWorkspaceInputbarSceneRuntime } from "./workspace/useWorkspaceInputbarSceneRuntime";
import { useWorkspaceNavigationActions } from "./workspace/useWorkspaceNavigationActions";
import { useWorkspaceWriteFileAction } from "./workspace/useWorkspaceWriteFileAction";
import { useWorkspaceArtifactPreviewActions } from "./workspace/useWorkspaceArtifactPreviewActions";
import { useWorkspaceCanvasLayoutRuntime } from "./workspace/useWorkspaceCanvasLayoutRuntime";
import { useWorkspaceCanvasTaskFileSync } from "./workspace/useWorkspaceCanvasTaskFileSync";
import { useWorkspaceGeneralResourceSync } from "./workspace/useWorkspaceGeneralResourceSync";
import { useWorkspaceArtifactWorkbenchActions } from "./workspace/useWorkspaceArtifactWorkbenchActions";
import { useSceneAppExecutionSummaryRuntime } from "./workspace/useSceneAppExecutionSummaryRuntime";
import {
  buildSceneAppExecutionContentPostEntries,
  type SceneAppExecutionContentPostEntry,
} from "./workspace/sceneAppExecutionContentPosts";
import {
  useWorkspaceImageWorkbenchActionRuntime,
  type SubmitImageWorkbenchAgentCommandParams,
} from "./workspace/useWorkspaceImageWorkbenchActionRuntime";
import { useWorkspaceImageWorkbenchEventRuntime } from "./workspace/useWorkspaceImageWorkbenchEventRuntime";
import { buildImageSkillLaunchRequestMetadata } from "./workspace/imageSkillLaunch";
import { useWorkspaceImageTaskPreviewRuntime } from "./workspace/useWorkspaceImageTaskPreviewRuntime";
import { useWorkspaceAudioTaskPreviewRuntime } from "./workspace/useWorkspaceAudioTaskPreviewRuntime";
import { useWorkspaceTranscriptionTaskPreviewRuntime } from "./workspace/useWorkspaceTranscriptionTaskPreviewRuntime";
import { useWorkspaceVideoTaskPreviewRuntime } from "./workspace/useWorkspaceVideoTaskPreviewRuntime";
import { useWorkspaceVideoTaskActionRuntime } from "./workspace/useWorkspaceVideoTaskActionRuntime";
import { useWorkspaceSessionRestore } from "./workspace/useWorkspaceSessionRestore";
import { useWorkspaceResetRuntime } from "./workspace/useWorkspaceResetRuntime";
import { useWorkspaceSendActions } from "./workspace/useWorkspaceSendActions";
import {
  buildGeneralWorkbenchSendBoundaryState,
  buildGeneralWorkbenchResumePromptFromRunState,
  buildInitialDispatchKey,
  type GeneralWorkbenchEntryPromptState,
  type GeneralWorkbenchSendBoundaryState,
  type InitialDispatchPreviewSnapshot,
} from "./workspace/workspaceSendHelpers";
import { useWorkspaceTeamSessionControlRuntime } from "./workspace/useWorkspaceTeamSessionControlRuntime";
import { useWorkspaceGeneralWorkbenchScaffoldRuntime } from "./workspace/useWorkspaceGeneralWorkbenchScaffoldRuntime";
import { useWorkspaceTopicSwitch } from "./workspace/useWorkspaceTopicSwitch";
import { useWorkspaceA2UIRuntime } from "./workspace/useWorkspaceA2UIRuntime";
import { useWorkspaceSceneGateRuntime } from "./workspace/useWorkspaceSceneGateRuntime";
import { useWorkspaceGeneralWorkbenchSidebarRuntime } from "./workspace/useWorkspaceGeneralWorkbenchSidebarRuntime";
import { useWorkspaceGeneralWorkbenchRuntime } from "./workspace/useWorkspaceGeneralWorkbenchRuntime";
import { useWorkspaceTeamSessionRuntime } from "./workspace/useWorkspaceTeamSessionRuntime";
import { useWorkspaceGeneralWorkbenchDocumentPersistenceRuntime } from "./workspace/useWorkspaceGeneralWorkbenchDocumentPersistenceRuntime";
import { useWorkspaceServiceSkillEntryActions } from "./workspace/useWorkspaceServiceSkillEntryActions";
import { useWorkspaceSceneAppEntryActions } from "./workspace/useWorkspaceSceneAppEntryActions";
import { useWorkspaceArtifactViewModeControl } from "./workspace/useWorkspaceArtifactViewModeControl";
import {
  rememberInitialSessionNavigationStart,
  useWorkspaceInitialSessionNavigation,
} from "./workspace/useWorkspaceInitialSessionNavigation";
import { WorkspaceGeneralWorkbenchSidebar } from "./workspace/WorkspaceGeneralWorkbenchSidebar";
import { GeneralWorkbenchHarnessDialogSection } from "./workspace/WorkspaceHarnessDialogs";
import { WorkspaceShellScene } from "./workspace/WorkspaceShellScene";
import { FileManagerSidebar } from "./components/FileManager/FileManagerSidebar";
import {
  TaskCenterTabStrip,
  type TaskCenterTabItem,
} from "./components/TaskCenterTabStrip";
import {
  subscribeTaskCenterDraftTaskRequests,
  subscribeTaskCenterTaskPrefetchRequests,
  subscribeTaskCenterTaskOpenRequests,
} from "./taskCenterDraftTaskEvents";
import type { GeneralWorkbenchFollowUpActionPayload } from "./components/generalWorkbenchSidebarContract";
import { RuntimeReviewDecisionDialog } from "./components/RuntimeReviewDecisionDialog";
import {
  TEAM_PRIMARY_CHAT_PANEL_MIN_WIDTH,
  TEAM_PRIMARY_CHAT_PANEL_WIDTH,
} from "./workspace/WorkspaceStyles";
import { hasNamedGeneralCanvasFilePreview } from "./workspace/generalCanvasPreviewState";
import { resolvePreferredServiceSkillResultFileTarget } from "./workspace/serviceSkillResultFileTarget";
import {
  isAbsoluteWorkspacePath,
  resolveAbsoluteWorkspacePath,
} from "./workspace/workspacePath";
import { doesWorkspaceFileCandidateMatch } from "./workspace/workspaceFilePathMatch";
import {
  normalizeArtifactProtocolPath,
  resolveArtifactProtocolFilePath,
} from "@/lib/artifact-protocol";
import { resolveSiteSavedContentTargetFromRunResult } from "./utils/siteToolResultSummary";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { ArtifactTimelineOpenTarget } from "./utils/artifactTimelineNavigation";
import { createUnifiedMemory } from "@/lib/api/unifiedMemory";
import { getDefaultGuidePromptByTheme } from "./utils/defaultGuidePrompt";
import { shouldShowChatLayout } from "./utils/chatLayoutVisibility";
import { resolveInternalImageTaskDisplayName } from "./utils/internalImagePlaceholder";
import { mergePathReferences } from "./utils/pathReferences";
import {
  isTaskCenterTopicSwitchPending,
  MAX_TASK_CENTER_OPEN_TABS,
  normalizeTaskCenterWorkspaceTabMap,
  reconcileTaskCenterTabIds,
  replaceTaskCenterTabIdsForWorkspace,
  resolveTaskCenterFallbackTopicId,
  resolveTaskCenterPreviewTopicId,
  resolveTaskCenterTabIdsForWorkspace,
  resolveTaskCenterVisibleTabIds,
  shouldHideTaskCenterTabsForDetachedSession,
  shouldResumeTaskSession,
  TASK_CENTER_OPEN_TAB_IDS_STORAGE_KEY,
  type TaskCenterWorkspaceTabMap,
  updateTaskCenterTabIdsForWorkspace,
} from "./utils/taskCenterTabs";
import {
  createInitialSessionImageWorkbenchState,
  type SessionImageWorkbenchState,
} from "./workspace/imageWorkbenchHelpers";
import {
  buildSessionImageWorkbenchStateFromMessages,
  isSessionImageWorkbenchStateMeaningful,
  loadSessionImageWorkbenchCachedState,
  saveSessionImageWorkbenchCachedState,
} from "./workspace/imageWorkbenchStateCache";
import {
  SOCIAL_ARTICLE_SKILL_KEY,
  GENERAL_WORKBENCH_HISTORY_PAGE_SIZE,
  applyBackendGeneralWorkbenchDocumentState,
  isCanvasStateEmpty,
  isCorruptedGeneralWorkbenchDocumentContent,
  isSyncContentEmpty,
  readPersistedGeneralWorkbenchDocument,
  serializeCanvasStateForSync,
} from "./workspace/generalWorkbenchHelpers";
import {
  normalizeInitialTheme,
  projectTypeToTheme,
} from "./agentChatWorkspaceShared";
import type { AgentChatWorkspaceProps } from "./agentChatWorkspaceContract";
import type { AgentInitialInputCapabilityParams } from "@/types/page";
import { extractCreationReplayMetadata } from "./utils/creationReplayMetadata";
import { buildCreationReplaySurfaceModel } from "./utils/creationReplaySurface";
import {
  extractCuratedTaskReferenceMemoryIds,
  mergeCuratedTaskReferenceEntries,
  normalizeCuratedTaskReferenceMemoryIds,
} from "./utils/curatedTaskReferenceSelection";
import {
  buildRuntimeInitialInputCapabilityFromFollowUpAction,
  resolveEffectiveInitialInputCapability,
} from "./utils/inputCapabilityBootstrap";
import { buildMessageInspirationDraft } from "./utils/messageInspirationDraft";
import {
  listCuratedTaskRecommendationSignals,
  recordCuratedTaskRecommendationSignalFromMemory,
  recordCuratedTaskRecommendationSignalFromReviewDecision,
  subscribeCuratedTaskRecommendationSignalsChanged,
} from "./utils/curatedTaskRecommendationSignals";
import {
  buildSceneAppExecutionCuratedTaskFollowUpAction,
  buildCuratedTaskReferenceEntryFromSceneAppExecution,
  buildSceneAppExecutionReviewFollowUpAction,
} from "./utils/sceneAppCuratedTaskReference";
import {
  buildSceneAppExecutionInspirationLibraryPageParams,
  hasSavedSceneAppExecutionAsInspiration,
  saveSceneAppExecutionAsInspiration,
} from "./utils/saveSceneAppExecutionAsInspiration";
import { buildSceneAppExecutionPromptActionPayload } from "./utils/sceneAppExecutionPromptContinuation";
import { buildSkillsPageParamsFromSceneAppExecution } from "./utils/sceneAppSkillScaffoldDraft";
import { buildSkillsPageParamsFromMessage } from "./utils/skillScaffoldDraft";
import { AutomationJobDialog } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import { shouldAutoSelectGeneralArtifact } from "./workspace/generalArtifactAutoSelection";
import {
  buildSceneAppExecutionSummaryRunDetailViewModel,
  type SceneAppExecutionPromptAction,
  buildSceneAppQuickReviewDecisionRequest,
  formatSceneAppErrorMessage,
  hasSceneAppRecentVisit,
  resolveSceneAppRunEntryNavigationTarget,
  resolveSceneAppRuntimeArtifactOpenTarget,
  resolveSceneAppsPageEntryParams,
  SCENEAPP_QUICK_REVIEW_ACTIONS,
  subscribeSceneAppRecentVisits,
} from "@/lib/sceneapp";

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";
const BLANK_HOME_DEFERRED_LOAD_MS = 18_000;
const RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS = 0;
const SESSION_ENTRY_RUNTIME_WARMUP_DEFERRED_LOAD_MS = 45_000;
const SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS = 45_000;
const SESSION_RECENT_METADATA_BACKGROUND_SYNC_DELAY_MS = 12_000;
const SESSION_RECENT_METADATA_NAVIGATION_DEFER_MS = 45_000;
const SESSION_RECENT_METADATA_BACKGROUND_SYNC_IDLE_TIMEOUT_MS = 20_000;
const BROWSER_WORKSPACE_HOME_HINT_STORAGE_KEY =
  "lime.agent.browser-workspace-home-hint-shown";
const FILE_MANAGER_SIDEBAR_OPEN_STORAGE_KEY = "lime.file-manager.sidebar-open";
const FILE_MANAGER_NAV_COLLAPSE_BREAKPOINT_PX = 1180;
const APP_SIDEBAR_COLLAPSE_EVENT = "lime:app-sidebar-collapse";
const BROWSER_WORKSPACE_HOME_HINT_MESSAGE = "在这里切换或新建工作区";
const BROWSER_WORKSPACE_HOME_HINT_AUTO_HIDE_MS = 5_500;
const TASK_CENTER_DRAFT_TAB_PREFIX = "task-draft";
const TASK_CENTER_DRAFT_SESSION_WARMUP_DELAY_MS = 120;
const NOOP_SET_CHAT_MESSAGES: Dispatch<SetStateAction<Message[]>> = () =>
  undefined;

function loadFileManagerSidebarOpen(): boolean {
  return false;
}

function saveFileManagerSidebarOpen(open: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  if (open) {
    window.localStorage.removeItem(FILE_MANAGER_SIDEBAR_OPEN_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(FILE_MANAGER_SIDEBAR_OPEN_STORAGE_KEY, "false");
}

interface TaskCenterDraftTab {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: TaskCenterTabItem["status"];
}

interface TaskCenterDraftSendRequest {
  id: string;
  draftTabId: string;
  text: string;
  images: MessageImage[];
  sendExecutionStrategy?: "react" | "code_orchestrated" | "auto";
  sendOptions?: HandleSendOptions;
  webSearch: boolean;
  thinking: boolean;
  submittedAt: number;
  materializeDraft: boolean;
  source: "task-center-empty-state" | "empty-state";
}

type SessionRecentMetadataSyncPriority = "immediate" | "background";

interface SessionRecentMetadataSyncOptions {
  priority?: SessionRecentMetadataSyncPriority;
}

type SessionRecentMetadataPatch = Pick<
  AgentRuntimeUpdateSessionRequest,
  "recent_preferences" | "recent_team_selection"
>;

interface PendingSessionRecentMetadataSync {
  patch: SessionRecentMetadataPatch;
  priority: SessionRecentMetadataSyncPriority;
  cancel: (() => void) | null;
  resolvers: Array<() => void>;
  rejecters: Array<(error: unknown) => void>;
}

function createTaskCenterDraftTabId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${TASK_CENTER_DRAFT_TAB_PREFIX}-${Date.now().toString(36)}-${random}`;
}

function isTaskCenterDraftTabId(value: string): boolean {
  return value.startsWith(`${TASK_CENTER_DRAFT_TAB_PREFIX}-`);
}

function createTaskCenterDraftSendRequestId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `draft-send-${Date.now().toString(36)}-${random}`;
}

function resolveTaskCenterDraftSendTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "新对话";
  }

  const preview = Array.from(normalized).slice(0, 18).join("");
  return normalized.length > preview.length ? `${preview}...` : preview;
}

function scheduleAfterNextPaint(callback: () => void): () => void {
  if (typeof window === "undefined") {
    callback();
    return () => undefined;
  }

  if (typeof window.requestAnimationFrame !== "function") {
    const timeoutId = window.setTimeout(callback, 0);
    return () => window.clearTimeout(timeoutId);
  }

  let secondFrameId: number | null = null;
  const firstFrameId = window.requestAnimationFrame(() => {
    secondFrameId = window.requestAnimationFrame(callback);
  });

  return () => {
    window.cancelAnimationFrame(firstFrameId);
    if (secondFrameId !== null) {
      window.cancelAnimationFrame(secondFrameId);
    }
  };
}

function buildHomePendingPreviewMessages(
  request: TaskCenterDraftSendRequest,
  executionStrategy: "react" | "code_orchestrated" | "auto",
): Message[] {
  const timestamp = new Date(request.submittedAt);
  const effectiveExecutionStrategy =
    request.sendExecutionStrategy || executionStrategy;

  return [
    {
      id: `${request.id}:user`,
      role: "user",
      content: request.text,
      images: request.images.length > 0 ? request.images : undefined,
      timestamp,
    },
    {
      id: `${request.id}:assistant`,
      role: "assistant",
      content: "",
      timestamp,
      isThinking: true,
      runtimeStatus: {
        phase: "preparing",
        title: "正在进入对话",
        detail: "已收到输入，正在后台准备会话和执行环境。",
        checkpoints: [
          effectiveExecutionStrategy === "code_orchestrated"
            ? "代码编排待命"
            : effectiveExecutionStrategy === "react"
              ? "对话执行待命"
              : "自动路由待命",
          request.webSearch ? "联网搜索候选能力待命" : "直接回答优先",
          request.thinking ? "深度思考待命" : "轻量响应优先",
        ],
      },
    },
  ];
}

function mergeSessionRecentMetadataSyncPriority(
  current: SessionRecentMetadataSyncPriority,
  next?: SessionRecentMetadataSyncPriority,
): SessionRecentMetadataSyncPriority {
  if (current === "immediate" || next !== "background") {
    return "immediate";
  }

  return "background";
}

function resolveDefaultSelectedArtifact(
  activeTheme: string,
  artifacts: Artifact[],
): Artifact | null {
  if (artifacts.length === 0) {
    return null;
  }

  if (activeTheme !== "general") {
    return artifacts[artifacts.length - 1] ?? null;
  }

  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    const candidate = artifacts[index];
    if (
      candidate.type !== "browser_assist" &&
      shouldAutoSelectGeneralArtifact(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

function resolveVideoCanvasStatusFromPreview(
  target: Extract<MessagePreviewTarget, { kind: "task" }>,
): "idle" | "generating" | "success" | "error" {
  const preview = target.preview;
  if (preview.kind !== "video_generate") {
    return "idle";
  }
  if (
    (preview.status === "complete" || preview.status === "partial") &&
    preview.videoUrl
  ) {
    return "success";
  }
  if (preview.status === "failed" || preview.status === "cancelled") {
    return "error";
  }
  return "generating";
}

function resolveTaskPreviewArtifact(
  message: Message,
  target: Extract<MessagePreviewTarget, { kind: "task" }>,
): Artifact | null {
  const normalizedArtifactPath = normalizeArtifactProtocolPath(
    target.preview.kind === "video_generate"
      ? null
      : target.preview.artifactPath || null,
  );
  const messageArtifacts = message.artifacts || [];
  if (normalizedArtifactPath) {
    const matchedArtifact = messageArtifacts.find(
      (artifact) =>
        !isHiddenInternalArtifactPath(
          resolveArtifactProtocolFilePath(artifact),
        ) &&
        doesWorkspaceFileCandidateMatch(
          resolveArtifactProtocolFilePath(artifact),
          normalizedArtifactPath,
        ),
    );
    if (matchedArtifact) {
      return matchedArtifact;
    }
  }

  const visibleArtifacts = messageArtifacts.filter(
    (artifact) =>
      !isHiddenInternalArtifactPath(resolveArtifactProtocolFilePath(artifact)),
  );
  return visibleArtifacts.length > 0
    ? (visibleArtifacts[visibleArtifacts.length - 1] ?? null)
    : null;
}

function normalizeVideoAspectRatio(
  value?: string,
): "adaptive" | "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9" {
  switch (value) {
    case "16:9":
    case "9:16":
    case "1:1":
    case "4:3":
    case "3:4":
    case "21:9":
      return value;
    default:
      return "adaptive";
  }
}

function normalizeVideoResolution(value?: string): "480p" | "720p" | "1080p" {
  switch (value) {
    case "480p":
    case "1080p":
      return value;
    case "720p":
    default:
      return "720p";
  }
}

function isUsableKnowledgeSourceText(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 24) {
    return false;
  }

  return !/请先.*(提供|补充).*(资料|素材|原文)|还没有.*(资料|素材|原文)|不能编造|无法.*沉淀/.test(
    normalized,
  );
}

export type {
  AgentChatWorkspaceProps,
  WorkflowProgressSnapshot,
} from "./agentChatWorkspaceContract";

export function AgentChatWorkspace({
  onNavigate: _onNavigate,
  projectId: externalProjectId,
  contentId,
  initialSessionId,
  initialSceneAppExecutionSummary,
  initialRequestMetadata,
  initialAutoSendRequestMetadata,
  autoRunInitialPromptOnMount = false,
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
  initialSessionName: _initialSessionName,
  entryBannerMessage,
  initialPendingServiceSkillLaunch,
  initialInputCapability,
  initialKnowledgePackSelection,
  initialProjectFileOpenTarget,
  onInitialUserPromptConsumed,
  newChatAt,
  onRecommendationClick: _onRecommendationClick,
  onHasMessagesChange,
  onSessionChange,
  preferContentReviewInRightRail = false,
  openBrowserAssistOnMount = false,
  initialSiteSkillLaunch,
}: AgentChatWorkspaceProps) {
  // 性能埋点：记录组件渲染开始时间
  const workspaceRenderT0 = useRef<number>(performance.now());
  useEffect(() => {
    console.info(
      `[PERF] AgentChatWorkspace mounted: ${(performance.now() - workspaceRenderT0.current).toFixed(0)}ms`,
    );
  }, []);

  const normalizedEntryTheme = normalizeInitialTheme(initialTheme);
  const shouldAutoCollapseClassicClawSidebar = agentEntry === "claw";
  const defaultTopicSidebarVisible =
    showChatPanel && !shouldAutoCollapseClassicClawSidebar;
  const [showSidebar, setShowSidebar] = useState(
    () => defaultTopicSidebarVisible,
  );
  const [input, setInput] = useState("");
  const [pathReferences, setPathReferences] = useState<MessagePathReference[]>(
    [],
  );
  const [fileManagerSidebarOpen, setFileManagerSidebarOpen] = useState(() =>
    loadFileManagerSidebarOpen(),
  );
  const fileManagerAppSidebarCollapsedRef = useRef(false);
  const handleSetFileManagerSidebarOpen = useCallback((open: boolean) => {
    setFileManagerSidebarOpen(open);
    saveFileManagerSidebarOpen(open);
  }, []);
  const handleAddPathReferences = useCallback(
    (references: MessagePathReference[]) => {
      setPathReferences((current) => mergePathReferences(current, references));
    },
    [],
  );
  const handleRemovePathReference = useCallback((id: string) => {
    setPathReferences((current) =>
      current.filter((reference) => reference.id !== id),
    );
  }, []);
  const handleClearPathReferences = useCallback(() => {
    setPathReferences([]);
  }, []);
  const [runtimeInitialInputCapability, setRuntimeInitialInputCapability] =
    useState<AgentInitialInputCapabilityParams>();
  const [runtimeEntryBannerMessage, setRuntimeEntryBannerMessage] = useState<
    string | null
  >(null);
  const [selectedText, setSelectedText] = useState("");
  const effectiveEntryBannerMessage =
    runtimeEntryBannerMessage?.trim() || entryBannerMessage;
  const [entryBannerVisible, setEntryBannerVisible] = useState(
    Boolean(effectiveEntryBannerMessage),
  );
  const [browserWorkspaceHintVisible, setBrowserWorkspaceHintVisible] =
    useState(false);
  const shouldBootstrapCanvasOnEntry =
    Boolean(contentId) && isSpecializedWorkbenchTheme(normalizedEntryTheme);

  // 内容创作相关状态
  const [activeTheme, setActiveTheme] = useState<string>(normalizedEntryTheme);
  const [creationMode, setCreationMode] = useState<CreationMode>(
    initialCreationMode ?? "guided",
  );
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionRecentMetadataNavigationDeferUntilRef = useRef(0);
  const pendingSessionRecentMetadataSyncRef = useRef<
    Map<string, PendingSessionRecentMetadataSync>
  >(new Map());
  const sessionRecentPreferencesBackfillKeyRef = useRef<string | null>(null);
  const deferSessionRecentMetadataSyncForNavigation = useCallback(
    (topicId: string) => {
      const deferUntil =
        Date.now() + SESSION_RECENT_METADATA_NAVIGATION_DEFER_MS;
      sessionRecentMetadataNavigationDeferUntilRef.current = Math.max(
        sessionRecentMetadataNavigationDeferUntilRef.current,
        deferUntil,
      );
      logAgentDebug("AgentChatPage", "sessionRecentMetadataSync.defer", {
        deferMs: SESSION_RECENT_METADATA_NAVIGATION_DEFER_MS,
        topicId,
      });
    },
    [],
  );
  const flushSessionRecentMetadataSync = useCallback(
    function runSessionRecentMetadataSyncFlush(sessionId: string) {
      const pending =
        pendingSessionRecentMetadataSyncRef.current.get(sessionId);
      if (!pending) {
        return;
      }

      pending.cancel?.();
      pending.cancel = null;

      if (pending.priority === "background") {
        const remainingNavigationDeferMs =
          sessionRecentMetadataNavigationDeferUntilRef.current - Date.now();
        if (remainingNavigationDeferMs > 0) {
          pending.cancel = scheduleMinimumDelayIdleTask(
            () => {
              pending.cancel = null;
              runSessionRecentMetadataSyncFlush(sessionId);
            },
            {
              minimumDelayMs: remainingNavigationDeferMs,
              idleTimeoutMs:
                SESSION_RECENT_METADATA_BACKGROUND_SYNC_IDLE_TIMEOUT_MS,
            },
          );
          logAgentDebug(
            "AgentChatPage",
            "sessionRecentMetadataSync.deferredForNavigation",
            {
              deferMs: remainingNavigationDeferMs,
              sessionId,
            },
            {
              dedupeKey: `sessionRecentMetadataSync.deferredForNavigation:${sessionId}`,
              throttleMs: 1000,
            },
          );
          return;
        }
      }

      pendingSessionRecentMetadataSyncRef.current.delete(sessionId);

      if (
        pending.priority === "background" &&
        activeSessionIdRef.current !== sessionId
      ) {
        pending.resolvers.forEach((resolve) => resolve());
        return;
      }

      void updateAgentRuntimeSession({
        session_id: sessionId,
        ...pending.patch,
      })
        .then(() => {
          pending.resolvers.forEach((resolve) => resolve());
        })
        .catch((error) => {
          pending.rejecters.forEach((reject) => reject(error));
        });
    },
    [],
  );
  const scheduleSessionRecentMetadataSync = useCallback(
    (sessionId: string, priority: SessionRecentMetadataSyncPriority) => {
      const pending =
        pendingSessionRecentMetadataSyncRef.current.get(sessionId);
      if (!pending) {
        return;
      }

      pending.cancel?.();
      pending.cancel =
        priority === "background"
          ? scheduleMinimumDelayIdleTask(
              () => {
                pending.cancel = null;
                flushSessionRecentMetadataSync(sessionId);
              },
              {
                minimumDelayMs:
                  SESSION_RECENT_METADATA_BACKGROUND_SYNC_DELAY_MS,
                idleTimeoutMs:
                  SESSION_RECENT_METADATA_BACKGROUND_SYNC_IDLE_TIMEOUT_MS,
              },
            )
          : scheduleMinimumDelayIdleTask(
              () => {
                pending.cancel = null;
                flushSessionRecentMetadataSync(sessionId);
              },
              {
                minimumDelayMs: 0,
                idleTimeoutMs: 500,
              },
            );
    },
    [flushSessionRecentMetadataSync],
  );
  const enqueueSessionRecentMetadataSync = useCallback(
    (
      sessionId: string,
      patch: SessionRecentMetadataPatch,
      options?: SessionRecentMetadataSyncOptions,
    ): Promise<void> => {
      const trimmedSessionId = sessionId.trim();
      if (!trimmedSessionId) {
        return Promise.resolve();
      }

      const requestedPriority = options?.priority ?? "immediate";

      return new Promise<void>((resolve, reject) => {
        const pending =
          pendingSessionRecentMetadataSyncRef.current.get(trimmedSessionId);
        if (pending) {
          const previousPriority = pending.priority;
          pending.patch = {
            ...pending.patch,
            ...patch,
          };
          pending.priority = mergeSessionRecentMetadataSyncPriority(
            pending.priority,
            requestedPriority,
          );
          pending.resolvers.push(resolve);
          pending.rejecters.push(reject);
          if (
            previousPriority === "background" &&
            pending.priority === "immediate"
          ) {
            scheduleSessionRecentMetadataSync(trimmedSessionId, "immediate");
          }
          return;
        }

        pendingSessionRecentMetadataSyncRef.current.set(trimmedSessionId, {
          patch,
          priority: requestedPriority,
          cancel: null,
          resolvers: [resolve],
          rejecters: [reject],
        });
        scheduleSessionRecentMetadataSync(trimmedSessionId, requestedPriority);
      });
    },
    [scheduleSessionRecentMetadataSync],
  );
  useEffect(() => {
    const pendingSyncMap = pendingSessionRecentMetadataSyncRef.current;
    return () => {
      const pendingSyncs = pendingSyncMap.values();
      for (const pending of pendingSyncs) {
        pending.cancel?.();
        pending.resolvers.forEach((resolve) => resolve());
      }
      pendingSyncMap.clear();
    };
  }, []);
  const syncSessionRecentPreferences = useCallback(
    async (
      sessionId: string,
      preferences: Parameters<
        typeof createSessionRecentPreferencesFromChatToolPreferences
      >[0],
      options?: SessionRecentMetadataSyncOptions,
    ) => {
      await enqueueSessionRecentMetadataSync(
        sessionId,
        {
          recent_preferences:
            createSessionRecentPreferencesFromChatToolPreferences(preferences),
        },
        options,
      );
    },
    [enqueueSessionRecentMetadataSync],
  );
  const syncSessionRecentTeamSelection = useCallback(
    async (
      sessionId: string,
      team: Parameters<
        typeof createSessionRecentTeamSelectionFromTeamDefinition
      >[0],
      theme?: string | null,
      options?: SessionRecentMetadataSyncOptions,
    ) => {
      await enqueueSessionRecentMetadataSync(
        sessionId,
        {
          recent_team_selection:
            createSessionRecentTeamSelectionFromTeamDefinition(team, theme),
        },
        options,
      );
    },
    [enqueueSessionRecentMetadataSync],
  );
  const chatToolPreferenceSessionSync = useMemo(
    () => ({
      getSessionId: () => activeSessionIdRef.current,
      setSessionRecentPreferences: syncSessionRecentPreferences,
    }),
    [syncSessionRecentPreferences],
  );
  const {
    chatToolPreferences,
    setChatToolPreferences,
    syncChatToolPreferencesSource,
    getSyncedSessionRecentPreferences,
  } = useThemeScopedChatToolPreferences(activeTheme, {
    sessionSync: chatToolPreferenceSessionSync,
  });
  const {
    projectId,
    shouldDisableSessionRestore,
    hasHandledNewChatRequest,
    markNewChatRequestHandled,
    rememberProjectId,
    getRememberedProjectId,
    applyProjectSelection,
    clearProjectSelectionRuntime,
    startTopicProjectResolution,
    finishTopicProjectResolution,
    deferTopicSwitch,
    consumePendingTopicSwitch,
  } = useWorkspaceProjectSelection({
    externalProjectId,
    initialSessionId,
    newChatAt,
  });
  const taskCenterWorkspaceId = normalizeProjectId(projectId);
  const normalizedInitialSessionId =
    typeof initialSessionId === "string" && initialSessionId.trim().length > 0
      ? initialSessionId.trim()
      : null;
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    shouldBootstrapCanvasOnEntry ? "canvas" : "chat",
  );
  const shouldPreserveEntryThemeOnHome =
    agentEntry === "new-task" && !contentId;
  const shouldPreserveBlankHomeSurface =
    shouldPreserveEntryThemeOnHome && normalizedEntryTheme === "general";
  const shouldUseBrowserWorkspaceHomeChrome = shouldPreserveBlankHomeSurface;
  const shouldPrioritizeInitialSessionEntry =
    normalizedInitialSessionId !== null && !contentId;
  const shouldPrioritizeInitialPromptEntry =
    agentEntry === "claw" &&
    !contentId &&
    normalizedEntryTheme === "general" &&
    Boolean(initialUserPrompt?.trim()) &&
    !initialUserImages?.length &&
    !initialSiteSkillLaunch &&
    !initialPendingServiceSkillLaunch?.skillId?.trim() &&
    !initialPendingServiceSkillLaunch?.skillKey?.trim() &&
    !initialInputCapability?.capabilityRoute &&
    !initialProjectFileOpenTarget?.relativePath?.trim();
  const shouldDeferWorkspaceAuxiliaryLoads =
    shouldPreserveBlankHomeSurface ||
    shouldPrioritizeInitialSessionEntry ||
    shouldPrioritizeInitialPromptEntry;
  const shouldDeferInitialTopicsLoad =
    shouldPreserveBlankHomeSurface ||
    shouldPrioritizeInitialSessionEntry ||
    shouldPrioritizeInitialPromptEntry;
  const shouldDeferInitialRuntimeWarmup = shouldDeferInitialTopicsLoad;
  const deferredWorkspaceAuxiliaryLoadMs = shouldPreserveBlankHomeSurface
    ? BLANK_HOME_DEFERRED_LOAD_MS
    : shouldPrioritizeInitialSessionEntry || shouldPrioritizeInitialPromptEntry
      ? SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS
      : undefined;
  const deferredInitialTopicsLoadMs = shouldPreserveBlankHomeSurface
    ? RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS
    : shouldPrioritizeInitialSessionEntry || shouldPrioritizeInitialPromptEntry
      ? RECENT_CONVERSATIONS_IDLE_DEFERRED_LOAD_MS
      : undefined;
  const deferredInitialRuntimeWarmupMs = shouldPreserveBlankHomeSurface
    ? BLANK_HOME_DEFERRED_LOAD_MS
    : shouldPrioritizeInitialSessionEntry || shouldPrioritizeInitialPromptEntry
      ? SESSION_ENTRY_RUNTIME_WARMUP_DEFERRED_LOAD_MS
      : undefined;
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
    if (entryBannerMessage) {
      setRuntimeEntryBannerMessage(null);
    }
  }, [entryBannerMessage]);

  useEffect(() => {
    setEntryBannerVisible(Boolean(effectiveEntryBannerMessage));
  }, [effectiveEntryBannerMessage]);

  useEffect(() => {
    if (
      !shouldUseBrowserWorkspaceHomeChrome ||
      !projectId ||
      entryBannerMessage
    ) {
      return;
    }

    try {
      if (
        window.localStorage.getItem(BROWSER_WORKSPACE_HOME_HINT_STORAGE_KEY) ===
        "true"
      ) {
        return;
      }

      window.localStorage.setItem(
        BROWSER_WORKSPACE_HOME_HINT_STORAGE_KEY,
        "true",
      );
    } catch {
      // 本地存储不可用时仍展示一次提示，避免首开闭环静默失败。
    }

    setBrowserWorkspaceHintVisible(true);
  }, [entryBannerMessage, projectId, shouldUseBrowserWorkspaceHomeChrome]);

  useEffect(() => {
    if (!browserWorkspaceHintVisible) {
      return;
    }

    const timer = window.setTimeout(() => {
      setBrowserWorkspaceHintVisible(false);
    }, BROWSER_WORKSPACE_HOME_HINT_AUTO_HIDE_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [browserWorkspaceHintVisible]);

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

  useEffect(() => {
    const shouldResolveLegacyDefaultProject =
      isDefaultProjectIdAlias(externalProjectId) ||
      isLegacyDefaultProjectId(externalProjectId);
    if (!shouldResolveLegacyDefaultProject || projectId) {
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    const perfT0 = performance.now();
    logAgentDebug("AgentChatPage", "resolveDefaultProjectAlias.start", {
      externalProjectId: externalProjectId ?? null,
    });

    void (async () => {
      try {
        const rememberedProjectId = getRememberedProjectId();
        if (rememberedProjectId) {
          const rememberedProject = await getProject(rememberedProjectId);
          if (rememberedProject && !rememberedProject.isArchived) {
            let resolvedRootPath = rememberedProject.rootPath;

            try {
              const ensuredWorkspace = await ensureWorkspaceReady(
                rememberedProject.id,
              );
              resolvedRootPath = ensuredWorkspace.rootPath || resolvedRootPath;
            } catch (error) {
              logAgentDebug(
                "AgentChatPage",
                "resolveDefaultProjectAlias.ensureRememberedWorkspaceReadyError",
                {
                  error,
                  projectId: rememberedProject.id,
                },
                { level: "warn" },
              );
            }

            if (cancelled) {
              return;
            }

            applyProjectSelection(rememberedProject.id);
            setProject((current) =>
              current?.id === rememberedProject.id &&
              current.rootPath === resolvedRootPath
                ? current
                : {
                    ...rememberedProject,
                    rootPath: resolvedRootPath,
                  },
            );
            logAgentDebug(
              "AgentChatPage",
              "resolveDefaultProjectAlias.fromRememberedProject",
              {
                durationMs: Date.now() - startedAt,
                projectId: rememberedProject.id,
                rootPath: resolvedRootPath,
              },
            );
            return;
          }
        }

        const defaultProject = await getOrCreateDefaultProject();
        let resolvedRootPath = defaultProject.rootPath;

        try {
          const ensuredWorkspace = await ensureWorkspaceReady(
            defaultProject.id,
          );
          resolvedRootPath = ensuredWorkspace.rootPath || resolvedRootPath;
        } catch (error) {
          logAgentDebug(
            "AgentChatPage",
            "resolveDefaultProjectAlias.ensureWorkspaceReadyError",
            {
              error,
              projectId: defaultProject.id,
            },
            { level: "warn" },
          );
        }

        if (cancelled) {
          return;
        }

        applyProjectSelection(defaultProject.id);
        setProject((current) =>
          current?.id === defaultProject.id &&
          current.rootPath === resolvedRootPath
            ? current
            : {
                ...defaultProject,
                rootPath: resolvedRootPath,
              },
        );
        logAgentDebug("AgentChatPage", "resolveDefaultProjectAlias.success", {
          durationMs: Date.now() - startedAt,
          projectId: defaultProject.id,
          rootPath: resolvedRootPath,
        });
        console.info(
          `[PERF] resolveDefaultProjectAlias: ${(performance.now() - perfT0).toFixed(0)}ms`,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.warn("[AgentChatPage] 默认工作区别名解析失败:", error);
        logAgentDebug(
          "AgentChatPage",
          "resolveDefaultProjectAlias.error",
          {
            durationMs: Date.now() - startedAt,
            error,
            externalProjectId: externalProjectId ?? null,
          },
          { level: "warn" },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    applyProjectSelection,
    externalProjectId,
    getRememberedProjectId,
    projectId,
  ]);

  useEffect(() => {
    if (
      !shouldUseBrowserWorkspaceHomeChrome ||
      projectId ||
      externalProjectId
    ) {
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();

    startupTracker.mark(
      "AgentChatWorkspace: homeDefaultWorkspace resolve start",
    );
    logAgentDebug("AgentChatPage", "homeDefaultWorkspace.resolve.start", {
      agentEntry,
    });

    void (async () => {
      try {
        startupTracker.mark(
          "AgentChatWorkspace: calling getOrCreateDefaultProject",
        );
        const defaultProject = await getOrCreateDefaultProject();
        startupTracker.mark(
          "AgentChatWorkspace: getOrCreateDefaultProject returned",
        );

        if (cancelled) {
          return;
        }

        if (!defaultProject?.id) {
          startupTracker.mark("AgentChatWorkspace: no default project");
          logAgentDebug(
            "AgentChatPage",
            "homeDefaultWorkspace.resolve.empty",
            {
              durationMs: Date.now() - startedAt,
            },
            { level: "warn" },
          );
          return;
        }

        applyProjectSelection(defaultProject.id);
        setProject(defaultProject);
        startupTracker.mark(
          `AgentChatWorkspace: homeDefaultWorkspace resolved (${Date.now() - startedAt}ms)`,
        );
        logAgentDebug("AgentChatPage", "homeDefaultWorkspace.resolve.success", {
          durationMs: Date.now() - startedAt,
          projectId: defaultProject.id,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        startupTracker.mark(
          `AgentChatWorkspace: homeDefaultWorkspace error (${Date.now() - startedAt}ms)`,
        );
        console.warn("[AgentChatPage] 准备默认工作区失败:", error);
        logAgentDebug(
          "AgentChatPage",
          "homeDefaultWorkspace.resolve.error",
          {
            durationMs: Date.now() - startedAt,
            error,
          },
          { level: "warn" },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    agentEntry,
    applyProjectSelection,
    externalProjectId,
    projectId,
    shouldUseBrowserWorkspaceHomeChrome,
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
  const handledInitialPendingServiceSkillLaunchSignatureRef = useRef("");
  const handledInitialProjectFileOpenSignatureRef = useRef("");
  const initialCreationReplay = useMemo(
    () => extractCreationReplayMetadata(initialRequestMetadata),
    [initialRequestMetadata],
  );
  const initialCreationReplaySurface = useMemo(
    () => buildCreationReplaySurfaceModel(initialCreationReplay),
    [initialCreationReplay],
  );

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
  const [imageWorkbenchBySessionId, setImageWorkbenchBySessionId] = useState<
    Record<string, SessionImageWorkbenchState>
  >({});

  // 任务文件状态
  const [taskFiles, setTaskFiles] = useState<TaskFile[]>([]);
  const [taskFilesExpanded, setTaskFilesExpanded] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const taskFilesRef = useRef<TaskFile[]>([]);
  const socialStageLogRef = useRef<Record<string, string>>({});

  // 项目上下文状态
  const [project, setProject] = useState<Project | null>(null);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(
    null,
  );
  const { workspaceHarnessEnabled } = useDeveloperFeatureFlags();
  const { mediaDefaults } = useGlobalMediaGenerationDefaults();
  const { serviceModels } = useServiceModelsConfig();
  const inputCompletionEnabled =
    serviceModels.input_completion?.enabled !== false;
  const effectiveImageWorkbenchPreference = useMemo(
    () =>
      resolveMediaGenerationPreference(
        project?.settings?.imageGeneration,
        mediaDefaults.image,
      ),
    [mediaDefaults.image, project?.settings?.imageGeneration],
  );

  const imageWorkbenchGenerationRuntime = useImageGen({
    preferredProviderId: effectiveImageWorkbenchPreference.preferredProviderId,
    preferredModelId: effectiveImageWorkbenchPreference.preferredModelId,
    allowFallback: effectiveImageWorkbenchPreference.allowFallback,
    providerLoadMode: shouldDeferWorkspaceAuxiliaryLoads
      ? "deferred"
      : "immediate",
    providerDeferredDelayMs: deferredWorkspaceAuxiliaryLoadMs,
    selectionScopeKey: `${externalProjectId ?? project?.id ?? "no-project"}:${initialSessionId ?? "no-session"}:${contentId ?? "no-content"}`,
  });
  const {
    availableProviders: imageWorkbenchProviders,
    selectedProvider: imageWorkbenchSelectedProvider,
    selectedProviderId: imageWorkbenchSelectedProviderId,
    setSelectedProviderId: setImageWorkbenchSelectedProviderId,
    selectedModel: imageWorkbenchSelectedModel,
    selectedModelId: imageWorkbenchSelectedModelId,
    setSelectedModelId: setImageWorkbenchSelectedModelId,
    selectedSize: imageWorkbenchSelectedSize,
    setSelectedSize: setImageWorkbenchSelectedSize,
    preferredProviderUnavailable: imageWorkbenchPreferredProviderUnavailable,
    saveImagesToResource: saveImageWorkbenchImagesToResource,
  } = imageWorkbenchGenerationRuntime;
  const imageWorkbenchPreferenceSourceLabel = useMemo(() => {
    switch (effectiveImageWorkbenchPreference.source) {
      case "project":
        return "项目图片设置";
      case "global":
        return "全局图片设置";
      case "auto":
      default:
        return "自动选择";
    }
  }, [effectiveImageWorkbenchPreference.source]);
  const imageWorkbenchPreferenceSummary = useMemo(() => {
    const providerLabel =
      imageWorkbenchSelectedProvider?.name?.trim() ||
      imageWorkbenchSelectedProviderId ||
      "自动匹配";
    const modelLabel =
      imageWorkbenchSelectedModel?.name?.trim() ||
      imageWorkbenchSelectedModelId ||
      "自动模型";
    return `来源：${imageWorkbenchPreferenceSourceLabel} · ${providerLabel} / ${modelLabel}`;
  }, [
    imageWorkbenchPreferenceSourceLabel,
    imageWorkbenchSelectedModel?.name,
    imageWorkbenchSelectedModelId,
    imageWorkbenchSelectedProvider?.name,
    imageWorkbenchSelectedProviderId,
  ]);
  const imageWorkbenchPreferenceWarning = useMemo(() => {
    if (
      !imageWorkbenchPreferredProviderUnavailable ||
      effectiveImageWorkbenchPreference.allowFallback
    ) {
      return null;
    }
    return `默认图片服务 ${effectiveImageWorkbenchPreference.preferredProviderId} 当前不可用，且已关闭自动回退。`;
  }, [
    effectiveImageWorkbenchPreference.allowFallback,
    effectiveImageWorkbenchPreference.preferredProviderId,
    imageWorkbenchPreferredProviderUnavailable,
  ]);

  useEffect(() => {
    taskFilesRef.current = taskFiles;
  }, [taskFiles]);

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
    autoLoad: shouldDeferWorkspaceAuxiliaryLoads ? "deferred" : "immediate",
    deferredDelayMs: deferredWorkspaceAuxiliaryLoadMs,
    logScope: "AgentChatPage",
    onError: (error) => {
      console.warn("[AgentChatPage] 加载 skills 失败:", error);
    },
  });
  const {
    skills: serviceSkills,
    groups: serviceSkillGroups,
    isLoading: serviceSkillsLoading,
    error: serviceSkillsError,
    recordUsage: recordServiceSkillUsage,
  } = useServiceSkills({
    enabled: activeTheme === "general",
    loadMode: shouldDeferWorkspaceAuxiliaryLoads ? "deferred" : "immediate",
    deferredDelayMs: deferredWorkspaceAuxiliaryLoadMs,
  });

  useEffect(() => {
    if (activeTheme !== "general" || !serviceSkillsError) {
      return;
    }

    toast.error(`加载技能目录失败：${serviceSkillsError}`);
  }, [activeTheme, serviceSkillsError]);
  const initialPendingServiceSkillLaunchSignature = useMemo(() => {
    const skillId = initialPendingServiceSkillLaunch?.skillId?.trim();
    const skillKey = initialPendingServiceSkillLaunch?.skillKey?.trim();
    if (!skillId && !skillKey) {
      return "";
    }

    return JSON.stringify({
      skillId,
      skillKey,
      requestKey: initialPendingServiceSkillLaunch?.requestKey ?? 0,
      initialSlotValues:
        initialPendingServiceSkillLaunch?.initialSlotValues ?? null,
      prefillHint: initialPendingServiceSkillLaunch?.prefillHint ?? null,
      launchUserInput:
        initialPendingServiceSkillLaunch?.launchUserInput ?? null,
    });
  }, [initialPendingServiceSkillLaunch]);
  const combinedSkillsLoading = skillsLoading || serviceSkillsLoading;

  // Workbench Store（用于工作区右侧技能面板状态同步）
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
  const sceneGateResumeHandlerRef = useRef<
    (input: {
      rawText: string;
      requestMetadata: Record<string, unknown>;
    }) => Promise<boolean>
  >(async () => false);

  // 工作流状态（仅在内容创作模式下使用）
  const mappedTheme = activeTheme as ThemeType;
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
  const isSpecializedThemeMode = isSpecializedWorkbenchTheme(activeTheme);

  // Artifact 状态 - 用于在画布中显示
  const artifacts = useAtomValue(artifactsAtom);
  const selectedArtifactId = useAtomValue(selectedArtifactIdAtom);
  const selectedArtifact = useAtomValue(selectedArtifactAtom);
  const setArtifacts = useSetAtom(artifactsAtom);
  const setSelectedArtifactId = useSetAtom(selectedArtifactIdAtom);
  const upsertGeneralArtifact = useCallback(
    (artifact: Artifact) => {
      setArtifacts((currentArtifacts) =>
        mergeArtifacts([...currentArtifacts, artifact]),
      );
    },
    [setArtifacts],
  );
  const hasBrowserAssistArtifact = useMemo(
    () =>
      artifacts.some(
        (artifact) =>
          artifact.id === GENERAL_BROWSER_ASSIST_ARTIFACT_ID &&
          artifact.type === "browser_assist",
      ),
    [artifacts],
  );
  const clearBrowserAssistCanvasArtifact = useCallback(() => {
    setArtifacts((currentArtifacts) => {
      const nextArtifacts = currentArtifacts.filter(
        (artifact) =>
          !(
            artifact.id === GENERAL_BROWSER_ASSIST_ARTIFACT_ID &&
            artifact.type === "browser_assist"
          ),
      );
      return nextArtifacts.length === currentArtifacts.length
        ? currentArtifacts
        : nextArtifacts;
    });

    if (selectedArtifactId === GENERAL_BROWSER_ASSIST_ARTIFACT_ID) {
      setSelectedArtifactId(null);
    }
  }, [selectedArtifactId, setArtifacts, setSelectedArtifactId]);
  const defaultSelectedArtifact = useMemo(
    () => resolveDefaultSelectedArtifact(activeTheme, artifacts),
    [activeTheme, artifacts],
  );
  const preferGeneralCanvasFilePreview = useMemo(
    () =>
      activeTheme === "general" &&
      hasNamedGeneralCanvasFilePreview(generalCanvasState),
    [activeTheme, generalCanvasState],
  );
  const liveArtifact = useMemo(
    () =>
      preferGeneralCanvasFilePreview
        ? null
        : selectedArtifact || defaultSelectedArtifact,
    [defaultSelectedArtifact, preferGeneralCanvasFilePreview, selectedArtifact],
  );

  // Artifact 预览状态
  const [artifactPreviewSize, setArtifactPreviewSize] = useState<
    "mobile" | "tablet" | "desktop"
  >("desktop");
  const [canvasWorkbenchLayoutMode, setCanvasWorkbenchLayoutMode] =
    useState<CanvasWorkbenchLayoutMode>("split");
  const [focusedArtifactBlockId, setFocusedArtifactBlockId] = useState<
    string | null
  >(null);
  const [artifactBlockFocusRequestKey, setArtifactBlockFocusRequestKey] =
    useState(0);
  const [focusedTimelineItemId, setFocusedTimelineItemId] = useState<
    string | null
  >(null);
  const [timelineFocusRequestKey, setTimelineFocusRequestKey] = useState(0);
  const [canResumeRecentSceneApp, setCanResumeRecentSceneApp] =
    useState<boolean>(() => hasSceneAppRecentVisit());
  const autoCollapsedTopicSidebarRef = useRef(false);

  useEffect(() => {
    setCanResumeRecentSceneApp(hasSceneAppRecentVisit());

    return subscribeSceneAppRecentVisits((records) => {
      setCanResumeRecentSceneApp(records.length > 0);
    });
  }, []);

  // 跳转到技能主页面
  const handleNavigateToSkillSettings = useCallback(() => {
    _onNavigate?.("skills");
  }, [_onNavigate]);
  const handleOpenSceneAppsDirectory = useCallback(() => {
    if (!_onNavigate) {
      toast.error("当前入口暂不支持跳转到全部 Skills");
      return;
    }

    _onNavigate(
      "sceneapps",
      resolveSceneAppsPageEntryParams(
        {
          projectId: projectId || undefined,
          prefillIntent: input.trim() || undefined,
        },
        {
          mode: "browse",
        },
      ),
    );
  }, [_onNavigate, input, projectId]);
  const handleResumeRecentSceneApp = useCallback(() => {
    if (!_onNavigate) {
      toast.error("当前入口暂不支持跳转到全部 Skills");
      return;
    }

    _onNavigate(
      "sceneapps",
      resolveSceneAppsPageEntryParams(
        {
          projectId: projectId || undefined,
          prefillIntent: input.trim() || undefined,
        },
        {
          mode: "resume_latest",
        },
      ),
    );
  }, [_onNavigate, input, projectId]);
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
        if (!shouldPreserveEntryThemeOnHome && (!lockTheme || !initialTheme)) {
          setActiveTheme(theme);
        }

        if (!shouldDeferWorkspaceAuxiliaryLoads) {
          const memory = await getProjectMemory(projectId);
          if (cancelled) {
            return;
          }
          setProjectMemory(memory);
          logAgentDebug("AgentChatPage", "loadData.memoryLoaded", {
            charactersCount: memory?.characters?.length ?? 0,
            durationMs: Date.now() - startedAt,
            hasOutline: Boolean(memory?.outline?.length),
            projectId,
          });
        } else {
          setProjectMemory(null);
          logAgentDebug("AgentChatPage", "loadData.memoryDeferred", {
            durationMs: Date.now() - startedAt,
            projectId,
          });
        }

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
        const sanitizedBody = isCorruptedGeneralWorkbenchDocumentContent(
          rawBody,
        )
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
          const backendDocumentState = await getGeneralWorkbenchDocumentState(
            content.id,
          ).catch((error) => {
            console.warn(
              "[AgentChatPage] 读取工作区文稿版本状态失败，降级为 metadata 解析:",
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
            ? applyBackendGeneralWorkbenchDocumentState(
                initialState,
                backendDocumentState,
                sanitizedBody,
              )
            : null;

          if (backendApplied) {
            initialState = backendApplied.state;
            setDocumentVersionStatusMap(backendApplied.statusMap);
          } else {
            const persisted = readPersistedGeneralWorkbenchDocument(
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
  }, [
    projectId,
    contentId,
    lockTheme,
    initialTheme,
    shouldDeferWorkspaceAuxiliaryLoads,
    shouldPreserveEntryThemeOnHome,
  ]);

  useEffect(() => {
    if (!shouldDeferWorkspaceAuxiliaryLoads) {
      return;
    }

    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId) {
      setProjectMemory(null);
      return;
    }

    let cancelled = false;
    const cancelDeferredLoad = scheduleMinimumDelayIdleTask(
      () => {
        const startedAt = Date.now();
        logAgentDebug("AgentChatPage", "loadDeferredMemory.start", {
          projectId: normalizedProjectId,
        });
        void getProjectMemory(normalizedProjectId)
          .then((memory) => {
            if (cancelled) {
              return;
            }
            setProjectMemory(memory);
            logAgentDebug("AgentChatPage", "loadDeferredMemory.success", {
              charactersCount: memory?.characters?.length ?? 0,
              durationMs: Date.now() - startedAt,
              hasOutline: Boolean(memory?.outline?.length),
              projectId: normalizedProjectId,
            });
          })
          .catch((error) => {
            if (cancelled) {
              return;
            }
            console.warn("[AgentChatPage] 延后加载项目 Memory 失败:", error);
            logAgentDebug(
              "AgentChatPage",
              "loadDeferredMemory.error",
              {
                durationMs: Date.now() - startedAt,
                error,
                projectId: normalizedProjectId,
              },
              { level: "warn" },
            );
          });
      },
      {
        minimumDelayMs:
          deferredWorkspaceAuxiliaryLoadMs ??
          SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS,
        idleTimeoutMs: 1_500,
      },
    );

    return () => {
      cancelled = true;
      cancelDeferredLoad();
    };
  }, [
    deferredWorkspaceAuxiliaryLoadMs,
    projectId,
    shouldDeferWorkspaceAuxiliaryLoads,
  ]);

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

    let cancelled = false;
    const runWorkspaceCheck = () => {
      const startedAt = Date.now();
      logAgentDebug("AgentChatPage", "workspaceCheck.start", {
        projectId: normalizedId,
      });
      void ensureWorkspaceReady(normalizedId)
        .then(({ repaired, rootPath }) => {
          if (cancelled) {
            return;
          }
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
          if (cancelled) {
            return;
          }
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
    };

    const cancelDeferredCheck = shouldDeferWorkspaceAuxiliaryLoads
      ? scheduleMinimumDelayIdleTask(runWorkspaceCheck, {
          minimumDelayMs:
            deferredWorkspaceAuxiliaryLoadMs ??
            SESSION_ENTRY_AUXILIARY_DEFERRED_LOAD_MS,
          idleTimeoutMs: 1_500,
        })
      : null;

    if (!cancelDeferredCheck) {
      runWorkspaceCheck();
    }

    return () => {
      cancelled = true;
      cancelDeferredCheck?.();
    };
  }, [
    deferredWorkspaceAuxiliaryLoadMs,
    projectId,
    shouldDeferWorkspaceAuxiliaryLoads,
  ]);

  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(projectId);
    if (!normalizedProjectId) {
      return;
    }

    if (project?.id === normalizedProjectId && project.isArchived) {
      return;
    }
    rememberProjectId(normalizedProjectId);
  }, [project, projectId, rememberProjectId]);

  const chatMode = useMemo(
    () => resolveAgentChatMode(mappedTheme, isSpecializedThemeMode),
    [isSpecializedThemeMode, mappedTheme],
  );
  const generalHarnessEntryEnabled = chatMode === "general";
  const shouldUseCompactGeneralSystemPrompt =
    chatMode === "general" &&
    !contentId &&
    !chatToolPreferences.webSearch &&
    !chatToolPreferences.thinking &&
    !chatToolPreferences.task &&
    !chatToolPreferences.subagent;

  // 生成系统提示词（包含项目 Memory）
  const systemPrompt = useMemo(() => {
    let prompt = "";

    if (chatMode === "general") {
      prompt = buildGeneralAgentSystemPrompt(mappedTheme, {
        compact: shouldUseCompactGeneralSystemPrompt,
        toolPreferences: chatToolPreferences,
        harness: {
          browserAssistEnabled: true,
          browserAssistProfileKey: GENERAL_BROWSER_ASSIST_PROFILE_KEY,
          contentId: contentId || null,
        },
      });
    } else if (isSpecializedThemeMode) {
      prompt = generateGeneralWorkbenchPrompt(mappedTheme, creationMode);
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
    isSpecializedThemeMode,
    mappedTheme,
    projectMemory,
    shouldUseCompactGeneralSystemPrompt,
  ]);

  // 使用 Agent Chat Hook（传递系统提示词）
  const {
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    accessMode,
    setAccessMode,
    messages = [],
    setMessages: setChatMessages = NOOP_SET_CHAT_MESSAGES,
    currentTurnId,
    turns = [],
    threadItems = [],
    todoItems = [],
    childSubagentSessions = [],
    subagentParentContext = null,
    queuedTurns = [],
    threadRead = null,
    executionRuntime = null,
    activeExecutionRuntime = null,
    isSending,
    sendMessage,
    compactSession = async () => undefined,
    stopSending,
    resumeThread = async () => false,
    replayPendingAction = async () => false,
    promoteQueuedTurn = async () => false,
    removeQueuedTurn = async () => false,
    clearMessages,
    deleteMessage,
    editMessage,
    handlePermissionResponse,
    pendingActions = [],
    submittedActionsInFlight = [],
    triggerAIGuide,
    topics = [],
    sessionHistoryWindow = null,
    isAutoRestoringSession = false,
    isSessionHydrating = false,
    sessionId,
    createFreshSession,
    ensureSession = async () => null,
    switchTopic: originalSwitchTopic,
    prefetchTopic = async () => false,
    loadFullSessionHistory = async () => false,
    deleteTopic,
    renameTopic,
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
    initialTopicsLoadMode: shouldDeferInitialTopicsLoad
      ? "deferred"
      : "immediate",
    initialTopicsDeferredDelayMs: shouldDeferInitialTopicsLoad
      ? deferredInitialTopicsLoadMs
      : undefined,
    initialRuntimeWarmupLoadMode: shouldDeferInitialRuntimeWarmup
      ? "deferred"
      : "immediate",
    initialRuntimeWarmupDeferredDelayMs: shouldDeferInitialRuntimeWarmup
      ? deferredInitialRuntimeWarmupMs
      : undefined,
    getSyncedSessionRecentPreferences,
  });
  const topicById = useMemo(
    () => new Map(topics.map((topic) => [topic.id, topic])),
    [topics],
  );
  activeSessionIdRef.current = sessionId;
  const clawSidebarEntryResetKey = shouldAutoCollapseClassicClawSidebar
    ? JSON.stringify({
        projectId: externalProjectId ?? null,
        contentId: contentId ?? null,
        sessionId: sessionId ?? null,
        theme: normalizedEntryTheme,
        newChatAt: newChatAt ?? null,
      })
    : null;

  useEffect(() => {
    if (!shouldAutoCollapseClassicClawSidebar) {
      return;
    }

    autoCollapsedTopicSidebarRef.current = false;
    setShowSidebar(false);
  }, [clawSidebarEntryResetKey, shouldAutoCollapseClassicClawSidebar]);
  const persistedTeamMemoryShadowSnapshot = useMemo(() => {
    const repoScope = project?.rootPath?.trim();
    if (!repoScope || typeof localStorage === "undefined") {
      return null;
    }

    return readTeamMemorySnapshot(localStorage, repoScope);
  }, [project?.rootPath]);
  const selectedTeamSessionSync = useMemo(
    () => ({
      getSessionId: () => activeSessionIdRef.current,
      setSessionRecentTeamSelection: syncSessionRecentTeamSelection,
    }),
    [syncSessionRecentTeamSelection],
  );
  const shouldAllowPersistedTeamFallback =
    !persistedTeamMemoryShadowSnapshot &&
    !executionRuntime?.recent_team_selection;

  const {
    selectedTeam,
    setSelectedTeam: handleSelectTeam,
    enableSuggestedTeam: handleEnableSuggestedTeam,
    preferredTeamPresetId,
    selectedTeamLabel,
    selectedTeamSummary,
  } = useSelectedTeamPreference(activeTheme, {
    runtimeSelection: executionRuntime?.recent_team_selection ?? null,
    shadowSnapshot: persistedTeamMemoryShadowSnapshot,
    sessionSync: selectedTeamSessionSync,
    allowPersistedThemeFallback: shouldAllowPersistedTeamFallback,
  });
  const teamMemoryShadowSnapshot = useTeamMemoryShadowSync({
    repoScope: project?.rootPath || null,
    activeTheme,
    sessionId,
    selectedTeam,
    childSubagentSessions,
    subagentParentContext,
  });
  const resolvedTeamMemoryShadowSnapshot =
    teamMemoryShadowSnapshot ?? persistedTeamMemoryShadowSnapshot;
  const handleOpenSubagentSession = useCallback(
    (subagentSessionId: string) => {
      deferSessionRecentMetadataSyncForNavigation(subagentSessionId);
      void originalSwitchTopic(subagentSessionId);
    },
    [deferSessionRecentMetadataSyncForNavigation, originalSwitchTopic],
  );
  const handleReturnToParentSession = useCallback(() => {
    const parentSessionId = subagentParentContext?.parent_session_id?.trim();
    if (!parentSessionId) {
      return;
    }
    deferSessionRecentMetadataSyncForNavigation(parentSessionId);
    void originalSwitchTopic(parentSessionId);
  }, [
    deferSessionRecentMetadataSyncForNavigation,
    originalSwitchTopic,
    subagentParentContext?.parent_session_id,
  ]);
  const runtimeChatToolPreferences = useMemo(
    () => createChatToolPreferencesFromExecutionRuntime(executionRuntime),
    [executionRuntime],
  );
  const effectiveChatToolPreferences = useMemo(
    () =>
      alignChatToolPreferencesWithExecutionStrategy(
        chatToolPreferences,
        executionStrategy,
      ),
    [chatToolPreferences, executionStrategy],
  );

  useEffect(() => {
    syncChatToolPreferencesSource(activeTheme, runtimeChatToolPreferences);
  }, [activeTheme, runtimeChatToolPreferences, syncChatToolPreferencesSource]);

  useEffect(() => {
    if (chatToolPreferences.task === effectiveChatToolPreferences.task) {
      return;
    }

    setChatToolPreferences(effectiveChatToolPreferences);
  }, [
    chatToolPreferences.task,
    effectiveChatToolPreferences,
    setChatToolPreferences,
  ]);

  useEffect(() => {
    const trimmedSessionId = sessionId?.trim();
    if (!trimmedSessionId || runtimeChatToolPreferences) {
      return;
    }

    const fallbackPreferences = alignChatToolPreferencesWithExecutionStrategy(
      loadChatToolPreferences(activeTheme),
      executionStrategy,
    );
    const backfillKey = `${trimmedSessionId}:${JSON.stringify([
      fallbackPreferences.webSearch,
      fallbackPreferences.thinking,
      fallbackPreferences.task,
      fallbackPreferences.subagent,
    ])}`;
    if (sessionRecentPreferencesBackfillKeyRef.current === backfillKey) {
      return;
    }
    sessionRecentPreferencesBackfillKeyRef.current = backfillKey;

    void syncSessionRecentPreferences(trimmedSessionId, fallbackPreferences, {
      priority: "background",
    }).catch((error) => {
      console.warn("[AgentChatPage] 回填会话 recent_preferences 失败:", error);
    });
  }, [
    activeTheme,
    executionStrategy,
    runtimeChatToolPreferences,
    sessionId,
    syncSessionRecentPreferences,
  ]);

  const {
    clearRuntimeTeamState: clearPreparedRuntimeTeamState,
    prepareRuntimeTeamBeforeSend,
  } = useRuntimeTeamFormation({
    projectId,
    selectedTeam,
    subagentEnabled: effectiveChatToolPreferences.subagent,
  });
  const clearRuntimeTeamState = useCallback(() => {
    clearPreparedRuntimeTeamState();
  }, [clearPreparedRuntimeTeamState]);
  const localImageWorkbenchSessionKeyRef = useRef(
    `__local_image_workbench__:${Date.now().toString(36)}:${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  );
  const imageWorkbenchSessionKey = useMemo(
    () => sessionId?.trim() || localImageWorkbenchSessionKeyRef.current,
    [sessionId],
  );
  const cachedImageWorkbenchState = useMemo(() => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedProjectId || !normalizedSessionId) {
      return null;
    }

    return loadSessionImageWorkbenchCachedState(
      normalizedProjectId,
      normalizedSessionId,
      { contentId, refreshAccess: false },
    );
  }, [contentId, projectId, sessionId]);
  const currentImageWorkbenchState = useMemo(
    () =>
      imageWorkbenchBySessionId[imageWorkbenchSessionKey] ||
      cachedImageWorkbenchState?.state ||
      createInitialSessionImageWorkbenchState(),
    [
      cachedImageWorkbenchState,
      imageWorkbenchBySessionId,
      imageWorkbenchSessionKey,
    ],
  );
  const imageWorkbenchStateForCache = useMemo(() => {
    if (isSessionImageWorkbenchStateMeaningful(currentImageWorkbenchState)) {
      return currentImageWorkbenchState;
    }

    return buildSessionImageWorkbenchStateFromMessages(messages);
  }, [currentImageWorkbenchState, messages]);
  const updateCurrentImageWorkbenchState = useCallback(
    (
      updater: (
        current: SessionImageWorkbenchState,
      ) => SessionImageWorkbenchState,
    ) => {
      setImageWorkbenchBySessionId((previous) => {
        const current =
          previous[imageWorkbenchSessionKey] ||
          createInitialSessionImageWorkbenchState();
        return {
          ...previous,
          [imageWorkbenchSessionKey]: updater(current),
        };
      });
    },
    [imageWorkbenchSessionKey],
  );
  const updateImageWorkbenchStateForSession = useCallback(
    (
      sessionKey: string,
      updater: (
        current: SessionImageWorkbenchState,
      ) => SessionImageWorkbenchState,
      options?: {
        fallbackState?: SessionImageWorkbenchState;
        removeSessionKeys?: string[];
      },
    ) => {
      const normalizedSessionKey = sessionKey.trim();
      if (!normalizedSessionKey) {
        return;
      }

      setImageWorkbenchBySessionId((previous) => {
        const current =
          previous[normalizedSessionKey] ||
          options?.fallbackState ||
          createInitialSessionImageWorkbenchState();
        const nextState = {
          ...previous,
          [normalizedSessionKey]: updater(current),
        };

        options?.removeSessionKeys?.forEach((candidateKey) => {
          const normalizedCandidateKey = candidateKey.trim();
          if (
            !normalizedCandidateKey ||
            normalizedCandidateKey === normalizedSessionKey
          ) {
            return;
          }
          delete nextState[normalizedCandidateKey];
        });

        return nextState;
      });
    },
    [],
  );
  useEffect(() => {
    const normalizedSessionId = sessionId?.trim();
    const localSessionKey = localImageWorkbenchSessionKeyRef.current;
    if (!normalizedSessionId || normalizedSessionId === localSessionKey) {
      return;
    }

    const localState = imageWorkbenchBySessionId[localSessionKey];
    if (!localState) {
      return;
    }

    updateImageWorkbenchStateForSession(
      normalizedSessionId,
      (current) => current,
      {
        fallbackState: localState,
        removeSessionKeys: [localSessionKey],
      },
    );
  }, [
    imageWorkbenchBySessionId,
    sessionId,
    updateImageWorkbenchStateForSession,
  ]);
  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const normalizedSessionId = sessionId?.trim();
    if (!normalizedProjectId || !normalizedSessionId) {
      return;
    }

    if (!cachedImageWorkbenchState) {
      return;
    }

    setImageWorkbenchBySessionId((previous) => {
      if (
        isSessionImageWorkbenchStateMeaningful(previous[normalizedSessionId])
      ) {
        return previous;
      }

      return {
        ...previous,
        [normalizedSessionId]: cachedImageWorkbenchState.state,
      };
    });
  }, [cachedImageWorkbenchState, projectId, sessionId]);
  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(projectId);
    const normalizedSessionId = sessionId?.trim();
    if (
      !normalizedProjectId ||
      !normalizedSessionId ||
      !isSessionImageWorkbenchStateMeaningful(imageWorkbenchStateForCache)
    ) {
      return;
    }

    return scheduleMinimumDelayIdleTask(
      () => {
        saveSessionImageWorkbenchCachedState(
          normalizedProjectId,
          normalizedSessionId,
          imageWorkbenchStateForCache,
          { contentId },
        );
      },
      {
        minimumDelayMs: 400,
        idleTimeoutMs: 2_000,
      },
    );
  }, [contentId, imageWorkbenchStateForCache, projectId, sessionId]);
  const teamSessionRuntime = useWorkspaceTeamSessionRuntime({
    sessionId,
    topics,
    turns,
    queuedTurnCount: queuedTurns.length,
    isSending,
    subagentEnabled: effectiveChatToolPreferences.subagent,
    childSubagentSessions,
    subagentParentContext,
  });
  const teamSessionControlRuntime = useWorkspaceTeamSessionControlRuntime({
    childSubagentSessions,
    liveRuntimeBySessionId: teamSessionRuntime.liveRuntimeBySessionId,
    stopSending,
  });
  const [teamWorkbenchAutoFocusToken, setTeamWorkbenchAutoFocusToken] =
    useState(0);
  const dismissActiveTeamWorkbenchAutoOpen = useCallback(() => {}, []);
  const handleActivateTeamWorkbench = useCallback(() => {
    setTeamWorkbenchAutoFocusToken((current) => current + 1);
    setLayoutMode((current) => (current === "chat" ? "chat-canvas" : current));
  }, [setLayoutMode]);
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
        skillsLoading: combinedSkillsLoading,
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
          skillsLoading: combinedSkillsLoading,
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
    combinedSkillsLoading,
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
  const activeArtifactViewTargetId =
    displayedCanvasArtifact?.id ||
    currentCanvasArtifact?.id ||
    selectedArtifact?.id ||
    liveArtifact?.id ||
    null;
  const {
    artifactViewMode,
    applyAutoArtifactViewMode,
    handleArtifactViewModeChange,
  } = useWorkspaceArtifactViewModeControl({
    activeTheme,
    displayedArtifact: displayedCanvasArtifact,
    activeArtifactId: activeArtifactViewTargetId,
  });
  const {
    browserAssistLaunching,
    browserAssistSessionState,
    siteSkillExecutionState,
    currentBrowserAssistScopeKey,
    ensureBrowserAssistCanvas,
    suppressBrowserAssistCanvasAutoOpen,
    suppressGeneralCanvasArtifactAutoOpen,
  } = useWorkspaceBrowserAssistRuntime({
    activeTheme,
    projectId,
    sessionId,
    contentId,
    input,
    initialUserPrompt,
    openBrowserAssistOnMount,
    initialSiteSkillLaunch,
    siteSkillLaunchNonce: newChatAt,
    artifacts,
    messages,
    setLayoutMode,
    upsertGeneralArtifact,
    generalBrowserAssistProfileKey: GENERAL_BROWSER_ASSIST_PROFILE_KEY,
  });
  const initialHarnessBrowserAssist = useMemo(() => {
    return asRecord(
      asRecord(initialAutoSendRequestMetadata)?.harness
        ? asRecord(asRecord(initialAutoSendRequestMetadata)?.harness)
            ?.browser_assist
        : undefined,
    );
  }, [initialAutoSendRequestMetadata]);
  const initialHarnessPreferredBackend = useMemo(() => {
    const value = readFirstString(
      initialHarnessBrowserAssist ? [initialHarnessBrowserAssist] : [],
      ["preferred_backend", "preferredBackend"],
    );
    return value === "lime_extension_bridge" || value === "cdp_direct"
      ? value
      : undefined;
  }, [initialHarnessBrowserAssist]);
  const initialHarnessAutoLaunch = useMemo(() => {
    const rawValue =
      initialHarnessBrowserAssist?.auto_launch ??
      initialHarnessBrowserAssist?.autoLaunch;
    return typeof rawValue === "boolean" ? rawValue : undefined;
  }, [initialHarnessBrowserAssist]);
  const browserAssistRequestProfileKey = useMemo(() => {
    if (mappedTheme !== "general") {
      return undefined;
    }

    return (
      browserAssistSessionState?.profileKey?.trim() ||
      initialSiteSkillLaunch?.profileKey?.trim() ||
      GENERAL_BROWSER_ASSIST_PROFILE_KEY
    );
  }, [
    browserAssistSessionState?.profileKey,
    initialSiteSkillLaunch?.profileKey,
    mappedTheme,
  ]);
  const shouldPreferExistingSessionBridgeForClaw = useMemo(() => {
    if (mappedTheme !== "general") {
      return false;
    }

    return (
      browserAssistSessionState?.transportKind === "existing_session" ||
      initialHarnessPreferredBackend === "lime_extension_bridge" ||
      initialHarnessAutoLaunch === false ||
      Boolean(initialSiteSkillLaunch?.profileKey?.trim()) ||
      Boolean(initialSiteSkillLaunch?.requireAttachedSession) ||
      initialSiteSkillLaunch?.preferredBackend === "lime_extension_bridge" ||
      initialSiteSkillLaunch?.autoLaunch === false
    );
  }, [
    browserAssistSessionState?.transportKind,
    initialHarnessAutoLaunch,
    initialHarnessPreferredBackend,
    initialSiteSkillLaunch?.autoLaunch,
    initialSiteSkillLaunch?.profileKey,
    initialSiteSkillLaunch?.preferredBackend,
    initialSiteSkillLaunch?.requireAttachedSession,
    mappedTheme,
  ]);
  const browserAssistRequestPreferredBackend =
    initialSiteSkillLaunch?.preferredBackend ||
    initialHarnessPreferredBackend ||
    (shouldPreferExistingSessionBridgeForClaw
      ? "lime_extension_bridge"
      : undefined);
  const browserAssistRequestAutoLaunch =
    initialSiteSkillLaunch?.autoLaunch ??
    initialHarnessAutoLaunch ??
    (shouldPreferExistingSessionBridgeForClaw ? false : true);
  const handleOpenBrowserRuntimeForBrowserAssist = useCallback(
    (artifact?: Artifact) => {
      if (!_onNavigate) {
        toast.error("当前入口暂不支持打开浏览器工作台，请从桌面主界面重试。");
        return;
      }

      const artifactMeta = artifact ? asRecord(artifact.meta) : null;
      _onNavigate("browser-runtime", {
        projectId: projectId ?? undefined,
        contentId: contentId ?? undefined,
        initialProfileKey:
          readFirstString(artifactMeta ? [artifactMeta] : [], [
            "profileKey",
            "profile_key",
          ]) ||
          browserAssistSessionState?.profileKey ||
          GENERAL_BROWSER_ASSIST_PROFILE_KEY,
        initialSessionId:
          readFirstString(artifactMeta ? [artifactMeta] : [], [
            "sessionId",
            "session_id",
          ]) ||
          browserAssistSessionState?.sessionId ||
          undefined,
        initialTargetId:
          readFirstString(artifactMeta ? [artifactMeta] : [], [
            "targetId",
            "target_id",
          ]) ||
          browserAssistSessionState?.targetId ||
          undefined,
      });
    },
    [
      _onNavigate,
      browserAssistSessionState?.profileKey,
      browserAssistSessionState?.sessionId,
      browserAssistSessionState?.targetId,
      contentId,
      projectId,
    ],
  );
  const handleOpenBrowserRuntimeForSiteSkillExecution = useCallback(() => {
    if (!_onNavigate || !initialSiteSkillLaunch?.adapterName?.trim()) {
      return;
    }

    _onNavigate("browser-runtime", {
      projectId: projectId ?? undefined,
      contentId: contentId ?? undefined,
      initialProfileKey:
        siteSkillExecutionState?.profileKey ||
        initialSiteSkillLaunch.profileKey,
      initialTargetId:
        siteSkillExecutionState?.targetId || initialSiteSkillLaunch.targetId,
      initialAdapterName: initialSiteSkillLaunch.adapterName,
      initialArgs: initialSiteSkillLaunch.args,
      initialAutoRun: false,
      initialRequireAttachedSession: true,
      initialSaveTitle: initialSiteSkillLaunch.saveTitle,
    });
  }, [
    contentId,
    initialSiteSkillLaunch,
    _onNavigate,
    projectId,
    siteSkillExecutionState?.profileKey,
    siteSkillExecutionState?.targetId,
  ]);
  const realSubagentTimelineItems = useMemo(
    () =>
      buildRealSubagentTimelineItems({
        threadId: sessionId,
        turns,
        childSessions: childSubagentSessions,
      }),
    [childSubagentSessions, sessionId, turns],
  );
  const effectiveThreadItems = useMemo(
    () => mergeThreadItems(threadItems, realSubagentTimelineItems),
    [realSubagentTimelineItems, threadItems],
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
      if (selectedArtifactId !== null) {
        setSelectedArtifactId(null);
      }
      return;
    }

    if (preferGeneralCanvasFilePreview) {
      if (selectedArtifactId !== null) {
        setSelectedArtifactId(null);
      }
      return;
    }

    if (artifacts.length === 0) {
      if (selectedArtifactId !== null) {
        setSelectedArtifactId(null);
      }
      return;
    }

    const fallbackArtifactId = defaultSelectedArtifact?.id || null;

    if (!selectedArtifact) {
      if (selectedArtifactId !== fallbackArtifactId) {
        setSelectedArtifactId(fallbackArtifactId);
      }
      return;
    }

    if (selectedArtifact.type === "browser_assist") {
      if (selectedArtifactId !== fallbackArtifactId) {
        setSelectedArtifactId(fallbackArtifactId);
      }
      return;
    }

    const selectedStillExists = artifacts.some(
      (artifact) => artifact.id === selectedArtifact.id,
    );
    if (!selectedStillExists && selectedArtifactId !== fallbackArtifactId) {
      setSelectedArtifactId(fallbackArtifactId);
    }
  }, [
    activeTheme,
    artifacts,
    defaultSelectedArtifact,
    preferGeneralCanvasFilePreview,
    selectedArtifact,
    selectedArtifactId,
    setSelectedArtifactId,
  ]);

  const contextHarnessRuntime = useWorkspaceContextHarnessRuntime({
    enabled: workspaceHarnessEnabled || generalHarnessEntryEnabled,
    projectId,
    activeTheme,
    messages,
    providerType,
    model,
    mappedTheme,
    isSending,
    projectMemory,
    harnessState,
  });
  const {
    contextWorkspace,
    isThemeWorkbench,
    harnessPanelVisible,
    setHarnessPanelVisible,
    harnessPendingCount,
    showHarnessToggle,
    harnessAttentionLevel,
    navbarHarnessPanelVisible,
    harnessToggleLabel,
  } = contextHarnessRuntime;
  const generalWorkbenchScaffoldRuntime =
    useWorkspaceGeneralWorkbenchScaffoldRuntime({
      isGeneralWorkbench: isThemeWorkbench,
      mappedTheme,
      sessionId,
      projectId,
      canvasState,
      documentVersionStatusMap,
      setDocumentVersionStatusMap,
      clearThemeSkillsRailState,
      setCanvasState,
      setLayoutMode,
    });
  const {
    shouldUseCompactGeneralWorkbench,
    shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt,
    setTopicStatus,
  } = generalWorkbenchScaffoldRuntime;

  useWorkspaceGeneralWorkbenchDocumentPersistenceRuntime({
    isThemeWorkbench,
    contentId,
    canvasState,
    documentVersionStatusMap,
    contentMetadataRef,
    persistedWorkbenchSnapshotRef,
  });

  const workspaceServiceSkillEntryActions =
    useWorkspaceServiceSkillEntryActions({
      activeTheme,
      creationMode,
      projectId,
      contentId,
      input,
      chatToolPreferences: effectiveChatToolPreferences,
      creationReplay: initialCreationReplay,
      preferredTeamPresetId,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      onNavigate: _onNavigate,
      recordServiceSkillUsage,
    });
  const workspaceSceneAppEntryActions = useWorkspaceSceneAppEntryActions({
    activeTheme,
    creationMode,
    projectId,
    input,
    selectedText,
    defaultToolPreferences: effectiveChatToolPreferences,
    onNavigate: _onNavigate,
    catalogLoadMode: shouldDeferWorkspaceAuxiliaryLoads
      ? "deferred"
      : "immediate",
    catalogDeferredDelayMs: deferredWorkspaceAuxiliaryLoadMs,
  });
  const handlePendingServiceSkillLaunchSubmit =
    workspaceServiceSkillEntryActions.handlePendingServiceSkillLaunchSubmit;
  useEffect(() => {
    if (!initialPendingServiceSkillLaunchSignature) {
      handledInitialPendingServiceSkillLaunchSignatureRef.current = "";
      return;
    }

    if (
      activeTheme !== "general" ||
      serviceSkillsLoading ||
      serviceSkillsError
    ) {
      return;
    }

    if (
      handledInitialPendingServiceSkillLaunchSignatureRef.current ===
      initialPendingServiceSkillLaunchSignature
    ) {
      return;
    }

    const skillId = initialPendingServiceSkillLaunch?.skillId?.trim();
    const skillKey = initialPendingServiceSkillLaunch?.skillKey?.trim();
    if (!skillId && !skillKey) {
      return;
    }

    const matchedSkill = serviceSkills.find(
      (skill) =>
        (skillId && skill.id === skillId) ||
        (skillKey && skill.skillKey === skillKey),
    );
    if (!matchedSkill) {
      if (serviceSkills.length === 0) {
        return;
      }

      handledInitialPendingServiceSkillLaunchSignatureRef.current =
        initialPendingServiceSkillLaunchSignature;
      toast.error(`未找到技能：${skillId ?? skillKey}`);
      return;
    }

    handledInitialPendingServiceSkillLaunchSignatureRef.current =
      initialPendingServiceSkillLaunchSignature;
    workspaceServiceSkillEntryActions.handleServiceSkillSelect(matchedSkill, {
      requestKey: initialPendingServiceSkillLaunch?.requestKey,
      initialSlotValues: initialPendingServiceSkillLaunch?.initialSlotValues,
      prefillHint: initialPendingServiceSkillLaunch?.prefillHint,
      launchUserInput: initialPendingServiceSkillLaunch?.launchUserInput,
    });
  }, [
    activeTheme,
    initialPendingServiceSkillLaunch,
    initialPendingServiceSkillLaunchSignature,
    serviceSkills,
    serviceSkillsError,
    serviceSkillsLoading,
    workspaceServiceSkillEntryActions,
  ]);

  const {
    a2uiSubmissionNotice,
    pendingA2UIForm,
    pendingA2UISource,
    pendingActionRequest,
    pendingPromotedA2UIActionRequest,
    resolvePendingA2UISubmit,
  } = useWorkspaceA2UIRuntime({
    messages,
  });
  const pendingServiceSkillLaunchForm =
    workspaceServiceSkillEntryActions.pendingServiceSkillLaunchForm;
  const pendingServiceSkillLaunchSource =
    workspaceServiceSkillEntryActions.pendingServiceSkillLaunchSource;
  const {
    pendingSceneGateForm,
    pendingSceneGateSource,
    openRuntimeSceneGate,
    handleSceneGateSubmit,
  } = useWorkspaceSceneGateRuntime({
    serviceSkills: activeTheme === "general" ? serviceSkills : [],
    projectId,
    contentId,
    creationReplay: initialCreationReplay,
    applyProjectSelection,
    resumeSceneGate: async (input) =>
      await sceneGateResumeHandlerRef.current(input),
  });
  const effectivePendingA2UIForm =
    pendingServiceSkillLaunchForm ?? pendingSceneGateForm ?? pendingA2UIForm;
  const effectivePendingA2UISource =
    pendingServiceSkillLaunchSource ??
    pendingSceneGateSource ??
    pendingA2UISource;
  const hasPendingA2UIForm = Boolean(effectivePendingA2UIForm);
  const suppressCanvasAutoOpenForPendingA2UI = hasPendingA2UIForm;

  const {
    currentGate,
    documentEditorFocusedRef,
    themeWorkbenchActiveQueueItem,
    themeWorkbenchBackendRunState,
    themeWorkbenchRunState,
  } = useWorkspaceGeneralWorkbenchRuntime({
    isThemeWorkbench,
    sessionId,
    isSending,
    pendingActionRequest,
  });

  const generalWorkbenchSidebarRuntime =
    useWorkspaceGeneralWorkbenchSidebarRuntime({
      isThemeWorkbench,
      sessionId,
      messages,
      isSending,
      themeWorkbenchBackendRunState,
      contextActivityLogs: contextWorkspace.activityLogs,
      historyPageSize: GENERAL_WORKBENCH_HISTORY_PAGE_SIZE,
    });

  const handleViewContextDetail = useCallback(
    (contextId: string) => {
      const detail = contextWorkspace.getContextDetail(contextId);
      if (!detail) {
        toast.error("无法找到上下文详情");
        return;
      }

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

  const harnessRequestMetadata = useMemo(
    () =>
      buildHarnessRequestMetadata({
        theme: mappedTheme,
        preferences: {
          webSearch: effectiveChatToolPreferences.webSearch,
          thinking: effectiveChatToolPreferences.thinking,
          task: effectiveChatToolPreferences.task,
          subagent: effectiveChatToolPreferences.subagent,
        },
        sessionMode: isThemeWorkbench ? "general_workbench" : "default",
        gateKey: isThemeWorkbench ? currentGate.key : undefined,
        runTitle: themeWorkbenchActiveQueueItem?.title?.trim() || undefined,
        contentId: contentId || undefined,
        browserAssistProfileKey: browserAssistRequestProfileKey,
        browserAssistPreferredBackend: browserAssistRequestPreferredBackend,
        browserAssistAutoLaunch: browserAssistRequestAutoLaunch,
        preferredTeamPresetId,
        selectedTeamId: selectedTeam?.id,
        selectedTeamSource: selectedTeam?.source,
        selectedTeamLabel,
        selectedTeamDescription: selectedTeam?.description,
        selectedTeamSummary,
        selectedTeamRoles: selectedTeam?.roles,
        teamMemoryShadow: buildTeamMemoryShadowRequestMetadata(
          resolvedTeamMemoryShadowSnapshot,
        ),
      }),
    [
      effectiveChatToolPreferences.subagent,
      effectiveChatToolPreferences.task,
      effectiveChatToolPreferences.thinking,
      effectiveChatToolPreferences.webSearch,
      browserAssistRequestAutoLaunch,
      browserAssistRequestPreferredBackend,
      browserAssistRequestProfileKey,
      contentId,
      currentGate.key,
      isThemeWorkbench,
      mappedTheme,
      preferredTeamPresetId,
      selectedTeam?.id,
      selectedTeam?.description,
      selectedTeam?.roles,
      selectedTeam?.source,
      selectedTeamLabel,
      selectedTeamSummary,
      resolvedTeamMemoryShadowSnapshot,
      themeWorkbenchActiveQueueItem?.title,
    ],
  );
  const harnessInventoryRuntime = useWorkspaceHarnessInventoryRuntime({
    enabled: workspaceHarnessEnabled,
    chatMode,
    mappedTheme,
    harnessPanelVisible,
    harnessRequestMetadata,
    isThemeWorkbench,
    themeWorkbenchRunState,
    currentGate,
    themeWorkbenchBackendRunState,
    themeWorkbenchActiveQueueItem,
    harnessPendingCount,
  });

  useEffect(() => {
    if (!isThemeWorkbench || themeWorkbenchRunState !== "idle") {
      return;
    }
    if (!canvasState || canvasState.type !== "document") {
      return;
    }

    const latestTerminal =
      themeWorkbenchBackendRunState?.latest_terminal ?? null;

    setDocumentVersionStatusMap((previous) => {
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
    setDocumentVersionStatusMap,
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

  const { syncGeneralArtifactToResource } = useWorkspaceGeneralResourceSync({
    activeTheme,
    projectId,
    sessionId,
    projectRootPath: project?.rootPath || null,
  });

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

  // 用于追踪是否已触发过 AI 引导
  const hasTriggeredGuide = useRef(false);
  const consumedInitialPromptRef = useRef<string | null>(null);
  const consumedInitialPromptKey = consumedInitialPromptRef.current;
  const [bootstrapDispatchSnapshot, setBootstrapDispatchSnapshot] =
    useState<InitialDispatchPreviewSnapshot | null>(null);
  const [generalWorkbenchEntryPrompt, setGeneralWorkbenchEntryPrompt] =
    useState<GeneralWorkbenchEntryPromptState | null>(null);
  const [
    generalWorkbenchEntryCheckPending,
    setGeneralWorkbenchEntryCheckPending,
  ] = useState(false);
  const hydratedPromptSignatureRef = useRef<string | null>(null);
  const dismissedPromptSignatureRef = useRef<string | null>(null);
  const initialDispatchKey = useMemo(
    () => buildInitialDispatchKey(initialUserPrompt, initialUserImages),
    [initialUserImages, initialUserPrompt],
  );

  useEffect(() => {
    if (!initialDispatchKey) {
      return;
    }

    setBootstrapDispatchSnapshot({
      key: initialDispatchKey,
      prompt: initialUserPrompt,
      images: initialUserImages || [],
    });
  }, [initialDispatchKey, initialUserImages, initialUserPrompt]);

  useEffect(() => {
    if (messages.length > 0) {
      setBootstrapDispatchSnapshot(null);
      return;
    }

    if (!initialDispatchKey && !isSending && queuedTurns.length === 0) {
      setBootstrapDispatchSnapshot(null);
    }
  }, [initialDispatchKey, isSending, messages.length, queuedTurns.length]);

  const activeBootstrapDispatch = useMemo(() => {
    if (
      initialDispatchKey &&
      ((initialUserPrompt || "").trim() || (initialUserImages || []).length > 0)
    ) {
      return {
        key: initialDispatchKey,
        prompt: initialUserPrompt,
        images: initialUserImages || [],
      };
    }

    return bootstrapDispatchSnapshot;
  }, [
    bootstrapDispatchSnapshot,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
  ]);
  const isBootstrapDispatchPending =
    activeBootstrapDispatch !== null &&
    consumedInitialPromptKey !== activeBootstrapDispatch.key;
  const bootstrapDispatchPreview =
    !shouldUseCompactGeneralWorkbench &&
    activeBootstrapDispatch &&
    messages.length === 0 &&
    (isSending || queuedTurns.length > 0)
      ? activeBootstrapDispatch
      : null;
  useEffect(() => {
    hydratedPromptSignatureRef.current = null;
    dismissedPromptSignatureRef.current = null;
    setGeneralWorkbenchEntryPrompt(null);
    setGeneralWorkbenchEntryCheckPending(false);
  }, [activeTheme, contentId, initialDispatchKey]);

  useEffect(() => {
    if (shouldUseCompactGeneralWorkbench) {
      return;
    }

    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];
    if (
      !isThemeWorkbench ||
      autoRunInitialPromptOnMount ||
      !contentId ||
      !initialDispatchKey ||
      !pendingInitialPrompt ||
      pendingInitialImages.length > 0 ||
      messages.length > 0
    ) {
      return;
    }

    if (
      consumedInitialPromptKey === initialDispatchKey ||
      hydratedPromptSignatureRef.current === initialDispatchKey
    ) {
      return;
    }

    hydratedPromptSignatureRef.current = initialDispatchKey;
    hasTriggeredGuide.current = true;
    setInput((previous) => previous.trim() || pendingInitialPrompt);
    setGeneralWorkbenchEntryPrompt({
      kind: "initial_prompt",
      signature: initialDispatchKey,
      title: "已恢复待执行创作意图",
      description: "进入页面后不会自动开始生成，确认后再继续。",
      actionLabel: "继续生成",
      prompt: pendingInitialPrompt,
    });
  }, [
    autoRunInitialPromptOnMount,
    consumedInitialPromptKey,
    contentId,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
    isThemeWorkbench,
    messages.length,
    setInput,
    shouldUseCompactGeneralWorkbench,
  ]);

  useEffect(() => {
    if (shouldUseCompactGeneralWorkbench) {
      setGeneralWorkbenchEntryCheckPending(false);
      return;
    }

    if (
      !isThemeWorkbench ||
      !contentId ||
      !sessionId ||
      messages.length > 0 ||
      Boolean(initialDispatchKey)
    ) {
      setGeneralWorkbenchEntryCheckPending(false);
      return;
    }

    let disposed = false;
    setGeneralWorkbenchEntryCheckPending(true);
    const perfT0 = performance.now();

    void (async () => {
      try {
        const backendState = await executionRunGetGeneralWorkbenchState(
          sessionId,
          3,
        ).catch(() => null);

        console.info(
          `[PERF] executionRunGetGeneralWorkbenchState: ${(performance.now() - perfT0).toFixed(0)}ms`,
        );

        if (disposed) {
          return;
        }

        const nextPrompt =
          buildGeneralWorkbenchResumePromptFromRunState(backendState);
        if (!nextPrompt) {
          setGeneralWorkbenchEntryPrompt((current) =>
            current?.kind === "resume" ? null : current,
          );
          return;
        }

        if (dismissedPromptSignatureRef.current === nextPrompt.signature) {
          return;
        }

        setGeneralWorkbenchEntryPrompt((current) =>
          current?.kind === "initial_prompt" ? current : nextPrompt,
        );
      } finally {
        if (!disposed) {
          setGeneralWorkbenchEntryCheckPending(false);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [
    contentId,
    initialDispatchKey,
    isThemeWorkbench,
    messages.length,
    sessionId,
    shouldUseCompactGeneralWorkbench,
  ]);

  const clearGeneralWorkbenchEntryPrompt = useCallback(() => {
    setGeneralWorkbenchEntryPrompt(null);
  }, []);

  const dismissGeneralWorkbenchEntryPrompt = useCallback(
    (options?: {
      consumeInitialPrompt?: boolean;
      onConsumeInitialPrompt?: () => void;
    }) => {
      setGeneralWorkbenchEntryPrompt((current) => {
        if (!current) {
          return current;
        }

        if (
          current.kind === "initial_prompt" &&
          options?.consumeInitialPrompt &&
          initialDispatchKey
        ) {
          options.onConsumeInitialPrompt?.();
        } else {
          dismissedPromptSignatureRef.current = current.signature;
        }

        return null;
      });
    },
    [initialDispatchKey],
  );
  const consumeInitialPrompt = useCallback(
    (dispatchKey: string | null) => {
      consumedInitialPromptRef.current = dispatchKey;
      onInitialUserPromptConsumed?.();
    },
    [onInitialUserPromptConsumed],
  );
  const resetConsumedInitialPrompt = useCallback(() => {
    consumedInitialPromptRef.current = null;
  }, []);
  const resetGuideState = useCallback(() => {
    hasTriggeredGuide.current = false;
    consumedInitialPromptRef.current = null;
  }, []);
  const resolveSendBoundary = useCallback(
    ({
      sourceText,
      sendOptions,
    }: {
      sourceText: string;
      sendOptions?: HandleSendOptions;
    }): GeneralWorkbenchSendBoundaryState =>
      buildGeneralWorkbenchSendBoundaryState({
        isThemeWorkbench,
        contentId,
        initialDispatchKey,
        consumedInitialPromptKey,
        initialUserImages,
        mappedTheme,
        socialArticleSkillKey: SOCIAL_ARTICLE_SKILL_KEY,
        sourceText,
        sendOptions,
      }),
    [
      contentId,
      consumedInitialPromptKey,
      initialDispatchKey,
      initialUserImages,
      isThemeWorkbench,
      mappedTheme,
    ],
  );
  const finalizeAfterSendSuccess = useCallback(
    (boundary: GeneralWorkbenchSendBoundaryState) => {
      if (
        boundary.shouldConsumePendingGeneralWorkbenchInitialPrompt &&
        initialDispatchKey
      ) {
        consumeInitialPrompt(initialDispatchKey);
      }

      if (boundary.shouldDismissGeneralWorkbenchEntryPrompt) {
        clearGeneralWorkbenchEntryPrompt();
      }
    },
    [
      clearGeneralWorkbenchEntryPrompt,
      consumeInitialPrompt,
      initialDispatchKey,
    ],
  );
  const rollbackAfterSendFailure = useCallback(
    (boundary: GeneralWorkbenchSendBoundaryState) => {
      if (boundary.shouldConsumePendingGeneralWorkbenchInitialPrompt) {
        resetConsumedInitialPrompt();
      }
    },
    [resetConsumedInitialPrompt],
  );
  const { resetRestoredSessionState } = useWorkspaceSessionRestore({
    sessionId,
    sessionMeta,
    lockTheme,
    initialTheme,
    sessionFiles,
    taskFilesLength: taskFiles.length,
    setActiveTheme,
    setCreationMode,
    setTaskFiles,
  });
  const { handleBackHome, resetTopicLocalState } = useWorkspaceResetRuntime({
    clearMessages,
    clearRuntimeTeamState,
    clearProjectSelectionRuntime,
    resetRestoredSessionState,
    resetGuideState,
    hasHandledNewChatRequest,
    markNewChatRequestHandled,
    defaultTopicSidebarVisible,
    normalizedInitialTheme: normalizedEntryTheme,
    initialCreationMode,
    newChatAt,
    externalProjectId,
    onNavigate: _onNavigate,
    autoCollapsedTopicSidebarRef,
    processedMessageIdsRef: processedMessageIds,
    setInput,
    setSelectedText,
    setLayoutMode,
    setShowSidebar,
    setCanvasState,
    setGeneralCanvasState,
    setTaskFiles,
    setSelectedFileId,
    setMentionedCharacters,
    setActiveTheme,
    setCreationMode,
  });

  const { switchTopic } = useWorkspaceTopicSwitch({
    projectId,
    externalProjectId,
    originalSwitchTopic,
    onBeforeTopicSwitch: deferSessionRecentMetadataSyncForNavigation,
    startTopicProjectResolution,
    finishTopicProjectResolution,
    deferTopicSwitch,
    consumePendingTopicSwitch,
    rememberProjectId,
    getRememberedProjectId,
    loadTopicBoundProjectId: (topicId) =>
      topicById.get(topicId)?.workspaceId ||
      loadPersistedSessionWorkspaceId(topicId) ||
      loadPersistedProjectId(`agent_session_workspace_${topicId}`),
    resetTopicLocalState,
  });
  const resolveInitialSessionSwitch = useCallback(
    (topicId: string) => {
      const topic = topicById.get(topicId);
      return {
        allowDetachedSession: true,
        forceRefresh: topic?.statusReason === "workspace_error",
        ...(shouldResumeTaskSession(topic)
          ? { resumeSessionStartHooks: true }
          : {}),
      };
    },
    [topicById],
  );
  useWorkspaceInitialSessionNavigation({
    initialSessionId,
    currentSessionId: sessionId,
    resolveInitialSessionSwitch,
    switchTopic,
  });
  const [taskCenterOpenTabMap, setTaskCenterOpenTabMap] =
    useState<TaskCenterWorkspaceTabMap>(() => {
      const initialTabMap = normalizeTaskCenterWorkspaceTabMap(
        loadPersisted<unknown>(TASK_CENTER_OPEN_TAB_IDS_STORAGE_KEY, []),
        {
          workspaceId: taskCenterWorkspaceId,
        },
      );

      if (
        agentEntry !== "claw" ||
        !taskCenterWorkspaceId ||
        !normalizedInitialSessionId
      ) {
        return initialTabMap;
      }

      return replaceTaskCenterTabIdsForWorkspace(
        initialTabMap,
        taskCenterWorkspaceId,
        normalizedInitialSessionId,
      );
    });
  const [taskCenterDetachedTopicId, setTaskCenterDetachedTopicId] = useState<
    string | null
  >(null);
  const [taskCenterTransitionTopicId, setTaskCenterTransitionTopicId] =
    useState<string | null>(null);
  const [
    taskCenterEmbeddedHomeSessionIds,
    setTaskCenterEmbeddedHomeSessionIds,
  ] = useState<Set<string>>(() => new Set());
  const [taskCenterDraftTabs, setTaskCenterDraftTabs] = useState<
    TaskCenterDraftTab[]
  >([]);
  const [activeTaskCenterDraftTabId, setActiveTaskCenterDraftTabId] = useState<
    string | null
  >(null);
  const [taskCenterDraftSendRequest, setTaskCenterDraftSendRequest] =
    useState<TaskCenterDraftSendRequest | null>(null);
  const [homePendingPreviewRequest, setHomePendingPreviewRequest] =
    useState<TaskCenterDraftSendRequest | null>(null);
  const taskCenterDraftTabsRef = useRef<TaskCenterDraftTab[]>([]);
  const activeTaskCenterDraftTabIdRef = useRef<string | null>(null);
  const taskCenterDraftMaterializePromisesRef = useRef<
    Map<string, Promise<string | null>>
  >(new Map());
  const homePendingPreviewPaintedRequestIdsRef = useRef<Set<string>>(new Set());
  const [taskCenterLocalSessionOverride, setTaskCenterLocalSessionOverride] =
    useState<{
      sessionId: string;
      routeSessionId: string | null;
    } | null>(null);
  const shouldRespectTaskCenterLocalSession = Boolean(
    taskCenterLocalSessionOverride &&
    (taskCenterLocalSessionOverride.routeSessionId ===
      normalizedInitialSessionId ||
      taskCenterLocalSessionOverride.sessionId ===
        normalizedInitialSessionId) &&
    (!sessionId ||
      taskCenterLocalSessionOverride.sessionId === sessionId ||
      taskCenterLocalSessionOverride.sessionId === normalizedInitialSessionId),
  );
  const taskCenterOpenTabIds = useMemo(
    () =>
      resolveTaskCenterTabIdsForWorkspace(
        taskCenterOpenTabMap,
        taskCenterWorkspaceId,
      ),
    [taskCenterOpenTabMap, taskCenterWorkspaceId],
  );
  const taskCenterOpenTabIdsRef = useRef(taskCenterOpenTabIds);
  const taskCenterFallbackRestoreRef = useRef<{
    topicId: string;
    startedAt: number;
  } | null>(null);
  const taskCenterRouteTabSyncRef = useRef<string | null>(null);

  useEffect(() => {
    taskCenterOpenTabIdsRef.current = taskCenterOpenTabIds;
  }, [taskCenterOpenTabIds]);

  useEffect(() => {
    taskCenterDraftTabsRef.current = taskCenterDraftTabs;
  }, [taskCenterDraftTabs]);

  useEffect(() => {
    activeTaskCenterDraftTabIdRef.current = activeTaskCenterDraftTabId;
  }, [activeTaskCenterDraftTabId]);

  useEffect(() => {
    if (agentEntry !== "claw") {
      setTaskCenterTransitionTopicId(null);
      return;
    }

    if (
      taskCenterTransitionTopicId &&
      taskCenterTransitionTopicId === sessionId
    ) {
      setTaskCenterTransitionTopicId(null);
    }
  }, [agentEntry, sessionId, taskCenterTransitionTopicId]);

  useEffect(() => {
    if (agentEntry !== "claw") {
      setTaskCenterDetachedTopicId(null);
      setTaskCenterEmbeddedHomeSessionIds((current) =>
        current.size > 0 ? new Set<string>() : current,
      );
      setTaskCenterDraftTabs((current) => (current.length > 0 ? [] : current));
      setActiveTaskCenterDraftTabId(null);
      if (agentEntry !== "new-task") {
        setTaskCenterDraftSendRequest(null);
        setHomePendingPreviewRequest(null);
        setTaskCenterLocalSessionOverride(null);
      }
      return;
    }

    if (!sessionId || sessionId !== normalizedInitialSessionId) {
      return;
    }

    const hasTopicMatch = topicById.has(sessionId);
    if (hasTopicMatch) {
      setTaskCenterDetachedTopicId((current) =>
        current === sessionId ? null : current,
      );
      return;
    }

    setTaskCenterDetachedTopicId((current) =>
      current === sessionId ? current : sessionId,
    );
  }, [agentEntry, normalizedInitialSessionId, sessionId, topicById]);

  useEffect(() => {
    if (
      agentEntry !== "claw" ||
      !taskCenterWorkspaceId ||
      !normalizedInitialSessionId
    ) {
      return;
    }

    const routeChanged =
      taskCenterRouteTabSyncRef.current !== normalizedInitialSessionId;
    taskCenterRouteTabSyncRef.current = normalizedInitialSessionId;
    if (routeChanged || shouldRespectTaskCenterLocalSession) {
      setActiveTaskCenterDraftTabId(null);
    }
    setTaskCenterOpenTabMap((currentMap) => {
      if (shouldRespectTaskCenterLocalSession) {
        return updateTaskCenterTabIdsForWorkspace(
          currentMap,
          taskCenterWorkspaceId,
          (currentIds) =>
            [
              normalizedInitialSessionId,
              ...currentIds.filter(
                (topicId) => topicId !== normalizedInitialSessionId,
              ),
            ].slice(0, MAX_TASK_CENTER_OPEN_TABS),
        );
      }

      return replaceTaskCenterTabIdsForWorkspace(
        currentMap,
        taskCenterWorkspaceId,
        normalizedInitialSessionId,
      );
    });
  }, [
    agentEntry,
    normalizedInitialSessionId,
    shouldRespectTaskCenterLocalSession,
    taskCenterWorkspaceId,
  ]);

  useEffect(() => {
    if (
      agentEntry !== "claw" ||
      !taskCenterWorkspaceId ||
      !normalizedInitialSessionId ||
      normalizedInitialSessionId === sessionId ||
      shouldRespectTaskCenterLocalSession
    ) {
      return;
    }

    setTaskCenterTransitionTopicId((current) =>
      current === normalizedInitialSessionId
        ? current
        : normalizedInitialSessionId,
    );
    setTaskCenterDetachedTopicId(null);
  }, [
    agentEntry,
    normalizedInitialSessionId,
    sessionId,
    shouldRespectTaskCenterLocalSession,
    taskCenterWorkspaceId,
  ]);

  useEffect(() => {
    if (agentEntry !== "claw" || !taskCenterWorkspaceId) {
      return;
    }

    const shouldWaitForInitialSessionTopic =
      normalizedInitialSessionId && !topicById.has(normalizedInitialSessionId);
    if (shouldWaitForInitialSessionTopic) {
      return;
    }

    setTaskCenterOpenTabMap((currentMap) => {
      const isInitialSessionRoutePending =
        Boolean(normalizedInitialSessionId) &&
        normalizedInitialSessionId !== sessionId &&
        !shouldRespectTaskCenterLocalSession;
      const effectiveCurrentTopicId =
        shouldRespectTaskCenterLocalSession &&
        taskCenterLocalSessionOverride?.sessionId === normalizedInitialSessionId
          ? normalizedInitialSessionId
          : (sessionId ?? null);
      const nextIds = reconcileTaskCenterTabIds({
        existingIds: resolveTaskCenterTabIdsForWorkspace(
          currentMap,
          taskCenterWorkspaceId,
        ),
        topics,
        currentTopicId: isInitialSessionRoutePending
          ? null
          : taskCenterDetachedTopicId === effectiveCurrentTopicId
            ? null
            : effectiveCurrentTopicId,
      });
      return updateTaskCenterTabIdsForWorkspace(
        currentMap,
        taskCenterWorkspaceId,
        nextIds,
      );
    });
  }, [
    agentEntry,
    sessionId,
    normalizedInitialSessionId,
    shouldRespectTaskCenterLocalSession,
    taskCenterLocalSessionOverride?.sessionId,
    taskCenterDetachedTopicId,
    taskCenterWorkspaceId,
    topicById,
    topics,
  ]);

  useEffect(() => {
    if (agentEntry !== "claw" && agentEntry !== "new-task") {
      return;
    }

    savePersisted(TASK_CENTER_OPEN_TAB_IDS_STORAGE_KEY, taskCenterOpenTabMap);
  }, [agentEntry, taskCenterOpenTabMap]);

  useTrayModelShortcuts({
    providerType,
    setProviderType,
    model,
    setModel,
    activeTheme: mappedTheme,
    deferInitialSync: false,
  });

  useWorkspaceCanvasMessageSyncRuntime({
    canvasState,
    isSpecializedThemeMode,
    isThemeWorkbench,
    mappedTheme,
    messages,
    processedMessageIdsRef: processedMessageIds,
    setCanvasState,
  });

  const submitImageWorkbenchAgentCommandRef = useRef<
    | ((params: SubmitImageWorkbenchAgentCommandParams) => Promise<boolean>)
    | null
  >(null);
  const imageWorkbenchActionRuntime = useWorkspaceImageWorkbenchActionRuntime({
    cancelImageTask: cancelMediaTaskArtifact,
    contentId,
    createImageGenerationTask: createImageGenerationTaskArtifact,
    getImageTask: getMediaTaskArtifact,
    currentImageWorkbenchState,
    imageWorkbenchPreferredModelId:
      effectiveImageWorkbenchPreference.preferredModelId,
    imageWorkbenchPreferredProviderId:
      effectiveImageWorkbenchPreference.preferredProviderId,
    imageWorkbenchPreferredProviderUnavailable:
      imageWorkbenchPreferredProviderUnavailable,
    imageWorkbenchSelectedModelId,
    imageWorkbenchSelectedProviderId,
    imageWorkbenchSelectedSize,
    imageWorkbenchSessionKey,
    projectId,
    projectRootPath: project?.rootPath || null,
    saveImageWorkbenchImagesToResource,
    submitImageWorkbenchAgentCommand: async (params) =>
      (await submitImageWorkbenchAgentCommandRef.current?.(params)) ?? false,
    setCanvasState,
    setInput,
    updateCurrentImageWorkbenchState,
  });
  const { handleImageWorkbenchCommand, resolveImageWorkbenchSkillRequest } =
    imageWorkbenchActionRuntime;
  const shouldPrepareFastResponseProviders =
    chatMode === "general" &&
    mappedTheme === "general" &&
    !isThemeWorkbench &&
    !contentId &&
    messages.length === 0 &&
    shouldUseAgentFastResponseSelection({
      providerType,
      model,
    });
  const { providers: fastResponseConfiguredProviders } = useConfiguredProviders(
    {
      autoLoad: shouldPrepareFastResponseProviders,
    },
  );

  const {
    handleSend,
    handleRecommendationClick,
    handleSendRef,
    webSearchPreferenceRef,
    isPreparingSend,
    displayMessages,
    teamDispatchPreviewState,
  } = useWorkspaceSendActions({
    input,
    setInput,
    mentionedCharacters,
    setMentionedCharacters,
    chatToolPreferences: effectiveChatToolPreferences,
    setChatToolPreferences,
    serviceSkills: activeTheme === "general" ? serviceSkills : [],
    activeTheme,
    mappedTheme,
    isThemeWorkbench,
    contextWorkspace: {
      enabled: contextWorkspace.generalWorkbenchEnabled,
      activeContextPrompt: contextWorkspace.activeContextPrompt,
      prepareActiveContextPrompt: contextWorkspace.prepareActiveContextPrompt,
    },
    projectId,
    sessionId,
    executionStrategy,
    accessMode,
    preferredTeamPresetId,
    selectedTeam,
    selectedTeamLabel,
    selectedTeamSummary,
    teamMemoryShadowSnapshot: resolvedTeamMemoryShadowSnapshot,
    currentGateKey: currentGate.key,
    themeWorkbenchActiveQueueTitle: themeWorkbenchActiveQueueItem?.title,
    contentId,
    browserAssistProfileKey: browserAssistRequestProfileKey,
    browserAssistPreferredBackend: browserAssistRequestPreferredBackend,
    browserAssistAutoLaunch: browserAssistRequestAutoLaunch,
    workspaceRequestMetadataBase: initialRequestMetadata,
    serviceModels,
    currentProviderType: providerType,
    currentModel: model,
    configuredProviders: fastResponseConfiguredProviders,
    messages,
    bootstrapDispatchPreview,
    sendMessage,
    resolveSendBoundary,
    finalizeAfterSendSuccess,
    rollbackAfterSendFailure,
    prepareRuntimeTeamBeforeSend,
    ensureBrowserAssistCanvas,
    handleAutoLaunchMatchedSiteSkill:
      workspaceServiceSkillEntryActions.handleAutoLaunchMatchedSiteSkill,
    openRuntimeSceneGate,
    ensureSessionForCommandMetadata: ensureSession,
    resolveImageWorkbenchSkillRequest,
  });
  useEffect(() => {
    sceneGateResumeHandlerRef.current = async ({ rawText, requestMetadata }) =>
      await handleSendRef.current(
        [],
        webSearchPreferenceRef.current,
        effectiveChatToolPreferences.thinking,
        rawText,
        undefined,
        undefined,
        {
          requestMetadata,
          skipSceneCommandRouting: true,
        },
      );
  }, [
    effectiveChatToolPreferences.thinking,
    handleSendRef,
    webSearchPreferenceRef,
  ]);
  const submitImageWorkbenchAgentCommand = useCallback(
    async (params: SubmitImageWorkbenchAgentCommandParams) =>
      await handleSendRef.current(
        params.images,
        webSearchPreferenceRef.current,
        effectiveChatToolPreferences.thinking,
        params.rawText,
        undefined,
        undefined,
        {
          displayContent: params.displayContent,
          requestMetadata: buildImageSkillLaunchRequestMetadata(
            undefined,
            params.requestContext,
          ),
        },
      ),
    [
      effectiveChatToolPreferences.thinking,
      handleSendRef,
      webSearchPreferenceRef,
    ],
  );
  submitImageWorkbenchAgentCommandRef.current =
    submitImageWorkbenchAgentCommand;

  const handleContinueGeneralWorkbenchEntryPrompt = useCallback(async () => {
    if (!generalWorkbenchEntryPrompt) {
      return;
    }

    const promptToSend =
      input.trim() || generalWorkbenchEntryPrompt.prompt.trim();
    if (!promptToSend) {
      toast.info("请先补充要继续执行的内容");
      return;
    }

    await handleSendRef.current(
      [],
      webSearchPreferenceRef.current,
      effectiveChatToolPreferences.thinking,
      promptToSend,
    );
  }, [
    effectiveChatToolPreferences.thinking,
    generalWorkbenchEntryPrompt,
    handleSendRef,
    input,
    webSearchPreferenceRef,
  ]);
  const applyWorkbenchFollowUpActionPayload = useCallback(
    (payload: GeneralWorkbenchFollowUpActionPayload) => {
      const normalizedPrompt = payload.prompt.trim();
      if (!normalizedPrompt) {
        return;
      }
      const nextBannerMessage = payload.bannerMessage?.trim() || null;
      setRuntimeEntryBannerMessage(nextBannerMessage);
      setEntryBannerVisible(Boolean(nextBannerMessage || entryBannerMessage));
      setInput(normalizedPrompt);
      const nextRuntimeInitialInputCapability =
        buildRuntimeInitialInputCapabilityFromFollowUpAction({
          payload,
          requestKey: Date.now(),
        });
      if (!nextRuntimeInitialInputCapability) {
        return;
      }
      setRuntimeInitialInputCapability(nextRuntimeInitialInputCapability);
    },
    [entryBannerMessage],
  );
  const handleRestartGeneralWorkbenchEntryPrompt = useCallback(() => {
    if (!generalWorkbenchEntryPrompt) {
      return;
    }

    dismissGeneralWorkbenchEntryPrompt({
      consumeInitialPrompt:
        generalWorkbenchEntryPrompt.kind === "initial_prompt",
      onConsumeInitialPrompt: () => {
        consumeInitialPrompt(initialDispatchKey);
      },
    });
    setInput("");
  }, [
    consumeInitialPrompt,
    dismissGeneralWorkbenchEntryPrompt,
    generalWorkbenchEntryPrompt,
    initialDispatchKey,
    setInput,
  ]);
  const {
    handleDocumentThinkingEnabledChange,
    handleDocumentAutoContinueRun,
    handleArtifactBlockRewriteRun,
    handleDocumentContentReviewRun,
    handleDocumentTextStylizeRun,
    handleSwitchBranchVersion,
    handleCreateVersionSnapshot,
    handleSetBranchStatus,
    handleAddImage,
    handleImportDocument,
  } = useWorkspaceCanvasWorkflowActions({
    thinkingEnabled: effectiveChatToolPreferences.thinking,
    setChatToolPreferences,
    sendRef: handleSendRef,
    webSearchPreferenceRef,
    setCanvasState,
    setTopicStatus,
    projectId,
    projectName: project?.name,
    canvasState,
    contentId,
    selectedText,
    onRunImageWorkbenchCommand: handleImageWorkbenchCommand,
  });
  const { handleInputbarA2UISubmit } = useWorkspaceA2UISubmitActions({
    handlePermissionResponse,
    pendingPromotedA2UIActionRequest,
    resolvePendingA2UISubmit,
    sendMessage,
  });
  const handlePendingA2UISubmit = useCallback(
    (formData: Parameters<typeof handleInputbarA2UISubmit>[0]) => {
      if (pendingServiceSkillLaunchForm) {
        void handlePendingServiceSkillLaunchSubmit(formData);
        return;
      }

      if (pendingSceneGateForm) {
        void handleSceneGateSubmit(formData);
        return;
      }

      handleInputbarA2UISubmit(formData);
    },
    [
      handleInputbarA2UISubmit,
      handleSceneGateSubmit,
      handlePendingServiceSkillLaunchSubmit,
      pendingSceneGateForm,
      pendingServiceSkillLaunchForm,
    ],
  );
  const handleMessageA2UISubmit = useCallback(
    (
      formData: Parameters<typeof handleInputbarA2UISubmit>[0],
      _messageId: string,
    ) => {
      handleInputbarA2UISubmit(formData);
    },
    [handleInputbarA2UISubmit],
  );

  // 监听工作区技能触发
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
  const latestAssistantMessageId = useMemo(
    () =>
      [...displayMessages]
        .reverse()
        .find((message) => message.role === "assistant")?.id ?? null,
    [displayMessages],
  );
  const activeTaskCenterDraftTab = useMemo(
    () =>
      activeTaskCenterDraftTabId
        ? (taskCenterDraftTabs.find(
            (tab) => tab.id === activeTaskCenterDraftTabId,
          ) ?? null)
        : null,
    [activeTaskCenterDraftTabId, taskCenterDraftTabs],
  );
  const isTaskCenterDraftTabActive = Boolean(
    agentEntry === "claw" && activeTaskCenterDraftTab,
  );
  const isTaskCenterDraftSendInFlight = Boolean(
    agentEntry === "claw" &&
    activeTaskCenterDraftTab &&
    (taskCenterDraftSendRequest?.draftTabId === activeTaskCenterDraftTab.id ||
      isPreparingSend ||
      isSending),
  );
  const shouldSuppressTaskCenterDraftContent =
    isTaskCenterDraftTabActive && !isTaskCenterDraftSendInFlight;
  const homePendingPreviewMessages = useMemo(
    () =>
      homePendingPreviewRequest &&
      !shouldSuppressTaskCenterDraftContent &&
      displayMessages.length === 0
        ? buildHomePendingPreviewMessages(
            homePendingPreviewRequest,
            executionStrategy,
          )
        : [],
    [
      displayMessages.length,
      executionStrategy,
      homePendingPreviewRequest,
      shouldSuppressTaskCenterDraftContent,
    ],
  );
  const isHomePendingPreviewActive = homePendingPreviewMessages.length > 0;

  // 布局层按实际展示内容判断，避免 bootstrap 预览等临时消息仍被视为空白态。
  const hasDisplayMessages =
    !shouldSuppressTaskCenterDraftContent &&
    (displayMessages.length > 0 || isHomePendingPreviewActive);
  useEffect(() => {
    if (
      !homePendingPreviewRequest ||
      homePendingPreviewMessages.length === 0 ||
      homePendingPreviewPaintedRequestIdsRef.current.has(
        homePendingPreviewRequest.id,
      )
    ) {
      return;
    }

    const request = homePendingPreviewRequest;
    homePendingPreviewPaintedRequestIdsRef.current.add(request.id);
    return scheduleAfterNextPaint(() => {
      recordAgentUiPerformanceMetric("homeInput.pendingPreviewPaint", {
        durationMs: Date.now() - request.submittedAt,
        requestId: request.id,
        sessionId: request.draftTabId,
        source: request.source,
        workspaceId: taskCenterWorkspaceId,
      });
    });
  }, [
    homePendingPreviewRequest,
    homePendingPreviewMessages.length,
    taskCenterWorkspaceId,
  ]);
  const hasMessages = hasDisplayMessages;
  const effectiveShowChatPanel =
    showChatPanel ||
    (agentEntry === "new-task" &&
      (hasDisplayMessages ||
        isThemeWorkbench ||
        (!shouldUseCompactGeneralWorkbench && isBootstrapDispatchPending) ||
        isSessionHydrating ||
        isHomePendingPreviewActive ||
        isSending ||
        queuedTurns.length > 0));
  const shouldRestoreImageTasksFromWorkspace = !(
    agentEntry === "new-task" &&
    !contentId &&
    !hasDisplayMessages &&
    !isSending &&
    queuedTurns.length === 0 &&
    !isBootstrapDispatchPending
  );

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

  const {
    handleToggleSidebar,
    handleToggleCanvas,
    handleCloseCanvas,
    resolvedCanvasState,
  } = useWorkspaceCanvasLayoutRuntime({
    activeTheme,
    isThemeWorkbench,
    hasPendingA2UIForm,
    layoutMode,
    showChatPanel: effectiveShowChatPanel,
    showSidebar,
    defaultTopicSidebarVisible,
    hasMessages,
    canvasWorkbenchLayoutMode,
    autoCollapsedTopicSidebarRef,
    mappedTheme,
    normalizedEntryTheme,
    shouldPreserveBlankHomeSurface,
    shouldBootstrapCanvasOnEntry,
    canvasState,
    generalCanvasState,
    teamWorkspaceEnabled: teamSessionRuntime.teamWorkspaceEnabled,
    hasCurrentCanvasArtifact: Boolean(currentCanvasArtifact),
    currentCanvasArtifactType: currentCanvasArtifact?.type,
    hasBrowserAssistArtifact,
    currentImageWorkbenchActive: currentImageWorkbenchState.active,
    onHasMessagesChange,
    dismissActiveTeamWorkbenchAutoOpen,
    suppressGeneralCanvasArtifactAutoOpen,
    suppressBrowserAssistCanvasAutoOpen,
    clearBrowserAssistCanvasArtifact,
    setShowSidebar,
    setLayoutMode,
    setGeneralCanvasState,
    setCanvasState,
    setCanvasWorkbenchLayoutMode,
  });

  useWorkspaceCanvasTaskFileSync({
    taskFiles,
    isThemeWorkbench,
    selectedFileId,
    canvasState,
    mappedTheme,
    documentEditorFocusedRef,
    setSelectedFileId,
    setCanvasState,
  });

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

  const upsertTaskCenterOpenTab = useCallback(
    (topicId: string, workspaceIdOverride?: string | null) => {
      const targetWorkspaceId =
        normalizeProjectId(workspaceIdOverride) ?? taskCenterWorkspaceId;
      if (!targetWorkspaceId) {
        return;
      }

      setTaskCenterOpenTabMap((currentMap) =>
        updateTaskCenterTabIdsForWorkspace(
          currentMap,
          targetWorkspaceId,
          (currentIds) =>
            [topicId, ...currentIds.filter((item) => item !== topicId)].slice(
              0,
              MAX_TASK_CENTER_OPEN_TABS,
            ),
        ),
      );
    },
    [taskCenterWorkspaceId],
  );

  const replaceTaskCenterOpenTabs = useCallback(
    (topicId: string, workspaceIdOverride?: string | null) => {
      const targetWorkspaceId =
        normalizeProjectId(workspaceIdOverride) ?? taskCenterWorkspaceId;
      if (!targetWorkspaceId) {
        return;
      }

      setTaskCenterOpenTabMap((currentMap) =>
        replaceTaskCenterTabIdsForWorkspace(
          currentMap,
          targetWorkspaceId,
          topicId,
        ),
      );
    },
    [taskCenterWorkspaceId],
  );

  const markTaskCenterEmbeddedHomeSession = useCallback((topicId: string) => {
    setTaskCenterEmbeddedHomeSessionIds((current) => {
      if (current.has(topicId)) {
        return current;
      }

      const next = new Set(current);
      next.add(topicId);
      return next;
    });
  }, []);

  const markTaskCenterLocalSessionOverride = useCallback(
    (topicId: string) => {
      setTaskCenterLocalSessionOverride({
        sessionId: topicId,
        routeSessionId: normalizedInitialSessionId,
      });
    },
    [normalizedInitialSessionId],
  );

  const clearTaskCenterEmbeddedHomeSession = useCallback((topicId: string) => {
    setTaskCenterEmbeddedHomeSessionIds((current) => {
      if (!current.has(topicId)) {
        return current;
      }

      const next = new Set(current);
      next.delete(topicId);
      return next;
    });
  }, []);

  const finalizeFreshTaskCenterConversation = useCallback(
    (
      newSessionId: string,
      workspaceIdOverride?: string | null,
      options?: { preserveInput?: boolean },
    ) => {
      resetTopicLocalState();
      if (options?.preserveInput !== true) {
        setInput("");
      }
      setSelectedText("");
      setMentionedCharacters([]);
      upsertTaskCenterOpenTab(newSessionId, workspaceIdOverride);
      markTaskCenterEmbeddedHomeSession(newSessionId);
      markTaskCenterLocalSessionOverride(newSessionId);
    },
    [
      markTaskCenterEmbeddedHomeSession,
      markTaskCenterLocalSessionOverride,
      resetTopicLocalState,
      setInput,
      setMentionedCharacters,
      setSelectedText,
      upsertTaskCenterOpenTab,
    ],
  );
  const openTaskCenterDraftTab = useCallback(() => {
    const now = new Date();
    const draftTab: TaskCenterDraftTab = {
      id: createTaskCenterDraftTabId(),
      title: "新对话",
      createdAt: now,
      updatedAt: now,
      status: "draft",
    };

    startTransition(() => {
      setTaskCenterTransitionTopicId(null);
      setTaskCenterDetachedTopicId(null);
      setActiveTaskCenterDraftTabId(draftTab.id);
      setTaskCenterDraftSendRequest(null);
      setHomePendingPreviewRequest(null);
      setTaskCenterDraftTabs((current) =>
        [draftTab, ...current.filter((item) => item.id !== draftTab.id)].slice(
          0,
          MAX_TASK_CENTER_OPEN_TABS,
        ),
      );
      resetTopicLocalState();
      setInput("");
      setSelectedText("");
      setMentionedCharacters([]);
    });

    logAgentDebug("AgentChatPage", "taskCenter.draftTab.open", {
      draftTabId: draftTab.id,
      workspaceId: taskCenterWorkspaceId,
    });

    return draftTab.id;
  }, [
    resetTopicLocalState,
    setInput,
    setMentionedCharacters,
    setSelectedText,
    taskCenterWorkspaceId,
  ]);
  const materializeTaskCenterDraftTab = useCallback(
    async (
      draftTabId: string,
      options?: { reason?: "send" | "input_warmup" },
    ): Promise<string | null> => {
      const reason = options?.reason ?? "send";
      const existingPromise =
        taskCenterDraftMaterializePromisesRef.current.get(draftTabId);
      if (existingPromise) {
        logAgentDebug(
          "AgentChatPage",
          "taskCenter.draftTab.materialize.reuse",
          {
            draftTabId,
            reason,
            workspaceId: taskCenterWorkspaceId,
          },
        );
        return existingPromise;
      }

      const draftExists = taskCenterDraftTabsRef.current.some(
        (tab) => tab.id === draftTabId,
      );
      if (!draftExists) {
        return null;
      }

      const startedAt = Date.now();
      logAgentDebug("AgentChatPage", "taskCenter.draftTab.materialize.start", {
        draftTabId,
        reason,
        workspaceId: taskCenterWorkspaceId,
      });
      recordAgentUiPerformanceMetric("taskCenter.draftMaterialize.start", {
        sessionId: draftTabId,
        reason,
        workspaceId: taskCenterWorkspaceId,
      });

      const materializePromise = (async () => {
        const newSessionId = await createFreshSession("新对话", {
          preserveCurrentSnapshot: true,
        });
        if (!newSessionId) {
          setTaskCenterDraftTabs((current) =>
            current.map((tab) =>
              tab.id === draftTabId
                ? { ...tab, status: "failed", updatedAt: new Date() }
                : tab,
            ),
          );
          recordAgentUiPerformanceMetric("taskCenter.draftMaterialize.error", {
            durationMs: Date.now() - startedAt,
            reason,
            sessionId: draftTabId,
            workspaceId: taskCenterWorkspaceId,
          });
          return null;
        }

        startTransition(() => {
          setTaskCenterDraftTabs((current) =>
            current.filter((tab) => tab.id !== draftTabId),
          );
          setActiveTaskCenterDraftTabId((current) =>
            current === draftTabId ? null : current,
          );
          finalizeFreshTaskCenterConversation(
            newSessionId,
            taskCenterWorkspaceId,
            { preserveInput: true },
          );
        });

        logAgentDebug("AgentChatPage", "taskCenter.draftTab.materialize.done", {
          draftTabId,
          durationMs: Date.now() - startedAt,
          newSessionId,
          reason,
          workspaceId: taskCenterWorkspaceId,
        });
        recordAgentUiPerformanceMetric("taskCenter.draftMaterialize.success", {
          durationMs: Date.now() - startedAt,
          materializedSessionId: newSessionId,
          reason,
          sessionId: draftTabId,
          workspaceId: taskCenterWorkspaceId,
        });
        return newSessionId;
      })();

      const trackedPromise = materializePromise.finally(() => {
        if (
          taskCenterDraftMaterializePromisesRef.current.get(draftTabId) ===
          trackedPromise
        ) {
          taskCenterDraftMaterializePromisesRef.current.delete(draftTabId);
        }
      });
      taskCenterDraftMaterializePromisesRef.current.set(
        draftTabId,
        trackedPromise,
      );
      return trackedPromise;
    },
    [
      createFreshSession,
      finalizeFreshTaskCenterConversation,
      taskCenterWorkspaceId,
    ],
  );

  const activeTaskCenterDraftTabIdForWarmup =
    activeTaskCenterDraftTab?.id ?? null;

  useEffect(() => {
    const draftTabId = activeTaskCenterDraftTabIdForWarmup;
    if (
      agentEntry !== "claw" ||
      !draftTabId ||
      !input.trim() ||
      isPreparingSend ||
      isSending
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      logAgentDebug("AgentChatPage", "taskCenter.draftTab.warmup.request", {
        draftTabId,
        inputLength: input.trim().length,
        workspaceId: taskCenterWorkspaceId,
      });
      void materializeTaskCenterDraftTab(draftTabId, {
        reason: "input_warmup",
      }).catch((error) => {
        logAgentDebug(
          "AgentChatPage",
          "taskCenter.draftTab.warmup.error",
          {
            draftTabId,
            error,
            workspaceId: taskCenterWorkspaceId,
          },
          { level: "error" },
        );
      });
    }, TASK_CENTER_DRAFT_SESSION_WARMUP_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeTaskCenterDraftTabIdForWarmup,
    agentEntry,
    input,
    isPreparingSend,
    isSending,
    materializeTaskCenterDraftTab,
    taskCenterWorkspaceId,
  ]);

  const handleOpenTaskTopic = useCallback(
    async (
      topicId: string,
      options?: {
        preferResume?: boolean;
        forceRefresh?: boolean;
        replaceOpenTabs?: boolean;
      },
    ) => {
      const topic = topicById.get(topicId);
      const topicWorkspaceId = normalizeProjectId(
        topic?.workspaceId ??
          loadPersistedSessionWorkspaceId(topicId) ??
          taskCenterWorkspaceId,
      );
      const shouldResume =
        options?.preferResume === true || shouldResumeTaskSession(topic);
      const switchOptions =
        shouldResume || options?.forceRefresh === true
          ? {
              ...(options?.forceRefresh === true ? { forceRefresh: true } : {}),
              ...(shouldResume ? { resumeSessionStartHooks: true } : {}),
            }
          : undefined;
      const wasOpenInTaskCenter =
        taskCenterOpenTabIdsRef.current.includes(topicId);
      const shouldMaintainTaskCenterTab =
        agentEntry === "claw" || agentEntry === "new-task";
      const rollbackPendingOpen = () => {
        if (!wasOpenInTaskCenter && options?.replaceOpenTabs !== true) {
          setTaskCenterOpenTabMap((currentMap) =>
            updateTaskCenterTabIdsForWorkspace(
              currentMap,
              topicWorkspaceId,
              (currentIds) =>
                currentIds.filter((currentId) => currentId !== topicId),
            ),
          );
        }
        setTaskCenterLocalSessionOverride((current) =>
          current?.sessionId === topicId ? null : current,
        );
        setTaskCenterTransitionTopicId((current) =>
          current === topicId ? null : current,
        );
      };

      setTaskCenterTransitionTopicId(topicId);
      setTaskCenterDetachedTopicId(null);
      setActiveTaskCenterDraftTabId(null);
      if (options?.replaceOpenTabs === true) {
        replaceTaskCenterOpenTabs(topicId, topicWorkspaceId);
      } else if (shouldMaintainTaskCenterTab) {
        upsertTaskCenterOpenTab(topicId, topicWorkspaceId);
      }
      markTaskCenterLocalSessionOverride(topicId);
      rememberInitialSessionNavigationStart(topicId);
      const switchResult = await switchTopic(topicId, switchOptions);
      if (switchResult === "busy") {
        scheduleMinimumDelayIdleTask(
          () => {
            void switchTopic(topicId, switchOptions)
              .then((retryResult) => {
                if (retryResult !== "success" && retryResult !== "deferred") {
                  rollbackPendingOpen();
                }
              })
              .catch(() => {
                rollbackPendingOpen();
              });
          },
          {
            minimumDelayMs: 120,
            idleTimeoutMs: 600,
          },
        );
        return;
      }
      if (switchResult !== "success" && switchResult !== "deferred") {
        rollbackPendingOpen();
        return;
      }
      if (options?.replaceOpenTabs === true) {
        replaceTaskCenterOpenTabs(topicId, topicWorkspaceId);
      } else {
        if (shouldMaintainTaskCenterTab) {
          upsertTaskCenterOpenTab(topicId, topicWorkspaceId);
        }
      }
    },
    [
      agentEntry,
      markTaskCenterLocalSessionOverride,
      replaceTaskCenterOpenTabs,
      setActiveTaskCenterDraftTabId,
      switchTopic,
      taskCenterWorkspaceId,
      setTaskCenterDetachedTopicId,
      setTaskCenterTransitionTopicId,
      topicById,
      upsertTaskCenterOpenTab,
    ],
  );

  const handleOpenArchivedTaskTopic = useCallback(
    async (topicId: string) => {
      setActiveTaskCenterDraftTabId(null);
      setTaskCenterDetachedTopicId(topicId);
      setTaskCenterTransitionTopicId(topicId);
      markTaskCenterLocalSessionOverride(topicId);
      rememberInitialSessionNavigationStart(topicId);
      const switchResult = await switchTopic(topicId, {
        allowDetachedSession: true,
      });
      if (switchResult === "success" || switchResult === "deferred") {
        return;
      }

      setTaskCenterLocalSessionOverride((current) =>
        current?.sessionId === topicId ? null : current,
      );
      setTaskCenterTransitionTopicId((current) =>
        current === topicId ? null : current,
      );
      setTaskCenterDetachedTopicId((current) =>
        current === topicId ? null : current,
      );
    },
    [markTaskCenterLocalSessionOverride, switchTopic],
  );

  const handleSelectTaskCenterDraftTab = useCallback(
    (draftTabId: string) => {
      const draft = taskCenterDraftTabsRef.current.find(
        (tab) => tab.id === draftTabId,
      );
      if (!draft) {
        return;
      }

      startTransition(() => {
        setTaskCenterTransitionTopicId(null);
        setTaskCenterDetachedTopicId(null);
        setActiveTaskCenterDraftTabId(draftTabId);
        setTaskCenterDraftSendRequest(null);
        setHomePendingPreviewRequest(null);
        resetTopicLocalState();
        setInput("");
        setSelectedText("");
        setMentionedCharacters([]);
      });
    },
    [resetTopicLocalState, setInput, setMentionedCharacters, setSelectedText],
  );

  const handleSwitchTaskTopic = useCallback(
    async (topicId: string) => {
      if (isTaskCenterDraftTabId(topicId)) {
        handleSelectTaskCenterDraftTab(topicId);
        return;
      }

      await handleOpenTaskTopic(topicId);
    },
    [handleOpenTaskTopic, handleSelectTaskCenterDraftTab],
  );

  const handleOpenSidebarTaskTopic = useCallback(
    async (topicId: string) => {
      await handleOpenTaskTopic(topicId);
    },
    [handleOpenTaskTopic],
  );

  const handleResumeSidebarTask = useCallback(
    async (topicId: string, statusReason?: TaskStatusReason) => {
      await handleOpenTaskTopic(topicId, {
        preferResume: true,
        forceRefresh: statusReason === "workspace_error",
      });
    },
    [handleOpenTaskTopic],
  );

  const recentSessionTopic = useMemo(
    () => resolveRecentTopicCandidate(topics, sessionId),
    [sessionId, topics],
  );
  const recentSessionActionLabel = useMemo(
    () =>
      recentSessionTopic
        ? resolveRecentTopicActionLabel(recentSessionTopic)
        : "继续最近会话",
    [recentSessionTopic],
  );
  const handleResumeRecentSession = useCallback(() => {
    if (!recentSessionTopic) {
      return;
    }

    void handleOpenTaskTopic(recentSessionTopic.id, {
      preferResume: true,
      forceRefresh: recentSessionTopic.statusReason === "workspace_error",
    });
  }, [handleOpenTaskTopic, recentSessionTopic]);
  const handleCloseTaskCenterTab = useCallback(
    async (topicId: string) => {
      if (isTaskCenterDraftTabId(topicId)) {
        const remainingDraftTabs = taskCenterDraftTabsRef.current.filter(
          (tab) => tab.id !== topicId,
        );
        setTaskCenterDraftTabs(remainingDraftTabs);
        if (activeTaskCenterDraftTabIdRef.current === topicId) {
          const fallbackDraftId = remainingDraftTabs[0]?.id ?? null;
          if (fallbackDraftId) {
            handleSelectTaskCenterDraftTab(fallbackDraftId);
            return;
          }

          setActiveTaskCenterDraftTabId(null);
          setInput("");
          const fallbackTopicId = taskCenterOpenTabIdsRef.current[0] ?? null;
          if (fallbackTopicId) {
            await handleSwitchTaskTopic(fallbackTopicId);
          }
        }
        return;
      }

      const currentIds = taskCenterOpenTabIdsRef.current;
      const currentIndex = currentIds.indexOf(topicId);
      const remainingIds = currentIds.filter((item) => item !== topicId);
      const isActiveTab = sessionId === topicId;

      if (taskCenterDetachedTopicId === topicId) {
        setTaskCenterDetachedTopicId(null);
      }
      if (taskCenterTransitionTopicId === topicId) {
        setTaskCenterTransitionTopicId(null);
      }
      clearTaskCenterEmbeddedHomeSession(topicId);

      setTaskCenterOpenTabMap((currentMap) =>
        updateTaskCenterTabIdsForWorkspace(
          currentMap,
          taskCenterWorkspaceId,
          remainingIds,
        ),
      );

      if (isActiveTab) {
        const fallbackId =
          remainingIds[currentIndex] ??
          remainingIds[currentIndex - 1] ??
          remainingIds[0] ??
          null;

        if (fallbackId) {
          await handleSwitchTaskTopic(fallbackId);
        } else {
          openTaskCenterDraftTab();
        }
      }
    },
    [
      clearTaskCenterEmbeddedHomeSession,
      handleSelectTaskCenterDraftTab,
      handleSwitchTaskTopic,
      openTaskCenterDraftTab,
      sessionId,
      setInput,
      taskCenterDetachedTopicId,
      taskCenterTransitionTopicId,
      taskCenterWorkspaceId,
    ],
  );
  const handleOpenTaskCenterNewTaskPage = useCallback(() => {
    if (agentEntry !== "claw") {
      handleBackHome?.();
      return;
    }

    openTaskCenterDraftTab();
  }, [agentEntry, handleBackHome, openTaskCenterDraftTab]);
  useEffect(() => {
    if (agentEntry !== "claw") {
      return;
    }

    return subscribeTaskCenterDraftTaskRequests(() => {
      handleOpenTaskCenterNewTaskPage();
    });
  }, [agentEntry, handleOpenTaskCenterNewTaskPage]);
  useEffect(() => {
    return subscribeTaskCenterTaskPrefetchRequests(
      ({ sessionId: requestedSessionId, workspaceId }) => {
        const requestedWorkspaceId = normalizeProjectId(workspaceId);
        if (
          requestedWorkspaceId &&
          taskCenterWorkspaceId &&
          requestedWorkspaceId !== normalizeProjectId(taskCenterWorkspaceId)
        ) {
          return;
        }

        void prefetchTopic(requestedSessionId);
      },
    );
  }, [prefetchTopic, taskCenterWorkspaceId]);

  useEffect(() => {
    if (agentEntry !== "claw" && agentEntry !== "new-task") {
      return;
    }

    return subscribeTaskCenterTaskOpenRequests(
      ({ sessionId: requestedSessionId, workspaceId }) => {
        const requestedWorkspaceId = normalizeProjectId(workspaceId);
        if (
          requestedWorkspaceId &&
          requestedWorkspaceId !== normalizeProjectId(taskCenterWorkspaceId)
        ) {
          setTaskCenterTransitionTopicId(requestedSessionId);
          setTaskCenterDetachedTopicId(null);
          setActiveTaskCenterDraftTabId(null);
          markTaskCenterLocalSessionOverride(requestedSessionId);
          upsertTaskCenterOpenTab(requestedSessionId, requestedWorkspaceId);
          deferTopicSwitch(requestedSessionId, requestedWorkspaceId);
          return;
        }

        void handleOpenTaskTopic(requestedSessionId);
      },
    );
  }, [
    agentEntry,
    deferTopicSwitch,
    handleOpenTaskTopic,
    markTaskCenterLocalSessionOverride,
    taskCenterWorkspaceId,
    upsertTaskCenterOpenTab,
  ]);
  const taskCenterPreviewTopicId = useMemo(
    () =>
      resolveTaskCenterPreviewTopicId({
        sessionId,
        detachedTopicId: taskCenterDetachedTopicId,
        switchingTopicId: taskCenterTransitionTopicId,
      }),
    [sessionId, taskCenterDetachedTopicId, taskCenterTransitionTopicId],
  );
  const taskCenterSessionSwitchPending = useMemo(
    () =>
      isTaskCenterTopicSwitchPending({
        sessionId,
        switchingTopicId: taskCenterTransitionTopicId,
      }),
    [sessionId, taskCenterTransitionTopicId],
  );
  const hasHomeConversationActivity =
    !shouldSuppressTaskCenterDraftContent &&
    (hasDisplayMessages ||
      hasPendingA2UIForm ||
      isPreparingSend ||
      isSending ||
      Boolean(taskCenterDraftSendRequest) ||
      isHomePendingPreviewActive ||
      queuedTurns.length > 0);
  const shouldRenderTaskCenterEmbeddedHome = Boolean(
    agentEntry === "claw" &&
    !taskCenterSessionSwitchPending &&
    !hasHomeConversationActivity &&
    (isTaskCenterDraftTabActive ||
      (sessionId && taskCenterEmbeddedHomeSessionIds.has(sessionId))),
  );
  useEffect(() => {
    if (!sessionId || !taskCenterEmbeddedHomeSessionIds.has(sessionId)) {
      return;
    }

    if (hasHomeConversationActivity) {
      clearTaskCenterEmbeddedHomeSession(sessionId);
    }
  }, [
    clearTaskCenterEmbeddedHomeSession,
    hasHomeConversationActivity,
    sessionId,
    taskCenterEmbeddedHomeSessionIds,
  ]);
  const suppressHomeNavbarUtilityActions =
    (shouldUseBrowserWorkspaceHomeChrome && !hasHomeConversationActivity) ||
    shouldRenderTaskCenterEmbeddedHome;

  useEffect(() => {
    if (!suppressHomeNavbarUtilityActions || !harnessPanelVisible) {
      return;
    }

    setHarnessPanelVisible(false);
  }, [
    harnessPanelVisible,
    setHarnessPanelVisible,
    suppressHomeNavbarUtilityActions,
  ]);
  const shouldHideDetachedTaskCenterTabs = useMemo(
    () =>
      shouldHideTaskCenterTabsForDetachedSession({
        sessionId,
        initialSessionId: normalizedInitialSessionId,
        detachedTopicId: taskCenterDetachedTopicId,
        openTabIds: taskCenterOpenTabIds,
      }),
    [
      normalizedInitialSessionId,
      sessionId,
      taskCenterDetachedTopicId,
      taskCenterOpenTabIds,
    ],
  );
  const taskCenterVisibleTabIds = useMemo(
    () =>
      shouldHideDetachedTaskCenterTabs
        ? []
        : resolveTaskCenterVisibleTabIds({
            openTabIds: taskCenterOpenTabIds,
            topics,
            currentTopicId: taskCenterPreviewTopicId,
          }),
    [
      shouldHideDetachedTaskCenterTabs,
      taskCenterOpenTabIds,
      taskCenterPreviewTopicId,
      topics,
    ],
  );
  const taskCenterTabItems = useMemo<TaskCenterTabItem[]>(() => {
    const draftItems = taskCenterDraftTabs.map((draft) => ({
      id: draft.id,
      title: draft.title,
      status: draft.status,
      updatedAt: draft.updatedAt,
      isActive: draft.id === activeTaskCenterDraftTabId,
      hasUnread: false,
      isPinned: false,
    }));
    const topicItems = taskCenterVisibleTabIds
      .map((topicId) => topicById.get(topicId))
      .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic))
      .map((topic) => ({
        id: topic.id,
        title: resolveInternalImageTaskDisplayName(topic.title) || "未命名任务",
        status: topic.status ?? "done",
        updatedAt:
          topic.updatedAt instanceof Date
            ? topic.updatedAt
            : new Date(topic.updatedAt ?? topic.createdAt ?? Date.now()),
        isActive:
          !isTaskCenterDraftTabActive &&
          topic.id === (taskCenterPreviewTopicId ?? sessionId),
        hasUnread: Boolean(topic.hasUnread),
        isPinned: Boolean(topic.isPinned),
      }));

    return [...draftItems, ...topicItems].slice(0, MAX_TASK_CENTER_OPEN_TABS);
  }, [
    activeTaskCenterDraftTabId,
    isTaskCenterDraftTabActive,
    sessionId,
    taskCenterDraftTabs,
    taskCenterPreviewTopicId,
    taskCenterVisibleTabIds,
    topicById,
  ]);
  const shouldRenderTaskCenterTabStrip =
    agentEntry === "claw" ||
    (agentEntry === "new-task" &&
      taskCenterLocalSessionOverride !== null &&
      taskCenterTabItems.length > 0);
  useEffect(() => {
    if (
      agentEntry !== "claw" ||
      !taskCenterWorkspaceId ||
      isAutoRestoringSession ||
      isSessionHydrating
    ) {
      return;
    }

    if (shouldHideDetachedTaskCenterTabs) {
      logAgentDebug(
        "AgentChatPage",
        "taskCenter.fallback.skipDetachedSession",
        {
          detachedTopicId: taskCenterDetachedTopicId,
          initialSessionId: normalizedInitialSessionId,
          openTabIds: taskCenterOpenTabIds,
          sessionId,
          visibleTabIds: taskCenterVisibleTabIds,
        },
        {
          dedupeKey: `taskCenter.fallback.skipDetached:${sessionId ?? "none"}:${taskCenterDetachedTopicId ?? "none"}`,
          throttleMs: 1000,
        },
      );
      return;
    }

    const currentSessionIsKnownTopic = Boolean(
      sessionId && topicById.has(sessionId),
    );
    if (
      !normalizedInitialSessionId &&
      sessionId &&
      !currentSessionIsKnownTopic &&
      hasDisplayMessages
    ) {
      return;
    }

    const fallbackId = resolveTaskCenterFallbackTopicId({
      sessionId,
      switchingTopicId: taskCenterTransitionTopicId,
      openTabIds: taskCenterOpenTabIds,
      topics,
    });
    if (!fallbackId) {
      return;
    }

    const now = Date.now();
    const previousRestore = taskCenterFallbackRestoreRef.current;
    if (
      previousRestore?.topicId === fallbackId &&
      now - previousRestore.startedAt < 2_000
    ) {
      return;
    }
    taskCenterFallbackRestoreRef.current = {
      topicId: fallbackId,
      startedAt: now,
    };
    logAgentDebug("AgentChatPage", "taskCenter.fallback.restoreVisibleTask", {
      fallbackId,
      openTabIds: taskCenterOpenTabIds,
      sessionId,
      transitionTopicId: taskCenterTransitionTopicId,
      visibleTabIds: taskCenterVisibleTabIds,
    });

    void handleOpenTaskTopic(fallbackId);
  }, [
    agentEntry,
    handleOpenTaskTopic,
    hasDisplayMessages,
    isAutoRestoringSession,
    isSessionHydrating,
    normalizedInitialSessionId,
    sessionId,
    shouldHideDetachedTaskCenterTabs,
    taskCenterDetachedTopicId,
    taskCenterOpenTabIds,
    taskCenterTransitionTopicId,
    taskCenterVisibleTabIds,
    taskCenterWorkspaceId,
    topicById,
    topics,
  ]);
  const taskCenterTabsNode = useMemo(() => {
    if (!shouldRenderTaskCenterTabStrip) {
      return null;
    }

    return (
      <TaskCenterTabStrip
        items={taskCenterTabItems}
        onSelectTask={(topicId) => {
          void handleSwitchTaskTopic(topicId);
        }}
        onCloseTask={(topicId) => {
          void handleCloseTaskCenterTab(topicId);
        }}
        onCreateTask={() => {
          handleOpenTaskCenterNewTaskPage();
        }}
        showWorkbenchToggle={!isThemeWorkbench}
        workbenchVisible={layoutMode !== "chat"}
        onWorkbenchToggle={handleToggleCanvas}
      />
    );
  }, [
    handleCloseTaskCenterTab,
    handleOpenTaskCenterNewTaskPage,
    handleToggleCanvas,
    handleSwitchTaskTopic,
    isThemeWorkbench,
    layoutMode,
    shouldRenderTaskCenterTabStrip,
    taskCenterTabItems,
  ]);
  const browserWorkspaceHomeTabsNode = useMemo(() => {
    if (!shouldUseBrowserWorkspaceHomeChrome) {
      return null;
    }

    const homeTab: TaskCenterTabItem = {
      id: "new-task-home",
      title: "新对话",
      status: "draft",
      updatedAt: new Date(newChatAt ?? pageMountedAtRef.current),
      isActive: true,
      hasUnread: false,
      isPinned: false,
      closable: false,
    };

    return (
      <TaskCenterTabStrip
        items={[homeTab]}
        onSelectTask={() => undefined}
        onCloseTask={() => undefined}
        onCreateTask={() => {
          handleBackHome();
        }}
      />
    );
  }, [handleBackHome, newChatAt, shouldUseBrowserWorkspaceHomeChrome]);
  const handleOpenTaskCenterSkillsPage = useCallback(() => {
    if (!_onNavigate) {
      return;
    }

    _onNavigate(
      "skills",
      projectId
        ? {
            creationProjectId: projectId,
          }
        : undefined,
    );
  }, [_onNavigate, projectId]);
  const handleOpenTaskCenterKnowledgePage = useCallback(() => {
    _onNavigate?.(
      "knowledge",
      project?.rootPath
        ? {
            workingDir: project.rootPath,
          }
        : undefined,
    );
  }, [_onNavigate, project?.rootPath]);
  const handleOpenTaskCenterMemoryPage = useCallback(() => {
    _onNavigate?.("memory");
  }, [_onNavigate]);

  const handleWriteFile = useWorkspaceWriteFileAction({
    activeTheme,
    artifacts,
    contentId,
    currentGateKey: currentGate.key,
    currentStepIndex,
    isSpecializedThemeMode,
    isThemeWorkbench,
    mappedTheme,
    projectId,
    sessionId,
    themeWorkbenchActiveQueueItem,
    taskFilesRef,
    socialStageLogRef,
    setDocumentVersionStatusMap,
    saveSessionFile: async (fileName, content, metadata) => {
      await saveSessionFile(fileName, content, metadata);
    },
    syncGeneralArtifactToResource,
    upsertGeneralArtifact,
    setSelectedArtifactId,
    setArtifactViewMode: applyAutoArtifactViewMode,
    setLayoutMode,
    suppressCanvasAutoOpen: suppressCanvasAutoOpenForPendingA2UI,
    completeStep,
    setTaskFiles,
    setSelectedFileId,
    setCanvasState,
  });

  // 更新 ref，供统一聊天主链 Hook 使用
  useEffect(() => {
    handleWriteFileRef.current = handleWriteFile;
  }, [handleWriteFile]);

  const handleSaveArtifactDocument = useCallback(
    async (artifact: Artifact, document: ArtifactDocumentV1) => {
      const filePath = resolveArtifactProtocolFilePath(artifact);
      const serializedDocument = JSON.stringify(document, null, 2);

      await Promise.resolve(
        handleWriteFile(serializedDocument, filePath, {
          artifactId: artifact.id,
          source: "message_content",
          status: "complete",
          artifact: {
            ...artifact,
            content: serializedDocument,
            status: "complete",
            meta: {
              ...artifact.meta,
              artifactDocument: document,
              language: "json",
              filePath:
                typeof artifact.meta.filePath === "string" &&
                artifact.meta.filePath.trim()
                  ? artifact.meta.filePath
                  : filePath,
              filename:
                typeof artifact.meta.filename === "string" &&
                artifact.meta.filename.trim()
                  ? artifact.meta.filename
                  : artifact.title,
            },
            updatedAt: Date.now(),
          },
          metadata: {
            writePhase: "persisted",
            previewText: document.summary || document.title,
            lastUpdateSource: "message_content",
          },
        }),
      );
    },
    [handleWriteFile],
  );
  const { renderToolbarActions: renderArtifactWorkbenchToolbarActions } =
    useWorkspaceArtifactWorkbenchActions({
      activeTheme,
      projectId,
      syncGeneralArtifactToResource,
      onSaveArtifactDocument: handleSaveArtifactDocument,
    });

  const {
    handleHarnessLoadFilePreview,
    handleArtifactClick,
    handleFileClick,
    handleCodeBlockClick,
    shouldCollapseCodeBlocks,
    shouldCollapseCodeBlockInChat,
    handleTaskFileClick,
  } = useWorkspaceArtifactPreviewActions({
    activeTheme,
    mappedTheme,
    layoutMode,
    isThemeWorkbench,
    isGeneralCanvasOpen: generalCanvasState.isOpen,
    artifacts,
    currentCanvasArtifact,
    taskFiles,
    sessionFiles,
    readSessionFile,
    suppressBrowserAssistCanvasAutoOpen,
    onOpenBrowserRuntimeForArtifact: handleOpenBrowserRuntimeForBrowserAssist,
    upsertGeneralArtifact,
    setSelectedArtifactId,
    setArtifactViewMode: applyAutoArtifactViewMode,
    setLayoutMode,
    setTaskFiles,
    setSelectedFileId,
    setGeneralCanvasState,
    setCanvasState,
  });
  const handleWorkspaceFileClick = useCallback(
    (fileName: string, content: string) => {
      setFocusedArtifactBlockId(null);
      handleFileClick(fileName, content);
    },
    [handleFileClick],
  );
  const openProjectFilePreviewInCanvas = useCallback(
    async ({
      relativePath,
      absolutePath,
      isCancelled,
    }: {
      relativePath?: string | null;
      absolutePath: string;
      isCancelled?: () => boolean;
    }) => {
      const preview = await handleHarnessLoadFilePreview(absolutePath);
      if (isCancelled?.()) {
        return false;
      }

      if (preview.error) {
        toast.error(`打开导出文件失败: ${preview.error}`);
        return false;
      }

      if (preview.isBinary) {
        toast.info("导出文件是二进制格式，暂不支持在工作台预览");
        return false;
      }

      const nextContent =
        typeof preview.content === "string" ? preview.content : "";
      const nextFilePath = relativePath?.trim() || preview.path || absolutePath;
      startTransition(() => {
        handleWorkspaceFileClick(nextFilePath, nextContent);
      });
      return true;
    },
    [handleHarnessLoadFilePreview, handleWorkspaceFileClick],
  );
  const handleOpenSavedSiteContent = useCallback(
    async ({
      projectId: targetProjectId,
      contentId: targetContentId,
      preferredTarget,
      projectFile,
    }: SiteSavedContentTarget) => {
      const relativePath = projectFile?.relativePath?.trim() || "";
      const canOpenInlineInCurrentWorkspace =
        preferredTarget === "project_file" &&
        Boolean(relativePath) &&
        Boolean(project?.rootPath) &&
        Boolean(projectId) &&
        targetProjectId === projectId;

      if (canOpenInlineInCurrentWorkspace) {
        const absolutePath = resolveAbsoluteWorkspacePath(
          project?.rootPath,
          relativePath,
        );
        if (absolutePath) {
          const opened = await openProjectFilePreviewInCanvas({
            relativePath,
            absolutePath,
          });
          if (opened) {
            return;
          }
        }
      }

      _onNavigate?.("agent", {
        projectId: targetProjectId,
        contentId: targetContentId,
        lockTheme: true,
        fromResources: true,
        ...(preferredTarget === "project_file" && relativePath
          ? {
              initialProjectFileOpenTarget: {
                relativePath,
                requestKey: Date.now(),
              },
            }
          : {}),
      });
    },
    [_onNavigate, openProjectFilePreviewInCanvas, project?.rootPath, projectId],
  );
  const handleWorkspaceArtifactClick = useCallback(
    (artifact: Artifact) => {
      setFocusedArtifactBlockId(null);
      handleArtifactClick(artifact);
    },
    [handleArtifactClick],
  );
  const handleOpenMessagePreview = useCallback(
    (target: MessagePreviewTarget, message: Message) => {
      if (target.kind === "image_workbench") {
        updateCurrentImageWorkbenchState((current) => {
          if (current.active) {
            return current;
          }
          return {
            ...current,
            active: true,
          };
        });
        openCanvasForReason("user_open_message_preview", setLayoutMode);
        return;
      }

      if (target.preview.kind === "video_generate") {
        const preview = target.preview;
        const initialState = createInitialVideoState(preview.prompt);
        setCanvasState({
          ...initialState,
          providerId: preview.providerId?.trim() || "",
          model: preview.model?.trim() || "",
          duration: preview.durationSeconds || initialState.duration,
          aspectRatio: normalizeVideoAspectRatio(preview.aspectRatio),
          resolution: normalizeVideoResolution(preview.resolution),
          status: resolveVideoCanvasStatusFromPreview(target),
          selectedTaskId: preview.taskId,
          videoUrl: preview.videoUrl || undefined,
          errorMessage:
            preview.status === "failed" || preview.status === "cancelled"
              ? preview.statusMessage?.trim() || "视频任务未成功完成"
              : undefined,
        });
        openCanvasForReason("user_open_message_preview", setLayoutMode);
        return;
      }

      const matchedArtifact = resolveTaskPreviewArtifact(message, target);
      if (matchedArtifact) {
        handleWorkspaceArtifactClick(matchedArtifact);
        return;
      }

      const normalizedArtifactPath = normalizeArtifactProtocolPath(
        target.preview.artifactPath || null,
      );
      if (normalizedArtifactPath) {
        const matchedTaskFile = taskFiles.find((file) =>
          doesWorkspaceFileCandidateMatch(file.name, normalizedArtifactPath),
        );
        if (matchedTaskFile?.content?.trim()) {
          handleWorkspaceFileClick(
            matchedTaskFile.name,
            matchedTaskFile.content,
          );
          return;
        }
      }

      toast.info("当前任务产物还未同步完成，请稍后再试");
    },
    [
      handleWorkspaceArtifactClick,
      handleWorkspaceFileClick,
      setCanvasState,
      setLayoutMode,
      taskFiles,
      updateCurrentImageWorkbenchState,
    ],
  );
  const handleOpenArtifactFromTimeline = useCallback(
    (target: ArtifactTimelineOpenTarget) => {
      void (async () => {
        let content = target.content;
        if (!content.trim()) {
          const absolutePath = resolveAbsoluteWorkspacePath(
            project?.rootPath,
            target.filePath,
          );
          if (absolutePath) {
            const preview = await handleHarnessLoadFilePreview(absolutePath);
            if (preview.error) {
              toast.error(`打开产物失败: ${preview.error}`);
              return;
            }
            if (preview.isBinary) {
              toast.info("该产物是二进制格式，暂不支持在工作台预览");
              return;
            }
            content =
              typeof preview.content === "string" ? preview.content : "";
          }
        }

        handleWorkspaceFileClick(target.filePath, content);

        const normalizedBlockId = target.blockId?.trim();
        if (!normalizedBlockId) {
          return;
        }

        setFocusedArtifactBlockId(normalizedBlockId);
        setArtifactBlockFocusRequestKey((current) => current + 1);
      })();
    },
    [handleHarnessLoadFilePreview, handleWorkspaceFileClick, project?.rootPath],
  );
  const siteSkillSavedContentTarget = useMemo(
    () =>
      resolveSiteSavedContentTargetFromRunResult(
        siteSkillExecutionState?.result || null,
      ),
    [siteSkillExecutionState?.result],
  );
  const currentTurnThreadItems = useMemo(
    () =>
      currentTurnId
        ? effectiveThreadItems.filter((item) => item.turn_id === currentTurnId)
        : [],
    [currentTurnId, effectiveThreadItems],
  );
  const preferredServiceSkillResultFileTarget = useMemo(
    () =>
      resolvePreferredServiceSkillResultFileTarget({
        threadItems: currentTurnThreadItems,
        savedContentTarget: siteSkillSavedContentTarget,
      }),
    [currentTurnThreadItems, siteSkillSavedContentTarget],
  );
  const handleOpenServiceSkillResultFile = useCallback(
    async (relativePath: string) => {
      const normalizedPath = relativePath.trim();
      if (!normalizedPath) {
        return;
      }

      const absolutePath = resolveAbsoluteWorkspacePath(
        project?.rootPath,
        normalizedPath,
      );
      if (absolutePath) {
        const opened = await openProjectFilePreviewInCanvas({
          relativePath: normalizedPath,
          absolutePath,
        });
        if (opened) {
          return;
        }
      }

      const matchedTaskFile = taskFiles.find((file) =>
        doesWorkspaceFileCandidateMatch(file.name, normalizedPath),
      );
      if (matchedTaskFile) {
        handleWorkspaceFileClick(
          matchedTaskFile.name,
          matchedTaskFile.content ?? "",
        );
        return;
      }

      if (absolutePath) {
        return;
      }

      toast.error("打开结果文件失败：当前工作区里还没有同步到这份文件");
    },
    [
      handleWorkspaceFileClick,
      openProjectFilePreviewInCanvas,
      project?.rootPath,
      taskFiles,
    ],
  );
  useEffect(() => {
    const relativePath = initialProjectFileOpenTarget?.relativePath?.trim();
    if (!relativePath) {
      handledInitialProjectFileOpenSignatureRef.current = "";
      return;
    }

    if (contentId && isInitialContentLoading) {
      return;
    }

    if (!project?.rootPath && !isAbsoluteWorkspacePath(relativePath)) {
      return;
    }

    const absolutePath = resolveAbsoluteWorkspacePath(
      project?.rootPath,
      relativePath,
    );
    if (!absolutePath) {
      return;
    }

    const signature = JSON.stringify({
      projectId: projectId ?? "",
      contentId: contentId ?? "",
      relativePath,
      requestKey: initialProjectFileOpenTarget?.requestKey ?? 0,
    });
    if (handledInitialProjectFileOpenSignatureRef.current === signature) {
      return;
    }
    handledInitialProjectFileOpenSignatureRef.current = signature;

    let cancelled = false;
    void (async () => {
      await openProjectFilePreviewInCanvas({
        relativePath,
        absolutePath,
        isCancelled: () => cancelled,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    contentId,
    initialProjectFileOpenTarget,
    isInitialContentLoading,
    openProjectFilePreviewInCanvas,
    project?.rootPath,
    projectId,
  ]);
  const serviceSkillExecutionCard = useMemo(
    () =>
      siteSkillExecutionState ? (
        <ServiceSkillExecutionCard
          state={siteSkillExecutionState}
          onOpenBrowserRuntime={
            siteSkillExecutionState.phase === "blocked"
              ? handleOpenBrowserRuntimeForSiteSkillExecution
              : undefined
          }
          preferredResultFileTarget={preferredServiceSkillResultFileTarget}
          onOpenResultFile={handleOpenServiceSkillResultFile}
          onOpenSavedSiteContent={handleOpenSavedSiteContent}
        />
      ) : null,
    [
      handleOpenServiceSkillResultFile,
      handleOpenBrowserRuntimeForSiteSkillExecution,
      handleOpenSavedSiteContent,
      preferredServiceSkillResultFileTarget,
      siteSkillExecutionState,
    ],
  );
  const sceneAppExecutionSummaryState = useSceneAppExecutionSummaryRuntime({
    initialSummary: initialSceneAppExecutionSummary,
    sessionId,
    isSending,
  });
  const requestRefreshSceneAppExecutionSummary =
    sceneAppExecutionSummaryState?.requestRefresh;
  const sceneAppExecutionReferenceEntry = useMemo(
    () =>
      buildCuratedTaskReferenceEntryFromSceneAppExecution({
        summary: sceneAppExecutionSummaryState?.summary,
        latestRunDetailView:
          sceneAppExecutionSummaryState?.latestPackResultDetailView,
      }),
    [
      sceneAppExecutionSummaryState?.latestPackResultDetailView,
      sceneAppExecutionSummaryState?.summary,
    ],
  );
  const defaultCuratedTaskReferenceEntries = useMemo(
    () =>
      mergeCuratedTaskReferenceEntries([
        ...(initialCreationReplaySurface?.defaultReferenceEntries ?? []),
        sceneAppExecutionReferenceEntry,
      ]).slice(0, 3),
    [
      initialCreationReplaySurface?.defaultReferenceEntries,
      sceneAppExecutionReferenceEntry,
    ],
  );
  const defaultCuratedTaskReferenceMemoryIds = useMemo(
    () =>
      normalizeCuratedTaskReferenceMemoryIds([
        ...(initialCreationReplaySurface?.defaultReferenceMemoryIds ?? []),
        ...(extractCuratedTaskReferenceMemoryIds(
          defaultCuratedTaskReferenceEntries,
        ) ?? []),
      ]) ?? [],
    [
      defaultCuratedTaskReferenceEntries,
      initialCreationReplaySurface?.defaultReferenceMemoryIds,
    ],
  );
  const handleReviewCurrentSceneAppExecution = useCallback(() => {
    const followUpAction = buildSceneAppExecutionReviewFollowUpAction({
      referenceEntries: defaultCuratedTaskReferenceEntries,
    });
    if (!followUpAction) {
      toast.error("当前还没有足够的项目结果基线，暂时无法直接进入下一步判断。");
      return;
    }

    applyWorkbenchFollowUpActionPayload(followUpAction);
  }, [applyWorkbenchFollowUpActionPayload, defaultCuratedTaskReferenceEntries]);
  const handleContinueSceneAppReviewFeedback = useCallback(
    (taskId: string) => {
      const followUpAction = buildSceneAppExecutionCuratedTaskFollowUpAction({
        referenceEntries: defaultCuratedTaskReferenceEntries,
        taskId,
      });
      if (!followUpAction) {
        toast.error("当前判断建议还缺少可继续的结果模板。");
        return;
      }

      applyWorkbenchFollowUpActionPayload(followUpAction);
    },
    [applyWorkbenchFollowUpActionPayload, defaultCuratedTaskReferenceEntries],
  );
  const sceneAppExecutionContentPostEntries = useMemo(
    () =>
      buildSceneAppExecutionContentPostEntries({
        taskFiles,
        sessionFiles,
        artifacts,
      }),
    [artifacts, sessionFiles, taskFiles],
  );
  const [
    sceneAppReviewDecisionDialogOpen,
    setSceneAppReviewDecisionDialogOpen,
  ] = useState(false);
  const [sceneAppReviewDecisionTemplate, setSceneAppReviewDecisionTemplate] =
    useState<AgentRuntimeReviewDecisionTemplate | null>(null);
  const [sceneAppReviewDecisionLoading, setSceneAppReviewDecisionLoading] =
    useState(false);
  const [sceneAppReviewDecisionSaving, setSceneAppReviewDecisionSaving] =
    useState(false);
  const sceneAppReviewTargetRunSummary =
    sceneAppExecutionSummaryState?.reviewTargetRunSummary ?? null;
  const sceneAppReviewTargetSessionId =
    sceneAppReviewTargetRunSummary?.sessionId?.trim() || "";
  const canOpenSceneAppExecutionHumanReview =
    sceneAppReviewTargetSessionId.length > 0 &&
    Boolean(
      sceneAppReviewTargetRunSummary &&
      ["success", "error", "canceled", "timeout"].includes(
        sceneAppReviewTargetRunSummary.status,
      ),
    );
  const sceneAppExecutionFailureSignal =
    sceneAppExecutionSummaryState?.latestPackResultDetailView
      ?.failureSignalLabel ??
    sceneAppExecutionSummaryState?.summary?.runtimeBackflow
      ?.topFailureSignalLabel;
  const resolveSceneAppExecutionReviewDecisionTemplate =
    useCallback(async () => {
      if (!sceneAppReviewTargetSessionId) {
        return null;
      }

      if (
        sceneAppReviewDecisionTemplate?.session_id ===
        sceneAppReviewTargetSessionId
      ) {
        return sceneAppReviewDecisionTemplate;
      }

      setSceneAppReviewDecisionLoading(true);
      try {
        const template = await exportAgentRuntimeReviewDecisionTemplate(
          sceneAppReviewTargetSessionId,
        );
        setSceneAppReviewDecisionTemplate(template);
        return template;
      } catch (error) {
        toast.error(formatSceneAppErrorMessage(error));
        return null;
      } finally {
        setSceneAppReviewDecisionLoading(false);
      }
    }, [sceneAppReviewDecisionTemplate, sceneAppReviewTargetSessionId]);
  const persistSceneAppExecutionHumanReview = useCallback(
    async (
      request: AgentRuntimeSaveReviewDecisionRequest,
      options?: {
        closeDialog?: boolean;
        successMessage?: string;
      },
    ) => {
      setSceneAppReviewDecisionSaving(true);
      try {
        const template = await saveAgentRuntimeReviewDecision(request);
        setSceneAppReviewDecisionTemplate(template);
        recordCuratedTaskRecommendationSignalFromReviewDecision(request, {
          projectId,
          sessionId,
          sceneTitle: sceneAppExecutionSummaryState?.summary?.title,
        });
        requestRefreshSceneAppExecutionSummary?.();
        if (options?.closeDialog !== false) {
          setSceneAppReviewDecisionDialogOpen(false);
        }
        toast.success(options?.successMessage ?? "已保存人工复核结果");
      } catch (error) {
        toast.error(formatSceneAppErrorMessage(error));
      } finally {
        setSceneAppReviewDecisionSaving(false);
      }
    },
    [
      projectId,
      requestRefreshSceneAppExecutionSummary,
      sceneAppExecutionSummaryState?.summary?.title,
      sessionId,
    ],
  );
  const handleOpenSceneAppExecutionHumanReview = useCallback(() => {
    if (!sceneAppReviewTargetSessionId) {
      toast.error("当前运行还没有关联会话，暂时无法填写人工复核。");
      return;
    }

    void (async () => {
      const template = await resolveSceneAppExecutionReviewDecisionTemplate();
      if (template) {
        setSceneAppReviewDecisionDialogOpen(true);
      }
    })();
  }, [
    resolveSceneAppExecutionReviewDecisionTemplate,
    sceneAppReviewTargetSessionId,
  ]);
  const handleSaveSceneAppExecutionHumanReview = useCallback(
    async (request: AgentRuntimeSaveReviewDecisionRequest) => {
      await persistSceneAppExecutionHumanReview(request);
    },
    [persistSceneAppExecutionHumanReview],
  );
  const handleApplySceneAppExecutionQuickReview = useCallback(
    (actionKey: (typeof SCENEAPP_QUICK_REVIEW_ACTIONS)[number]["key"]) => {
      if (
        !canOpenSceneAppExecutionHumanReview ||
        !sceneAppReviewTargetSessionId
      ) {
        toast.error("当前运行还没有关联会话，暂时无法记录轻量反馈。");
        return;
      }

      const action = SCENEAPP_QUICK_REVIEW_ACTIONS.find(
        (item) => item.key === actionKey,
      );
      if (!action) {
        return;
      }

      void (async () => {
        const template = await resolveSceneAppExecutionReviewDecisionTemplate();
        if (!template) {
          return;
        }

        await persistSceneAppExecutionHumanReview(
          buildSceneAppQuickReviewDecisionRequest({
            template,
            action,
            sceneTitle: sceneAppExecutionSummaryState?.summary?.title,
            failureSignal: sceneAppExecutionFailureSignal,
            sourceLabel: "生成",
          }),
          {
            closeDialog: false,
            successMessage: `已记录「${action.label}」判断`,
          },
        );
      })();
    },
    [
      canOpenSceneAppExecutionHumanReview,
      persistSceneAppExecutionHumanReview,
      resolveSceneAppExecutionReviewDecisionTemplate,
      sceneAppExecutionFailureSignal,
      sceneAppExecutionSummaryState?.summary?.title,
      sceneAppReviewTargetSessionId,
    ],
  );
  const handleOpenSceneAppExecutionDetail = useCallback(() => {
    const sceneappId =
      sceneAppExecutionSummaryState?.summary?.sceneappId?.trim();
    if (!_onNavigate || !sceneappId) {
      return;
    }

    _onNavigate(
      "sceneapps",
      resolveSceneAppsPageEntryParams(
        {
          view: "detail",
          sceneappId,
          projectId: projectId || undefined,
        },
        {
          mode: "browse",
        },
      ),
    );
  }, [
    _onNavigate,
    projectId,
    sceneAppExecutionSummaryState?.summary?.sceneappId,
  ]);
  const handleOpenSceneAppExecutionGovernance = useCallback(() => {
    const sceneappId =
      sceneAppExecutionSummaryState?.summary?.sceneappId?.trim();
    if (!_onNavigate || !sceneappId) {
      return;
    }

    _onNavigate(
      "sceneapps",
      resolveSceneAppsPageEntryParams(
        {
          view: "governance",
          sceneappId,
          runId:
            sceneAppExecutionSummaryState?.latestPackResultDetailView?.runId ||
            sceneAppExecutionSummaryState?.summary?.runtimeBackflow?.runId ||
            undefined,
          projectId: projectId || undefined,
        },
        {
          mode: "browse",
        },
      ),
    );
  }, [
    _onNavigate,
    projectId,
    sceneAppExecutionSummaryState?.latestPackResultDetailView?.runId,
    sceneAppExecutionSummaryState?.summary?.runtimeBackflow?.runId,
    sceneAppExecutionSummaryState?.summary?.sceneappId,
  ]);
  const handleOpenSceneAppExecutionDeliveryArtifact = useCallback(
    (
      artifactEntry?: NonNullable<
        NonNullable<
          typeof sceneAppExecutionSummaryState
        >["latestPackResultDetailView"]
      >["deliveryArtifactEntries"][number],
    ) => {
      if (!_onNavigate) {
        return;
      }

      const target = resolveSceneAppRuntimeArtifactOpenTarget({
        entry: artifactEntry,
        fallbackProjectId: projectId,
        bannerPrefix: "已从生成打开结果文件",
      });
      if (!target) {
        toast.error("当前这次运行还没有可打开的结果文件路径。");
        return;
      }

      _onNavigate("agent", {
        agentEntry: "claw",
        projectId: target.projectId,
        initialProjectFileOpenTarget: {
          relativePath: target.openTargetPath,
          requestKey: Date.now(),
        },
        entryBannerMessage: target.bannerMessage,
      });
    },
    [_onNavigate, projectId],
  );
  const handleOpenSceneAppExecutionGovernanceArtifact = useCallback(
    (
      artifactEntry?: NonNullable<
        NonNullable<
          typeof sceneAppExecutionSummaryState
        >["latestPackResultDetailView"]
      >["governanceArtifactEntries"][number],
    ) => {
      if (!_onNavigate || !artifactEntry) {
        return;
      }

      const runId =
        sceneAppExecutionSummaryState?.latestPackResultDetailView?.runId?.trim() ||
        sceneAppReviewTargetRunSummary?.runId?.trim() ||
        "";

      void (async () => {
        let resolvedEntry = artifactEntry;
        if (runId && sceneAppExecutionSummaryState?.summary) {
          try {
            const refreshed = await prepareSceneAppRunGovernanceArtifact(
              runId,
              artifactEntry.artifactRef.kind,
            );
            if (!refreshed) {
              toast.error("当前运行已不存在，无法继续准备结果材料。");
              return;
            }

            const refreshedDetailView =
              buildSceneAppExecutionSummaryRunDetailViewModel({
                summary: sceneAppExecutionSummaryState.summary,
                run: refreshed,
              });
            resolvedEntry =
              refreshedDetailView.governanceArtifactEntries.find(
                (entry) =>
                  entry.artifactRef.kind === artifactEntry.artifactRef.kind,
              ) ?? artifactEntry;
          } catch (error) {
            toast.error(formatSceneAppErrorMessage(error));
            return;
          }
        }

        const target = resolveSceneAppRuntimeArtifactOpenTarget({
          entry: resolvedEntry,
          fallbackProjectId: projectId,
          bannerPrefix: "已从生成打开结果材料",
        });
        if (!target) {
          toast.error("当前这次运行还没有可打开的证据或复核文件。");
          return;
        }

        _onNavigate("agent", {
          agentEntry: "claw",
          projectId: target.projectId,
          initialProjectFileOpenTarget: {
            relativePath: target.openTargetPath,
            requestKey: Date.now(),
          },
          entryBannerMessage: target.bannerMessage,
        });
      })();
    },
    [
      _onNavigate,
      projectId,
      sceneAppExecutionSummaryState?.latestPackResultDetailView?.runId,
      sceneAppExecutionSummaryState?.summary,
      sceneAppReviewTargetRunSummary?.runId,
    ],
  );
  const handleRunSceneAppExecutionGovernanceAction = useCallback(
    (
      action?: NonNullable<
        NonNullable<
          typeof sceneAppExecutionSummaryState
        >["latestPackResultDetailView"]
      >["governanceActionEntries"][number],
    ) => {
      if (!_onNavigate || !action || !sceneAppExecutionSummaryState?.summary) {
        return;
      }

      const runId =
        sceneAppExecutionSummaryState.latestPackResultDetailView?.runId?.trim() ||
        sceneAppReviewTargetRunSummary?.runId?.trim() ||
        "";
      if (!runId) {
        toast.error("当前还没有可用于后续动作的运行样本。");
        return;
      }

      const sceneAppExecutionSummary = sceneAppExecutionSummaryState.summary;

      void (async () => {
        try {
          const refreshed = await prepareSceneAppRunGovernanceArtifacts(
            runId,
            action.artifactKinds,
          );
          if (!refreshed) {
            toast.error("当前运行已不存在，无法继续准备后续动作。");
            return;
          }

          const refreshedDetailView =
            buildSceneAppExecutionSummaryRunDetailViewModel({
              summary: sceneAppExecutionSummary,
              run: refreshed,
            });
          const targetEntry =
            refreshedDetailView.governanceArtifactEntries.find(
              (entry) => entry.artifactRef.kind === action.primaryArtifactKind,
            );
          const target = resolveSceneAppRuntimeArtifactOpenTarget({
            entry: targetEntry,
            fallbackProjectId: projectId,
            bannerPrefix: "已从生成打开后续动作",
          });
          if (!target) {
            toast.error(
              `后续动作已准备完成，但当前没有可打开的${action.primaryArtifactLabel}路径。`,
            );
            return;
          }

          _onNavigate("agent", {
            agentEntry: "claw",
            projectId: target.projectId,
            initialProjectFileOpenTarget: {
              relativePath: target.openTargetPath,
              requestKey: Date.now(),
            },
            entryBannerMessage: target.bannerMessage,
          });
        } catch (error) {
          toast.error(formatSceneAppErrorMessage(error));
        }
      })();
    },
    [
      _onNavigate,
      projectId,
      sceneAppExecutionSummaryState,
      sceneAppReviewTargetRunSummary?.runId,
    ],
  );
  const handleOpenSceneAppExecutionEntryAction = useCallback(
    (
      action?: NonNullable<
        NonNullable<
          typeof sceneAppExecutionSummaryState
        >["latestPackResultDetailView"]
      >["entryAction"],
    ) => {
      if (!_onNavigate || !action || !sceneAppExecutionSummaryState?.summary) {
        return;
      }

      const target = resolveSceneAppRunEntryNavigationTarget({
        action,
        sceneappId: sceneAppExecutionSummaryState.summary.sceneappId,
        sceneTitle: sceneAppExecutionSummaryState.summary.title,
        sourceLabel: "生成",
        projectId,
        linkedServiceSkillId:
          sceneAppExecutionSummaryState.summary.descriptorSnapshot
            ?.linkedServiceSkillId,
        linkedSceneKey:
          sceneAppExecutionSummaryState.summary.descriptorSnapshot
            ?.linkedSceneKey,
      });
      if (!target) {
        toast.error("当前运行缺少可恢复的入口上下文。");
        return;
      }

      _onNavigate(target.page, target.params);
    },
    [_onNavigate, projectId, sceneAppExecutionSummaryState?.summary],
  );
  const handleOpenSceneAppExecutionContentPost = useCallback(
    (entry: SceneAppExecutionContentPostEntry) => {
      if (entry.source.kind === "task_file") {
        handleTaskFileClick(entry.source.file);
        return;
      }

      if (entry.source.kind === "artifact") {
        handleArtifactClick(entry.source.artifact);
        return;
      }

      void (async () => {
        try {
          const matchedTaskFile = taskFiles.find((file) =>
            doesWorkspaceFileCandidateMatch(file.name, entry.pathLabel),
          );
          if (matchedTaskFile) {
            handleTaskFileClick(matchedTaskFile);
            return;
          }

          const matchedArtifact = artifacts.find((artifact) =>
            doesWorkspaceFileCandidateMatch(
              resolveArtifactProtocolFilePath(artifact),
              entry.pathLabel,
            ),
          );
          if (matchedArtifact) {
            handleArtifactClick(matchedArtifact);
            return;
          }

          const matchedSessionFile = sessionFiles.find((file) =>
            doesWorkspaceFileCandidateMatch(file.name, entry.pathLabel),
          );
          if (!matchedSessionFile) {
            toast.error("当前发布产物已不存在，暂时无法打开。");
            return;
          }

          const content = await readSessionFile(matchedSessionFile.name);
          if (typeof content !== "string" || !content.trim()) {
            toast.info("该发布产物当前没有可直接预览的正文内容。");
            return;
          }

          handleWorkspaceFileClick(matchedSessionFile.name, content);
        } catch (error) {
          console.error("[AgentChatPage] 打开发布产物失败:", error);
          toast.error("打开发布产物失败，请稍后重试。");
        }
      })();
    },
    [
      artifacts,
      handleArtifactClick,
      handleTaskFileClick,
      handleWorkspaceFileClick,
      readSessionFile,
      sessionFiles,
      taskFiles,
    ],
  );
  const handleRunSceneAppExecutionPromptAction = useCallback(
    async (action: SceneAppExecutionPromptAction) => {
      const followUpAction = buildSceneAppExecutionPromptActionPayload({
        action,
        summary: sceneAppExecutionSummaryState?.summary,
        detailView: sceneAppExecutionSummaryState?.latestPackResultDetailView,
      });
      if (!followUpAction) {
        toast.error("当前动作缺少可发送内容。");
        return;
      }

      if (isSending || queuedTurns.length > 0) {
        toast.info("当前会话还有执行中的内容，请稍后再继续推进。");
        return;
      }

      if (followUpAction.capabilityRoute) {
        applyWorkbenchFollowUpActionPayload(followUpAction);
        return;
      }

      await handleSendRef.current(
        [],
        webSearchPreferenceRef.current,
        effectiveChatToolPreferences.thinking,
        followUpAction.prompt,
      );
    },
    [
      applyWorkbenchFollowUpActionPayload,
      effectiveChatToolPreferences.thinking,
      handleSendRef,
      isSending,
      queuedTurns.length,
      sceneAppExecutionSummaryState?.latestPackResultDetailView,
      sceneAppExecutionSummaryState?.summary,
      webSearchPreferenceRef,
    ],
  );
  const handleSaveSceneAppExecutionAsSkill = useCallback(() => {
    if (!_onNavigate) {
      toast.error("当前入口暂不支持直接跳转到 Skill 页面");
      return;
    }

    const latestReviewSignal =
      listCuratedTaskRecommendationSignals({
        projectId,
        sessionId,
      })
        .filter((signal) => signal.source === "review_feedback")
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;

    const nextPageParams = buildSkillsPageParamsFromSceneAppExecution(
      sceneAppExecutionSummaryState?.summary,
      sceneAppExecutionSummaryState?.latestPackResultDetailView,
      {
        projectId,
        reviewSignal: latestReviewSignal,
      },
    );
    if (!nextPageParams?.initialScaffoldDraft) {
      toast.error("当前这轮结果还不足以沉淀为做法");
      return;
    }

    _onNavigate("skills", nextPageParams);
    toast.success("已带着这轮结果去整理做法");
  }, [
    _onNavigate,
    projectId,
    sceneAppExecutionSummaryState?.latestPackResultDetailView,
    sceneAppExecutionSummaryState?.summary,
    sessionId,
  ]);
  const [
    curatedTaskRecommendationSignalsVersion,
    setCuratedTaskRecommendationSignalsVersion,
  ] = useState(0);
  useEffect(() => {
    return subscribeCuratedTaskRecommendationSignalsChanged(() => {
      setCuratedTaskRecommendationSignalsVersion((previous) => previous + 1);
    });
  }, []);
  const handleSaveSceneAppExecutionAsInspiration = useCallback(() => {
    void saveSceneAppExecutionAsInspiration({
      summary: sceneAppExecutionSummaryState?.summary,
      detailView: sceneAppExecutionSummaryState?.latestPackResultDetailView,
      projectId,
      sessionId,
    });
  }, [
    projectId,
    sceneAppExecutionSummaryState?.latestPackResultDetailView,
    sceneAppExecutionSummaryState?.summary,
    sessionId,
  ]);
  const handleOpenInspirationLibrary = useCallback(() => {
    if (!_onNavigate) {
      toast.error("当前入口暂不支持直接打开灵感库");
      return;
    }

    _onNavigate(
      "memory",
      buildSceneAppExecutionInspirationLibraryPageParams({
        summary: sceneAppExecutionSummaryState?.summary,
        detailView: sceneAppExecutionSummaryState?.latestPackResultDetailView,
      }),
    );
  }, [
    _onNavigate,
    sceneAppExecutionSummaryState?.latestPackResultDetailView,
    sceneAppExecutionSummaryState?.summary,
  ]);
  const sceneAppExecutionSavedAsInspiration = useMemo(() => {
    void curatedTaskRecommendationSignalsVersion;
    return hasSavedSceneAppExecutionAsInspiration({
      summary: sceneAppExecutionSummaryState?.summary,
      detailView: sceneAppExecutionSummaryState?.latestPackResultDetailView,
      projectId,
      sessionId,
    });
  }, [
    curatedTaskRecommendationSignalsVersion,
    projectId,
    sceneAppExecutionSummaryState?.latestPackResultDetailView,
    sceneAppExecutionSummaryState?.summary,
    sessionId,
  ]);
  const latestReviewFeedbackSignal =
    listCuratedTaskRecommendationSignals({
      projectId,
      sessionId,
    })
      .filter((signal) => signal.source === "review_feedback")
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const sceneAppExecutionSummaryCard = useMemo(
    () =>
      sceneAppExecutionSummaryState?.summary ? (
        <SceneAppExecutionSummaryCard
          summary={sceneAppExecutionSummaryState.summary}
          latestPackResultDetailView={
            sceneAppExecutionSummaryState.latestPackResultDetailView
          }
          latestPackResultLoading={sceneAppExecutionSummaryState.loading}
          latestPackResultUsesFallback={
            sceneAppExecutionSummaryState.latestPackResultUsesFallback
          }
          latestReviewFeedbackSignal={latestReviewFeedbackSignal}
          onContinueReviewFeedback={handleContinueSceneAppReviewFeedback}
          onReviewCurrentProject={handleReviewCurrentSceneAppExecution}
          savedAsInspiration={sceneAppExecutionSavedAsInspiration}
          onSaveAsInspiration={handleSaveSceneAppExecutionAsInspiration}
          onOpenInspirationLibrary={handleOpenInspirationLibrary}
          onSaveAsSkill={handleSaveSceneAppExecutionAsSkill}
          onOpenSceneAppDetail={handleOpenSceneAppExecutionDetail}
          onOpenSceneAppGovernance={handleOpenSceneAppExecutionGovernance}
          humanReviewAvailable={canOpenSceneAppExecutionHumanReview}
          humanReviewLoading={sceneAppReviewDecisionLoading}
          quickReviewActions={SCENEAPP_QUICK_REVIEW_ACTIONS}
          quickReviewPending={
            sceneAppReviewDecisionLoading || sceneAppReviewDecisionSaving
          }
          onOpenHumanReview={handleOpenSceneAppExecutionHumanReview}
          onApplyQuickReview={handleApplySceneAppExecutionQuickReview}
          onDeliveryArtifactAction={handleOpenSceneAppExecutionDeliveryArtifact}
          onGovernanceAction={handleRunSceneAppExecutionGovernanceAction}
          onGovernanceArtifactAction={
            handleOpenSceneAppExecutionGovernanceArtifact
          }
          onEntryAction={handleOpenSceneAppExecutionEntryAction}
          contentPostEntries={sceneAppExecutionContentPostEntries}
          onContentPostAction={handleOpenSceneAppExecutionContentPost}
          promptActionPending={isSending || queuedTurns.length > 0}
          onPromptAction={handleRunSceneAppExecutionPromptAction}
        />
      ) : null,
    [
      canOpenSceneAppExecutionHumanReview,
      handleApplySceneAppExecutionQuickReview,
      handleContinueSceneAppReviewFeedback,
      handleOpenSceneAppExecutionContentPost,
      handleOpenSceneAppExecutionDetail,
      handleOpenSceneAppExecutionHumanReview,
      handleOpenSceneAppExecutionGovernance,
      handleOpenInspirationLibrary,
      handleOpenSceneAppExecutionDeliveryArtifact,
      handleOpenSceneAppExecutionEntryAction,
      handleOpenSceneAppExecutionGovernanceArtifact,
      handleReviewCurrentSceneAppExecution,
      handleSaveSceneAppExecutionAsInspiration,
      handleSaveSceneAppExecutionAsSkill,
      handleRunSceneAppExecutionPromptAction,
      handleRunSceneAppExecutionGovernanceAction,
      isSending,
      latestReviewFeedbackSignal,
      queuedTurns.length,
      sceneAppExecutionSavedAsInspiration,
      sceneAppReviewDecisionLoading,
      sceneAppReviewDecisionSaving,
      sceneAppExecutionContentPostEntries,
      sceneAppExecutionSummaryState,
    ],
  );
  const handleJumpToTimelineItem = useCallback((itemId: string) => {
    const normalizedItemId = itemId.trim();
    if (!normalizedItemId) {
      return;
    }

    setLayoutMode((current) =>
      current === "canvas" ? "chat-canvas" : current,
    );
    setFocusedTimelineItemId(normalizedItemId);
    setTimelineFocusRequestKey((current) => current + 1);
  }, []);
  const triggerAIGuideRef = useRef(triggerAIGuide);
  triggerAIGuideRef.current = triggerAIGuide;

  useEffect(() => {
    if (shouldUseCompactGeneralWorkbench) {
      return;
    }

    const canvasEmpty = isCanvasStateEmpty(canvasState);
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];
    const defaultGuidePrompt =
      contentId && canvasEmpty && !isThemeWorkbench
        ? getDefaultGuidePromptByTheme(mappedTheme)
        : undefined;

    if (
      !contentId ||
      messages.length > 0 ||
      !project ||
      !systemPrompt ||
      isSending ||
      !canvasEmpty
    ) {
      return;
    }

    if (!initialDispatchKey && generalWorkbenchEntryCheckPending) {
      return;
    }

    if (initialDispatchKey) {
      if (
        isThemeWorkbench &&
        pendingInitialImages.length === 0 &&
        !autoRunInitialPromptOnMount
      ) {
        return;
      }
      if (consumedInitialPromptRef.current === initialDispatchKey) {
        return;
      }

      let disposed = false;
      consumedInitialPromptRef.current = initialDispatchKey;
      hasTriggeredGuide.current = true;
      if (import.meta.env.MODE !== "test") {
        console.log("[AgentChatPage] 自动发送首条创作意图消息");
      }

      void (async () => {
        const started = await handleSend(
          pendingInitialImages,
          effectiveChatToolPreferences.webSearch,
          effectiveChatToolPreferences.thinking,
          pendingInitialPrompt,
          undefined,
          undefined,
          initialAutoSendRequestMetadata
            ? {
                requestMetadata: initialAutoSendRequestMetadata,
              }
            : undefined,
        );
        if (disposed) {
          return;
        }
        if (!started) {
          consumedInitialPromptRef.current = null;
          return;
        }
        onInitialUserPromptConsumed?.();
      })();

      return () => {
        disposed = true;
      };
    }

    if (hasTriggeredGuide.current) {
      return;
    }

    if (generalWorkbenchEntryPrompt?.kind === "resume") {
      return;
    }

    if (defaultGuidePrompt) {
      hasTriggeredGuide.current = true;
      setInput((previous) => previous.trim() || defaultGuidePrompt);
      return;
    }

    if (isThemeWorkbench) {
      if (shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt) {
        return;
      }

      hasTriggeredGuide.current = true;
      if (import.meta.env.MODE !== "test") {
        console.log("[AgentChatPage] 工作区上下文：触发 AI 引导");
      }
      triggerAIGuideRef.current();
      return;
    }

    hasTriggeredGuide.current = true;
    if (import.meta.env.MODE !== "test") {
      console.log("[AgentChatPage] 自动触发 AI 创作引导");
    }
    triggerAIGuideRef.current();
  }, [
    autoRunInitialPromptOnMount,
    canvasState,
    contentId,
    generalWorkbenchEntryCheckPending,
    generalWorkbenchEntryPrompt,
    handleSend,
    initialAutoSendRequestMetadata,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
    isSending,
    isThemeWorkbench,
    mappedTheme,
    messages.length,
    onInitialUserPromptConsumed,
    project,
    setInput,
    shouldSkipGeneralWorkbenchAutoGuideWithoutPrompt,
    shouldUseCompactGeneralWorkbench,
    systemPrompt,
    effectiveChatToolPreferences.thinking,
    effectiveChatToolPreferences.webSearch,
  ]);

  useEffect(() => {
    const pendingInitialPrompt = (initialUserPrompt || "").trim();
    const pendingInitialImages = initialUserImages || [];

    if (
      shouldUseCompactGeneralWorkbench ||
      !initialDispatchKey ||
      contentId ||
      messages.length > 0 ||
      isSending
    ) {
      return;
    }

    if (consumedInitialPromptRef.current === initialDispatchKey) {
      return;
    }

    if (!autoRunInitialPromptOnMount) {
      hasTriggeredGuide.current = true;
      setInput((previous) => previous.trim() || pendingInitialPrompt);
      return;
    }

    if (!sessionId) {
      return;
    }

    let disposed = false;
    consumedInitialPromptRef.current = initialDispatchKey;

    void (async () => {
      const started = await handleSend(
        pendingInitialImages,
        effectiveChatToolPreferences.webSearch,
        effectiveChatToolPreferences.thinking,
        pendingInitialPrompt,
        undefined,
        undefined,
        initialAutoSendRequestMetadata
          ? {
              requestMetadata: initialAutoSendRequestMetadata,
            }
          : undefined,
      );
      if (disposed) {
        return;
      }
      if (!started) {
        consumedInitialPromptRef.current = null;
        return;
      }
      onInitialUserPromptConsumed?.();
    })();

    return () => {
      disposed = true;
    };
  }, [
    autoRunInitialPromptOnMount,
    contentId,
    handleSend,
    initialAutoSendRequestMetadata,
    initialDispatchKey,
    initialUserImages,
    initialUserPrompt,
    isSending,
    messages.length,
    onInitialUserPromptConsumed,
    sessionId,
    setInput,
    shouldUseCompactGeneralWorkbench,
    effectiveChatToolPreferences.thinking,
    effectiveChatToolPreferences.webSearch,
  ]);

  useEffect(() => {
    hasTriggeredGuide.current = false;
    consumedInitialPromptRef.current = null;
  }, [contentId]);

  useWorkspaceImageWorkbenchEventRuntime({
    canvasState,
    projectId,
    contentId,
    imageWorkbenchProviders,
    setImageWorkbenchSelectedProviderId,
    setImageWorkbenchSelectedModelId,
    setImageWorkbenchSelectedSize,
    setLayoutMode,
    setCanvasState,
    updateCurrentImageWorkbenchState,
    handleImageWorkbenchCommand,
  });

  useWorkspaceImageTaskPreviewRuntime({
    sessionId: imageWorkbenchSessionKey,
    projectId,
    contentId,
    projectRootPath: project?.rootPath || null,
    restoreFromWorkspace: shouldRestoreImageTasksFromWorkspace,
    messages,
    currentImageWorkbenchState,
    canvasState,
    setCanvasState,
    setChatMessages,
    updateCurrentImageWorkbenchState,
  });
  useWorkspaceVideoTaskPreviewRuntime({
    messages,
    setChatMessages,
  });
  useWorkspaceAudioTaskPreviewRuntime({
    projectRootPath: project?.rootPath || null,
    messages,
    setChatMessages,
  });
  useWorkspaceTranscriptionTaskPreviewRuntime({
    projectRootPath: project?.rootPath || null,
    messages,
    setChatMessages,
  });
  useWorkspaceVideoTaskActionRuntime({
    projectId,
    contentId,
    setChatMessages,
  });

  const shellChromeRuntime = useMemo(() => {
    const hasUnconsumedInitialDispatch =
      !shouldUseCompactGeneralWorkbench && isBootstrapDispatchPending;

    const showChatLayout = shouldShowChatLayout({
      agentEntry,
      preferEmptyStateForFreshTaskCenterTab: shouldRenderTaskCenterEmbeddedHome,
      hasDisplayMessages,
      hasPendingA2UIForm,
      isThemeWorkbench,
      hasUnconsumedInitialDispatch,
      isPreparingSend: isPreparingSend || Boolean(taskCenterDraftSendRequest),
      isSending,
      isSessionHydrating,
      queuedTurnCount: queuedTurns.length,
    });

    const shouldHideGeneralWorkbenchInputForTheme =
      shouldUseCompactGeneralWorkbench;
    const shouldShowGeneralWorkbenchFloatingInputOverlay =
      isThemeWorkbench &&
      showChatLayout &&
      !shouldHideGeneralWorkbenchInputForTheme;
    const isWorkspaceCompactChrome = topBarChrome === "workspace-compact";
    const shouldRenderBrandedEmptyState =
      !showChatLayout && !shouldRenderTaskCenterEmbeddedHome;
    const shouldRenderTopBar =
      !hideTopBar &&
      (!shouldRenderBrandedEmptyState || shouldUseBrowserWorkspaceHomeChrome);
    const shouldRenderInlineA2UI = isSpecializedThemeMode;

    const shouldUseTeamPrimaryChatPanelWidth =
      layoutMode === "chat-canvas" &&
      teamSessionRuntime.teamWorkspaceEnabled &&
      (teamSessionRuntime.hasRuntimeSessions ||
        Boolean(teamDispatchPreviewState));

    return {
      showChatLayout,
      isWorkspaceCompactChrome,
      workflowLayoutBottomSpacing: resolveWorkflowLayoutBottomSpacing({
        contextWorkspaceEnabled: contextWorkspace.generalWorkbenchEnabled,
        showFloatingInputOverlay:
          shouldShowGeneralWorkbenchFloatingInputOverlay,
        hasCanvasContent: layoutMode !== "chat",
        workflowRunState: themeWorkbenchRunState,
        gateStatus: currentGate.status,
      }),
      shouldHideGeneralWorkbenchInputForTheme,
      shouldRenderTopBar,
      layoutTransitionChatPanelWidth: shouldUseTeamPrimaryChatPanelWidth
        ? TEAM_PRIMARY_CHAT_PANEL_WIDTH
        : undefined,
      layoutTransitionChatPanelMinWidth: shouldUseTeamPrimaryChatPanelWidth
        ? TEAM_PRIMARY_CHAT_PANEL_MIN_WIDTH
        : undefined,
      shouldShowGeneralWorkbenchFloatingInputOverlay,
      shouldRenderInlineA2UI,
    };
  }, [
    agentEntry,
    contextWorkspace.generalWorkbenchEnabled,
    currentGate.status,
    hasDisplayMessages,
    hasPendingA2UIForm,
    hideTopBar,
    isBootstrapDispatchPending,
    isPreparingSend,
    isSending,
    isSessionHydrating,
    isSpecializedThemeMode,
    isThemeWorkbench,
    layoutMode,
    taskCenterDraftSendRequest,
    queuedTurns.length,
    shouldRenderTaskCenterEmbeddedHome,
    shouldUseBrowserWorkspaceHomeChrome,
    shouldUseCompactGeneralWorkbench,
    teamDispatchPreviewState,
    teamSessionRuntime.hasRuntimeSessions,
    teamSessionRuntime.teamWorkspaceEnabled,
    themeWorkbenchRunState,
    topBarChrome,
  ]);
  const shouldShowGeneralWorkbenchSidebarForTheme =
    !generalWorkbenchScaffoldRuntime.shouldUseCompactGeneralWorkbench;
  const showGeneralWorkbenchSidebar =
    effectiveShowChatPanel &&
    showSidebar &&
    !hasPendingA2UIForm &&
    isThemeWorkbench &&
    shouldShowGeneralWorkbenchSidebarForTheme &&
    (!generalWorkbenchScaffoldRuntime.enableGeneralWorkbenchPanelCollapse ||
      !generalWorkbenchScaffoldRuntime.generalWorkbenchSidebarCollapsed);
  const showGeneralWorkbenchLeftExpandButton =
    effectiveShowChatPanel &&
    showSidebar &&
    !hasPendingA2UIForm &&
    isThemeWorkbench &&
    shouldShowGeneralWorkbenchSidebarForTheme &&
    generalWorkbenchScaffoldRuntime.enableGeneralWorkbenchPanelCollapse &&
    generalWorkbenchScaffoldRuntime.generalWorkbenchSidebarCollapsed;
  const handleDeleteGeneralWorkbenchVersion = useCallback(() => undefined, []);
  const handleCollapseGeneralWorkbenchSidebar = useCallback(() => {
    generalWorkbenchScaffoldRuntime.setGeneralWorkbenchSidebarCollapsed(true);
  }, [generalWorkbenchScaffoldRuntime]);
  const handleExpandGeneralWorkbenchSidebar = useCallback(() => {
    generalWorkbenchScaffoldRuntime.setGeneralWorkbenchSidebarCollapsed(false);
  }, [generalWorkbenchScaffoldRuntime]);
  const handleApplyGeneralWorkbenchFollowUpAction =
    applyWorkbenchFollowUpActionPayload;
  const effectiveInitialInputCapability = useMemo(
    () =>
      resolveEffectiveInitialInputCapability({
        bootstrap: initialInputCapability,
        runtime: runtimeInitialInputCapability,
      }),
    [initialInputCapability, runtimeInitialInputCapability],
  );
  const generalWorkbenchHarnessDialog = (
    <GeneralWorkbenchHarnessDialogSection
      enabled={
        !suppressHomeNavbarUtilityActions &&
        contextHarnessRuntime.workbenchEnabled &&
        contextHarnessRuntime.isThemeWorkbench
      }
      open={
        !suppressHomeNavbarUtilityActions &&
        contextHarnessRuntime.harnessPanelVisible
      }
      onOpenChange={contextHarnessRuntime.setHarnessPanelVisible}
      harnessState={harnessState}
      environment={contextHarnessRuntime.harnessEnvironment}
      childSubagentSessions={childSubagentSessions}
      selectedTeamLabel={selectedTeamLabel}
      selectedTeamSummary={selectedTeamSummary}
      selectedTeamRoles={selectedTeam?.roles}
      teamMemorySnapshot={resolvedTeamMemoryShadowSnapshot}
      toolInventory={harnessInventoryRuntime.toolInventory}
      toolInventoryLoading={harnessInventoryRuntime.toolInventoryLoading}
      toolInventoryError={harnessInventoryRuntime.toolInventoryError}
      onRefreshToolInventory={harnessInventoryRuntime.refreshToolInventory}
      onOpenSubagentSession={handleOpenSubagentSession}
      onLoadFilePreview={handleHarnessLoadFilePreview}
      onOpenFile={handleWorkspaceFileClick}
    />
  );
  const generalWorkbenchSidebarNode = (
    <WorkspaceGeneralWorkbenchSidebar
      visible={showGeneralWorkbenchSidebar}
      isThemeWorkbench={isThemeWorkbench}
      enablePanelCollapse={
        generalWorkbenchScaffoldRuntime.enableGeneralWorkbenchPanelCollapse
      }
      onRequestCollapse={handleCollapseGeneralWorkbenchSidebar}
      generalWorkbenchHarnessSummary={
        harnessInventoryRuntime.generalWorkbenchHarnessSummary
      }
      harnessPanelVisible={contextHarnessRuntime.harnessPanelVisible}
      onToggleHarnessPanel={contextHarnessRuntime.handleToggleHarnessPanel}
      workflow={{
        projectId,
        sessionId,
        branchItems: generalWorkbenchScaffoldRuntime.branchItems,
        onCreateVersionSnapshot: handleCreateVersionSnapshot,
        onSwitchBranchVersion: handleSwitchBranchVersion,
        onDeleteTopic: handleDeleteGeneralWorkbenchVersion,
        onSetBranchStatus: handleSetBranchStatus,
        workflowSteps:
          generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowSteps,
        onAddImage: handleAddImage,
        onImportDocument: handleImportDocument,
        onApplyFollowUpAction: handleApplyGeneralWorkbenchFollowUpAction,
        activityLogs:
          generalWorkbenchSidebarRuntime.generalWorkbenchActivityLogs,
        creationTaskEvents:
          generalWorkbenchScaffoldRuntime.generalWorkbenchCreationTaskEvents,
        onViewRunDetail:
          generalWorkbenchSidebarRuntime.handleViewGeneralWorkbenchRunDetail,
        activeRunDetail:
          generalWorkbenchSidebarRuntime.selectedGeneralWorkbenchRunDetail,
        activeRunDetailLoading:
          generalWorkbenchSidebarRuntime.generalWorkbenchRunDetailLoading,
      }}
      contextWorkspace={contextHarnessRuntime.contextWorkspace}
      onViewContextDetail={handleViewContextDetail}
      history={{
        hasMore: generalWorkbenchSidebarRuntime.generalWorkbenchHistoryHasMore,
        loading: generalWorkbenchSidebarRuntime.generalWorkbenchHistoryLoading,
        onLoadMore:
          generalWorkbenchSidebarRuntime.handleLoadMoreGeneralWorkbenchHistory,
        skillDetailMap:
          generalWorkbenchSidebarRuntime.generalWorkbenchSkillDetailMap,
        messages,
      }}
    />
  );

  const workflowProgressEnabled =
    isSpecializedThemeMode && hasMessages && steps.length > 0;
  const workflowProgressSignature = useMemo(() => {
    if (!workflowProgressEnabled) {
      return "hidden";
    }

    const stepSignature = steps
      .map((step) => `${step.id}:${step.status}:${step.title}`)
      .join("|");
    return `${currentStepIndex}:${stepSignature}`;
  }, [currentStepIndex, steps, workflowProgressEnabled]);
  const lastWorkflowProgressSignatureRef = useRef<string>("");

  useEffect(() => {
    if (!onWorkflowProgressChange) {
      return;
    }

    if (
      lastWorkflowProgressSignatureRef.current === workflowProgressSignature
    ) {
      return;
    }
    lastWorkflowProgressSignatureRef.current = workflowProgressSignature;

    if (!workflowProgressEnabled) {
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
    currentStepIndex,
    onWorkflowProgressChange,
    steps,
    workflowProgressEnabled,
    workflowProgressSignature,
  ]);

  useEffect(() => {
    return () => {
      onWorkflowProgressChange?.(null);
    };
  }, [onWorkflowProgressChange]);
  const navigationActions = useWorkspaceNavigationActions({
    applyProjectSelection,
    compactSession,
    dismissWorkspacePathError,
    fixWorkspacePathAndRetry,
    onNavigate: _onNavigate,
    projectId: projectId || undefined,
    setEntryBannerVisible,
    setWorkspaceHealthError,
    workspacePathMissing,
  });
  const handleSaveMessageAsSkill = useCallback(
    (source: { messageId: string; content: string }) => {
      if (!_onNavigate) {
        toast.error("当前入口暂不支持直接跳转到 Skill 页面");
        return;
      }

      const nextPageParams = buildSkillsPageParamsFromMessage(source, {
        creationProjectId: projectId,
        creationReplay: initialCreationReplay,
      });
      if (!nextPageParams?.initialScaffoldDraft) {
        toast.error("这条结果暂时还不足以生成技能草稿");
        return;
      }

      _onNavigate("skills", nextPageParams);
      toast.success("已带着这条结果去新建 Skill");
    },
    [_onNavigate, initialCreationReplay, projectId],
  );
  const persistInspirationDraft = useCallback(
    (
      draft: {
        request: Parameters<typeof createUnifiedMemory>[0];
        categoryLabel: string;
        title: string;
      },
      options?: {
        successMessage?: string;
      },
    ) => {
      void createUnifiedMemory(draft.request)
        .then((memory) => {
          recordCuratedTaskRecommendationSignalFromMemory(memory, {
            projectId,
            sessionId,
          });
          toast.success(options?.successMessage ?? "已保存到灵感库", {
            description: `${draft.categoryLabel} · ${draft.title}`,
          });
        })
        .catch((error) => {
          console.error("保存到灵感库失败:", error);
          toast.error("保存到灵感库失败，请稍后重试");
        });
    },
    [projectId, sessionId],
  );
  const handleSaveMessageAsInspiration = useCallback(
    (source: { messageId: string; content: string }) => {
      const draft = buildMessageInspirationDraft(
        {
          ...source,
          sessionId,
        },
        {
          creationReplay: initialCreationReplay,
        },
      );

      if (!draft) {
        toast.error("这条结果暂时还不足以沉淀为灵感");
        return;
      }

      persistInspirationDraft(draft);
    },
    [initialCreationReplay, persistInspirationDraft, sessionId],
  );

  const fileManagerAvailable = true;
  const handleToggleFileManagerSidebar = useCallback(() => {
    if (!fileManagerAvailable) {
      return;
    }
    handleSetFileManagerSidebarOpen(!fileManagerSidebarOpen);
  }, [
    fileManagerAvailable,
    fileManagerSidebarOpen,
    handleSetFileManagerSidebarOpen,
  ]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!fileManagerSidebarOpen) {
      if (fileManagerAppSidebarCollapsedRef.current) {
        fileManagerAppSidebarCollapsedRef.current = false;
        window.dispatchEvent(
          new CustomEvent(APP_SIDEBAR_COLLAPSE_EVENT, {
            detail: { collapsed: false, source: "file-manager" },
          }),
        );
      }
      return;
    }

    fileManagerAppSidebarCollapsedRef.current = true;
    window.dispatchEvent(
      new CustomEvent(APP_SIDEBAR_COLLAPSE_EVENT, {
        detail: { collapsed: true, source: "file-manager" },
      }),
    );
    if (window.innerWidth <= FILE_MANAGER_NAV_COLLAPSE_BREAKPOINT_PX) {
      setShowSidebar(false);
    }
    return () => {
      if (!fileManagerAppSidebarCollapsedRef.current) {
        return;
      }
      fileManagerAppSidebarCollapsedRef.current = false;
      window.dispatchEvent(
        new CustomEvent(APP_SIDEBAR_COLLAPSE_EVENT, {
          detail: { collapsed: false, source: "file-manager" },
        }),
      );
    };
  }, [fileManagerSidebarOpen]);

  const inputbarScene = useWorkspaceInputbarSceneRuntime({
    contextVariant: agentEntry === "claw" ? "task-center" : "default",
    setMentionedCharacters,
    taskFiles,
    taskFilesExpanded,
    setTaskFilesExpanded,
    selectedFileId,
    isThemeWorkbench,
    sessionId,
    childSubagentSessions,
    subagentParentContext,
    selectedTeamLabel,
    selectedTeamSummary,
    teamDispatchPreviewState,
    teamMemorySnapshot: resolvedTeamMemoryShadowSnapshot,
    currentSessionTitle: teamSessionRuntime.currentSessionTitle,
    currentSessionRuntimeStatus: teamSessionRuntime.currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus:
      teamSessionRuntime.currentSessionLatestTurnStatus,
    liveRuntimeBySessionId: teamSessionRuntime.liveRuntimeBySessionId,
    liveActivityBySessionId: teamSessionRuntime.liveActivityBySessionId,
    activityRefreshVersionBySessionId:
      teamSessionRuntime.activityRefreshVersionBySessionId,
    handleSendSubagentInput: teamSessionControlRuntime.handleSendSubagentInput,
    handleWaitSubagentSession:
      teamSessionControlRuntime.handleWaitSubagentSession,
    handleWaitActiveTeamSessions:
      teamSessionControlRuntime.handleWaitActiveTeamSessions,
    handleCloseCompletedTeamSessions:
      teamSessionControlRuntime.handleCloseCompletedTeamSessions,
    handleCloseSubagentSession:
      teamSessionControlRuntime.handleCloseSubagentSession,
    handleResumeSubagentSession:
      teamSessionControlRuntime.handleResumeSubagentSession,
    teamWaitSummary: teamSessionControlRuntime.teamWaitSummary,
    teamControlSummary: teamSessionControlRuntime.teamControlSummary,
    handleStopSending: teamSessionControlRuntime.handleStopSending,
    teamWorkspaceEnabled: teamSessionRuntime.teamWorkspaceEnabled,
    handleOpenSubagentSession,
    handleReturnToParentSession,
    input,
    setInput,
    currentGate,
    generalWorkbenchWorkflowSteps:
      generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowSteps,
    steps,
    workflowRunState: themeWorkbenchRunState,
    handleSend,
    isPreparingSend,
    isSending,
    providerType,
    setProviderType,
    model,
    setModel,
    sessionExecutionRuntime: executionRuntime,
    projectId: projectId ?? null,
    projectRootPath: project?.rootPath || null,
    executionStrategy,
    setExecutionStrategy,
    accessMode,
    setAccessMode,
    activeTheme,
    navigationActions,
    selectedTeam,
    handleSelectTeam,
    handleEnableSuggestedTeam,
    layoutMode,
    handleTaskFileClick,
    characters: projectMemory?.characters || [],
    skills,
    serviceSkills: activeTheme === "general" ? serviceSkills : [],
    serviceSkillGroups: activeTheme === "general" ? serviceSkillGroups : [],
    skillsLoading: combinedSkillsLoading,
    onSelectServiceSkill:
      workspaceServiceSkillEntryActions.handleServiceSkillSelect,
    initialInputCapability: effectiveInitialInputCapability,
    initialKnowledgePackSelection,
    setChatToolPreferences,
    handleNavigateToSkillSettings,
    handleRefreshSkills,
    turns,
    threadItems: effectiveThreadItems,
    currentTurnId,
    threadRead,
    activeExecutionRuntime,
    pendingActions,
    submittedActionsInFlight,
    messages: displayMessages,
    queuedTurns,
    resumeThread,
    replayPendingAction,
    promoteQueuedTurn,
    removeQueuedTurn,
    latestAssistantMessageId,
    sessionIdForDiagnostics: sessionId || null,
    generalWorkbenchEntryPrompt,
    handleRestartGeneralWorkbenchEntryPrompt,
    handleContinueGeneralWorkbenchEntryPrompt,
    generalWorkbenchEnabled:
      generalHarnessEntryEnabled && !suppressHomeNavbarUtilityActions,
    harnessPanelVisible:
      !suppressHomeNavbarUtilityActions &&
      contextHarnessRuntime.harnessPanelVisible,
    setHarnessPanelVisible: contextHarnessRuntime.setHarnessPanelVisible,
    harnessState,
    harnessEnvironment: contextHarnessRuntime.harnessEnvironment,
    toolInventory: harnessInventoryRuntime.toolInventory,
    toolInventoryLoading: harnessInventoryRuntime.toolInventoryLoading,
    toolInventoryError: harnessInventoryRuntime.toolInventoryError,
    refreshToolInventory: harnessInventoryRuntime.refreshToolInventory,
    mappedTheme,
    activeRuntimeStatusTitle: contextHarnessRuntime.activeRuntimeStatusTitle,
    handleHarnessLoadFilePreview,
    handleFileClick: handleWorkspaceFileClick,
    showGeneralWorkbenchFloatingInputOverlay:
      shellChromeRuntime.shouldShowGeneralWorkbenchFloatingInputOverlay,
    handleActivateTeamWorkbench,
    chatToolPreferences: effectiveChatToolPreferences,
    defaultCuratedTaskReferenceMemoryIds: defaultCuratedTaskReferenceMemoryIds,
    defaultCuratedTaskReferenceEntries: defaultCuratedTaskReferenceEntries,
    pathReferences,
    onAddPathReferences: handleAddPathReferences,
    onRemovePathReference: handleRemovePathReference,
    onClearPathReferences: handleClearPathReferences,
    fileManagerOpen: fileManagerAvailable && fileManagerSidebarOpen,
    onToggleFileManager: fileManagerAvailable
      ? handleToggleFileManagerSidebar
      : undefined,
    inputCompletionEnabled,
  });
  const importTextAsKnowledge = inputbarScene.onImportTextAsKnowledge;
  const handleSaveMessageAsKnowledge = useCallback(
    (source: { messageId: string; content: string }) => {
      const sourceText = source.content.trim();
      if (!sourceText) {
        toast.error("这条结果暂时没有可沉淀的内容");
        return;
      }
      if (!isUsableKnowledgeSourceText(sourceText)) {
        toast.info("这条结果还不是可复用资料，请先补充原始内容后再沉淀。");
        return;
      }

      importTextAsKnowledge({
        sourceName: `agent-output-${source.messageId}.md`,
        sourceText,
        description: teamSessionRuntime.currentSessionTitle || "对话结果资料",
        packType: "custom",
      });
    },
    [importTextAsKnowledge, teamSessionRuntime.currentSessionTitle],
  );

  const canvasScene = useWorkspaceCanvasSceneRuntime({
    shouldBootstrapCanvasOnEntry,
    normalizedEntryTheme,
    mappedTheme,
    canvasState,
    resolvedCanvasState,
    isInitialContentLoading,
    initialContentLoadError,
    imageWorkbenchGenerationRuntime,
    imageWorkbenchActionRuntime,
    inputbarScene,
    projectRootPath: project?.rootPath || null,
    generalCanvasState,
    setGeneralCanvasState,
    currentCanvasArtifact,
    displayedCanvasArtifact,
    artifactDisplayState,
    artifactViewMode,
    setArtifactViewMode: handleArtifactViewModeChange,
    artifactPreviewSize,
    setArtifactPreviewSize,
    onSaveArtifactDocument: handleSaveArtifactDocument,
    onArtifactBlockRewriteRun: handleArtifactBlockRewriteRun,
    renderArtifactWorkbenchToolbarActions,
    threadItems: effectiveThreadItems,
    focusedBlockId: focusedArtifactBlockId,
    blockFocusRequestKey: artifactBlockFocusRequestKey,
    onJumpToTimelineItem: handleJumpToTimelineItem,
    handleCloseCanvas,
    currentImageWorkbenchState,
    imageWorkbenchPreferenceSummary,
    imageWorkbenchPreferenceWarning,
    setCanvasState,
    handleBackHome,
    isSending,
    handleCanvasSelectionTextChange,
    projectId: projectId ?? null,
    contentId: contentId ?? null,
    sourceThreadId: sessionId ?? null,
    projectName: project?.name || undefined,
    providerType,
    setProviderType,
    model,
    setModel,
    documentThinkingEnabled: effectiveChatToolPreferences.thinking,
    handleDocumentThinkingEnabledChange,
    handleDocumentAutoContinueRun,
    handleAddImage,
    handleImportDocument,
    handleDocumentContentReviewRun,
    handleDocumentTextStylizeRun,
    preferContentReviewInRightRail,
    teamWorkspaceEnabled: teamSessionRuntime.teamWorkspaceEnabled,
    liveActivityBySessionId: teamSessionRuntime.liveActivityBySessionId,
    teamWaitSummary: teamSessionControlRuntime.teamWaitSummary,
    teamControlSummary: teamSessionControlRuntime.teamControlSummary,
    teamWorkbenchAutoFocusToken,
    teamDispatchPreviewState,
    teamMemorySnapshot: resolvedTeamMemoryShadowSnapshot,
  });

  const handleSendFromEmptyState = useCallback(
    (
      text: string,
      sendExecutionStrategy?: "react" | "code_orchestrated" | "auto",
      images?: MessageImage[],
      sendOptions?: HandleSendOptions,
    ) => {
      const normalizedText = text.trim();
      const activeDraftTabId = activeTaskCenterDraftTabIdRef.current;
      if (agentEntry === "claw" && activeDraftTabId) {
        const submittedAt = Date.now();
        const requestId = createTaskCenterDraftSendRequestId();
        recordAgentUiPerformanceMetric("homeInput.submit", {
          hasDraftTab: true,
          inputLength: normalizedText.length,
          requestId,
          sessionId: activeDraftTabId,
          source: "task-center-empty-state",
          workspaceId: taskCenterWorkspaceId,
        });
        if (
          displayMessages.length > 0 ||
          turns.length > 0 ||
          effectiveThreadItems.length > 0
        ) {
          clearMessages({ showToast: false });
        }
        setTaskCenterDraftTabs((current) =>
          current.map((tab) =>
            tab.id === activeDraftTabId
              ? {
                  ...tab,
                  title: resolveTaskCenterDraftSendTitle(text),
                  status: "running",
                  updatedAt: new Date(),
                }
              : tab,
          ),
        );
        setTaskCenterDraftSendRequest({
          id: requestId,
          draftTabId: activeDraftTabId,
          text,
          images: images || [],
          sendExecutionStrategy,
          sendOptions,
          webSearch: effectiveChatToolPreferences.webSearch,
          thinking: effectiveChatToolPreferences.thinking,
          submittedAt,
          materializeDraft: true,
          source: "task-center-empty-state",
        });
        recordAgentUiPerformanceMetric("homeInput.pendingShellApplied", {
          durationMs: Date.now() - submittedAt,
          requestId,
          sessionId: activeDraftTabId,
          source: "task-center-empty-state",
          workspaceId: taskCenterWorkspaceId,
        });
        void materializeTaskCenterDraftTab(activeDraftTabId, {
          reason: "send",
        })
          .catch((error) => {
            recordAgentUiPerformanceMetric("homeInput.draftMaterialize.error", {
              durationMs: Date.now() - submittedAt,
              error: error instanceof Error ? error.message : String(error),
              requestId,
              sessionId: activeDraftTabId,
              source: "task-center-empty-state",
              workspaceId: taskCenterWorkspaceId,
            });
          })
          .finally(() => {
            setTaskCenterDraftSendRequest((current) =>
              current?.id === requestId ? null : current,
            );
          });
        return;
      }

      const shouldQueueHomeSend =
        !hasDisplayMessages &&
        (agentEntry === "claw" || agentEntry === "new-task");
      if (shouldQueueHomeSend) {
        const submittedAt = Date.now();
        const requestId = createTaskCenterDraftSendRequestId();
        const requestSessionKey = sessionId ?? requestId;
        recordAgentUiPerformanceMetric("homeInput.submit", {
          hasDraftTab: false,
          inputLength: normalizedText.length,
          requestId,
          sessionId: requestSessionKey,
          source: "empty-state",
          workspaceId: taskCenterWorkspaceId,
        });
        const request: TaskCenterDraftSendRequest = {
          id: requestId,
          draftTabId: requestSessionKey,
          text,
          images: images || [],
          sendExecutionStrategy,
          sendOptions,
          webSearch: effectiveChatToolPreferences.webSearch,
          thinking: effectiveChatToolPreferences.thinking,
          submittedAt,
          materializeDraft: false,
          source: "empty-state",
        };
        setTaskCenterDraftSendRequest(request);
        setHomePendingPreviewRequest(request);
        recordAgentUiPerformanceMetric("homeInput.pendingShellApplied", {
          durationMs: Date.now() - submittedAt,
          requestId,
          sessionId: requestSessionKey,
          source: "empty-state",
          workspaceId: taskCenterWorkspaceId,
        });
        return;
      }

      recordAgentUiPerformanceMetric("homeInput.submit", {
        hasDraftTab: false,
        inputLength: normalizedText.length,
        sessionId: sessionId ?? null,
        source: "empty-state",
        workspaceId: taskCenterWorkspaceId,
      });
      void handleSend(
        images || [],
        effectiveChatToolPreferences.webSearch,
        effectiveChatToolPreferences.thinking,
        text,
        sendExecutionStrategy,
        undefined,
        sendOptions,
      );
    },
    [
      agentEntry,
      clearMessages,
      displayMessages.length,
      effectiveChatToolPreferences.thinking,
      effectiveChatToolPreferences.webSearch,
      effectiveThreadItems.length,
      handleSend,
      hasDisplayMessages,
      materializeTaskCenterDraftTab,
      sessionId,
      taskCenterWorkspaceId,
      turns.length,
    ],
  );

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    setTaskCenterDraftSendRequest((current) => {
      if (!current || current.materializeDraft) {
        return current;
      }
      return null;
    });
    setHomePendingPreviewRequest(null);
  }, [messages.length]);

  useEffect(() => {
    if (!taskCenterDraftSendRequest) {
      return;
    }

    const request = taskCenterDraftSendRequest;
    let cancelled = false;
    const cancel = scheduleAfterNextPaint(() => {
      if (cancelled) {
        return;
      }

      recordAgentUiPerformanceMetric("homeInput.sendDispatch.start", {
        elapsedMs: Date.now() - request.submittedAt,
        requestId: request.id,
        sessionId: request.draftTabId,
        source: request.source,
        workspaceId: taskCenterWorkspaceId,
      });
      const tracedSendOptions: HandleSendOptions = {
        ...(request.sendOptions || {}),
        // 首页首发代表“创建新对话”，不要先恢复上次会话，否则会把首字链路拖进旧会话 hydration。
        skipSessionRestore: true,
        // 同一条快路径也不应同步跑项目启动 hooks 或 submit 前队列恢复扫描。
        skipSessionStartHooks: true,
        skipPreSubmitResume: true,
        requestMetadata: mergeAgentUiPerformanceTraceMetadata(
          request.sendOptions?.requestMetadata,
          {
            requestId: request.id,
            sessionId: request.draftTabId,
            source: request.source,
            submittedAt: request.submittedAt,
            workspaceId: taskCenterWorkspaceId,
          },
        ),
      };
      const sendPromise = handleSendRef.current(
        request.images,
        request.webSearch,
        request.thinking,
        request.text,
        request.sendExecutionStrategy,
        undefined,
        tracedSendOptions,
      );
      void sendPromise
        .then(
          (result) => {
            recordAgentUiPerformanceMetric("homeInput.sendDispatch.done", {
              durationMs: Date.now() - request.submittedAt,
              requestId: request.id,
              result,
              sessionId: request.draftTabId,
              source: request.source,
              workspaceId: taskCenterWorkspaceId,
            });
          },
          (error) => {
            recordAgentUiPerformanceMetric("homeInput.sendDispatch.error", {
              durationMs: Date.now() - request.submittedAt,
              error: error instanceof Error ? error.message : String(error),
              requestId: request.id,
              sessionId: request.draftTabId,
              source: request.source,
              workspaceId: taskCenterWorkspaceId,
            });
            setHomePendingPreviewRequest((current) =>
              current?.id === request.id ? null : current,
            );
          },
        )
        .finally(() => {
          if (request.materializeDraft) {
            return;
          }
        });
    });

    return () => {
      cancelled = true;
      cancel();
    };
  }, [handleSendRef, taskCenterDraftSendRequest, taskCenterWorkspaceId]);

  const sceneDisplayMessages =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? []
      : displayMessages.length > 0
        ? displayMessages
        : homePendingPreviewMessages;
  const sceneTurns =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? []
      : turns;
  const sceneThreadItems =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? []
      : effectiveThreadItems;
  const sceneCurrentTurnId =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? null
      : currentTurnId;
  const sceneThreadRead =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? null
      : threadRead;
  const scenePendingActions =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? []
      : pendingActions;
  const sceneSubmittedActionsInFlight =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? []
      : submittedActionsInFlight;
  const sceneQueuedTurns =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? []
      : queuedTurns;
  const sceneIsPreparingSend =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? false
      : isPreparingSend || Boolean(taskCenterDraftSendRequest);
  const sceneIsSending =
    taskCenterSessionSwitchPending || shouldSuppressTaskCenterDraftContent
      ? false
      : isSending;

  const conversationSceneRuntime = useWorkspaceConversationSceneRuntime({
    messageListEmptyStateVariant:
      agentEntry === "claw" ? "task-center" : "default",
    navbarContextVariant:
      agentEntry === "claw" || shouldUseBrowserWorkspaceHomeChrome
        ? "task-center"
        : "default",
    navigationActions,
    inputbarScene,
    canvasScene,
    handleSendFromEmptyState,
    shellChromeRuntime,
    generalWorkbenchHarnessDialog,
    teamWorkspaceEnabled: teamSessionRuntime.teamWorkspaceEnabled,
    currentImageWorkbenchActive: currentImageWorkbenchState.active,
    projectId: projectId ?? null,
    deferWorkspaceListLoad: shouldUseBrowserWorkspaceHomeChrome,
    workspaceHintMessage: shouldUseBrowserWorkspaceHomeChrome
      ? BROWSER_WORKSPACE_HOME_HINT_MESSAGE
      : undefined,
    workspaceHintVisible:
      shouldUseBrowserWorkspaceHomeChrome && browserWorkspaceHintVisible,
    onDismissWorkspaceHint: () => {
      setBrowserWorkspaceHintVisible(false);
    },
    projectRootPath: project?.rootPath || null,
    projectCharacters: projectMemory?.characters || [],
    generalCanvasContent: generalCanvasState.content,
    handleToggleHarnessPanel: contextHarnessRuntime.handleToggleHarnessPanel,
    entryBannerVisible,
    entryBannerMessage: effectiveEntryBannerMessage,
    creationReplaySurface: initialCreationReplaySurface,
    defaultCuratedTaskReferenceMemoryIds,
    defaultCuratedTaskReferenceEntries,
    pathReferences,
    onAddPathReferences: handleAddPathReferences,
    onImportPathReferenceAsKnowledge:
      inputbarScene.onImportPathReferenceAsKnowledge,
    onRemovePathReference: handleRemovePathReference,
    onClearPathReferences: handleClearPathReferences,
    fileManagerOpen: fileManagerAvailable && fileManagerSidebarOpen,
    onToggleFileManager: fileManagerAvailable
      ? handleToggleFileManagerSidebar
      : undefined,
    sceneAppExecutionSummaryCard,
    serviceSkillExecutionCard,
    contextWorkspaceEnabled: contextWorkspace.generalWorkbenchEnabled,
    input,
    setInput,
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    accessMode,
    setAccessMode,
    chatToolPreferences: effectiveChatToolPreferences,
    setChatToolPreferences,
    selectedTeam,
    handleSelectTeam,
    handleEnableSuggestedTeam,
    creationMode,
    setCreationMode,
    activeTheme,
    setActiveTheme,
    lockTheme,
    artifacts,
    resolvedCanvasState,
    contentId,
    selectedText,
    handleRecommendationClick,
    skills,
    serviceSkills: activeTheme === "general" ? serviceSkills : [],
    serviceSkillGroups: activeTheme === "general" ? serviceSkillGroups : [],
    skillsLoading: combinedSkillsLoading,
    onSelectServiceSkill:
      workspaceServiceSkillEntryActions.handleServiceSkillSelect,
    handleNavigateToSkillSettings,
    handleRefreshSkills,
    handleOpenBrowserAssistInCanvas: handleOpenBrowserRuntimeForBrowserAssist,
    browserAssistLaunching,
    featuredSceneApps: workspaceSceneAppEntryActions.featuredSceneApps,
    sceneAppsLoading: workspaceSceneAppEntryActions.sceneAppsLoading,
    sceneAppLaunchingId: workspaceSceneAppEntryActions.sceneAppLaunchingId,
    handleLaunchSceneApp: workspaceSceneAppEntryActions.handleLaunchSceneApp,
    canResumeRecentSceneApp,
    handleResumeRecentSceneApp,
    recentSessionTitle: recentSessionTopic?.title ?? null,
    recentSessionSummary: recentSessionTopic?.lastPreview ?? null,
    recentSessionActionLabel,
    handleResumeRecentSession,
    handleOpenSceneAppsDirectory,
    taskCenterTabsNode: shouldRenderTaskCenterTabStrip
      ? taskCenterTabsNode
      : browserWorkspaceHomeTabsNode,
    suppressNavbarUtilityActions: suppressHomeNavbarUtilityActions,
    hideHistoryToggle,
    showChatPanel: effectiveShowChatPanel,
    topBarChrome,
    onBackToProjectManagement,
    fromResources,
    handleBackHome,
    handleToggleSidebar,
    showHarnessToggle: !suppressHomeNavbarUtilityActions && showHarnessToggle,
    navbarHarnessPanelVisible:
      !suppressHomeNavbarUtilityActions && navbarHarnessPanelVisible,
    harnessPendingCount: suppressHomeNavbarUtilityActions
      ? 0
      : harnessPendingCount,
    harnessAttentionLevel: suppressHomeNavbarUtilityActions
      ? "idle"
      : harnessAttentionLevel,
    harnessToggleLabel: suppressHomeNavbarUtilityActions
      ? undefined
      : harnessToggleLabel,
    isAutoRestoringSession:
      isAutoRestoringSession ||
      isSessionHydrating ||
      taskCenterSessionSwitchPending,
    sessionId: shouldSuppressTaskCenterDraftContent ? null : sessionId,
    syncStatus,
    pendingA2UIForm: effectivePendingA2UIForm,
    pendingA2UISource: effectivePendingA2UISource,
    a2uiSubmissionNotice,
    handlePendingA2UISubmit,
    handleToggleCanvas,
    hideInlineStepProgress,
    isSpecializedThemeMode,
    hasMessages,
    steps,
    currentStepIndex,
    goToStep,
    displayMessages: sceneDisplayMessages,
    turns: sceneTurns,
    effectiveThreadItems: sceneThreadItems,
    currentTurnId: sceneCurrentTurnId,
    threadRead: sceneThreadRead,
    pendingActions: scenePendingActions,
    submittedActionsInFlight: sceneSubmittedActionsInFlight,
    queuedTurns: sceneQueuedTurns,
    sessionHistoryWindow,
    loadFullSessionHistory: () => {
      void loadFullSessionHistory();
    },
    isPreparingSend: sceneIsPreparingSend,
    isSending: sceneIsSending,
    stopSending,
    resumeThread,
    replayPendingAction,
    promoteQueuedTurn,
    deleteMessage,
    editMessage,
    handleA2UISubmit: handleMessageA2UISubmit,
    handleWriteFile,
    handleFileClick: handleWorkspaceFileClick,
    handleOpenArtifactFromTimeline,
    handleOpenSavedSiteContent,
    handleArtifactClick: handleWorkspaceArtifactClick,
    handleOpenMessagePreview,
    handleSaveMessageAsSkill,
    handleSaveMessageAsInspiration,
    handleSaveMessageAsKnowledge,
    handleOpenSubagentSession,
    handlePermissionResponse,
    pendingPromotedA2UIActionRequest,
    shouldCollapseCodeBlocks,
    shouldCollapseCodeBlockInChat,
    handleCodeBlockClick,
    layoutMode,
    handleActivateTeamWorkbench,
    isThemeWorkbench,
    settledWorkbenchArtifacts,
    taskFiles,
    selectedFileId,
    handleHarnessLoadFilePreview,
    setCanvasWorkbenchLayoutMode,
    workspacePathMissing: Boolean(workspacePathMissing),
    workspaceHealthError,
    focusedTimelineItemId,
    timelineFocusRequestKey,
  });

  const shellPendingActions = scenePendingActions ?? [];
  const shellQueuedTurns = sceneQueuedTurns ?? [];
  const shellHandleBackHome = handleBackHome ?? (() => undefined);
  const shellHandleOpenSubagentSession =
    handleOpenSubagentSession ?? (() => undefined);
  const shellDisplayMessages = sceneDisplayMessages ?? [];
  const shellIsSending = sceneIsSending ?? false;
  const fileManagerNode =
    fileManagerAvailable && fileManagerSidebarOpen ? (
      <FileManagerSidebar
        onClose={() => handleSetFileManagerSidebarOpen(false)}
        onAddPathReferences={handleAddPathReferences}
        onImportAsKnowledge={inputbarScene.onImportPathReferenceAsKnowledge}
      />
    ) : null;

  return (
    <>
      <WorkspaceShellScene
        compactChrome={shellChromeRuntime.isWorkspaceCompactChrome}
        isThemeWorkbench={isThemeWorkbench}
        generalWorkbenchSidebarNode={generalWorkbenchSidebarNode}
        showChatPanel={effectiveShowChatPanel}
        showSidebar={showSidebar}
        sidebarContextVariant={
          agentEntry === "claw" ? "task-center" : "default"
        }
        showGeneralWorkbenchLeftExpandButton={
          showGeneralWorkbenchLeftExpandButton
        }
        onExpandGeneralWorkbenchSidebar={handleExpandGeneralWorkbenchSidebar}
        fileManagerNode={fileManagerNode}
        mainAreaNode={conversationSceneRuntime.mainAreaNode}
        currentTopicId={activeTaskCenterDraftTabId ?? sessionId ?? null}
        topics={topics}
        onNewChat={shellHandleBackHome}
        onOpenTaskCenterHome={handleOpenTaskCenterNewTaskPage}
        onOpenSkillsPage={handleOpenTaskCenterSkillsPage}
        onOpenKnowledgePage={handleOpenTaskCenterKnowledgePage}
        onOpenMemoryPage={handleOpenTaskCenterMemoryPage}
        onSwitchTopic={handleOpenSidebarTaskTopic}
        onOpenArchivedTopic={handleOpenArchivedTaskTopic}
        onResumeTask={handleResumeSidebarTask}
        onDeleteTopic={deleteTopic}
        onRenameTopic={renameTopic}
        currentMessages={shellDisplayMessages}
        isSending={shellIsSending}
        pendingActionCount={shellPendingActions.length}
        queuedTurnCount={shellQueuedTurns.length}
        threadStatus={threadRead?.status ?? (currentTurnId ? "running" : null)}
        workspaceError={conversationSceneRuntime.workspaceAlertVisible}
        childSubagentSessions={childSubagentSessions}
        subagentParentContext={subagentParentContext}
        onOpenSubagentSession={shellHandleOpenSubagentSession}
        onReturnToParentSession={handleReturnToParentSession}
      />
      <AutomationJobDialog
        open={workspaceServiceSkillEntryActions.automationDialogOpen}
        mode="create"
        workspaces={workspaceServiceSkillEntryActions.automationWorkspaces}
        initialValues={
          workspaceServiceSkillEntryActions.automationDialogInitialValues
        }
        saving={workspaceServiceSkillEntryActions.automationJobSaving}
        onOpenChange={
          workspaceServiceSkillEntryActions.handleAutomationDialogOpenChange
        }
        onSubmit={
          workspaceServiceSkillEntryActions.handleAutomationDialogSubmit
        }
      />
      <AutomationJobDialog
        open={workspaceSceneAppEntryActions.automationDialogOpen}
        mode="create"
        workspaces={workspaceSceneAppEntryActions.automationWorkspaces}
        initialValues={
          workspaceSceneAppEntryActions.automationDialogInitialValues
        }
        saving={workspaceSceneAppEntryActions.automationJobSaving}
        onOpenChange={
          workspaceSceneAppEntryActions.handleAutomationDialogOpenChange
        }
        onSubmit={workspaceSceneAppEntryActions.handleAutomationDialogSubmit}
      />
      <RuntimeReviewDecisionDialog
        open={sceneAppReviewDecisionDialogOpen}
        template={sceneAppReviewDecisionTemplate}
        saving={sceneAppReviewDecisionSaving}
        onOpenChange={setSceneAppReviewDecisionDialogOpen}
        onSave={handleSaveSceneAppExecutionHumanReview}
      />
    </>
  );
}
