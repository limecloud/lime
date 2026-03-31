import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTeamMemorySnapshot } from "@/lib/teamMemorySync";
import type {
  AsterSubagentParentContext,
  AsterSubagentSessionInfo,
} from "@/lib/api/agentRuntime";
import type { TeamDefinition } from "../utils/teamDefinitions";
import { useTeamMemoryShadowSync } from "./useTeamMemoryShadowSync";

interface MemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface HookHarness {
  rerender: (options: HookOptions) => void;
  unmount: () => void;
}

interface HookOptions {
  repoScope?: string | null;
  activeTheme?: string | null;
  sessionId?: string | null;
  selectedTeam?: TeamDefinition | null;
  childSubagentSessions?: AsterSubagentSessionInfo[];
  subagentParentContext?: AsterSubagentParentContext | null;
  storage: MemoryStorage;
}

function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function mountHook(initialOptions: HookOptions): HookHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function TestComponent({ options }: { options: HookOptions }) {
    useTeamMemoryShadowSync(options);
    return null;
  }

  const render = (options: HookOptions) => {
    act(() => {
      root.render(<TestComponent options={options} />);
    });
  };

  render(initialOptions);

  return {
    rerender: render,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function createSelectedTeam(): TeamDefinition {
  return {
    id: "team-research",
    source: "builtin",
    label: "研究双人组",
    description: "负责梳理主线、拆分并验证关键任务。",
    presetId: "research-team",
    roles: [
      {
        id: "researcher",
        label: "研究员",
        summary: "整理上下文和证据。",
      },
      {
        id: "executor",
        label: "执行员",
        summary: "把方案落到代码与验证。",
      },
    ],
  };
}

describe("useTeamMemoryShadowSync", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("应把 Team 选择与子代理概览写入 repo 作用域快照", () => {
    const storage = createMemoryStorage();
    const harness = mountHook({
      storage,
      repoScope: "/tmp/repo",
      activeTheme: "general",
      sessionId: "session-a",
      selectedTeam: createSelectedTeam(),
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究代理",
          created_at: 1,
          updated_at: 2,
          session_type: "sub_agent",
          runtime_status: "running",
          latest_turn_status: "running",
          role_hint: "explorer",
          task_summary: "梳理主线风险",
        },
      ],
      subagentParentContext: {
        parent_session_id: "parent-1",
        parent_session_name: "父会话",
        role_hint: "reviewer",
        task_summary: "汇总团队结论",
        sibling_subagent_sessions: [
          {
            id: "sibling-1",
            name: "实现代理",
            created_at: 1,
            updated_at: 3,
            session_type: "sub_agent",
            runtime_status: "queued",
            latest_turn_status: "queued",
            task_summary: "等待串行执行",
          },
        ],
      },
    });

    try {
      const snapshot = readTeamMemorySnapshot(storage, "/tmp/repo");
      expect(snapshot?.entries["team.selection"]?.content).toContain(
        "Team：研究双人组",
      );
      expect(snapshot?.entries["team.selection"]?.content).toContain(
        "角色：",
      );
      expect(snapshot?.entries["team.subagents"]?.content).toContain(
        "研究代理 [running] explorer · 梳理主线风险",
      );
      expect(snapshot?.entries["team.parent_context"]?.content).toContain(
        "父会话：父会话",
      );
      expect(snapshot?.entries["team.parent_context"]?.content).toContain(
        "实现代理 [queued] 等待串行执行",
      );
    } finally {
      harness.unmount();
    }
  });

  it("应在运行态清空后移除团队条目，但保留无关 memory", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      "lime:team-memory:/tmp/repo",
      JSON.stringify({
        repoScope: "/tmp/repo",
        entries: {
          keep: {
            key: "keep",
            content: "保留的外部约定",
            updatedAt: 1,
          },
        },
      }),
    );

    const harness = mountHook({
      storage,
      repoScope: "/tmp/repo",
      activeTheme: "general",
      sessionId: "session-a",
      selectedTeam: createSelectedTeam(),
      childSubagentSessions: [
        {
          id: "child-1",
          name: "研究代理",
          created_at: 1,
          updated_at: 2,
          session_type: "sub_agent",
        },
      ],
      subagentParentContext: null,
    });

    try {
      harness.rerender({
        storage,
        repoScope: "/tmp/repo",
        activeTheme: "general",
        sessionId: "session-a",
        selectedTeam: null,
        childSubagentSessions: [],
        subagentParentContext: null,
      });

      const snapshot = readTeamMemorySnapshot(storage, "/tmp/repo");
      expect(snapshot?.entries.keep?.content).toBe("保留的外部约定");
      expect(snapshot?.entries["team.selection"]).toBeUndefined();
      expect(snapshot?.entries["team.subagents"]).toBeUndefined();
      expect(snapshot?.entries["team.parent_context"]).toBeUndefined();
    } finally {
      harness.unmount();
    }
  });
});
