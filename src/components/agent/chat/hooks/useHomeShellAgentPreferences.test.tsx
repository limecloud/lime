import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHomeShellAgentPreferences } from "./useHomeShellAgentPreferences";

interface HookHarness {
  getValue: () => ReturnType<typeof useHomeShellAgentPreferences>;
  rerender: (projectId?: string | null) => void;
  unmount: () => void;
}

function mountHook(initialProjectId?: string | null): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useHomeShellAgentPreferences> | null = null;

  function TestComponent({ projectId }: { projectId?: string | null }) {
    hookValue = useHomeShellAgentPreferences(projectId);
    return null;
  }

  const render = (projectId?: string | null) => {
    act(() => {
      root.render(<TestComponent projectId={projectId} />);
    });
  };

  render(initialProjectId);

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

describe("useHomeShellAgentPreferences", () => {
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

  it("应按项目作用域读取 provider、model 与执行策略", () => {
    localStorage.setItem(
      "agent_pref_provider_project-home-a",
      JSON.stringify("openai"),
    );
    localStorage.setItem(
      "agent_pref_model_project-home-a",
      JSON.stringify("gpt-5-mini"),
    );
    localStorage.setItem(
      "aster_execution_strategy_project-home-a",
      JSON.stringify("auto"),
    );

    const harness = mountHook("project-home-a");

    try {
      expect(harness.getValue().providerType).toBe("openai");
      expect(harness.getValue().model).toBe("gpt-5-mini");
      expect(harness.getValue().executionStrategy).toBe("auto");
    } finally {
      harness.unmount();
    }
  });

  it("切换项目时应重载对应偏好，并把变更写回当前作用域", () => {
    localStorage.setItem(
      "agent_pref_provider_project-home-a",
      JSON.stringify("openai"),
    );
    localStorage.setItem(
      "agent_pref_model_project-home-a",
      JSON.stringify("gpt-5-mini"),
    );
    localStorage.setItem(
      "aster_execution_strategy_project-home-a",
      JSON.stringify("auto"),
    );
    localStorage.setItem(
      "agent_pref_provider_project-home-b",
      JSON.stringify("claude"),
    );
    localStorage.setItem(
      "agent_pref_model_project-home-b",
      JSON.stringify("claude-sonnet-4-5"),
    );

    const harness = mountHook("project-home-a");

    try {
      harness.rerender("project-home-b");

      expect(harness.getValue().providerType).toBe("claude");
      expect(harness.getValue().model).toBe("claude-sonnet-4-5");
      expect(harness.getValue().executionStrategy).toBe("react");

      act(() => {
        harness.getValue().setProviderType("gemini");
        harness.getValue().setModel("gemini-2.5-pro");
        harness.getValue().setExecutionStrategy("code_orchestrated");
      });

      expect(
        JSON.parse(
          localStorage.getItem("agent_pref_provider_project-home-b") || "null",
        ),
      ).toBe("gemini");
      expect(
        JSON.parse(
          localStorage.getItem("agent_pref_model_project-home-b") || "null",
        ),
      ).toBe("gemini-2.5-pro");
      expect(
        JSON.parse(
          localStorage.getItem(
            "aster_execution_strategy_project-home-b",
          ) || "null",
        ),
      ).toBe("code_orchestrated");
    } finally {
      harness.unmount();
    }
  });
});
