import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectApiMocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  ensureWorkspaceReady: vi.fn(),
  getDefaultProject: vi.fn(),
  getOrCreateDefaultProject: vi.fn(),
  listProjects: vi.fn(),
  resolveProjectRootPath: vi.fn(),
  updateProject: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  recordWorkspaceRepair: vi.fn(),
}));

vi.mock("@/lib/api/project", () => ({
  createProject: projectApiMocks.createProject,
  deleteProject: projectApiMocks.deleteProject,
  ensureWorkspaceReady: projectApiMocks.ensureWorkspaceReady,
  getDefaultProject: projectApiMocks.getDefaultProject,
  getOrCreateDefaultProject: projectApiMocks.getOrCreateDefaultProject,
  listProjects: projectApiMocks.listProjects,
  resolveProjectRootPath: projectApiMocks.resolveProjectRootPath,
  updateProject: projectApiMocks.updateProject,
}));

vi.mock("@/lib/workspaceHealthTelemetry", () => ({
  recordWorkspaceRepair: telemetryMocks.recordWorkspaceRepair,
}));

import { useProjects } from "./useProjects";

interface HookHarness {
  getValue: () => ReturnType<typeof useProjects>;
  unmount: () => void;
}

function createProject(overrides: Partial<ReturnType<typeof buildProject>> = {}) {
  return buildProject(overrides);
}

function buildProject(overrides: Partial<{
  id: string;
  name: string;
  workspaceType: "general";
  rootPath: string;
  isDefault: boolean;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  icon: string;
  color: string;
  isFavorite: boolean;
  isArchived: boolean;
  tags: string[];
  defaultPersonaId?: string;
}> = {}) {
  return {
    id: "project-default",
    name: "默认项目",
    workspaceType: "general" as const,
    rootPath: "/tmp/default-project",
    isDefault: true,
    settings: {},
    createdAt: 1,
    updatedAt: 1,
    icon: "📁",
    color: "#00aa88",
    isFavorite: false,
    isArchived: false,
    tags: [],
    ...overrides,
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mountHook(): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useProjects> | null = null;

  function TestComponent() {
    hookValue = useProjects();
    return null;
  }

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useProjects", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("不应等待默认项目目录健康检查完成才暴露项目列表", async () => {
    const defaultProject = createProject();
    let resolveEnsure: ((value: {
      workspaceId: string;
      rootPath: string;
      existed: boolean;
      created: boolean;
      repaired: boolean;
    }) => void) | null = null;

    projectApiMocks.listProjects.mockResolvedValueOnce([defaultProject]);
    projectApiMocks.getDefaultProject.mockResolvedValueOnce(defaultProject);
    projectApiMocks.ensureWorkspaceReady.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEnsure = resolve;
        }),
    );

    const harness = mountHook();

    try {
      await flushMicrotasks();

      expect(projectApiMocks.ensureWorkspaceReady).toHaveBeenCalledWith(
        defaultProject.id,
      );
      expect(harness.getValue().loading).toBe(false);
      expect(harness.getValue().projects).toHaveLength(1);
      expect(harness.getValue().defaultProject?.id).toBe(defaultProject.id);

      resolveEnsure?.({
        workspaceId: defaultProject.id,
        rootPath: defaultProject.rootPath,
        existed: true,
        created: false,
        repaired: false,
      });
      await flushMicrotasks();
    } finally {
      harness.unmount();
    }
  });

  it("DevBridge 瞬时不可用时应自动重试并恢复项目列表", async () => {
    const defaultProject = createProject();
    const bridgeError = new Error(
      "[DevBridge] 浏览器模式无法连接后端桥接，命令 \"workspace_list\" 执行失败。",
    );

    projectApiMocks.listProjects
      .mockRejectedValueOnce(bridgeError)
      .mockResolvedValueOnce([defaultProject]);
    projectApiMocks.getDefaultProject
      .mockRejectedValueOnce(bridgeError)
      .mockResolvedValueOnce(defaultProject);
    projectApiMocks.ensureWorkspaceReady.mockResolvedValue({
      workspaceId: defaultProject.id,
      rootPath: defaultProject.rootPath,
      existed: true,
      created: false,
      repaired: false,
    });

    const harness = mountHook();

    try {
      await flushMicrotasks();

      expect(harness.getValue().error).toContain("DevBridge");
      expect(harness.getValue().loading).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1200);
      });
      await flushMicrotasks();

      expect(harness.getValue().error).toBeNull();
      expect(harness.getValue().projects).toHaveLength(1);
      expect(harness.getValue().defaultProject?.id).toBe(defaultProject.id);
      expect(projectApiMocks.listProjects).toHaveBeenCalledTimes(2);
    } finally {
      harness.unmount();
    }
  });
});
