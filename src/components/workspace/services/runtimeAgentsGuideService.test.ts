import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  notifyProjectCreatedWithRuntimeAgentsGuide,
  notifyProjectRuntimeAgentsGuide,
} from "./runtimeAgentsGuideService";

const {
  mockEnsureWorkspaceLocalAgentsGitignore,
  mockScaffoldRuntimeAgentsTemplate,
  mockToastError,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockEnsureWorkspaceLocalAgentsGitignore: vi.fn(),
  mockScaffoldRuntimeAgentsTemplate: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
  },
}));

vi.mock("@/lib/api/memoryRuntime", () => ({
  ensureWorkspaceLocalAgentsGitignore: mockEnsureWorkspaceLocalAgentsGitignore,
  scaffoldRuntimeAgentsTemplate: mockScaffoldRuntimeAgentsTemplate,
}));

describe("runtimeAgentsGuideService", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockScaffoldRuntimeAgentsTemplate.mockResolvedValue({
      status: "created",
    });
    mockEnsureWorkspaceLocalAgentsGitignore.mockResolvedValue({
      status: "added",
    });
  });

  it("首次创建项目时应展示运行时 AGENTS 引导", () => {
    notifyProjectCreatedWithRuntimeAgentsGuide(
      {
        id: "project-1",
        name: "项目 A",
        rootPath: "/tmp/workspace/project-a",
      },
      "项目创建成功",
    );

    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "项目创建成功",
      expect.objectContaining({
        description: expect.stringContaining(".lime/AGENTS.md"),
        action: expect.objectContaining({
          label: "一键初始化",
          onClick: expect.any(Function),
        }),
      }),
    );
  });

  it("同一项目重复通知时应退化为普通成功提示", () => {
    notifyProjectCreatedWithRuntimeAgentsGuide(
      {
        id: "project-1",
        name: "项目 A",
        rootPath: "/tmp/workspace/project-a",
      },
      "项目创建成功",
    );
    notifyProjectCreatedWithRuntimeAgentsGuide(
      {
        id: "project-1",
        name: "项目 A",
        rootPath: "/tmp/workspace/project-a",
      },
      "项目创建成功",
    );

    expect(mockToastSuccess).toHaveBeenNthCalledWith(2, "项目创建成功");
  });

  it("点击一键初始化后应生成模板并补齐 gitignore", async () => {
    notifyProjectCreatedWithRuntimeAgentsGuide(
      {
        id: "project-1",
        name: "项目 A",
        rootPath: "/tmp/workspace/project-a",
      },
      "项目创建成功",
    );

    const action = mockToastSuccess.mock.calls[0]?.[1]?.action;
    expect(action?.label).toBe("一键初始化");

    await action?.onClick();
    await Promise.resolve();

    expect(mockScaffoldRuntimeAgentsTemplate).toHaveBeenNthCalledWith(
      1,
      "workspace",
      "/tmp/workspace/project-a",
      false,
    );
    expect(mockScaffoldRuntimeAgentsTemplate).toHaveBeenNthCalledWith(
      2,
      "workspace_local",
      "/tmp/workspace/project-a",
      false,
    );
    expect(mockEnsureWorkspaceLocalAgentsGitignore).toHaveBeenCalledWith(
      "/tmp/workspace/project-a",
    );
    expect(mockToastSuccess).toHaveBeenLastCalledWith(
      "已初始化运行时 AGENTS 模板",
      expect.objectContaining({
        description: expect.stringContaining(".gitignore"),
      }),
    );
  });

  it("已展示过引导且关闭回退成功提示时不应再次弹出 toast", () => {
    notifyProjectRuntimeAgentsGuide(
      {
        id: "project-1",
        rootPath: "/tmp/workspace/project-a",
      },
      {
        successMessage: "工作区目录已重新关联",
        showSuccessWhenGuideAlreadySeen: false,
      },
    );
    mockToastSuccess.mockClear();

    notifyProjectRuntimeAgentsGuide(
      {
        id: "project-1",
        rootPath: "/tmp/workspace/project-a",
      },
      {
        successMessage: "工作区目录已重新关联",
        showSuccessWhenGuideAlreadySeen: false,
      },
    );

    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
