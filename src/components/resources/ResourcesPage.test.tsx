import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  flushEffects,
  renderIntoDom,
  setReactActEnvironment,
  type MountedRoot,
} from "@/components/image-gen/test-utils";
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
} = vi.hoisted(() => {
  const nextState = {
    projectId: "project-1",
    items: [createResourceItem(1)],
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
        name: "默认资料库",
        isArchived: false,
      },
    ],
    defaultProject: {
      id: "project-1",
      name: "默认资料库",
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
}));

vi.mock("@/lib/api/materials", () => ({
  listMaterials: mockListMaterials,
}));

vi.mock("./services/resourceAdapter", () => ({
  fetchDocumentDetail: vi.fn(),
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

function renderPage() {
  return renderIntoDom(<ResourcesPage />, mountedRoots).container;
}

function getBodyText() {
  return document.body.textContent ?? "";
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
    resourcesProjectsState.projects = [
      {
        id: "project-1",
        name: "默认资料库",
        isArchived: false,
      },
    ];
    resourcesProjectsState.defaultProject = {
      id: "project-1",
      name: "默认资料库",
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

  it("应把资料库首屏说明收进 tips", async () => {
    renderPage();
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "集中管理导入资源、项目资料和外部素材；先把内容放进资料库，再决定哪些值得继续沉淀。",
    );
    expect(getBodyText()).not.toContain(
      "在目录浏览和跨目录分类视图之间切换，快速定位不同类型内容。",
    );

    const heroTip = await hoverTip("资料库工作台说明");
    expect(getBodyText()).toContain(
      "集中管理导入资源、项目资料和外部素材；先把内容放进资料库，再决定哪些值得继续沉淀。",
    );
    await leaveTip(heroTip);

    const categoryTip = await hoverTip("资料分类说明");
    expect(getBodyText()).toContain(
      "在目录浏览和跨目录分类视图之间切换，快速定位不同类型内容。",
    );
    await leaveTip(categoryTip);
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

  it("跨项目媒体提示应并入当前范围状态条", async () => {
    resourcesProjectsState.projects = [
      {
        id: "project-1",
        name: "默认资料库",
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
      "当前资料库暂无图片，检测到「参考项目」包含 1 个图片。",
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
