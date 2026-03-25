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
import { useAgentChatUnified, useCompatSubagentRuntime } from "./hooks";
import { type TaskStatusReason } from "./hooks/agentChatShared";
import {
  settleLiveArtifactAfterStreamStops,
  useArtifactDisplayState,
} from "./hooks/useArtifactDisplayState";
import type { TopicBranchStatus } from "./hooks/useTopicBranchBoard";
import { useSessionFiles } from "./hooks/useSessionFiles";
import { useContentSync } from "./hooks/useContentSync";
import { useGlobalMediaGenerationDefaults } from "@/hooks/useGlobalMediaGenerationDefaults";
import { useTrayModelShortcuts } from "./hooks/useTrayModelShortcuts";
import { type CanvasWorkbenchLayoutMode } from "./components/CanvasWorkbenchLayout";
import type { CreationMode } from "./components/types";
import { type TaskFile } from "./components/TaskFiles";
import { useWorkflow } from "@/components/content-creator/hooks/useWorkflow";
import {
  createInitialCanvasState,
  type CanvasStateUnion,
} from "@/components/content-creator/canvas/canvasUtils";
import { createInitialDocumentState } from "@/components/content-creator/canvas/document";
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
import {
  generateContentCreationPrompt,
  isContentCreationTheme,
} from "@/components/content-creator/utils/systemPrompt";
import { generateProjectMemoryPrompt } from "@/components/content-creator/utils/projectPrompt";
import {
  getProject,
  getContent,
  getThemeWorkbenchDocumentState,
  ensureWorkspaceReady,
  type Project,
} from "@/lib/api/project";
import {
  getProjectMemory,
  type ProjectMemory,
  type Character,
} from "@/lib/api/memory";
import { logAgentDebug } from "@/lib/agentDebug";
import { SettingsTabs } from "@/types/settings";
import { setActiveContentTarget } from "@/lib/activeContentTarget";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import { useImageGen } from "@/components/image-gen/useImageGen";
import { resolveMediaGenerationPreference } from "@/lib/mediaGeneration";

import type {
  Message,
  SiteSavedContentTarget,
  WriteArtifactContext,
} from "./types";
import type { ThemeType, LayoutMode } from "@/components/content-creator/types";
import { normalizeProjectId } from "./utils/topicProjectResolution";
import { buildHarnessRequestMetadata } from "./utils/harnessRequestMetadata";
import { deriveHarnessSessionState } from "./utils/harnessState";
import {
  mergeArtifacts,
  resolveDefaultArtifactViewMode,
} from "./utils/messageArtifacts";
import { createChatToolPreferencesFromExecutionRuntime } from "./utils/sessionExecutionRuntime";
import {
  buildRealSubagentTimelineItems,
  buildSyntheticSubagentTimelineItems,
} from "./utils/subagentTimeline";
import {
  buildGeneralAgentSystemPrompt,
  resolveAgentChatMode,
} from "./utils/generalAgentPrompt";
import { loadPersistedProjectId } from "./hooks/agentProjectStorage";
import { useSelectedTeamPreference } from "./hooks/useSelectedTeamPreference";
import { useThemeScopedChatToolPreferences } from "./hooks/useThemeScopedChatToolPreferences";
import { useLimeSkills } from "./hooks/useLimeSkills";
import { useWorkspaceProjectSelection } from "./hooks/useWorkspaceProjectSelection";
import { useBootstrapDispatchPreview } from "./hooks/useBootstrapDispatchPreview";
import { useRuntimeTeamFormation } from "./hooks/useRuntimeTeamFormation";
import { useThemeWorkbenchEntryPrompt } from "./hooks/useThemeWorkbenchEntryPrompt";
import { useThemeWorkbenchEntryPromptActions } from "./hooks/useThemeWorkbenchEntryPromptActions";
import { useThemeWorkbenchSendBoundary } from "./hooks/useThemeWorkbenchSendBoundary";
import type { BrowserTaskPreflight } from "./hooks/handleSendTypes";
import { mergeThreadItems } from "./utils/threadTimelineView";
import {
  DEFAULT_STYLE_PROFILE,
  buildRuntimeStyleOverridePrompt,
  getStyleProfileFromGuide,
  type RuntimeStyleSelection,
} from "@/lib/style-guide";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  isResumableBrowserTaskReason,
  mergeMessageArtifactsIntoStore,
} from "./workspace/browserAssistArtifact";
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

const GENERAL_BROWSER_ASSIST_PROFILE_KEY = "general_browser_assist";

const TOPIC_PROJECT_KEY_PREFIX = "agent_session_workspace_";
export type {
  AgentChatWorkspaceProps,
  WorkflowProgressSnapshot,
} from "./agentChatWorkspaceContract";

export function AgentChatWorkspace({
  onNavigate: _onNavigate,
  projectId: externalProjectId,
  contentId,
  initialRequestMetadata,
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
  const {
    chatToolPreferences,
    setChatToolPreferences,
    syncChatToolPreferencesSource,
  } = useThemeScopedChatToolPreferences(activeTheme);
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
  const [novelChapterListCollapsed, setNovelChapterListCollapsed] =
    useState(false);
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
  const { mediaDefaults } = useGlobalMediaGenerationDefaults();
  const effectiveImageWorkbenchPreference = useMemo(
    () =>
      resolveMediaGenerationPreference(
        project?.settings?.imageGeneration,
        mediaDefaults.image,
      ),
    [mediaDefaults.image, project?.settings?.imageGeneration],
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
  const upsertGeneralArtifact = useCallback(
    (artifact: Artifact) => {
      setArtifacts((currentArtifacts) =>
        mergeArtifacts([...currentArtifacts, artifact]),
      );
    },
    [setArtifacts],
  );
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

  // 跳转到设置页安装技能
  const handleNavigateToSkillSettings = useCallback(() => {
    _onNavigate?.("settings", { tab: SettingsTabs.Skills });
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
  const runtimeChatToolPreferences = useMemo(
    () => createChatToolPreferencesFromExecutionRuntime(executionRuntime),
    [executionRuntime],
  );

  useEffect(() => {
    syncChatToolPreferencesSource(activeTheme, runtimeChatToolPreferences);
  }, [activeTheme, runtimeChatToolPreferences, syncChatToolPreferencesSource]);

  const hasRealTeamGraph =
    childSubagentSessions.length > 0 || Boolean(subagentParentContext);
  const {
    clearRuntimeTeamState: clearPreparedRuntimeTeamState,
    prepareRuntimeTeamBeforeSend,
  } = useRuntimeTeamFormation({
    projectId,
    sessionId,
    selectedTeam,
    subagentEnabled: chatToolPreferences.subagent,
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
    subagentEnabled: chatToolPreferences.subagent,
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
  const {
    browserAssistLaunching,
    isBrowserAssistReady,
    isBrowserAssistCanvasVisible,
    currentBrowserAssistScopeKey,
    ensureBrowserAssistCanvas,
    handleOpenBrowserAssistInCanvas,
    suppressBrowserAssistCanvasAutoOpen,
    suppressGeneralCanvasArtifactAutoOpen,
  } = useWorkspaceBrowserAssistRuntime({
    activeTheme,
    projectId,
    sessionId,
    input,
    initialUserPrompt,
    openBrowserAssistOnMount,
    artifacts,
    messages,
    currentCanvasArtifact,
    layoutMode,
    setLayoutMode,
    setSelectedArtifactId,
    upsertGeneralArtifact,
    generalBrowserAssistProfileKey: GENERAL_BROWSER_ASSIST_PROFILE_KEY,
  });

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

  const contextHarnessRuntime = useWorkspaceContextHarnessRuntime({
    projectId,
    activeTheme,
    messages,
    providerType,
    model,
    mappedTheme,
    chatMode,
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
    pendingActionRequest,
    pendingLegacyQuestionnaireA2UIForm,
    pendingPromotedA2UIActionRequest,
  } = useWorkspaceA2UIRuntime({
    messages,
  });

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
          webSearch: chatToolPreferences.webSearch,
          thinking: chatToolPreferences.thinking,
          task: chatToolPreferences.task,
          subagent: chatToolPreferences.subagent,
        },
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
      chatToolPreferences.subagent,
      chatToolPreferences.task,
      chatToolPreferences.thinking,
      chatToolPreferences.webSearch,
      contentId,
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
  const harnessInventoryRuntime = useWorkspaceHarnessInventoryRuntime({
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
      loadPersistedProjectId(`${TOPIC_PROJECT_KEY_PREFIX}${topicId}`),
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

  const { upsertNovelCanvasState } = useWorkspaceCanvasMessageSyncRuntime({
    canvasState,
    isContentCreationMode,
    isThemeWorkbench,
    mappedTheme,
    messages,
    processedMessageIdsRef: processedMessageIds,
    setCanvasState,
    setLayoutMode,
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

  const {
    handleSend,
    handleRecommendationClick,
    handleSendRef,
    webSearchPreferenceRef,
  } = useWorkspaceSendActions({
    input,
    setInput,
    mentionedCharacters,
    setMentionedCharacters,
    chatToolPreferences,
    setChatToolPreferences,
    activeTheme,
    mappedTheme,
    isThemeWorkbench,
    contextWorkspace: {
      enabled: contextWorkspace.enabled,
      prepareActiveContextPrompt: contextWorkspace.prepareActiveContextPrompt,
    },
    runtimeStyleMessagePrompt,
    projectId,
    executionStrategy,
    preferredTeamPresetId,
    selectedTeam,
    selectedTeamLabel,
    selectedTeamSummary,
    currentGateKey: currentGate.key,
    themeWorkbenchActiveQueueTitle: themeWorkbenchActiveQueueItem?.title,
    contentId,
    workspaceRequestMetadataBase: initialRequestMetadata,
    messagesCount: messages.length,
    sendMessage,
    resolveSendBoundary,
    isBlockedByBrowserPreflight,
    maybeStartBrowserTaskPreflight,
    finalizeAfterSendSuccess,
    rollbackAfterSendFailure,
    prepareRuntimeTeamBeforeSend,
    setRuntimeTeamDispatchPreview,
    ensureBrowserAssistCanvas,
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
  const {
    browserAssistEntryLabel,
    browserAssistAttentionLevel,
    browserPreflightMessages,
    handlePermissionResponseWithBrowserPreflight,
  } = useWorkspaceBrowserPreflightRuntime({
    browserTaskPreflight,
    setBrowserTaskPreflight,
    browserAssistLaunching,
    isBrowserAssistReady,
    ensureBrowserAssistCanvas,
    handlePermissionResponse,
    sendRef: handleSendRef,
  });
  const {
    handleDocumentThinkingEnabledChange,
    handleDocumentAutoContinueRun,
    handleDocumentContentReviewRun,
    handleDocumentTextStylizeRun,
    handleSwitchBranchVersion,
    handleCreateVersionSnapshot,
    handleSetBranchStatus,
    handleAddImage,
    handleImportDocument,
  } = useWorkspaceCanvasWorkflowActions({
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
  const { handleA2UISubmit, handleInputbarA2UISubmit } =
    useWorkspaceA2UISubmitActions({
      handlePermissionResponseWithBrowserPreflight,
      pendingLegacyQuestionnaireA2UIForm,
      pendingPromotedA2UIActionRequest,
      sendMessage,
    });

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
    bootstrapDispatchPreviewMessages,
    browserPreflightMessages,
    isSending,
    messages,
    pendingActionCount: pendingActions.length,
    queuedTurnCount: queuedTurns.length,
    runtimeTeamDispatchPreview,
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

  const {
    handleToggleSidebar,
    handleToggleNovelChapterList,
    handleAddNovelChapter,
    handleToggleCanvas,
    handleCloseCanvas,
    resolvedCanvasState,
    showNovelNavbarControls,
  } = useWorkspaceCanvasLayoutRuntime({
    activeTheme,
    isThemeWorkbench,
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
    setNovelChapterListCollapsed,
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
    setLayoutMode,
    upsertNovelCanvasState,
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
        await handleOpenBrowserAssistInCanvas();
        return;
      }

      await switchTopic(topicId);
    },
    [handleOpenBrowserAssistInCanvas, sessionId, switchTopic],
  );

  const handleWriteFile = useWorkspaceWriteFileAction({
    activeTheme,
    artifacts,
    contentId,
    currentGateKey: currentGate.key,
    currentStepIndex,
    isContentCreationMode,
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
    setArtifactViewMode,
    setLayoutMode,
    completeStep,
    setTaskFiles,
    setSelectedFileId,
    setCanvasState,
    upsertNovelCanvasState,
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
    upsertGeneralArtifact,
    setSelectedArtifactId,
    setArtifactViewMode,
    setLayoutMode,
    setTaskFiles,
    setSelectedFileId,
    setCanvasState,
    upsertNovelCanvasState,
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
    initialDispatchKey,
    messagesCount: messages.length,
    projectReady: Boolean(project),
    systemPromptReady: Boolean(systemPrompt),
    isSending,
    canvasState,
    isThemeWorkbench,
    mappedTheme,
    creationMode,
    shouldUseCompactThemeWorkbench,
    shouldSkipThemeWorkbenchAutoGuideWithoutPrompt,
    themeWorkbenchEntryCheckPending,
    themeWorkbenchEntryPrompt,
    chatToolPreferences,
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
    isContentCreationMode,
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
    handleOpenSubagentSession,
    handleHarnessLoadFilePreview,
    handleFileClick: handleWorkspaceFileClick,
  });

  useWorkspaceWorkflowProgressSync({
    enabled: isContentCreationMode && hasMessages && steps.length > 0,
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
    skillsLoading,
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
    generalWorkbenchEnabled: chatMode === "general",
    contextHarnessRuntime,
    harnessState,
    compatSubagentRuntime,
    harnessInventoryRuntime,
    mappedTheme,
    handleHarnessLoadFilePreview,
    handleFileClick: handleWorkspaceFileClick,
    shellChromeRuntime,
    handleActivateTeamWorkbench,
    chatToolPreferences,
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
    setArtifactViewMode,
    artifactPreviewSize,
    setArtifactPreviewSize,
    onSaveArtifactDocument: handleSaveArtifactDocument,
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
    documentThinkingEnabled: chatToolPreferences.thinking,
    handleDocumentThinkingEnabledChange,
    handleDocumentAutoContinueRun,
    handleAddImage,
    handleImportDocument,
    handleDocumentContentReviewRun,
    handleDocumentTextStylizeRun,
    preferContentReviewInRightRail,
    novelChapterListCollapsed,
    setNovelChapterListCollapsed,
    teamSessionRuntime,
    teamSessionControlRuntime,
    teamWorkbenchAutoFocusToken,
    teamDispatchPreviewState,
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
    mappedTheme,
    runtimeStyleSelection,
    setRuntimeStyleSelection,
    generalCanvasState,
    runtimeStylePrompt,
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
    contextWorkspaceEnabled: contextWorkspace.enabled,
    input,
    setInput,
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    chatToolPreferences,
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
    skillsLoading,
    handleNavigateToSkillSettings,
    handleRefreshSkills,
    handleOpenBrowserAssistInCanvas,
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
    handleToggleCanvas,
    hideInlineStepProgress,
    isContentCreationMode,
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
    handleA2UISubmit,
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
    showNovelNavbarControls,
    novelChapterListCollapsed,
    handleToggleNovelChapterList,
    handleAddNovelChapter,
    handleCloseCanvas,
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

  return workspaceShellSceneRuntime.shellSceneNode;
}
