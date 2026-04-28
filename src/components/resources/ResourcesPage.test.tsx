import { act, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  type MountedRoot,
} from "@/components/image-gen/test-utils";
import type { ResourceItem } from "./services/types";
import { ResourcesPage } from "./ResourcesPage";

function createResourceItem(index: number) {
  return {
    id: `doc-${index}`,
    projectId: "project-1",
    kind: "document" as const,
    sourceType: "content" as const,
    name: `项目文档 ${index}`,
    description: `说明文档 ${index}`,
    tags: [`标签${index}`],
    parentId: null,
    createdAt: index,
    updatedAt: index,
    filePath: "",
    fileType: "document",
    mimeType: "text/markdown",
  };
}

const {
  mockLoadResources,
  mockSetProjectId,
  resourcesProjectsState,
  resourcesState,
  mockListMaterials,
  mockOpenResourceManager,
  mockFetchDocumentDetail,
  mockSetCurrentFolderId,
  mockSetSearchQuery,
} = vi.hoisted(() => {
  const nextState = {
    projectId: "project-1",
    items: [createResourceItem(1)] as ResourceItem[],
    loading: false,
    saving: false,
    error: null,
    currentFolderId: null,
    searchQuery: "",
    sortField: "updatedAt",
    sortDirection: "desc",
    setProjectId: vi.fn(),
    loadResources: vi.fn(),
    refresh: vi.fn(),
    setCurrentFolderId: vi.fn(),
    setSearchQuery: vi.fn(),
    setSortField: vi.fn(),
    setSortDirection: vi.fn(),
    uploadFile: vi.fn(),
    renameById: vi.fn(),
    deleteById: vi.fn(),
    moveToRoot: vi.fn(),
  };

  const projectsState = {
    projects: [
      {
        id: "project-1",
        name: "默认项目",
        isArchived: false,
      },
    ],
    defaultProject: {
      id: "project-1",
      name: "默认项目",
      isArchived: false,
    },
  };

  const listMaterials = vi.fn();

  return {
    mockSetProjectId: nextState.setProjectId,
    mockLoadResources: nextState.loadResources,
    mockRefresh: nextState.refresh,
    mockSetCurrentFolderId: nextState.setCurrentFolderId,
    mockSetSearchQuery: nextState.setSearchQuery,
    mockSetSortField: nextState.setSortField,
    mockSetSortDirection: nextState.setSortDirection,
    mockUploadFile: nextState.uploadFile,
    mockRenameById: nextState.renameById,
    mockDeleteById: nextState.deleteById,
    mockMoveToRoot: nextState.moveToRoot,
    mockListMaterials: listMaterials,
    mockOpenResourceManager: vi.fn(),
    mockFetchDocumentDetail: vi.fn(),
    resourcesProjectsState: projectsState,
    resourcesState: nextState,
  };
});

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
    projects: resourcesProjectsState.projects,
    defaultProject: resourcesProjectsState.defaultProject,
    loading: false,
    error: null,
  }),
}));

vi.mock("@/lib/resourceProjectSelection", () => ({
  getStoredResourceProjectId: vi.fn(() => "project-1"),
  onResourceProjectChange: vi.fn(() => () => {}),
  setStoredResourceProjectId: vi.fn(),
}));

vi.mock("@/lib/workspace/workbenchUi", () => ({
  CanvasBreadcrumbHeader: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock("@/lib/api/fileSystem", () => ({
  openPathWithDefaultApp: vi.fn(),
  convertLocalFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@/features/resource-manager/openResourceManager", () => ({
  openResourceManager: mockOpenResourceManager,
}));

vi.mock("@/lib/api/materials", () => ({
  listMaterials: mockListMaterials,
}));

vi.mock("./services/resourceAdapter", () => ({
  fetchDocumentDetail: mockFetchDocumentDetail,
}));

vi.mock("./ResourcesImageWorkbench", () => ({
  ResourcesImageWorkbench: () => (
    <div data-testid="resources-image-workbench">图片工作台已挂载</div>
  ),
}));

vi.mock("./store", () => ({
  useResourcesStore: (selector: (state: typeof resourcesState) => unknown) =>
    selector(resourcesState),
}));

const mountedRoots: MountedRoot[] = [];

function renderPage(props?: Partial<ComponentProps<typeof ResourcesPage>>) {
  return renderIntoDom(<ResourcesPage {...props} />, mountedRoots).container;
}

function getBodyText() {
  return document.body.textContent ?? "";
}

function countTextOccurrences(text: string) {
  return getBodyText().split(text).length - 1;
}

async function hoverTip(ariaLabel: string) {
  const trigger = document.body.querySelector(
    `button[aria-label='${ariaLabel}']`,
  );
  expect(trigger).toBeInstanceOf(HTMLButtonElement);

  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
  });

  return trigger as HTMLButtonElement;
}

async function leaveTip(trigger: HTMLButtonElement | null) {
  await act(async () => {
    trigger?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("ResourcesPage", () => {
  beforeEach(() => {
    setReactActEnvironment();
    vi.clearAllMocks();
    mockLoadResources.mockResolvedValue(undefined);
    mockListMaterials.mockResolvedValue([]);
    mockOpenResourceManager.mockResolvedValue("resource-session");
    mockFetchDocumentDetail.mockResolvedValue({
      id: "doc-1",
      title: "项目文档 1",
      body: "# 项目文档 1",
    });
    resourcesProjectsState.projects = [
      {
        id: "project-1",
        name: "默认项目",
        isArchived: false,
      },
    ];
    resourcesProjectsState.defaultProject = {
      id: "project-1",
      name: "默认项目",
      isArchived: false,
    };
    resourcesState.projectId = "project-1";
    resourcesState.items = [createResourceItem(1)];
    resourcesState.loading = false;
    resourcesState.saving = false;
    resourcesState.error = null;
    resourcesState.currentFolderId = null;
    resourcesState.searchQuery = "";
    resourcesState.sortField = "updatedAt";
    resourcesState.sortDirection = "desc";
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("应把项目资料页说明收进 tips", async () => {
    renderPage();
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "集中查看当前项目里的文档、图片和导入内容；继续开工时回生成，需要沉淀线索时去灵感库。",
    );
    expect(getBodyText()).not.toContain(
      "在目录浏览和跨目录分类视图之间切换，快速定位不同类型内容。",
    );

    const heroTip = await hoverTip("项目资料页说明");
    expect(getBodyText()).toContain(
      "集中查看当前项目里的文档、图片和导入内容；继续开工时回生成，需要沉淀线索时去灵感库。",
    );
    await leaveTip(heroTip);

    const categoryTip = await hoverTip("内容分类说明");
    expect(getBodyText()).toContain(
      "在目录浏览和跨目录分类视图之间切换，快速定位不同类型内容。",
    );
    await leaveTip(categoryTip);
  });

  it("应显式提供回生成和灵感库的迁移按钮", async () => {
    const onNavigate = vi.fn();
    const container = renderPage({ onNavigate });
    await flushEffects();

    const callout = container.querySelector(
      '[data-testid="resources-migration-callout"]',
    ) as HTMLDivElement | null;
    expect(callout).toBeTruthy();
    expect(callout?.textContent).toContain("项目资料只负责浏览、补图和整理");

    const backToAgentButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("回生成"));
    const backToMemoryButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("去灵感库"));

    expect(backToAgentButton).toBeTruthy();
    expect(backToMemoryButton).toBeTruthy();

    await act(async () => {
      backToAgentButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      backToMemoryButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(onNavigate).toHaveBeenNthCalledWith(
      1,
      "agent",
      expect.objectContaining({
        agentEntry: "new-task",
      }),
    );
    expect(onNavigate).toHaveBeenNthCalledWith(2, "memory");
  });

  it("切到图片分类后应挂载图片工作台", async () => {
    const container = renderPage();
    await flushEffects();

    const imageCategoryButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("图片"));
    expect(imageCategoryButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      imageCategoryButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushEffects();
    });

    expect(getBodyText()).toContain("图片工作台已挂载");
    expect(getBodyText()).toContain("当前范围");
    expect(getBodyText()).not.toContain("当前为「图片」分类视图");
  });

  it("点击文档和文件时应打开独立资源管理器", async () => {
    resourcesState.items = [
      createResourceItem(1),
      createResourceItem(2),
      {
        id: "file-1",
        projectId: "project-1",
        kind: "file" as const,
        sourceType: "material" as const,
        name: "合同.pdf",
        description: "PDF 合同",
        tags: [],
        parentId: null,
        createdAt: 1,
        updatedAt: 2,
        filePath: "/tmp/contract.pdf",
        fileType: "document",
        mimeType: "application/pdf",
        size: 2048,
      },
    ];
    mockFetchDocumentDetail.mockImplementation(async (id: string) => {
      if (id === "doc-2") {
        return {
          id: "doc-2",
          title: "项目文档 2",
          body: "# 项目文档 2",
          word_count: 16,
        };
      }
      return {
        id: "doc-1",
        title: "项目文档 1",
        body: "# 项目文档 1",
        word_count: 8,
      };
    });

    const container = renderPage();
    await flushEffects();

    const docButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("项目文档 1"),
    );
    expect(docButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      docButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects();
    });

    expect(mockFetchDocumentDetail).toHaveBeenCalledWith("doc-1");
    expect(mockFetchDocumentDetail).toHaveBeenCalledWith("doc-2");
    expect(mockOpenResourceManager).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sourceLabel: "项目资料",
        initialIndex: 1,
        items: [
          expect.objectContaining({
            id: "doc-2",
            kind: "markdown",
            content: "# 项目文档 2",
            size: 16,
            sourceContext: expect.objectContaining({
              kind: "project_resource",
              projectId: "project-1",
              contentId: "doc-2",
              sourcePage: "resources",
              resourceCategory: "all",
            }),
          }),
          expect.objectContaining({
            id: "doc-1",
            kind: "markdown",
            content: "# 项目文档 1",
            sourceContext: expect.objectContaining({
              kind: "project_resource",
              projectId: "project-1",
              contentId: "doc-1",
              sourcePage: "resources",
              resourceCategory: "all",
            }),
          }),
        ],
      }),
    );

    const fileButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("合同.pdf"),
    );
    expect(fileButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      fileButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects();
    });

    expect(mockOpenResourceManager).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceLabel: "全部",
        initialIndex: 0,
        items: [
          expect.objectContaining({
            id: "file-1",
            kind: "pdf",
            filePath: "/tmp/contract.pdf",
            metadata: expect.objectContaining({
              sourcePage: "resources",
              resourceCategory: "all",
            }),
            sourceContext: expect.objectContaining({
              kind: "project_resource",
              projectId: "project-1",
              contentId: "file-1",
              sourcePage: "resources",
              resourceCategory: "all",
            }),
          }),
        ],
      }),
    );
  });

  it("跨项目媒体提示应并入当前范围状态条", async () => {
    resourcesProjectsState.projects = [
      {
        id: "project-1",
        name: "默认项目",
        isArchived: false,
      },
      {
        id: "project-2",
        name: "参考项目",
        isArchived: false,
      },
    ];
    mockListMaterials.mockImplementation(async (projectId: string) => {
      if (projectId === "project-2") {
        return [
          {
            id: "image-1",
            name: "封面图",
          },
        ];
      }
      return [];
    });

    const container = renderPage();
    await flushEffects();

    const imageCategoryButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("图片"));
    expect(imageCategoryButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      imageCategoryButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushEffects();
    });

    expect(getBodyText()).toContain(
      "当前项目暂无图片，检测到「参考项目」包含 1 个图片。",
    );
    expect(getBodyText()).toContain("切换查看");

    const switchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "切换查看",
    );
    expect(switchButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects();
    });

    expect(mockSetProjectId).toHaveBeenCalledWith("project-2");
  });

  it("资源管理器回跳应定位项目资料并高亮目标内容", async () => {
    const container = renderPage({
      pageParams: {
        projectId: "project-1",
        contentId: "doc-1",
        focusIntentId: "resource-intent-1",
        focusResourceTitle: "项目文档 1",
      },
    });
    await flushEffects();

    expect(
      container.querySelector('[data-testid="resources-focus-status"]')
        ?.textContent,
    ).toContain("已定位：项目文档 1");
    expect(
      container.querySelector('[data-testid="resources-focused-row"]')
        ?.textContent,
    ).toContain("项目文档 1");
  });

  it("资源管理器回跳到其他项目时应先切换项目", async () => {
    resourcesProjectsState.projects = [
      {
        id: "project-1",
        name: "默认项目",
        isArchived: false,
      },
      {
        id: "project-2",
        name: "目标项目",
        isArchived: false,
      },
    ];

    renderPage({
      pageParams: {
        projectId: "project-2",
        contentId: "doc-9",
        focusIntentId: "resource-intent-2",
        focusResourceTitle: "目标资料",
      },
    });
    await flushEffects();

    expect(mockSetProjectId).toHaveBeenCalledWith("project-2");
    expect(getBodyText()).toContain("正在定位：目标资料");
  });

  it("资源管理器回跳应恢复分类上下文并高亮媒体资源", async () => {
    resourcesState.items = [
      createResourceItem(1),
      {
        id: "image-1",
        projectId: "project-1",
        kind: "file" as const,
        sourceType: "material" as const,
        name: "封面图.png",
        description: "项目封面",
        tags: [],
        parentId: null,
        createdAt: 1,
        updatedAt: 3,
        filePath: "/tmp/cover.png",
        fileType: "image",
        mimeType: "image/png",
        size: 1024,
      },
    ];

    const container = renderPage({
      pageParams: {
        projectId: "project-1",
        contentId: "image-1",
        focusIntentId: "resource-intent-image-1",
        focusResourceTitle: "封面图.png",
        resourceCategory: "image",
      },
    });
    await flushEffects();

    expect(getBodyText()).toContain("图片工作台已挂载");
    expect(
      container.querySelector('[data-testid="resources-focused-row"]')
        ?.textContent,
    ).toContain("封面图.png");
  });

  it("资源管理器回跳应恢复目标文件夹并清空阻碍定位的搜索", async () => {
    resourcesState.searchQuery = "旧查询";
    resourcesState.items = [
      {
        id: "folder-1",
        projectId: "project-1",
        kind: "folder" as const,
        sourceType: "content" as const,
        name: "资料夹",
        description: "项目资料夹",
        tags: [],
        parentId: null,
        createdAt: 1,
        updatedAt: 3,
        filePath: "",
        fileType: "folder",
        mimeType: undefined,
      },
      {
        ...createResourceItem(1),
        parentId: "folder-1",
      },
    ];

    renderPage({
      pageParams: {
        projectId: "project-1",
        contentId: "doc-1",
        focusIntentId: "resource-intent-folder-1",
        focusResourceTitle: "项目文档 1",
        resourceFolderId: "folder-1",
        resourceCategory: "all",
      },
    });
    await flushEffects();

    expect(mockSetCurrentFolderId).toHaveBeenCalledWith("folder-1");
    expect(mockSetSearchQuery).toHaveBeenCalledWith("");
    expect(getBodyText()).toContain("已定位：项目文档 1");
  });

  it("顶部总览不应重复渲染当前范围信息", async () => {
    const container = renderPage();
    await flushEffects();

    expect(
      countTextOccurrences("当前位于根目录，可继续进入子文件夹浏览。"),
    ).toBe(1);
    expect(getBodyText()).toContain("0 个文件夹 · 1 个内容项 · 最近更新");
    expect(getBodyText()).toContain("显示第 1-1 条，共 1 条");
    expect(getBodyText()).not.toContain("范围：");

    const paragraphTexts = Array.from(container.querySelectorAll("p"))
      .map((node) => node.textContent?.trim())
      .filter((text): text is string => Boolean(text));

    expect(paragraphTexts).not.toContain("文件夹");
    expect(paragraphTexts).not.toContain("内容项");
    expect(paragraphTexts).not.toContain("最近更新");
  });

  it("应移除头部和侧栏里的旧入口", async () => {
    renderPage();
    await flushEffects();

    expect(getBodyText()).not.toContain("添加内容");
    expect(getBodyText()).not.toContain("新建资料库");
    expect(getBodyText()).not.toContain("当前浏览");
    expect(getBodyText()).not.toContain("最近更新：");
  });

  it("内容列表应固定按 20 行分页", async () => {
    const items = Array.from({ length: 25 }, (_, index) =>
      createResourceItem(index + 1),
    );
    resourcesState.items = items;

    const container = renderPage();
    await flushEffects();

    expect(container.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(getBodyText()).toContain("显示第 1-20 条，共 25 条");
    expect(getBodyText()).toContain("第 1 / 2 页");
    expect(getBodyText()).toContain("项目文档 25");
    expect(getBodyText()).not.toContain("项目文档 5");

    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "下一页",
    );
    expect(nextButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      nextButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushEffects();
    });

    expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(getBodyText()).toContain("显示第 21-25 条，共 25 条");
    expect(getBodyText()).toContain("第 2 / 2 页");
    expect(getBodyText()).toContain("项目文档 5");
  });
});
