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
import { toast } from "sonner";
import { useAgentChatUnified } from "./hooks";
import { type TaskStatusReason } from "./hooks/agentChatShared";
import {
  settleLiveArtifactAfterStreamStops,
  useArtifactDisplayState,
} from "./hooks/useArtifactDisplayState";
import { useCompatSubagentRuntime } from "./hooks/useCompatSubagentRuntime";
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
import { generateThemeWorkbenchPrompt } from "@/lib/workspace/workbenchPrompt";
import { generateProjectMemoryPrompt } from "@/lib/workspace/workbenchPrompt";
import {
  getProject,
  getContent,
  getThemeWorkbenchDocumentState,
  ensureWorkspaceReady,
  type Project,
} from "@/lib/api/project";
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
import {
  buildTeamMemoryShadowRequestMetadata,
  readTeamMemorySnapshot,
} from "@/lib/teamMemorySync";

import type {
  Message,
  SiteSavedContentTarget,
  WriteArtifactContext,
} from "./types";
import {
  isSpecializedWorkbenchTheme,
  type LayoutMode,
  type ThemeType,
} from "@/lib/workspace/workbenchContract";
import { normalizeProjectId } from "./utils/topicProjectResolution";
import { buildHarnessRequestMetadata } from "./utils/harnessRequestMetadata";
import { deriveHarnessSessionState } from "./utils/harnessState";
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
import {
  buildRealSubagentTimelineItems,
  buildSyntheticSubagentTimelineItems,
} from "./utils/subagentTimeline";
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
import { useBootstrapDispatchPreview } from "./hooks/useBootstrapDispatchPreview";
import { useRuntimeTeamFormation } from "./hooks/useRuntimeTeamFormation";
import { useThemeWorkbenchEntryPrompt } from "./hooks/useThemeWorkbenchEntryPrompt";
import { useThemeWorkbenchEntryPromptActions } from "./hooks/useThemeWorkbenchEntryPromptActions";
import { useThemeWorkbenchSendBoundary } from "./hooks/useThemeWorkbenchSendBoundary";
import type { BrowserTaskPreflight } from "./hooks/handleSendTypes";
import { mergeThreadItems } from "./utils/threadTimelineView";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  asRecord,
  isResumableBrowserTaskReason,
  mergeMessageArtifactsIntoStore,
  readFirstString,
} from "./workspace/browserAssistArtifact";
import { ServiceSkillExecutionCard } from "./workspace/ServiceSkillExecutionCard";
import { useWorkspaceBrowserAssistRuntime } from "./workspace/useWorkspaceBrowserAssistRuntime";
import { useWorkspaceBrowserPreflightRuntime } from "./workspace/useWorkspaceBrowserPreflightRuntime";
import { useWorkspaceA2UISubmitActions } from "./workspace/useWorkspaceA2UISubmitActions";
import { useWorkspaceContextHarnessRuntime } from "./workspace/useWorkspaceContextHarnessRuntime";
import { useWorkspaceHarnessInventoryRuntime } from "./workspace/useWorkspaceHarnessInventoryRuntime";
import { useWorkspaceCanvasWorkflowActions } from "./workspace/useWorkspaceCanvasWorkflowActions";
import { useWorkspaceCanvasSceneRuntime } from "./workspace/useWorkspaceCanvasSceneRuntime";
import { useWorkspaceCanvasMessageSyncRuntime } from "./workspace/useWorkspaceCanvasMessageSyncRuntime";
import { useWorkspaceConversationShellSceneRuntime } from "./workspace/useWorkspaceConversationShellSceneRuntime";
import { useWorkspaceDisplayMessagesRuntime } from "./workspace/useWorkspaceDisplayMessagesRuntime";
import { useWorkspaceInputbarSceneRuntime } from "./workspace/useWorkspaceInputbarSceneRuntime";
import { useWorkspaceNavigationActions } from "./workspace/useWorkspaceNavigationActions";
import { useWorkspaceShellChromeRuntime } from "./workspace/useWorkspaceShellChromeRuntime";
import { useWorkspaceWriteFileAction } from "./workspace/useWorkspaceWriteFileAction";
import { useWorkspaceArtifactPreviewActions } from "./workspace/useWorkspaceArtifactPreviewActions";
import { useWorkspaceWorkflowProgressSync } from "./workspace/useWorkspaceWorkflowProgressSync";
import { useWorkspaceCanvasLayoutRuntime } from "./workspace/useWorkspaceCanvasLayoutRuntime";
import { useWorkspaceCanvasTaskFileSync } from "./workspace/useWorkspaceCanvasTaskFileSync";
import { useWorkspaceGeneralResourceSync } from "./workspace/useWorkspaceGeneralResourceSync";
import { useWorkspaceArtifactWorkbenchActions } from "./workspace/useWorkspaceArtifactWorkbenchActions";
import { useWorkspaceImageWorkbenchActionRuntime } from "./workspace/useWorkspaceImageWorkbenchActionRuntime";
import { useWorkspaceImageWorkbenchEventRuntime } from "./workspace/useWorkspaceImageWorkbenchEventRuntime";
import { useWorkspaceRuntimeTeamDispatchPreviewRuntime } from "./workspace/useWorkspaceRuntimeTeamDispatchPreviewRuntime";
import { useWorkspaceSessionRestore } from "./workspace/useWorkspaceSessionRestore";
import { useWorkspaceResetRuntime } from "./workspace/useWorkspaceResetRuntime";
import { useWorkspaceSendActions } from "./workspace/useWorkspaceSendActions";
import { useWorkspaceTeamSessionControlRuntime } from "./workspace/useWorkspaceTeamSessionControlRuntime";
import { useWorkspaceTeamWorkbenchAutoOpenRuntime } from "./workspace/useWorkspaceTeamWorkbenchAutoOpenRuntime";
import { useWorkspaceThemeWorkbenchScaffoldRuntime } from "./workspace/useWorkspaceThemeWorkbenchScaffoldRuntime";
import { useWorkspaceThemeWorkbenchVersionStatusRuntime } from "./workspace/useWorkspaceThemeWorkbenchVersionStatusRuntime";
import { useWorkspaceTopicSwitch } from "./workspace/useWorkspaceTopicSwitch";
import { useWorkspaceA2UIRuntime } from "./workspace/useWorkspaceA2UIRuntime";
import { useWorkspaceAutoGuideRuntime } from "./workspace/useWorkspaceAutoGuideRuntime";
import { useWorkspaceThemeWorkbenchSidebarRuntime } from "./workspace/useWorkspaceThemeWorkbenchSidebarRuntime";
import { useWorkspaceThemeWorkbenchRuntime } from "./workspace/useWorkspaceThemeWorkbenchRuntime";
import { useWorkspaceThemeWorkbenchShellRuntime } from "./workspace/useWorkspaceThemeWorkbenchShellRuntime";
import { useWorkspaceContextDetailActions } from "./workspace/useWorkspaceContextDetailActions";
import { useWorkspaceTeamSessionRuntime } from "./workspace/useWorkspaceTeamSessionRuntime";
import { useWorkspaceThemeWorkbenchDocumentPersistenceRuntime } from "./workspace/useWorkspaceThemeWorkbenchDocumentPersistenceRuntime";
import { useWorkspaceServiceSkillEntryActions } from "./workspace/useWorkspaceServiceSkillEntryActions";
import { useWorkspaceArtifactViewModeControl } from "./workspace/useWorkspaceArtifactViewModeControl";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import type { ArtifactDocumentV1 } from "@/lib/artifact-document";
import type { ArtifactTimelineOpenTarget } from "./utils/artifactTimelineNavigation";
import {
  createInitialSessionImageWorkbenchState,
  type SessionImageWorkbenchState,
} from "./workspace/imageWorkbenchHelpers";
import {
  SOCIAL_ARTICLE_SKILL_KEY,
  THEME_WORKBENCH_HISTORY_PAGE_SIZE,
  applyBackendThemeWorkbenchDocumentState,
  isCorruptedThemeWorkbenchDocumentContent,
  isSyncContentEmpty,
  readPersistedThemeWorkbenchDocument,
  serializeCanvasStateForSync,
} from "./workspace/themeWorkbenchHelpers";
import {
  normalizeInitialTheme,
  projectTypeToTheme,
} from "./agentChatWorkspaceShared";
import type { AgentChatWorkspaceProps } from "./agentChatWorkspaceContract";
import { ServiceSkillLaunchDialog } from "./service-skills/ServiceSkillLaunchDialog";
import { AutomationJobDialog } from "@/components/settings-v2/system/automation/AutomationJobDialog";

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";

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
    if (candidate.type !== "browser_assist") {
      return candidate;
    }
  }

  return null;
}

export type {
  AgentChatWorkspaceProps,
  WorkflowProgressSnapshot,
} from "./agentChatWorkspaceContract";

export function AgentChatWorkspace({
  onNavigate: _onNavigate,
  projectId: externalProjectId,
  contentId,
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
    generateImage: runImageWorkbenchGeneration,
    cancelGeneration: cancelImageWorkbenchGeneration,
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
    autoLoad: "immediate",
    logScope: "AgentChatPage",
    onError: (error) => {
      console.warn("[AgentChatPage] 加载 skills 失败:", error);
    },
  });
  const {
    skills: serviceSkills,
    isLoading: serviceSkillsLoading,
    error: serviceSkillsError,
    recordUsage: recordServiceSkillUsage,
  } = useServiceSkills(activeTheme === "general");

  useEffect(() => {
    if (activeTheme !== "general" || !serviceSkillsError) {
      return;
    }

    toast.error(`加载技能目录失败：${serviceSkillsError}`);
  }, [activeTheme, serviceSkillsError]);
  const combinedSkillsLoading = skillsLoading || serviceSkillsLoading;

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
  const defaultSelectedArtifact = useMemo(
    () => resolveDefaultSelectedArtifact(activeTheme, artifacts),
    [activeTheme, artifacts],
  );
  const liveArtifact = useMemo(
    () => selectedArtifact || defaultSelectedArtifact,
    [defaultSelectedArtifact, selectedArtifact],
  );

  // Artifact 预览状态
  const [artifactPreviewSize, setArtifactPreviewSize] = useState<
    "mobile" | "tablet" | "desktop"
  >("desktop");
  const [canvasWorkbenchLayoutMode, setCanvasWorkbenchLayoutMode] =
    useState<CanvasWorkbenchLayoutMode>("split");
  const [browserTaskPreflight, setBrowserTaskPreflight] =
    useState<BrowserTaskPreflight | null>(null);
  const [focusedArtifactBlockId, setFocusedArtifactBlockId] = useState<
    string | null
  >(null);
  const [artifactBlockFocusRequestKey, setArtifactBlockFocusRequestKey] =
    useState(0);
  const [focusedTimelineItemId, setFocusedTimelineItemId] = useState<
    string | null
  >(null);
  const [timelineFocusRequestKey, setTimelineFocusRequestKey] = useState(0);
  const autoCollapsedTopicSidebarRef = useRef(false);

  useEffect(() => {
    if (activeTheme === "general") {
      return;
    }
    setBrowserTaskPreflight(null);
  }, [activeTheme]);

  // 跳转到技能主页面
  const handleNavigateToSkillSettings = useCallback(() => {
    _onNavigate?.("skills");
  }, [_onNavigate]);
  const handleOpenSavedSiteContent = useCallback(
    ({ projectId, contentId }: SiteSavedContentTarget) => {
      _onNavigate?.("agent", {
        projectId,
        contentId,
        lockTheme: true,
        fromResources: true,
      });
    },
    [_onNavigate],
  );

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
      prompt = generateThemeWorkbenchPrompt(mappedTheme, creationMode);
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
    setMessages: setChatMessages,
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

  const hasRealTeamGraph =
    childSubagentSessions.length > 0 || Boolean(subagentParentContext);
  const {
    clearRuntimeTeamState: clearPreparedRuntimeTeamState,
    prepareRuntimeTeamBeforeSend,
  } = useRuntimeTeamFormation({
    projectId,
    sessionId,
    selectedTeam,
    subagentEnabled: effectiveChatToolPreferences.subagent,
    hasRealTeamGraph,
  });
  const {
    runtimeTeamDispatchPreview,
    runtimeTeamPreviewState,
    clearRuntimeTeamDispatchPreview,
    setRuntimeTeamDispatchPreview,
  } = useWorkspaceRuntimeTeamDispatchPreviewRuntime({
    messagesLength: messages.length,
    sessionId,
  });
  const teamDispatchPreviewState = runtimeTeamPreviewState;
  const clearRuntimeTeamState = useCallback(() => {
    clearPreparedRuntimeTeamState();
    clearRuntimeTeamDispatchPreview();
  }, [clearPreparedRuntimeTeamState, clearRuntimeTeamDispatchPreview]);
  const imageWorkbenchSessionKey = useMemo(
    () => sessionId?.trim() || "__local_image_workbench__",
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
  const appendLocalDispatchMessages = useCallback(
    (nextMessages: Message[]) => {
      setChatMessages((previous) => [...previous, ...nextMessages]);
    },
    [setChatMessages],
  );
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
  const {
    teamWorkbenchAutoFocusToken,
    dismissActiveTeamWorkbenchAutoOpen,
    handleActivateTeamWorkbench,
  } = useWorkspaceTeamWorkbenchAutoOpenRuntime({
    hasRealTeamGraph: teamSessionRuntime.hasRealTeamGraph,
    layoutMode,
    runtimeTeamRequestId: runtimeTeamDispatchPreview?.key ?? null,
    sessionId,
    setLayoutMode,
  });
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
    isBrowserAssistReady,
    isBrowserAssistCanvasVisible,
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
  const serviceSkillExecutionCard = useMemo(
    () => (
      <ServiceSkillExecutionCard
        state={siteSkillExecutionState}
        onOpenBrowserRuntime={
          siteSkillExecutionState?.phase === "blocked"
            ? handleOpenBrowserRuntimeForSiteSkillExecution
            : undefined
        }
      />
    ),
    [handleOpenBrowserRuntimeForSiteSkillExecution, siteSkillExecutionState],
  );

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
    compatSubagentRuntime,
  });
  const {
    contextWorkspace,
    isThemeWorkbench,
    harnessPanelVisible,
    harnessPendingCount,
    showHarnessToggle,
    harnessAttentionLevel,
    navbarHarnessPanelVisible,
  } = contextHarnessRuntime;
  const themeWorkbenchScaffoldRuntime =
    useWorkspaceThemeWorkbenchScaffoldRuntime({
      isThemeWorkbench,
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
    shouldUseCompactThemeWorkbench,
    shouldSkipThemeWorkbenchAutoGuideWithoutPrompt,
    setTopicStatus,
  } = themeWorkbenchScaffoldRuntime;

  useWorkspaceThemeWorkbenchDocumentPersistenceRuntime({
    isThemeWorkbench,
    contentId,
    canvasState,
    documentVersionStatusMap,
    contentMetadataRef,
    persistedWorkbenchSnapshotRef,
  });

  const {
    a2uiSubmissionNotice,
    pendingA2UIForm,
    pendingA2UISource,
    pendingActionRequest,
    pendingLegacyQuestionnaireA2UIForm,
    pendingPromotedA2UIActionRequest,
    resolvePendingA2UISubmit,
  } = useWorkspaceA2UIRuntime({
    messages,
  });
  const hasPendingA2UIForm = Boolean(pendingA2UIForm);
  const suppressCanvasAutoOpenForPendingA2UI = hasPendingA2UIForm;

  const {
    currentGate,
    documentEditorFocusedRef,
    themeWorkbenchActiveQueueItem,
    themeWorkbenchBackendRunState,
    themeWorkbenchRunState,
  } = useWorkspaceThemeWorkbenchRuntime({
    isThemeWorkbench,
    sessionId,
    isSending,
    pendingActionRequest,
  });

  const themeWorkbenchSidebarRuntime = useWorkspaceThemeWorkbenchSidebarRuntime(
    {
      isThemeWorkbench,
      sessionId,
      messages,
      isSending,
      themeWorkbenchBackendRunState,
      contextActivityLogs: contextWorkspace.activityLogs,
      historyPageSize: THEME_WORKBENCH_HISTORY_PAGE_SIZE,
    },
  );

  const { handleViewContextDetail } = useWorkspaceContextDetailActions({
    contextWorkspace,
  });

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
        sessionMode: isThemeWorkbench ? "theme_workbench" : "default",
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
        teamMemoryShadow:
          buildTeamMemoryShadowRequestMetadata(resolvedTeamMemoryShadowSnapshot),
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

  useWorkspaceThemeWorkbenchVersionStatusRuntime({
    isThemeWorkbench,
    themeWorkbenchRunState,
    canvasState,
    latestTerminal: themeWorkbenchBackendRunState?.latest_terminal ?? null,
    setDocumentVersionStatusMap,
  });

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
  const {
    initialDispatchKey,
    isBootstrapDispatchPending,
    bootstrapDispatchPreviewMessages,
  } = useBootstrapDispatchPreview({
    initialUserPrompt,
    initialUserImages,
    browserTaskPreflight,
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
    autoRunInitialPromptOnMount,
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
  const prepareBrowserTaskPreflight = useCallback(
    (preflight: BrowserTaskPreflight) => {
      setBrowserTaskPreflight(preflight);
    },
    [],
  );
  const {
    resolveSendBoundary,
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
    onConsumeInitialPrompt: consumeInitialPrompt,
    onResetConsumedInitialPrompt: resetConsumedInitialPrompt,
    onClearEntryPrompt: clearThemeWorkbenchEntryPrompt,
    onPrepareBrowserTaskPreflight: prepareBrowserTaskPreflight,
  });
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
  const { handleClearMessages, handleBackHome, resetTopicLocalState } =
    useWorkspaceResetRuntime({
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
      setBrowserTaskPreflight,
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

  const imageWorkbenchActionRuntime = useWorkspaceImageWorkbenchActionRuntime({
    appendLocalDispatchMessages,
    cancelImageWorkbenchGeneration,
    contentId,
    currentImageWorkbenchState,
    imageWorkbenchSelectedSize,
    imageWorkbenchSessionKey,
    projectId,
    runImageWorkbenchGeneration,
    saveImageWorkbenchImagesToResource,
    setCanvasState,
    setInput,
    setLayoutMode,
    setMentionedCharacters,
    updateCurrentImageWorkbenchState,
  });
  const { handleImageWorkbenchCommand } = imageWorkbenchActionRuntime;
  const workspaceServiceSkillEntryActions =
    useWorkspaceServiceSkillEntryActions({
      activeTheme,
      creationMode,
      projectId,
      contentId,
      input,
      chatToolPreferences: effectiveChatToolPreferences,
      preferredTeamPresetId,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      onNavigate: _onNavigate,
      recordServiceSkillUsage,
    });

  const {
    handleSend,
    handleRecommendationClick,
    handleSendRef,
    webSearchPreferenceRef,
    submissionPreview,
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
      enabled: contextWorkspace.enabled,
      activeContextPrompt: contextWorkspace.activeContextPrompt,
      prepareActiveContextPrompt: contextWorkspace.prepareActiveContextPrompt,
    },
    projectId,
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
    messagesCount: messages.length,
    sendMessage,
    resolveSendBoundary,
    maybeStartBrowserTaskPreflight,
    finalizeAfterSendSuccess,
    rollbackAfterSendFailure,
    prepareRuntimeTeamBeforeSend,
    setRuntimeTeamDispatchPreview,
    ensureBrowserAssistCanvas,
    handleAutoLaunchMatchedSiteSkill:
      workspaceServiceSkillEntryActions.handleAutoLaunchMatchedSiteSkill,
    handleImageWorkbenchCommand,
  });

  const {
    handleContinueThemeWorkbenchEntryPrompt,
    handleRestartThemeWorkbenchEntryPrompt,
  } = useThemeWorkbenchEntryPromptActions({
    themeWorkbenchEntryPrompt,
    input,
    initialDispatchKey,
    onContinuePrompt: async (promptToSend) => {
      await handleSendRef.current(
        [],
        webSearchPreferenceRef.current,
        effectiveChatToolPreferences.thinking,
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
  const {
    browserAssistEntryLabel,
    browserAssistAttentionLevel,
    handlePermissionResponseWithBrowserPreflight,
  } = useWorkspaceBrowserPreflightRuntime({
    browserTaskPreflight,
    setBrowserTaskPreflight,
    browserAssistLaunching,
    isBrowserAssistReady,
    ensureBrowserAssistCanvas,
    handlePermissionResponse,
  });
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
    onRunImageWorkbenchCommand: handleImageWorkbenchCommand,
  });
  const { handleInputbarA2UISubmit } = useWorkspaceA2UISubmitActions({
    handlePermissionResponseWithBrowserPreflight,
    pendingLegacyQuestionnaireA2UIForm,
    pendingPromotedA2UIActionRequest,
    resolvePendingA2UISubmit,
    sendMessage,
  });
  const handleMessageA2UISubmit = useCallback(
    (
      formData: Parameters<typeof handleInputbarA2UISubmit>[0],
      _messageId: string,
    ) => {
      handleInputbarA2UISubmit(formData);
    },
    [handleInputbarA2UISubmit],
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

  const { displayMessages } = useWorkspaceDisplayMessagesRuntime({
    browserTaskPreflight,
    bootstrapDispatchPreviewMessages,
    isSending,
    messages,
    pendingActionCount: pendingActions.length,
    queuedTurnCount: queuedTurns.length,
    runtimeTeamDispatchPreview,
    submissionPreview,
    sessionId,
    updateTopicSnapshot,
    workspaceError: Boolean(workspacePathMissing || workspaceHealthError),
  });
  const latestAssistantMessageId = useMemo(
    () =>
      [...displayMessages]
        .reverse()
        .find((message) => message.role === "assistant")?.id ?? null,
    [displayMessages],
  );

  // 布局层按实际展示内容判断，避免 browser preflight / bootstrap 预览仍被视为空白态。
  const hasDisplayMessages = displayMessages.length > 0;
  const hasMessages = hasDisplayMessages;

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
    showChatPanel,
    showSidebar,
    defaultTopicSidebarVisible,
    hasMessages,
    canvasWorkbenchLayoutMode,
    autoCollapsedTopicSidebarRef,
    mappedTheme,
    normalizedEntryTheme,
    shouldBootstrapCanvasOnEntry,
    canvasState,
    generalCanvasState,
    showTeamWorkspaceBoard: teamSessionRuntime.showTeamWorkspaceBoard,
    hasCurrentCanvasArtifact: Boolean(currentCanvasArtifact),
    currentCanvasArtifactType: currentCanvasArtifact?.type,
    currentImageWorkbenchActive: currentImageWorkbenchState.active,
    isBrowserAssistCanvasVisible,
    onHasMessagesChange,
    dismissActiveTeamWorkbenchAutoOpen,
    suppressGeneralCanvasArtifactAutoOpen,
    suppressBrowserAssistCanvasAutoOpen,
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
    async (topicId: string, statusReason?: TaskStatusReason) => {
      if (topicId === sessionId && isResumableBrowserTaskReason(statusReason)) {
        handleOpenBrowserRuntimeForBrowserAssist();
        return;
      }

      await switchTopic(topicId);
    },
    [handleOpenBrowserRuntimeForBrowserAssist, sessionId, switchTopic],
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
    saveSessionFile: async (fileName, content) => {
      await saveSessionFile(fileName, content);
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
    setCanvasState,
  });
  const handleWorkspaceFileClick = useCallback(
    (fileName: string, content: string) => {
      setFocusedArtifactBlockId(null);
      handleFileClick(fileName, content);
    },
    [handleFileClick],
  );
  const handleWorkspaceArtifactClick = useCallback(
    (artifact: Artifact) => {
      setFocusedArtifactBlockId(null);
      handleArtifactClick(artifact);
    },
    [handleArtifactClick],
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

  useWorkspaceAutoGuideRuntime({
    contentId,
    sessionId,
    initialUserPrompt,
    initialUserImages,
    initialAutoSendRequestMetadata,
    autoRunInitialPromptOnMount,
    initialDispatchKey,
    messagesCount: messages.length,
    projectReady: Boolean(project),
    systemPromptReady: Boolean(systemPrompt),
    isSending,
    canvasState,
    isThemeWorkbench,
    mappedTheme,
    shouldUseCompactThemeWorkbench,
    shouldSkipThemeWorkbenchAutoGuideWithoutPrompt,
    themeWorkbenchEntryCheckPending,
    themeWorkbenchEntryPrompt,
    chatToolPreferences: effectiveChatToolPreferences,
    setInput,
    handleSend,
    triggerAIGuide,
    onInitialUserPromptConsumed,
    hasTriggeredGuideRef: hasTriggeredGuide,
    consumedInitialPromptRef,
  });

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

  const shellChromeRuntime = useWorkspaceShellChromeRuntime({
    agentEntry,
    browserTaskPreflight,
    contextWorkspaceEnabled: contextWorkspace.enabled,
    hasDisplayMessages,
    hideTopBar,
    isBootstrapDispatchPending,
    isSpecializedThemeMode,
    isSending,
    isThemeWorkbench,
    layoutMode,
    queuedTurnCount: queuedTurns.length,
    shouldUseCompactThemeWorkbench,
    showTeamWorkspaceBoard: teamSessionRuntime.showTeamWorkspaceBoard,
    topBarChrome,
    themeWorkbenchRunState,
    currentGateStatus: currentGate.status,
    hasRealTeamGraph: teamSessionRuntime.hasRealTeamGraph,
    teamDispatchPreviewState,
  });
  const themeWorkbenchShellRuntime = useWorkspaceThemeWorkbenchShellRuntime({
    showChatPanel,
    showSidebar,
    hasPendingA2UIForm,
    contextHarnessRuntime,
    themeWorkbenchScaffoldRuntime,
    themeWorkbenchSidebarRuntime,
    harnessInventoryRuntime,
    handleCreateVersionSnapshot,
    handleSwitchBranchVersion,
    handleSetBranchStatus,
    handleAddImage,
    handleImportDocument,
    handleViewContextDetail,
    messages,
    harnessState,
    compatSubagentRuntime,
    childSubagentSessions,
    selectedTeamLabel,
    selectedTeamSummary,
    selectedTeamRoles: selectedTeam?.roles,
    teamMemorySnapshot: resolvedTeamMemoryShadowSnapshot,
    handleOpenSubagentSession,
    handleHarnessLoadFilePreview,
    handleFileClick: handleWorkspaceFileClick,
  });

  useWorkspaceWorkflowProgressSync({
    enabled: isSpecializedThemeMode && hasMessages && steps.length > 0,
    currentStepIndex,
    steps,
    onWorkflowProgressChange,
  });
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

  const inputbarScene = useWorkspaceInputbarSceneRuntime({
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
    teamSessionRuntime,
    teamSessionControlRuntime,
    handleOpenSubagentSession,
    handleReturnToParentSession,
    input,
    setInput,
    currentGate,
    pendingA2UIForm,
    handleInputbarA2UISubmit,
    a2uiSubmissionNotice,
    themeWorkbenchSidebarRuntime,
    steps,
    themeWorkbenchRunState,
    handleSend,
    isSending,
    providerType,
    setProviderType,
    model,
    setModel,
    sessionExecutionRuntime: executionRuntime,
    isExecutionRuntimeActive: Boolean(activeExecutionRuntime),
    projectId: projectId ?? null,
    executionStrategy,
    setExecutionStrategy,
    accessMode,
    setAccessMode,
    activeTheme,
    navigationActions,
    selectedTeam,
    handleSelectTeam,
    handleEnableSuggestedTeam,
    handleClearMessages,
    handleToggleCanvas,
    layoutMode,
    handleTaskFileClick,
    characters: projectMemory?.characters || [],
    skills,
    serviceSkills: activeTheme === "general" ? serviceSkills : [],
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
    themeWorkbenchEntryPrompt,
    handleRestartThemeWorkbenchEntryPrompt,
    handleContinueThemeWorkbenchEntryPrompt,
    generalWorkbenchEnabled: workspaceHarnessEnabled && chatMode === "general",
    contextHarnessRuntime,
    harnessState,
    compatSubagentRuntime,
    harnessInventoryRuntime,
    mappedTheme,
    handleHarnessLoadFilePreview,
    handleFileClick: handleWorkspaceFileClick,
    shellChromeRuntime,
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
    teamSessionRuntime,
    teamSessionControlRuntime,
    teamWorkbenchAutoFocusToken,
    teamDispatchPreviewState,
    teamMemorySnapshot: resolvedTeamMemoryShadowSnapshot,
  });

  const workspaceShellSceneRuntime = useWorkspaceConversationShellSceneRuntime({
    navigationActions,
    inputbarScene,
    canvasScene,
    shellChromeRuntime,
    themeWorkbenchShellRuntime,
    contextHarnessRuntime,
    teamSessionRuntime,
    currentImageWorkbenchState,
    project,
    projectId,
    projectMemory,
    handleSend,
    generalCanvasState,
    showSidebar,
    topics,
    switchTopic,
    handleResumeSidebarTask,
    deleteTopic,
    renameTopic,
    childSubagentSessions,
    subagentParentContext,
    handleReturnToParentSession,
    entryBannerVisible,
    entryBannerMessage,
    serviceSkillExecutionCard,
    contextWorkspaceEnabled: contextWorkspace.enabled,
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
    skillsLoading: combinedSkillsLoading,
    handleNavigateToSkillSettings,
    handleRefreshSkills,
    handleOpenBrowserAssistInCanvas: handleOpenBrowserRuntimeForBrowserAssist,
    browserAssistLaunching,
    hideHistoryToggle,
    showChatPanel,
    topBarChrome,
    onBackToProjectManagement,
    fromResources,
    handleBackHome,
    handleToggleSidebar,
    chatMode,
    isBrowserAssistCanvasVisible,
    browserAssistAttentionLevel,
    browserAssistEntryLabel,
    showHarnessToggle,
    navbarHarnessPanelVisible,
    harnessPendingCount,
    harnessAttentionLevel,
    sessionId,
    syncStatus,
    pendingA2UIForm,
    pendingA2UISource,
    a2uiSubmissionNotice,
    handlePendingA2UISubmit: handleInputbarA2UISubmit,
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
    handleOpenSubagentSession,
    handlePermissionResponseWithBrowserPreflight,
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

  return (
    <>
      {workspaceShellSceneRuntime.shellSceneNode}
      <ServiceSkillLaunchDialog
        skill={workspaceServiceSkillEntryActions.selectedServiceSkill}
        open={workspaceServiceSkillEntryActions.serviceSkillDialogOpen}
        onOpenChange={
          workspaceServiceSkillEntryActions.handleServiceSkillDialogOpenChange
        }
        onLaunch={workspaceServiceSkillEntryActions.handleServiceSkillLaunch}
        onCreateAutomation={
          workspaceServiceSkillEntryActions.handleServiceSkillAutomationSetup
        }
        onOpenBrowserRuntime={
          workspaceServiceSkillEntryActions.handleServiceSkillBrowserRuntimeLaunch
        }
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
    </>
  );
}
