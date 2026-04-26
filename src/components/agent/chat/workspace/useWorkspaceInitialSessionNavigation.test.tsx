import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetInitialSessionNavigationDeduplicationForTests,
  useWorkspaceInitialSessionNavigation,
} from "./useWorkspaceInitialSessionNavigation";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

interface ProbeProps {
  currentSessionId?: string | null;
  initialSessionId?: string | null;
  switchTopic: (
    topicId: string,
    options?: {
      forceRefresh?: boolean;
      resumeSessionStartHooks?: boolean;
      allowDetachedSession?: boolean;
    },
  ) => Promise<unknown>;
  resolveInitialSessionSwitch?: (sessionId: string) => {
    forceRefresh?: boolean;
    resumeSessionStartHooks?: boolean;
    allowDetachedSession?: boolean;
    waitForResolution?: boolean;
  } | null;
}

function renderHook(props: ProbeProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe(currentProps: ProbeProps) {
    useWorkspaceInitialSessionNavigation(currentProps);
    return null;
  }

  mountedRoots.push({ root, container });

  act(() => {
    root.render(<Probe {...props} />);
  });

  return {
    rerender(nextProps: ProbeProps) {
      act(() => {
        root.render(<Probe {...nextProps} />);
      });
    },
  };
}

async function flushEffects(times = 3) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

describe("useWorkspaceInitialSessionNavigation", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) {
        continue;
      }

      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetInitialSessionNavigationDeduplicationForTests();
  });

  it("应在初始会话和当前会话不一致时触发恢复", async () => {
    const switchTopic = vi.fn(async () => undefined);

    renderHook({
      initialSessionId: "session-42",
      currentSessionId: null,
      switchTopic,
    });

    await flushEffects();

    expect(switchTopic).toHaveBeenCalledWith("session-42", {
      forceRefresh: true,
    });
  });

  it("当前已经在目标会话时不应重复切换", async () => {
    const switchTopic = vi.fn(async () => undefined);
    renderHook({
      initialSessionId: "session-42",
      currentSessionId: "session-42",
      switchTopic,
    });

    await flushEffects();

    expect(switchTopic).not.toHaveBeenCalled();
  });

  it("切换到新的初始会话时应重新触发恢复", async () => {
    const switchTopic = vi.fn(async () => undefined);
    const mounted = renderHook({
      initialSessionId: "session-42",
      currentSessionId: null,
      switchTopic,
    });

    await flushEffects();

    mounted.rerender({
      initialSessionId: "session-99",
      currentSessionId: "session-42",
      switchTopic,
    });
    await flushEffects();

    expect(switchTopic).toHaveBeenNthCalledWith(1, "session-42", {
      forceRefresh: true,
    });
    expect(switchTopic).toHaveBeenNthCalledWith(2, "session-99", {
      forceRefresh: true,
    });
  });

  it("应透传解析后的初始会话切换选项", async () => {
    const switchTopic = vi.fn(async () => undefined);

    renderHook({
      initialSessionId: "session-archived",
      currentSessionId: null,
      switchTopic,
      resolveInitialSessionSwitch: () => ({
        allowDetachedSession: true,
        forceRefresh: true,
        resumeSessionStartHooks: false,
      }),
    });

    await flushEffects();

    expect(switchTopic).toHaveBeenCalledWith("session-archived", {
      allowDetachedSession: true,
      forceRefresh: true,
    });
  });

  it("等待会话解析期间不应提前切换", async () => {
    const switchTopic = vi.fn(async () => undefined);
    const mounted = renderHook({
      initialSessionId: "session-42",
      currentSessionId: null,
      switchTopic,
      resolveInitialSessionSwitch: () => ({
        waitForResolution: true,
      }),
    });

    await flushEffects();
    expect(switchTopic).not.toHaveBeenCalled();

    mounted.rerender({
      initialSessionId: "session-42",
      currentSessionId: null,
      switchTopic,
      resolveInitialSessionSwitch: () => ({
        forceRefresh: true,
        resumeSessionStartHooks: true,
      }),
    });

    await flushEffects();

    expect(switchTopic).toHaveBeenCalledWith("session-42", {
      forceRefresh: true,
      resumeSessionStartHooks: true,
    });
  });

  it("短时间内重复挂载相同初始会话时应去重", async () => {
    const switchTopic = vi.fn(async () => undefined);

    renderHook({
      initialSessionId: "session-dedupe",
      currentSessionId: null,
      switchTopic,
    });
    await flushEffects();

    renderHook({
      initialSessionId: "session-dedupe",
      currentSessionId: null,
      switchTopic,
    });
    await flushEffects();

    expect(switchTopic).toHaveBeenCalledTimes(1);
    expect(switchTopic).toHaveBeenCalledWith("session-dedupe", {
      forceRefresh: true,
    });
  });
});
