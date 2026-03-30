import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  clickButtonByText,
  clickButtonByTitle,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import type { ContentListItem, Project } from "@/lib/api/project";
import { ContentEditorPage } from "./ContentEditorPage";

const { mockGetContent, mockUpdateContent } = vi.hoisted(() => ({
  mockGetContent: vi.fn(),
  mockUpdateContent: vi.fn(),
}));

const { mockSetContent, mockGetHtml } = vi.hoisted(() => ({
  mockSetContent: vi.fn(),
  mockGetHtml: vi.fn(() => "<p>hello</p>"),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api/project", () => ({
  getContent: mockGetContent,
  updateContent: mockUpdateContent,
  formatRelativeTime: vi.fn(() => "刚刚"),
}));

vi.mock("@tiptap/react", () => {
  const chainResult = {
    focus: () => chainResult,
    undo: () => chainResult,
    redo: () => chainResult,
    toggleBold: () => chainResult,
    toggleItalic: () => chainResult,
    toggleStrike: () => chainResult,
    toggleCode: () => chainResult,
    toggleHeading: () => chainResult,
    toggleBulletList: () => chainResult,
    toggleOrderedList: () => chainResult,
    toggleBlockquote: () => chainResult,
    setHorizontalRule: () => chainResult,
    run: () => true,
  };

  const editor = {
    commands: {
      setContent: mockSetContent,
    },
    storage: {
      characterCount: {
        characters: () => 1234,
      },
    },
    getHTML: mockGetHtml,
    chain: () => chainResult,
    can: () => ({
      undo: () => true,
      redo: () => true,
    }),
    isActive: () => false,
  };

  return {
    useEditor: vi.fn(() => editor),
    EditorContent: () => <div>EDITOR_CONTENT_STUB</div>,
  };
});

vi.mock("@tiptap/starter-kit", () => ({
  default: {
    configure: vi.fn(() => ({})),
  },
}));

vi.mock("@tiptap/extension-placeholder", () => ({
  default: {
    configure: vi.fn(() => ({})),
  },
}));

vi.mock("./MemorySidebar", () => ({
  MemorySidebar: () => <aside>MEMORY_SIDEBAR_STUB</aside>,
}));

setupReactActEnvironment();

const mountedRoots: MountedRoot[] = [];

const project: Project = {
  id: "project-1",
  name: "写作项目",
  workspaceType: "document",
  rootPath: "/tmp/project-1",
  isDefault: false,
  createdAt: 1,
  updatedAt: 2,
  icon: "📝",
  isFavorite: false,
  isArchived: false,
  tags: [],
};

const content: ContentListItem = {
  id: "content-1",
  project_id: "project-1",
  title: "测试稿件",
  content_type: "document",
  status: "draft",
  order: 0,
  word_count: 0,
  created_at: 1,
  updated_at: 2,
};

describe("ContentEditorPage", () => {
  beforeEach(() => {
    mockGetContent.mockResolvedValue({
      id: "content-1",
      project_id: "project-1",
      title: "测试稿件",
      body: "<p>hello</p>",
      content_type: "document",
      status: "draft",
      order: 0,
      word_count: 0,
      metadata: {},
      created_at: 1,
      updated_at: 2,
    });
    mockUpdateContent.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.clearAllMocks();
  });

  it("应渲染新的编辑工作台摘要头", async () => {
    const { container } = mountHarness(
      ContentEditorPage,
      {
        project,
        content,
        onBack: vi.fn(),
      },
      mountedRoots,
    );

    await flushEffects(2);

    const text = container.textContent ?? "";
    expect(text).toContain("返回内容列表");
    expect(text).toContain("当前稿件");
    expect(text).toContain("Draft");
    expect(text).toContain("当前字数");
    expect(text).toContain("EDITOR_CONTENT_STUB");
  });

  it("应支持切换右侧记忆侧栏并移除项目风格入口", async () => {
    const { container } = mountHarness(
      ContentEditorPage,
      {
        project,
        content,
        onBack: vi.fn(),
      },
      mountedRoots,
    );

    await flushEffects(2);

    expect(container.textContent).toContain("MEMORY_SIDEBAR_STUB");

    const toggleButton = clickButtonByTitle(container, "隐藏侧边栏");
    expect(toggleButton).toBeDefined();
    await flushEffects();
    expect(container.textContent).not.toContain("MEMORY_SIDEBAR_STUB");
    expect(clickButtonByText(container, "项目风格")).toBeUndefined();
  });
});
