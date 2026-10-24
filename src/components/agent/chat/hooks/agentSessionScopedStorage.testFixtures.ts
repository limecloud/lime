import type { AgentThreadItem, AgentThreadTurn, Message } from "../types";

export function createMessage(index: number): Message {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    content: `message-${index}`,
    timestamp: new Date(
      `2026-04-24T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
    ),
  };
}

export function createTurn(index: number): AgentThreadTurn {
  return {
    id: `turn-${index}`,
    thread_id: "thread-1",
    status: "completed",
    prompt_text: `turn-${index}`,
    started_at: "2026-04-24T00:00:00.000Z",
    completed_at: "2026-04-24T00:00:01.000Z",
    created_at: "2026-04-24T00:00:00.000Z",
    updated_at: "2026-04-24T00:00:01.000Z",
  };
}

export function createItem(index: number): AgentThreadItem {
  return {
    id: `item-${index}`,
    thread_id: "thread-1",
    turn_id: `turn-${index}`,
    sequence: index,
    type: "agent_message",
    text: `item-${index}`,
    status: "completed",
    started_at: "2026-04-24T00:00:00.000Z",
    completed_at: "2026-04-24T00:00:01.000Z",
    updated_at: "2026-04-24T00:00:01.000Z",
  } as AgentThreadItem;
}

export function createHeavyAssistantMessage(): Message {
  const timestamp = new Date("2026-04-24T00:00:02.000Z");

  return {
    id: "message-heavy-assistant",
    role: "assistant",
    content: "最终回复正文",
    timestamp,
    thinkingContent: "大量思考过程",
    contentParts: [
      {
        type: "thinking",
        text: "大量思考过程",
      },
      {
        type: "tool_use",
        toolCall: {
          id: "tool-heavy",
          name: "Bash",
          arguments: '{"command":"printf slow"}',
          status: "completed",
          startTime: timestamp,
          endTime: timestamp,
          result: {
            success: true,
            output: "x".repeat(12_000),
          },
        },
      },
      {
        type: "text",
        text: "最终回复正文",
      },
    ],
    toolCalls: [
      {
        id: "tool-heavy",
        name: "Bash",
        arguments: '{"command":"printf slow"}',
        status: "completed",
        startTime: timestamp,
        endTime: timestamp,
        result: {
          success: true,
          output: "x".repeat(12_000),
        },
      },
    ],
  };
}

export function createCompletedAssistantMessageWithStaleRunningTool(): Message {
  const timestamp = new Date("2026-06-07T10:34:45.000Z");

  return {
    id: "message-news-assistant-complete",
    role: "assistant",
    content: "根据多源检索结果，以下是 2026年6月7日 的主要国际新闻整理。",
    timestamp,
    isThinking: false,
    contentParts: [
      {
        type: "text",
        text: "我来搜索今天（2026年6月7日）的国际新闻。",
      },
      {
        type: "tool_use",
        toolCall: {
          id: "tool-web-search-stale-running",
          name: "WebSearch",
          arguments: '{"query":"2026年6月7日 国际新闻"}',
          status: "running",
          startTime: timestamp,
        },
      },
      {
        type: "text",
        text: "根据多源检索结果，以下是 2026年6月7日 的主要国际新闻整理。",
      },
    ],
    toolCalls: [
      {
        id: "tool-web-search-stale-running",
        name: "WebSearch",
        arguments: '{"query":"2026年6月7日 国际新闻"}',
        status: "running",
        startTime: timestamp,
      },
    ],
  };
}

export function createStandaloneSkillAssistantMessage(): Message {
  const timestamp = new Date("2026-04-24T00:00:03.000Z");

  return {
    id: "message-skill-assistant",
    role: "assistant",
    content: "最终 Skill 回复",
    timestamp,
    runtimeTurnId: "skill-exec-message-skill-assistant",
    thinkingContent: "正在执行 Skill: personal-ip-knowledge-builder...",
    contentParts: [
      {
        type: "thinking",
        text: "正在执行 Skill: personal-ip-knowledge-builder...",
      },
      {
        type: "text",
        text: "最终 Skill 回复",
      },
    ],
  };
}

export function createServiceSceneSkillAssistantMessage(): Message {
  const timestamp = new Date("2026-04-24T00:00:06.000Z");

  return {
    id: "message-service-scene-skill-assistant",
    role: "assistant",
    content: "服务型 Skill 最终回复",
    timestamp,
    runtimeTurnId: "turn-service-scene-skill",
    inlineProcessRetention: "skill",
    thinkingContent: "先读取服务 Skill，再整理产品边界。",
    contentParts: [
      {
        type: "thinking",
        text: "先读取服务 Skill，再整理产品边界。",
      },
      {
        type: "text",
        text: "服务型 Skill 最终回复",
      },
    ],
  };
}

export function createLegacyCommandSkillAssistantMessage(): Message {
  const timestamp = new Date("2026-04-24T00:00:04.000Z");

  return {
    id: "message-legacy-command-skill-assistant",
    role: "assistant",
    content: "历史 Skill 回复",
    timestamp,
    thinkingContent: "先读取 Skill，再生成回复。",
    contentParts: [
      {
        type: "thinking",
        text: "先读取 Skill，再生成回复。",
      },
      {
        type: "text",
        text: "历史 Skill 回复",
      },
    ],
  };
}

export function createStandaloneSkillUserMessage(): Message {
  return {
    id: "message-skill-user",
    role: "user",
    content: "请整理产品知识库",
    timestamp: new Date("2026-04-24T00:00:02.000Z"),
  };
}
