import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { AgentRuntimeStrip } from "./AgentRuntimeStrip";
import type {
  CanonicalAgentStatus,
  CanonicalChildThreadSummary,
} from "../projection/canonicalChildThreadSummary";
import type { HarnessSessionState } from "../utils/harnessState";
import type { RuntimeToolAvailability } from "../utils/runtimeToolAvailability";

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

const DEFAULT_RUNTIME_TOOL_AVAILABILITY: RuntimeToolAvailability = {
  source: "runtime_tools",
  known: true,
  agentInitialized: true,
  availableToolCount: 4,
  webSearch: false,
  subagentCore: false,
  subagentTeamTools: false,
  subagentRuntime: false,
  planRuntime: false,
  missingSubagentCoreTools: ["Agent", "SendMessage"],
  missingSubagentTeamTools: ["TeamCreate", "TeamDelete", "ListPeers"],
  missingPlanTools: ["update_plan"],
};

const CODE_RUNTIME_TOOL_AVAILABILITY: RuntimeToolAvailability = {
  source: "runtime_tools",
  known: true,
  agentInitialized: true,
  availableToolCount: 12,
  webSearch: true,
  subagentCore: true,
  subagentTeamTools: true,
  subagentRuntime: true,
  planRuntime: true,
  missingSubagentCoreTools: [],
  missingSubagentTeamTools: [],
  missingPlanTools: [],
};

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

function createCanonicalChild(
  status: CanonicalAgentStatus,
  index: number,
): CanonicalChildThreadSummary {
  return {
    name: `child-${index}`,
    parentThreadId: "parent-thread",
    sessionId: `child-session-${index}`,
    status,
    threadId: `child-thread-${index}`,
    updatedAtMs: index,
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
          task: true,
          subagent: true,
        }}
        runtimeToolAvailability={DEFAULT_RUNTIME_TOOL_AVAILABILITY}
        harnessState={createHarnessState()}
        {...props}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");
});

afterEach(async () => {
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
  await changeLimeLocale("en-US");
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
        '[data-testid="agent-runtime-strip-status-plan_runtime_gap"]',
      )?.textContent,
    ).toContain("计划工具缺 1");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-subagent_tool_gap"]',
      )?.textContent,
    ).toContain("Subagents 缺 5 个 current tools");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-web_search_gap"]',
      )?.textContent,
    ).toContain("Runtime 未接通 WebSearch");
  });

  it("current react 应按普通运行时能力展示", () => {
    const container = renderStrip({
      executionRuntime: {
        session_id: "session-react",
        source: "session",
        execution_strategy: "react",
      },
      runtimeToolAvailability: CODE_RUNTIME_TOOL_AVAILABILITY,
      toolPreferences: {
        task: true,
        subagent: true,
      },
    });

    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip"][data-runtime-kind="general"][data-execution-strategy="react"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-capability-web_search"][data-capability-key="web_search"][data-enabled="true"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-runtime_surface"][data-status-key="runtime_surface"]',
      )?.textContent,
    ).toContain("Runtime 工具面 12 项");
    expect(container.querySelector('[data-testid*="code_"]')).toBeNull();
  });

  it("运行时信号应露出待确认与产物出口状态", () => {
    const container = renderStrip({
      runtimeToolAvailability: CODE_RUNTIME_TOOL_AVAILABILITY,
      harnessState: createHarnessState({
        pendingApprovals: [
          {
            requestId: "approval-1",
            actionType: "tool_confirmation",
            toolName: "Edit",
          },
        ],
        outputSignals: [
          {
            id: "output-1",
            toolCallId: "tool-1",
            toolName: "Edit",
            title: "已修改文件",
            summary: "src/main.ts",
          },
        ],
      }),
    });

    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-pending"]',
      )?.textContent,
    ).toContain("等待确认 1");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-outputs"]',
      )?.textContent,
    ).toContain("最近产物 1");
  });

  it("运行时文件快照应露出文件变更审阅入口", () => {
    const onOpenFileCheckpoints = vi.fn();
    const container = renderStrip({
      runtimeToolAvailability: CODE_RUNTIME_TOOL_AVAILABILITY,
      fileCheckpointSummary: {
        count: 2,
        latest_checkpoint: {
          checkpoint_id: "checkpoint-2",
          turn_id: "turn-1",
          path: "src/main.ts",
          source: "runtime",
          updated_at: "2026-05-26T10:00:00Z",
          validation_issue_count: 0,
        },
      },
      onOpenFileCheckpoints,
    });

    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-runtime_file_changes"]',
      )?.textContent,
    ).toContain("文件变更 2");

    const reviewButton = container.querySelector(
      '[data-testid="agent-runtime-strip-open-file-checkpoints"]',
    ) as HTMLButtonElement | null;

    expect(reviewButton?.textContent).toContain("查看变更");
    act(() => {
      reviewButton?.click();
    });
    expect(onOpenFileCheckpoints).toHaveBeenCalledTimes(1);
  });

  it("运行时输出信号应设置 runtime data kind", () => {
    const container = renderStrip({
      runtimeToolAvailability: CODE_RUNTIME_TOOL_AVAILABILITY,
      harnessState: createHarnessState({
        outputSignals: [
          {
            id: "output-1",
            toolCallId: "tool-1",
            toolName: "Edit",
            title: "已修改文件",
            summary: "src/main.ts",
          },
        ],
      }),
    });

    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip"][data-runtime-kind="runtime"]',
      ),
    ).toBeTruthy();
  });



  it("canonical roster 应优先并按 Codex 七态独立计数", () => {
    const canonicalChildren = (
      [
        "pendingInit",
        "running",
        "interrupted",
        "completed",
        "errored",
        "shutdown",
        "notFound",
      ] satisfies CanonicalAgentStatus[]
    ).map(createCanonicalChild);
    const container = renderStrip({
      canonicalChildren,
      runtimeToolAvailability: CODE_RUNTIME_TOOL_AVAILABILITY,
    });
    const strip = container.querySelector(
      '[data-testid="agent-runtime-strip"]',
    );

    expect(strip?.getAttribute("data-team-roster-source")).toBe("canonical");
    expect(strip?.getAttribute("data-team-total-count")).toBe("7");
    expect(strip?.getAttribute("data-team-active-count")).toBe("2");
    expect(strip?.getAttribute("data-team-pending-init-count")).toBe("1");
    expect(strip?.getAttribute("data-team-running-count")).toBe("1");
    expect(strip?.getAttribute("data-team-queued-count")).toBe("0");
    expect(strip?.getAttribute("data-team-interrupted-count")).toBe("1");
    expect(strip?.getAttribute("data-team-completed-count")).toBe("1");
    expect(strip?.getAttribute("data-team-errored-count")).toBe("1");
    expect(strip?.getAttribute("data-team-shutdown-count")).toBe("1");
    expect(strip?.getAttribute("data-team-not-found-count")).toBe("1");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-team_running"]',
      )?.textContent,
    ).toContain("任务进行中 2/7");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-team_interrupted"]',
      )?.textContent,
    ).toContain("已中断 1");
  });

  it("空 canonical roster 应保持零计数", () => {
    const container = renderStrip({
      canonicalChildren: [],
      runtimeToolAvailability: CODE_RUNTIME_TOOL_AVAILABILITY,
    });
    const strip = container.querySelector(
      '[data-testid="agent-runtime-strip"]',
    );

    expect(strip?.getAttribute("data-team-roster-source")).toBe("canonical");
    expect(strip?.getAttribute("data-team-total-count")).toBe("0");
    expect(strip?.getAttribute("data-team-active-count")).toBe("0");
    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-team_running"]',
      ),
    ).toBeNull();
  });

  it("应消费标准 ReasoningState 并显示运行时思考状态", () => {
    const container = renderStrip({
      runtimeToolAvailability: CODE_RUNTIME_TOOL_AVAILABILITY,
      harnessState: createHarnessState({
        reasoning: {
          reasoning: {
            supported: true,
            status: "running",
            reasoningId: "reasoning-1",
            text: "先理解目标。",
          },
        },
      }),
    });

    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-reasoning"][data-status-key="reasoning"]',
      )?.textContent,
    ).toContain("深度思考");
  });

  it("仅有 model.effective 能力快照时不应显示运行时思考状态", () => {
    const container = renderStrip({
      runtimeToolAvailability: CODE_RUNTIME_TOOL_AVAILABILITY,
      harnessState: createHarnessState({
        reasoning: {
          model: {
            providerId: "openai",
            modelId: "gpt-codex",
          },
          reasoning: {
            supported: true,
            requestedLevel: "high",
            effectiveLevel: "high",
          },
        },
      }),
    });

    expect(
      container.querySelector(
        '[data-testid="agent-runtime-strip-status-reasoning"]',
      ),
    ).toBeNull();
  });
});
