import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveChatToolPreferences } from "../utils/chatToolPreferences";
import { useThemeScopedChatToolPreferences } from "./useThemeScopedChatToolPreferences";

interface HookHarness {
  getValue: () => ReturnType<typeof useThemeScopedChatToolPreferences>;
  rerender: (activeTheme: string) => void;
  unmount: () => void;
}

function mountHook(initialTheme: string): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useThemeScopedChatToolPreferences> | null =
    null;

  function TestComponent({ activeTheme }: { activeTheme: string }) {
    hookValue = useThemeScopedChatToolPreferences(activeTheme);
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
      "social-media",
    );

    const harness = mountHook("general");

    try {
      harness.rerender("social-media");
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
          localStorage.getItem("lime.chat.tool_preferences.social-media.v3") ||
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
});
