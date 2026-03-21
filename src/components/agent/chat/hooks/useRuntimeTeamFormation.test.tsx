import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamDefinition } from "../utils/teamDefinitions";
import {
  shouldGenerateRuntimeTeamAfterSend,
  useRuntimeTeamFormation,
} from "./useRuntimeTeamFormation";

type HookProps = Parameters<typeof useRuntimeTeamFormation>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createSelectedTeam(): TeamDefinition {
  return {
    id: "team-1",
    source: "builtin",
    label: "研究协作组",
    description: "负责拆解调研任务",
    roles: [
      {
        id: "role-1",
        label: "研究员",
        summary: "收集资料",
      },
    ],
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: HookProps = {
    activeTheme: "general",
    projectId: "project-1",
    sessionId: "session-1",
    selectedTeam: createSelectedTeam(),
    subagentEnabled: true,
    hasRealTeamGraph: false,
    generateRuntimeTeam: vi.fn(async () => ({
      id: "ephemeral-1",
      source: "ephemeral",
      label: "临时 Team",
      description: "自动生成",
      roles: [
        {
          id: "member-1",
          label: "执行者",
          summary: "执行当前任务",
        },
      ],
    })),
    createRequestId: () => "request-1",
    now: () => 1_710_000_000_000,
  };

  let latestValue: ReturnType<typeof useRuntimeTeamFormation> | null = null;

  function Probe(currentProps: HookProps) {
    latestValue = useRuntimeTeamFormation(currentProps);
    return null;
  }

  const render = async (nextProps?: Partial<HookProps>) => {
    await act(async () => {
      root.render(<Probe {...defaultProps} {...props} {...nextProps} />);
      await Promise.resolve();
    });
  };

  mountedRoots.push({ root, container });

  return {
    render,
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    defaultProps: {
      ...defaultProps,
      ...props,
    },
  };
}

describe("useRuntimeTeamFormation", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
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
    vi.clearAllMocks();
  });

  it("发送后满足条件时应进入 forming 并在生成完成后切到 formed", async () => {
    const generateRuntimeTeam = vi.fn(async () => ({
      id: "ephemeral-1",
      source: "ephemeral" as const,
      label: "自动 Team",
      description: "自动生成",
      roles: [
        {
          id: "role-1",
          label: "执行者",
          summary: "负责执行",
        },
      ],
    }));
    const { render, getValue } = renderHook({
      generateRuntimeTeam,
    });

    await render();

    act(() => {
      getValue().handleRuntimeTeamAfterSend({
        input: "请拆成两个子任务",
        providerType: "openai",
        model: "gpt-4.1",
        executionStrategy: "react",
      });
    });

    expect(getValue().runtimeTeamState?.status).toBe("forming");
    expect(generateRuntimeTeam).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "project-1",
        providerType: "openai",
        model: "gpt-4.1",
        input: "请拆成两个子任务",
        activeTheme: "general",
      }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getValue().runtimeTeamState?.status).toBe("formed");
    expect(getValue().runtimeTeamState?.label).toBe("自动 Team");
  });

  it("subagent 关闭且没有真实 team 图时，应清空 runtime team 状态", async () => {
    const { render, getValue } = renderHook();
    await render();

    act(() => {
      getValue().triggerRuntimeTeamFormation({
        input: "请先规划 team",
        providerType: "openai",
        model: "gpt-4.1",
        executionStrategy: "react",
      });
    });

    expect(getValue().runtimeTeamState?.status).toBe("forming");

    await render({
      subagentEnabled: false,
      hasRealTeamGraph: false,
    });

    expect(getValue().runtimeTeamState).toBeNull();
  });

  it("session 切换时应重置 runtime team 状态", async () => {
    const { render, getValue } = renderHook();
    await render();

    act(() => {
      getValue().triggerRuntimeTeamFormation({
        input: "请先规划 team",
        providerType: "openai",
        model: "gpt-4.1",
        executionStrategy: "react",
      });
    });

    expect(getValue().runtimeTeamState?.status).toBe("forming");

    await render({
      sessionId: "session-2",
    });

    expect(getValue().runtimeTeamState).toBeNull();
  });
});

describe("shouldGenerateRuntimeTeamAfterSend", () => {
  it("仅在 subagent 开启、存在项目、非 purpose 且输入非空时返回 true", () => {
    expect(
      shouldGenerateRuntimeTeamAfterSend({
        subagentEnabled: true,
        projectId: "project-1",
        input: "请拆解任务",
      }),
    ).toBe(true);

    expect(
      shouldGenerateRuntimeTeamAfterSend({
        subagentEnabled: false,
        projectId: "project-1",
        input: "请拆解任务",
      }),
    ).toBe(false);

    expect(
      shouldGenerateRuntimeTeamAfterSend({
        subagentEnabled: true,
        projectId: "",
        input: "请拆解任务",
      }),
    ).toBe(false);

    expect(
      shouldGenerateRuntimeTeamAfterSend({
        subagentEnabled: true,
        projectId: "project-1",
        input: "  ",
      }),
    ).toBe(false);

    expect(
      shouldGenerateRuntimeTeamAfterSend({
        subagentEnabled: true,
        projectId: "project-1",
        input: "请拆解任务",
        purpose: "content_review",
      }),
    ).toBe(false);
  });
});
