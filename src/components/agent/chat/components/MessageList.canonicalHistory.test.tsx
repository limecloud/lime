import { describe, expect, it } from "vitest";
import {
  mockAgentThreadTimeline,
  mockStreamingRenderer,
  render,
} from "./MessageList.testHarness";
import type {
  AgentThreadItem,
  AgentThreadTurn,
  Message,
} from "./MessageList.testHarness";

describe("MessageList canonical history canonical history", () => {
  it("续聊后的历史过程应由 runtimeTurnId 直接接入 canonical 记录", () => {
    const canonicalMetadata = {
      environmentId: "environment-main",
    };
    const canonicalTurn: AgentThreadTurn = {
      id: "turn-canonical-history",
      thread_id: "thread-canonical-history",
      prompt_text: "请运行测试并修复失败",
      status: "completed",
      started_at: "2026-06-17T06:50:48.053Z",
      completed_at: "2026-06-17T06:50:48.236Z",
      created_at: "2026-06-17T06:50:48.053Z",
      updated_at: "2026-06-17T06:50:48.236Z",
    };
    const continuationTurn: AgentThreadTurn = {
      id: "turn-canonical-continuation",
      thread_id: "thread-canonical-history",
      prompt_text: "在这个会话里继续总结下一步",
      status: "completed",
      started_at: "2026-06-17T06:50:48.923Z",
      completed_at: "2026-06-17T06:50:49.019Z",
      created_at: "2026-06-17T06:50:48.923Z",
      updated_at: "2026-06-17T06:50:49.019Z",
    };
    const messages: Message[] = [
      {
        id: "turn-canonical-history:user",
        role: "user",
        content: "请运行测试并修复失败",
        timestamp: new Date("2026-06-17T06:50:48.053Z"),
      },
      {
        id: "turn-canonical-history:assistant",
        role: "assistant",
        content: "已完成修复。",
        runtimeTurnId: canonicalTurn.id,
        timestamp: new Date("2026-06-17T06:50:48.236Z"),
      },
      {
        id: "turn-canonical-continuation:user",
        role: "user",
        content: "在这个会话里继续总结下一步",
        timestamp: new Date("2026-06-17T06:50:48.923Z"),
      },
      {
        id: "turn-canonical-continuation:assistant",
        role: "assistant",
        content:
          "这条会话已经恢复了原始问题、执行记录、文件变更和只读确认记录。",
        runtimeTurnId: continuationTurn.id,
        timestamp: new Date("2026-06-17T06:50:49.019Z"),
      },
    ];
    const threadItems: AgentThreadItem[] = [
      {
        id: "canonical-progress",
        type: "agent_message",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 2,
        phase: "commentary",
        text: "我会先运行测试并检查失败。",
        status: "completed",
        started_at: "2026-06-17T06:50:48.060Z",
        completed_at: "2026-06-17T06:50:48.070Z",
        updated_at: "2026-06-17T06:50:48.070Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-reasoning",
        type: "reasoning",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 3,
        text: "需要先确认测试失败点。",
        status: "completed",
        started_at: "2026-06-17T06:50:48.071Z",
        completed_at: "2026-06-17T06:50:48.080Z",
        updated_at: "2026-06-17T06:50:48.080Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-command",
        type: "command_execution",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 5,
        command: "npm test",
        cwd: "/workspace/canonical-codex",
        aggregated_output: "ok",
        exit_code: 0,
        status: "completed",
        started_at: "2026-06-17T06:50:48.081Z",
        completed_at: "2026-06-17T06:50:48.090Z",
        updated_at: "2026-06-17T06:50:48.090Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-read-md",
        type: "tool_call",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 11,
        tool_name: "read_file",
        arguments: {
          path: "/workspace/canonical-local-history/docs/canonical-preview.md",
        },
        output: "会话 Markdown 预览内容",
        success: true,
        status: "completed",
        started_at: "2026-06-17T06:50:48.101Z",
        completed_at: "2026-06-17T06:50:48.110Z",
        updated_at: "2026-06-17T06:50:48.110Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-read-html",
        type: "tool_call",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 12,
        tool_name: "read_file",
        arguments: {
          path: "/workspace/canonical-local-history/docs/canonical-preview.html",
        },
        output: "会话 HTML 预览内容",
        success: true,
        status: "completed",
        started_at: "2026-06-17T06:50:48.111Z",
        completed_at: "2026-06-17T06:50:48.120Z",
        updated_at: "2026-06-17T06:50:48.120Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-read-docx",
        type: "tool_call",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 13,
        tool_name: "read_file",
        arguments: {
          path: "/workspace/canonical-local-history/docs/canonical-preview.docx",
        },
        output: "会话 DOCX 预览内容",
        success: true,
        status: "completed",
        started_at: "2026-06-17T06:50:48.121Z",
        completed_at: "2026-06-17T06:50:48.130Z",
        updated_at: "2026-06-17T06:50:48.130Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-search",
        type: "web_search",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 14,
        action: "search_query",
        output: '"search_query"',
        status: "completed",
        started_at: "2026-06-17T06:50:48.131Z",
        completed_at: "2026-06-17T06:50:48.140Z",
        updated_at: "2026-06-17T06:50:48.140Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-patch",
        type: "patch",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 15,
        text: "Patch changed /workspace/canonical-codex/src/lib.rs",
        paths: ["/workspace/canonical-codex/src/lib.rs"],
        success: true,
        status: "completed",
        started_at: "2026-06-17T06:50:48.141Z",
        completed_at: "2026-06-17T06:50:48.150Z",
        updated_at: "2026-06-17T06:50:48.150Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-file-artifact",
        type: "file_artifact",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 16,
        path: "/workspace/canonical-codex/src/lib.rs",
        source: "tool_result",
        content: "fn canonical() {}",
        status: "completed",
        started_at: "2026-06-17T06:50:48.151Z",
        completed_at: "2026-06-17T06:50:48.160Z",
        updated_at: "2026-06-17T06:50:48.160Z",
        metadata: canonicalMetadata,
      },
      {
        id: "canonical-final",
        type: "agent_message",
        thread_id: canonicalTurn.thread_id,
        turn_id: canonicalTurn.id,
        sequence: 20,
        phase: "final_answer",
        text: "已完成修复。",
        status: "completed",
        started_at: "2026-06-17T06:50:48.220Z",
        completed_at: "2026-06-17T06:50:48.236Z",
        updated_at: "2026-06-17T06:50:48.236Z",
        metadata: canonicalMetadata,
      },
    ];

    const container = render(messages, {
      turns: [canonicalTurn, continuationTurn],
      threadItems,
      currentTurnId: null,
      sessionHistoryWindow: {
        loadedMessages: 4,
        totalMessages: 4,
        isLoadingFull: false,
        error: null,
      },
    });

    expect(
      container.querySelector(
        '[data-testid="conversation-turn-timeline"][data-runtime-turn-id="turn-canonical-history"]',
      ),
    ).not.toBeNull();
    const canonicalAssistantRendererCall =
      mockStreamingRenderer.mock.calls.find(([props]) => {
        const rendererProps = props as {
          content?: string;
          contentParts?: Array<Record<string, unknown>>;
        };
        return rendererProps.content?.includes("已完成修复。");
      })?.[0] as
        | { content?: string; contentParts?: Array<Record<string, unknown>> }
        | undefined;

    expect(canonicalAssistantRendererCall?.content).toContain("已完成修复。");
    expect(canonicalAssistantRendererCall?.content).not.toContain(
      "我会先运行测试并检查失败。",
    );
    expect(canonicalAssistantRendererCall?.contentParts).toBeUndefined();
    expect(mockAgentThreadTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        turn: expect.objectContaining({ id: canonicalTurn.id }),
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "canonical-patch",
            paths: ["/workspace/canonical-codex/src/lib.rs"],
          }),
          expect.objectContaining({
            id: "canonical-file-artifact",
            path: "/workspace/canonical-codex/src/lib.rs",
          }),
        ]),
        deferCompletedSingleDetails: true,
        showOperationalDetails: true,
      }),
    );
  });
});
