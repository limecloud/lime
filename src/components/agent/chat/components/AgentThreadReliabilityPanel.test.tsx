import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentThreadReliabilityPanel } from "./AgentThreadReliabilityPanel";
import type {
  ActionRequired,
  AgentThreadItem,
  AgentThreadTurn,
  Message,
} from "../types";
import type {
  AgentRuntimeFileCheckpointDetail,
  AgentRuntimeFileCheckpointDiffResult,
  AgentRuntimeFileCheckpointListResult,
  AgentRuntimeThreadReadModel,
} from "@/lib/api/agentRuntime";
import type { TeamMemorySnapshot } from "@/lib/teamMemorySync";
import type { HarnessSessionState } from "../utils/harnessState";
import { recordRuntimeMemoryPrefetchHistory } from "@/lib/runtimeMemoryPrefetchHistory";

const {
  diffAgentRuntimeFileCheckpointMock,
  getAgentRuntimeFileCheckpointMock,
  listAgentRuntimeFileCheckpointsMock,
  mockToast,
  mockPrefetchContextMemoryForTurn,
} = vi.hoisted(() => ({
  diffAgentRuntimeFileCheckpointMock: vi.fn(),
  getAgentRuntimeFileCheckpointMock: vi.fn(),
  listAgentRuntimeFileCheckpointsMock: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  mockPrefetchContextMemoryForTurn: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@/lib/api/agentRuntime", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/agentRuntime")>(
    "@/lib/api/agentRuntime",
  );
  return {
    ...actual,
    diffAgentRuntimeFileCheckpoint: diffAgentRuntimeFileCheckpointMock,
    getAgentRuntimeFileCheckpoint: getAgentRuntimeFileCheckpointMock,
    listAgentRuntimeFileCheckpoints: listAgentRuntimeFileCheckpointsMock,
  };
});

vi.mock("@/lib/api/memoryRuntime", () => ({
  prefetchContextMemoryForTurn: mockPrefetchContextMemoryForTurn,
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];
let originalClipboard: Clipboard | undefined;

function createFileCheckpointListResult(): AgentRuntimeFileCheckpointListResult {
  return {
    session_id: "session-file-1",
    thread_id: "thread-file-1",
    checkpoint_count: 2,
    checkpoints: [
      {
        checkpoint_id: "artifact-document:req-2",
        turn_id: "turn-10",
        path: ".lime/artifacts/thread-file/persistence-map.artifact.json",
        source: "artifact_document_service",
        updated_at: "2026-04-16T09:12:00Z",
        version_no: 8,
        version_id: "artifact-document:req-2:v8",
        request_id: "req-2",
        title: "持久化 current map",
        kind: "artifact_document",
        status: "ready",
        preview_text: "补上 file checkpoint 对话框入口",
        snapshot_path:
          ".lime/artifacts/thread-file/.versions/persistence-map.v8.json",
        validation_issue_count: 1,
      },
      {
        checkpoint_id: "artifact-document:req-1",
        turn_id: "turn-9",
        path: ".lime/artifacts/thread-file/replay.artifact.json",
        source: "artifact_document_service",
        updated_at: "2026-04-16T08:58:00Z",
        version_no: 7,
        version_id: "artifact-document:req-1:v7",
        request_id: "req-1",
        title: "Replay case",
        kind: "artifact_document",
        status: "ready",
        preview_text: "上一版 replay 导出",
        snapshot_path:
          ".lime/artifacts/thread-file/.versions/replay-case.v7.json",
        validation_issue_count: 0,
      },
    ],
  };
}

function createFileCheckpointDetail(
  checkpointId: string,
): AgentRuntimeFileCheckpointDetail {
  if (checkpointId === "artifact-document:req-1") {
    return {
      session_id: "session-file-1",
      thread_id: "thread-file-1",
      checkpoint: {
        checkpoint_id: "artifact-document:req-1",
        turn_id: "turn-9",
        path: ".lime/artifacts/thread-file/replay.artifact.json",
        source: "artifact_document_service",
        updated_at: "2026-04-16T08:58:00Z",
        version_no: 7,
        version_id: "artifact-document:req-1:v7",
        request_id: "req-1",
        title: "Replay case",
        kind: "artifact_document",
        status: "ready",
        preview_text: "上一版 replay 导出",
        snapshot_path:
          ".lime/artifacts/thread-file/.versions/replay-case.v7.json",
        validation_issue_count: 0,
      },
      live_path: ".lime/artifacts/thread-file/replay.artifact.json",
      snapshot_path:
        ".lime/artifacts/thread-file/.versions/replay-case.v7.json",
      checkpoint_document: {
        title: "Replay case",
        body: "上一版导出仍使用旧摘要文案",
      },
      live_document: {
        title: "Replay case",
        body: "当前已切到新的 evidence 结构",
      },
      version_history: [{ version_id: "artifact-document:req-1:v6" }],
      validation_issues: [],
      metadata: {
        source: "artifact_document_service",
      },
      content: "上一版 replay 导出",
    };
  }

  return {
    session_id: "session-file-1",
    thread_id: "thread-file-1",
    checkpoint: {
      checkpoint_id: "artifact-document:req-2",
      turn_id: "turn-10",
      path: ".lime/artifacts/thread-file/persistence-map.artifact.json",
      source: "artifact_document_service",
      updated_at: "2026-04-16T09:12:00Z",
      version_no: 8,
      version_id: "artifact-document:req-2:v8",
      request_id: "req-2",
      title: "持久化 current map",
      kind: "artifact_document",
      status: "ready",
      preview_text: "补上 file checkpoint 对话框入口",
      snapshot_path:
        ".lime/artifacts/thread-file/.versions/persistence-map.v8.json",
      validation_issue_count: 1,
    },
    live_path: ".lime/artifacts/thread-file/persistence-map.artifact.json",
    snapshot_path:
      ".lime/artifacts/thread-file/.versions/persistence-map.v8.json",
    checkpoint_document: {
      title: "持久化 current map",
      summary: "已在可靠性面板接入 file checkpoint detail/diff 对话框",
    },
    live_document: {
      title: "持久化 current map",
      summary: "当前工作区产物已经更新到 v8",
    },
    version_history: [
      { version_id: "artifact-document:req-2:v7" },
      { version_id: "artifact-document:req-2:v6" },
    ],
    validation_issues: ["缺少 reviewer 字段"],
    metadata: {
      source: "artifact_document_service",
    },
    content: "补上 file checkpoint 对话框入口",
  };
}

function createFileCheckpointDiff(
  checkpointId: string,
): AgentRuntimeFileCheckpointDiffResult {
  if (checkpointId === "artifact-document:req-1") {
    return {
      session_id: "session-file-1",
      thread_id: "thread-file-1",
      checkpoint: createFileCheckpointDetail(checkpointId).checkpoint,
      current_version_id: "artifact-document:req-1:v7",
      previous_version_id: "artifact-document:req-1:v6",
      diff: {
        changes: ["summary 从旧结构迁移到 replay 包"],
      },
    };
  }

  return {
    session_id: "session-file-1",
    thread_id: "thread-file-1",
    checkpoint: createFileCheckpointDetail(checkpointId).checkpoint,
    current_version_id: "artifact-document:req-2:v8",
    previous_version_id: "artifact-document:req-2:v7",
    diff: {
      changes: ["新增可靠性面板快照详情入口"],
    },
  };
}

async function flushPromises(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;

  originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  window.localStorage.clear();
  mockPrefetchContextMemoryForTurn.mockResolvedValue({
    session_id: "session-default",
    rules_source_paths: [],
    working_memory_excerpt: null,
    durable_memories: [],
    team_memory_entries: [],
    latest_compaction: null,
    prompt: null,
  });
  listAgentRuntimeFileCheckpointsMock.mockResolvedValue(
    createFileCheckpointListResult(),
  );
  getAgentRuntimeFileCheckpointMock.mockImplementation(
    async ({ checkpoint_id }: { checkpoint_id: string }) =>
      createFileCheckpointDetail(checkpoint_id),
  );
  diffAgentRuntimeFileCheckpointMock.mockImplementation(
    async ({ checkpoint_id }: { checkpoint_id: string }) =>
      createFileCheckpointDiff(checkpoint_id),
  );
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  vi.clearAllMocks();
});

function renderPanel(props?: {
  threadRead?: AgentRuntimeThreadReadModel | null;
  turns?: AgentThreadTurn[];
  threadItems?: AgentThreadItem[];
  pendingActions?: ActionRequired[];
  submittedActionsInFlight?: ActionRequired[];
  currentTurnId?: string | null;
  canInterrupt?: boolean;
  onInterruptCurrentTurn?: () => void | Promise<void>;
  onResumeThread?: () => boolean | Promise<boolean>;
  onReplayPendingRequest?: (requestId: string) => boolean | Promise<boolean>;
  onLocatePendingRequest?: (requestId: string) => void;
  onPromoteQueuedTurn?: (queuedTurnId: string) => boolean | Promise<boolean>;
  onOpenMemoryWorkbench?: () => void;
  harnessState?: HarnessSessionState | null;
  messages?: Message[];
  teamMemorySnapshot?: TeamMemorySnapshot | null;
  diagnosticRuntimeContext?: {
    sessionId?: string | null;
    workspaceId?: string | null;
    workingDir?: string | null;
    providerType?: string | null;
    model?: string | null;
    executionStrategy?: string | null;
    activeTheme?: string | null;
    selectedTeamLabel?: string | null;
  } | null;
}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AgentThreadReliabilityPanel
        threadRead={props?.threadRead}
        turns={props?.turns}
        threadItems={props?.threadItems}
        pendingActions={props?.pendingActions}
        submittedActionsInFlight={props?.submittedActionsInFlight}
        currentTurnId={props?.currentTurnId}
        canInterrupt={props?.canInterrupt}
        onInterruptCurrentTurn={props?.onInterruptCurrentTurn}
        onResumeThread={props?.onResumeThread}
        onReplayPendingRequest={props?.onReplayPendingRequest}
        onLocatePendingRequest={props?.onLocatePendingRequest}
        onPromoteQueuedTurn={props?.onPromoteQueuedTurn}
        onOpenMemoryWorkbench={props?.onOpenMemoryWorkbench}
        harnessState={props?.harnessState}
        messages={props?.messages}
        teamMemorySnapshot={props?.teamMemorySnapshot}
        diagnosticRuntimeContext={props?.diagnosticRuntimeContext}
      />,
    );
  });

  mountedRoots.push({ container, root });
  return container;
}

describe("AgentThreadReliabilityPanel", () => {
  it("应优先展示 thread_read 中的 outcome 与 incident", () => {
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-1",
        status: "running",
        active_turn_id: "turn-1",
        pending_requests: [
          {
            id: "req-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            request_type: "tool_confirmation",
            status: "pending",
            title: "确认是否执行 browser_click",
            created_at: "2026-03-23T09:00:00Z",
          },
        ],
        last_outcome: {
          thread_id: "thread-1",
          turn_id: "turn-0",
          outcome_type: "failed_provider",
          summary: "最近一次 provider 请求失败",
          primary_cause: "429 rate limited",
          retryable: true,
          ended_at: "2026-03-23T08:58:00Z",
        },
        incidents: [
          {
            id: "incident-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            incident_type: "approval_timeout",
            severity: "high",
            status: "active",
            title: "审批等待超过阈值",
            details: "当前线程等待工具确认时间过长",
          },
        ],
      },
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "发布文章到公众号",
          status: "running",
          started_at: "2026-03-23T09:00:00Z",
          created_at: "2026-03-23T09:00:00Z",
          updated_at: "2026-03-23T09:00:10Z",
        },
      ],
      currentTurnId: "turn-1",
    });

    expect(
      container.querySelector('[data-testid="agent-thread-reliability-panel"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("线程可靠性");
    expect(container.textContent).toContain("待处理请求");
    expect(container.textContent).toContain("Provider 失败");
    expect(container.textContent).toContain("审批等待超过阈值");
    expect(container.textContent).toContain(
      "审批等待过久，建议尽快处理或停止当前执行",
    );
  });

  it("缺少 thread_read 时，应从当前 turn 与 pendingActions 推导并支持中断", async () => {
    const onInterruptCurrentTurn = vi.fn().mockResolvedValue(undefined);
    const container = renderPanel({
      turns: [
        {
          id: "turn-2",
          thread_id: "thread-1",
          prompt_text: "继续检查发布结果",
          status: "running",
          started_at: "2026-03-23T09:00:00Z",
          created_at: "2026-03-23T09:00:00Z",
          updated_at: "2026-03-23T09:00:12Z",
        },
      ],
      threadItems: [
        {
          id: "item-1",
          thread_id: "thread-1",
          turn_id: "turn-2",
          sequence: 1,
          status: "in_progress",
          started_at: "2026-03-23T09:00:01Z",
          updated_at: "2026-03-23T09:00:05Z",
          type: "turn_summary",
          text: "正在等待用户确认是否继续执行",
        },
      ],
      pendingActions: [
        {
          requestId: "req-local-1",
          actionType: "ask_user",
          prompt: "请确认是否继续发布",
          status: "pending",
        },
      ],
      currentTurnId: "turn-2",
      canInterrupt: true,
      onInterruptCurrentTurn,
    });

    expect(container.textContent).toContain("等待人工处理");
    expect(container.textContent).toContain("请确认是否继续发布");

    const button = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("停止当前执行"),
    );
    expect(button).toBeDefined();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onInterruptCurrentTurn).toHaveBeenCalledTimes(1);
  });

  it("应展示最近文件快照摘要", () => {
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-file",
        status: "completed",
        file_checkpoint_summary: {
          count: 2,
          latest_checkpoint: {
            checkpoint_id: "artifact-document:req-1",
            turn_id: "turn-9",
            path: ".lime/artifacts/thread-file/demo.artifact.json",
            source: "artifact_document_service",
            updated_at: "2026-04-15T09:08:00Z",
            version_no: 7,
            version_id: "artifact-document:req-1:v7",
            preview_text: "补充了持久化快照对齐说明",
            validation_issue_count: 0,
            title: "持久化对齐说明",
            status: "ready",
          },
        },
      },
    });

    expect(container.textContent).toContain("最近文件快照");
    expect(container.textContent).toContain(
      ".lime/artifacts/thread-file/demo.artifact.json",
    );
    expect(container.textContent).toContain("共 2 个");
    expect(container.textContent).toContain("v7");
    expect(container.textContent).toContain("补充了持久化快照对齐说明");
  });

  it("应支持打开文件快照详情并拉取 list、detail、diff", async () => {
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-file-1",
        status: "completed",
        file_checkpoint_summary: {
          count: 2,
          latest_checkpoint: createFileCheckpointListResult().checkpoints[0],
        },
      },
      diagnosticRuntimeContext: {
        sessionId: "session-file-1",
        workspaceId: "workspace-file-1",
        workingDir: "/workspace/project-a",
      },
    });

    const openButton = container.querySelector(
      '[data-testid="agent-thread-file-checkpoint-open"]',
    );
    expect(openButton).not.toBeNull();
    expect(openButton?.textContent).toContain("查看快照详情");

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
    });

    expect(listAgentRuntimeFileCheckpointsMock).toHaveBeenCalledWith({
      session_id: "session-file-1",
    });
    expect(getAgentRuntimeFileCheckpointMock).toHaveBeenCalledWith({
      session_id: "session-file-1",
      checkpoint_id: "artifact-document:req-2",
    });
    expect(diffAgentRuntimeFileCheckpointMock).toHaveBeenCalledWith({
      session_id: "session-file-1",
      checkpoint_id: "artifact-document:req-2",
    });
    expect(document.body.textContent).toContain("文件快照详情");
    expect(document.body.textContent).toContain("缺少 reviewer 字段");
    expect(document.body.textContent).toContain(
      "新增可靠性面板快照详情入口",
    );
    expect(document.body.textContent).toContain("artifact-document:req-2:v7");
    expect(document.body.textContent).toContain(
      ".lime/artifacts/thread-file/persistence-map.artifact.json",
    );

    const previousCheckpointButton = document.body.querySelector(
      '[data-testid="agent-thread-file-checkpoint-item-artifact-document:req-1"]',
    );
    expect(previousCheckpointButton).not.toBeNull();

    await act(async () => {
      previousCheckpointButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushPromises();
    });

    expect(getAgentRuntimeFileCheckpointMock).toHaveBeenLastCalledWith({
      session_id: "session-file-1",
      checkpoint_id: "artifact-document:req-1",
    });
    expect(diffAgentRuntimeFileCheckpointMock).toHaveBeenLastCalledWith({
      session_id: "session-file-1",
      checkpoint_id: "artifact-document:req-1",
    });
    expect(document.body.textContent).toContain("上一版导出仍使用旧摘要文案");
    expect(document.body.textContent).toContain(
      "summary 从旧结构迁移到 replay 包",
    );
  });

  it("中断进行中时，面板应展示中断中的瞬时状态", async () => {
    let resolveInterrupt: (() => void) | null = null;
    const onInterruptCurrentTurn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveInterrupt = resolve;
        }),
    );
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-1",
        status: "running",
        active_turn_id: "turn-1",
        pending_requests: [],
        incidents: [],
      },
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "继续整理发布说明",
          status: "running",
          started_at: "2026-03-23T09:00:00Z",
          created_at: "2026-03-23T09:00:00Z",
          updated_at: "2026-03-23T09:00:05Z",
        },
      ],
      currentTurnId: "turn-1",
      canInterrupt: true,
      onInterruptCurrentTurn,
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("停止当前执行"),
    );
    expect(button).toBeDefined();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("中断中");
    expect(container.textContent).toContain("正在请求停止当前执行");
    expect(container.textContent).toContain("正在停止");

    await act(async () => {
      resolveInterrupt?.();
      await Promise.resolve();
    });
  });

  it("应展示最近刷新时间、运行时中断态，并支持跳转待处理请求与恢复排队回合", async () => {
    const onLocatePendingRequest = vi.fn();
    const onResumeThread = vi.fn().mockResolvedValue(true);
    const onPromoteQueuedTurn = vi.fn().mockResolvedValue(true);
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-1",
        status: "aborted",
        active_turn_id: "turn-1",
        pending_requests: [
          {
            id: "req-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            request_type: "ask_user",
            status: "pending",
            title: "请确认是否继续发布",
            created_at: "2026-03-23T09:00:00Z",
          },
        ],
        queued_turns: [
          {
            queued_turn_id: "queued-1",
            message_preview: "继续执行排队任务",
            message_text: "继续执行排队任务正文",
            created_at: 1711184400,
            image_count: 0,
            position: 1,
          },
        ],
        interrupt_state: "interrupted",
        updated_at: "2026-03-23T09:00:20Z",
        incidents: [],
      },
      onResumeThread,
      onLocatePendingRequest,
      onPromoteQueuedTurn,
    });

    expect(container.textContent).toContain("最近刷新");
    expect(container.textContent).toContain("运行时已确认中断");
    expect(container.textContent).toContain("前往待处理请求");
    expect(container.textContent).toContain("恢复执行");
    expect(container.textContent).toContain("优先执行 队列第 1 位");

    const buttons = Array.from(container.querySelectorAll("button"));
    const locateButton = buttons.find((node) =>
      node.textContent?.includes("前往待处理请求"),
    );
    const resumeButton = buttons.find((node) =>
      node.textContent?.includes("恢复执行"),
    );
    const promoteButton = buttons.find((node) =>
      node.textContent?.includes("优先执行 队列第 1 位"),
    );

    act(() => {
      locateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onLocatePendingRequest).toHaveBeenCalledWith("req-1");

    await act(async () => {
      resumeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onResumeThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      promoteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(onPromoteQueuedTurn).toHaveBeenCalledWith("queued-1");
  });

  it("请求已提交待回填时，应压住旧 pending 并展示继续处理中", () => {
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-1",
        status: "waiting_request",
        active_turn_id: "turn-1",
        pending_requests: [
          {
            id: "req-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            request_type: "ask_user",
            status: "pending",
            title: "请确认是否继续发布",
            created_at: "2026-03-23T09:00:00Z",
          },
        ],
        incidents: [
          {
            id: "incident-req-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            incident_type: "waiting_user_input",
            severity: "medium",
            status: "active",
            title: "线程正在等待人工处理",
          },
        ],
      },
      submittedActionsInFlight: [
        {
          requestId: "req-1",
          actionType: "ask_user",
          prompt: "请确认是否继续发布",
          status: "submitted",
          submittedResponse: '{"answer":"继续"}',
          submittedUserData: { answer: "继续" },
        },
      ],
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "继续发布",
          status: "running",
          started_at: "2026-03-23T09:00:00Z",
          created_at: "2026-03-23T09:00:00Z",
          updated_at: "2026-03-23T09:00:10Z",
        },
      ],
      currentTurnId: "turn-1",
    });

    expect(container.textContent).toContain("处理中");
    expect(container.textContent).toContain("已提交响应，等待线程继续执行");
    expect(container.textContent).toContain("已提交响应：请确认是否继续发布");
    expect(container.textContent).not.toContain("当前最需要处理的请求");
  });

  it("运行回合卡住时，应展示主动恢复建议", () => {
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-1",
        status: "running",
        active_turn_id: "turn-stuck",
        pending_requests: [],
        incidents: [
          {
            id: "incident-stuck",
            thread_id: "thread-1",
            turn_id: "turn-stuck",
            incident_type: "turn_stuck",
            severity: "high",
            status: "active",
            title: "当前回合长时间无进展",
            details: "最近 3 分钟内没有新的线程更新，可尝试停止后恢复执行。",
          },
        ],
      },
      turns: [
        {
          id: "turn-stuck",
          thread_id: "thread-1",
          prompt_text: "继续回填发布摘要",
          status: "running",
          started_at: "2026-03-23T09:55:00Z",
          created_at: "2026-03-23T09:55:00Z",
          updated_at: "2026-03-23T09:56:00Z",
        },
      ],
      currentTurnId: "turn-stuck",
      canInterrupt: true,
      onInterruptCurrentTurn: vi.fn().mockResolvedValue(undefined),
    });

    expect(container.textContent).toContain("当前回合长时间无进展");
    expect(container.textContent).toContain(
      "当前回合长时间无进展，建议停止后恢复执行",
    );
  });

  it("存在待处理请求时应支持重新拉起请求", async () => {
    const onReplayPendingRequest = vi.fn().mockResolvedValue(true);
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-1",
        status: "waiting_request",
        pending_requests: [
          {
            id: "req-replay-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            request_type: "ask_user",
            status: "pending",
            title: "请重新确认执行模式",
            created_at: "2026-03-23T09:00:00Z",
          },
        ],
        incidents: [],
      },
      onReplayPendingRequest,
    });

    const replayButton = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("重新拉起请求"),
    );
    expect(replayButton).toBeDefined();

    await act(async () => {
      replayButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onReplayPendingRequest).toHaveBeenCalledWith("req-replay-1");
  });

  it("应展示本回合记忆命中预取，帮助判断当前续接是否命中", async () => {
    mockPrefetchContextMemoryForTurn.mockResolvedValue({
      session_id: "session-memory-1",
      rules_source_paths: [
        "/workspace/AGENTS.md",
        "/workspace/.memory/rules.md",
      ],
      working_memory_excerpt: "【task_plan.md】继续整理风险点与来源摘要。",
      durable_memories: [
        {
          id: "durable-1",
          session_id: "session-memory-1",
          category: "experience",
          title: "研究简报输出偏好",
          summary: "优先给风险与证据链",
          updated_at: 1711184700,
          tags: ["research"],
        },
      ],
      team_memory_entries: [
        {
          key: "team.selection",
          content: "研究协作队",
          updated_at: 1711184700,
        },
      ],
      latest_compaction: {
        session_id: "session-memory-1",
        source: "summary_cache",
        summary_preview: "保留研究目标与来源摘要。",
        created_at: 1711184700,
        trigger: "token_budget",
      },
      prompt: "【运行时记忆召回】...",
    });

    const container = renderPanel({
      turns: [
        {
          id: "turn-memory-1",
          thread_id: "thread-memory-1",
          prompt_text: "继续输出研究简报的风险点",
          status: "running",
          started_at: "2026-03-23T10:00:00Z",
          created_at: "2026-03-23T10:00:00Z",
          updated_at: "2026-03-23T10:01:00Z",
        },
      ],
      diagnosticRuntimeContext: {
        sessionId: "session-memory-1",
        workspaceId: "workspace-memory-1",
        workingDir: "/workspace/project-a",
      },
      teamMemorySnapshot: {
        repoScope: "/workspace/project-a",
        entries: {
          "team.selection": {
            key: "team.selection",
            content: "研究协作队",
            updatedAt: 1711184700,
          },
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPrefetchContextMemoryForTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "session-memory-1",
        working_dir: "/workspace/project-a",
        user_message: "继续输出研究简报的风险点",
        request_metadata: expect.objectContaining({
          team_memory_shadow: expect.objectContaining({
            repo_scope: "/workspace/project-a",
          }),
        }),
      }),
    );
    expect(
      container.querySelector(
        '[data-testid="agent-thread-reliability-memory-prefetch"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="agent-thread-reliability-memory-prefetch"]',
      )?.className,
    ).toContain("border-emerald-200");
    expect(container.textContent).toContain("本回合记忆预取");
    expect(container.textContent).toContain("记忆命中预演");
    expect(container.textContent).toContain("规则 2");
    expect(container.textContent).toContain("会话 已命中");
    expect(container.textContent).toContain("持久 1");
    expect(container.textContent).toContain("Team Memory 1");
    expect(container.textContent).toContain("压缩 已命中");
    expect(container.textContent).toContain("会话记忆摘录");
    expect(container.textContent).toContain("继续整理风险点与来源摘要");
    expect(container.textContent).toContain("规则来源");
    expect(container.textContent).toContain("/workspace/AGENTS.md");
    expect(container.textContent).toContain("持久记忆命中");
    expect(container.textContent).toContain("研究简报输出偏好");
    expect(container.textContent).toContain("优先给风险与证据链");
    expect(container.textContent).toContain("Team Memory 明细");
    expect(container.textContent).toContain("team.selection");
    expect(container.textContent).toContain("研究协作队");
    expect(container.textContent).toContain("会话压缩摘要");
    expect(container.textContent).toContain("保留研究目标与来源摘要");
    expect(container.textContent).toContain("运行时记忆片段");
    expect(container.textContent).toContain("【运行时记忆召回】");
  });

  it("应展示相对最近基线的记忆变化摘要", async () => {
    recordRuntimeMemoryPrefetchHistory({
      sessionId: "session-memory-compare-1",
      workingDir: "/workspace/project-a",
      userMessage: "继续输出旧版简报",
      source: "memory_page",
      capturedAt: 1_711_184_600_000,
      result: {
        session_id: "session-memory-compare-1",
        rules_source_paths: ["/workspace/AGENTS.md"],
        working_memory_excerpt: null,
        durable_memories: [],
        team_memory_entries: [],
        latest_compaction: null,
        prompt: null,
      },
    });

    mockPrefetchContextMemoryForTurn.mockResolvedValue({
      session_id: "session-memory-compare-1",
      rules_source_paths: [
        "/workspace/AGENTS.md",
        "/workspace/.memory/rules.md",
      ],
      working_memory_excerpt: "【task_plan.md】补上新版风险结论。",
      durable_memories: [
        {
          id: "durable-compare-1",
          session_id: "session-memory-compare-1",
          category: "experience",
          title: "研究简报结构偏好",
          summary: "先结论，再列风险",
          updated_at: 1711184700,
          tags: ["research"],
        },
      ],
      team_memory_entries: [],
      latest_compaction: null,
      prompt: null,
    });

    const container = renderPanel({
      turns: [
        {
          id: "turn-memory-compare-1",
          thread_id: "thread-memory-compare-1",
          prompt_text: "继续输出新版研究简报",
          status: "running",
          started_at: "2026-03-23T10:00:00Z",
          created_at: "2026-03-23T10:00:00Z",
          updated_at: "2026-03-23T10:01:00Z",
        },
      ],
      diagnosticRuntimeContext: {
        sessionId: "session-memory-compare-1",
        workspaceId: "workspace-memory-compare-1",
        workingDir: "/workspace/project-a",
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("相对最近基线");
    expect(
      container.querySelector(
        '[data-testid="agent-thread-reliability-memory-prefetch-baseline"]',
      )?.className,
    ).toContain("border-emerald-200");
    expect(container.textContent).toContain("基线输入：继续输出旧版简报");
    expect(container.textContent).toContain("补强");
    expect(container.textContent).toContain(
      "补强层：规则层、工作层、持久层。 摘要内容也有更新。",
    );
    expect(container.textContent).toContain("具体变化");
    expect(container.textContent).toContain("规则 +1");
    expect(container.textContent).toContain("工作 新命中");
    expect(container.textContent).toContain("持久 +1");
    expect(container.textContent).toContain(
      "工作摘录 无 -> 【task_plan.md】补上新版风险结论。",
    );
  });

  it("应支持从线程可靠性面板跳到记忆工作台查看当前预演", async () => {
    const onOpenMemoryWorkbench = vi.fn();
    const container = renderPanel({
      turns: [
        {
          id: "turn-memory-open-1",
          thread_id: "thread-memory-open-1",
          prompt_text: "继续整理运行时记忆",
          status: "running",
          started_at: "2026-03-23T10:00:00Z",
          created_at: "2026-03-23T10:00:00Z",
          updated_at: "2026-03-23T10:01:00Z",
        },
      ],
      diagnosticRuntimeContext: {
        sessionId: "session-memory-open-1",
        workspaceId: "workspace-memory-open-1",
        workingDir: "/workspace/project-b",
      },
      onOpenMemoryWorkbench,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = Array.from(container.querySelectorAll("button")).find(
      (element) => element.textContent?.includes("在记忆工作台查看"),
    );
    expect(button).toBeTruthy();

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onOpenMemoryWorkbench).toHaveBeenCalledTimes(1);
  });

  it("应展示最近压缩边界，帮助判断压缩后的工作记忆续接", () => {
    const container = renderPanel({
      threadRead: {
        thread_id: "thread-compaction-1",
        status: "completed",
        pending_requests: [],
        incidents: [],
        latest_compaction_boundary: {
          session_id: "session-compaction-1",
          summary_preview:
            "保留研究目标、已确认来源和待输出风险点，后续回答应沿这条摘要继续。",
          turn_count: 8,
          created_at: "2026-03-23T10:05:00Z",
          trigger: "token_budget",
          detail: "压缩后保留研究目标与来源摘要",
        },
      },
    });

    expect(
      container.querySelector(
        '[data-testid="agent-thread-reliability-compaction-boundary"]',
      ),
    ).not.toBeNull();
    expect(container.textContent).toContain("最近压缩边界");
    expect(container.textContent).toContain("token_budget");
    expect(container.textContent).toContain("覆盖 8 回合");
    expect(container.textContent).toContain(
      "保留研究目标、已确认来源和待输出风险点",
    );
    expect(container.textContent).toContain(
      "压缩备注 压缩后保留研究目标与来源摘要",
    );
  });

  it("应支持复制给 AI 的可靠性诊断包", async () => {
    mockPrefetchContextMemoryForTurn.mockResolvedValue({
      session_id: "session-diag-1",
      rules_source_paths: ["/workspace/AGENTS.md"],
      working_memory_excerpt: "【progress.md】继续生成研究简报。",
      durable_memories: [
        {
          id: "durable-diag-1",
          session_id: "session-diag-1",
          category: "experience",
          title: "研究输出格式偏好",
          summary: "先给结论，再列风险",
          updated_at: 1711184700,
          tags: ["report"],
        },
      ],
      team_memory_entries: [
        {
          key: "team.selection",
          content: "研究协作队",
          updated_at: 1711184700,
        },
      ],
      latest_compaction: {
        session_id: "session-diag-1",
        source: "summary_cache",
        summary_preview: "保留研究目标与最近来源摘要。",
        created_at: 1711184700,
        trigger: "token_budget",
      },
      prompt: "【运行时记忆召回】...",
    });

    const container = renderPanel({
      threadRead: {
        thread_id: "thread-1",
        status: "aborted",
        active_turn_id: "turn-1",
        latest_compaction_boundary: {
          session_id: "session-diag-1",
          summary_preview:
            "保留研究目标、最近来源摘要和待输出风险点，后续回答应基于这段摘要继续。",
          turn_count: 6,
          created_at: "2026-03-23T10:01:05Z",
          trigger: "token_budget",
          detail: "压缩后保留研究目标与最近来源摘要",
        },
        diagnostics: {
          latest_turn_status: "aborted",
          latest_turn_started_at: "2026-03-23T10:00:00Z",
          latest_turn_completed_at: "2026-03-23T10:02:00Z",
          latest_turn_updated_at: "2026-03-23T10:03:00Z",
          latest_turn_elapsed_seconds: 120,
          latest_turn_error_message: "浏览器页面已关闭",
          interrupt_reason: "浏览器页面已关闭",
          runtime_interrupt_source: "user",
          runtime_interrupt_requested_at: "2026-03-23T10:01:58Z",
          runtime_interrupt_wait_seconds: 2,
          warning_count: 1,
          context_compaction_count: 1,
          failed_tool_call_count: 1,
          failed_command_count: 1,
          pending_request_count: 0,
          primary_blocking_kind: "tool_failed",
          primary_blocking_summary: "页面上下文已销毁",
          latest_warning: {
            item_id: "warning-1",
            code: "context_compaction_accuracy",
            message: "长对话和多次上下文压缩会降低模型准确性",
            updated_at: "2026-03-23T10:01:30Z",
          },
          latest_context_compaction: {
            item_id: "compaction-1",
            stage: "runtime",
            trigger: "token_budget",
            detail: "保留研究目标与最近来源摘要",
            updated_at: "2026-03-23T10:01:00Z",
          },
          latest_failed_tool: {
            item_id: "tool-1",
            tool_name: "browser_click",
            error: "页面上下文已销毁",
            updated_at: "2026-03-23T10:02:00Z",
          },
          latest_failed_command: {
            item_id: "cmd-1",
            command: "npm run build",
            exit_code: 1,
            error: "Command failed with exit code 1",
            updated_at: "2026-03-23T10:01:50Z",
          },
        },
        pending_requests: [],
        last_outcome: {
          thread_id: "thread-1",
          turn_id: "turn-1",
          outcome_type: "failed_tool",
          summary: "工具执行中断",
          primary_cause: "浏览器页面已关闭",
          retryable: true,
          ended_at: "2026-03-23T10:02:00Z",
        },
        incidents: [
          {
            id: "incident-1",
            thread_id: "thread-1",
            turn_id: "turn-1",
            incident_type: "tool_failed",
            severity: "high",
            status: "active",
            title: "浏览器工具执行失败",
            details: "页面上下文已销毁",
          },
        ],
        updated_at: "2026-03-23T10:03:00Z",
      },
      turns: [
        {
          id: "turn-1",
          thread_id: "thread-1",
          prompt_text: "继续发布公众号文章",
          status: "aborted",
          started_at: "2026-03-23T10:00:00Z",
          created_at: "2026-03-23T10:00:00Z",
          updated_at: "2026-03-23T10:03:00Z",
        },
      ],
      currentTurnId: "turn-1",
      harnessState: {
        runtimeStatus: {
          phase: "context",
          title: "正在整理研究上下文",
          detail: "最近一次压缩后继续生成研究简报。",
          checkpoints: ["已整理来源", "正在回填摘要"],
        },
        pendingApprovals: [],
        latestContextTrace: [
          {
            stage: "context_compaction",
            detail: "保留研究目标与最近来源摘要",
          },
        ],
        plan: {
          phase: "ready",
          items: [
            { id: "todo-1", content: "归纳研究目标", status: "completed" },
            { id: "todo-2", content: "输出风险点", status: "in_progress" },
          ],
          summaryText: "先回填研究简报，再补风险追踪建议。",
        },
        activity: {
          planning: 1,
          filesystem: 0,
          execution: 0,
          web: 2,
          skills: 0,
          delegation: 0,
        },
        delegatedTasks: [],
        outputSignals: [
          {
            id: "signal-1",
            toolCallId: "tool-1",
            toolName: "web_search",
            title: "联网检索摘要",
            summary: "已检索 3 个来源",
            preview: "来源覆盖官网、新闻和公告",
          },
        ],
        activeFileWrites: [],
        recentFileEvents: [],
        hasSignals: true,
      },
      messages: [
        {
          id: "msg-user-1",
          role: "user",
          content: "请围绕这个主题先给我做一版网页研究简报",
          timestamp: new Date("2026-03-23T09:59:00Z"),
        },
        {
          id: "msg-assistant-1",
          role: "assistant",
          content: "我先整理研究目标、来源、核心发现和风险点。",
          timestamp: new Date("2026-03-23T10:00:00Z"),
          runtimeStatus: {
            phase: "context",
            title: "正在整理研究上下文",
            detail: "压缩后继续生成简报",
            checkpoints: ["研究目标", "来源摘要"],
          },
        },
      ],
      diagnosticRuntimeContext: {
        sessionId: "session-diag-1",
        workspaceId: "workspace-diag-1",
        workingDir: "/workspace/research",
        providerType: "openai",
        model: "gpt-5.4",
        executionStrategy: "react",
        activeTheme: "general",
        selectedTeamLabel: "研究协作队",
      },
      teamMemorySnapshot: {
        repoScope: "/workspace/research",
        entries: {
          "team.selection": {
            key: "team.selection",
            content: "研究协作队",
            updatedAt: 1711184700,
          },
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const copyButton = container.querySelector(
      '[data-testid="agent-thread-reliability-copy"]',
    );
    expect(copyButton).not.toBeNull();

    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("# Lime 线程可靠性诊断任务"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("请按以下结构输出："),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("### 运行环境"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("gpt-5.4"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("### Harness 过程信号"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("### 最近压缩边界"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("### 当前回合记忆预取"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("规则层：1 个来源"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Team Memory 层：1 条"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("规则来源：/workspace/AGENTS.md"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        "持久记忆详情：研究输出格式偏好｜先给结论，再列风险",
      ),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Team Memory 详情：team.selection｜研究协作队"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("会话压缩摘要：保留研究目标与最近来源摘要。"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("运行时记忆片段：【运行时记忆召回】"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("覆盖回合数：6"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        "边界摘要：保留研究目标、最近来源摘要和待输出风险点",
      ),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("### 后端诊断聚合"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("主阻塞类型：tool_failed"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("中断来源：user"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("最近失败命令：npm run build"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("### 最近消息片段"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("### Incident"),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("浏览器工具执行失败"),
    );
    expect(mockToast.success).toHaveBeenCalledWith("AI 诊断内容已复制");
    expect(container.textContent).toContain("线程级快速诊断");
    expect(container.textContent).toContain("快速复制给 AI");
    expect(container.textContent).toContain("复制原始 JSON（debug）");
    expect(container.textContent).toContain("外部分析交接");
    expect(container.textContent).toContain(
      "analysis-brief.md / analysis-context.json",
    );
  });

  it("应支持复制原始 JSON 诊断数据", async () => {
    mockPrefetchContextMemoryForTurn.mockResolvedValue({
      session_id: "session-json-1",
      rules_source_paths: ["/workspace/AGENTS.md"],
      working_memory_excerpt: null,
      durable_memories: [],
      team_memory_entries: [],
      latest_compaction: null,
      prompt: null,
    });

    const container = renderPanel({
      threadRead: {
        thread_id: "thread-json-1",
        status: "waiting_request",
        active_turn_id: "turn-json-1",
        latest_compaction_boundary: {
          session_id: "session-json-1",
          summary_preview: "保留用户确认点与待继续执行动作。",
          turn_count: 3,
          created_at: "2026-03-23T10:00:20Z",
          trigger: "manual_compact",
          detail: "压缩后等待用户输入",
        },
        diagnostics: {
          latest_turn_status: "running",
          warning_count: 0,
          context_compaction_count: 0,
          failed_tool_call_count: 0,
          failed_command_count: 0,
          pending_request_count: 1,
          primary_blocking_kind: "waiting_user_input",
        },
        pending_requests: [
          {
            id: "req-json-1",
            thread_id: "thread-json-1",
            turn_id: "turn-json-1",
            request_type: "ask_user",
            status: "pending",
            title: "请确认是否继续执行",
            created_at: "2026-03-23T10:00:00Z",
          },
        ],
        incidents: [],
      },
      turns: [
        {
          id: "turn-json-1",
          thread_id: "thread-json-1",
          prompt_text: "继续执行 JSON 校验任务",
          status: "running",
          started_at: "2026-03-23T10:00:00Z",
          created_at: "2026-03-23T10:00:00Z",
          updated_at: "2026-03-23T10:01:00Z",
        },
      ],
      currentTurnId: "turn-json-1",
      pendingActions: [
        {
          requestId: "req-json-1",
          actionType: "ask_user",
          prompt: "请确认是否继续执行",
          status: "pending",
        },
      ],
      harnessState: {
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
        hasSignals: true,
      },
      messages: [
        {
          id: "msg-json-1",
          role: "assistant",
          content: "正在等待你确认是否继续执行",
          timestamp: new Date("2026-03-23T10:00:30Z"),
        },
      ],
      diagnosticRuntimeContext: {
        sessionId: "session-json-1",
        workspaceId: "workspace-json-1",
        workingDir: "/workspace/json",
        providerType: "openai",
        model: "gpt-5.4-mini",
        executionStrategy: "react",
        activeTheme: "general",
        selectedTeamLabel: "默认协作",
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const jsonButton = container.querySelector(
      '[data-testid="agent-thread-reliability-copy-json"]',
    );
    expect(jsonButton).not.toBeNull();

    await act(async () => {
      jsonButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"runtime_context"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"backend_diagnostics"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"latest_compaction_boundary"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"memory_prefetch_preview"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"harness_state"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"recent_messages"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"thread_read"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"reliability_view"'),
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('"pending_actions"'),
    );
    expect(mockToast.success).toHaveBeenCalledWith("原始 JSON 已复制");
  });
});
