import { act, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskCenterDraftSendRequest } from "../homePendingPreview";
import {
  useTaskCenterHomeChromeRuntime,
  type TaskCenterHomeChromeRuntime,
} from "./useTaskCenterHomeChromeRuntime";

interface HarnessProps {
  sessionId?: string | null;
  detachedTopicId?: string | null;
  transitionTopicId?: string | null;
  displayMessageCount?: number;
  threadItemCount?: number;
  draftSendRequest?: TaskCenterDraftSendRequest | null;
  hasLocalSessionOverride?: boolean;
  isHomeSessionBackgroundRecovery?: boolean;
  embeddedHomeSessionIds?: ReadonlySet<string>;
  shouldUseBrowserWorkspaceHomeChrome?: boolean;
  harnessPanelVisible?: boolean;
  setHarnessPanelVisible?: Dispatch<SetStateAction<boolean>>;
  clearEmbeddedHomeSession?: (sessionId: string) => void;
}

let container: HTMLDivElement;
let root: Root;
let latestRuntime: TaskCenterHomeChromeRuntime | null = null;

function Harness({
  sessionId = "topic-a",
  detachedTopicId = null,
  transitionTopicId = null,
  displayMessageCount = 0,
  threadItemCount = 0,
  draftSendRequest = null,
  hasLocalSessionOverride = false,
  isHomeSessionBackgroundRecovery = false,
  embeddedHomeSessionIds = new Set(),
  shouldUseBrowserWorkspaceHomeChrome = false,
  harnessPanelVisible = false,
  setHarnessPanelVisible = () => undefined,
  clearEmbeddedHomeSession = () => undefined,
}: HarnessProps) {
  latestRuntime = useTaskCenterHomeChromeRuntime({
    agentEntry: "conversation",
    sessionId,
    detachedTopicId,
    transitionTopicId,
    draftSurfaceActive: false,
    shouldSuppressDraftContent: false,
    draftSendRequest,
    normalizedInitialSessionId: null,
    isHomeSessionBackgroundRecovery,
    displayMessageCount,
    threadItemCount,
    hasPendingA2UIForm: false,
    isPreparingSend: false,
    isSending: false,
    isHomePendingPreviewActive: false,
    queuedTurnCount: 0,
    hasLocalSessionOverride,
    embeddedHomeSessionIds,
    isAutoRestoringSession: false,
    isSessionHydrating: false,
    shouldUseBrowserWorkspaceHomeChrome,
    harnessPanelVisible,
    setHarnessPanelVisible,
    clearEmbeddedHomeSession,
  });
  return null;
}

function renderHarness(props?: HarnessProps): TaskCenterHomeChromeRuntime {
  act(() => {
    root.render(<Harness {...props} />);
  });
  if (!latestRuntime) {
    throw new Error("hook 尚未初始化");
  }
  return latestRuntime;
}

describe("useTaskCenterHomeChromeRuntime", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latestRuntime = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
    latestRuntime = null;
  });

  it("embedded home 会话出现真实内容后应清理首页占位标记", () => {
    const clearEmbeddedHomeSession = vi.fn();

    renderHarness({
      sessionId: "topic-a",
      displayMessageCount: 1,
      embeddedHomeSessionIds: new Set(["topic-a"]),
      clearEmbeddedHomeSession,
    });

    expect(clearEmbeddedHomeSession).toHaveBeenCalledWith("topic-a");
  });

  it("本地物化会话应保留为首页 chrome 的前台会话活动", () => {
    const clearEmbeddedHomeSession = vi.fn();
    const runtime = renderHarness({
      sessionId: "topic-a",
      hasLocalSessionOverride: true,
      isHomeSessionBackgroundRecovery: true,
      embeddedHomeSessionIds: new Set(["topic-a"]),
      clearEmbeddedHomeSession,
    });

    expect(runtime.hasHomeConversationActivity).toBe(true);
    expect(runtime.shouldRenderTaskCenterEmbeddedHome).toBe(false);
    expect(
      runtime.taskCenterHomeSurfaceState.shouldHideCurrentSessionContent,
    ).toBe(false);
    expect(runtime.taskCenterHomeSurfaceState.sceneSessionId).toBe("topic-a");
    expect(clearEmbeddedHomeSession).toHaveBeenCalledWith("topic-a");
  });

  it("首页 chrome 隐藏导航工具动作时应同步关闭 harness 面板", () => {
    const setHarnessPanelVisible = vi.fn();
    const runtime = renderHarness({
      shouldUseBrowserWorkspaceHomeChrome: true,
      harnessPanelVisible: true,
      setHarnessPanelVisible,
    });

    expect(runtime.suppressHomeNavbarUtilityActions).toBe(true);
    expect(setHarnessPanelVisible).toHaveBeenCalledWith(false);
  });

  it("切换中的话题应作为 tab 预览目标并标记 session switch pending", () => {
    const runtime = renderHarness({
      sessionId: "topic-a",
      transitionTopicId: "topic-b",
    });

    expect(runtime.taskCenterPreviewTopicId).toBe("topic-b");
    expect(runtime.taskCenterSessionSwitchPending).toBe(true);
  });
});
