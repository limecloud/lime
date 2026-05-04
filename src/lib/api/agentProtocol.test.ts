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
          approvalPolicy: "on-request",
          sandboxPolicy: "workspace-write",
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
        skipPreSubmitResume: true,
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
        approval_policy: "on-request",
        sandbox_policy: "workspace-write",
        execution_strategy: "react",
        web_search: false,
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
      skip_pre_submit_resume: true,
    });
  });

  it("缺少 workspaceId 时不应在 runtime submit request 中生成 workspace_id", () => {
    expect(
      createSubmitTurnRequestFromAgentOp({
        type: "user_input",
        text: "继续处理这段对话",
        sessionId: "session-1",
        eventName: "aster_stream_session-1",
        preferences: {
          webSearch: true,
        },
      }),
    ).toEqual({
      message: "继续处理这段对话",
      session_id: "session-1",
      event_name: "aster_stream_session-1",
      turn_config: {
        web_search: true,
        system_prompt: undefined,
        metadata: undefined,
        provider_preference: undefined,
        model_preference: undefined,
        thinking_enabled: undefined,
        approval_policy: undefined,
        sandbox_policy: undefined,
        execution_strategy: undefined,
        auto_continue: undefined,
      },
      queue_if_busy: undefined,
      queued_turn_id: undefined,
      skip_pre_submit_resume: undefined,
      turn_id: undefined,
      images: undefined,
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
        title: "先深度思考",
        detail: "先做意图理解，再决定是否搜索。",
        checkpoints: ["thinking 已开启", "搜索保持候选状态"],
      },
    });

    expect(
      parseAgentEvent({
        type: "runtime_status",
        status: {
          phase: "permission_review",
          title: "运行时权限需要确认",
          detail: "当前执行画像声明了 2 项权限。",
          metadata: {
            permission_status: "requires_confirmation",
            required_profile_keys: ["read_files", "write_artifacts"],
            ask_profile_keys: ["read_files", "write_artifacts"],
            blocking_profile_keys: [],
            decision_source: "modality_execution_profile",
            decision_scope: "declared_profile",
            confirmation_status: "not_requested",
            confirmation_source: "declared_profile_only",
            declared_only: true,
          },
        },
      }),
    ).toEqual({
      type: "runtime_status",
      status: {
        phase: "permission_review",
        title: "运行时权限需要确认",
        detail: "当前执行画像声明了 2 项权限。",
        checkpoints: undefined,
        metadata: {
          team_phase: undefined,
          team_parallel_budget: undefined,
          team_active_count: undefined,
          team_queued_count: undefined,
          concurrency_phase: undefined,
          concurrency_scope: undefined,
          concurrency_active_count: undefined,
          concurrency_queued_count: undefined,
          concurrency_budget: undefined,
          provider_concurrency_group: undefined,
          provider_parallel_budget: undefined,
          queue_reason: undefined,
          retryable_overload: undefined,
          permission_status: "requires_confirmation",
          required_profile_keys: ["read_files", "write_artifacts"],
          ask_profile_keys: ["read_files", "write_artifacts"],
          blocking_profile_keys: [],
          decision_source: "modality_execution_profile",
          decision_scope: "declared_profile",
          confirmation_status: "not_requested",
          confirmation_request_id: undefined,
          confirmation_source: "declared_profile_only",
          declared_only: true,
        },
      },
    });

    expect(
      parseAgentEvent({
        type: "item_updated",
        item: {
          id: "turn-summary-1",
          thread_id: "thread-1",
          turn_id: "turn-1",
          sequence: 1,
          status: "completed",
          started_at: "2026-03-29T10:00:00Z",
          completed_at: "2026-03-29T10:00:01Z",
          updated_at: "2026-03-29T10:00:01Z",
          type: "turn_summary",
          text: "已决定：直接回答优先\n当前请求无需默认升级为搜索或任务。",
        },
      }),
    ).toEqual({
      type: "item_updated",
      item: {
        id: "turn-summary-1",
        thread_id: "thread-1",
        turn_id: "turn-1",
        sequence: 1,
        status: "completed",
        started_at: "2026-03-29T10:00:00Z",
        completed_at: "2026-03-29T10:00:01Z",
        updated_at: "2026-03-29T10:00:01Z",
        type: "turn_summary",
        text: "直接回答优先\n当前请求无需默认升级为搜索或任务。",
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

  it("应解析任务路由链事件", () => {
    expect(
      parseAgentEvent({
        type: "task_profile_resolved",
        task_profile: {
          kind: "browser_control",
          source: "runtime_contract",
          traits: [
            "modality_runtime_contract",
            "execution_profile",
            "executor_adapter",
          ],
          modalityContractKey: "browser_control",
          routingSlot: "browser_reasoning_model",
          executionProfileKey: "browser_control_profile",
          executorAdapterKey: "browser:browser_assist",
          executorKind: "browser",
          executorBindingKey: "browser_assist",
          permissionProfileKeys: [
            "browser_control",
            "web_search",
            "ask_user_question",
          ],
          userLockPolicy: "honor_explicit_model_lock_with_capability_check",
        },
      }),
    ).toEqual({
      type: "task_profile_resolved",
      task_profile: {
        kind: "browser_control",
        source: "runtime_contract",
        traits: [
          "modality_runtime_contract",
          "execution_profile",
          "executor_adapter",
        ],
        modalityContractKey: "browser_control",
        routingSlot: "browser_reasoning_model",
        executionProfileKey: "browser_control_profile",
        executorAdapterKey: "browser:browser_assist",
        executorKind: "browser",
        executorBindingKey: "browser_assist",
        permissionProfileKeys: [
          "browser_control",
          "web_search",
          "ask_user_question",
        ],
        userLockPolicy: "honor_explicit_model_lock_with_capability_check",
      },
    });

    expect(
      parseAgentEvent({
        type: "candidate_set_resolved",
        routingDecision: {
          routingMode: "single_candidate",
          decisionSource: "service_model_setting",
          decisionReason: "命中 service_models.translation",
          selectedProvider: "openai",
          selectedModel: "gpt-4.1-mini",
          candidateCount: 1,
        },
      }),
    ).toEqual({
      type: "candidate_set_resolved",
      routing_decision: {
        routingMode: "single_candidate",
        decisionSource: "service_model_setting",
        decisionReason: "命中 service_models.translation",
        selectedProvider: "openai",
        selectedModel: "gpt-4.1-mini",
        candidateCount: 1,
      },
    });

    expect(
      parseAgentEvent({
        type: "routing_decision_made",
        routing_decision: {
          routingMode: "single_candidate",
          decisionSource: "service_model_setting",
          decisionReason: "命中 service_models.translation",
          selectedProvider: "openai",
          selectedModel: "gpt-4.1-mini",
          candidateCount: 1,
        },
      }),
    ).toEqual({
      type: "routing_decision_made",
      routing_decision: {
        routingMode: "single_candidate",
        decisionSource: "service_model_setting",
        decisionReason: "命中 service_models.translation",
        selectedProvider: "openai",
        selectedModel: "gpt-4.1-mini",
        candidateCount: 1,
      },
    });

    expect(
      parseAgentEvent({
        type: "routing_fallback_applied",
        routing_decision: {
          routingMode: "single_candidate",
          decisionSource: "runtime_fallback",
          decisionReason: "service_models.translation 不可用，已回退会话默认",
          selectedProvider: "anthropic",
          selectedModel: "claude-3-5-haiku",
          candidateCount: 1,
          fallbackChain: ["service_models.translation -> session_default"],
        },
      }),
    ).toEqual({
      type: "routing_fallback_applied",
      routing_decision: {
        routingMode: "single_candidate",
        decisionSource: "runtime_fallback",
        decisionReason: "service_models.translation 不可用，已回退会话默认",
        selectedProvider: "anthropic",
        selectedModel: "claude-3-5-haiku",
        candidateCount: 1,
        fallbackChain: ["service_models.translation -> session_default"],
      },
    });

    expect(
      parseAgentEvent({
        type: "limit_state_updated",
        limit_state: {
          status: "single_candidate_only",
          singleCandidateOnly: true,
          providerLocked: true,
          settingsLocked: true,
          oemLocked: false,
          candidateCount: 1,
        },
      }),
    ).toEqual({
      type: "limit_state_updated",
      limit_state: {
        status: "single_candidate_only",
        singleCandidateOnly: true,
        providerLocked: true,
        settingsLocked: true,
        oemLocked: false,
        candidateCount: 1,
      },
    });

    expect(
      parseAgentEvent({
        type: "single_candidate_only",
        limitState: {
          status: "single_candidate_only",
          singleCandidateOnly: true,
          providerLocked: true,
          settingsLocked: true,
          oemLocked: false,
          candidateCount: 1,
        },
      }),
    ).toEqual({
      type: "single_candidate_only",
      limit_state: {
        status: "single_candidate_only",
        singleCandidateOnly: true,
        providerLocked: true,
        settingsLocked: true,
        oemLocked: false,
        candidateCount: 1,
      },
    });

    expect(
      parseAgentEvent({
        type: "single_candidate_capability_gap",
        limit_state: {
          status: "single_candidate_only",
          singleCandidateOnly: true,
          providerLocked: true,
          settingsLocked: true,
          oemLocked: false,
          candidateCount: 1,
          capabilityGap: "tools_missing",
        },
      }),
    ).toEqual({
      type: "single_candidate_capability_gap",
      limit_state: {
        status: "single_candidate_only",
        singleCandidateOnly: true,
        providerLocked: true,
        settingsLocked: true,
        oemLocked: false,
        candidateCount: 1,
        capabilityGap: "tools_missing",
      },
    });

    expect(
      parseAgentEvent({
        type: "routing_not_possible",
        routing_decision: {
          routingMode: "no_candidate",
          decisionSource: "auto_default",
          decisionReason: "当前会话没有 provider/model 默认值",
          candidateCount: 0,
        },
      }),
    ).toEqual({
      type: "routing_not_possible",
      routing_decision: {
        routingMode: "no_candidate",
        decisionSource: "auto_default",
        decisionReason: "当前会话没有 provider/model 默认值",
        candidateCount: 0,
      },
    });
  });

  it("应解析成本与限额事件", () => {
    expect(
      parseAgentEvent({
        type: "cost_estimated",
        cost_state: {
          status: "estimated",
          estimatedCostClass: "low",
          inputPerMillion: 0.8,
          outputPerMillion: 3.2,
          currency: "USD",
        },
      }),
    ).toEqual({
      type: "cost_estimated",
      cost_state: {
        status: "estimated",
        estimatedCostClass: "low",
        inputPerMillion: 0.8,
        outputPerMillion: 3.2,
        currency: "USD",
      },
    });

    expect(
      parseAgentEvent({
        type: "cost_recorded",
        costState: {
          status: "recorded",
          estimatedCostClass: "medium",
          estimatedTotalCost: 0.0185,
          totalTokens: 12000,
        },
      }),
    ).toEqual({
      type: "cost_recorded",
      cost_state: {
        status: "recorded",
        estimatedCostClass: "medium",
        estimatedTotalCost: 0.0185,
        totalTokens: 12000,
      },
    });

    expect(
      parseAgentEvent({
        type: "rate_limit_hit",
        limit_event: {
          eventKind: "rate_limit_hit",
          message: "429 Too Many Requests",
          retryable: true,
        },
      }),
    ).toEqual({
      type: "rate_limit_hit",
      limit_event: {
        eventKind: "rate_limit_hit",
        message: "429 Too Many Requests",
        retryable: true,
      },
    });

    expect(
      parseAgentEvent({
        type: "quota_low",
        limit_event: {
          eventKind: "quota_low",
          message: "credits running low",
          retryable: true,
        },
      }),
    ).toEqual({
      type: "quota_low",
      limit_event: {
        eventKind: "quota_low",
        message: "credits running low",
        retryable: true,
      },
    });

    expect(
      parseAgentEvent({
        type: "quota_blocked",
        limitEvent: {
          eventKind: "quota_blocked",
          message: "余额不足",
          retryable: false,
        },
      }),
    ).toEqual({
      type: "quota_blocked",
      limit_event: {
        eventKind: "quota_blocked",
        message: "余额不足",
        retryable: false,
      },
    });
  });

  it("应解析后端完整 message 快照事件，避免被当作未知事件", () => {
    expect(
      parseAgentEvent({
        type: "message",
        message: {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "text",
              text: "验收矩阵已生成。",
            },
          ],
          timestamp: 1777284240,
          usage: {
            input_tokens: 120,
            output_tokens: 80,
          },
        },
      }),
    ).toEqual({
      type: "message",
      message: {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "验收矩阵已生成。",
          },
        ],
        timestamp: 1777284240,
        usage: {
          input_tokens: 120,
          output_tokens: 80,
        },
      },
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
