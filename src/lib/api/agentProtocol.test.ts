import { describe, expect, it } from "vitest";
import {
  createSubmitTurnRequestFromAgentOp,
  parseAgentEvent,
} from "./agentProtocol";

describe("agentProtocol", () => {
  it("应将 AgentOp.user_input 适配为现有 runtime submit request", () => {
    expect(
      createSubmitTurnRequestFromAgentOp({
        type: "user_input",
        text: "继续处理这段对话",
        sessionId: "session-1",
        eventName: "aster_stream_session-1",
        workspaceId: "workspace-1",
        turnId: "turn-1",
        preferences: {
          providerPreference: "openai",
          modelPreference: "gpt-5.4",
          thinking: true,
          webSearch: false,
          searchMode: "disabled",
          executionStrategy: "react",
          autoContinue: {
            enabled: true,
            fast_mode_enabled: false,
            continuation_length: 3,
            sensitivity: 0.6,
          },
        },
        systemPrompt: "保持简洁",
        metadata: {
          harness: {
            theme: "general",
          },
        },
        queueIfBusy: true,
        queuedTurnId: "queued-1",
      }),
    ).toEqual({
      message: "继续处理这段对话",
      session_id: "session-1",
      event_name: "aster_stream_session-1",
      workspace_id: "workspace-1",
      turn_id: "turn-1",
      turn_config: {
        provider_preference: "openai",
        model_preference: "gpt-5.4",
        thinking_enabled: true,
        execution_strategy: "react",
        web_search: false,
        search_mode: "disabled",
        auto_continue: {
          enabled: true,
          fast_mode_enabled: false,
          continuation_length: 3,
          sensitivity: 0.6,
        },
        system_prompt: "保持简洁",
        metadata: {
          harness: {
            theme: "general",
          },
        },
      },
      queue_if_busy: true,
      queued_turn_id: "queued-1",
    });
  });

  it("应沿用现有流式解析逻辑解析 AgentEvent", () => {
    expect(
      parseAgentEvent({
        type: "artifact_snapshot",
        artifact: {
          artifact_id: "artifact-1",
          file_path: "drafts/demo.md",
          metadata: {
            complete: false,
          },
        },
      }),
    ).toEqual({
      type: "artifact_snapshot",
      artifact: {
        artifactId: "artifact-1",
        filePath: "drafts/demo.md",
        content: undefined,
        metadata: {
          complete: false,
        },
      },
    });
  });

  it("应解析 action_required 的 scope，并兼容嵌套 data.scope", () => {
    expect(
      parseAgentEvent({
        type: "action_required",
        request_id: "req-scope-1",
        action_type: "ask_user",
        scope: {
          sessionId: "session-1",
          thread_id: "thread-1",
          turnId: "turn-1",
        },
        prompt: "请选择执行模式",
        questions: [{ question: "请选择执行模式" }],
      }),
    ).toMatchObject({
      type: "action_required",
      request_id: "req-scope-1",
      action_type: "ask_user",
      prompt: "请选择执行模式",
      scope: {
        session_id: "session-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
      },
    });

    expect(
      parseAgentEvent({
        type: "action_required",
        data: {
          id: "req-scope-2",
          type: "elicitation",
          message: "请补充发布渠道",
          requested_schema: {
            type: "object",
            properties: {
              channel: {
                type: "string",
              },
            },
          },
          scope: {
            session_id: "session-2",
            threadId: "thread-2",
          },
        },
      }),
    ).toMatchObject({
      type: "action_required",
      request_id: "req-scope-2",
      action_type: "elicitation",
      prompt: "请补充发布渠道",
      requested_schema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
          },
        },
      },
      scope: {
        session_id: "session-2",
        thread_id: "thread-2",
      },
    });
  });

  it("兼容嵌套 artifact_snapshot 结构", () => {
    expect(
      parseAgentEvent({
        type: "artifact_snapshot",
        artifact: {
          artifactId: "artifact-1",
          filePath: "drafts/demo.md",
          content: "# 标题",
          metadata: {
            complete: false,
            writePhase: "streaming",
          },
        },
      }),
    ).toEqual({
      type: "artifact_snapshot",
      artifact: {
        artifactId: "artifact-1",
        filePath: "drafts/demo.md",
        content: "# 标题",
        metadata: {
          complete: false,
          writePhase: "streaming",
        },
      },
    });
  });

  it("应解析 runtime_status 与 thinking_delta 事件", () => {
    expect(
      parseAgentEvent({
        type: "runtime_status",
        status: {
          phase: "routing",
          title: "已决定：先深度思考",
          detail: "先做意图理解，再决定是否搜索。",
          checkpoints: ["thinking 已开启", "搜索保持候选状态"],
        },
      }),
    ).toEqual({
      type: "runtime_status",
      status: {
        phase: "routing",
        title: "已决定：先深度思考",
        detail: "先做意图理解，再决定是否搜索。",
        checkpoints: ["thinking 已开启", "搜索保持候选状态"],
      },
    });

    expect(
      parseAgentEvent({
        type: "thinking_delta",
        text: "先判断任务性质",
      }),
    ).toEqual({
      type: "thinking_delta",
      text: "先判断任务性质",
    });
  });

  it("应解析队列事件", () => {
    expect(
      parseAgentEvent({
        type: "queue_added",
        session_id: "session-1",
        queued_turn: {
          queued_turn_id: "queued-1",
          message_preview: "继续写完提案",
          message_text: "继续写完提案，补齐目录结构并输出一版正式稿",
          created_at: 1700000000000,
          image_count: 1,
          position: 1,
        },
      }),
    ).toEqual({
      type: "queue_added",
      session_id: "session-1",
      queued_turn: {
        queued_turn_id: "queued-1",
        message_preview: "继续写完提案",
        message_text: "继续写完提案，补齐目录结构并输出一版正式稿",
        created_at: 1700000000000,
        image_count: 1,
        position: 1,
      },
    });
  });

  it("应保留 context_compaction item 类型", () => {
    expect(
      parseAgentEvent({
        type: "item_started",
        item: {
          id: "context-compaction-1",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 3,
          status: "in_progress",
          started_at: "2026-03-23T00:00:00Z",
          updated_at: "2026-03-23T00:00:00Z",
          type: "context_compaction",
          stage: "started",
          trigger: "manual",
          detail: "Compacting session history",
        },
      }),
    ).toEqual({
      type: "item_started",
      item: {
        id: "context-compaction-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 3,
        status: "in_progress",
        started_at: "2026-03-23T00:00:00Z",
        updated_at: "2026-03-23T00:00:00Z",
        type: "context_compaction",
        stage: "started",
        trigger: "manual",
        detail: "Compacting session history",
      },
    });
  });

  it("应兼容 camelCase 的队列快照字段", () => {
    expect(
      parseAgentEvent({
        type: "queue_added",
        session_id: "session-2",
        queued_turn: {
          queuedTurnId: "queued-2",
          messagePreview: "整理采访提纲",
          messageText: "整理采访提纲，并补上关键追问问题",
          createdAt: 1700000000001,
          imageCount: 2,
          position: 3,
        },
      }),
    ).toEqual({
      type: "queue_added",
      session_id: "session-2",
      queued_turn: {
        queued_turn_id: "queued-2",
        message_preview: "整理采访提纲",
        message_text: "整理采访提纲，并补上关键追问问题",
        created_at: 1700000000001,
        image_count: 2,
        position: 3,
      },
    });
  });

  it("应解析 subagent_status_changed 事件", () => {
    expect(
      parseAgentEvent({
        type: "subagent_status_changed",
        session_id: "child-1",
        root_session_id: "root-1",
        parent_session_id: "parent-1",
        status: "running",
      }),
    ).toEqual({
      type: "subagent_status_changed",
      session_id: "child-1",
      root_session_id: "root-1",
      parent_session_id: "parent-1",
      status: "running",
    });
  });
});
