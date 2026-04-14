import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRuntimeStrip } from "./AgentRuntimeStrip";
import type { HarnessSessionState } from "../utils/harnessState";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function createHarnessState(
  overrides: Partial<HarnessSessionState> = {},
): HarnessSessionState {
  return {
    runtimeStatus: null,
    pendingApprovals: [],
    latestContextTrace: [],
    plan: {
      phase: "idle",
      items: [],
    },
    activity: {
      planning: 0,
      filesystem: 0,
      execution: 0,
      web: 0,
      skills: 0,
      delegation: 0,
    },
    delegatedTasks: [],
    outputSignals: [],
    activeFileWrites: [],
    recentFileEvents: [],
    hasSignals: false,
    ...overrides,
  };
}

function renderStrip(
  props: Partial<ComponentProps<typeof AgentRuntimeStrip>> = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AgentRuntimeStrip
        activeTheme="general"
        toolPreferences={{
          webSearch: true,
          thinking: true,
          task: true,
          subagent: true,
        }}
        runtimeToolAvailability={{
          source: "runtime_tools",
          known: true,
          agentInitialized: true,
          availableToolCount: 4,
          webSearch: false,
          subagentCore: false,
          subagentTeamTools: false,
          subagentRuntime: false,
          taskRuntime: false,
          missingSubagentCoreTools: ["Agent", "SendMessage"],
          missingSubagentTeamTools: ["TeamCreate", "TeamDelete", "ListPeers"],
          missingTaskTools: [
            "TaskCreate",
            "TaskGet",
            "TaskList",
            "TaskUpdate",
            "TaskOutput",
            "TaskStop",
          ],
        }}
        harnessState={createHarnessState()}
        {...props}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("AgentRuntimeStrip", () => {
  it("runtime tool surface 缺口应显示在运行时条上", () => {
    const container = renderStrip();

    expect(
      container.querySelector('[data-testid="agent-runtime-strip"]'),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-runtime_surface"]',
      )?.textContent,
    ).toContain("Runtime 工具面 4 项");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-task_runtime_gap"]',
      )?.textContent,
    ).toContain("任务工具缺 6");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-subagent_runtime_gap"]',
      )?.textContent,
    ).toContain("任务拆分缺 5 个 current tools");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-web_search_gap"]',
      )?.textContent,
    ).toContain("Runtime 未接通 WebSearch");
  });
});
