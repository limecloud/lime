import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type UseCreationDialogsParams,
  useCreationDialogs,
} from "./useCreationDialogs";
import {
  cleanupMountedRoots,
  clickByTestId,
  flushEffects,
  getRootElement,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "./testUtils";

const {
  mockCreateContent,
  mockCreateProject,
  mockExtractErrorMessage,
  mockGetContent,
  mockGetContentTypeLabel,
  mockGetCreateProjectErrorMessage,
  mockGetDefaultContentTypeForProject,
  mockGetProjectByRootPath,
  mockGetProjectTypeLabel,
  mockGetWorkspaceProjectsRoot,
  mockListContents,
  mockNotifyProjectCreatedWithRuntimeAgentsGuide,
  mockResolveProjectRootPath,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockCreateContent: vi.fn(),
  mockCreateProject: vi.fn(),
  mockExtractErrorMessage: vi.fn(),
  mockGetContent: vi.fn(),
  mockGetContentTypeLabel: vi.fn(),
  mockGetCreateProjectErrorMessage: vi.fn(),
  mockGetDefaultContentTypeForProject: vi.fn(),
  mockGetProjectByRootPath: vi.fn(),
  mockGetProjectTypeLabel: vi.fn(),
  mockGetWorkspaceProjectsRoot: vi.fn(),
  mockListContents: vi.fn(),
  mockNotifyProjectCreatedWithRuntimeAgentsGuide: vi.fn(),
  mockResolveProjectRootPath: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("@/lib/api/project", () => ({
  createContent: mockCreateContent,
  createProject: mockCreateProject,
  extractErrorMessage: mockExtractErrorMessage,
  getContent: mockGetContent,
  getContentTypeLabel: mockGetContentTypeLabel,
  getCreateProjectErrorMessage: mockGetCreateProjectErrorMessage,
  getDefaultContentTypeForProject: mockGetDefaultContentTypeForProject,
  getProjectByRootPath: mockGetProjectByRootPath,
  getProjectTypeLabel: mockGetProjectTypeLabel,
  getWorkspaceProjectsRoot: mockGetWorkspaceProjectsRoot,
  listContents: mockListContents,
  resolveProjectRootPath: mockResolveProjectRootPath,
}));

vi.mock("@/components/workspace/services/runtimeAgentsGuideService", () => ({
  notifyProjectCreatedWithRuntimeAgentsGuide:
    mockNotifyProjectCreatedWithRuntimeAgentsGuide,
}));

type HarnessProps = UseCreationDialogsParams;

function CreationDialogsHarness(props: HarnessProps) {
  const dialogs = useCreationDialogs(props);

  return (
    <div
      data-create-project-open={String(dialogs.createProjectDialogOpen)}
      data-create-content-open={String(dialogs.createContentDialogOpen)}
      data-create-content-step={dialogs.createContentDialogStep}
      data-selected-creation-mode={dialogs.selectedCreationMode}
      data-new-project-name={dialogs.newProjectName}
      data-workspace-root={dialogs.workspaceProjectsRoot}
      data-resolved-project-path={dialogs.resolvedProjectPath}
      data-path-checking={String(dialogs.pathChecking)}
      data-path-conflict-message={dialogs.pathConflictMessage}
      data-creating-project={String(dialogs.creatingProject)}
      data-creating-content={String(dialogs.creatingContent)}
      data-creation-intent-error={dialogs.creationIntentError}
      data-current-intent-length={String(dialogs.currentIntentLength)}
      data-pending-prompts={JSON.stringify(dialogs.pendingInitialPromptsByContentId)}
      data-pending-create-confirmations={JSON.stringify(
        dialogs.pendingCreateConfirmationByProjectId,
      )}
      data-content-modes={JSON.stringify(dialogs.contentCreationModes)}
    >
      <button
        data-testid="open-project-dialog"
        onClick={dialogs.handleOpenCreateProjectDialog}
      />
      <button
        data-testid="close-project-dialog"
        onClick={() => dialogs.setCreateProjectDialogOpen(false)}
      />
      <button
        data-testid="set-project-name-new"
        onClick={() => dialogs.setNewProjectName("新项目A")}
      />
      <button
        data-testid="set-project-name-conflict"
        onClick={() => dialogs.setNewProjectName("冲突项目")}
      />
      <button
        data-testid="create-project"
        onClick={() => {
          void dialogs.handleCreateProject();
        }}
      />

      <button
        data-testid="open-content-dialog"
        onClick={dialogs.handleOpenCreateContentDialog}
      />
      <button
        data-testid="force-open-content-dialog"
        onClick={() => dialogs.setCreateContentDialogOpen(true)}
      />
      <button data-testid="goto-intent" onClick={dialogs.handleGoToIntentStep} />
      <button
        data-testid="set-mode-hybrid"
        onClick={() => dialogs.setSelectedCreationMode("hybrid")}
      />
      <button
        data-testid="set-mode-invalid"
        onClick={() =>
          (dialogs.setSelectedCreationMode as (mode: unknown) => void)(
            "ai-discuss",
          )
        }
      />
      <button
        data-testid="fill-intent-topic"
        onClick={() =>
          dialogs.handleCreationIntentValueChange("topic", "这是一个足够详细的创作主题")
        }
      />
      <button
        data-testid="create-content"
        onClick={() => {
          void dialogs.handleCreateContent();
        }}
      />
      <button
        data-testid="consume-prompt"
        onClick={() => dialogs.consumePendingInitialPrompt("content-new")}
      />
      <button
        data-testid="create-from-workspace-prompt"
        onClick={() => {
          void dialogs.handleCreateContentFromWorkspacePrompt("请生成一条面向 CTO 的标题");
        }}
      />
      <button
        data-testid="open-project-writing"
        onClick={() => {
          void dialogs.handleOpenProjectForWriting("project-1", {
            initialUserPrompt: "请先给我一个完整大纲",
            creationMode: "guided",
          });
        }}
      />
      <button
        data-testid="submit-confirm-create"
        onClick={() => {
          void dialogs.submitCreateConfirmation("project-1", {
            create_confirmation_option: ["new_post"],
            create_confirmation_note: "",
          });
        }}
      />
      <button
        data-testid="submit-confirm-continue"
        onClick={() => {
          void dialogs.submitCreateConfirmation("project-1", {
            create_confirmation_option: ["continue_history"],
            create_confirmation_note: "",
          });
        }}
      />
      <button
        data-testid="consume-create-confirmation"
        onClick={() => dialogs.consumePendingCreateConfirmation("project-1")}
      />
    </div>
  );
}

const mountedRoots: MountedRoot[] = [];

function createHarnessProps(overrides: Partial<HarnessProps> = {}): HarnessProps {
  return {
    theme: "social-media",
    selectedProjectId: null,
    selectedContentId: null,
    loadProjects: vi.fn(async () => undefined),
    loadContents: vi.fn(async () => undefined),
    onEnterWorkspace: vi.fn(),
    onProjectCreated: vi.fn(),
    defaultCreationMode: "guided",
    minCreationIntentLength: 10,
    ...overrides,
  };
}

function renderHarness(props: Partial<HarnessProps> = {}) {
  return mountHarness(
    CreationDialogsHarness,
    createHarnessProps(props),
    mountedRoots,
  );
}

function click(container: HTMLElement, testId: string): void {
  const button = clickByTestId(container, testId);
  expect(button).not.toBeNull();
}

async function openContentIntentStep(container: HTMLElement): Promise<void> {
  click(container, "force-open-content-dialog");
  await flushEffects();
  click(container, "goto-intent");
  await flushEffects();
}

function parseRootDatasetRecord<T = Record<string, unknown>>(
  root: HTMLElement | null,
  key: string,
): T {
  const value = root?.dataset[key] ?? "{}";
  return JSON.parse(value) as T;
}

beforeEach(() => {
  setupReactActEnvironment();

  vi.clearAllMocks();

  mockGetWorkspaceProjectsRoot.mockResolvedValue("/tmp/workspace");
  mockGetProjectTypeLabel.mockReturnValue("社媒内容");
  mockResolveProjectRootPath.mockImplementation(
    async (name: string) => `/tmp/workspace/${name}`,
  );
  mockGetProjectByRootPath.mockResolvedValue(null);
  mockCreateProject.mockResolvedValue({
    id: "project-new",
    name: "新项目A",
    rootPath: "/tmp/workspace/新项目A",
  });
  mockExtractErrorMessage.mockReturnValue("mock-error");
  mockGetCreateProjectErrorMessage.mockReturnValue("mock-friendly-error");

  mockGetDefaultContentTypeForProject.mockReturnValue("post");
  mockGetContentTypeLabel.mockReturnValue("文稿");
  mockListContents.mockResolvedValue([]);
  mockCreateContent.mockResolvedValue({
    id: "content-new",
  });
  mockGetContent.mockResolvedValue(null);
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
});

describe("useCreationDialogs", () => {
  it("点击新建文稿入口应进入页面式创建，而不是打开弹窗", async () => {
    const onEnterWorkspace = vi.fn();
    const { container } = renderHarness({
      selectedProjectId: "project-1",
      onEnterWorkspace,
    });
    await flushEffects();

    click(container, "open-content-dialog");
    await flushEffects();

    expect(onEnterWorkspace).toHaveBeenCalledWith("", { createEntryHome: true });
    const root = getRootElement(container);
    expect(root?.dataset.createContentOpen).toBe("false");
    const pendingConfirmations = parseRootDatasetRecord<
      Record<string, { source: string }>
    >(root, "pendingCreateConfirmations");
    expect(pendingConfirmations["project-1"]?.source).toBe("workspace_create_entry");
  });

  it("初始化传入外部创建提示词时应自动进入确认页", async () => {
    const onEnterWorkspace = vi.fn();
    const { container } = renderHarness({
      selectedProjectId: "project-1",
      onEnterWorkspace,
      initialCreateConfirmation: {
        prompt: "请基于推荐主题生成内容大纲",
        source: "workspace_prompt",
        fallbackContentTitle: "推荐主题",
      },
    });
    await flushEffects(3);

    expect(onEnterWorkspace).toHaveBeenCalledWith("", { createEntryHome: true });
    const root = getRootElement(container);
    const pendingConfirmations = parseRootDatasetRecord<
      Record<string, { source: string; initialUserPrompt?: string }>
    >(root, "pendingCreateConfirmations");
    expect(pendingConfirmations["project-1"]?.source).toBe("workspace_prompt");
    expect(pendingConfirmations["project-1"]?.initialUserPrompt).toContain("推荐主题");
  });

  it("创建项目成功后应关闭弹窗并触发回调", async () => {
    const loadProjects = vi.fn(async () => undefined);
    const onProjectCreated = vi.fn();

    const { container } = renderHarness({
      loadProjects,
      onProjectCreated,
    });
    await flushEffects();

    click(container, "open-project-dialog");
    await flushEffects();
    click(container, "set-project-name-new");
    await flushEffects();
    click(container, "create-project");
    await flushEffects(6);

    expect(mockCreateProject).toHaveBeenCalledWith({
      name: "新项目A",
      rootPath: "/tmp/workspace/新项目A",
      workspaceType: "social-media",
    });
    expect(onProjectCreated).toHaveBeenCalledWith("project-new");
    expect(loadProjects).toHaveBeenCalledTimes(1);
    expect(mockCreateContent).not.toHaveBeenCalled();
    expect(mockNotifyProjectCreatedWithRuntimeAgentsGuide).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "project-new",
        rootPath: "/tmp/workspace/新项目A",
      }),
      "已创建新项目",
    );

    const root = getRootElement(container);
    expect(root?.dataset.createProjectOpen).toBe("false");
    expect(root?.dataset.creatingProject).toBe("false");
    const pendingConfirmations = parseRootDatasetRecord<
      Record<string, { source: string }>
    >(root, "pendingCreateConfirmations");
    expect(pendingConfirmations["project-new"]?.source).toBe("project_created");
  });

  it("打开项目弹窗后应检测路径冲突", async () => {
    mockGetProjectByRootPath.mockImplementation(async (rootPath: string) => {
      if (rootPath.endsWith("/冲突项目")) {
        return { id: "project-existing", name: "历史项目" };
      }
      return null;
    });

    const { container } = renderHarness();
    await flushEffects();

    click(container, "open-project-dialog");
    await flushEffects();
    click(container, "set-project-name-conflict");
    await flushEffects(6);

    const root = getRootElement(container);
    expect(root?.dataset.resolvedProjectPath).toBe("/tmp/workspace/冲突项目");
    expect(root?.dataset.pathChecking).toBe("false");
    expect(root?.dataset.pathConflictMessage).toBe("路径已存在项目：历史项目");
    expect(mockGetProjectByRootPath).toHaveBeenCalledWith("/tmp/workspace/冲突项目");
  });

  it("关闭项目弹窗后应重置路径状态", async () => {
    mockGetProjectByRootPath.mockImplementation(async (rootPath: string) => {
      if (rootPath.endsWith("/冲突项目")) {
        return { id: "project-existing", name: "历史项目" };
      }
      return null;
    });

    const { container } = renderHarness();
    await flushEffects();

    click(container, "open-project-dialog");
    await flushEffects();
    click(container, "set-project-name-conflict");
    await flushEffects(6);

    let root = getRootElement(container);
    expect(root?.dataset.pathConflictMessage).toBe("路径已存在项目：历史项目");
    expect(root?.dataset.resolvedProjectPath).toBe("/tmp/workspace/冲突项目");

    click(container, "close-project-dialog");
    await flushEffects();

    root = getRootElement(container);
    expect(root?.dataset.createProjectOpen).toBe("false");
    expect(root?.dataset.pathConflictMessage).toBe("");
    expect(root?.dataset.resolvedProjectPath).toBe("");
    expect(root?.dataset.pathChecking).toBe("false");
  });

  it("选中文稿且 metadata 含 creationMode 时应回填模式缓存", async () => {
    mockGetContent.mockResolvedValueOnce({
      id: "content-existing",
      metadata: {
        creationMode: "framework",
      },
    });

    const { container } = renderHarness({
      selectedContentId: "content-existing",
    });
    await flushEffects(5);

    expect(mockGetContent).toHaveBeenCalledWith("content-existing");
    const root = getRootElement(container);
    const contentModes = parseRootDatasetRecord(root, "contentModes");
    expect(contentModes["content-existing"]).toBe("framework");
  });

  it("创作意图不足时创建文稿应被阻止并提示错误", async () => {
    const { container } = renderHarness({
      selectedProjectId: "project-1",
    });
    await flushEffects();

    await openContentIntentStep(container);
    click(container, "create-content");
    await flushEffects();

    const root = getRootElement(container);
    expect(root?.dataset.createContentOpen).toBe("true");
    expect(root?.dataset.createContentStep).toBe("intent");
    expect(root?.dataset.creationIntentError).toContain("创作意图至少需要 10 个字");
    expect(mockCreateContent).not.toHaveBeenCalled();
  });

  it("切换 hybrid 模式后应稳定进入意图步骤", async () => {
    const { container } = renderHarness({
      selectedProjectId: "project-1",
    });
    await flushEffects();

    click(container, "force-open-content-dialog");
    await flushEffects();
    click(container, "set-mode-hybrid");
    await flushEffects();
    click(container, "goto-intent");
    await flushEffects();

    const root = getRootElement(container);
    expect(root?.dataset.selectedCreationMode).toBe("hybrid");
    expect(root?.dataset.createContentStep).toBe("intent");
  });

  it("模式值异常时应自动回退到 guided", async () => {
    const { container } = renderHarness({
      selectedProjectId: "project-1",
    });
    await flushEffects();

    click(container, "force-open-content-dialog");
    await flushEffects();
    click(container, "set-mode-invalid");
    await flushEffects();

    const root = getRootElement(container);
    expect(root?.dataset.selectedCreationMode).toBe("guided");
  });

  it("创作意图通过后创建文稿应写入待发送提示并进入工作区", async () => {
    const loadContents = vi.fn(async () => undefined);
    const onEnterWorkspace = vi.fn();

    const { container } = renderHarness({
      selectedProjectId: "project-1",
      loadContents,
      onEnterWorkspace,
    });
    await flushEffects();

    await openContentIntentStep(container);
    click(container, "fill-intent-topic");
    await flushEffects();
    click(container, "create-content");
    await flushEffects(6);

    expect(mockCreateContent).toHaveBeenCalledTimes(1);
    expect(loadContents).toHaveBeenCalledWith("project-1");
    expect(onEnterWorkspace).toHaveBeenCalledWith("content-new", {});
    expect(mockToastSuccess).toHaveBeenCalledWith("已创建新文稿");

    const root = getRootElement(container);
    expect(root?.dataset.createContentOpen).toBe("false");
    expect(root?.dataset.createContentStep).toBe("mode");

    const pendingPrompts = parseRootDatasetRecord(root, "pendingPrompts");
    const contentModes = parseRootDatasetRecord(root, "contentModes");
    expect(Object.keys(pendingPrompts)).toContain("content-new");
    expect(contentModes["content-new"]).toBe("guided");

    click(container, "consume-prompt");
    await flushEffects();
    const rootAfterConsume = getRootElement(container);
    const pendingPromptsAfterConsume = parseRootDatasetRecord(
      rootAfterConsume,
      "pendingPrompts",
    );
    expect(pendingPromptsAfterConsume["content-new"]).toBeUndefined();
  });

  it("工作区提示词入口应先进入确认，提交确认后才创建文稿", async () => {
    const loadContents = vi.fn(async () => undefined);
    const onEnterWorkspace = vi.fn();

    const { container } = renderHarness({
      selectedProjectId: "project-1",
      selectedContentId: "content-current",
      loadContents,
      onEnterWorkspace,
    });
    await flushEffects();

    click(container, "create-from-workspace-prompt");
    await flushEffects(3);

    expect(mockCreateContent).not.toHaveBeenCalled();
    expect(onEnterWorkspace).toHaveBeenCalledWith("", { createEntryHome: true });

    let root = getRootElement(container);
    const pendingConfirmations = parseRootDatasetRecord<
      Record<
        string,
        {
          source: string;
          initialUserPrompt?: string;
          preferredContentId?: string;
        }
      >
    >(root, "pendingCreateConfirmations");
    expect(pendingConfirmations["project-1"]?.source).toBe("workspace_prompt");
    expect(pendingConfirmations["project-1"]?.initialUserPrompt).toContain("面向 CTO");
    expect(pendingConfirmations["project-1"]?.preferredContentId).toBe("content-current");

    click(container, "submit-confirm-create");
    await flushEffects(8);

    expect(mockCreateContent).toHaveBeenCalledTimes(1);
    expect(loadContents).toHaveBeenCalledWith("project-1");
    expect(onEnterWorkspace).toHaveBeenCalledWith("content-new", {});

    root = getRootElement(container);
    const pendingPrompts = parseRootDatasetRecord<Record<string, string>>(
      root,
      "pendingPrompts",
    );
    expect(pendingPrompts["content-new"]).toContain("面向 CTO");
  });

  it("确认提交被连续触发时应只创建一次文稿", async () => {
    const loadContents = vi.fn(async () => undefined);
    const onEnterWorkspace = vi.fn();
    let resolveCreateContent: ((value: { id: string }) => void) | null = null;
    mockCreateContent.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveCreateContent = resolve;
        }),
    );

    const { container } = renderHarness({
      selectedProjectId: "project-1",
      loadContents,
      onEnterWorkspace,
    });
    await flushEffects();

    click(container, "create-from-workspace-prompt");
    await flushEffects(2);

    click(container, "submit-confirm-create");
    click(container, "submit-confirm-create");
    await flushEffects(2);

    expect(mockCreateContent).toHaveBeenCalledTimes(1);
    expect(loadContents).not.toHaveBeenCalled();
    expect(onEnterWorkspace).not.toHaveBeenCalledWith("content-new", {});

    (resolveCreateContent as ((value: { id: string }) => void) | null)?.({ id: "content-new" });
    await flushEffects(6);

    expect(loadContents).toHaveBeenCalledWith("project-1");
    expect(onEnterWorkspace).toHaveBeenCalledWith("content-new", {});
  });

  it("打开项目写作在无文稿时不应自动创建，而应进入创建入口页", async () => {
    mockListContents.mockResolvedValueOnce([]);
    const onEnterWorkspace = vi.fn();
    const loadContents = vi.fn(async () => undefined);
    const onProjectCreated = vi.fn();

    const { container } = renderHarness({
      onEnterWorkspace,
      loadContents,
      onProjectCreated,
    });
    await flushEffects();

    click(container, "open-project-writing");
    await flushEffects(6);

    expect(mockCreateContent).not.toHaveBeenCalled();
    expect(onProjectCreated).toHaveBeenCalledWith("project-1");
    expect(loadContents).toHaveBeenCalledWith("project-1");
    expect(onEnterWorkspace).toHaveBeenCalledWith("", { createEntryHome: true });

    const root = getRootElement(container);
    const pendingConfirmations = parseRootDatasetRecord<
      Record<string, { source: string; initialUserPrompt?: string }>
    >(root, "pendingCreateConfirmations");
    expect(pendingConfirmations["project-1"]?.source).toBe("open_project_for_writing");
    expect(pendingConfirmations["project-1"]?.initialUserPrompt).toBe(
      "请先给我一个完整大纲",
    );

    click(container, "consume-create-confirmation");
    await flushEffects();
    const rootAfterConsume = getRootElement(container);
    const pendingAfterConsume = parseRootDatasetRecord(
      rootAfterConsume,
      "pendingCreateConfirmations",
    );
    expect(pendingAfterConsume["project-1"]).toBeUndefined();
  });

  it("打开项目写作在已有文稿时应进入最新文稿并写入待发送提示", async () => {
    mockListContents.mockResolvedValueOnce([
      {
        id: "content-old",
        title: "旧稿",
        updated_at: 1700000000000,
      },
      {
        id: "content-newest",
        title: "新稿",
        updated_at: 1700000100000,
      },
    ]);

    const onEnterWorkspace = vi.fn();
    const loadContents = vi.fn(async () => undefined);

    const { container } = renderHarness({
      onEnterWorkspace,
      loadContents,
    });
    await flushEffects();

    click(container, "open-project-writing");
    await flushEffects(6);

    expect(mockCreateContent).not.toHaveBeenCalled();
    expect(loadContents).toHaveBeenCalledWith("project-1");
    expect(onEnterWorkspace).toHaveBeenCalledWith("content-newest", {});

    const root = getRootElement(container);
    const pendingPrompts = parseRootDatasetRecord(root, "pendingPrompts");
    expect(pendingPrompts["content-newest"]).toBe("请先给我一个完整大纲");
  });
});
