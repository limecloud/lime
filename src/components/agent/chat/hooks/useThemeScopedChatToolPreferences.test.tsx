import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  saveChatToolPreferences,
  type ChatToolPreferences,
} from "../utils/chatToolPreferences";
import { useThemeScopedChatToolPreferences } from "./useThemeScopedChatToolPreferences";

interface HookHarness {
  getValue: () => ReturnType<typeof useThemeScopedChatToolPreferences>;
  rerender: (activeTheme: string) => void;
  unmount: () => void;
}

interface MountHookOptions {
  scopeId?: string | null;
  sessionSync?: {
    getSessionId: () => string | null;
    setSessionRecentPreferences: (
      sessionId: string,
      preferences: ChatToolPreferences,
    ) => Promise<void>;
  };
}

function mountHook(
  initialTheme: string,
  options: MountHookOptions = {},
): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useThemeScopedChatToolPreferences> | null =
    null;

  function TestComponent({ activeTheme }: { activeTheme: string }) {
    hookValue = useThemeScopedChatToolPreferences(activeTheme, options);
    return null;
  }

  const render = (activeTheme: string) => {
    act(() => {
      root.render(<TestComponent activeTheme={activeTheme} />);
    });
  };

  render(initialTheme);

  return {
    getValue: () => {
      if (!hookValue) {
        throw new Error("hook 尚未初始化");
      }
      return hookValue;
    },
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useThemeScopedChatToolPreferences", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("应按当前主题读取工具偏好", () => {
    saveChatToolPreferences(
      { webSearch: true, thinking: false, task: true, subagent: false },
      "general",
    );

    const harness = mountHook("general");

    try {
      expect(harness.getValue().chatToolPreferences).toEqual({
        webSearch: true,
        thinking: false,
        task: true,
        subagent: false,
      });
    } finally {
      harness.unmount();
    }
  });

  it("切换主题时应切换作用域，并在更新后持久化当前主题", () => {
    saveChatToolPreferences(
      { webSearch: true, thinking: false, task: false, subagent: false },
      "general",
    );
    saveChatToolPreferences(
      { webSearch: false, thinking: true, task: true, subagent: true },
      "general",
    );

    const harness = mountHook("general");

    try {
      harness.rerender("general");
      expect(harness.getValue().chatToolPreferences).toEqual({
        webSearch: false,
        thinking: true,
        task: true,
        subagent: true,
      });

      act(() => {
        harness.getValue().setChatToolPreferences({
          webSearch: true,
          thinking: true,
          task: false,
          subagent: true,
        });
      });

      expect(
        JSON.parse(
          localStorage.getItem("lime.chat.tool_preferences.general.v3") ||
            "null",
        ),
      ).toEqual({
        webSearch: true,
        thinking: true,
        task: false,
        subagent: true,
      });
    } finally {
      harness.unmount();
    }
  });

  it("收到 runtime 快照时应优先回灌工具偏好", () => {
    saveChatToolPreferences(
      { webSearch: false, thinking: false, task: true, subagent: false },
      "general",
    );

    const harness = mountHook("general");

    try {
      act(() => {
        harness.getValue().syncChatToolPreferencesSource("general", {
          webSearch: true,
          thinking: true,
          task: false,
          subagent: true,
        });
      });

      expect(harness.getValue().chatToolPreferences).toEqual({
        webSearch: true,
        thinking: true,
        task: false,
        subagent: true,
      });
      expect(
        JSON.parse(
          localStorage.getItem("lime.chat.tool_preferences.general.v3") ||
            "null",
        ),
      ).toEqual({
        webSearch: true,
        thinking: true,
        task: false,
        subagent: true,
      });
    } finally {
      harness.unmount();
    }
  });

  it("相同 runtime 快照不应覆盖用户手动切换的偏好", () => {
    const harness = mountHook("general");

    try {
      act(() => {
        harness.getValue().syncChatToolPreferencesSource("general", {
          webSearch: true,
          thinking: false,
          task: false,
          subagent: false,
        });
      });
      act(() => {
        harness.getValue().setChatToolPreferences({
          webSearch: false,
          thinking: true,
          task: true,
          subagent: true,
        });
      });
      act(() => {
        harness.getValue().syncChatToolPreferencesSource("general", {
          webSearch: true,
          thinking: false,
          task: false,
          subagent: false,
        });
      });

      expect(harness.getValue().chatToolPreferences).toEqual({
        webSearch: false,
        thinking: true,
        task: true,
        subagent: true,
      });
    } finally {
      harness.unmount();
    }
  });

  it("同一作用域下晚到 runtime 快照不应覆盖用户手动切换的偏好", () => {
    const harness = mountHook("general", {
      scopeId: "project-1",
    });

    try {
      act(() => {
        harness.getValue().setChatToolPreferences({
          webSearch: false,
          thinking: true,
          task: true,
          subagent: false,
        });
      });
      act(() => {
        harness.getValue().syncChatToolPreferencesSource("general", {
          webSearch: true,
          thinking: false,
          task: false,
          subagent: true,
        });
      });

      expect(harness.getValue().chatToolPreferences).toEqual({
        webSearch: false,
        thinking: true,
        task: true,
        subagent: false,
      });
    } finally {
      harness.unmount();
    }
  });

  it("用户手动切换工具偏好时应回写当前会话 recent_preferences", async () => {
    const setSessionRecentPreferences = vi.fn().mockResolvedValue(undefined);
    const harness = mountHook("general", {
      sessionSync: {
        getSessionId: () => "session-42",
        setSessionRecentPreferences,
      },
    });

    try {
      act(() => {
        harness.getValue().setChatToolPreferences((previous) => ({
          ...previous,
          thinking: true,
          subagent: true,
        }));
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(setSessionRecentPreferences).toHaveBeenCalledTimes(1);
      expect(setSessionRecentPreferences).toHaveBeenCalledWith("session-42", {
        webSearch: false,
        thinking: true,
        task: false,
        subagent: true,
      });
    } finally {
      harness.unmount();
    }
  });

  it("runtime 回灌工具偏好时不应反向回写当前会话", async () => {
    const setSessionRecentPreferences = vi.fn().mockResolvedValue(undefined);
    const harness = mountHook("general", {
      sessionSync: {
        getSessionId: () => "session-99",
        setSessionRecentPreferences,
      },
    });

    try {
      act(() => {
        harness.getValue().syncChatToolPreferencesSource("general", {
          webSearch: true,
          thinking: true,
          task: true,
          subagent: false,
        });
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(setSessionRecentPreferences).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("session recent_preferences 回写成功后应暴露已同步快照", async () => {
    const setSessionRecentPreferences = vi.fn().mockResolvedValue(undefined);
    const harness = mountHook("general", {
      sessionSync: {
        getSessionId: () => "session-sync-1",
        setSessionRecentPreferences,
      },
    });

    try {
      act(() => {
        harness.getValue().setChatToolPreferences({
          webSearch: true,
          thinking: true,
          task: false,
          subagent: true,
        });
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        harness
          .getValue()
          .getSyncedSessionRecentPreferences("session-sync-1"),
      ).toEqual({
        webSearch: true,
        thinking: true,
        task: false,
        subagent: true,
      });
    } finally {
      harness.unmount();
    }
  });
});
