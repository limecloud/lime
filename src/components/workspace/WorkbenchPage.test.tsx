import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchStore } from "@/stores/useWorkbenchStore";
import {
  IMAGE_WORKBENCH_FOCUS_EVENT,
  IMAGE_WORKBENCH_REQUEST_EVENT,
} from "@/lib/imageWorkbenchEvents";
import {
  clickButtonByText,
  clickButtonByTitle,
  clickByTestId,
  cleanupMountedRoots,
  findAsideByClassFragment,
  findButtonByText,
  findButtonByTitle,
  findInputById,
  findInputByPlaceholder,
  fillTextInput,
  flushEffects as flushAsyncEffects,
  mountHarness,
  setupReactActEnvironment,
  triggerKeyboardShortcut,
  type MountedRoot,
} from "./hooks/testUtils";
import {
  createWorkspaceContentFixture,
  createWorkspaceProjectFixture,
  DEFAULT_WORKSPACE_PAGE_PROPS,
} from "./testFixtures";

const {
  mockListProjects,
  mockListContents,
  mockGetContent,
  mockGetProject,
  mockCreateProject,
  mockCreateContent,
  mockUpdateContent,
  mockGetApiKeyProviders,
  mockGetNextApiKey,
  mockCreateVideoGenerationTask,
  mockAgentChatPage,
} = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockListContents: vi.fn(),
  mockGetContent: vi.fn(),
  mockGetProject: vi.fn(),
  mockCreateProject: vi.fn(),
  mockCreateContent: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockGetApiKeyProviders: vi.fn(),
  mockGetNextApiKey: vi.fn(),
  mockCreateVideoGenerationTask: vi.fn(),
  mockAgentChatPage: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/agent", () => ({
  AgentChatPage: (props: {
    hideTopBar?: boolean;
    hideHistoryToggle?: boolean;
    topBarChrome?: string;
    initialUserPrompt?: string;
    preferContentReviewInRightRail?: boolean;
  }) => {
    mockAgentChatPage(props);
    return (
      <div
        data-testid="agent-chat-page"
        data-hide-topbar={String(Boolean(props.hideTopBar))}
        data-hide-history-toggle={String(Boolean(props.hideHistoryToggle))}
        data-topbar-chrome={props.topBarChrome || "full"}
        data-initial-user-prompt={props.initialUserPrompt || ""}
      />
    );
  },
}));

vi.mock("@/lib/workspace/workbenchCanvas", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workspace/workbenchCanvas")>();
  return {
    ...actual,
    VideoCanvas: ({ projectId }: { projectId?: string | null }) => (
      <div data-testid="video-canvas">video:{projectId ?? "none"}</div>
    ),
    createInitialVideoState: () => ({
      type: "video",
      prompt: "",
      providerId: "",
      model: "",
      duration: 5,
      generateAudio: false,
      cameraFixed: false,
      aspectRatio: "adaptive",
      resolution: "720p",
      status: "idle",
    }),
  };
});

vi.mock("@/components/content-creator/canvas/video", () => ({
  VideoCanvas: ({ projectId }: { projectId?: string | null }) => (
    <div data-testid="video-canvas">video:{projectId ?? "none"}</div>
  ),
  createInitialVideoState: () => ({
    type: "video",
    prompt: "",
    providerId: "",
    model: "",
    duration: 5,
    generateAudio: false,
    cameraFixed: false,
    aspectRatio: "adaptive",
    resolution: "720p",
    status: "idle",
  }),
}));

vi.mock("@/features/themes/video", () => ({
  videoThemeModule: {
    theme: "video",
    capabilities: {
      workspaceKind: "video-canvas",
      showWorkspaceRightRailInWorkspace: false,
    },
    navigation: {
      defaultView: "create",
      items: [
        { key: "create", label: "创作" },
        { key: "material", label: "素材" },
        { key: "publish", label: "任务" },
        { key: "settings", label: "设置" },
      ],
    },
    primaryWorkspaceRenderer: ({
      projectId,
    }: {
      projectId?: string | null;
    }) => (
      <div data-testid="video-theme-workspace">
        <div data-testid="video-canvas">video:{projectId ?? "none"}</div>
      </div>
    ),
    workspaceRenderer: ({ projectId }: { projectId?: string | null }) => (
      <div data-testid="video-theme-workspace">
        <div data-testid="video-canvas">video:{projectId ?? "none"}</div>
      </div>
    ),
    panelRenderers: {
      material: () => <div>Material Panel</div>,
      publish: () => <div>Task Panel</div>,
      settings: () => <div>Settings Panel</div>,
    },
  },
}));

vi.mock("@/lib/api/project", () => ({
  listProjects: mockListProjects,
  listContents: mockListContents,
  getContent: mockGetContent,
  getProject: mockGetProject,
  createProject: mockCreateProject,
  createContent: mockCreateContent,
  updateContent: mockUpdateContent,
  getWorkspaceProjectsRoot: vi.fn(async () => "/tmp/workspace"),
  getProjectByRootPath: vi.fn(async () => null),
  resolveProjectRootPath: vi.fn(
    async (name: string) => `/tmp/workspace/${name}`,
  ),
  getCreateProjectErrorMessage: vi.fn((message: string) => message),
  extractErrorMessage: vi.fn(() => "mock-error"),
  formatRelativeTime: vi.fn(() => "刚刚"),
  getContentTypeLabel: vi.fn(() => "文稿"),
  getDefaultContentTypeForProject: vi.fn(() => "post"),
  getProjectTypeLabel: vi.fn((theme: string) =>
    theme === "social-media" ? "社媒内容" : theme,
  ),
}));

vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: {
    getProviders: mockGetApiKeyProviders,
    getNextApiKey: mockGetNextApiKey,
  },
}));

vi.mock("@/lib/api/videoGeneration", () => ({
  videoGenerationApi: {
    createTask: mockCreateVideoGenerationTask,
    getTask: vi.fn(),
    listTasks: vi.fn(),
    cancelTask: vi.fn(),
  },
}));

import { WorkbenchPage } from "./WorkbenchPage";

const mountedRoots: MountedRoot[] = [];

function renderPage(props: Partial<ComponentProps<typeof WorkbenchPage>> = {}) {
  return mountHarness(
    WorkbenchPage,
    { theme: "social-media", ...props },
    mountedRoots,
  );
}

function renderDefaultWorkspacePage(
  props: Partial<ComponentProps<typeof WorkbenchPage>> = {},
) {
  return renderPage({
    ...DEFAULT_WORKSPACE_PAGE_PROPS,
    ...props,
  });
}

async function flushEffects(times = 3): Promise<void> {
  await flushAsyncEffects(times);
}

async function enterDefaultWorkspace(options?: {
  expandSidebar?: boolean;
}): Promise<{ container: HTMLDivElement }> {
  const rendered = renderDefaultWorkspacePage();
  await flushEffects();

  if (options?.expandSidebar) {
    triggerKeyboardShortcut(window, "b", { ctrlKey: true });
    await flushEffects();
  }

  return { container: rendered.container };
}

async function enterProjectManagementFromWorkspace(
  container: HTMLElement,
): Promise<void> {
  const managementButton = findButtonByText(container, "项目管理");
  expect(managementButton).toBeDefined();
  clickButtonByText(container, "项目管理");
  await flushEffects();
}

function expectProjectManagementLandingVisible(container: HTMLElement): void {
  expect(container.textContent).toContain("统一创作工作区");
  expect(container.textContent).toContain("进入创作");
}

function expectElementBefore(
  scope: {
    querySelector: (selectors: string) => Element | null;
  },
  firstSelector: string,
  secondSelector: string,
): void {
  const first = scope.querySelector(firstSelector);
  const second = scope.querySelector(secondSelector);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  if (!first || !second) {
    return;
  }
  const position = first.compareDocumentPosition(second);
  expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

beforeEach(() => {
  setupReactActEnvironment();

  localStorage.clear();
  vi.clearAllMocks();
  useWorkbenchStore.getState().setLeftSidebarCollapsed(true);

  mockListProjects.mockResolvedValue([
    createWorkspaceProjectFixture({
      id: "project-1",
      name: "社媒项目A",
      workspaceType: "social-media",
      rootPath: "/tmp/workspace/project-1",
    }),
  ]);

  mockListContents.mockResolvedValue([
    createWorkspaceContentFixture({
      id: "content-1",
      project_id: "project-1",
      title: "文稿A",
    }),
  ]);

  mockGetContent.mockResolvedValue({
    id: "content-1",
    metadata: { creationMode: "guided" },
  });
  mockGetProject.mockResolvedValue(
    createWorkspaceProjectFixture({
      id: "project-1",
      name: "社媒项目A",
      workspaceType: "social-media",
      rootPath: "/tmp/workspace/project-1",
    }),
  );
  mockCreateContent.mockResolvedValue({
    id: "content-new",
    project_id: "project-1",
    title: "新文稿",
  });
  mockGetApiKeyProviders.mockResolvedValue([
    {
      id: "new-api",
      name: "New API",
      type: "new-api",
      api_host: "https://new-api.example.com",
      enabled: true,
      api_key_count: 1,
      custom_models: ["gpt-image-1"],
    },
    {
      id: "kling-video",
      name: "可灵视频",
      type: "video",
      api_host: "https://kling.example.com",
      enabled: true,
      api_key_count: 1,
      custom_models: ["kling-2.6"],
    },
    {
      id: "doubao-video",
      name: "即梦视频",
      type: "video",
      api_host: "https://doubao.example.com",
      enabled: true,
      api_key_count: 1,
      custom_models: ["seedance-1-5-pro-251215", "seedance-1-5-lite-250428"],
    },
  ]);
  mockGetNextApiKey.mockResolvedValue("test-api-key");
  mockCreateVideoGenerationTask.mockResolvedValue({
    id: "task-1",
    projectId: "project-1",
    providerId: "kling-video",
    model: "kling-2.6",
    prompt: "mock prompt",
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
});

afterEach(() => {
  cleanupMountedRoots(mountedRoots);
  localStorage.clear();
});

describe("WorkbenchPage 左侧栏模式行为", () => {
  it("项目管理模式默认展开左侧栏", async () => {
    const { container } = renderPage({ viewMode: "project-management" });
    await flushEffects();

    const leftSidebar = findAsideByClassFragment(container, "bg-muted/20");
    expect(leftSidebar).not.toBeNull();
    expect(leftSidebar?.className).toContain("w-[260px]");
    expect(container.textContent).toContain("主题项目管理");
  });

  it("项目管理模式点击新建文稿应进入页面式创作首页，而不是弹窗", async () => {
    const { container } = renderPage({ viewMode: "project-management" });
    await flushEffects();

    clickButtonByText(container, "社媒项目A");
    await flushEffects();
    clickButtonByText(container, "新建文稿");
    await flushEffects(6);

    expect(mockCreateContent).not.toHaveBeenCalled();
    expect(container.textContent).toContain("确认创作方式");
    expect(container.textContent).toContain(
      "为你准备了以下选项，补充所需信息后我们将立即开始。",
    );
    expect(
      container.querySelector(
        "[data-testid='workspace-create-confirmation-card']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workbench-right-rail-expanded']"),
    ).toBeNull();
    expect(container.textContent).not.toContain("选择创作模式");
    expect(container.textContent).not.toContain("填写创作意图");
  });

  it("项目管理模式点击项目后停留在创作首页，不自动打开文稿", async () => {
    const { container } = renderPage({ viewMode: "project-management" });
    await flushEffects();

    const projectButton = findButtonByText(container, "社媒项目A");
    expect(projectButton).toBeDefined();
    clickButtonByText(container, "社媒项目A");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='agent-chat-page']"),
    ).toBeNull();
    expectProjectManagementLandingVisible(container);
    expect(container.textContent).toContain("社媒项目A");
    expect(container.textContent).toContain("社媒内容项目已就绪");
  });

  it("作业模式存在文稿时应优先打开已有内容，而不是停留在新建首页", async () => {
    const { container } = await enterDefaultWorkspace();

    expect(
      container.querySelector("[data-testid='agent-chat-page']"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workspace-create-confirmation-card']",
      ),
    ).toBeNull();
  });

  it("作业模式默认收起左侧栏", async () => {
    const { container } = await enterDefaultWorkspace();

    expect(findAsideByClassFragment(container, "bg-muted/20")).toBeNull();
    expect(container.textContent).not.toContain("主题项目管理");
  });

  it("作业模式展开侧栏后切换项目时应优先打开已有文稿", async () => {
    const { container } = await enterDefaultWorkspace({ expandSidebar: true });

    const projectButton = findButtonByText(container, "社媒项目A");
    expect(projectButton).toBeDefined();
    clickButtonByText(container, "社媒项目A");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='agent-chat-page']"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workspace-create-confirmation-card']",
      ),
    ).toBeNull();
  });

  it("点击创作首页应优先显示创建确认入口，避免中间闪现对话内容", async () => {
    const { container } = await enterDefaultWorkspace();

    expect(
      container.querySelector("[data-testid='agent-chat-page']"),
    ).not.toBeNull();

    clickButtonByText(container, "创作首页", { exact: true });
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workspace-create-entry-home']"),
    ).not.toBeNull();
    expect(container.textContent).toContain("当前没有待处理任务");
    expect(
      container.querySelector(
        "[data-testid='workspace-create-confirmation-card']",
      ),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='agent-chat-page']"),
    ).toBeNull();
  });

  it("工作区点击项目管理后回到项目管理态", async () => {
    const { container } = await enterDefaultWorkspace();

    await enterProjectManagementFromWorkspace(container);
    expectProjectManagementLandingVisible(container);
  });

  it("工作区点击项目管理后自动展开左侧栏", async () => {
    const { container } = await enterDefaultWorkspace();

    await enterProjectManagementFromWorkspace(container);

    const leftSidebar = findAsideByClassFragment(container, "bg-muted/20");
    expect(leftSidebar).not.toBeNull();
    expect(leftSidebar?.className).toContain("w-[260px]");
    expectProjectManagementLandingVisible(container);
    expect(container.textContent).toContain("主题项目管理");
  });

  it("创作首页右侧栏应默认展开，并可切换后操作文字/视觉/音频区关键表单", async () => {
    const { container } = await enterDefaultWorkspace();

    expect(
      container.querySelector("[data-testid='workbench-right-rail-expanded']"),
    ).not.toBeNull();
    expect(findButtonByTitle(container, "折叠能力面板")).toBeDefined();

    clickButtonByTitle(container, "折叠能力面板");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-right-rail-collapsed']"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workbench-right-rail-collapsed-expand']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelectorAll(
        "[data-testid^='workbench-right-rail-collapsed-action-']",
      ).length,
    ).toBeGreaterThan(0);

    clickByTestId(
      container,
      "workbench-right-rail-collapsed-action-search-material",
    );
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-right-rail-expanded']"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workbench-search-material-panel']",
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("文字多搜索");
    expect(container.textContent).not.toContain("Aibo");
    expect(container.textContent).toContain("资源类型");
    expect(container.textContent).toContain("搜索词");
    expect(container.textContent).toContain("提交");
    expect(container.textContent).toContain("取消");
    expectElementBefore(
      container,
      "[data-testid='workbench-search-material-panel']",
      "button[data-testid='workbench-right-rail-action-generate-title']",
    );

    clickButtonByText(container, "取消");
    await flushEffects();

    expect(
      container.querySelector(
        "[data-testid='workbench-search-material-panel']",
      ),
    ).toBeNull();

    clickByTestId(container, "workbench-right-rail-action-generate-title");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-generate-title-panel']"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workbench-search-material-panel']",
      ),
    ).toBeNull();
    expect(container.textContent).toContain("要求");
    expect(container.textContent).toContain("一键生成");
    expect(container.textContent).toContain("取消");
    expectElementBefore(
      container,
      "button[data-testid='workbench-right-rail-action-search-material']",
      "[data-testid='workbench-generate-title-panel']",
    );

    clickButtonByText(container, "取消");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-generate-title-panel']"),
    ).toBeNull();

    clickByTestId(container, "workbench-right-rail-action-generate-image");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-generate-image-panel']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workbench-generate-title-panel']"),
    ).toBeNull();
    expect(container.textContent).toContain("模型");
    expect(container.textContent).toContain("尺寸");
    expect(container.textContent).toContain("提示词");
    expectElementBefore(
      container,
      "[data-testid='workbench-generate-image-panel']",
      "button[data-testid='workbench-right-rail-action-generate-cover']",
    );

    clickByTestId(container, "workbench-right-rail-action-generate-cover");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-generate-cover-panel']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workbench-generate-image-panel']"),
    ).toBeNull();
    expect(container.textContent).toContain("投放平台");
    expect(container.textContent).toContain("生成数量");
    expect(container.textContent).toContain("封面描述");
    expectElementBefore(
      container,
      "button[data-testid='workbench-right-rail-action-generate-image']",
      "[data-testid='workbench-generate-cover-panel']",
    );
    expectElementBefore(
      container,
      "[data-testid='workbench-generate-cover-panel']",
      "button[data-testid='workbench-right-rail-action-generate-storyboard']",
    );

    clickByTestId(container, "workbench-right-rail-action-generate-storyboard");
    await flushEffects();

    expect(
      container.querySelector(
        "[data-testid='workbench-generate-storyboard-panel']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workbench-generate-cover-panel']"),
    ).toBeNull();
    expect(container.textContent).toContain("生成分镜");
    expect(container.textContent).toContain("一键生成");
    expectElementBefore(
      container,
      "button[data-testid='workbench-right-rail-action-generate-cover']",
      "[data-testid='workbench-generate-storyboard-panel']",
    );
    expectElementBefore(
      container,
      "[data-testid='workbench-generate-storyboard-panel']",
      "button[data-testid='workbench-right-rail-action-generate-video-assets']",
    );

    clickByTestId(
      container,
      "workbench-right-rail-action-generate-video-assets",
    );
    await flushEffects();

    expect(
      container.querySelector(
        "[data-testid='workbench-generate-video-assets-panel']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workbench-generate-storyboard-panel']",
      ),
    ).toBeNull();
    expect(container.textContent).toContain("模型");
    expect(container.textContent).toContain("版本");
    expect(container.textContent).toContain("比例");
    expect(container.textContent).toContain("时长");
    expect(container.textContent).toContain("提示词");
    expectElementBefore(
      container,
      "button[data-testid='workbench-right-rail-action-generate-storyboard']",
      "[data-testid='workbench-generate-video-assets-panel']",
    );
    expectElementBefore(
      container,
      "[data-testid='workbench-generate-video-assets-panel']",
      "button[data-testid='workbench-right-rail-action-generate-ai-video']",
    );

    clickByTestId(container, "workbench-right-rail-action-generate-ai-video");
    await flushEffects();

    expect(
      container.querySelector(
        "[data-testid='workbench-generate-ai-video-panel']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workbench-generate-video-assets-panel']",
      ),
    ).toBeNull();
    expect(container.textContent).toContain("脚本内容");
    expectElementBefore(
      container,
      "button[data-testid='workbench-right-rail-action-generate-video-assets']",
      "[data-testid='workbench-generate-ai-video-panel']",
    );

    clickByTestId(container, "workbench-right-rail-action-generate-voiceover");
    await flushEffects();

    expect(
      container.querySelector(
        "[data-testid='workbench-generate-voiceover-panel']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workbench-generate-ai-video-panel']",
      ),
    ).toBeNull();
    expect(container.textContent).toContain("语速");
    expect(container.textContent).toContain("选择音色");
    expectElementBefore(
      container,
      "[data-testid='workbench-generate-voiceover-panel']",
      "button[data-testid='workbench-right-rail-action-generate-bgm']",
    );

    clickByTestId(container, "workbench-voice-tone-trigger");
    await flushEffects();

    expect(
      document.body.querySelector(
        "[data-testid='workbench-voice-tone-dialog']",
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector("input[placeholder='搜索音色']"),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("素材库");
    expect(document.body.textContent).toContain("高冷御姐");

    clickByTestId(container, "workbench-right-rail-action-generate-bgm");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-generate-bgm-panel']"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workbench-generate-voiceover-panel']",
      ),
    ).toBeNull();
    expect(container.textContent).toContain("时长");
    expect(container.textContent).toContain("提示词");
    expectElementBefore(
      container,
      "button[data-testid='workbench-right-rail-action-generate-voiceover']",
      "[data-testid='workbench-generate-bgm-panel']",
    );
    expectElementBefore(
      container,
      "[data-testid='workbench-generate-bgm-panel']",
      "button[data-testid='workbench-right-rail-action-generate-sfx']",
    );

    clickByTestId(container, "workbench-right-rail-action-generate-sfx");
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-generate-sfx-panel']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workbench-generate-bgm-panel']"),
    ).toBeNull();
    expect(container.textContent).toContain("时长");
    expect(container.textContent).toContain("提示词");
    expect(container.textContent).toContain("10s");
    expectElementBefore(
      container,
      "button[data-testid='workbench-right-rail-action-generate-bgm']",
      "[data-testid='workbench-generate-sfx-panel']",
    );
    expectElementBefore(
      container,
      "[data-testid='workbench-generate-sfx-panel']",
      "button[data-testid='workbench-right-rail-action-generate-podcast']",
    );

    clickByTestId(container, "workbench-right-rail-action-generate-podcast");
    await flushEffects();

    expect(
      container.querySelector(
        "[data-testid='workbench-generate-podcast-panel']",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workbench-generate-sfx-panel']"),
    ).toBeNull();
    expect(container.textContent).toContain("播音音色");
    expect(container.textContent).toContain("模式");
    expect(container.textContent).toContain("深度模式");
    expect(container.textContent).toContain("补充提示词");
    expect(container.textContent).toContain("一键导入");
    expectElementBefore(
      container,
      "button[data-testid='workbench-right-rail-action-generate-sfx']",
      "[data-testid='workbench-generate-podcast-panel']",
    );

    clickButtonByText(container, "一键导入");
    await flushEffects();

    const podcastPromptInput = container.querySelector(
      "[data-testid='workbench-generate-podcast-panel'] textarea",
    ) as HTMLTextAreaElement | null;
    expect(podcastPromptInput?.value).toContain("Agent 炒作何时停？2026 年");

    clickByTestId(container, "workbench-podcast-voice-trigger");
    await flushEffects();

    expect(
      document.body.querySelector(
        "[data-testid='workbench-podcast-voice-dialog']",
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector("input[placeholder='搜索音色']"),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("选择模式");
    expect(document.body.textContent).toContain("双人");
    expect(document.body.textContent).toContain("单人");
    expect(document.body.textContent).toContain("选择 2 种音色");
  });

  it("右侧栏生成标题提交应先进入确认，确认后再创建文稿", async () => {
    const { container } = await enterDefaultWorkspace();

    expect(
      container.querySelector("[data-testid='workbench-right-rail-expanded']"),
    ).not.toBeNull();

    clickByTestId(container, "workbench-right-rail-action-generate-title");
    await flushEffects();

    const requirementField = findInputByPlaceholder(container, "请输入要求");
    fillTextInput(requirementField, "请输出面向企业 CTO 的 Agent 趋势标题");

    clickButtonByText(container, "一键生成");
    await flushEffects(6);

    expect(mockCreateContent).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        "[data-testid='workspace-create-confirmation-card']",
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain(
      "请输出面向企业 CTO 的 Agent 趋势标题",
    );

    clickButtonByText(container, "新写一篇内容");
    await flushEffects();
    clickButtonByText(container, "开始处理");
    clickButtonByText(container, "开始处理");
    await flushEffects(8);

    expect(mockCreateContent).toHaveBeenCalledTimes(1);
    const requestPayload = mockCreateContent.mock.calls[0]?.[0];
    expect(requestPayload?.project_id).toBe("project-1");
    expect(requestPayload?.metadata?.createConfirmation?.source).toBe(
      "workspace_prompt",
    );

    const latestAgentChatProps = mockAgentChatPage.mock.calls.at(-1)?.[0] as
      | {
          initialUserPrompt?: string;
          preferContentReviewInRightRail?: boolean;
        }
      | undefined;
    expect(latestAgentChatProps?.initialUserPrompt).toContain(
      "请输出面向企业 CTO 的 Agent 趋势标题",
    );
    expect(latestAgentChatProps?.preferContentReviewInRightRail).toBe(true);
  });

  it("右侧栏生成图片提交应派发图片工作台事件", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    try {
      const { container } = await enterDefaultWorkspace();

      expect(
        container.querySelector(
          "[data-testid='workbench-right-rail-expanded']",
        ),
      ).not.toBeNull();

      clickByTestId(container, "workbench-right-rail-action-generate-image");
      await flushEffects();

      const promptField = findInputByPlaceholder(container, "请输入提示词");
      fillTextInput(promptField, "赛博城市夜景，蓝紫色霓虹，电影感");

      clickButtonByText(container, "一键生成");
      await flushEffects(8);

      expect(mockGetNextApiKey).not.toHaveBeenCalled();
      const requestEvent = dispatchSpy.mock.calls
        .map(([event]) => event)
        .find(
          (event): event is CustomEvent<Record<string, unknown>> =>
            event instanceof CustomEvent &&
            event.type === IMAGE_WORKBENCH_REQUEST_EVENT,
        );

      expect(requestEvent).toBeDefined();
      expect(requestEvent?.detail).toMatchObject({
        projectId: "project-1",
        contentId: "content-1",
        target: "generate",
        aspectRatio: "16:9",
        modelPreset: "basic",
      });
      expect(String(requestEvent?.detail?.prompt || "")).toContain("赛博城市夜景");
      expect(container.textContent).toContain("图片任务已提交");
      clickButtonByText(container, "查看画布");
      await flushEffects();
      const focusEvent = dispatchSpy.mock.calls
        .map(([event]) => event)
        .find(
          (event): event is CustomEvent<Record<string, unknown>> =>
            event instanceof CustomEvent &&
            event.type === IMAGE_WORKBENCH_FOCUS_EVENT,
        );
      expect(focusEvent?.detail).toMatchObject({
        projectId: "project-1",
        contentId: "content-1",
      });
      expect(
        container.querySelector(
          "[data-testid='workbench-generated-output-image']",
        ),
      ).toBeNull();
    } finally {
      dispatchSpy.mockRestore();
    }
  });

  it("右侧栏生成封面提交应派发封面工作台事件并带平台信息", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    try {
      const { container } = await enterDefaultWorkspace();

      expect(
        container.querySelector(
          "[data-testid='workbench-right-rail-expanded']",
        ),
      ).not.toBeNull();

      clickByTestId(container, "workbench-right-rail-action-generate-cover");
      await flushEffects();

      const coverField = findInputByPlaceholder(container, "请输入封面描述");
      fillTextInput(coverField, "科技发布会主视觉，人物特写，冷暖对比");

      clickButtonByText(container, "一键生成");
      await flushEffects(8);

      expect(mockGetNextApiKey).not.toHaveBeenCalled();
      const requestEvent = dispatchSpy.mock.calls
        .map(([event]) => event)
        .find(
          (event): event is CustomEvent<Record<string, unknown>> =>
            event instanceof CustomEvent &&
            event.type === IMAGE_WORKBENCH_REQUEST_EVENT,
        );

      expect(requestEvent).toBeDefined();
      expect(requestEvent?.detail).toMatchObject({
        projectId: "project-1",
        contentId: "content-1",
        target: "cover",
        aspectRatio: "16:9",
        count: 1,
        modelPreset: "basic",
      });
      expect(String(requestEvent?.detail?.prompt || "")).toContain("B站平台封面图");
      expect(String(requestEvent?.detail?.prompt || "")).toContain(
        "科技发布会主视觉",
      );
      expect(container.textContent).toContain("封面任务已提交");
      clickButtonByText(container, "查看画布");
      await flushEffects();
      const focusEvent = dispatchSpy.mock.calls
        .map(([event]) => event)
        .find(
          (event): event is CustomEvent<Record<string, unknown>> =>
            event instanceof CustomEvent &&
            event.type === IMAGE_WORKBENCH_FOCUS_EVENT,
        );
      expect(focusEvent?.detail).toMatchObject({
        projectId: "project-1",
        contentId: "content-1",
      });
    } finally {
      dispatchSpy.mockRestore();
    }
  });

  it("右侧栏生成配音提交应调用 TTS 接口并带语速音色参数", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["mock-audio"], { type: "audio/mpeg" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { container } = await enterDefaultWorkspace();

      expect(
        container.querySelector(
          "[data-testid='workbench-right-rail-expanded']",
        ),
      ).not.toBeNull();

      clickByTestId(
        container,
        "workbench-right-rail-action-generate-voiceover",
      );
      await flushEffects();

      const promptField = findInputByPlaceholder(container, "请输入提示词");
      fillTextInput(promptField, "请用沉稳语气播报今天的行业快讯");

      clickButtonByText(container, "一键生成");
      await flushEffects(8);

      expect(mockGetNextApiKey).toHaveBeenCalledWith("new-api");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [endpoint, requestInit] = fetchMock.mock.calls[0] as [
        string,
        { body?: unknown },
      ];
      expect(endpoint).toBe("https://new-api.example.com/v1/audio/speech");
      const body = JSON.parse(String(requestInit.body));
      expect(body.model).toBe("gpt-4o-mini-tts");
      expect(body.voice).toBe("alloy");
      expect(body.input).toContain("今天的行业快讯");
      expect(body.speed).toBe(1);
      expect(container.textContent).toContain("配音生成成功");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("右侧栏生成BGM提交应调用音频接口并写入输出区", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => "audio/mpeg",
      },
      blob: async () => new Blob(["mock-bgm"], { type: "audio/mpeg" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { container } = await enterDefaultWorkspace();

      expect(
        container.querySelector(
          "[data-testid='workbench-right-rail-expanded']",
        ),
      ).not.toBeNull();

      clickByTestId(container, "workbench-right-rail-action-generate-bgm");
      await flushEffects();

      const promptField = findInputByPlaceholder(container, "请输入提示词");
      fillTextInput(promptField, "电子氛围，科技感，节奏偏快");

      clickButtonByText(container, "一键生成");
      await flushEffects(8);

      expect(mockCreateContent).not.toHaveBeenCalled();
      expect(mockGetNextApiKey).toHaveBeenCalledWith("new-api");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [endpoint, requestInit] = fetchMock.mock.calls[0] as [
        string,
        { body?: unknown },
      ];
      expect(endpoint).toBe("https://new-api.example.com/v1/audio/generations");
      const body = JSON.parse(String(requestInit.body));
      expect(body.model).toBe("gpt-4o-mini-tts");
      expect(body.prompt).toContain("纯背景音乐");
      expect(body.duration).toBe(30);
      expect(container.textContent).toContain("BGM 生成成功");
      expect(
        container.querySelector(
          "[data-testid='workbench-generated-output-audio']",
        ),
      ).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("右侧栏生成音效提交应调用音频接口并写入输出区", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => "audio/mpeg",
      },
      blob: async () => new Blob(["mock-sfx"], { type: "audio/mpeg" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { container } = await enterDefaultWorkspace();

      expect(
        container.querySelector(
          "[data-testid='workbench-right-rail-expanded']",
        ),
      ).not.toBeNull();

      clickByTestId(container, "workbench-right-rail-action-generate-sfx");
      await flushEffects();

      const promptField = findInputByPlaceholder(container, "请输入提示词");
      fillTextInput(promptField, "转场 whoosh，科技感，干净利落");

      clickButtonByText(container, "一键生成");
      await flushEffects(8);

      expect(mockCreateContent).not.toHaveBeenCalled();
      expect(mockGetNextApiKey).toHaveBeenCalledWith("new-api");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [endpoint, requestInit] = fetchMock.mock.calls[0] as [
        string,
        { body?: unknown },
      ];
      expect(endpoint).toBe("https://new-api.example.com/v1/audio/generations");
      const body = JSON.parse(String(requestInit.body));
      expect(body.model).toBe("gpt-4o-mini-tts");
      expect(body.prompt).toContain("短音效");
      expect(body.duration).toBe(10);
      expect(container.textContent).toContain("音效生成成功");
      expect(
        container.querySelector(
          "[data-testid='workbench-generated-output-audio']",
        ),
      ).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("右侧栏生成视频素材提交应按所选模型创建视频任务", async () => {
    const { container } = await enterDefaultWorkspace();

    expect(
      container.querySelector("[data-testid='workbench-right-rail-expanded']"),
    ).not.toBeNull();

    clickByTestId(
      container,
      "workbench-right-rail-action-generate-video-assets",
    );
    await flushEffects();

    const promptField = findInputByPlaceholder(container, "请输入提示词");
    fillTextInput(promptField, "夜景城市航拍，镜头缓慢推进");

    clickButtonByText(container, "一键生成");
    await flushEffects(8);

    expect(mockCreateVideoGenerationTask).toHaveBeenCalledTimes(1);
    const requestPayload = mockCreateVideoGenerationTask.mock.calls[0]?.[0];
    expect(requestPayload?.projectId).toBe("project-1");
    expect(requestPayload?.providerId).toBe("kling-video");
    expect(requestPayload?.model).toBe("kling-2.6");
    expect(requestPayload?.prompt).toContain("夜景城市航拍");
    expect(requestPayload?.aspectRatio).toBe("16:9");
    expect(requestPayload?.duration).toBe(5);
  });

  it("右侧栏生成视频(非AI画面)提交应按所选模型创建视频任务", async () => {
    const { container } = await enterDefaultWorkspace();

    expect(
      container.querySelector("[data-testid='workbench-right-rail-expanded']"),
    ).not.toBeNull();

    clickByTestId(container, "workbench-right-rail-action-generate-ai-video");
    await flushEffects();

    const scriptField = findInputByPlaceholder(container, "请输入脚本内容");
    fillTextInput(scriptField, "主持人开场，切入2026年智能体行业讨论");

    clickButtonByText(container, "一键生成");
    await flushEffects(8);

    expect(mockCreateVideoGenerationTask).toHaveBeenCalledTimes(1);
    const requestPayload = mockCreateVideoGenerationTask.mock.calls[0]?.[0];
    expect(requestPayload?.projectId).toBe("project-1");
    expect(requestPayload?.providerId).toBe("kling-video");
    expect(requestPayload?.model).toBe("kling-2.6");
    expect(requestPayload?.prompt).toContain("主持人开场");
    expect(requestPayload?.aspectRatio).toBe("16:9");
    expect(requestPayload?.duration).toBe(5);
  });

  it("统一工作区中的聊天页应启用 compact 顶栏，保留执行入口", async () => {
    const { container } = await enterDefaultWorkspace();

    const chat = container.querySelector("[data-testid='agent-chat-page']");
    expect(chat).not.toBeNull();
    expect(chat?.getAttribute("data-hide-topbar")).toBe("false");
    expect(chat?.getAttribute("data-hide-history-toggle")).toBe("false");
    expect(chat?.getAttribute("data-topbar-chrome")).toBe(
      "workspace-compact",
    );
  });

  it("视频主题在作业模式渲染视频工作区，而非通用对话创作页", async () => {
    mockListProjects.mockResolvedValueOnce([
      createWorkspaceProjectFixture({
        id: "video-project-1",
        name: "视频项目A",
        workspaceType: "video",
        rootPath: "/tmp/workspace/video-project-1",
      }),
    ]);

    const { container } = renderPage({
      theme: "video",
      viewMode: "workspace",
      projectId: "video-project-1",
    });
    await flushEffects();

    expect(
      container.querySelector("[data-testid='video-theme-workspace']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='video-canvas']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='agent-chat-page']"),
    ).toBeNull();
    expect(findInputByPlaceholder(container, "搜索文稿...")).toBeNull();
  });

  it("视频主题点击创作首页时应继续停留在视频工作区", async () => {
    mockListProjects.mockResolvedValueOnce([
      createWorkspaceProjectFixture({
        id: "video-project-3",
        name: "视频项目C",
        workspaceType: "video",
        rootPath: "/tmp/workspace/video-project-3",
      }),
    ]);

    const { container } = renderPage({
      theme: "video",
      viewMode: "workspace",
      projectId: "video-project-3",
    });
    await flushEffects();

    clickButtonByText(container, "创作首页", { exact: true });
    await flushEffects();

    expect(
      container.querySelector("[data-testid='video-theme-workspace']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workspace-create-entry-home']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='agent-chat-page']"),
    ).toBeNull();
  });

  it("视频主题从项目管理发起新建时应进入视频工作区，而非页面式创作首页", async () => {
    mockListProjects.mockResolvedValueOnce([
      createWorkspaceProjectFixture({
        id: "video-project-4",
        name: "视频项目D",
        workspaceType: "video",
        rootPath: "/tmp/workspace/video-project-4",
      }),
    ]);

    const { container } = renderPage({
      theme: "video",
      viewMode: "project-management",
    });
    await flushEffects();

    clickButtonByText(container, "视频项目D");
    await flushEffects();
    clickButtonByText(container, "新建文稿");
    await flushEffects(6);

    expect(
      container.querySelector("[data-testid='video-theme-workspace']"),
    ).not.toBeNull();
    expect(
      container.querySelector("[data-testid='workspace-create-entry-home']"),
    ).toBeNull();
    expect(
      container.querySelector(
        "[data-testid='workspace-create-confirmation-card']",
      ),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='agent-chat-page']"),
    ).toBeNull();
  });

  it("视频主题在作业模式不应渲染右侧视频助手栏", async () => {
    mockListProjects.mockResolvedValueOnce([
      createWorkspaceProjectFixture({
        id: "video-project-2",
        name: "视频项目B",
        workspaceType: "video",
        rootPath: "/tmp/workspace/video-project-2",
      }),
    ]);

    const { container } = renderPage({
      theme: "video",
      viewMode: "workspace",
      projectId: "video-project-2",
    });
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-right-rail-expanded']"),
    ).toBeNull();
  });

  it("海报主题在作业模式不应渲染工作台右侧能力栏", async () => {
    mockListProjects.mockResolvedValueOnce([
      createWorkspaceProjectFixture({
        id: "poster-project-1",
        name: "海报项目A",
        workspaceType: "poster",
        rootPath: "/tmp/workspace/poster-project-1",
      }),
    ]);

    const { container } = renderPage({
      theme: "poster",
      viewMode: "workspace",
      projectId: "poster-project-1",
    });
    await flushEffects();

    expect(
      container.querySelector("[data-testid='workbench-right-rail-expanded']"),
    ).toBeNull();
  });

  it("切换到非创作视图时左侧显示紧凑提示并可返回创作视图", async () => {
    const { container } = await enterDefaultWorkspace({ expandSidebar: true });

    const publishButton = findButtonByText(container, "发布", { exact: true });
    expect(publishButton).toBeDefined();
    clickButtonByText(container, "发布", { exact: true });
    await flushEffects();

    expect(container.textContent).toContain("当前处于「发布」视图");
    expect(container.textContent).toContain("当前文稿：文稿A");
    expect(container.textContent).toContain("返回创作视图");
    expect(findInputByPlaceholder(container, "搜索文稿...")).toBeNull();

    const backToCreateButton = findButtonByText(container, "返回创作视图", {
      exact: true,
    });
    expect(backToCreateButton).toBeDefined();
    clickButtonByText(container, "返回创作视图", { exact: true });
    await flushEffects();

    expect(findInputByPlaceholder(container, "搜索文稿...")).not.toBeNull();
  });

  it("创建项目后保持选中新项目且重置项目搜索", async () => {
    const baseProject = createWorkspaceProjectFixture({
      id: "project-1",
      name: "社媒项目A",
      workspaceType: "social-media",
      rootPath: "/tmp/workspace/project-1",
    });
    const createdProject = createWorkspaceProjectFixture({
      id: "project-2",
      name: "新项目B",
      workspaceType: "social-media",
      rootPath: "/tmp/workspace/新项目B",
    });

    mockListProjects
      .mockResolvedValueOnce([baseProject])
      .mockResolvedValueOnce([baseProject, createdProject]);
    mockCreateProject.mockResolvedValue(createdProject);

    const { container } = await enterDefaultWorkspace({ expandSidebar: true });

    const projectSearchInput = findInputByPlaceholder(
      container,
      "搜索项目...",
    ) as HTMLInputElement | null;
    expect(projectSearchInput).not.toBeNull();
    fillTextInput(projectSearchInput, "关键字");
    await flushEffects();
    expect(projectSearchInput?.value).toBe("关键字");

    const createProjectButton = findButtonByTitle(container, "新建项目");
    expect(createProjectButton).not.toBeNull();
    clickButtonByTitle(container, "新建项目");
    await flushEffects();

    const projectNameInput = findInputById(
      document,
      "workspace-project-name",
    ) as HTMLInputElement | null;
    expect(projectNameInput).not.toBeNull();
    fillTextInput(projectNameInput, "新项目B");
    await flushEffects();

    const createButton = findButtonByText(document, "创建项目", {
      exact: true,
    });
    expect(createButton).toBeDefined();
    clickButtonByText(document, "创建项目", { exact: true });
    await flushEffects(5);

    expect(mockCreateProject).toHaveBeenCalled();
    expect(mockListContents).toHaveBeenCalledWith("project-2");
    expect(projectSearchInput?.value).toBe("");

    expect(container.textContent).toContain("新项目B");
    expect(
      container.querySelector(
        "[data-testid='workspace-create-confirmation-card']",
      ),
    ).not.toBeNull();
  });
});
