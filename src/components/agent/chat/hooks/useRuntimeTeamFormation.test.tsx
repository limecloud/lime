import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamWorkspaceRuntimeFormationState } from "../teamWorkspaceRuntime";
import type { TeamDefinition } from "../utils/teamDefinitions";
import {
  shouldPrepareRuntimeTeamBeforeSend,
  useRuntimeTeamFormation,
} from "./useRuntimeTeamFormation";

type HookProps = Parameters<typeof useRuntimeTeamFormation>[0];
type RuntimeTeamPreparationResult = TeamWorkspaceRuntimeFormationState | null;

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
    projectId: "project-1",
    sessionId: "session-1",
    selectedTeam: createSelectedTeam(),
    subagentEnabled: true,
    hasRealTeamGraph: false,
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

  it("发送前满足条件且已选 Team 时，应直接生成基于蓝图的 formed 状态", async () => {
    const { render, getValue } = renderHook();

    await render();

    const resultRef: { current: RuntimeTeamPreparationResult } = {
      current: null,
    };
    await act(async () => {
      resultRef.current = await getValue().prepareRuntimeTeamBeforeSend({
        input:
          "请把这个需求从多个角度拆解成子任务，分别调研竞品方案和技术实现路径，然后给出综合分析报告",
      });
    });

    expect(resultRef.current?.status).toBe("formed");
    expect(resultRef.current?.label).toBe("研究协作组");
    expect("runtimeTeamState" in getValue()).toBe(false);
  });

  it("未选择 Team 时，不应再触发发送前自动编队", async () => {
    const { render, getValue } = renderHook({
      selectedTeam: null,
    });

    await render();

    const resultRef: { current: RuntimeTeamPreparationResult } = {
      current: null,
    };
    await act(async () => {
      resultRef.current = await getValue().prepareRuntimeTeamBeforeSend({
        input:
          "请从多个维度拆解这个复杂需求，先做竞品调研，再做技术方案评估，最后输出可行性分析报告",
      });
    });

    expect(resultRef.current).toBeNull();
    expect("runtimeTeamState" in getValue()).toBe(false);
  });

  it("hook 不再把 prepared team 挂成会话级本地状态", async () => {
    const { render, getValue } = renderHook();
    await render();

    const firstResultRef: { current: RuntimeTeamPreparationResult } = {
      current: null,
    };
    await act(async () => {
      firstResultRef.current = await getValue().prepareRuntimeTeamBeforeSend({
        input:
          "请先规划一个多角色协作的 team 来处理这个跨部门需求，需要调研、开发、测试三个角色分别推进各自负责的子任务",
        subagentEnabled: true,
      });
    });

    expect(firstResultRef.current?.status).toBe("formed");
    expect("runtimeTeamState" in getValue()).toBe(false);
  });

  it("本轮不走 Team 时，应只返回 null 而不保留上一轮残留状态", async () => {
    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      await getValue().prepareRuntimeTeamBeforeSend({
        input:
          "请拆分成多个角色来协作执行这个跨领域的综合分析任务，需要数据分析师、行业研究员和报告撰写员分别负责各自模块",
      });
    });

    expect("runtimeTeamState" in getValue()).toBe(false);

    const secondResultRef: { current: RuntimeTeamPreparationResult } = {
      current: null,
    };
    await act(async () => {
      secondResultRef.current = await getValue().prepareRuntimeTeamBeforeSend({
        input: "请直接润色这段文案",
        purpose: "content_review",
      });
    });

    expect(secondResultRef.current).toBeNull();
    expect("runtimeTeamState" in getValue()).toBe(false);
  });

  it("clearRuntimeTeamState 保留为空操作兼容壳", async () => {
    const { render, getValue } = renderHook();
    await render();

    await act(async () => {
      getValue().clearRuntimeTeamState();
    });

    expect("runtimeTeamState" in getValue()).toBe(false);
  });
});

describe("shouldPrepareRuntimeTeamBeforeSend", () => {
  it("输入足够长且非简单生成类请求时返回 true", () => {
    expect(
      shouldPrepareRuntimeTeamBeforeSend({
        subagentEnabled: true,
        projectId: "project-1",
        input:
          "请从多个角度拆解这个需求，调研竞品方案，然后分别给出技术实现方案和产品设计方案，最后做交叉验证",
      }),
    ).toBe(true);
  });

  it("subagent 关闭时返回 false", () => {
    expect(
      shouldPrepareRuntimeTeamBeforeSend({
        subagentEnabled: false,
        projectId: "project-1",
        input:
          "请从多个角度拆解这个需求，调研竞品方案，然后分别给出技术实现方案和产品设计方案",
      }),
    ).toBe(false);
  });

  it("无项目时返回 false", () => {
    expect(
      shouldPrepareRuntimeTeamBeforeSend({
        subagentEnabled: true,
        projectId: "",
        input:
          "请从多个角度拆解这个需求，调研竞品方案，然后分别给出技术实现方案和产品设计方案",
      }),
    ).toBe(false);
  });

  it("空白输入时返回 false", () => {
    expect(
      shouldPrepareRuntimeTeamBeforeSend({
        subagentEnabled: true,
        projectId: "project-1",
        input: "  ",
      }),
    ).toBe(false);
  });

  it("带 purpose 时返回 false", () => {
    expect(
      shouldPrepareRuntimeTeamBeforeSend({
        subagentEnabled: true,
        projectId: "project-1",
        input:
          "请从多个角度拆解这个需求，调研竞品方案，然后分别给出技术实现方案和产品设计方案",
        purpose: "content_review",
      }),
    ).toBe(false);
  });

  it("短输入时返回 false（少于 40 字符）", () => {
    expect(
      shouldPrepareRuntimeTeamBeforeSend({
        subagentEnabled: true,
        projectId: "project-1",
        input: "请拆解任务",
      }),
    ).toBe(false);
  });

  it("简单内容生成类请求返回 false", () => {
    expect(
      shouldPrepareRuntimeTeamBeforeSend({
        subagentEnabled: true,
        projectId: "project-1",
        input:
          "生成一份关于人工智能在医疗领域应用的详细报告，需要包含市场分析、技术趋势、政策法规、典型案例和未来展望五个部分",
      }),
    ).toBe(false);

    expect(
      shouldPrepareRuntimeTeamBeforeSend({
        subagentEnabled: true,
        projectId: "project-1",
        input:
          "帮我写一篇关于可持续发展目标的深度分析报告，要求涵盖经济、环境和社会三个维度的详细分析以及各国实践案例",
      }),
    ).toBe(false);
  });
});
