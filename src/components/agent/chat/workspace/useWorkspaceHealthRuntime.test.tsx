import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureWorkspaceReady } from "@/lib/api/project";
import type { WorkspaceEnsureResult } from "@/lib/api/project";
import { logAgentDebug } from "@/lib/agentDebug";
import { recordWorkspaceRepair } from "@/lib/workspaceHealthTelemetry";
import { scheduleMinimumDelayIdleTask } from "@/lib/utils/scheduleMinimumDelayIdleTask";
import {
  buildWorkspacePathAutoRecoveryKey,
  useWorkspaceHealthRuntime,
} from "./useWorkspaceHealthRuntime";

vi.mock("@/lib/api/project", () => ({
  ensureWorkspaceReady: vi.fn(),
}));

vi.mock("@/lib/agentDebug", () => ({
  logAgentDebug: vi.fn(),
}));

vi.mock("@/lib/workspaceHealthTelemetry", () => ({
  recordWorkspaceRepair: vi.fn(),
}));

vi.mock("@/lib/utils/scheduleMinimumDelayIdleTask", () => ({
  scheduleMinimumDelayIdleTask: vi.fn((task: () => void) => {
    task();
    return vi.fn();
  }),
}));

type HookProps = Parameters<typeof useWorkspaceHealthRuntime>[0];

const mountedRoots: Array<{ container: HTMLDivElement; root: Root }> = [];

function workspaceEnsureResultFixture(
  overrides: Partial<WorkspaceEnsureResult> = {},
): WorkspaceEnsureResult {
  return {
    workspaceId: "project-1",
    rootPath: "/tmp/project-1",
    existed: true,
    created: false,
    repaired: false,
    ...overrides,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latestValue: ReturnType<typeof useWorkspaceHealthRuntime> | null = null;

  const defaultProps: HookProps = {
    project: {
      id: "project-1",
      workspaceType: "general",
    },
    projectId: "project-1",
    workspacePathMissing: false,
    shouldDeferWorkspaceAuxiliaryLoads: false,
    deferredWorkspaceAuxiliaryLoadMs: undefined,
  };

  function Probe(currentProps: HookProps) {
    latestValue = useWorkspaceHealthRuntime(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ container, root });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  vi.mocked(ensureWorkspaceReady).mockResolvedValue(
    workspaceEnsureResultFixture(),
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.restoreAllMocks();
});

describe("buildWorkspacePathAutoRecoveryKey", () => {
  it("应稳定拼出 workspace path 自动恢复诊断 key", () => {
    expect(
      buildWorkspacePathAutoRecoveryKey({
        workspaceId: "workspace-1",
        content: "继续",
        imageCount: 2,
      }),
    ).toBe("workspace-1:继续:2");
  });
});

describe("useWorkspaceHealthRuntime", () => {
  it("禁用时不应检查 workspace 路径", async () => {
    const { render, getValue } = renderHook({
      enabled: false,
    });

    await render();

    expect(ensureWorkspaceReady).not.toHaveBeenCalled();
    expect(scheduleMinimumDelayIdleTask).not.toHaveBeenCalled();
    expect(getValue().workspaceHealthError).toBe(false);
  });

  it("项目切换后应检查 workspace，并记录自动修复", async () => {
    vi.mocked(ensureWorkspaceReady).mockResolvedValueOnce({
      ...workspaceEnsureResultFixture({
        repaired: true,
        rootPath: "/tmp/repaired",
      }),
    });
    const { render, getValue } = renderHook();

    await render();

    await vi.waitFor(() => {
      expect(ensureWorkspaceReady).toHaveBeenCalledWith("project-1");
    });
    await vi.waitFor(() => {
      expect(recordWorkspaceRepair).toHaveBeenCalledWith({
        workspaceId: "project-1",
        rootPath: "/tmp/repaired",
        source: "agent_chat_page",
      });
    });
    expect(getValue().workspaceHealthError).toBe(false);
  });

  it("workspace 路径类错误应显示健康错误", async () => {
    vi.mocked(ensureWorkspaceReady).mockRejectedValueOnce(
      new Error("workspace path missing"),
    );
    const { render, getValue } = renderHook();

    await render();

    await vi.waitFor(() => {
      expect(getValue().workspaceHealthError).toBe(true);
    });
  });

  it("临时 bridge 错误不应误报 workspace 健康错误", async () => {
    vi.mocked(ensureWorkspaceReady).mockRejectedValueOnce(new Error("timeout"));
    const { render, getValue } = renderHook();

    await render();

    await vi.waitFor(() => {
      expect(ensureWorkspaceReady).toHaveBeenCalledWith("project-1");
    });
    expect(getValue().workspaceHealthError).toBe(false);
  });

  it("延迟加载时应通过 idle task 调度检查", async () => {
    let deferredTask: (() => void) | null = null;
    const cancelDeferredCheck = vi.fn();
    vi.mocked(scheduleMinimumDelayIdleTask).mockImplementationOnce((task) => {
      deferredTask = task;
      return cancelDeferredCheck;
    });
    const { render } = renderHook({
      shouldDeferWorkspaceAuxiliaryLoads: true,
      deferredWorkspaceAuxiliaryLoadMs: 42,
    });

    await render();

    expect(scheduleMinimumDelayIdleTask).toHaveBeenCalledWith(
      expect.any(Function),
      {
        minimumDelayMs: 42,
        idleTimeoutMs: 1_500,
      },
    );
    expect(ensureWorkspaceReady).not.toHaveBeenCalled();

    await act(async () => {
      deferredTask?.();
      await Promise.resolve();
    });

    expect(ensureWorkspaceReady).toHaveBeenCalledWith("project-1");
  });

  it("临时 workspace path 缺失时只记录跳过自动恢复诊断", async () => {
    const { render } = renderHook({
      project: {
        id: "temporary-project",
        workspaceType: "temporary",
      },
      projectId: null,
      workspacePathMissing: {
        content: "继续",
        images: [],
      },
    });

    await render();

    expect(ensureWorkspaceReady).not.toHaveBeenCalled();
    expect(logAgentDebug).toHaveBeenCalledWith(
      "LocalConversationPage",
      "workspacePathAutoRecovery.skippedNoDefaultProjectFallback",
      {
        projectId: "temporary-project",
        recoveryKey: "temporary-project:继续:0",
      },
      { level: "warn" },
    );
  });
});
