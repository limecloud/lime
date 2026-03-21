import { act } from "react";
import { createRoot } from "react-dom/client";
import type { WorkspaceSettings } from "@/types/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamDefinition } from "../utils/teamDefinitions";
import { createTeamDefinitionFromPreset } from "../utils/teamDefinitions";
import { useSelectedTeamPreference } from "./useSelectedTeamPreference";
import {
  loadSelectedTeamReference,
  persistSelectedTeam,
} from "../utils/teamStorage";

type HookOptions = Parameters<typeof useSelectedTeamPreference>[1];

interface HookHarness {
  getValue: () => ReturnType<typeof useSelectedTeamPreference>;
  rerender: (theme?: string | null, options?: HookOptions) => void;
  unmount: () => void;
}

function mountHook(
  initialTheme?: string | null,
  initialOptions?: HookOptions,
): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let hookValue: ReturnType<typeof useSelectedTeamPreference> | null = null;

  function TestComponent({
    theme,
    options,
  }: {
    theme?: string | null;
    options?: HookOptions;
  }) {
    hookValue = useSelectedTeamPreference(theme, options);
    return null;
  }

  const render = (theme?: string | null, options?: HookOptions) => {
    act(() => {
      root.render(<TestComponent theme={theme} options={options} />);
    });
  };

  render(initialTheme, initialOptions);

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

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSelectedTeamPreference", () => {
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

  it("切换 theme 时应读取对应 Team，而不是把旧主题选择写回新主题", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    const researchTeam = createTeamDefinitionFromPreset(
      "research-team",
    ) as TeamDefinition;

    persistSelectedTeam(engineeringTeam, "general");
    persistSelectedTeam(researchTeam, "knowledge");

    const harness = mountHook("general");

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam?.id).toBe("code-triage-team");

      harness.rerender("knowledge");
      await flushEffects();

      expect(harness.getValue().selectedTeam?.id).toBe("research-team");
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "code-triage-team",
        source: "builtin",
      });
      expect(loadSelectedTeamReference("knowledge")).toEqual({
        id: "research-team",
        source: "builtin",
      });

      act(() => {
        harness.getValue().setSelectedTeam(null);
      });

      expect(loadSelectedTeamReference("knowledge")).toBeNull();
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "code-triage-team",
        source: "builtin",
      });
    } finally {
      harness.unmount();
    }
  });

  it("项目级 Team 偏好应优先于 localStorage，并通过回调持久化", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    const researchTeam = createTeamDefinitionFromPreset(
      "research-team",
    ) as TeamDefinition;
    const projectSettings: WorkspaceSettings = {
      agentTeam: {
        selectedTeam: {
          id: engineeringTeam.id,
          source: engineeringTeam.source,
        },
      },
    };
    const persistSpy = vi.fn().mockResolvedValue(undefined);

    persistSelectedTeam(researchTeam, "general");

    const harness = mountHook("general", {
      projectSettings,
      onPersistSelectedTeam: persistSpy,
    });

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam?.id).toBe("code-triage-team");

      act(() => {
        harness.getValue().setSelectedTeam(null);
      });
      await flushEffects();

      expect(persistSpy).toHaveBeenCalledWith(null);
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "research-team",
        source: "builtin",
      });
    } finally {
      harness.unmount();
    }
  });

  it("项目级自定义 Team 应能直接解析为当前选择", async () => {
    const harness = mountHook("general", {
      projectSettings: {
        agentTeam: {
          selectedTeam: {
            id: "custom-team-project-1",
            source: "custom",
          },
          customTeams: [
            {
              id: "custom-team-project-1",
              label: "前端联调团队",
              description: "分析、实现、验证三段式推进。",
              roles: [
                {
                  id: "planner",
                  label: "分析",
                  summary: "负责拆解问题与确认边界。",
                  profileId: "code-explorer",
                  roleKey: "explorer",
                  skillIds: ["source-grounding"],
                },
              ],
            },
          ],
        },
      },
    });

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam?.id).toBe("custom-team-project-1");
      expect(harness.getValue().selectedTeam?.label).toBe("前端联调团队");
      expect(harness.getValue().selectedTeam?.source).toBe("custom");
      expect(harness.getValue().selectedTeam?.roles[0]?.profileId).toBe(
        "code-explorer",
      );
    } finally {
      harness.unmount();
    }
  });

  it("项目级持久化失败时应回滚到当前项目 Team", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    const researchTeam = createTeamDefinitionFromPreset(
      "research-team",
    ) as TeamDefinition;
    const persistSpy = vi.fn().mockRejectedValue(new Error("save failed"));

    const harness = mountHook("general", {
      projectSettings: {
        agentTeam: {
          selectedTeam: {
            id: engineeringTeam.id,
            source: engineeringTeam.source,
          },
        },
      },
      onPersistSelectedTeam: persistSpy,
    });

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam?.id).toBe("code-triage-team");

      act(() => {
        harness.getValue().setSelectedTeam(researchTeam);
      });
      await flushEffects();

      expect(persistSpy).toHaveBeenCalledWith(researchTeam);
      expect(harness.getValue().selectedTeam?.id).toBe("code-triage-team");
    } finally {
      harness.unmount();
    }
  });

  it("ephemeral Team 不应写入项目级或本地持久化", async () => {
    const persistSpy = vi.fn().mockResolvedValue(undefined);
    const ephemeralTeam: TeamDefinition = {
      id: "ephemeral-team-generated",
      source: "ephemeral",
      label: "本轮 Team",
      description: "仅本轮会话使用",
      roles: [
        {
          id: "planner",
          label: "分析",
          summary: "负责拆解任务。",
        },
      ],
    };
    const harness = mountHook("general", {
      projectSettings: {
        agentTeam: {
          selectedTeam: {
            id: "code-triage-team",
            source: "builtin",
          },
        },
      },
      onPersistSelectedTeam: persistSpy,
    });

    try {
      await flushEffects();
      act(() => {
        harness.getValue().setSelectedTeam(ephemeralTeam);
      });
      await flushEffects();

      expect(harness.getValue().selectedTeam?.id).toBe(
        "ephemeral-team-generated",
      );
      expect(persistSpy).not.toHaveBeenCalled();
      expect(loadSelectedTeamReference("general")).toBeNull();
    } finally {
      harness.unmount();
    }
  });
});
