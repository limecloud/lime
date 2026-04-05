import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMountedRoots,
  fillTextInput,
  findButtonByText,
  findInputById,
  flushEffects,
  mountHarness,
  setupReactActEnvironment,
  type MountedRoot,
} from "@/components/workspace/hooks/testUtils";
import { CreateProjectDialog } from "./CreateProjectDialog";

const {
  mockExtractErrorMessage,
  mockGetCreateProjectErrorMessage,
  mockGetProjectByRootPath,
  mockGetWorkspaceProjectsRoot,
  mockResolveProjectRootPath,
} = vi.hoisted(() => ({
  mockExtractErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
  mockGetCreateProjectErrorMessage: vi.fn((message: string) => message),
  mockGetProjectByRootPath: vi.fn(),
  mockGetWorkspaceProjectsRoot: vi.fn(),
  mockResolveProjectRootPath: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api/project", () => ({
  USER_PROJECT_TYPES: ["general"],
  extractErrorMessage: mockExtractErrorMessage,
  getCreateProjectErrorMessage: mockGetCreateProjectErrorMessage,
  getProjectTypeLabel: vi.fn(() => "通用"),
  getProjectTypeIcon: vi.fn(() => "📁"),
  getProjectByRootPath: mockGetProjectByRootPath,
  getWorkspaceProjectsRoot: mockGetWorkspaceProjectsRoot,
  resolveProjectRootPath: mockResolveProjectRootPath,
}));

setupReactActEnvironment();

const mountedRoots: MountedRoot[] = [];

describe("CreateProjectDialog", () => {
  beforeEach(() => {
    mockGetWorkspaceProjectsRoot.mockResolvedValue("/tmp/workspace");
    mockResolveProjectRootPath.mockImplementation(async (name: string) =>
      `/tmp/workspace/${name}`,
    );
    mockGetProjectByRootPath.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanupMountedRoots(mountedRoots);
    vi.clearAllMocks();
  });

  it("应渲染新的项目创建工作台摘要", async () => {
    mountHarness(
      CreateProjectDialog,
      {
        open: true,
        onOpenChange: vi.fn(),
        onSubmit: vi.fn(async () => undefined),
        defaultType: "general",
        defaultName: "研究手记",
      },
      mountedRoots,
    );

    await flushEffects(3);

    const text = document.body.textContent ?? "";
    expect(text).toContain("创建新的项目工作台");
    expect(text).toContain("选择项目类型");
    expect(text).toContain("目录与路径");
    expect(text).toContain("/tmp/workspace/研究手记");
  });

  it("路径冲突时应展示提示并禁用创建", async () => {
    mockGetProjectByRootPath.mockResolvedValue({
      id: "project-exists",
      name: "已存在项目",
    });

    mountHarness(
      CreateProjectDialog,
      {
        open: true,
        onOpenChange: vi.fn(),
        onSubmit: vi.fn(async () => undefined),
        defaultType: "general",
      },
      mountedRoots,
    );

    await flushEffects(2);

    const nameInput = findInputById(document.body, "name");
    expect(nameInput).not.toBeNull();
    fillTextInput(nameInput, "冲突项目");

    await flushEffects(3);

    expect(document.body.textContent ?? "").toContain("路径已存在项目：已存在项目");
    const createButton = findButtonByText(document.body, "创建", {
      exact: true,
    });
    expect(createButton).toBeDefined();
    expect(createButton?.disabled).toBe(true);
  });
});
