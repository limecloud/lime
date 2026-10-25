import { describe, expect, it } from "vitest";

import { buildToolProjectionEvents } from "./toolEventProjection";

const baseContext = {
  sessionId: "session-tool",
  threadId: "thread-tool",
  runId: "run-tool",
  turnId: "turn-tool",
  timestamp: "2026-06-10T00:00:00.000Z",
};

describe("toolEventProjection", () => {
  it("应由 tool owner 统一分发 tool_start", () => {
    const events = buildToolProjectionEvents(
      {
        type: "tool_start",
        tool_id: "tool-1",
        tool_name: "read_file",
        arguments: JSON.stringify({ path: "README.md" }),
      },
      baseContext,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool.started",
      sourceType: "tool_start",
      sessionId: "session-tool",
      threadId: "thread-tool",
      runId: "run-tool",
      turnId: "turn-tool",
      toolCallId: "tool-1",
      owner: "tool",
      scope: "tool_call",
      phase: "acting",
      surface: "tool_ui",
      persistence: "ephemeral_live",
      payload: {
        toolName: "read_file",



      },
    });
    expect(events[1]).toMatchObject({
      type: "tool.args",
      sourceType: "tool_start",
      toolCallId: "tool-1",
      owner: "tool",
      payload: {
        toolName: "read_file",
        inputAvailable: true,
        inputSummary: "{\"path\":\"README.md\"}",
        inputLength: 20,
      },
    });
  });



  it("应由 tool owner 统一分发 tool_end 与 plan approval metadata", () => {
    const events = buildToolProjectionEvents(
      {
        type: "tool_end",
        tool_id: "tool-plan",
        result: {
          success: true,
          output: "已提交计划审批",
          metadata: {
            plan_approval_request: {
              type: "plan_approval_request",
              from: "researcher",
              requestId: "plan-req-1",
              planFilePath: "plans/alpha.md",
              planContent: "# 计划\n- 第一步",
              timestamp: "2026-05-09T00:00:00.000Z",
            },
            plan_approval_delivery: {
              target: "lead-session",
              submissionId: "submit-1",
            },
            pending_request_id: "plan-req-1",
          },
        },
      },
      baseContext,
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool.result",
      sourceType: "tool_end",
      toolCallId: "tool-plan",
      owner: "tool",
      scope: "tool_call",
      phase: "completed",
      surface: "tool_ui",
      persistence: "archive",
      payload: {
        success: true,
        outputPreview: "已提交计划审批",
        outputLength: 7,
        hasImages: false,
        metadataKeys: [
          "pending_request_id",
          "plan_approval_delivery",
          "plan_approval_request",
        ],
      },
    });
    expect(events[1]).toMatchObject({
      type: "action.required",
      sourceType: "tool_end",
      actionId: "plan-req-1",
      toolCallId: "tool-plan",
      owner: "action",
      scope: "action_request",
      phase: "waiting",
      surface: "hitl",
      persistence: "snapshot",
      control: "approve",
      payload: {
        actionType: "plan_approval",
        decisionKind: "plan_approval_request",
        from: "researcher",
        planFilePath: "plans/alpha.md",
        planContentPreview: "# 计划\n- 第一步",
        planContentLength: 10,
        deliveryTarget: "lead-session",
        deliverySubmissionId: "submit-1",
        awaitingLeaderApproval: true,
      },
    });
  });

  it("应由 tool owner 统一分发 progress、output delta 与 input delta", () => {
    const progressEvents = buildToolProjectionEvents(
      {
        type: "tool_progress",
        tool_id: "tool-1",
        progress: {
          message: "正在处理第 2 项",
          progress: 2,
          total: 4,
          metadata: {
            notification_kind: "mcp_progress",
          },
        },
      },
      baseContext,
    );

    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0]).toMatchObject({
      type: "tool.progress",
      sourceType: "tool_progress",
      toolCallId: "tool-1",
      owner: "tool",
      phase: "acting",
      persistence: "ephemeral_live",
      payload: {
        messagePreview: "正在处理第 2 项",
        progress: 2,
        total: 4,
        metadataKeys: ["notification_kind"],
      },
    });

    const outputDeltaEvents = buildToolProjectionEvents(
      {
        type: "tool_output_delta",
        tool_id: "tool-1",
        delta: "partial output",
        output_kind: "log",
        metadata: {
          notification_kind: "mcp_log",
        },
      },
      baseContext,
    );

    expect(outputDeltaEvents).toHaveLength(1);
    expect(outputDeltaEvents[0]).toMatchObject({
      type: "tool.output.delta",
      sourceType: "tool_output_delta",
      toolCallId: "tool-1",
      owner: "tool",
      payload: {
        outputKind: "log",
        deltaPreview: "partial output",
        deltaLength: 14,
        metadataKeys: ["notification_kind"],
      },
    });

    const inputDeltaEvents = buildToolProjectionEvents(
      {
        type: "tool_input_delta",
        tool_id: "tool-1",
        tool_name: "read_file",
        delta: "{\"path\"",
        accumulated_arguments: "{\"path\"",
        provider: "openai_compatible",
      },
      baseContext,
    );

    expect(inputDeltaEvents).toHaveLength(1);
    expect(inputDeltaEvents[0]).toMatchObject({
      type: "tool.args.delta",
      sourceType: "tool_input_delta",
      toolCallId: "tool-1",
      owner: "tool",
      payload: {
        toolName: "read_file",
        provider: "openai_compatible",
        inputStreaming: true,
        deltaPreview: "{\"path\"",
        deltaLength: 7,
        accumulatedInputLength: 7,
        accumulatedInputPreview: "{\"path\"",
      },
    });
  });
});
