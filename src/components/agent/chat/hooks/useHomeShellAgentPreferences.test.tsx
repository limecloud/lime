import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockWechatChannelSetRuntimeModel,
  mockListAgentRuntimeSessions,
  mockGetAgentRuntimeSession,
} = vi.hoisted(() => ({
  mockWechatChannelSetRuntimeModel: vi.fn(async () => undefined),
  mockListAgentRuntimeSessions: vi.fn(),
  mockGetAgentRuntimeSession: vi.fn(),
}));

vi.mock("@/lib/api/channelsRuntime", () => ({
  wechatChannelSetRuntimeModel: mockWechatChannelSetRuntimeModel,
}));

vi.mock("@/lib/api/agentRuntime", () => ({
  listAgentRuntimeSessions: mockListAgentRuntimeSessions,
  getAgentRuntimeSession: mockGetAgentRuntimeSession,
}));

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useHomeShellAgentPreferences", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    mockWechatChannelSetRuntimeModel.mockReset();
    mockListAgentRuntimeSessions.mockReset();
    mockGetAgentRuntimeSession.mockReset();
    mockListAgentRuntimeSessions.mockResolvedValue([]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "session-default",
      created_at: 0,
      updated_at: 0,
      messages: [],
      execution_runtime: null,
    });
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

  it("命中最近 session runtime 时应优先回灌首页 provider、model 与执行策略", async () => {
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
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-other",
        created_at: 1,
        updated_at: 999,
        workspace_id: "project-other",
      },
      {
        id: "session-home-latest",
        created_at: 2,
        updated_at: 200,
        workspace_id: "project-home-a",
        execution_strategy: "code_orchestrated",
      },
      {
        id: "session-home-old",
        created_at: 1,
        updated_at: 100,
        workspace_id: "project-home-a",
        execution_strategy: "react",
      },
    ]);
    mockGetAgentRuntimeSession.mockResolvedValue({
      id: "session-home-latest",
      created_at: 2,
      updated_at: 200,
      execution_strategy: "code_orchestrated",
      messages: [],
      execution_runtime: {
        session_id: "session-home-latest",
        provider_selector: "claude",
        provider_name: "claude",
        model_name: "claude-sonnet-4-5",
        execution_strategy: "code_orchestrated",
        output_schema_runtime: null,
        recent_preferences: null,
        recent_team_selection: {
          disabled: false,
          theme: "general",
          preferredTeamPresetId: "code-triage-team",
          selectedTeamId: "code-triage-team",
          selectedTeamSource: "builtin",
          selectedTeamLabel: "代码排障团队",
        },
        source: "session",
        mode: null,
        latest_turn_id: null,
        latest_turn_status: null,
      },
    });

    const harness = mountHook("project-home-a");

    try {
      await flushAsyncEffects();

      expect(mockListAgentRuntimeSessions).toHaveBeenCalledTimes(1);
      expect(mockGetAgentRuntimeSession).toHaveBeenCalledWith(
        "session-home-latest",
      );
      expect(harness.getValue().providerType).toBe("claude");
      expect(harness.getValue().model).toBe("claude-sonnet-4-5");
      expect(harness.getValue().executionStrategy).toBe("code_orchestrated");
      expect(
        harness.getValue().recentExecutionRuntime?.recent_team_selection
          ?.selectedTeamId,
      ).toBe("code-triage-team");
      expect(
        JSON.parse(
          localStorage.getItem("agent_pref_provider_project-home-a") || "null",
        ),
      ).toBe("claude");
      expect(
        JSON.parse(
          localStorage.getItem("agent_pref_model_project-home-a") || "null",
        ),
      ).toBe("claude-sonnet-4-5");
      expect(
        JSON.parse(
          localStorage.getItem(
            "aster_execution_strategy_project-home-a",
          ) || "null",
        ),
      ).toBe("code_orchestrated");
    } finally {
      harness.unmount();
    }
  });

  it("没有最近 session runtime 时应继续沿用项目本地 fallback", async () => {
    localStorage.setItem(
      "agent_pref_provider_project-home-fallback",
      JSON.stringify("deepseek"),
    );
    localStorage.setItem(
      "agent_pref_model_project-home-fallback",
      JSON.stringify("deepseek-chat"),
    );
    localStorage.setItem(
      "aster_execution_strategy_project-home-fallback",
      JSON.stringify("auto"),
    );
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-other",
        created_at: 1,
        updated_at: 100,
        workspace_id: "project-other",
      },
    ]);

    const harness = mountHook("project-home-fallback");

    try {
      await flushAsyncEffects();

      expect(harness.getValue().providerType).toBe("deepseek");
      expect(harness.getValue().model).toBe("deepseek-chat");
      expect(harness.getValue().executionStrategy).toBe("auto");
      expect(harness.getValue().recentExecutionRuntime).toBeNull();
      expect(mockGetAgentRuntimeSession).not.toHaveBeenCalled();
    } finally {
      harness.unmount();
    }
  });

  it("用户已手动改首页偏好时，不应再被异步 runtime 回灌覆盖", async () => {
    const sessionDetailDeferred = createDeferred<{
      id: string;
      created_at: number;
      updated_at: number;
      execution_strategy: "code_orchestrated";
      messages: [];
      execution_runtime: {
        session_id: string;
        provider_selector: string;
        provider_name: string;
        model_name: string;
        execution_strategy: "code_orchestrated";
        output_schema_runtime: null;
        recent_preferences: null;
        recent_team_selection: {
          disabled: false;
          theme: "general";
          preferredTeamPresetId: "research-team";
          selectedTeamId: "research-team";
          selectedTeamSource: "builtin";
          selectedTeamLabel: "研究协作团队";
        };
        source: "session";
        mode: null;
        latest_turn_id: null;
        latest_turn_status: null;
      };
    }>();
    mockListAgentRuntimeSessions.mockResolvedValue([
      {
        id: "session-home-latest",
        created_at: 2,
        updated_at: 200,
        workspace_id: "project-home-race",
        execution_strategy: "code_orchestrated",
      },
    ]);
    mockGetAgentRuntimeSession.mockReturnValue(sessionDetailDeferred.promise);

    const harness = mountHook("project-home-race");

    try {
      await flushAsyncEffects();

      act(() => {
        harness.getValue().setProviderType("gemini");
        harness.getValue().setModel("gemini-2.5-pro");
        harness.getValue().setExecutionStrategy("auto");
      });

      sessionDetailDeferred.resolve({
        id: "session-home-latest",
        created_at: 2,
        updated_at: 200,
        execution_strategy: "code_orchestrated",
        messages: [],
        execution_runtime: {
          session_id: "session-home-latest",
          provider_selector: "claude",
          provider_name: "claude",
          model_name: "claude-sonnet-4-5",
        execution_strategy: "code_orchestrated",
        output_schema_runtime: null,
        recent_preferences: null,
        recent_team_selection: {
          disabled: false,
          theme: "general",
          preferredTeamPresetId: "research-team",
          selectedTeamId: "research-team",
          selectedTeamSource: "builtin",
          selectedTeamLabel: "研究协作团队",
        },
        source: "session",
        mode: null,
        latest_turn_id: null,
        latest_turn_status: null,
      },
      });

      await flushAsyncEffects();

      expect(harness.getValue().providerType).toBe("gemini");
      expect(harness.getValue().model).toBe("gemini-2.5-pro");
      expect(harness.getValue().executionStrategy).toBe("auto");
      expect(
        harness.getValue().recentExecutionRuntime?.recent_team_selection
          ?.selectedTeamId,
      ).toBe("research-team");
      expect(
        JSON.parse(
          localStorage.getItem("agent_pref_provider_project-home-race") ||
            "null",
        ),
      ).toBe("gemini");
      expect(
        JSON.parse(
          localStorage.getItem("agent_pref_model_project-home-race") || "null",
        ),
      ).toBe("gemini-2.5-pro");
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

  it("更新首页 Claw 模型时应同步微信运行时模型", async () => {
    const harness = mountHook("project-home-sync");

    try {
      await act(async () => {
        harness.getValue().setProviderType("deepseek");
        harness.getValue().setModel("deepseek-reasoner");
        await Promise.resolve();
      });

      expect(mockWechatChannelSetRuntimeModel).toHaveBeenCalledWith({
        providerId: "deepseek",
        modelId: "deepseek-reasoner",
      });
    } finally {
      harness.unmount();
    }
  });
});
