import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSafeInvoke } = vi.hoisted(() => ({
  mockSafeInvoke: vi.fn(),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: mockSafeInvoke,
}));

import {
  exportAgentRuntimeAnalysisHandoff,
  closeAgentRuntimeSubagent,
  createAgentRuntimeSession,
  deleteAgentRuntimeSession,
  exportAgentRuntimeEvidencePack,
  exportAgentRuntimeHandoffBundle,
  exportAgentRuntimeReplayCase,
  exportAgentRuntimeReviewDecisionTemplate,
  saveAgentRuntimeReviewDecision,
  getAsterAgentStatus,
  generateAgentRuntimeTitleResult,
  generateAgentRuntimeTitle,
  generateAgentRuntimeSessionTitle,
  getAgentRuntimeSession,
  getAgentRuntimeThreadRead,
  getAgentRuntimeToolInventory,
  interruptAgentRuntimeTurn,
  listAgentRuntimeSessions,
  promoteAgentRuntimeQueuedTurn,
  replayAgentRuntimeRequest,
  resumeAgentRuntimeThread,
  resumeAgentRuntimeSubagent,
  respondAgentRuntimeAction,
  sendAgentRuntimeSubagentInput,
  spawnAgentRuntimeSubagent,
  submitAgentRuntimeTurn,
  updateAgentRuntimeSession,
  waitAgentRuntimeSubagents,
} from "./agentRuntime";

describe("Agent API 治理护栏", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createAgentRuntimeSession 应走统一 runtime create 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce("session-created");

    await expect(
      createAgentRuntimeSession("workspace-2", "新会话", "auto"),
    ).resolves.toBe("session-created");

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_create_session",
      {
        workspaceId: "workspace-2",
        name: "新会话",
        executionStrategy: "auto",
      },
    );
  });

  it("getAsterAgentStatus 应返回现役状态结构", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      initialized: true,
      provider_configured: true,
      provider_name: "Anthropic",
      model_name: "claude-sonnet-4-20250514",
    });

    await expect(getAsterAgentStatus()).resolves.toEqual({
      initialized: true,
      provider_configured: true,
      provider_name: "Anthropic",
      model_name: "claude-sonnet-4-20250514",
    });
  });

  it("submitAgentRuntimeTurn 应走统一 runtime submit 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await submitAgentRuntimeTurn({
      message: "runtime hello",
      session_id: "session-runtime",
      event_name: "event-runtime",
      workspace_id: "workspace-runtime",
      turn_config: {
        execution_strategy: "react",
        provider_config: {
          provider_id: "provider-runtime",
          provider_name: "Provider Runtime",
          model_name: "model-runtime",
        },
        metadata: {
          source: "hook-facade",
        },
      },
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_submit_turn", {
      request: {
        message: "runtime hello",
        session_id: "session-runtime",
        event_name: "event-runtime",
        workspace_id: "workspace-runtime",
        turn_config: {
          execution_strategy: "react",
          provider_config: {
            provider_id: "provider-runtime",
            provider_name: "Provider Runtime",
            model_name: "model-runtime",
          },
          metadata: {
            source: "hook-facade",
          },
        },
      },
    });
  });

  it("submitAgentRuntimeTurn 应透传 web_search 与 queue_if_busy", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await submitAgentRuntimeTurn({
      message: "查一下今天的汇率",
      session_id: "session-runtime-search",
      event_name: "event-runtime-search",
      workspace_id: "workspace-runtime-search",
      queue_if_busy: true,
      queued_turn_id: "queued-turn-1",
      turn_config: {
        execution_strategy: "auto",
        web_search: true,
      },
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_submit_turn", {
      request: {
        message: "查一下今天的汇率",
        session_id: "session-runtime-search",
        event_name: "event-runtime-search",
        workspace_id: "workspace-runtime-search",
        queue_if_busy: true,
        queued_turn_id: "queued-turn-1",
        turn_config: {
          execution_strategy: "auto",
          web_search: true,
        },
      },
    });
  });

  it("submitAgentRuntimeTurn 应支持透传 provider/model 偏好字段", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await submitAgentRuntimeTurn({
      message: "请继续",
      session_id: "session-runtime-preference",
      event_name: "event-runtime-preference",
      workspace_id: "workspace-runtime-preference",
      turn_config: {
        provider_preference: "custom-provider",
        model_preference: "gpt-5.3-codex",
        thinking_enabled: true,
        approval_policy: "on-request",
        sandbox_policy: "workspace-write",
      },
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_submit_turn", {
      request: {
        message: "请继续",
        session_id: "session-runtime-preference",
        event_name: "event-runtime-preference",
        workspace_id: "workspace-runtime-preference",
        turn_config: {
          provider_preference: "custom-provider",
          model_preference: "gpt-5.3-codex",
          thinking_enabled: true,
          approval_policy: "on-request",
          sandbox_policy: "workspace-write",
        },
      },
    });
  });

  it("updateAgentRuntimeSession 应支持 recent_access_mode", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await updateAgentRuntimeSession({
      session_id: "session-runtime-access",
      recent_access_mode: "full-access",
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_update_session",
      {
        request: {
          session_id: "session-runtime-access",
          recent_access_mode: "full-access",
        },
      },
    );
  });

  it("updateAgentRuntimeSession 应透传 provider_selector", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await updateAgentRuntimeSession({
      session_id: "session-runtime-provider",
      provider_selector: "custom-cae6e762-fb45-4f71-878c-3106510ade78",
      model_name: "mimo-v2-pro",
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_update_session",
      {
        request: {
          session_id: "session-runtime-provider",
          provider_selector: "custom-cae6e762-fb45-4f71-878c-3106510ade78",
          model_name: "mimo-v2-pro",
        },
      },
    );
  });

  it("respondAgentRuntimeAction 应走统一 action 响应命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await respondAgentRuntimeAction({
      session_id: "session-runtime",
      request_id: "req-runtime",
      action_type: "ask_user",
      confirmed: true,
      response: '{"answer":"A"}',
      user_data: { answer: "A" },
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_respond_action",
      {
        request: {
          session_id: "session-runtime",
          request_id: "req-runtime",
          action_type: "ask_user",
          confirmed: true,
          response: '{"answer":"A"}',
          user_data: { answer: "A" },
        },
      },
    );
  });

  it("respondAgentRuntimeAction 应透传 event_name 以便立即恢复当前执行流", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await respondAgentRuntimeAction({
      session_id: "session-runtime",
      request_id: "req-runtime-resume",
      action_type: "elicitation",
      confirmed: true,
      response: '{"answer":"继续"}',
      user_data: { answer: "继续" },
      event_name: "aster_stream_session-runtime",
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_respond_action",
      {
        request: {
          session_id: "session-runtime",
          request_id: "req-runtime-resume",
          action_type: "elicitation",
          confirmed: true,
          response: '{"answer":"继续"}',
          user_data: { answer: "继续" },
          event_name: "aster_stream_session-runtime",
        },
      },
    );
  });

  it("respondAgentRuntimeAction 应透传 action_scope 以便精确恢复 ask/elicitation", async () => {
    mockSafeInvoke.mockResolvedValueOnce(undefined);

    await respondAgentRuntimeAction({
      session_id: "session-runtime",
      request_id: "req-runtime-scope",
      action_type: "ask_user",
      confirmed: true,
      response: '{"answer":"自动执行"}',
      user_data: { answer: "自动执行" },
      action_scope: {
        session_id: "session-runtime",
        thread_id: "thread-runtime",
        turn_id: "turn-runtime",
      },
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_respond_action",
      {
        request: {
          session_id: "session-runtime",
          request_id: "req-runtime-scope",
          action_type: "ask_user",
          confirmed: true,
          response: '{"answer":"自动执行"}',
          user_data: { answer: "自动执行" },
          action_scope: {
            session_id: "session-runtime",
            thread_id: "thread-runtime",
            turn_id: "turn-runtime",
          },
        },
      },
    );
  });

  it("resumeAgentRuntimeThread 应走统一 runtime resume 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce(true);

    await expect(
      resumeAgentRuntimeThread({
        session_id: "session-runtime-resume",
      }),
    ).resolves.toBe(true);

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_resume_thread", {
      request: {
        session_id: "session-runtime-resume",
      },
    });
  });

  it("replayAgentRuntimeRequest 应走统一 runtime replay 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      type: "action_required",
      request_id: "req-runtime-replay",
      action_type: "ask_user",
      prompt: "请选择执行模式",
    });

    await expect(
      replayAgentRuntimeRequest({
        session_id: "session-runtime-replay",
        request_id: "req-runtime-replay",
      }),
    ).resolves.toMatchObject({
      request_id: "req-runtime-replay",
      action_type: "ask_user",
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_replay_request",
      {
        request: {
          session_id: "session-runtime-replay",
          request_id: "req-runtime-replay",
        },
      },
    );
  });

  it("getAgentRuntimeThreadRead 应走独立 thread_read 命令并归一化 queued_turns", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      thread_id: "thread-runtime",
      status: "waiting_request",
      diagnostics: {
        latest_turn_status: "aborted",
        warning_count: 2,
        context_compaction_count: 1,
        failed_tool_call_count: 1,
        failed_command_count: 0,
        pending_request_count: 0,
        primary_blocking_kind: "context_risk",
        latest_warning: {
          item_id: "warning-1",
          code: "context_compaction_accuracy",
          message: "长对话和多次上下文压缩会降低模型准确性",
          updated_at: "2026-03-23T10:00:00Z",
        },
      },
      queued_turns: [
        {
          queued_turn_id: "queued-turn-1",
          message_preview: "继续执行",
          created_at: 1711184400,
          position: 1,
        },
      ],
    });

    await expect(
      getAgentRuntimeThreadRead("session-runtime"),
    ).resolves.toMatchObject({
      thread_id: "thread-runtime",
      status: "waiting_request",
      diagnostics: {
        latest_turn_status: "aborted",
        warning_count: 2,
        context_compaction_count: 1,
        failed_tool_call_count: 1,
        failed_command_count: 0,
        pending_request_count: 0,
        primary_blocking_kind: "context_risk",
        latest_warning: {
          code: "context_compaction_accuracy",
        },
      },
      queued_turns: [
        expect.objectContaining({
          queued_turn_id: "queued-turn-1",
          position: 1,
        }),
      ],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_get_thread_read",
      {
        sessionId: "session-runtime",
      },
    );
  });

  it("exportAgentRuntimeReplayCase 应走统一 runtime replay case 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      sessionId: "session-runtime-replay-case",
      threadId: "thread-runtime-replay-case",
      replayRelativeRoot:
        ".lime/harness/sessions/session-runtime-replay-case/replay",
      replayAbsoluteRoot:
        "/tmp/workspace/.lime/harness/sessions/session-runtime-replay-case/replay",
      handoffBundleRelativeRoot:
        ".lime/harness/sessions/session-runtime-replay-case",
      evidencePackRelativeRoot:
        ".lime/harness/sessions/session-runtime-replay-case/evidence",
      exportedAt: "2026-03-27T09:50:00.000Z",
      threadStatus: "waiting_request",
      pendingRequestCount: 1,
      queuedTurnCount: 1,
      linkedHandoffArtifactCount: 4,
      linkedEvidenceArtifactCount: 4,
      recentArtifactCount: 2,
      artifacts: [],
    });

    await expect(
      exportAgentRuntimeReplayCase("session-runtime-replay-case"),
    ).resolves.toMatchObject({
      replay_relative_root:
        ".lime/harness/sessions/session-runtime-replay-case/replay",
      linked_handoff_artifact_count: 4,
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_export_replay_case",
      {
        sessionId: "session-runtime-replay-case",
      },
    );
  });

  it("promoteAgentRuntimeQueuedTurn 应走统一 runtime promote 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce(true);

    await expect(
      promoteAgentRuntimeQueuedTurn({
        session_id: "session-runtime",
        queued_turn_id: "queued-turn-2",
      }),
    ).resolves.toBe(true);

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_promote_queued_turn",
      {
        request: {
          session_id: "session-runtime",
          queued_turn_id: "queued-turn-2",
        },
      },
    );
  });

  it("interruptAgentRuntimeTurn 与 updateAgentRuntimeSession 应走统一 runtime 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce(true).mockResolvedValueOnce(undefined);

    await interruptAgentRuntimeTurn({
      session_id: "session-runtime",
      turn_id: "turn-1",
    });
    await updateAgentRuntimeSession({
      session_id: "session-runtime",
      name: "新标题",
      execution_strategy: "auto",
    });

    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      1,
      "agent_runtime_interrupt_turn",
      {
        request: {
          session_id: "session-runtime",
          turn_id: "turn-1",
        },
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      2,
      "agent_runtime_update_session",
      {
        request: {
          session_id: "session-runtime",
          name: "新标题",
          execution_strategy: "auto",
        },
      },
    );
  });

  it("listAgentRuntimeSessions 应返回现役 runtime 会话列表", async () => {
    mockSafeInvoke.mockResolvedValueOnce([
      {
        id: "session-runtime-1",
        name: "Runtime Session",
        model: "claude-sonnet-4-20250514",
        created_at: 1710000000,
        updated_at: 1710000123,
        messages_count: 3,
        execution_strategy: "auto",
        workspace_id: "workspace-1",
        working_dir: "/tmp/workspace-1",
      },
    ]);

    await expect(listAgentRuntimeSessions()).resolves.toEqual([
      {
        id: "session-runtime-1",
        name: "Runtime Session",
        model: "claude-sonnet-4-20250514",
        created_at: 1710000000,
        updated_at: 1710000123,
        messages_count: 3,
        workspace_id: "workspace-1",
        working_dir: "/tmp/workspace-1",
        execution_strategy: "auto",
      },
    ]);
    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_list_sessions");
  });

  it("listAgentRuntimeSessions 应支持请求包含归档会话", async () => {
    mockSafeInvoke.mockResolvedValueOnce([
      {
        id: "session-runtime-archived",
        name: "Archived Runtime Session",
        created_at: 1710000000,
        updated_at: 1710000123,
        archived_at: 1710000300,
      },
    ]);

    await expect(
      listAgentRuntimeSessions({ includeArchived: true }),
    ).resolves.toEqual([
      {
        id: "session-runtime-archived",
        name: "Archived Runtime Session",
        created_at: 1710000000,
        updated_at: 1710000123,
        archived_at: 1710000300,
      },
    ]);

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_list_sessions", {
      request: {
        include_archived: true,
      },
    });
  });

  it("listAgentRuntimeSessions 应支持工作区限流与仅归档过滤", async () => {
    mockSafeInvoke.mockResolvedValueOnce([
      {
        id: "session-runtime-archived",
        name: "Archived Runtime Session",
        created_at: 1710000000,
        updated_at: 1710000123,
        archived_at: 1710000300,
        workspace_id: "workspace-1",
      },
    ]);

    await expect(
      listAgentRuntimeSessions({
        archivedOnly: true,
        workspaceId: "workspace-1",
        limit: 12,
      }),
    ).resolves.toEqual([
      {
        id: "session-runtime-archived",
        name: "Archived Runtime Session",
        created_at: 1710000000,
        updated_at: 1710000123,
        archived_at: 1710000300,
        workspace_id: "workspace-1",
      },
    ]);

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_list_sessions", {
      request: {
        archived_only: true,
        workspace_id: "workspace-1",
        limit: 12,
      },
    });
  });

  it("getAgentRuntimeSession 应返回现役 runtime 详情并归一 queued_turns", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      id: "session-runtime-2",
      name: "Runtime Detail",
      model: "gpt-5.4",
      created_at: 1710001000,
      updated_at: 1710002000,
      workspace_id: "workspace-2",
      working_dir: "/tmp/workspace-2",
      execution_strategy: "react",
      child_subagent_sessions: [
        {
          id: "subagent-session-1",
          name: "Image #1",
          created_at: 1710001200,
          updated_at: 1710001800,
          session_type: "sub_agent",
          model: "gpt-5.4-mini",
          role_hint: "image_editor",
          task_summary: "处理封面图优化",
          origin_tool: "Agent",
          runtime_status: "completed",
        },
      ],
      subagent_parent_context: {
        parent_session_id: "parent-session-1",
        parent_session_name: "主线程会话",
        role_hint: "image_editor",
        task_summary: "处理封面图优化",
        origin_tool: "Agent",
        created_from_turn_id: "turn-2",
        sibling_subagent_sessions: [
          {
            id: "subagent-session-2",
            name: "Image #2",
            created_at: 1710001250,
            updated_at: 1710001850,
            session_type: "sub_agent",
            role_hint: "image_reviewer",
            task_summary: "检查图片导出尺寸",
            runtime_status: "running",
          },
        ],
      },
      queued_turns: [
        {
          queued_turn_id: "queued-1",
          message_text: "排队中的任务",
          message_preview: "排队中的任务",
          created_at: 1710001500,
          image_count: 0,
          position: 2,
        },
      ],
      thread_read: {
        thread_id: "thread-runtime-2",
        status: "running",
        queued_turns: [
          {
            queued_turn_id: "queued-2",
            message_text: "线程读模型中的排队任务",
            message_preview: "线程读模型中的排队任务",
            created_at: 1710001510,
            image_count: 0,
            position: 1,
          },
        ],
      },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1710001000,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "world" }],
          timestamp: 1710002000,
        },
      ],
      items: [
        {
          id: "turn-summary-1",
          thread_id: "thread-runtime-2",
          turn_id: "turn-runtime-2",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-29T10:00:00Z",
          completed_at: "2026-03-29T10:00:02Z",
          updated_at: "2026-03-29T10:00:02Z",
          type: "turn_summary",
          text: "已决定：直接回答优先\n当前请求无需默认升级为搜索或任务。",
        },
      ],
    });

    await expect(getAgentRuntimeSession("session-runtime-2")).resolves.toEqual({
      id: "session-runtime-2",
      name: "Runtime Detail",
      model: "gpt-5.4",
      created_at: 1710001000,
      updated_at: 1710002000,
      workspace_id: "workspace-2",
      working_dir: "/tmp/workspace-2",
      execution_strategy: "react",
      child_subagent_sessions: [
        {
          id: "subagent-session-1",
          name: "Image #1",
          created_at: 1710001200,
          updated_at: 1710001800,
          session_type: "sub_agent",
          model: "gpt-5.4-mini",
          role_hint: "image_editor",
          task_summary: "处理封面图优化",
          origin_tool: "Agent",
          runtime_status: "completed",
        },
      ],
      subagent_parent_context: {
        parent_session_id: "parent-session-1",
        parent_session_name: "主线程会话",
        role_hint: "image_editor",
        task_summary: "处理封面图优化",
        origin_tool: "Agent",
        created_from_turn_id: "turn-2",
        sibling_subagent_sessions: [
          {
            id: "subagent-session-2",
            name: "Image #2",
            created_at: 1710001250,
            updated_at: 1710001850,
            session_type: "sub_agent",
            role_hint: "image_reviewer",
            task_summary: "检查图片导出尺寸",
            runtime_status: "running",
          },
        ],
      },
      queued_turns: [
        {
          queued_turn_id: "queued-1",
          message_text: "排队中的任务",
          message_preview: "排队中的任务",
          created_at: 1710001500,
          image_count: 0,
          position: 2,
        },
      ],
      thread_read: {
        thread_id: "thread-runtime-2",
        status: "running",
        queued_turns: [
          {
            queued_turn_id: "queued-2",
            message_text: "线程读模型中的排队任务",
            message_preview: "线程读模型中的排队任务",
            created_at: 1710001510,
            image_count: 0,
            position: 1,
          },
        ],
      },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          timestamp: 1710001000,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "world" }],
          timestamp: 1710002000,
        },
      ],
      items: [
        {
          id: "turn-summary-1",
          thread_id: "thread-runtime-2",
          turn_id: "turn-runtime-2",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-29T10:00:00Z",
          completed_at: "2026-03-29T10:00:02Z",
          updated_at: "2026-03-29T10:00:02Z",
          type: "turn_summary",
          text: "直接回答优先\n当前请求无需默认升级为搜索或任务。",
        },
      ],
    });
    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_get_session", {
      sessionId: "session-runtime-2",
    });
  });

  it("getAgentRuntimeSession 应支持透传 resume hooks 标记", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      id: "session-runtime-resume",
      messages: [],
    });

    await expect(
      getAgentRuntimeSession("session-runtime-resume", {
        resumeSessionStartHooks: true,
      }),
    ).resolves.toMatchObject({
      id: "session-runtime-resume",
      messages: [],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_get_session", {
      sessionId: "session-runtime-resume",
      resumeSessionStartHooks: true,
    });
  });

  it("getAgentRuntimeSession 应支持透传历史 tail 限制", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      id: "session-runtime-tail",
      messages: [],
    });

    await expect(
      getAgentRuntimeSession("session-runtime-tail", {
        historyLimit: 120,
      }),
    ).resolves.toMatchObject({
      id: "session-runtime-tail",
      messages: [],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_runtime_get_session", {
      sessionId: "session-runtime-tail",
      historyLimit: 120,
    });
  });

  it("exportAgentRuntimeHandoffBundle 应走统一 runtime handoff 导出命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      sessionId: "session-runtime-3",
      threadId: "thread-runtime-3",
      workspaceRoot: "/tmp/workspace-3",
      bundleRelativeRoot: ".lime/harness/sessions/session-runtime-3",
      bundleAbsoluteRoot:
        "/tmp/workspace-3/.lime/harness/sessions/session-runtime-3",
      exportedAt: "2026-03-27T10:00:00Z",
      threadStatus: "running",
      latestTurnStatus: "completed",
      pendingRequestCount: 1,
      queuedTurnCount: 0,
      activeSubagentCount: 2,
      todoTotal: 3,
      todoPending: 1,
      todoInProgress: 1,
      todoCompleted: 1,
      artifacts: [
        {
          kind: "handoff",
          title: "交接摘要",
          relativePath: ".lime/harness/sessions/session-runtime-3/handoff.md",
          absolutePath:
            "/tmp/workspace-3/.lime/harness/sessions/session-runtime-3/handoff.md",
          bytes: 512,
        },
      ],
    });

    await expect(
      exportAgentRuntimeHandoffBundle("session-runtime-3"),
    ).resolves.toMatchObject({
      session_id: "session-runtime-3",
      thread_status: "running",
      pending_request_count: 1,
      artifacts: [
        expect.objectContaining({
          kind: "handoff",
          relative_path: ".lime/harness/sessions/session-runtime-3/handoff.md",
        }),
      ],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_export_handoff_bundle",
      {
        sessionId: "session-runtime-3",
      },
    );
  });

  it("exportAgentRuntimeEvidencePack 应走统一 runtime evidence 导出命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      sessionId: "session-runtime-4",
      threadId: "thread-runtime-4",
      workspaceRoot: "/tmp/workspace-4",
      packRelativeRoot: ".lime/harness/sessions/session-runtime-4/evidence",
      packAbsoluteRoot:
        "/tmp/workspace-4/.lime/harness/sessions/session-runtime-4/evidence",
      exportedAt: "2026-03-27T10:05:00Z",
      threadStatus: "running",
      latestTurnStatus: "running",
      turnCount: 2,
      itemCount: 6,
      pendingRequestCount: 1,
      queuedTurnCount: 1,
      recentArtifactCount: 2,
      knownGaps: [
        "当前环境未找到可读取的 request telemetry 日志目录，Evidence Pack 无法导出会话级请求遥测。",
      ],
      observabilitySummary: {
        schemaVersion: "v1",
        knownGaps: [
          "当前环境未找到可读取的 request telemetry 日志目录，Evidence Pack 无法导出会话级请求遥测。",
        ],
        signalCoverage: [
          {
            signal: "correlation",
            status: "exported",
            source: "runtime thread identity",
            detail: "已导出关联键。",
          },
        ],
        verificationSummary: {
          artifactValidator: {
            applicable: true,
            recordCount: 1,
            issueCount: 0,
            repairedCount: 1,
            fallbackUsedCount: 0,
            outcome: "recovered",
          },
          focusVerificationFailureOutcomes: [],
          focusVerificationRecoveredOutcomes: [
            "Artifact 校验已恢复 1 个产物，fallback 0 次。",
          ],
        },
      },
      artifacts: [
        {
          kind: "summary",
          title: "问题摘要",
          relativePath:
            ".lime/harness/sessions/session-runtime-4/evidence/summary.md",
          absolutePath:
            "/tmp/workspace-4/.lime/harness/sessions/session-runtime-4/evidence/summary.md",
          bytes: 256,
        },
      ],
    });

    await expect(
      exportAgentRuntimeEvidencePack("session-runtime-4"),
    ).resolves.toMatchObject({
      session_id: "session-runtime-4",
      thread_status: "running",
      turn_count: 2,
      known_gaps: [
        "当前环境未找到可读取的 request telemetry 日志目录，Evidence Pack 无法导出会话级请求遥测。",
      ],
      observability_summary: expect.objectContaining({
        schema_version: "v1",
        signal_coverage: [
          expect.objectContaining({
            signal: "correlation",
            status: "exported",
          }),
        ],
        verification_summary: expect.objectContaining({
          artifact_validator: expect.objectContaining({
            applicable: true,
            outcome: "recovered",
          }),
          focus_verification_recovered_outcomes: [
            "Artifact 校验已恢复 1 个产物，fallback 0 次。",
          ],
        }),
      }),
      artifacts: [
        expect.objectContaining({
          kind: "summary",
          relative_path:
            ".lime/harness/sessions/session-runtime-4/evidence/summary.md",
        }),
      ],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_export_evidence_pack",
      {
        sessionId: "session-runtime-4",
      },
    );
  });

  it("exportAgentRuntimeAnalysisHandoff 应兼容 camelCase / snake_case 并走统一 analysis 导出命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      sessionId: "session-runtime-4a",
      threadId: "thread-runtime-4a",
      workspaceRoot: "/tmp/workspace-4a",
      analysisRelativeRoot:
        ".lime/harness/sessions/session-runtime-4a/analysis",
      analysisAbsoluteRoot:
        "/tmp/workspace-4a/.lime/harness/sessions/session-runtime-4a/analysis",
      handoffBundleRelativeRoot: ".lime/harness/sessions/session-runtime-4a",
      evidencePackRelativeRoot:
        ".lime/harness/sessions/session-runtime-4a/evidence",
      replayCaseRelativeRoot:
        ".lime/harness/sessions/session-runtime-4a/replay",
      exportedAt: "2026-03-27T10:08:00Z",
      title: "确认当前失败案例如何交给外部 AI 修复",
      threadStatus: "waiting_request",
      latestTurnStatus: "action_required",
      pendingRequestCount: 1,
      queuedTurnCount: 0,
      sanitizedWorkspaceRoot: "/workspace/lime",
      copyPrompt: "# Lime 外部诊断与修复任务",
      artifacts: [
        {
          kind: "analysis_brief",
          title: "外部分析简报",
          relativePath:
            ".lime/harness/sessions/session-runtime-4a/analysis/analysis-brief.md",
          absolutePath:
            "/tmp/workspace-4a/.lime/harness/sessions/session-runtime-4a/analysis/analysis-brief.md",
          bytes: 320,
        },
      ],
    });

    await expect(
      exportAgentRuntimeAnalysisHandoff("session-runtime-4a"),
    ).resolves.toMatchObject({
      session_id: "session-runtime-4a",
      thread_status: "waiting_request",
      copy_prompt: "# Lime 外部诊断与修复任务",
      artifacts: [
        expect.objectContaining({
          kind: "analysis_brief",
          relative_path:
            ".lime/harness/sessions/session-runtime-4a/analysis/analysis-brief.md",
        }),
      ],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_export_analysis_handoff",
      {
        sessionId: "session-runtime-4a",
      },
    );
  });

  it("exportAgentRuntimeReviewDecisionTemplate 应兼容 camelCase / snake_case 并走统一 review decision 导出命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      sessionId: "session-runtime-4b",
      threadId: "thread-runtime-4b",
      workspaceRoot: "/tmp/workspace-4b",
      reviewRelativeRoot: ".lime/harness/sessions/session-runtime-4b/review",
      reviewAbsoluteRoot:
        "/tmp/workspace-4b/.lime/harness/sessions/session-runtime-4b/review",
      analysisRelativeRoot:
        ".lime/harness/sessions/session-runtime-4b/analysis",
      analysisAbsoluteRoot:
        "/tmp/workspace-4b/.lime/harness/sessions/session-runtime-4b/analysis",
      handoffBundleRelativeRoot: ".lime/harness/sessions/session-runtime-4b",
      evidencePackRelativeRoot:
        ".lime/harness/sessions/session-runtime-4b/evidence",
      replayCaseRelativeRoot:
        ".lime/harness/sessions/session-runtime-4b/replay",
      exportedAt: "2026-03-27T10:18:00Z",
      title: "记录人工审核决策",
      threadStatus: "waiting_request",
      latestTurnStatus: "action_required",
      pendingRequestCount: 1,
      queuedTurnCount: 0,
      defaultDecisionStatus: "pending_review",
      verificationSummary: {
        artifactValidator: {
          applicable: true,
          recordCount: 1,
          issueCount: 2,
          repairedCount: 1,
          fallbackUsedCount: 0,
          outcome: "blocking_failure",
        },
        focusVerificationFailureOutcomes: [
          "Artifact 校验存在 2 条未恢复 issues。",
        ],
        focusVerificationRecoveredOutcomes: [
          "Artifact 校验已恢复 1 个产物，fallback 0 次。",
        ],
      },
      decision: {
        decisionStatus: "pending_review",
        decisionSummary: "",
        chosenFixStrategy: "",
        riskLevel: "unknown",
        riskTags: [],
        humanReviewer: "",
        reviewedAt: null,
        followupActions: [
          "先对照 analysis-context.json / evidence/runtime.json 核对当前验证失败焦点，再决定是继续修复还是补证据。",
          "复查 Artifact 校验相关产物，确认 issues / repaired / fallback 状态与最终结论一致。",
        ],
        regressionRequirements: [
          "按 replay case 复现问题并确认修复后行为与预期一致。",
          "重新导出 evidence pack，确认 Artifact 校验摘要已更新。",
        ],
        notes: "",
      },
      decisionStatusOptions: [
        "accepted",
        "deferred",
        "rejected",
        "needs_more_evidence",
        "pending_review",
      ],
      riskLevelOptions: ["low", "medium", "high", "unknown"],
      reviewChecklist: ["先阅读 analysis-brief.md"],
      analysisArtifacts: [
        {
          kind: "analysis_brief",
          title: "外部分析简报",
          relativePath:
            ".lime/harness/sessions/session-runtime-4b/analysis/analysis-brief.md",
          absolutePath:
            "/tmp/workspace-4b/.lime/harness/sessions/session-runtime-4b/analysis/analysis-brief.md",
          bytes: 320,
        },
      ],
      artifacts: [
        {
          kind: "review_decision_json",
          title: "人工审核记录 JSON",
          relativePath:
            ".lime/harness/sessions/session-runtime-4b/review/review-decision.json",
          absolutePath:
            "/tmp/workspace-4b/.lime/harness/sessions/session-runtime-4b/review/review-decision.json",
          bytes: 256,
        },
      ],
    });

    await expect(
      exportAgentRuntimeReviewDecisionTemplate("session-runtime-4b"),
    ).resolves.toMatchObject({
      session_id: "session-runtime-4b",
      default_decision_status: "pending_review",
      verification_summary: expect.objectContaining({
        artifact_validator: expect.objectContaining({
          outcome: "blocking_failure",
          issue_count: 2,
        }),
        focus_verification_failure_outcomes: [
          "Artifact 校验存在 2 条未恢复 issues。",
        ],
        focus_verification_recovered_outcomes: [
          "Artifact 校验已恢复 1 个产物，fallback 0 次。",
        ],
      }),
      decision: expect.objectContaining({
        decision_status: "pending_review",
        risk_level: "unknown",
        followup_actions: [
          "先对照 analysis-context.json / evidence/runtime.json 核对当前验证失败焦点，再决定是继续修复还是补证据。",
          "复查 Artifact 校验相关产物，确认 issues / repaired / fallback 状态与最终结论一致。",
        ],
        regression_requirements: [
          "按 replay case 复现问题并确认修复后行为与预期一致。",
          "重新导出 evidence pack，确认 Artifact 校验摘要已更新。",
        ],
      }),
      decision_status_options: expect.arrayContaining(["accepted"]),
      risk_level_options: expect.arrayContaining(["medium"]),
      review_checklist: ["先阅读 analysis-brief.md"],
      analysis_artifacts: [
        expect.objectContaining({
          kind: "analysis_brief",
          relative_path:
            ".lime/harness/sessions/session-runtime-4b/analysis/analysis-brief.md",
        }),
      ],
      artifacts: [
        expect.objectContaining({
          kind: "review_decision_json",
          relative_path:
            ".lime/harness/sessions/session-runtime-4b/review/review-decision.json",
        }),
      ],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_export_review_decision_template",
      {
        sessionId: "session-runtime-4b",
      },
    );
  });

  it("saveAgentRuntimeReviewDecision 应走统一 review decision 保存命令并归一化返回结构", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      sessionId: "session-runtime-4c",
      threadId: "thread-runtime-4c",
      workspaceRoot: "/tmp/workspace-4c",
      reviewRelativeRoot: ".lime/harness/sessions/session-runtime-4c/review",
      reviewAbsoluteRoot:
        "/tmp/workspace-4c/.lime/harness/sessions/session-runtime-4c/review",
      analysisRelativeRoot:
        ".lime/harness/sessions/session-runtime-4c/analysis",
      analysisAbsoluteRoot:
        "/tmp/workspace-4c/.lime/harness/sessions/session-runtime-4c/analysis",
      handoffBundleRelativeRoot: ".lime/harness/sessions/session-runtime-4c",
      evidencePackRelativeRoot:
        ".lime/harness/sessions/session-runtime-4c/evidence",
      replayCaseRelativeRoot:
        ".lime/harness/sessions/session-runtime-4c/replay",
      exportedAt: "2026-03-27T10:25:00Z",
      title: "保存人工审核结论",
      threadStatus: "waiting_request",
      latestTurnStatus: "action_required",
      pendingRequestCount: 1,
      queuedTurnCount: 0,
      defaultDecisionStatus: "pending_review",
      verificationSummary: {
        artifactValidator: {
          applicable: true,
          recordCount: 1,
          issueCount: 0,
          repairedCount: 1,
          fallbackUsedCount: 0,
          outcome: "recovered",
        },
        focusVerificationFailureOutcomes: [],
        focusVerificationRecoveredOutcomes: [
          "Artifact 校验已恢复 1 个产物，fallback 0 次。",
        ],
      },
      decision: {
        decisionStatus: "accepted",
        decisionSummary: "确认最小修复可接受。",
        chosenFixStrategy: "先收口 runtime 命令，再补 UI 回归。",
        riskLevel: "medium",
        riskTags: ["runtime", "ui"],
        humanReviewer: "Lime Maintainer",
        reviewedAt: "2026-03-27T10:25:00Z",
        followupActions: ["补充 HarnessStatusPanel 测试"],
        regressionRequirements: ["npm run test:contracts"],
        notes: "保持 review decision 主链单一。",
      },
      decisionStatusOptions: [
        "accepted",
        "deferred",
        "rejected",
        "needs_more_evidence",
        "pending_review",
      ],
      riskLevelOptions: ["low", "medium", "high", "unknown"],
      reviewChecklist: ["先阅读 analysis-brief.md"],
      analysisArtifacts: [
        {
          kind: "analysis_brief",
          title: "外部分析简报",
          relativePath:
            ".lime/harness/sessions/session-runtime-4c/analysis/analysis-brief.md",
          absolutePath:
            "/tmp/workspace-4c/.lime/harness/sessions/session-runtime-4c/analysis/analysis-brief.md",
          bytes: 320,
        },
      ],
      artifacts: [
        {
          kind: "review_decision_markdown",
          title: "人工审核记录",
          relativePath:
            ".lime/harness/sessions/session-runtime-4c/review/review-decision.md",
          absolutePath:
            "/tmp/workspace-4c/.lime/harness/sessions/session-runtime-4c/review/review-decision.md",
          bytes: 512,
        },
      ],
    });

    await expect(
      saveAgentRuntimeReviewDecision({
        session_id: "session-runtime-4c",
        decision_status: "accepted",
        decision_summary: "确认最小修复可接受。",
        chosen_fix_strategy: "先收口 runtime 命令，再补 UI 回归。",
        risk_level: "medium",
        risk_tags: ["runtime", "ui"],
        human_reviewer: "Lime Maintainer",
        reviewed_at: "2026-03-27T10:25:00Z",
        followup_actions: ["补充 HarnessStatusPanel 测试"],
        regression_requirements: ["npm run test:contracts"],
        notes: "保持 review decision 主链单一。",
      }),
    ).resolves.toMatchObject({
      session_id: "session-runtime-4c",
      verification_summary: expect.objectContaining({
        artifact_validator: expect.objectContaining({
          outcome: "recovered",
          repaired_count: 1,
        }),
      }),
      decision: expect.objectContaining({
        decision_status: "accepted",
        risk_level: "medium",
        risk_tags: ["runtime", "ui"],
      }),
      artifacts: [
        expect.objectContaining({
          kind: "review_decision_markdown",
        }),
      ],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_save_review_decision",
      {
        request: {
          session_id: "session-runtime-4c",
          decision_status: "accepted",
          decision_summary: "确认最小修复可接受。",
          chosen_fix_strategy: "先收口 runtime 命令，再补 UI 回归。",
          risk_level: "medium",
          risk_tags: ["runtime", "ui"],
          human_reviewer: "Lime Maintainer",
          reviewed_at: "2026-03-27T10:25:00Z",
          followup_actions: ["补充 HarnessStatusPanel 测试"],
          regression_requirements: ["npm run test:contracts"],
          notes: "保持 review decision 主链单一。",
        },
      },
    );
  });

  it("getAgentRuntimeToolInventory 应走统一 runtime inventory 命令", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      request: {
        caller: "assistant",
        surface: {
          workbench: true,
          browser_assist: true,
        },
      },
      agent_initialized: true,
      warnings: [],
      mcp_servers: ["docs"],
      default_allowed_tools: ["ToolSearch"],
      counts: {
        catalog_total: 1,
        catalog_current_total: 1,
        catalog_compat_total: 0,
        catalog_deprecated_total: 0,
        default_allowed_total: 1,
        registry_total: 1,
        registry_visible_total: 1,
        registry_catalog_unmapped_total: 0,
        extension_surface_total: 1,
        extension_mcp_bridge_total: 1,
        extension_runtime_total: 0,
        extension_tool_total: 1,
        extension_tool_visible_total: 1,
        mcp_server_total: 1,
        mcp_tool_total: 1,
        mcp_tool_visible_total: 1,
      },
      catalog_tools: [
        {
          name: "bash",
          profiles: ["core"],
          capabilities: ["execution"],
          lifecycle: "current",
          source: "aster_builtin",
          permission_plane: "parameter_restricted",
          workspace_default_allow: false,
          execution_warning_policy: "shell_command_risk",
          execution_warning_policy_source: "default",
          execution_restriction_profile: "workspace_shell_command",
          execution_restriction_profile_source: "runtime",
          execution_sandbox_profile: "workspace_command",
          execution_sandbox_profile_source: "persisted",
        },
      ],
      registry_tools: [
        {
          name: "bash",
          description: "workspace bash",
          catalog_entry_name: "bash",
          catalog_source: "aster_builtin",
          catalog_lifecycle: "current",
          catalog_permission_plane: "parameter_restricted",
          catalog_workspace_default_allow: false,
          catalog_execution_warning_policy: "shell_command_risk",
          catalog_execution_warning_policy_source: "default",
          catalog_execution_restriction_profile: "workspace_shell_command",
          catalog_execution_restriction_profile_source: "runtime",
          catalog_execution_sandbox_profile: "workspace_command",
          catalog_execution_sandbox_profile_source: "persisted",
          deferred_loading: false,
          always_visible: true,
          allowed_callers: ["assistant"],
          tags: [],
          input_examples_count: 0,
          caller_allowed: true,
          visible_in_context: true,
        },
      ],
      extension_surfaces: [],
      extension_tools: [],
      mcp_tools: [],
    });

    await expect(
      getAgentRuntimeToolInventory({
        workbench: true,
        browserAssist: true,
        caller: "assistant",
      }),
    ).resolves.toMatchObject({
      request: {
        caller: "assistant",
        surface: {
          workbench: true,
          browser_assist: true,
        },
      },
      counts: {
        catalog_total: 1,
      },
      catalog_tools: [
        expect.objectContaining({
          execution_warning_policy_source: "default",
          execution_restriction_profile_source: "runtime",
          execution_sandbox_profile_source: "persisted",
        }),
      ],
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_get_tool_inventory",
      {
        request: {
          workbench: true,
          browserAssist: true,
          caller: "assistant",
        },
      },
    );
  });

  it("getAgentRuntimeToolInventory 应透传 metadata 以计算 effective policy", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      request: {
        caller: "assistant",
        surface: {
          workbench: false,
          browser_assist: false,
        },
      },
      agent_initialized: true,
      warnings: [],
      mcp_servers: [],
      default_allowed_tools: [],
      counts: {
        catalog_total: 0,
        catalog_current_total: 0,
        catalog_compat_total: 0,
        catalog_deprecated_total: 0,
        default_allowed_total: 0,
        registry_total: 0,
        registry_visible_total: 0,
        registry_catalog_unmapped_total: 0,
        extension_surface_total: 0,
        extension_mcp_bridge_total: 0,
        extension_runtime_total: 0,
        extension_tool_total: 0,
        extension_tool_visible_total: 0,
        mcp_server_total: 0,
        mcp_tool_total: 0,
        mcp_tool_visible_total: 0,
      },
      catalog_tools: [],
      registry_tools: [],
      extension_surfaces: [],
      extension_tools: [],
      mcp_tools: [],
    });

    await getAgentRuntimeToolInventory({
      caller: "assistant",
      metadata: {
        harness: {
          executionPolicy: {
            toolOverrides: {
              bash: {
                warningPolicy: "none",
              },
            },
          },
        },
      },
    });

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_get_tool_inventory",
      {
        request: {
          caller: "assistant",
          metadata: {
            harness: {
              executionPolicy: {
                toolOverrides: {
                  bash: {
                    warningPolicy: "none",
                  },
                },
              },
            },
          },
        },
      },
    );
  });

  it("getAgentRuntimeToolInventory 默认请求应传空对象", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      request: {
        caller: "assistant",
        surface: {
          workbench: false,
          browser_assist: false,
        },
      },
      agent_initialized: false,
      warnings: [],
      mcp_servers: [],
      default_allowed_tools: [],
      counts: {
        catalog_total: 0,
        catalog_current_total: 0,
        catalog_compat_total: 0,
        catalog_deprecated_total: 0,
        default_allowed_total: 0,
        registry_total: 0,
        registry_visible_total: 0,
        registry_catalog_unmapped_total: 0,
        extension_surface_total: 0,
        extension_mcp_bridge_total: 0,
        extension_runtime_total: 0,
        extension_tool_total: 0,
        extension_tool_visible_total: 0,
        mcp_server_total: 0,
        mcp_tool_total: 0,
        mcp_tool_visible_total: 0,
      },
      catalog_tools: [],
      registry_tools: [],
      extension_surfaces: [],
      extension_tools: [],
      mcp_tools: [],
    });

    await getAgentRuntimeToolInventory();

    expect(mockSafeInvoke).toHaveBeenCalledWith(
      "agent_runtime_get_tool_inventory",
      {
        request: {},
      },
    );
  });

  it("deleteAgentRuntimeSession / updateAgentRuntimeSession / generateAgentRuntimeSessionTitle 应走现役命令", async () => {
    mockSafeInvoke
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("新的智能标题");

    await deleteAgentRuntimeSession("session-runtime-3");
    await updateAgentRuntimeSession({
      session_id: "session-runtime-3",
      name: "重命名后的标题",
    });
    await expect(
      generateAgentRuntimeSessionTitle("session-runtime-3"),
    ).resolves.toBe("新的智能标题");

    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      1,
      "agent_runtime_delete_session",
      {
        sessionId: "session-runtime-3",
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      2,
      "agent_runtime_update_session",
      {
        request: {
          session_id: "session-runtime-3",
          name: "重命名后的标题",
        },
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(3, "agent_generate_title", {
      sessionId: "session-runtime-3",
      titleKind: "session",
    });
  });

  it("generateAgentRuntimeTitle 应支持图片任务命名预览", async () => {
    mockSafeInvoke.mockResolvedValueOnce("城市夜景主视觉");

    await expect(
      generateAgentRuntimeTitle({
        previewText: "赛博朋克风城市夜景主视觉",
        titleKind: "image_task",
      }),
    ).resolves.toBe("城市夜景主视觉");

    expect(mockSafeInvoke).toHaveBeenCalledWith("agent_generate_title", {
      previewText: "赛博朋克风城市夜景主视觉",
      titleKind: "image_task",
    });
  });

  it("generateAgentRuntimeTitleResult 应保留 generation_topic runtime task profile", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      title: "城市夜景主视觉",
      sessionId: "title-gen-1",
      executionRuntime: {
        session_id: "title-gen-1",
        source: "runtime_snapshot",
        task_profile: {
          kind: "generation_topic",
          source: "auxiliary_generation_topic",
          service_model_slot: "generation_topic",
        },
        routing_decision: {
          routingMode: "single_candidate",
          decisionSource: "service_model_setting",
          decisionReason: "命中 service_models.generation_topic",
          candidateCount: 1,
        },
      },
      usedFallback: false,
    });

    const result = await generateAgentRuntimeTitleResult({
      previewText: "赛博朋克风城市夜景主视觉",
      titleKind: "image_task",
    });

    expect(result.executionRuntime?.task_profile).toMatchObject({
      kind: "generation_topic",
      source: "auxiliary_generation_topic",
      service_model_slot: "generation_topic",
    });
    expect(result.executionRuntime?.routing_decision).toMatchObject({
      decisionReason: "命中 service_models.generation_topic",
    });
  });

  it("generateAgentRuntimeTitleResult 应解析 runtime 诊断结果", async () => {
    mockSafeInvoke.mockResolvedValueOnce({
      title: "城市夜景主视觉",
      sessionId: "title-gen-1",
      executionRuntime: {
        session_id: "title-gen-1",
        source: "runtime_snapshot",
        task_profile: {
          kind: "generation_topic",
          source: "auxiliary_generation_topic",
        },
        routing_decision: {
          routingMode: "single_candidate",
          decisionSource: "service_model_setting",
          decisionReason: "命中 service_models.generation_topic",
          candidateCount: 1,
        },
        limit_state: {
          status: "single_candidate_only",
          singleCandidateOnly: true,
          providerLocked: true,
          settingsLocked: true,
          oemLocked: false,
          candidateCount: 1,
        },
        cost_state: {
          status: "estimated",
          estimatedCostClass: "low",
        },
      },
      usedFallback: false,
    });

    await expect(
      generateAgentRuntimeTitleResult({
        previewText: "赛博朋克风城市夜景主视觉",
        titleKind: "image_task",
      }),
    ).resolves.toEqual({
      title: "城市夜景主视觉",
      sessionId: "title-gen-1",
      executionRuntime: {
        session_id: "title-gen-1",
        source: "runtime_snapshot",
        task_profile: {
          kind: "generation_topic",
          source: "auxiliary_generation_topic",
        },
        routing_decision: {
          routingMode: "single_candidate",
          decisionSource: "service_model_setting",
          decisionReason: "命中 service_models.generation_topic",
          candidateCount: 1,
        },
        limit_state: {
          status: "single_candidate_only",
          singleCandidateOnly: true,
          providerLocked: true,
          settingsLocked: true,
          oemLocked: false,
          candidateCount: 1,
        },
        cost_state: {
          status: "estimated",
          estimatedCostClass: "low",
        },
      },
      usedFallback: false,
      fallbackReason: null,
    });
  });

  it("subagent 控制面 helper 应走统一 runtime 命令", async () => {
    mockSafeInvoke
      .mockResolvedValueOnce({
        agent_id: "subagent-session-1",
        nickname: "Image #1",
      })
      .mockResolvedValueOnce({
        submission_id: "queued-subagent-1",
      })
      .mockResolvedValueOnce({
        status: {
          "subagent-session-1": {
            session_id: "subagent-session-1",
            kind: "completed",
          },
        },
        timed_out: false,
      })
      .mockResolvedValueOnce({
        status: {
          session_id: "subagent-session-1",
          kind: "idle",
        },
        cascade_session_ids: ["subagent-session-1", "subagent-child-1"],
        changed_session_ids: ["subagent-session-1", "subagent-child-1"],
      })
      .mockResolvedValueOnce({
        previous_status: {
          session_id: "subagent-session-1",
          kind: "running",
        },
        cascade_session_ids: ["subagent-session-1", "subagent-child-1"],
        changed_session_ids: ["subagent-session-1", "subagent-child-1"],
      });

    await expect(
      spawnAgentRuntimeSubagent({
        parent_session_id: "session-runtime-parent",
        message: "处理 Image #1",
        agent_type: "image_editor",
      }),
    ).resolves.toEqual({
      agent_id: "subagent-session-1",
      nickname: "Image #1",
    });
    await expect(
      sendAgentRuntimeSubagentInput({
        id: "subagent-session-1",
        message: "继续优化导出尺寸",
        interrupt: true,
      }),
    ).resolves.toEqual({
      submission_id: "queued-subagent-1",
    });
    await expect(
      waitAgentRuntimeSubagents({
        ids: ["subagent-session-1"],
        timeout_ms: 12000,
      }),
    ).resolves.toEqual({
      status: {
        "subagent-session-1": {
          session_id: "subagent-session-1",
          kind: "completed",
        },
      },
      timed_out: false,
    });
    await expect(
      resumeAgentRuntimeSubagent({ id: "subagent-session-1" }),
    ).resolves.toEqual({
      status: {
        session_id: "subagent-session-1",
        kind: "idle",
      },
      cascade_session_ids: ["subagent-session-1", "subagent-child-1"],
      changed_session_ids: ["subagent-session-1", "subagent-child-1"],
    });
    await expect(
      closeAgentRuntimeSubagent({ id: "subagent-session-1" }),
    ).resolves.toEqual({
      previous_status: {
        session_id: "subagent-session-1",
        kind: "running",
      },
      cascade_session_ids: ["subagent-session-1", "subagent-child-1"],
      changed_session_ids: ["subagent-session-1", "subagent-child-1"],
    });

    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      1,
      "agent_runtime_spawn_subagent",
      {
        request: {
          parent_session_id: "session-runtime-parent",
          message: "处理 Image #1",
          agent_type: "image_editor",
        },
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      2,
      "agent_runtime_send_subagent_input",
      {
        request: {
          id: "subagent-session-1",
          message: "继续优化导出尺寸",
          interrupt: true,
        },
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      3,
      "agent_runtime_wait_subagents",
      {
        request: {
          ids: ["subagent-session-1"],
          timeout_ms: 12000,
        },
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      4,
      "agent_runtime_resume_subagent",
      {
        request: {
          id: "subagent-session-1",
        },
      },
    );
    expect(mockSafeInvoke).toHaveBeenNthCalledWith(
      5,
      "agent_runtime_close_subagent",
      {
        request: {
          id: "subagent-session-1",
        },
      },
    );
  });
});
