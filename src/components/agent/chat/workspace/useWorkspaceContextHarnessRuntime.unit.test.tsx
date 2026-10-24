import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceContextHarnessRuntime } from "./useWorkspaceContextHarnessRuntime";
import type { Message } from "../types";

const initial = {
  enabled: true,
  mappedTheme: "general" as const,
  messages: [] as Message[],
  isSending: false,
  projectMemory: null,
  harnessState: { pendingApprovals: [] as unknown[], hasSignals: false },
};

type Props = Parameters<typeof useWorkspaceContextHarnessRuntime>[0];
const cleanups: Array<() => void> = [];

function renderHook(initialProps: Props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let currentProps = initialProps;
  let value: ReturnType<typeof useWorkspaceContextHarnessRuntime>;
  function Harness() {
    value = useWorkspaceContextHarnessRuntime(currentProps);
    return null;
  }
  function rerender(props: Props) {
    currentProps = props;
    act(() => root.render(<Harness />));
  }
  rerender(initialProps);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return {
    result: {
      get current() {
        return value;
      },
    },
    rerender,
  };
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

describe("workspace Harness", () => {
  it("保留审批提醒、面板切换与工作区关闭的生命周期", () => {
    const { result, rerender } = renderHook(initial);
    expect(result.current.harnessPanelVisible).toBe(false);
    expect(result.current.showHarnessToggle).toBe(true);
    rerender({
      ...initial,
      harnessState: {
        pendingApprovals: [{ id: "approval-1" }],
        hasSignals: true,
      },
    });
    expect(result.current.harnessPendingCount).toBe(1);
    expect(result.current.harnessAttentionLevel).toBe("warning");
    act(() => result.current.handleToggleHarnessPanel());
    expect(result.current.navbarHarnessPanelVisible).toBe(true);
    rerender({ ...initial, enabled: false });
    expect(result.current.harnessPanelVisible).toBe(false);
    expect(result.current.showHarnessToggle).toBe(false);
  });

  it("运行中使用真实消息状态，结束后清除活动标题", () => {
    const messages = [
      {
        id: "message-1",
        role: "assistant",
        content: "",
        timestamp: new Date(),
        runtimeStatus: { title: "正在读取文件" },
      },
    ] as Message[];
    const { result, rerender } = renderHook({
      ...initial,
      messages,
      isSending: true,
    });
    expect(result.current.activeRuntimeStatusTitle).toBe("正在读取文件");
    expect(result.current.harnessAttentionLevel).toBe("active");
    rerender({ ...initial, messages, isSending: false });
    expect(result.current.activeRuntimeStatusTitle).toBeNull();
    expect(result.current.harnessAttentionLevel).toBe("idle");
  });
});
