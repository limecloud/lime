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
          source: "builtin",
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
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
            source: "builtin",
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
      consoleWarnSpy.mockRestore();
      harness.unmount();
    }
  });

  it("ephemeral Team 不应写入项目级或本地持久化", async () => {
    const persistSpy = vi.fn().mockResolvedValue(undefined);
    const ephemeralTeam: TeamDefinition = {
      id: "ephemeral-team-generated",
      source: "ephemeral",
      label: "当前 Team",
      description: "仅当前会话使用",
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

  it("recent team runtime 应优先 hydrate，并把 custom Team 降级成可回退的影子缓存", async () => {
    const syncSpy = vi.fn().mockResolvedValue(undefined);
    const harness = mountHook("general", {
      runtimeSelection: {
        disabled: false,
        theme: "general",
        preferredTeamPresetId: "code-triage-team",
        selectedTeamId: "custom-team-1",
        selectedTeamSource: "custom",
        selectedTeamLabel: "前端联调团队",
        selectedTeamDescription: "分析、实现、验证三段式推进。",
        selectedTeamRoles: [
          {
            id: "explorer",
            label: "分析",
            summary: "负责定位问题与影响范围。",
            profileId: "code-explorer",
            roleKey: "explorer",
            skillIds: ["repo-exploration"],
          },
        ],
      },
      sessionSync: {
        getSessionId: () => "session-1",
        setSessionRecentTeamSelection: syncSpy,
      },
    });

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam?.id).toBe("custom-team-1");
      expect(harness.getValue().selectedTeam?.label).toBe("前端联调团队");
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "custom-team-1",
        source: "custom",
      });

      harness.rerender("general", {
        runtimeSelection: null,
        sessionSync: {
          getSessionId: () => "session-1",
          setSessionRecentTeamSelection: syncSpy,
        },
      });
      await flushEffects();

      expect(harness.getValue().selectedTeam?.id).toBe("custom-team-1");
      expect(harness.getValue().selectedTeam?.label).toBe("前端联调团队");
    } finally {
      harness.unmount();
    }
  });

  it("当前 repo 的 shadow snapshot 应优先于全局 localStorage Team", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    const researchTeam = createTeamDefinitionFromPreset(
      "research-team",
    ) as TeamDefinition;

    persistSelectedTeam(engineeringTeam, "general");

    const harness = mountHook("general", {
      runtimeSelection: null,
      shadowSnapshot: {
        repoScope: "/tmp/lime-shadow-repo",
        entries: {
          "team.selection": {
            key: "team.selection",
            content: [
              "主题：general",
              "会话：session-shadow",
              `Team：${researchTeam.label}`,
              "来源：builtin",
              "预设：research-team",
              `说明：${researchTeam.description}`,
              "角色：",
              ...researchTeam.roles.map(
                (role) => `- ${role.label}：${role.summary}`,
              ),
            ].join("\n"),
            updatedAt: Date.now(),
          },
        },
      },
    });

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam?.id).toBe("research-team");
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "code-triage-team",
        source: "builtin",
      });
    } finally {
      harness.unmount();
    }
  });

  it("repo-scoped 模式首次进入时不应回退到全局 theme localStorage Team", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    persistSelectedTeam(engineeringTeam, "general");

    const harness = mountHook("general", {
      runtimeSelection: null,
      allowPersistedThemeFallback: false,
    });

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam).toBeNull();
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "code-triage-team",
        source: "builtin",
      });
    } finally {
      harness.unmount();
    }
  });

  it("repo-scoped 模式手动切 Team 时不应覆盖全局 theme localStorage 选择", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    const researchTeam = createTeamDefinitionFromPreset(
      "research-team",
    ) as TeamDefinition;
    persistSelectedTeam(engineeringTeam, "general");

    const harness = mountHook("general", {
      allowPersistedThemeFallback: false,
    });

    try {
      await flushEffects();

      act(() => {
        harness.getValue().setSelectedTeam(researchTeam);
      });
      await flushEffects();

      expect(harness.getValue().selectedTeam?.id).toBe("research-team");
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "code-triage-team",
        source: "builtin",
      });
    } finally {
      harness.unmount();
    }
  });

  it("runtime 明确 disabled 时应清空当前 Team 与本地影子缓存", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    persistSelectedTeam(engineeringTeam, "general");

    const harness = mountHook("general", {
      runtimeSelection: {
        disabled: true,
        theme: "general",
      },
      sessionSync: {
        getSessionId: () => "session-1",
        setSessionRecentTeamSelection: vi.fn().mockResolvedValue(undefined),
      },
    });

    try {
      await flushEffects();
      expect(harness.getValue().selectedTeam).toBeNull();
      expect(loadSelectedTeamReference("general")).toBeNull();
    } finally {
      harness.unmount();
    }
  });

  it("手动切换 Team 时应回写当前会话 recent_team_selection", async () => {
    const researchTeam = createTeamDefinitionFromPreset(
      "research-team",
    ) as TeamDefinition;
    const syncSpy = vi.fn().mockResolvedValue(undefined);
    const harness = mountHook("general", {
      sessionSync: {
        getSessionId: () => "session-1",
        setSessionRecentTeamSelection: syncSpy,
      },
    });

    try {
      await flushEffects();
      syncSpy.mockClear();

      act(() => {
        harness.getValue().setSelectedTeam(researchTeam);
      });
      await flushEffects();

      expect(syncSpy).toHaveBeenCalledWith("session-1", researchTeam, "general");
      expect(loadSelectedTeamReference("general")).toEqual({
        id: "research-team",
        source: "builtin",
      });
    } finally {
      harness.unmount();
    }
  });

  it("同一 session 用户手动切换后，晚到 runtime 不应覆盖当前 Team", async () => {
    const engineeringTeam = createTeamDefinitionFromPreset(
      "code-triage-team",
    ) as TeamDefinition;
    const researchTeam = createTeamDefinitionFromPreset(
      "research-team",
    ) as TeamDefinition;
    const syncSpy = vi.fn().mockResolvedValue(undefined);
    const sessionSync = {
      getSessionId: () => "session-1",
      setSessionRecentTeamSelection: syncSpy,
    };
    const harness = mountHook("general", {
      runtimeSelection: null,
      sessionSync,
    });

    try {
      await flushEffects();
      syncSpy.mockClear();

      act(() => {
        harness.getValue().setSelectedTeam(researchTeam);
      });
      await flushEffects();

      harness.rerender("general", {
        runtimeSelection: {
          disabled: false,
          theme: "general",
          selectedTeamId: engineeringTeam.id,
          selectedTeamSource: "builtin",
          selectedTeamLabel: engineeringTeam.label,
          selectedTeamDescription: engineeringTeam.description,
          selectedTeamRoles: engineeringTeam.roles,
        },
        sessionSync,
      });
      await flushEffects();

      expect(harness.getValue().selectedTeam?.id).toBe("research-team");
      expect(syncSpy).toHaveBeenCalledWith("session-1", researchTeam, "general");
    } finally {
      harness.unmount();
    }
  });
});
