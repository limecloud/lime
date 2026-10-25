/* eslint-disable react-refresh/only-export-components */
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import {
  AppShell,
  AppShellHeader,
  UnifiedTabStrip,
} from "@/components/app-shell/AppShell";
import { harness as createDraftHarness } from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import { acceptedSubmission } from "./hooks/agentSendResult.testFixtures";
import { resetInitialSessionNavigationDeduplicationForTests } from "./workspace/useWorkspaceInitialSessionNavigation";

export type MockEmptyStateProps = {
  input?: string;
  activeTheme?: string;
  sessionId?: string | null;
  setInput?: (value: string) => void;
  onSend?: (payload?: MockInputbarSendPayload) => void;
};

export type MockInputbarSendPayload = {
  images?: unknown[];
  textOverride?: string;
  sendOptions?: Record<string, unknown>;
};

const {
  mockUseAgentChatUnified,
  mockUseArtifactAutoPreviewSync,
  mockUseTopicBranchBoard,
  mockUseSessionFiles,
  mockUseTrayModelShortcuts,
  mockSafeListen,
  mockPersistedAtomInvoke,
  mockPersistedAtomListen,
  mockUseSessionRecentMetadataSyncRuntime,
  mockUseGlobalMediaGenerationDefaults,
  mockReadGlobalMediaGenerationDefaults,
  mockUseServiceModelsConfig,
  mockUseImageGen,
  mockGetConfig,
  mockGetDefaultProviderFromConfig,
  mockSubscribeAppConfigChanged,
  mockGetProject,
  mockGetDefaultProject,
  mockGetOrCreateDefaultProject,
  mockGetContent,
  mockGetGeneralWorkbenchDocumentState,
  mockEnsureWorkspaceReady,
  mockEnsureProjectWorkspace,
  mockUpdateContent,
  mockGetProjectMemory,
  mockToast,
  mockArtifactsAtom,
  mockSelectedArtifactAtom,
  mockSelectedArtifactIdAtom,
  mockSetArtifactsAtom,
  mockSetSelectedArtifactIdAtom,
  mockJotaiState,
  mockIsSpecializedWorkbenchTheme,
  mockEmptyState,
  mockInputbar,
  mockMessageList,
  mockExpertInfoPanel,
  mockWorkspacePendingA2UIPanel,
  mockExecutionRunGetGeneralWorkbenchState,
  mockExecutionRunListGeneralWorkbenchHistory,
  mockExecutionRunGet,
  mockSkillExecutionListExecutableSkills,
  mockSkillExecutionGetDetail,
  mockSkillsGetAll,
  mockSkillsGetLocal,
  mockGetAgentRuntimeToolInventory,
  mockRequestWorkspaceRightSurface,
  mockCanvasWorkbenchLayoutState,
  mockCanvasWorkbenchLayout,
  mockLaunchBrowserSession,
  mockBrowserExecuteAction,
  mockExecuteBrowserSessionAction,
} = vi.hoisted(() => ({
  mockUseAgentChatUnified: vi.fn(),
  mockUseArtifactAutoPreviewSync: vi.fn(),
  mockUseTopicBranchBoard: vi.fn(),
  mockUseSessionFiles: vi.fn(),
  mockUseTrayModelShortcuts: vi.fn(),
  mockSafeListen: vi.fn(),
  mockPersistedAtomInvoke: vi.fn(),
  mockPersistedAtomListen: vi.fn(),
  mockUseSessionRecentMetadataSyncRuntime: vi.fn(),
  mockUseGlobalMediaGenerationDefaults: vi.fn(),
  mockReadGlobalMediaGenerationDefaults: vi.fn(),
  mockUseServiceModelsConfig: vi.fn(),

  mockUseImageGen: vi.fn(),
  mockGetConfig: vi.fn(),
  mockGetDefaultProviderFromConfig: vi.fn(),
  mockSubscribeAppConfigChanged: vi.fn(),
  mockGetProject: vi.fn(),
  mockGetDefaultProject: vi.fn(),
  mockGetOrCreateDefaultProject: vi.fn(),
  mockGetContent: vi.fn(),
  mockGetGeneralWorkbenchDocumentState: vi.fn(),
  mockEnsureWorkspaceReady: vi.fn(),
  mockEnsureProjectWorkspace: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockGetProjectMemory: vi.fn(),
  mockToast: {
    loading: vi.fn(() => "toast-loading"),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockArtifactsAtom: { key: "artifacts" },
  mockSelectedArtifactAtom: { key: "selectedArtifact" },
  mockSelectedArtifactIdAtom: { key: "selectedArtifactId" },
  mockJotaiState: {
    artifacts: [] as Array<Record<string, unknown>>,
    selectedArtifact: null as Record<string, unknown> | null,
    selectedArtifactId: null as string | null,
  },
  mockSetArtifactsAtom: vi.fn(),
  mockSetSelectedArtifactIdAtom: vi.fn(),
  mockIsSpecializedWorkbenchTheme: vi.fn(() => false),
  mockEmptyState: vi.fn((props?: MockEmptyStateProps) => (
    <div
      data-testid="empty-state"
      data-active-theme={props?.activeTheme || ""}
      data-session-id={props?.sessionId ?? ""}
    >
      {props?.activeTheme === "general" ? (
        <div data-testid="home-composer-page" />
      ) : null}
      {props?.input || ""}
    </div>
  )),
  mockInputbar: vi.fn(
    (props?: { overlayAccessory?: ReactNode; input?: string }) => (
      <div data-testid="inputbar" data-input={props?.input || ""}>
        {props?.overlayAccessory}
      </div>
    ),
  ),
  mockMessageList: vi.fn(
    (props?: {
      leadingContent?: ReactNode | null;
      trailingContent?: ReactNode | null;
    }) => (
      <div data-testid="message-list">
        {props?.leadingContent}
        {props?.trailingContent}
      </div>
    ),
  ),
  mockExpertInfoPanel: vi.fn((props?: Record<string, unknown>) => {
    const requestMetadata =
      props?.requestMetadata && typeof props.requestMetadata === "object"
        ? (props.requestMetadata as {
            expert?: { expertId?: string };
            harness?: { expert?: { expert_id?: string } };
          })
        : null;
    const expertId =
      requestMetadata?.expert?.expertId ||
      requestMetadata?.harness?.expert?.expert_id ||
      "";
    const expertTitle =
      expertId === "marketing-strategist" ? "营销策略专家" : "专家信息";

    return (
      <div data-testid="expert-info-panel" data-layout="right-surface-full">
        <span>专家信息</span>
        <span>{expertTitle}</span>
        <div data-testid="expert-info-section-memory" />
        <div data-testid="expert-info-skills" />
        <div data-testid="expert-info-workflow" />
      </div>
    );
  }),
  mockWorkspacePendingA2UIPanel: vi.fn((_props?: Record<string, unknown>) => (
    <div data-testid="workspace-pending-a2ui-panel" />
  )),
  mockExecutionRunGetGeneralWorkbenchState: vi.fn(),
  mockExecutionRunListGeneralWorkbenchHistory: vi.fn(),
  mockExecutionRunGet: vi.fn(),
  mockSkillExecutionListExecutableSkills: vi.fn(),
  mockSkillExecutionGetDetail: vi.fn(),
  mockSkillsGetAll: vi.fn(),
  mockSkillsGetLocal: vi.fn(),
  mockGetAgentRuntimeToolInventory: vi.fn(),
  mockRequestWorkspaceRightSurface: vi.fn(),
  mockCanvasWorkbenchLayoutState: {
    renderPreviewProbe: false,
  },
  mockCanvasWorkbenchLayout: vi.fn((props?: Record<string, unknown>) => {
    const defaultPreview =
      props?.defaultPreview && typeof props.defaultPreview === "object"
        ? (props.defaultPreview as {
            title?: string;
            content?: string;
            filePath?: string;
            absolutePath?: string;
          })
        : null;
    const preview = mockCanvasWorkbenchLayoutState.renderPreviewProbe ? (
      <div data-testid="canvas-workbench-default-preview-probe">
        {defaultPreview?.title || "当前画布草稿"}
      </div>
    ) : null;

    return (
      <div
        data-testid="canvas-workbench-layout-mock"
        data-workspace-root={
          typeof props?.workspaceRoot === "string" ? props.workspaceRoot : ""
        }
        data-artifact-count={
          Array.isArray(props?.artifacts) ? String(props.artifacts.length) : "0"
        }
        data-default-preview-title={
          props?.defaultPreview &&
          typeof props.defaultPreview === "object" &&
          "title" in props.defaultPreview &&
          typeof props.defaultPreview.title === "string"
            ? props.defaultPreview.title
            : ""
        }
        data-default-preview-file-path={defaultPreview?.filePath || ""}
        data-default-preview-absolute-path={defaultPreview?.absolutePath || ""}
        data-default-preview-content={defaultPreview?.content || ""}
        data-default-preview-content-type={
          /\.(md|markdown|mdx)$/i.test(defaultPreview?.filePath || "")
            ? "markdown"
            : /\.(html|htm)$/i.test(defaultPreview?.filePath || "")
              ? "html"
              : "code"
        }
      >
        {preview}
      </div>
    );
  }),
  mockLaunchBrowserSession: vi.fn(),
  mockBrowserExecuteAction: vi.fn(),
  mockExecuteBrowserSessionAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/lib/dev-bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dev-bridge")>();
  return {
    ...actual,
    safeInvoke: (...[command, args]: Parameters<typeof actual.safeInvoke>) =>
      command === "persisted_atom_read" || command === "persisted_atom_update"
        ? mockPersistedAtomInvoke(command, args)
        : actual.safeInvoke(command, args),
    safeListen: (...[event, handler]: Parameters<typeof actual.safeListen>) =>
      event === "persisted-atom-update"
        ? mockPersistedAtomListen(event, handler)
        : mockSafeListen(event, handler),
  };
});

vi.mock("@/lib/api/workspaceRightSurface", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/workspaceRightSurface")>();
  return {
    ...actual,
    requestWorkspaceRightSurface: mockRequestWorkspaceRightSurface,
  };
});

vi.mock("./hooks", () => ({
  useAgentChatUnified: mockUseAgentChatUnified,
  useArtifactAutoPreviewSync: mockUseArtifactAutoPreviewSync,
  useTopicBranchBoard: mockUseTopicBranchBoard,
}));

vi.mock("./hooks/useSessionFiles", () => ({
  useSessionFiles: mockUseSessionFiles,
}));

vi.mock("./hooks/useTrayModelShortcuts", () => ({
  useTrayModelShortcuts: mockUseTrayModelShortcuts,
}));

vi.mock("./workspace/useSessionRecentMetadataSyncRuntime", () => ({
  useSessionRecentMetadataSyncRuntime: mockUseSessionRecentMetadataSyncRuntime,
}));

vi.mock("@/hooks/useGlobalMediaGenerationDefaults", () => ({
  useGlobalMediaGenerationDefaults: mockUseGlobalMediaGenerationDefaults,
  readGlobalMediaGenerationDefaults: mockReadGlobalMediaGenerationDefaults,
}));

vi.mock("@/hooks/useServiceModelsConfig", () => ({
  useServiceModelsConfig: mockUseServiceModelsConfig,
}));

vi.mock("@/components/image-gen/useImageGen", () => ({
  useImageGen: mockUseImageGen,
}));

vi.mock("@/lib/api/appConfig", () => ({
  getConfig: mockGetConfig,
  getDefaultProvider: mockGetDefaultProviderFromConfig,
  subscribeAppConfigChanged: mockSubscribeAppConfigChanged,
}));

vi.mock("./workspace/useWorkspaceImageTaskPreviewRuntime", () => ({
  shouldEnableWorkspaceImageTaskPreviewRuntime: vi.fn(() => true),
  useWorkspaceImageTaskPreviewRuntime: vi.fn(),
}));

vi.mock("./workspace/useWorkspaceAudioTaskPreviewRuntime", () => ({
  useWorkspaceAudioTaskPreviewRuntime: vi.fn(),
}));

vi.mock("./workspace/useWorkspaceTranscriptionTaskPreviewRuntime", () => ({
  useWorkspaceTranscriptionTaskPreviewRuntime: vi.fn(),
}));

vi.mock("./hooks/useContentSync", () => ({
  useContentSync: () => ({
    syncContent: vi.fn(),
    syncStatus: "idle",
  }),
}));

vi.mock("@/lib/workspace/workbenchWorkflow", () => ({
  useWorkflow: () => ({
    steps: [],
    currentStepIndex: 0,
    goToStep: vi.fn(),
    completeStep: vi.fn(),
  }),
}));

vi.mock("@/components/workspace/layout/LayoutTransition", () => ({
  LayoutTransition: ({
    mode,
    mainToolbar,
    sidePanelTabStrip,
    chatContent,
    canvasContent,
  }: {
    mode: string;
    mainToolbar?: ReactNode;
    sidePanelTabStrip?: ReactNode;
    chatContent: ReactNode;
    canvasContent: ReactNode;
  }) => (
    <div data-testid="layout-transition" data-mode={mode}>
      <UnifiedTabStrip
        mode="split"
        isVisible={mode !== "chat"}
        desktopPlacement="titlebar"
        mainTabId="fixture-chat-tab"
        mainTabPanelId="fixture-chat-panel"
        mainToolbar={mainToolbar}
        sidePanelTabStrip={sidePanelTabStrip}
      />
      <div data-testid="layout-chat" hidden={mode === "canvas"}>
        {chatContent}
      </div>
      <div data-testid="layout-canvas" hidden={mode !== "canvas"}>
        {canvasContent}
      </div>
    </div>
  ),
}));

vi.mock("@/lib/workspace/workbenchUi", () => ({
  StepProgress: () => <div data-testid="step-progress" />,
}));

vi.mock("./components/GeneralWorkbenchSidebar", () => ({
  GeneralWorkbenchSidebar: ({
    onSwitchTopic,
    onSetBranchStatus,
    workflowSteps,
    activityLogs,
    historyHasMore,
    historyLoading,
    onLoadMoreHistory,
    headerActionSlot,
    topSlot,
  }: {
    onSwitchTopic?: (topicId: string) => Promise<void> | void;
    onSetBranchStatus?: (
      topicId: string,
      status: "in_progress" | "pending" | "merged" | "candidate",
    ) => void;
    workflowSteps?: Array<{ title: string; status: string }>;
    activityLogs?: Array<{ runId?: string; executionId?: string; id: string }>;
    historyHasMore?: boolean;
    historyLoading?: boolean;
    onLoadMoreHistory?: () => void;
    headerActionSlot?: ReactNode;
    topSlot?: ReactNode;
  }) => (
    <div
      data-testid="general-workbench-sidebar"
      data-workflow-summary={(workflowSteps || [])
        .map((step) => `${step.title}:${step.status}`)
        .join("|")}
      data-activity-runs={(activityLogs || [])
        .map((log) => log.runId || "-")
        .join("|")}
      data-activity-executions={(activityLogs || [])
        .map((log) => log.executionId || "-")
        .join("|")}
    >
      <div data-testid="general-workbench-sidebar-header-action">
        {headerActionSlot}
      </div>
      <div data-testid="general-workbench-sidebar-top-slot">{topSlot}</div>
      <div
        data-testid="general-workbench-sidebar-history-state"
        data-history-has-more={historyHasMore ? "true" : "false"}
        data-history-loading={historyLoading ? "true" : "false"}
      />
      {onLoadMoreHistory ? (
        <button
          type="button"
          data-testid="general-load-more-history"
          onClick={() => {
            onLoadMoreHistory();
          }}
        >
          加载更早历史
        </button>
      ) : null}
      <button
        type="button"
        data-testid="theme-switch-topic"
        onClick={() => {
          void onSwitchTopic?.("topic-a");
        }}
      >
        切换主题分支
      </button>
      <button
        type="button"
        data-testid="theme-mark-merged"
        onClick={() => {
          onSetBranchStatus?.("topic-a", "merged");
        }}
      >
        标记合并
      </button>
    </div>
  ),
}));

vi.mock("./components/MessageList", () => ({
  MessageList: (props: Record<string, unknown>) => mockMessageList(props),
}));

vi.mock("./experts/ExpertInfoPanel", () => ({
  ExpertInfoPanel: (props: Record<string, unknown>) =>
    mockExpertInfoPanel(props),
}));

vi.mock("./components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ content }: { content?: string }) => (
    <div data-testid="markdown-renderer-mock">{content}</div>
  ),
}));

vi.mock("./components/Inputbar", () => ({
  Inputbar: (props: Record<string, unknown>) => mockInputbar(props),
}));

vi.mock("./components/TaskCenterUtilityToolbar", () => ({
  TaskCenterUtilityToolbar: ({
    sidePanelLauncher,
  }: ComponentProps<
    typeof import("./components/TaskCenterUtilityToolbar").TaskCenterUtilityToolbar
  >) => (
    <div data-testid="task-center-utility-toolbar">{sidePanelLauncher}</div>
  ),
}));

vi.mock("./components/EmptyState", () => ({
  EmptyState: (props?: { input?: string }) => mockEmptyState(props),
}));

vi.mock("./workspace/WorkspacePendingA2UIPanel", () => ({
  WorkspacePendingA2UIPanel: (props: Record<string, unknown>) =>
    mockWorkspacePendingA2UIPanel(props),
}));

vi.mock("./components/CanvasWorkbenchLayout", () => ({
  CanvasWorkbenchLayout: (props: Record<string, unknown>) =>
    mockCanvasWorkbenchLayout(props),
}));

vi.mock("@/components/workspace/canvas/canvasUtils", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/workspace/canvas/canvasUtils")
    >();
  return {
    ...actual,
    createInitialCanvasState: vi.fn(() => null),
    createInitialDocumentState: vi.fn((content = "") => ({
      type: "document",
      content,
      platform: "markdown",
      versions: [],
      currentVersionId: "",
      isEditing: true,
    })),
  };
});

vi.mock("@/lib/workspace/workbenchContract", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workspace/workbenchContract")>();
  return {
    ...actual,
    isSpecializedWorkbenchTheme: mockIsSpecializedWorkbenchTheme,
  };
});

vi.mock("@/components/workspace/canvas/CanvasFactory", () => ({
  CanvasFactory: () => <div data-testid="canvas-factory" />,
}));

vi.mock("@/components/general-chat/bridge", () => ({
  CanvasPanel: ({
    toolbarActions,
    state,
    baseFilePath,
  }: {
    toolbarActions?: ReactNode;
    state?: {
      filename?: string;
      contentType?: string;
      content?: string;
    };
    baseFilePath?: string;
  }) => (
    <div
      data-testid="general-canvas"
      data-filename={state?.filename || ""}
      data-content-type={state?.contentType || ""}
      data-base-file-path={baseFilePath || ""}
      data-content={state?.content || ""}
    >
      <div data-testid="general-canvas-toolbar">{toolbarActions}</div>
    </div>
  ),
  DEFAULT_CANVAS_STATE: {
    isOpen: false,
    contentType: null,
    content: "",
    isEditing: false,
  },
}));

vi.mock("@/components/artifact", () => ({
  ArtifactRenderer: ({
    artifact,
  }: {
    artifact?: { content: string; meta: Record<string, unknown> };
  }) => (
    <div
      data-testid="artifact-renderer"
      data-source-ref={String(artifact?.meta.sourceRef ?? "")}
      data-file-path={String(artifact?.meta.filePath ?? "")}
      data-content-kind={String(artifact?.meta.contentKind ?? "")}
      data-content={artifact?.content ?? ""}
    />
  ),
  ArtifactToolbar: ({ onClose }: { onClose?: () => void }) => (
    <div data-testid="artifact-toolbar">
      <button
        type="button"
        data-testid="artifact-toolbar-close"
        onClick={() => {
          onClose?.();
        }}
      >
        关闭
      </button>
    </div>
  ),
}));

vi.mock("@/lib/artifact/store", () => ({
  artifactsAtom: mockArtifactsAtom,
  selectedArtifactAtom: mockSelectedArtifactAtom,
  selectedArtifactIdAtom: mockSelectedArtifactIdAtom,
}));

vi.mock("jotai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jotai")>();
  return {
    ...actual,
    useAtomValue: (atom: import("jotai").Atom<unknown>) => {
      if (atom === mockSelectedArtifactAtom) {
        return mockJotaiState.selectedArtifact;
      }
      if (atom === mockArtifactsAtom) {
        return mockJotaiState.artifacts;
      }
      if (atom === mockSelectedArtifactIdAtom) {
        return mockJotaiState.selectedArtifactId;
      }
      return actual.useAtomValue(atom);
    },
    useSetAtom: (atom: unknown) => {
      if (atom === mockArtifactsAtom) {
        return mockSetArtifactsAtom;
      }
      if (atom === mockSelectedArtifactIdAtom) {
        return mockSetSelectedArtifactIdAtom;
      }
      return vi.fn();
    },
  };
});

vi.mock("./utils/workflowMapping", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./utils/workflowMapping")>();
  return {
    ...actual,
    getFileToStepMap: vi.fn(() => ({})),
    getSupportedFilenames: vi.fn(() => []),
  };
});

vi.mock("@/lib/workspace/navigation", () => ({
  buildHomeAgentParams: vi.fn(() => ({})),
  buildConversationParams: vi.fn((overrides?: Record<string, unknown>) => ({
    ...(overrides || {}),
    agentEntry: "conversation",
    theme: typeof overrides?.theme === "string" ? overrides.theme : "general",
    lockTheme: false,
    immersiveHome:
      typeof overrides?.immersiveHome === "boolean"
        ? overrides.immersiveHome
        : false,
  })),
}));

vi.mock("@/lib/api/project", () => ({
  getProject: mockGetProject,
  getDefaultProject: mockGetDefaultProject,
  getOrCreateDefaultProject: mockGetOrCreateDefaultProject,
  getContent: mockGetContent,
  getGeneralWorkbenchDocumentState: mockGetGeneralWorkbenchDocumentState,
  ensureWorkspaceReady: mockEnsureWorkspaceReady,
  ensureProjectWorkspace: mockEnsureProjectWorkspace,
  updateContent: mockUpdateContent,
}));

vi.mock("@/lib/api/projectMemory", () => ({
  getProjectMemory: mockGetProjectMemory,
}));

vi.mock("@/lib/api/executionRun", () => ({
  executionRunGet: mockExecutionRunGet,
  executionRunGetGeneralWorkbenchState:
    mockExecutionRunGetGeneralWorkbenchState,
  executionRunListGeneralWorkbenchHistory:
    mockExecutionRunListGeneralWorkbenchHistory,
}));

vi.mock("@/lib/api/skill-execution", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/skill-execution")
  >("@/lib/api/skill-execution");

  return {
    ...actual,
    skillExecutionApi: {
      ...actual.skillExecutionApi,
      listExecutableSkills: mockSkillExecutionListExecutableSkills,
      getSkillDetail: mockSkillExecutionGetDetail,
    },
  };
});

vi.mock("@/lib/api/skills", () => ({
  skillsApi: {
    getAll: mockSkillsGetAll,
    getLocal: mockSkillsGetLocal,
  },
}));

vi.mock("@/lib/webview-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/webview-api")>(
      "@/lib/webview-api",
    );

  return {
    ...actual,
    launchBrowserSession: mockLaunchBrowserSession,
    browserExecuteAction: mockBrowserExecuteAction,
  };
});

vi.mock("@/lib/api/agentRuntime/inventoryClient", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/agentRuntime/inventoryClient")
  >("@/lib/api/agentRuntime/inventoryClient");

  return {
    ...actual,
    getAgentRuntimeToolInventory: mockGetAgentRuntimeToolInventory,
  };
});

import * as configuredProvidersModule from "@/hooks/useConfiguredProviders";
import * as providerModelsModule from "@/hooks/useProviderModels";
import { LocalConversationPage } from "./index";
export { LocalConversationPage };

const agentChatWorkspacePreload = import("./AgentChatWorkspace");

beforeAll(async () => {
  await agentChatWorkspacePreload;
}, 120_000);

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
  rerender: (
    props?: Partial<ComponentProps<typeof LocalConversationPage>>,
  ) => void;
}

export type MockInputbarSendProps = {
  onToolStatesChange?: (next: Record<string, unknown>) => void;
  onSend?: (
    payload?: MockInputbarSendPayload,
  ) => void | Promise<void> | Promise<boolean | void> | boolean;
  onStop?: () => void | Promise<void>;
};

export const mountedRoots: MountedHarness[] = [];
export const observedWorkspaceIds: string[] = [];
export let sharedSwitchTopicMock: ReturnType<typeof vi.fn>;
export let sharedSendMessageMock: ReturnType<typeof vi.fn>;
export let sharedTriggerAIGuideMock: ReturnType<typeof vi.fn>;
export const FIXED_TOPIC_UPDATED_AT = 1710385200000;

export function buildMockProviderModel(
  overrides: Partial<
    Awaited<ReturnType<typeof providerModelsModule.loadProviderModels>>[number]
  > = {},
) {
  return {
    id: "mock-model",
    display_name: "Mock Model",
    provider_id: "openai",
    provider_name: "OpenAI",
    family: "mock-model",
    tier: "pro" as const,
    capabilities: {
      vision: true,
      tools: true,
      streaming: true,
      json_mode: true,
      function_calling: true,
      reasoning: false,
      ...(overrides.capabilities || {}),
    },
    pricing: null,
    limits: {
      context_length: null,
      max_output_tokens: null,
      requests_per_minute: null,
      tokens_per_minute: null,
    },
    status: "active" as const,
    release_date: "2026-03-19",
    is_latest: true,
    description: null,
    source: "local" as const,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

export function createProject(id: string, archived = false) {
  return {
    id,
    name: `Project ${id}`,
    workspaceType: "general",
    rootPath: `/tmp/${id}`,
    isDefault: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isFavorite: false,
    isArchived: archived,
    tags: [],
  };
}

export function mountPage(
  initialProps: Partial<ComponentProps<typeof LocalConversationPage>> = {},
): MountedHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  // The default fixture is an existing conversation. Home scenarios explicitly
  // select their entry, and route/navigation tests keep their supplied identity.
  let currentProps = initialProps.agentEntry
    ? initialProps
    : { initialSessionId: "session-1", ...initialProps };

  const render = () => {
    root.render(
      <AppShell>
        <AppShellHeader />
        <LocalConversationPage {...currentProps} />
      </AppShell>,
    );
  };

  act(() => {
    render();
  });

  const harness: MountedHarness = {
    container,
    root,
    rerender: (props = {}) => {
      currentProps = { ...currentProps, ...props };
      act(() => {
        render();
      });
    },
  };

  mountedRoots.push(harness);
  return harness;
}

let committedNewConversationId = 0;
/** Test-only router boundary: deliver an accepted typed route to the real page consumer. */
export function commitNewConversationRoute(
  mounted: MountedHarness,
  options: { projectId?: string | null; freshDraft?: boolean } = {},
): true {
  const id = ++committedNewConversationId;
  const workspaceId = options.projectId ?? null;
  mounted.rerender({
    agentEntry: "new-task",
    initialSessionId: undefined,
    initialPendingServiceSkillLaunch: undefined,
    projectId: workspaceId ?? undefined,
    newChatAt: id,
    newConversationRequest: {
      id,
      workspaceId,
      freshDraft: options.freshDraft ?? true,
    },
  });
  return true;
}

export function renderPage(
  props: Partial<ComponentProps<typeof LocalConversationPage>> = {},
): HTMLDivElement {
  return mountPage(props).container;
}

export async function flushEffects(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 20);
      });
    });
  }
}

export async function waitForElement(
  container: { querySelector(selector: string): Element | null },
  selector: string,
  attempts = 30,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const element = container.querySelector(selector);
    if (element) {
      return element;
    }
    await flushEffects(1);
  }

  return null;
}

export function collectPendingA2UIFormIds(): Array<string | null> {
  return mockWorkspacePendingA2UIPanel.mock.calls.map((call) => {
    const props = call[0] as
      | {
          pendingA2UIForm?: {
            id?: string;
          } | null;
        }
      | undefined;
    return props?.pendingA2UIForm?.id ?? null;
  });
}

export async function waitForPendingA2UIForm(
  predicate: (form: { id?: string } | null | undefined) => boolean,
  attempts = 30,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const matchedCall = mockWorkspacePendingA2UIPanel.mock.calls
      .slice()
      .reverse()
      .find((call) => {
        const props = call[0] as
          | {
              pendingA2UIForm?: {
                id?: string;
              } | null;
            }
          | undefined;
        return predicate(props?.pendingA2UIForm);
      });
    if (matchedCall) {
      const props = matchedCall[0] as
        | {
            pendingA2UIForm?: {
              id?: string;
            } | null;
          }
        | undefined;
      return props?.pendingA2UIForm ?? null;
    }
    await flushEffects(1);
  }

  return null;
}

export function getSendMessageCall(callIndex = 0) {
  const call = sharedSendMessageMock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`未找到第 ${callIndex + 1} 次 sendMessage 调用`);
  }

  return {
    raw: call,
    content: call[0],
    images: call[1],
    webSearch: call[2],
    thinking: call[3],
    skipUserMessage: call[4],
    executionStrategy: call[5],
    modelOverride: call[6],
    autoContinue: call[7],
    options: call[8],
  };
}

export function clickButton(container: HTMLElement, testId: string) {
  const button = container.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLButtonElement | null;
  if (!button) {
    throw new Error(`未找到按钮: ${testId}`);
  }

  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export function findButton(container: HTMLElement, testId: string) {
  return container.querySelector(
    `[data-testid="${testId}"]`,
  ) as HTMLButtonElement | null;
}

export function createMockAgentChatUnifiedState(
  overrides: Record<string, unknown> = {},
) {
  return {
    providerType: "openai",
    setProviderType: vi.fn(),
    model: "mock-model",
    setModel: vi.fn(),
    executionStrategy: "react",
    setExecutionStrategy: vi.fn(),
    messages: [],
    isSending: false,
    sendMessage: sharedSendMessageMock,
    stopSending: vi.fn(async () => undefined),
    clearMessages: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    handlePermissionResponse: vi.fn(),
    triggerAIGuide: sharedTriggerAIGuideMock,
    topics: [
      {
        id: "topic-a",
        title: "话题 A",
        updatedAt: FIXED_TOPIC_UPDATED_AT,
      },
    ],
    sessionId: "session-1",
    switchTopic: sharedSwitchTopicMock,
    deleteTopic: vi.fn(),
    renameTopic: vi.fn(),
    workspacePathMissing: false,
    fixWorkspacePathAndRetry: vi.fn(),
    dismissWorkspacePathError: vi.fn(),
    ...overrides,
  };
}

export function installMockAgentChatUnifiedState(
  state: Record<string, unknown>,
) {
  mockUseAgentChatUnified.mockImplementation(
    ({ workspaceId }: { workspaceId?: string }) => {
      observedWorkspaceIds.push(workspaceId ?? "");
      return state;
    },
  );
}

export function getHookCallOrderForWorkspace(workspaceId: string): number {
  const index = mockUseAgentChatUnified.mock.calls.findIndex(
    (args: unknown[]) =>
      (args[0] as { workspaceId?: string } | undefined)?.workspaceId ===
      workspaceId,
  );
  if (index < 0) {
    throw new Error(`未找到 workspaceId=${workspaceId} 的 hook 调用`);
  }
  return mockUseAgentChatUnified.mock.invocationCallOrder[index];
}

export function mockBrowserAssistCompletedSession() {
  const state = createMockAgentChatUnifiedState({
    messages: [
      {
        id: "msg-browser-user",
        role: "user",
        content: "打开浏览器并访问官网",
        timestamp: new Date("2026-03-14T03:00:00.000Z"),
      },
      {
        id: "msg-browser-assistant",
        role: "assistant",
        content: "",
        timestamp: new Date("2026-03-14T03:00:01.000Z"),
        toolCalls: [
          {
            id: "tool-browser-open",
            name: "mcp__site__navigate",
            arguments: JSON.stringify({
              url: "https://www.rokid.com",
              profile_key: "general_browser_assist",
            }),
            status: "completed",
            startTime: new Date("2026-03-14T03:00:01.100Z"),
            endTime: new Date("2026-03-14T03:00:02.000Z"),
            result: {
              success: true,
              output: "已连接浏览器会话并完成首屏加载",
              metadata: {
                result: {
                  session_id: "browser-session-1",
                  profile_key: "general_browser_assist",
                  page_info: {
                    title: "Rokid",
                    url: "https://www.rokid.com",
                  },
                },
              },
            },
          },
        ],
      },
    ],
  });

  installMockAgentChatUnifiedState(state);
}

let draftHarness: Awaited<ReturnType<typeof createDraftHarness>> | undefined;

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );

  vi.clearAllMocks();
  draftHarness = await createDraftHarness({
    safeInvoke: mockPersistedAtomInvoke,
    safeListen: mockPersistedAtomListen,
  });
  const originalConsoleError = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = String(args[0] ?? "");
    if (
      message.includes("not wrapped in act") ||
      message.includes("A suspended resource finished loading inside a test")
    ) {
      return;
    }
    originalConsoleError(...args);
  });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  localStorage.clear();
  sessionStorage.clear();
  resetInitialSessionNavigationDeduplicationForTests();
  observedWorkspaceIds.length = 0;

  mockGetProject.mockImplementation(async (projectId: string) => {
    if (!projectId) {
      return null;
    }
    return createProject(projectId);
  });
  mockGetDefaultProject.mockResolvedValue(null);
  mockGetOrCreateDefaultProject.mockResolvedValue(null);
  mockGetConfig.mockResolvedValue({ memory: {} });
  mockGetDefaultProviderFromConfig.mockResolvedValue("openai");
  mockSubscribeAppConfigChanged.mockReturnValue(() => undefined);
  mockGetContent.mockResolvedValue(null);
  mockGetGeneralWorkbenchDocumentState.mockResolvedValue(null);
  mockEnsureProjectWorkspace.mockRejectedValue(
    new Error("Worktree setup is not configured in this page fixture"),
  );
  mockEnsureWorkspaceReady.mockResolvedValue({
    workspaceId: "workspace-test",
    rootPath: "/tmp/workspace-test",
    existed: true,
    created: false,
    repaired: false,
    relocated: false,
    previousRootPath: null,
    warning: null,
  });
  mockUpdateContent.mockResolvedValue(undefined);
  mockGetProjectMemory.mockResolvedValue(null);
  mockExecutionRunGetGeneralWorkbenchState.mockResolvedValue({
    run_state: "idle",
    queue_items: [],
    latest_terminal: null,
    recent_terminals: [],
    updated_at: "2026-03-06T00:00:00.000Z",
  });
  mockExecutionRunListGeneralWorkbenchHistory.mockResolvedValue({
    items: [],
    has_more: false,
    next_offset: null,
  });
  mockExecutionRunGet.mockResolvedValue(null);
  mockSkillExecutionListExecutableSkills.mockResolvedValue([
    {
      skill_id: "builtin:content_post_with_cover",
      name: "content_post_with_cover",
    },
  ]);
  mockSkillExecutionGetDetail.mockResolvedValue({
    name: "content_post_with_cover",
    display_name: "社媒主稿与封面",
    description: "生成社媒内容",
    execution_mode: "prompt",
    has_workflow: false,
    workflow_steps: [],
  });
  mockSkillsGetAll.mockResolvedValue([]);
  mockSkillsGetLocal.mockResolvedValue([]);
  mockGetAgentRuntimeToolInventory.mockResolvedValue({
    surface: {
      workbench: false,
      browser_assist: false,
    },
    catalog: [],
    registry: [],
    extensions: {
      surface_entries: [],
      tool_entries: [],
    },
    mcp_tools: [],
    counts: {
      catalog_total: 0,
      catalog_current_total: 0,
      catalog_compat_total: 0,
      native_total: 0,
      extension_surface_total: 0,
      extension_tool_total: 0,
      mcp_total: 0,
      visible_total: 0,
    },
  });
  mockLaunchBrowserSession.mockResolvedValue({
    profile: {
      success: true,
      reused: true,
      browser_source: "system",
    },
    session: {
      session_id: "auto-browser-session-1",
      profile_key: "general_browser_assist",
      target_id: "target-auto-1",
      target_title: "账户中心",
      target_url: "https://accounts.example.com",
      remote_debugging_port: 16312,
      ws_debugger_url: "ws://127.0.0.1:16312/devtools/page/target-auto-1",
      devtools_frontend_url: undefined,
      stream_mode: "both",
      transport_kind: "cdp_frames",
      lifecycle_state: "live",
      control_mode: "agent",
      human_reason: undefined,
      last_page_info: {
        title: "账户中心",
        url: "https://accounts.example.com",
        markdown: "",
        updated_at: "2026-03-14T03:10:02.000Z",
      },
      last_event_at: "2026-03-14T03:10:02.000Z",
      last_frame_at: "2026-03-14T03:10:02.200Z",
      last_error: undefined,
      created_at: "2026-03-14T03:10:01.500Z",
      connected: true,
    },
  });
  mockBrowserExecuteAction.mockResolvedValue({
    success: true,
    backend: "cdp_direct",
    session_id: "browser-session-1",
    target_id: "target-auto-1",
    action: "navigate",
    request_id: "browser-action-1",
    data: {
      page_info: {
        title: "新页面",
        url: "https://example.com",
      },
    },
    error: undefined,
    attempts: [],
  });
  mockExecuteBrowserSessionAction.mockResolvedValue({
    sessionId: "browser-session-1",
    action: "navigate",
    result: {
      page_info: {
        title: "新页面",
        url: "https://example.com",
      },
    },
  });
  vi.spyOn(
    configuredProvidersModule,
    "loadConfiguredProviders",
  ).mockResolvedValue([
    {
      key: "openai",
      label: "OpenAI",
      registryId: "openai",
      type: "openai",
    },
  ]);
  vi.spyOn(providerModelsModule, "loadProviderModels").mockResolvedValue([
    buildMockProviderModel(),
  ]);
  mockIsSpecializedWorkbenchTheme.mockReturnValue(false);
  mockEmptyState.mockImplementation((props?: MockEmptyStateProps) => (
    <div
      data-testid="empty-state"
      data-active-theme={props?.activeTheme || ""}
      data-session-id={props?.sessionId ?? ""}
    >
      {props?.activeTheme === "general" ? (
        <div data-testid="home-composer-page" />
      ) : null}
      {props?.input || ""}
    </div>
  ));
  mockSafeListen.mockResolvedValue(vi.fn());
  mockUseTrayModelShortcuts.mockReturnValue(undefined);
  const sessionRecentMetadataActiveSessionRef: { current: string | null } = {
    current: null,
  };
  mockUseSessionRecentMetadataSyncRuntime.mockReturnValue({
    activeSessionIdRef: sessionRecentMetadataActiveSessionRef,
    chatToolPreferenceSessionSync: {
      getSessionId: () => sessionRecentMetadataActiveSessionRef.current,
      setSessionRecentPreferences: vi.fn(async () => undefined),
    },
    deferSessionRecentMetadataSyncForNavigation: vi.fn(),
    syncSessionRecentPreferences: vi.fn(async () => undefined),
  });
  mockUseGlobalMediaGenerationDefaults.mockReturnValue({
    mediaDefaults: {},
    loading: false,
  });
  mockReadGlobalMediaGenerationDefaults.mockResolvedValue({});
  mockUseServiceModelsConfig.mockReturnValue({
    serviceModels: {},
    agentResponseLanguage: undefined,
    loading: false,
    refresh: vi.fn(async () => ({
      serviceModels: {},
      agentResponseLanguage: undefined,
    })),
  });

  mockUseImageGen.mockReturnValue({
    availableProviders: [],
    selectedProvider: null,
    selectedProviderId: "",
    setSelectedProviderId: vi.fn(),
    providersLoading: false,
    preferredProviderUnavailable: false,
    availableModels: [],
    selectedModel: null,
    selectedModelId: "",
    setSelectedModelId: vi.fn(),
    selectedSize: "1024x1024",
    setSelectedSize: vi.fn(),
  });
  mockInputbar.mockClear();
  mockWorkspacePendingA2UIPanel.mockClear();
  mockUseTopicBranchBoard.mockReturnValue({
    branchItems: [
      {
        id: "topic-a",
        title: "话题 A",
        status: "in_progress",
        isCurrent: true,
      },
    ],
    setTopicStatus: vi.fn(),
  });
  mockUseSessionFiles.mockReturnValue({
    saveFile: vi.fn(async () => undefined),
    files: [],
    readFile: vi.fn(async () => null),
    meta: null,
  });
  mockCanvasWorkbenchLayoutState.renderPreviewProbe = false;
  mockRequestWorkspaceRightSurface.mockReset();
  mockRequestWorkspaceRightSurface.mockResolvedValue(undefined);

  mockJotaiState.artifacts = [];
  mockJotaiState.selectedArtifact = null;
  mockJotaiState.selectedArtifactId = null;
  mockSetArtifactsAtom.mockImplementation((next) => {
    mockJotaiState.artifacts =
      typeof next === "function" ? next(mockJotaiState.artifacts) : next;
    const nextId = mockJotaiState.selectedArtifactId;
    mockJotaiState.selectedArtifact =
      nextId == null
        ? null
        : (mockJotaiState.artifacts.find(
            (artifact) =>
              (artifact as { id?: string } | null | undefined)?.id === nextId,
          ) as Record<string, unknown> | null) || null;
  });
  mockSetSelectedArtifactIdAtom.mockImplementation((next) => {
    mockJotaiState.selectedArtifactId =
      typeof next === "function"
        ? next(mockJotaiState.selectedArtifactId)
        : next;
    const nextId = mockJotaiState.selectedArtifactId;
    mockJotaiState.selectedArtifact =
      nextId == null
        ? null
        : (mockJotaiState.artifacts.find(
            (artifact) =>
              (artifact as { id?: string } | null | undefined)?.id === nextId,
          ) as Record<string, unknown> | null) || null;
  });

  sharedSwitchTopicMock = vi.fn(async () => undefined);
  sharedSendMessageMock = vi.fn(async () => acceptedSubmission());
  sharedTriggerAIGuideMock = vi.fn();
  installMockAgentChatUnifiedState(createMockAgentChatUnifiedState());
}, 60_000);

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  await draftHarness?.close();
  draftHarness = undefined;
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

export function getIndexTestMocks() {
  return {
    mockUseAgentChatUnified,
    mockUseArtifactAutoPreviewSync,
    mockUseTopicBranchBoard,
    mockUseSessionFiles,
    mockUseTrayModelShortcuts,
    mockSafeListen,
    mockUseSessionRecentMetadataSyncRuntime,
    mockUseGlobalMediaGenerationDefaults,
    mockReadGlobalMediaGenerationDefaults,
    mockUseServiceModelsConfig,

    mockUseImageGen,
    mockGetConfig,
    mockGetDefaultProviderFromConfig,
    mockSubscribeAppConfigChanged,
    mockGetProject,
    mockGetDefaultProject,
    mockGetOrCreateDefaultProject,
    mockGetContent,
    mockGetGeneralWorkbenchDocumentState,
    mockEnsureWorkspaceReady,
    mockEnsureProjectWorkspace,
    mockUpdateContent,
    mockGetProjectMemory,
    mockToast,
    mockArtifactsAtom,
    mockSelectedArtifactAtom,
    mockSelectedArtifactIdAtom,
    mockSetArtifactsAtom,
    mockSetSelectedArtifactIdAtom,
    mockJotaiState,
    mockIsSpecializedWorkbenchTheme,
    mockEmptyState,
    mockInputbar,
    mockMessageList,
    mockExpertInfoPanel,
    mockWorkspacePendingA2UIPanel,
    mockExecutionRunGetGeneralWorkbenchState,
    mockExecutionRunListGeneralWorkbenchHistory,
    mockExecutionRunGet,
    mockSkillExecutionListExecutableSkills,
    mockSkillExecutionGetDetail,
    mockSkillsGetAll,
    mockSkillsGetLocal,
    mockGetAgentRuntimeToolInventory,
    mockRequestWorkspaceRightSurface,
    mockCanvasWorkbenchLayoutState,
    mockCanvasWorkbenchLayout,
    mockLaunchBrowserSession,
    mockBrowserExecuteAction,
    mockExecuteBrowserSessionAction,
  };
}
