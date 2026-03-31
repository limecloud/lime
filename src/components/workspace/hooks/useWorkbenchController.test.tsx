import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  clickByTestId,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "./testUtils";
import {
  type UseWorkbenchControllerParams,
  useWorkbenchController,
} from "./useWorkbenchController";

const {
  mockGetProjectTypeLabel,
  mockGetThemeModule,
  mockToastError,
  mockToastSuccess,
  mockUpdateContent,
  mockUseCreationDialogs,
  mockUseWorkbenchNavigation,
  mockUseWorkbenchPanelRenderer,
  mockUseWorkbenchProjectData,
  mockUseWorkbenchQuickActions,
  mockUseWorkbenchStore,
} = vi.hoisted(() => ({
  mockGetProjectTypeLabel: vi.fn(),
  mockGetThemeModule: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockUseCreationDialogs: vi.fn(),
  mockUseWorkbenchNavigation: vi.fn(),
  mockUseWorkbenchPanelRenderer: vi.fn(),
  mockUseWorkbenchProjectData: vi.fn(),
  mockUseWorkbenchQuickActions: vi.fn(),
  mockUseWorkbenchStore: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("@/stores/useWorkbenchStore", () => ({
  useWorkbenchStore: mockUseWorkbenchStore,
}));

vi.mock("@/lib/api/project", () => ({
  updateContent: mockUpdateContent,
  getProjectTypeLabel: mockGetProjectTypeLabel,
}));

vi.mock("@/features/themes", () => ({
  getThemeModule: mockGetThemeModule,
}));

vi.mock("./useWorkbenchProjectData", () => ({
  useWorkbenchProjectData: mockUseWorkbenchProjectData,
}));

vi.mock("./useWorkbenchNavigation", () => ({
  useWorkbenchNavigation: mockUseWorkbenchNavigation,
}));

vi.mock("./useCreationDialogs", () => ({
  useCreationDialogs: mockUseCreationDialogs,
}));

vi.mock("./useWorkbenchPanelRenderer", () => ({
  useWorkbenchPanelRenderer: mockUseWorkbenchPanelRenderer,
}));

vi.mock("./useWorkbenchQuickActions", () => ({
  useWorkbenchQuickActions: mockUseWorkbenchQuickActions,
}));

type ControllerHarnessProps = UseWorkbenchControllerParams;

function createProjectDataHookValue(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    projects: [{ id: "project-1", name: "项目A" }],
    projectsLoading: false,
    selectedProjectId: "project-1",
    setSelectedProjectId: vi.fn(),
    contents: [{ id: "content-1", title: "文稿A" }],
    contentsLoading: false,
    selectedContentId: "content-1",
    setSelectedContentId: vi.fn(),
    projectQuery: "",
    setProjectQuery: vi.fn(),
    contentQuery: "",
    setContentQuery: vi.fn(),
    selectedProject: { id: "project-1", name: "项目A" },
    filteredProjects: [{ id: "project-1", name: "项目A" }],
    filteredContents: [{ id: "content-1", title: "文稿A" }],
    loadProjects: vi.fn(async () => undefined),
    loadContents: vi.fn(async () => undefined),
    resetProjectAndContentQueries: vi.fn(),
    clearContentsSelection: vi.fn(),
    ...overrides,
  };
}

function WorkbenchControllerHarness(props: ControllerHarnessProps) {
  const controller = useWorkbenchController(props);

  return (
    <div
      data-current-content-title={controller.currentContentTitle ?? ""}
      data-project-type-label={controller.projectTypeLabel}
    >
      <button
        data-testid="quick-save"
        onClick={() => {
          void controller.handleQuickSaveCurrent();
        }}
      />
      <button
        data-testid="enter-workspace"
        onClick={() =>
          controller.handleEnterWorkspace("content-new")
        }
      />
    </div>
  );
}

const mountedRoots: MountedRoot[] = [];

function renderHarness(props: Partial<ControllerHarnessProps> = {}) {
  return mountHarness(
    WorkbenchControllerHarness,
    {
      theme: "social-media",
      initialProjectId: "project-1",
      initialContentId: "content-1",
      initialViewMode: "workspace",
      ...props,
    },
    mountedRoots,
  );
}

function click(container: HTMLElement, testId: string): void {
  const button = clickByTestId(container, testId);
  expect(button).not.toBeNull();
}

beforeEach(() => {
  setupReactActEnvironment();
  vi.clearAllMocks();

  mockUseWorkbenchStore.mockReturnValue({
    leftSidebarCollapsed: true,
    toggleLeftSidebar: vi.fn(),
    setLeftSidebarCollapsed: vi.fn(),
  });

  mockGetThemeModule.mockReturnValue({
    navigation: {
      defaultView: "create",
      items: [{ key: "create", label: "创作" }],
    },
    capabilities: {
      workspaceKind: "agent-chat",
    },
    panelRenderers: {},
    workspaceRenderer: () => null,
    primaryWorkspaceRenderer: undefined,
  });

  mockGetProjectTypeLabel.mockReturnValue("社媒内容");

  mockUseWorkbenchProjectData.mockReturnValue(createProjectDataHookValue());

  mockUseWorkbenchNavigation.mockReturnValue({
    workflowProgress: null,
    setWorkflowProgress: vi.fn(),
    showWorkflowRail: false,
    setShowWorkflowRail: vi.fn(),
    workspaceMode: "workspace",
    setWorkspaceMode: vi.fn(),
    activeWorkspaceView: "create",
    setActiveWorkspaceView: vi.fn(),
    shouldRenderLeftSidebar: false,
    isCreateWorkspaceView: true,
    showCreateContentEntryHome: false,
    shouldRenderWorkspaceRightRail: true,
    activeWorkspaceViewLabel: "创作",
    hasWorkflowWorkspaceView: true,
    hasPublishWorkspaceView: true,
    hasSettingsWorkspaceView: true,
    applyInitialNavigationState: vi.fn(),
    handleOpenWorkflowView: vi.fn(),
    handleBackToProjectManagement: vi.fn(),
    handleEnterWorkspaceView: vi.fn(),
    handleSwitchWorkspaceView: vi.fn(),
  });

  mockUseCreationDialogs.mockReturnValue({
    createProjectDialogOpen: false,
    setCreateProjectDialogOpen: vi.fn(),
    createContentDialogOpen: false,
    setCreateContentDialogOpen: vi.fn(),
    createContentDialogStep: "mode",
    setCreateContentDialogStep: vi.fn(),
    newProjectName: "",
    setNewProjectName: vi.fn(),
    workspaceProjectsRoot: "/tmp/workspace",
    creatingProject: false,
    creatingContent: false,
    selectedCreationMode: "guided",
    setSelectedCreationMode: vi.fn(),
    creationIntentValues: {},
    creationIntentError: "",
    setCreationIntentError: vi.fn(),
    currentCreationIntentFields: [],
    currentIntentLength: 0,
    pendingInitialPromptsByContentId: {},
    pendingCreateConfirmationByProjectId: {},
    creationModes: {},
    creationTypes: {},
    resolvedProjectPath: "",
    pathChecking: false,
    pathConflictMessage: "",
    resetCreateContentDialogState: vi.fn(),
    handleOpenCreateProjectDialog: vi.fn(),
    handleCreateProject: vi.fn(),
    handleOpenCreateContentDialog: vi.fn(),
    handleCreationIntentValueChange: vi.fn(),
    handleGoToIntentStep: vi.fn(),
    handleCreateContent: vi.fn(),
    handleQuickCreateProjectAndContent: vi.fn(),
    handleOpenProjectForWriting: vi.fn(),
    submitCreateConfirmation: vi.fn(),
    consumePendingInitialPrompt: vi.fn(),
    consumePendingCreateConfirmation: vi.fn(),
  });

  mockUseWorkbenchPanelRenderer.mockReturnValue({
    activePanelRenderer: null,
  });

  mockUseWorkbenchQuickActions.mockReturnValue({
    nonCreateQuickActions: [],
  });
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
});

describe("useWorkbenchController", () => {
  it("应在初始化时触发项目加载与导航初始化", async () => {
    renderHarness();
    await flushEffects(5);

    const projectData = mockUseWorkbenchProjectData.mock.results[0]
      .value as Record<string, unknown>;
    const navigation = mockUseWorkbenchNavigation.mock.results[0].value as Record<
      string,
      unknown
    >;

    const resetQueries = projectData.resetProjectAndContentQueries as ReturnType<
      typeof vi.fn
    >;
    const setSelectedProjectId = projectData.setSelectedProjectId as ReturnType<
      typeof vi.fn
    >;
    const setSelectedContentId = projectData.setSelectedContentId as ReturnType<
      typeof vi.fn
    >;
    const loadProjects = projectData.loadProjects as ReturnType<typeof vi.fn>;
    const applyInitialNavigationState =
      navigation.applyInitialNavigationState as ReturnType<typeof vi.fn>;

    expect(resetQueries).toHaveBeenCalledTimes(1);
    expect(setSelectedProjectId).toHaveBeenCalledWith("project-1");
    expect(setSelectedContentId).toHaveBeenCalledWith("content-1");
    expect(applyInitialNavigationState).toHaveBeenCalledWith("workspace", "content-1");
    expect(loadProjects).toHaveBeenCalledTimes(1);
  });

  it("handleEnterWorkspace 应同步更新工作区关键状态", async () => {
    const { container } = renderHarness();
    await flushEffects();

    click(container, "enter-workspace");
    await flushEffects();

    const projectData = mockUseWorkbenchProjectData.mock.results[0]
      .value as Record<string, unknown>;
    const navigation = mockUseWorkbenchNavigation.mock.results[0].value as Record<
      string,
      unknown
    >;
    const store = mockUseWorkbenchStore.mock.results[0].value as Record<
      string,
      unknown
    >;

    const setSelectedContentId = projectData.setSelectedContentId as ReturnType<
      typeof vi.fn
    >;
    const setWorkspaceMode = navigation.setWorkspaceMode as ReturnType<typeof vi.fn>;
    const setActiveWorkspaceView =
      navigation.setActiveWorkspaceView as ReturnType<typeof vi.fn>;
    const setLeftSidebarCollapsed =
      store.setLeftSidebarCollapsed as ReturnType<typeof vi.fn>;

    expect(setSelectedContentId).toHaveBeenCalledWith("content-new");
    expect(setWorkspaceMode).toHaveBeenCalledWith("workspace");
    expect(setActiveWorkspaceView).toHaveBeenCalledWith("create");
    expect(setLeftSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it("handleQuickSaveCurrent 成功时应保存并刷新文稿列表", async () => {
    mockUpdateContent.mockResolvedValueOnce(undefined);

    const { container } = renderHarness();
    await flushEffects(5);

    const projectData = mockUseWorkbenchProjectData.mock.results[0]
      .value as Record<string, unknown>;
    const loadContents = projectData.loadContents as ReturnType<typeof vi.fn>;
    const callsBeforeSave = loadContents.mock.calls.length;

    click(container, "quick-save");
    await flushEffects(5);

    expect(mockUpdateContent).toHaveBeenCalledWith("content-1", {
      metadata: {
        saved_from: "theme-workspace",
        saved_at: expect.any(Number),
      },
    });
    expect(loadContents.mock.calls.length).toBe(callsBeforeSave + 1);
    expect(loadContents).toHaveBeenLastCalledWith("project-1");
    expect(mockToastSuccess).toHaveBeenCalledWith("已保存当前文稿");
  });

  it("handleQuickSaveCurrent 在未选中项目或文稿时应直接返回", async () => {
    mockUseWorkbenchProjectData.mockReturnValueOnce(
      createProjectDataHookValue({
        selectedProjectId: null,
        selectedContentId: null,
      }),
    );

    const { container } = renderHarness();
    await flushEffects(3);

    click(container, "quick-save");
    await flushEffects(3);

    expect(mockUpdateContent).not.toHaveBeenCalled();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("handleQuickSaveCurrent 失败时应提示错误", async () => {
    mockUpdateContent.mockRejectedValueOnce(new Error("save-failed"));
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const { container } = renderHarness();
      await flushEffects(5);

      click(container, "quick-save");
      await flushEffects(5);

      expect(mockUpdateContent).toHaveBeenCalledTimes(1);
      expect(mockToastError).toHaveBeenCalledWith("保存失败");
      expect(consoleErrorSpy).toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("快捷键 Ctrl/Cmd+B 应触发左侧栏切换", async () => {
    const toggleLeftSidebar = vi.fn();
    mockUseWorkbenchStore.mockReturnValueOnce({
      leftSidebarCollapsed: true,
      toggleLeftSidebar,
      setLeftSidebarCollapsed: vi.fn(),
    });

    renderHarness();
    await flushEffects();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        ctrlKey: true,
        bubbles: true,
      }),
    );
    await flushEffects();

    expect(toggleLeftSidebar).toHaveBeenCalledTimes(1);
  });
});
