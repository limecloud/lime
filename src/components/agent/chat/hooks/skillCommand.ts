import type { Dispatch, SetStateAction } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { safeListen } from "@/lib/dev-bridge";
import { parseAgentEvent, type AgentEvent } from "@/lib/api/agentProtocol";
import {
  skillExecutionApi,
  type ExecutableSkillInfo,
} from "@/lib/api/skill-execution";
import type { ActionRequired, Message, WriteArtifactContext } from "../types";
import {
  formatSkillFailureMessage,
  resolveSkillFailure,
} from "../utils/skillFailure";
import {
  isToolResultSuccessful,
  normalizeIncomingToolResult,
} from "./agentChatToolResult";

/** 解析 /skill-name args 命令 */
export interface ParsedSkillCommand {
  skillName: string;
  userInput: string;
}

/** Slash Skill 执行上下文 */
export interface SlashSkillExecutionContext {
  command: ParsedSkillCommand;
  rawContent: string;
  assistantMsgId: string;
  providerType: string;
  model?: string;
  ensureSession: () => Promise<string | null>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsSending: (value: boolean) => void;
  setCurrentAssistantMsgId: (id: string | null) => void;
  setStreamUnlisten: (unlisten: UnlistenFn | null) => void;
  setActiveSessionIdForStop: (sessionId: string | null) => void;
  isExecutionCancelled: () => boolean;
  playTypewriterSound: () => void;
  playToolcallSound: () => void;
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
}

const VALID_ACTION_TYPES = new Set<ActionRequired["actionType"]>([
  "tool_confirmation",
  "ask_user",
  "elicitation",
]);
const SOCIAL_ARTICLE_SKILL_KEY = "social_post_with_cover";
const WRITE_FILE_TAG_REGEX =
  /<write_file(?:\s+path=["'][^"']+["'])?\s*>[\s\S]*?<\/write_file>/i;

function hasWriteFileTag(content: string | undefined): boolean {
  if (!content) {
    return false;
  }
  return WRITE_FILE_TAG_REGEX.test(content);
}

function buildSocialPostSlug(seed: string): string {
  const normalized = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return normalized || "post";
}

function buildSocialPostFallbackPath(
  seed: string,
  assistantMsgId: string,
): string {
  const now = new Date();
  const format2 = (value: number) => String(value).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${format2(now.getMonth() + 1)}${format2(now.getDate())}-${format2(now.getHours())}${format2(now.getMinutes())}${format2(now.getSeconds())}`;
  const slug = buildSocialPostSlug(seed);
  const suffix =
    assistantMsgId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "run";
  return `social-posts/${timestamp}-${slug}-${suffix.toLowerCase()}.md`;
}

/**
 * 解析 slash skill 命令。
 *
 * 格式：`/skill-name` 或 `/skill-name args...`
 */
export function parseSkillSlashCommand(
  content: string,
): ParsedSkillCommand | null {
  const skillMatch = content.match(/^\/([a-zA-Z0-9_-]+)\s*([\s\S]*)$/);
  if (!skillMatch) {
    return null;
  }

  const [, skillName, userInput] = skillMatch;
  return {
    skillName,
    userInput: userInput?.trim() || "",
  };
}

function resolveSkillProviderOverride(
  providerType: string,
  model: string | undefined,
): { providerOverride?: string; modelOverride?: string } {
  const normalizedProvider = providerType.toLowerCase().trim();

  if (!normalizedProvider) {
    return {};
  }

  return {
    providerOverride: providerType,
    modelOverride: model,
  };
}

function normalizeActionType(actionType: string): ActionRequired["actionType"] {
  if (VALID_ACTION_TYPES.has(actionType as ActionRequired["actionType"])) {
    return actionType as ActionRequired["actionType"];
  }
  return "tool_confirmation";
}

function appendTextPart(
  messages: Message[],
  assistantMsgId: string,
  textDelta: string,
) {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg;

    const nextParts = [...(msg.contentParts || [])];
    const lastPart = nextParts[nextParts.length - 1];

    if (lastPart && lastPart.type === "text") {
      nextParts[nextParts.length - 1] = {
        type: "text",
        text: lastPart.text + textDelta,
      };
    } else {
      nextParts.push({ type: "text", text: textDelta });
    }

    return {
      ...msg,
      content: (msg.content || "") + textDelta,
      isThinking: false,
      thinkingContent: undefined,
      contentParts: nextParts,
    };
  });
}

function appendThinkingPart(
  messages: Message[],
  assistantMsgId: string,
  textDelta: string,
) {
  return messages.map((msg) => {
    if (msg.id !== assistantMsgId) return msg;

    const nextParts = [...(msg.contentParts || [])];
    const lastPart = nextParts[nextParts.length - 1];

    if (lastPart && lastPart.type === "thinking") {
      nextParts[nextParts.length - 1] = {
        type: "thinking",
        text: lastPart.text + textDelta,
      };
    } else {
      nextParts.push({ type: "thinking", text: textDelta });
    }

    return {
      ...msg,
      isThinking: true,
      thinkingContent: (msg.thinkingContent || "") + textDelta,
      contentParts: nextParts,
    };
  });
}

function tryHandleToolWriteFile(
  toolName: string,
  toolArguments: string | undefined,
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void,
  assistantMsgId?: string,
) {
  if (!onWriteFile || !toolArguments) {
    return;
  }

  const normalizedToolName = toolName.toLowerCase();
  const looksLikeWriteTool =
    normalizedToolName.includes("write") ||
    normalizedToolName.includes("create");

  if (!looksLikeWriteTool) {
    return;
  }

  try {
    const parsed = JSON.parse(toolArguments) as Record<string, unknown>;
    const filePath =
      (typeof parsed.path === "string" ? parsed.path : undefined) ||
      (typeof parsed.file_path === "string" ? parsed.file_path : undefined) ||
      (typeof parsed.filePath === "string" ? parsed.filePath : undefined);

    const fileContent =
      (typeof parsed.content === "string" ? parsed.content : undefined) ||
      (typeof parsed.text === "string" ? parsed.text : undefined);

    if (filePath && fileContent) {
      onWriteFile(fileContent, filePath, {
        artifactId: `artifact:${assistantMsgId || "skill"}:${filePath}`,
        source: "tool_start",
        sourceMessageId: assistantMsgId,
        status: "streaming",
      });
    }
  } catch (error) {
    console.warn("[SkillCommand] 解析 tool_start 参数失败:", error);
  }
}

function resolveSnapshotStatus(
  metadata: Record<string, unknown> | undefined,
): WriteArtifactContext["status"] {
  const writePhase =
    typeof metadata?.writePhase === "string" ? metadata.writePhase : undefined;
  if (writePhase === "failed") {
    return "error";
  }
  if (metadata?.complete === false) {
    return "streaming";
  }
  return "complete";
}

interface MatchedSkillResult {
  matchedSkill: ExecutableSkillInfo | null;
  catalogLoadFailed: boolean;
}

async function findMatchedSkill(
  skillName: string,
): Promise<MatchedSkillResult> {
  try {
    const skills = await skillExecutionApi.listExecutableSkills();
    return {
      matchedSkill: skills.find((skill) => skill.name === skillName) || null,
      catalogLoadFailed: false,
    };
  } catch (error) {
    console.warn("[SkillCommand] 获取可执行 Skills 失败:", error);
    return {
      matchedSkill: null,
      catalogLoadFailed: true,
    };
  }
}

/**
 * 尝试执行 slash skill 命令。
 *
 * @returns true 表示已处理（包括执行成功或执行失败）；false 表示非 Skill 命令或未命中技能。
 */
export async function tryExecuteSlashSkillCommand(
  ctx: SlashSkillExecutionContext,
): Promise<boolean> {
  const {
    command,
    rawContent,
    assistantMsgId,
    providerType,
    model,
    ensureSession,
    setMessages,
    setIsSending,
    setCurrentAssistantMsgId,
    setStreamUnlisten,
    setActiveSessionIdForStop,
    isExecutionCancelled,
    playTypewriterSound,
    playToolcallSound,
    onWriteFile,
  } = ctx;

  const { matchedSkill, catalogLoadFailed } = await findMatchedSkill(
    command.skillName,
  );
  if (!matchedSkill) {
    const failure = resolveSkillFailure(
      catalogLoadFailed
        ? "skill_catalog_unavailable|无法加载可执行 Skills 列表"
        : `skill_not_found|未找到名为 "${command.skillName}" 的 Skill`,
    );
    const failureText = formatSkillFailureMessage(failure);

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMsgId
          ? {
              ...msg,
              content: failureText,
              isThinking: false,
              thinkingContent: undefined,
              contentParts: [{ type: "text" as const, text: failureText }],
            }
          : msg,
      ),
    );
    setIsSending(false);
    setCurrentAssistantMsgId(null);
    setActiveSessionIdForStop(null);
    return true;
  }

  const activeSessionId = await ensureSession();
  if (!activeSessionId) {
    const failure = resolveSkillFailure(
      "skill_session_init_failed|无法创建或恢复 Skill 会话",
    );
    const failureText = formatSkillFailureMessage(failure);

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMsgId
          ? {
              ...msg,
              content: failureText,
              isThinking: false,
              thinkingContent: undefined,
              contentParts: [{ type: "text" as const, text: failureText }],
            }
          : msg,
      ),
    );
    setIsSending(false);
    setCurrentAssistantMsgId(null);
    setActiveSessionIdForStop(null);
    return true;
  }

  setActiveSessionIdForStop(activeSessionId);

  setMessages((prev) =>
    prev.map((msg) =>
      msg.id === assistantMsgId
        ? {
            ...msg,
            isThinking: true,
            thinkingContent: `正在执行 Skill: ${matchedSkill.display_name}...`,
            content: "",
            contentParts: [],
          }
        : msg,
    ),
  );

  const streamCounters = {
    text_delta: 0,
    thinking_delta: 0,
    tool_start: 0,
    tool_end: 0,
    artifact_snapshot: 0,
    done: 0,
    final_done: 0,
    error: 0,
  };

  let accumulatedContent = "";
  let skillUnlisten: UnlistenFn | null = null;
  let stepUnlisteners: UnlistenFn[] = [];

  const cleanup = () => {
    if (skillUnlisten) {
      skillUnlisten();
      skillUnlisten = null;
    }
    for (const ul of stepUnlisteners) {
      ul();
    }
    stepUnlisteners = [];
    setStreamUnlisten(null);
    setIsSending(false);
    setCurrentAssistantMsgId(null);
    setActiveSessionIdForStop(null);
  };

  try {
    const eventName = `skill-exec-${assistantMsgId}`;

    // 监听 workflow 步骤事件
    const stepStartUl = await safeListen<{
      execution_id: string;
      step_id: string;
      step_name: string;
      current_step: number;
      total_steps: number;
    }>("skill:step_start", ({ payload }) => {
      if (payload.execution_id !== assistantMsgId) return;
      // 注入步骤分隔标记
      const marker =
        payload.total_steps > 1
          ? `\n\n---\n**步骤 ${payload.current_step}/${payload.total_steps}: ${payload.step_name}**\n\n`
          : "";
      if (marker) {
        accumulatedContent += marker;
        setMessages((prev) => appendTextPart(prev, assistantMsgId, marker));
      }
    });
    stepUnlisteners.push(stepStartUl);

    skillUnlisten = await safeListen<AgentEvent>(eventName, ({ payload }) => {
      const streamEvent = parseAgentEvent(payload as unknown);
      if (!streamEvent) return;

      switch (streamEvent.type) {
        case "text_delta": {
          streamCounters.text_delta += 1;
          accumulatedContent += streamEvent.text;
          playTypewriterSound();
          setMessages((prev) =>
            appendTextPart(prev, assistantMsgId, streamEvent.text),
          );
          break;
        }
        case "thinking_delta": {
          streamCounters.thinking_delta += 1;
          setMessages((prev) =>
            appendThinkingPart(prev, assistantMsgId, streamEvent.text),
          );
          break;
        }
        case "tool_start": {
          streamCounters.tool_start += 1;
          playToolcallSound();

          tryHandleToolWriteFile(
            streamEvent.tool_name,
            streamEvent.arguments,
            onWriteFile,
            assistantMsgId,
          );

          const newToolCall = {
            id: streamEvent.tool_id,
            name: streamEvent.tool_name,
            arguments: streamEvent.arguments,
            status: "running" as const,
            startTime: new Date(),
          };

          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMsgId) return msg;
              const existing = msg.toolCalls?.find(
                (tc) => tc.id === streamEvent.tool_id,
              );
              if (existing) return msg;

              return {
                ...msg,
                toolCalls: [...(msg.toolCalls || []), newToolCall],
                contentParts: [
                  ...(msg.contentParts || []),
                  { type: "tool_use" as const, toolCall: newToolCall },
                ],
              };
            }),
          );
          break;
        }
        case "tool_end": {
          streamCounters.tool_end += 1;
          const normalizedResult =
            normalizeIncomingToolResult(streamEvent.result) || streamEvent.result;
          const success = isToolResultSuccessful(normalizedResult);
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMsgId) return msg;

              const updatedToolCalls = (msg.toolCalls || []).map((tc) =>
                tc.id === streamEvent.tool_id
                  ? {
                      ...tc,
                      status: success ? ("completed" as const) : ("failed" as const),
                      result: normalizedResult,
                      endTime: new Date(),
                    }
                  : tc,
              );

              const updatedParts = (msg.contentParts || []).map((part) => {
                if (
                  part.type === "tool_use" &&
                  part.toolCall.id === streamEvent.tool_id
                ) {
                  return {
                    ...part,
                    toolCall: {
                      ...part.toolCall,
                      status: success
                        ? ("completed" as const)
                        : ("failed" as const),
                      result: normalizedResult,
                      endTime: new Date(),
                    },
                  };
                }
                return part;
              });

              return {
                ...msg,
                toolCalls: updatedToolCalls,
                contentParts: updatedParts,
              };
            }),
          );
          break;
        }
        case "artifact_snapshot": {
          streamCounters.artifact_snapshot += 1;
          const filePath = streamEvent.artifact.filePath;
          if (!filePath) {
            break;
          }

          onWriteFile?.(
            typeof streamEvent.artifact.content === "string"
              ? streamEvent.artifact.content
              : "",
            filePath,
            {
              artifactId: streamEvent.artifact.artifactId,
              source: "artifact_snapshot",
              sourceMessageId: assistantMsgId,
              status: resolveSnapshotStatus(streamEvent.artifact.metadata),
              metadata: streamEvent.artifact.metadata,
            },
          );
          break;
        }
        case "action_required": {
          const actionRequired: ActionRequired = {
            requestId: streamEvent.request_id,
            actionType: normalizeActionType(streamEvent.action_type),
            toolName: streamEvent.tool_name,
            arguments: streamEvent.arguments,
            prompt: streamEvent.prompt,
            questions: streamEvent.questions,
            requestedSchema: streamEvent.requested_schema,
          };

          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== assistantMsgId) return msg;
              const existing = msg.actionRequests?.find(
                (item) => item.requestId === streamEvent.request_id,
              );
              if (existing) return msg;

              return {
                ...msg,
                actionRequests: [...(msg.actionRequests || []), actionRequired],
                contentParts: [
                  ...(msg.contentParts || []),
                  { type: "action_required" as const, actionRequired },
                ],
              };
            }),
          );
          break;
        }
        case "done": {
          streamCounters.done += 1;
          break;
        }
        case "final_done": {
          streamCounters.final_done += 1;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    isThinking: false,
                    thinkingContent: undefined,
                    content: accumulatedContent || msg.content,
                  }
                : msg,
            ),
          );
          break;
        }
        case "error": {
          streamCounters.error += 1;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    isThinking: false,
                    thinkingContent: undefined,
                    content:
                      accumulatedContent || `错误: ${streamEvent.message}`,
                  }
                : msg,
            ),
          );
          break;
        }
      }
    });

    setStreamUnlisten(skillUnlisten);

    const { providerOverride, modelOverride } = resolveSkillProviderOverride(
      providerType,
      model,
    );

    const result = await skillExecutionApi.executeSkill({
      skillName: command.skillName,
      userInput: command.userInput || rawContent,
      providerOverride,
      modelOverride,
      executionId: assistantMsgId,
      sessionId: activeSessionId,
    });

    console.log(
      `[SkillCommand] 执行完成: name=${command.skillName}, success=${result.success}, output_len=${result.output?.length ?? 0}, stream_stats=${JSON.stringify(streamCounters)}`,
    );

    if (isExecutionCancelled()) {
      console.info(
        `[SkillCommand] 执行结果已忽略（用户已取消）: ${command.skillName}`,
      );
      cleanup();
      return true;
    }

    const hasStreamedContent = accumulatedContent.trim().length > 0;
    const failure = !result.success
      ? resolveSkillFailure(
          result.error || "skill_execute_failed|Skill 执行返回失败",
        )
      : null;

    const failureText = failure ? formatSkillFailureMessage(failure) : "";
    const resultHasWriteFile = hasWriteFileTag(result.output);
    const shouldForceResultOutput = !failure && resultHasWriteFile;

    const finalContent = failure
      ? hasStreamedContent
        ? `${accumulatedContent}

${failureText}`
        : failureText
      : shouldForceResultOutput
        ? result.output || "Skill 执行完成"
        : hasStreamedContent
          ? accumulatedContent
          : result.output || "Skill 执行完成";

    if (failure) {
      console.warn(
        `[SkillCommand] 执行完成但返回失败: name=${command.skillName}, code=${failure.code}, message=${failure.message}`,
      );
    }

    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== assistantMsgId) return msg;

        const nextParts = shouldForceResultOutput
          ? [
              ...(msg.contentParts || []).filter(
                (part) => part.type !== "text" && part.type !== "thinking",
              ),
              { type: "text" as const, text: finalContent },
            ]
          : [...(msg.contentParts || [])];
        if (nextParts.length === 0 && finalContent) {
          nextParts.push({ type: "text", text: finalContent });
        }

        return {
          ...msg,
          content: finalContent,
          isThinking: false,
          thinkingContent: undefined,
          contentParts: nextParts,
        };
      }),
    );

    if (
      !failure &&
      command.skillName === SOCIAL_ARTICLE_SKILL_KEY &&
      onWriteFile &&
      finalContent.trim().length > 0 &&
      !hasWriteFileTag(finalContent)
    ) {
      const seed = command.userInput || rawContent;
      const fallbackPath = buildSocialPostFallbackPath(seed, assistantMsgId);
      onWriteFile(finalContent, fallbackPath);
    }

    cleanup();
    return true;
  } catch (error) {
    if (isExecutionCancelled()) {
      console.info(
        `[SkillCommand] 执行异常已忽略（用户已取消）: ${command.skillName}`,
      );
      cleanup();
      return true;
    }

    const failure = resolveSkillFailure(error);
    const failureText = formatSkillFailureMessage(failure);

    console.error(
      `[SkillCommand] 执行失败: ${command.skillName}, code=${failure.code}`,
      error,
    );

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === assistantMsgId
          ? {
              ...msg,
              isThinking: false,
              thinkingContent: undefined,
              content: failureText,
              contentParts: [
                {
                  type: "text",
                  text: failureText,
                },
              ],
            }
          : msg,
      ),
    );

    cleanup();
    return true;
  }
}
