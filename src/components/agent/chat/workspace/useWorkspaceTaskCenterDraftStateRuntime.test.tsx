import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceTaskCenterDraftStateRuntime } from "./useWorkspaceTaskCenterDraftStateRuntime";

type Runtime = ReturnType<typeof useWorkspaceTaskCenterDraftStateRuntime>;

let container: HTMLDivElement;
let root: Root;
let runtime: Runtime | null = null;

function Harness({
  agentEntry = "conversation",
  messagesLength = 0,
  effectiveThreadItemCount = 0,
  resetComposerDraft,
}: {
  agentEntry?: "new-task" | "conversation";
  messagesLength?: number;
  effectiveThreadItemCount?: number;
  resetComposerDraft?: () => void;
}) {
  runtime = useWorkspaceTaskCenterDraftStateRuntime({
    agentEntry,
    deferSessionRecentMetadataSyncForNavigation: () => undefined,
    effectiveThreadItemCount,
    hasInitialSessionTopic: true,
    initialSessionMessagesCount: 2,
    messagesLength,
    normalizedInitialSessionId: "session-history",
    sessionId: "session-history",
    resetComposerDraft,
  });
  return null;
}

function renderHarness(props: Parameters<typeof Harness>[0] = {}): Runtime {
  act(() => {
    root.render(<Harness {...props} />);
  });
  if (!runtime) {
    throw new Error("hook 尚未初始化");
  }
  return runtime;
}

describe("useWorkspaceTaskCenterDraftStateRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    runtime = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    runtime = null;
  });

  it("已有 Turn 元数据但可见历史为空时仍应 hydrate 当前会话", () => {
    expect(renderHarness().shouldHydrateEmptyMatchedInitialSession).toBe(true);
  });

  it("导航前保留草稿，实际提交后才清理 transient scope", () => {
    let resets = 0;
    const resetComposerDraft = () => {
      resets += 1;
    };
    const current = renderHarness({ resetComposerDraft });
    act(() => current.handleBeforeTopicSwitch("session-other"));
    expect(resets).toBe(0);
    act(() => current.handleTopicSwitchCommitted("session-history"));
    expect(resets).toBe(0);
    act(() => current.handleTopicSwitchCommitted("session-other"));
    expect(resets).toBe(1);
    current.taskCenterHomeSurfaceActiveRef.current = true;
    act(() => current.handleTopicSwitchCommitted("session-history"));
    expect(resets).toBe(2);
  });

  it("已有 Message 或 Item 内容时不应重复 hydrate 当前会话", () => {
    expect(
      renderHarness({ messagesLength: 1 })
        .shouldHydrateEmptyMatchedInitialSession,
    ).toBe(false);
    expect(
      renderHarness({ effectiveThreadItemCount: 1 })
        .shouldHydrateEmptyMatchedInitialSession,
    ).toBe(false);
  });

  it("从 new-task 进入 Claw 时应在绘制前清理旧草稿激活状态", () => {
    const newTaskRuntime = renderHarness({ agentEntry: "new-task" });
    newTaskRuntime.taskCenterHomeSurfaceActiveRef.current = true;

    const clawRuntime = renderHarness({ agentEntry: "conversation" });

    expect(clawRuntime.taskCenterHomeSurfaceActiveRef.current).toBe(false);
  });
});
