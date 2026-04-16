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
import { updateAgentRuntimeSession } from "@/lib/api/agentRuntime";
import {
  getProjectMemory,
  type ProjectMemory,
  type Character,
} from "@/lib/api/memory";
import { logAgentDebug } from "@/lib/agentDebug";
import { setActiveContentTarget } from "@/lib/activeContentTarget";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
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
import {
  useWorkspaceImageWorkbenchActionRuntime,
  type SubmitImageWorkbenchAgentCommandParams,
} from "./workspace/useWorkspaceImageWorkbenchActionRuntime";
import { useWorkspaceImageWorkbenchEventRuntime } from "./workspace/useWorkspaceImageWorkbenchEventRuntime";
import { buildImageSkillLaunchRequestMetadata } from "./workspace/imageSkillLaunch";
import { useWorkspaceImageTaskPreviewRuntime } from "./workspace/useWorkspaceImageTaskPreviewRuntime";
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
import { useWorkspaceInitialSessionNavigation } from "./workspace/useWorkspaceInitialSessionNavigation";
import { WorkspaceGeneralWorkbenchSidebar } from "./workspace/WorkspaceGeneralWorkbenchSidebar";
import { GeneralWorkbenchHarnessDialogSection } from "./workspace/WorkspaceHarnessDialogs";
import { WorkspaceShellScene } from "./workspace/WorkspaceShellScene";
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
import {
  createInitialSessionImageWorkbenchState,
  type SessionImageWorkbenchState,
} from "./workspace/imageWorkbenchHelpers";
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
import { extractCreationReplayMetadata } from "./utils/creationReplayMetadata";
import { buildMessageInspirationDraft } from "./utils/messageInspirationDraft";
import { buildSkillsPageParamsFromMessage } from "./utils/skillScaffoldDraft";
import { AutomationJobDialog } from "@/components/settings-v2/system/automation/AutomationJobDialog";
import { shouldAutoSelectGeneralArtifact } from "./workspace/generalArtifactAutoSelection";
import {
  hasSceneAppRecentVisit,
  resolveSceneAppsPageEntryParams,
  subscribeSceneAppRecentVisits,
} from "@/lib/sceneapp";

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";
const BLANK_HOME_DEFERRED_LOAD_MS = 6_000;
const NOOP_SET_CHAT_MESSAGES: Dispatch<SetStateAction<Message[]>> = () =>
  undefined;

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

export type {
  AgentChatWorkspaceProps,
  WorkflowProgressSnapshot,
} from "./agentChatWorkspaceContract";

export function AgentChatWorkspace({
  onNavigate: _onNavigate,
  projectId: externalProjectId,
  contentId,
  initialSessionId,
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
  initialSessionName,
  entryBannerMessage,
  initialPendingServiceSkillLaunch,
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
  const normalizedEntryTheme = normalizeInitialTheme(initialTheme);
  const shouldAutoCollapseClassicClawSidebar =
    agentEntry === "claw" && normalizedEntryTheme === "general";
  const defaultTopicSidebarVisible =
    showChatPanel && !shouldAutoCollapseClassicClawSidebar;
  const [showSidebar, setShowSidebar] = useState(
    () => defaultTopicSidebarVisible,
  );
  const [input, setInput] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [entryBannerVisible, setEntryBannerVisible] = useState(
    Boolean(entryBannerMessage),
  );
  const shouldBootstrapCanvasOnEntry =
    Boolean(contentId) && isSpecializedWorkbenchTheme(normalizedEntryTheme);

  // 内容创作相关状态
  const [activeTheme, setActiveTheme] = useState<string>(normalizedEntryTheme);
  const [creationMode, setCreationMode] = useState<CreationMode>(
    initialCreationMode ?? "guided",
  );
  const activeSessionIdRef = useRef<string | null>(null);
  const sessionRecentPreferencesBackfillKeyRef = useRef<string | null>(null);
  const syncSessionRecentPreferences = useCallback(
    async (
      sessionId: string,
      preferences: Parameters<
        typeof createSessionRecentPreferencesFromChatToolPreferences
      >[0],
    ) => {
      await updateAgentRuntimeSession({
        session_id: sessionId,
        recent_preferences:
          createSessionRecentPreferencesFromChatToolPreferences(preferences),
      });
    },
    [],
  );
  const syncSessionRecentTeamSelection = useCallback(
    async (
      sessionId: string,
      team: Parameters<
        typeof createSessionRecentTeamSelectionFromTeamDefinition
      >[0],
      theme?: string | null,
    ) => {
      await updateAgentRuntimeSession({
        session_id: sessionId,
        recent_team_selection:
          createSessionRecentTeamSelectionFromTeamDefinition(team, theme),
      });
    },
    [],
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
  const shouldPreserveEntryThemeOnHome =
    agentEntry === "new-task" && !contentId;
  const shouldPreserveBlankHomeSurface =
    shouldPreserveEntryThemeOnHome && normalizedEntryTheme === "general";
  const shouldDeferBlankHomeAuxiliaryLoads = shouldPreserveBlankHomeSurface;
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
    providerLoadMode: shouldPreserveBlankHomeSurface ? "deferred" : "immediate",
    providerDeferredDelayMs: shouldPreserveBlankHomeSurface
      ? BLANK_HOME_DEFERRED_LOAD_MS
      : undefined,
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
    autoLoad: shouldPreserveBlankHomeSurface ? "deferred" : "immediate",
    deferredDelayMs: shouldPreserveBlankHomeSurface
      ? BLANK_HOME_DEFERRED_LOAD_MS
      : undefined,
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
    loadMode: shouldPreserveBlankHomeSurface ? "deferred" : "immediate",
    deferredDelayMs: shouldPreserveBlankHomeSurface
      ? BLANK_HOME_DEFERRED_LOAD_MS
      : undefined,
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
  const sceneGateResumeHandlerRef =
    useRef<
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
      toast.error("当前入口暂不支持跳转到 SceneApp 目录");
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
      toast.error("当前入口暂不支持跳转到 SceneApp 目录");
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

        if (!shouldDeferBlankHomeAuxiliaryLoads) {
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
    shouldDeferBlankHomeAuxiliaryLoads,
    shouldPreserveEntryThemeOnHome,
  ]);

  useEffect(() => {
    if (!shouldDeferBlankHomeAuxiliaryLoads) {
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
        minimumDelayMs: BLANK_HOME_DEFERRED_LOAD_MS,
        idleTimeoutMs: 1_500,
      },
    );

    return () => {
      cancelled = true;
      cancelDeferredLoad();
    };
  }, [projectId, shouldDeferBlankHomeAuxiliaryLoads]);

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

    const cancelDeferredCheck = shouldDeferBlankHomeAuxiliaryLoads
      ? scheduleMinimumDelayIdleTask(runWorkspaceCheck, {
          minimumDelayMs: BLANK_HOME_DEFERRED_LOAD_MS,
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
  }, [projectId, shouldDeferBlankHomeAuxiliaryLoads]);

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
    isAutoRestoringSession = false,
    sessionId,
    createFreshSession,
    ensureSession = async () => null,
    switchTopic: originalSwitchTopic,
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
    initialTopicsLoadMode: shouldPreserveBlankHomeSurface
      ? "deferred"
      : "immediate",
    initialTopicsDeferredDelayMs: shouldPreserveBlankHomeSurface
      ? BLANK_HOME_DEFERRED_LOAD_MS
      : undefined,
    getSyncedSessionRecentPreferences,
  });
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

    void syncSessionRecentPreferences(
      trimmedSessionId,
      fallbackPreferences,
    ).catch((error) => {
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
  const currentImageWorkbenchState = useMemo(
    () =>
      imageWorkbenchBySessionId[imageWorkbenchSessionKey] ||
      createInitialSessionImageWorkbenchState(),
    [imageWorkbenchBySessionId, imageWorkbenchSessionKey],
  );
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
    enabled: workspaceHarnessEnabled,
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
  });
  const handlePendingServiceSkillLaunchSubmit =
    workspaceServiceSkillEntryActions.handlePendingServiceSkillLaunchSubmit;
  useEffect(() => {
    if (!initialPendingServiceSkillLaunchSignature) {
      handledInitialPendingServiceSkillLaunchSignatureRef.current = "";
      return;
    }

    if (activeTheme !== "general" || serviceSkillsLoading || serviceSkillsError) {
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
      initialSlotValues:
        initialPendingServiceSkillLaunch?.initialSlotValues,
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
    resumeSceneGate: async (input) => await sceneGateResumeHandlerRef.current(input),
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

    const latestTerminal = themeWorkbenchBackendRunState?.latest_terminal ?? null;

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
  const [generalWorkbenchEntryCheckPending, setGeneralWorkbenchEntryCheckPending] =
    useState(false);
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

    void (async () => {
      try {
        const backendState = await executionRunGetGeneralWorkbenchState(
          sessionId,
          3,
        ).catch(() => null);

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
    [clearGeneralWorkbenchEntryPrompt, consumeInitialPrompt, initialDispatchKey],
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
    readSessionFile,
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
    resetProjectSelection,
    resetGuideState,
    hasHandledNewChatRequest,
    markNewChatRequestHandled,
    createFreshSession,
    defaultTopicSidebarVisible,
    normalizedInitialTheme: normalizedEntryTheme,
    initialCreationMode,
    newChatAt,
    initialSessionName,
    projectId,
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
    setProject,
    setProjectMemory,
    setActiveTheme,
    setCreationMode,
  });

  const { switchTopic } = useWorkspaceTopicSwitch({
    projectId,
    externalProjectId,
    originalSwitchTopic,
    startTopicProjectResolution,
    finishTopicProjectResolution,
    deferTopicSwitch,
    consumePendingTopicSwitch,
    rememberProjectId,
    getRememberedProjectId,
    loadTopicBoundProjectId: (topicId) =>
      topics.find((topic) => topic.id === topicId)?.workspaceId ||
      loadPersistedSessionWorkspaceId(topicId) ||
      loadPersistedProjectId(`agent_session_workspace_${topicId}`),
    resetTopicLocalState,
  });
  useWorkspaceInitialSessionNavigation({
    initialSessionId,
    currentSessionId: sessionId,
    switchTopic,
  });

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
  }, [effectiveChatToolPreferences.thinking, handleSendRef, webSearchPreferenceRef]);
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

  // 布局层按实际展示内容判断，避免 bootstrap 预览等临时消息仍被视为空白态。
  const hasDisplayMessages = displayMessages.length > 0;
  const hasMessages = hasDisplayMessages;
  const effectiveShowChatPanel =
    showChatPanel ||
    (agentEntry === "new-task" &&
      (hasDisplayMessages ||
        isThemeWorkbench ||
        (!shouldUseCompactGeneralWorkbench && isBootstrapDispatchPending) ||
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

  const handleResumeSidebarTask = useCallback(
    async (topicId: string, _statusReason?: TaskStatusReason) => {
      await switchTopic(topicId, { forceRefresh: true });
    },
    [switchTopic],
  );

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
      const nextFilePath =
        relativePath?.trim() || preview.path || absolutePath;
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
    [
      _onNavigate,
      openProjectFilePreviewInCanvas,
      project?.rootPath,
      projectId,
    ],
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
        const matchedTaskFile = taskFiles.find(
          (file) => doesWorkspaceFileCandidateMatch(file.name, normalizedArtifactPath),
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
      handleWorkspaceFileClick(target.filePath, target.content);

      const normalizedBlockId = target.blockId?.trim();
      if (!normalizedBlockId) {
        return;
      }

      setFocusedArtifactBlockId(normalizedBlockId);
      setArtifactBlockFocusRequestKey((current) => current + 1);
    },
    [handleWorkspaceFileClick],
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

      const matchedTaskFile = taskFiles.find(
        (file) => doesWorkspaceFileCandidateMatch(file.name, normalizedPath),
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

    const absolutePath = resolveAbsoluteWorkspacePath(project?.rootPath, relativePath);
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
    () => (
      <ServiceSkillExecutionCard
        state={siteSkillExecutionState}
        onOpenBrowserRuntime={
          siteSkillExecutionState?.phase === "blocked"
            ? handleOpenBrowserRuntimeForSiteSkillExecution
            : undefined
        }
        preferredResultFileTarget={preferredServiceSkillResultFileTarget}
        onOpenResultFile={handleOpenServiceSkillResultFile}
        onOpenSavedSiteContent={handleOpenSavedSiteContent}
      />
    ),
    [
      handleOpenServiceSkillResultFile,
      handleOpenBrowserRuntimeForSiteSkillExecution,
      handleOpenSavedSiteContent,
      preferredServiceSkillResultFileTarget,
      siteSkillExecutionState,
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
      !sessionId ||
      messages.length > 0 ||
      isSending
    ) {
      return;
    }

    if (consumedInitialPromptRef.current === initialDispatchKey) {
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
  useWorkspaceVideoTaskActionRuntime({
    projectId,
    contentId,
    setChatMessages,
  });

  const shellChromeRuntime = useMemo(() => {
    const hasUnconsumedInitialDispatch =
      !shouldUseCompactGeneralWorkbench && isBootstrapDispatchPending;

    const showChatLayout =
      agentEntry === "claw" ||
      hasDisplayMessages ||
      hasPendingA2UIForm ||
      isThemeWorkbench ||
      hasUnconsumedInitialDispatch ||
      isSending ||
      queuedTurns.length > 0;

    const shouldHideGeneralWorkbenchInputForTheme =
      shouldUseCompactGeneralWorkbench;
    const shouldShowGeneralWorkbenchFloatingInputOverlay =
      isThemeWorkbench &&
      showChatLayout &&
      !shouldHideGeneralWorkbenchInputForTheme;
    const isWorkspaceCompactChrome = topBarChrome === "workspace-compact";
    const shouldRenderBrandedEmptyState = !showChatLayout;
    const shouldRenderTopBar = !hideTopBar && !shouldRenderBrandedEmptyState;
    const shouldRenderInlineA2UI = isSpecializedThemeMode;

    const shouldUseTeamPrimaryChatPanelWidth =
      layoutMode === "chat-canvas" &&
      teamSessionRuntime.teamWorkspaceEnabled &&
      (teamSessionRuntime.hasRuntimeSessions || Boolean(teamDispatchPreviewState));

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
    isSending,
    isSpecializedThemeMode,
    isThemeWorkbench,
    layoutMode,
    queuedTurns.length,
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
  const handleDeleteGeneralWorkbenchVersion = useCallback(
    () => undefined,
    [],
  );
  const handleCollapseGeneralWorkbenchSidebar = useCallback(() => {
    generalWorkbenchScaffoldRuntime.setGeneralWorkbenchSidebarCollapsed(true);
  }, [generalWorkbenchScaffoldRuntime]);
  const handleExpandGeneralWorkbenchSidebar = useCallback(() => {
    generalWorkbenchScaffoldRuntime.setGeneralWorkbenchSidebarCollapsed(false);
  }, [generalWorkbenchScaffoldRuntime]);
  const generalWorkbenchHarnessDialog = (
    <GeneralWorkbenchHarnessDialogSection
      enabled={
        contextHarnessRuntime.workbenchEnabled &&
        contextHarnessRuntime.isThemeWorkbench
      }
      open={contextHarnessRuntime.harnessPanelVisible}
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
        branchItems: generalWorkbenchScaffoldRuntime.branchItems,
        onCreateVersionSnapshot: handleCreateVersionSnapshot,
        onSwitchBranchVersion: handleSwitchBranchVersion,
        onDeleteTopic: handleDeleteGeneralWorkbenchVersion,
        onSetBranchStatus: handleSetBranchStatus,
        workflowSteps:
          generalWorkbenchSidebarRuntime.generalWorkbenchWorkflowSteps,
        onAddImage: handleAddImage,
        onImportDocument: handleImportDocument,
        activityLogs: generalWorkbenchSidebarRuntime.generalWorkbenchActivityLogs,
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
          generalWorkbenchSidebarRuntime
            .handleLoadMoreGeneralWorkbenchHistory,
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
  const handleSaveMessageAsInspiration = useCallback(
    (source: { messageId: string; content: string }) => {
      const draft = buildMessageInspirationDraft({
        ...source,
        sessionId,
      }, {
        creationReplay: initialCreationReplay,
      });

      if (!draft) {
        toast.error("这条结果暂时还不足以沉淀为灵感");
        return;
      }

      void createUnifiedMemory(draft.request)
        .then(() => {
          toast.success("已保存到灵感库", {
            description: `${draft.categoryLabel} · ${draft.title}`,
          });
        })
        .catch((error) => {
          console.error("保存到灵感库失败:", error);
          toast.error("保存到灵感库失败，请稍后重试");
        });
    },
    [initialCreationReplay, sessionId],
  );

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
    currentSessionRuntimeStatus:
      teamSessionRuntime.currentSessionRuntimeStatus,
    currentSessionLatestTurnStatus:
      teamSessionRuntime.currentSessionLatestTurnStatus,
    liveRuntimeBySessionId: teamSessionRuntime.liveRuntimeBySessionId,
    liveActivityBySessionId: teamSessionRuntime.liveActivityBySessionId,
    activityRefreshVersionBySessionId:
      teamSessionRuntime.activityRefreshVersionBySessionId,
    handleSendSubagentInput:
      teamSessionControlRuntime.handleSendSubagentInput,
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
    generalWorkbenchEnabled: workspaceHarnessEnabled && chatMode === "general",
    harnessPanelVisible: contextHarnessRuntime.harnessPanelVisible,
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
  });

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
    ) => {
      void handleSend(
        images || [],
        effectiveChatToolPreferences.webSearch,
        effectiveChatToolPreferences.thinking,
        text,
        sendExecutionStrategy,
      );
    },
    [
      effectiveChatToolPreferences.thinking,
      effectiveChatToolPreferences.webSearch,
      handleSend,
    ],
  );

  const conversationSceneRuntime = useWorkspaceConversationSceneRuntime({
    messageListEmptyStateVariant:
      agentEntry === "claw" ? "task-center" : "default",
    navbarContextVariant: agentEntry === "claw" ? "task-center" : "default",
    navigationActions,
    inputbarScene,
    canvasScene,
    handleSendFromEmptyState,
    shellChromeRuntime,
    generalWorkbenchHarnessDialog,
    teamWorkspaceEnabled: teamSessionRuntime.teamWorkspaceEnabled,
    currentImageWorkbenchActive: currentImageWorkbenchState.active,
    projectId: projectId ?? null,
    projectRootPath: project?.rootPath || null,
    projectCharacters: projectMemory?.characters || [],
    generalCanvasContent: generalCanvasState.content,
    handleToggleHarnessPanel: contextHarnessRuntime.handleToggleHarnessPanel,
    entryBannerVisible,
    entryBannerMessage,
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
    handleOpenSceneAppsDirectory,
    hideHistoryToggle,
    showChatPanel: effectiveShowChatPanel,
    topBarChrome,
    onBackToProjectManagement,
    fromResources,
    handleBackHome,
    handleToggleSidebar,
    showHarnessToggle,
    navbarHarnessPanelVisible,
    harnessPendingCount,
    harnessAttentionLevel,
    harnessToggleLabel,
    isAutoRestoringSession,
    sessionId,
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
    displayMessages,
    turns,
    effectiveThreadItems,
    currentTurnId,
    threadRead,
    pendingActions,
    submittedActionsInFlight,
    queuedTurns,
    isPreparingSend,
    isSending,
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

  const shellPendingActions = pendingActions ?? [];
  const shellQueuedTurns = queuedTurns ?? [];
  const shellHandleBackHome = handleBackHome ?? (() => undefined);
  const shellHandleOpenSubagentSession =
    handleOpenSubagentSession ?? (() => undefined);
  const shellDisplayMessages = displayMessages ?? [];
  const shellIsSending = isSending ?? false;

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
        mainAreaNode={conversationSceneRuntime.mainAreaNode}
        currentTopicId={sessionId ?? null}
        topics={topics}
        onNewChat={shellHandleBackHome}
        onSwitchTopic={switchTopic}
        onResumeTask={handleResumeSidebarTask}
        onDeleteTopic={deleteTopic}
        onRenameTopic={renameTopic}
        currentMessages={shellDisplayMessages}
        isSending={shellIsSending}
        pendingActionCount={shellPendingActions.length}
        queuedTurnCount={shellQueuedTurns.length}
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
    </>
  );
}
