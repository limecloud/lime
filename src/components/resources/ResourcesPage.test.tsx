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

const {
  mockLoadResources,
  resourcesState,
} = vi.hoisted(() => {
  const nextState = {
    projectId: "project-1",
    items: [
      {
        id: "doc-1",
        kind: "document",
        sourceType: "content",
        name: "项目简介",
        description: "说明文档",
        tags: ["说明"],
        createdAt: 1,
        updatedAt: 2,
        filePath: "",
        fileType: "document",
        mimeType: "text/markdown",
      },
    ],
    visibleItems: [
      {
        id: "doc-1",
        kind: "document",
        sourceType: "content",
        name: "项目简介",
        description: "说明文档",
        tags: ["说明"],
        createdAt: 1,
        updatedAt: 2,
        filePath: "",
        fileType: "document",
        mimeType: "text/markdown",
      },
    ],
    loading: false,
    saving: false,
    error: null,
    currentFolderId: null,
    searchQuery: "",
    sortField: "updatedAt",
    sortDirection: "desc",
    breadcrumbs: [],
    currentFolder: null,
    canNavigateUp: false,
    setProjectId: vi.fn(),
    loadResources: vi.fn(),
    refresh: vi.fn(),
    setCurrentFolderId: vi.fn(),
    setSearchQuery: vi.fn(),
    setSortField: vi.fn(),
    setSortDirection: vi.fn(),
    createFolder: vi.fn(),
    createDocument: vi.fn(),
    uploadFile: vi.fn(),
    renameById: vi.fn(),
    deleteById: vi.fn(),
    moveToRoot: vi.fn(),
  };

  return {
    mockSetProjectId: nextState.setProjectId,
    mockLoadResources: nextState.loadResources,
    mockRefresh: nextState.refresh,
    mockSetCurrentFolderId: nextState.setCurrentFolderId,
    mockSetSearchQuery: nextState.setSearchQuery,
    mockSetSortField: nextState.setSortField,
    mockSetSortDirection: nextState.setSortDirection,
    mockCreateFolder: nextState.createFolder,
    mockCreateDocument: nextState.createDocument,
    mockUploadFile: nextState.uploadFile,
    mockRenameById: nextState.renameById,
    mockDeleteById: nextState.deleteById,
    mockMoveToRoot: nextState.moveToRoot,
    resourcesState: nextState,
  };
});

vi.mock("@/hooks/useProjects", () => ({
  useProjects: () => ({
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
  listMaterials: vi.fn(),
}));

vi.mock("./services/resourceAdapter", () => ({
  fetchDocumentDetail: vi.fn(),
}));

vi.mock("./store", () => ({
  resourcesSelectors: {
    visibleItems: (state: typeof resourcesState) => state.visibleItems,
    folderBreadcrumbs: (state: typeof resourcesState) => state.breadcrumbs,
    currentFolder: (state: typeof resourcesState) => state.currentFolder,
    canNavigateUp: (state: typeof resourcesState) => state.canNavigateUp,
  },
  useResourcesStore: (
    selector: (state: typeof resourcesState) => unknown,
  ) => selector(resourcesState),
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
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
  });

  it("应把资料库首屏说明收进 tips", async () => {
    renderPage();
    await flushEffects();

    expect(getBodyText()).not.toContain(
      "在一个更宽的工作台里统一查看项目文档、素材与目录结构，把筛选、浏览和新增操作拆开，减少来回切换成本。",
    );
    expect(getBodyText()).not.toContain(
      "在目录浏览和跨目录分类视图之间切换，快速定位不同类型内容。",
    );

    const heroTip = await hoverTip("资料库工作台说明");
    expect(getBodyText()).toContain(
      "在一个更宽的工作台里统一查看项目文档、素材与目录结构，把筛选、浏览和新增操作拆开，减少来回切换成本。",
    );
    await leaveTip(heroTip);

    const categoryTip = await hoverTip("资料分类说明");
    expect(getBodyText()).toContain(
      "在目录浏览和跨目录分类视图之间切换，快速定位不同类型内容。",
    );
    await leaveTip(categoryTip);
  });
});
