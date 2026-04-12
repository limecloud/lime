import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTeamWorkspaceBoardActions } from "./useTeamWorkspaceBoardActions";

type HookProps = Parameters<typeof useTeamWorkspaceBoardActions>[0];

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createDeferred() {
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

function renderHook(props?: Partial<HookProps>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestValue: ReturnType<typeof useTeamWorkspaceBoardActions> | null = null;

  const defaultProps: HookProps = {
    completedTeamSessionIds: [],
    selectedSession: {
      id: "child-1",
    },
    waitableTeamSessionIds: [],
  };

  function Probe(currentProps: HookProps) {
    latestValue = useTeamWorkspaceBoardActions(currentProps);
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

describe("useTeamWorkspaceBoardActions", () => {
  it("应维护当前选中成员的输入草稿，并在发送后清空", async () => {
    const onSendSubagentInput = vi.fn().mockResolvedValue(undefined);
    const harness = renderHook({
      onSendSubagentInput,
    });

    await harness.render();

    await act(async () => {
      harness.getValue().handleSelectedSessionInputDraftChange("继续推进下一步");
      await Promise.resolve();
    });

    expect(harness.getValue().selectedSessionInputDraft).toBe("继续推进下一步");
    expect(harness.getValue().selectedSessionInputMessage).toBe("继续推进下一步");

    await act(async () => {
      await harness.getValue().handleSelectedSessionSendInput(false);
    });

    expect(onSendSubagentInput).toHaveBeenCalledWith("child-1", "继续推进下一步", {
      interrupt: false,
    });
    expect(harness.getValue().selectedSessionInputDraft).toBe("");
    expect(harness.getValue().selectedSessionInputMessage).toBe("");
    expect(harness.getValue().selectedActionPending).toBe(false);
  });

  it("应在等待任一活跃成员时维护 Team 级 pending 状态", async () => {
    const deferred = createDeferred();
    const onWaitActiveTeamSessions = vi.fn().mockReturnValue(deferred.promise);
    const harness = renderHook({
      onWaitActiveTeamSessions,
      waitableTeamSessionIds: ["child-1", "child-2"],
    });

    await harness.render();

    let task: Promise<void> | undefined;
    act(() => {
      task = harness.getValue().handleWaitAnyActiveTeamSessions();
    });

    expect(harness.getValue().pendingTeamAction).toBe("wait_any");

    await act(async () => {
      deferred.resolve();
      await task;
    });

    expect(onWaitActiveTeamSessions).toHaveBeenCalledWith(
      ["child-1", "child-2"],
      30_000,
    );
    expect(harness.getValue().pendingTeamAction).toBeNull();
  });

  it("应在中断发送期间暴露 session 级 pending 状态", async () => {
    const deferred = createDeferred();
    const onSendSubagentInput = vi.fn().mockReturnValue(deferred.promise);
    const harness = renderHook({
      onSendSubagentInput,
    });

    await harness.render();

    await act(async () => {
      harness.getValue().handleSelectedSessionInputDraftChange("立即补充约束");
      await Promise.resolve();
    });

    let task: Promise<void> | undefined;
    act(() => {
      task = harness.getValue().handleSelectedSessionSendInput(true);
    });

    expect(harness.getValue().selectedActionPending).toBe(true);
    expect(harness.getValue().pendingSessionAction).toEqual({
      sessionId: "child-1",
      action: "interrupt_send",
    });

    await act(async () => {
      deferred.resolve();
      await task;
    });

    expect(harness.getValue().pendingSessionAction).toBeNull();
    expect(harness.getValue().selectedActionPending).toBe(false);
  });
});
