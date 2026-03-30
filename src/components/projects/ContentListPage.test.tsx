import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clickButtonByText,
  cleanupMountedRoots,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import type { Project } from "@/lib/api/project";
import { ContentListPage } from "./ContentListPage";

const {
  mockListContents,
  mockCreateContent,
  mockUpdateContent,
  mockDeleteContent,
  mockGetContentStats,
} = vi.hoisted(() => ({
  mockListContents: vi.fn(),
  mockCreateContent: vi.fn(),
  mockUpdateContent: vi.fn(),
  mockDeleteContent: vi.fn(),
  mockGetContentStats: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./memory", () => ({
  CharacterPanel: () => <div>CHARACTER_PANEL_STUB</div>,
  WorldBuildingPanel: () => <div>WORLD_PANEL_STUB</div>,
  OutlinePanel: () => <div>OUTLINE_PANEL_STUB</div>,
}));

vi.mock("@/lib/api/project", () => ({
  listContents: mockListContents,
  createContent: mockCreateContent,
  updateContent: mockUpdateContent,
  deleteContent: mockDeleteContent,
  getContentStats: mockGetContentStats,
  getProjectTypeLabel: vi.fn(() => "通用项目"),
  getContentTypeLabel: vi.fn(() => "文稿"),
  getContentStatusLabel: vi.fn((status: string) =>
    status === "completed" ? "已完成" : "草稿",
  ),
  getDefaultContentTypeForProject: vi.fn(() => "post"),
  formatWordCount: vi.fn((count: number) => `${count} 字`),
  formatRelativeTime: vi.fn(() => "刚刚"),
}));

setupReactActEnvironment();

const mountedRoots: MountedRoot[] = [];

const project: Project = {
  id: "project-1",
  name: "我的项目",
  workspaceType: "general",
  rootPath: "/tmp/project-1",
  isDefault: false,
  createdAt: 1,
  updatedAt: 2,
  icon: "🪄",
  isFavorite: false,
  isArchived: false,
  tags: [],
};

describe("ContentListPage", () => {
  beforeEach(() => {
    mockListContents.mockResolvedValue([
      {
        id: "content-1",
        project_id: "project-1",
        title: "第一篇内容",
        content_type: "post",
        status: "draft",
        order: 0,
        word_count: 1200,
        created_at: 1,
        updated_at: 2,
      },
    ]);
    mockGetContentStats.mockResolvedValue([1, 1200, 0]);
    mockCreateContent.mockResolvedValue({
      id: "content-2",
      project_id: "project-1",
      title: "新文稿",
      content_type: "post",
      status: "draft",
      order: 1,
      word_count: 0,
      created_at: 3,
      updated_at: 3,
    });
    mockUpdateContent.mockResolvedValue(undefined);
    mockDeleteContent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.clearAllMocks();
  });

  it("默认展示新的宽版项目工作台摘要", async () => {
    const { container } = mountHarness(
      ContentListPage,
      {
        project,
        onBack: vi.fn(),
        onSelectContent: vi.fn(),
      },
      mountedRoots,
    );

    await flushEffects();

    const text = container.textContent ?? "";
    expect(text).toContain("返回项目列表");
    expect(text).toContain("当前工作区：内容");
    expect(text).toContain("内容总数");
    expect(text).toContain("创作进度");
    expect(text).toContain("新建文稿");
  });

  it("项目工作台不再暴露旧风格标签", async () => {
    const { container } = mountHarness(
      ContentListPage,
      {
        project,
        onBack: vi.fn(),
        onSelectContent: vi.fn(),
      },
      mountedRoots,
    );

    await flushEffects();

    expect(clickButtonByText(container, "风格")).toBeUndefined();
  });
});
