import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTeamWorkspaceBoardSelectedSessionActionState } from "./useTeamWorkspaceBoardSelectedSessionActionState";

type HookProps = Parameters<
  typeof useTeamWorkspaceBoardSelectedSessionActionState
>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<
    typeof useTeamWorkspaceBoardSelectedSessionActionState
  > | null = null;

  const defaultProps: HookProps = {
    completedTeamSessionIds: [],
    currentSessionId: "parent-1",
    onCloseCompletedTeamSessions: undefined,
    onCloseSubagentSession: undefined,
    onOpenSubagentSession: undefined,
    onResumeSubagentSession: undefined,
    onSendSubagentInput: undefined,
    onWaitActiveTeamSessions: undefined,
    onWaitSubagentSession: undefined,
    selectedSession: null,
    waitableTeamSessionIds: [],
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceBoardSelectedSessionActionState(currentProps);
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
    getValue: () => {
      if (!latestValue) {
        throw new Error("hook 尚未初始化");
      }
      return latestValue;
    },
    render,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      continue;
    }

    await act(async () => {
      mounted.root.unmount();
      await Promise.resolve();
    });
    mounted.container.remove();
  }
});

describe("useTeamWorkspaceBoardSelectedSessionActionState", () => {
  it("应为运行中成员开放当前可用操作", async () => {
    const noop = async () => {};
    const harness = renderHook({
      completedTeamSessionIds: ["done-1"],
      onCloseCompletedTeamSessions: noop,
      onCloseSubagentSession: noop,
      onOpenSubagentSession: noop,
      onResumeSubagentSession: noop,
      onSendSubagentInput: noop,
      onWaitActiveTeamSessions: noop,
      onWaitSubagentSession: noop,
      selectedSession: {
        id: "child-1",
        name: "资料整理",
        runtimeStatus: "running",
        sessionType: "sub_agent",
      },
      waitableTeamSessionIds: ["child-1", "child-2"],
    });

    await harness.render();

    expect(harness.getValue()).toMatchObject({
      canCloseCompletedTeamSessions: true,
      canOpenSelectedSession: true,
      canResumeSelectedSession: false,
      canSendSelectedSessionInput: true,
      canStopSelectedSession: true,
      canWaitAnyActiveTeamSession: true,
      canWaitSelectedSession: true,
    });
  });

  it("应为已关闭成员只保留恢复能力", async () => {
    const noop = async () => {};
    const harness = renderHook({
      onCloseSubagentSession: noop,
      onOpenSubagentSession: noop,
      onResumeSubagentSession: noop,
      onSendSubagentInput: noop,
      onWaitSubagentSession: noop,
      selectedSession: {
        id: "child-closed",
        name: "封面定稿",
        runtimeStatus: "closed",
        sessionType: "sub_agent",
      },
      waitableTeamSessionIds: ["child-2"],
    });

    await harness.render();

    expect(harness.getValue()).toMatchObject({
      canOpenSelectedSession: true,
      canResumeSelectedSession: true,
      canSendSelectedSessionInput: false,
      canStopSelectedSession: false,
      canWaitAnyActiveTeamSession: false,
      canWaitSelectedSession: false,
    });
  });
});
