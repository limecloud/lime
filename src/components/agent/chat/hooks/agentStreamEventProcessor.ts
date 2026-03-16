import { toast } from "sonner";
import type { Dispatch, SetStateAction } from "react";
import type { AsterExecutionStrategy } from "@/lib/api/agentRuntime";
import type {
  StreamEventActionRequired,
  StreamEventArtifactSnapshot,
  StreamEventContextTrace,
  StreamEventToolEnd,
  StreamEventToolStart,
} from "@/lib/api/agentStream";
import type { Artifact } from "@/lib/artifact/types";
import type { ActionRequired, Message, WriteArtifactContext } from "../types";
import { activityLogger } from "@/components/content-creator/utils/activityLogger";
import {
  isAskToolName,
  normalizeAskOptions,
  normalizeActionQuestions,
  parseJsonObject,
  resolveAskQuestionText,
  resolveAskRequestId,
  truncateForLog,
} from "./agentChatCoreUtils";
import { upsertAssistantActionRequest } from "./agentChatActionState";
import {
  isToolResultSuccessful,
  normalizeIncomingToolResult,
} from "./agentChatToolResult";
import {
  buildArtifactFromWrite,
  extractArtifactPathsFromMetadata,
  findMessageArtifact,
  upsertMessageArtifact,
} from "../utils/messageArtifacts";
import type { AgentRuntimeAdapter } from "./agentRuntimeAdapter";
import { buildContextRuntimeStatus } from "../utils/agentRuntimeStatus";

interface BaseProcessorContext {
  assistantMsgId: string;
  activeSessionId: string;
  resolvedWorkspaceId: string;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

interface ArtifactWriteOptions {
  onWriteFile?: (
    content: string,
    fileName: string,
    context?: WriteArtifactContext,
  ) => void;
}

interface ToolTrackingContext {
  toolLogIdByToolId: Map<string, string>;
  toolStartedAtByToolId: Map<string, number>;
  toolNameByToolId: Map<string, string>;
}

function normalizeToolNameForFileMutation(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function isFileMutationToolName(toolName: string): boolean {
  const normalized = normalizeToolNameForFileMutation(toolName);
  return [
    "write",
    "create",
    "save",
    "output",
    "edit",
    "patch",
    "update",
    "replace",
  ].some((keyword) => normalized.includes(keyword));
}

function extractPatchPath(rawText?: string): string | undefined {
  if (!rawText) {
    return undefined;
  }

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    for (const prefix of [
      "*** Add File:",
      "*** Update File:",
      "*** Delete File:",
      "*** Move to:",
    ]) {
      if (trimmed.startsWith(prefix)) {
        const path = trimmed.slice(prefix.length).trim();
        if (path) {
          return path.replace(/\\/g, "/");
        }
      }
    }
  }

  return undefined;
}

function extractPatchText(
  toolArgs: Record<string, unknown> | null,
): string | undefined {
  if (!toolArgs) {
    return undefined;
  }

  for (const key of ["patch", "command", "cmd", "script"]) {
    const value = toolArgs[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (Array.isArray(value)) {
      const text = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .join("\n");
      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

function extractToolArgPath(
  toolArgs: Record<string, unknown> | null,
): string | undefined {
  if (!toolArgs) {
    return undefined;
  }

  for (const key of [
    "path",
    "file_path",
    "filePath",
    "target_path",
    "targetPath",
    "output_path",
    "outputPath",
  ]) {
    const value = toolArgs[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return extractPatchPath(extractPatchText(toolArgs));
}

function extractWriteLikeContent(
  toolArgs: Record<string, unknown> | null,
): string | undefined {
  const directContent = extractToolArgContent(toolArgs);
  if (directContent !== undefined) {
    return directContent;
  }

  return undefined;
}

function extractToolArgContent(
  toolArgs: Record<string, unknown> | null,
): string | undefined {
  if (!toolArgs) {
    return undefined;
  }

  for (const key of ["content", "text", "contents", "body"]) {
    const value = toolArgs[key];
    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

function buildWriteMetadata(
  baseMetadata: Record<string, unknown> | undefined,
  options: {
    source: WriteArtifactContext["source"];
    phase: "preparing" | "streaming" | "persisted" | "completed" | "failed";
    content: string;
    isPartial: boolean;
  },
): WriteArtifactContext["metadata"] {
  const previewText = options.content.trim()
    ? options.content.slice(0, 480).trim()
    : undefined;
  const latestChunk = options.content.trim()
    ? options.content.slice(-240).trim()
    : undefined;

  return {
    ...(baseMetadata || {}),
    writePhase: options.phase,
    previewText,
    latestChunk,
    isPartial: options.isPartial,
    lastUpdateSource: options.source,
  };
}

function upsertAssistantWriteArtifact({
  assistantMsgId,
  setMessages,
  filePath,
  content,
  context,
}: {
  assistantMsgId: string;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  filePath: string;
  content: string;
  context: Omit<WriteArtifactContext, "artifact">;
}): Artifact | null {
  let nextArtifact: Artifact | null = null;

  setMessages((prev) =>
    prev.map((message) => {
      if (message.id !== assistantMsgId) {
        return message;
      }

      const existingArtifact = findMessageArtifact(message, {
        artifactId: context.artifactId,
        filePath,
      });
      const nextContent =
        content.length > 0 || !existingArtifact
          ? content
          : existingArtifact.content;
      nextArtifact = buildArtifactFromWrite({
        filePath,
        content: nextContent,
        context: {
          ...context,
          artifact: existingArtifact,
          artifactId: existingArtifact?.id || context.artifactId,
        },
      });

      return upsertMessageArtifact(message, nextArtifact);
    }),
  );

  return nextArtifact;
}

export function handleToolStartEvent({
  data,
  setPendingActions,
  onWriteFile,
  toolLogIdByToolId,
  toolStartedAtByToolId,
  toolNameByToolId,
  setMessages,
  assistantMsgId,
  activeSessionId,
  resolvedWorkspaceId,
}: BaseProcessorContext &
  ArtifactWriteOptions &
  ToolTrackingContext & {
    data: StreamEventToolStart;
    setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
  }) {
  const startedAt = Date.now();
  const newToolCall = {
    id: data.tool_id,
    name: data.tool_name,
    arguments: data.arguments,
    status: "running" as const,
    startTime: new Date(),
  };

  if (!toolLogIdByToolId.has(data.tool_id)) {
    const toolLogId = activityLogger.log({
      eventType: "tool_start",
      status: "pending",
      title: `调用工具 ${data.tool_name}`,
      description: truncateForLog(data.arguments || "等待工具结果"),
      workspaceId: resolvedWorkspaceId,
      sessionId: activeSessionId,
      source: "aster-chat",
      correlationId: data.tool_id,
      metadata: {
        toolId: data.tool_id,
        toolName: data.tool_name,
      },
    });
    toolLogIdByToolId.set(data.tool_id, toolLogId);
    toolStartedAtByToolId.set(data.tool_id, startedAt);
    toolNameByToolId.set(data.tool_id, data.tool_name);
  }

  const toolArgs = parseJsonObject(data.arguments);
  const toolName = data.tool_name.toLowerCase();
  if (isFileMutationToolName(toolName)) {
    const filePath = extractToolArgPath(toolArgs);
    const fileContent = extractWriteLikeContent(toolArgs) || "";
    if (filePath) {
      const baseMetadata =
        toolArgs?.metadata && typeof toolArgs.metadata === "object"
          ? (toolArgs.metadata as Record<string, unknown>)
          : undefined;
      const writeContext: WriteArtifactContext = {
        artifactId: `artifact:${assistantMsgId}:${filePath}`,
        source: "tool_start",
        sourceMessageId: assistantMsgId,
        status: "streaming",
        metadata: buildWriteMetadata(baseMetadata, {
          source: "tool_start",
          phase: fileContent.trim() ? "streaming" : "preparing",
          content: fileContent,
          isPartial: true,
        }),
      };
      const nextArtifact = upsertAssistantWriteArtifact({
        assistantMsgId,
        setMessages,
        filePath,
        content: fileContent,
        context: writeContext,
      });
      const emittedArtifact =
        nextArtifact ||
        buildArtifactFromWrite({
          filePath,
          content: fileContent,
          context: writeContext,
        });

      if (emittedArtifact) {
        onWriteFile?.(fileContent, filePath, {
          artifact: emittedArtifact,
          artifactId: emittedArtifact.id,
          source: "tool_start",
          sourceMessageId: assistantMsgId,
          status: emittedArtifact.status,
          metadata: emittedArtifact.meta,
        });
      }
    }
  }

  setMessages((prev) =>
    prev.map((message) => {
      if (message.id !== assistantMsgId) {
        return message;
      }

      if (message.toolCalls?.find((toolCall) => toolCall.id === data.tool_id)) {
        return message;
      }

      return {
        ...message,
        toolCalls: [...(message.toolCalls || []), newToolCall],
        contentParts: [
          ...(message.contentParts || []),
          { type: "tool_use" as const, toolCall: newToolCall },
        ],
      };
    }),
  );

  if (!isAskToolName(data.tool_name)) {
    return;
  }

  const requestIdFromArgs = resolveAskRequestId(toolArgs);
  const question =
    (toolArgs && resolveAskQuestionText(toolArgs)) || "请提供继续执行所需信息";
  const questionList = toolArgs
    ? normalizeActionQuestions(toolArgs?.questions)
    : undefined;
  const askOptions = normalizeAskOptions(
    toolArgs?.options || toolArgs?.choices || toolArgs?.enum,
  );
  const explicitRequestId = requestIdFromArgs?.trim();
  const normalizedQuestions = questionList ?? [
    {
      question,
      options: askOptions,
      multiSelect: false,
    },
  ];

  const fallbackAction: ActionRequired = {
    requestId:
      explicitRequestId || `fallback:${data.tool_id || crypto.randomUUID()}`,
    actionType: "ask_user",
    prompt: question,
    isFallback: !explicitRequestId,
    questions: normalizedQuestions,
  };

  upsertAssistantActionRequest({
    assistantMsgId,
    actionData: fallbackAction,
    replaceByPrompt: true,
    setPendingActions,
    setMessages,
  });
}

export function handleToolEndEvent({
  data,
  onWriteFile,
  toolLogIdByToolId,
  toolStartedAtByToolId,
  toolNameByToolId,
  setMessages,
  assistantMsgId,
  activeSessionId,
  resolvedWorkspaceId,
}: BaseProcessorContext &
  ArtifactWriteOptions &
  ToolTrackingContext & {
    data: StreamEventToolEnd;
  }) {
  const normalizedResult = normalizeIncomingToolResult(data.result) || data.result;
  const isSuccess = isToolResultSuccessful(normalizedResult);
  const eventType = isSuccess ? "tool_complete" : "tool_error";
  const startedAt = toolStartedAtByToolId.get(data.tool_id);
  const toolName = toolNameByToolId.get(data.tool_id) || "未知工具";
  const duration =
    typeof startedAt === "number" ? Date.now() - startedAt : undefined;
  const toolLogId = toolLogIdByToolId.get(data.tool_id);
  const outputText = truncateForLog(
    normalizedResult.output || normalizedResult.error || "",
    120,
  );

  if (toolLogId) {
    activityLogger.updateLog(toolLogId, {
      eventType,
      status: isSuccess ? "success" : "error",
      duration,
      description: outputText || (isSuccess ? "工具执行完成" : "工具执行失败"),
      error: isSuccess ? undefined : outputText || "工具返回失败状态",
    });
  } else {
    activityLogger.log({
      eventType,
      status: isSuccess ? "success" : "error",
      title: `工具 ${toolName}`,
      description: outputText || (isSuccess ? "工具执行完成" : "工具执行失败"),
      duration,
      workspaceId: resolvedWorkspaceId,
      sessionId: activeSessionId,
      source: "aster-chat",
      correlationId: data.tool_id,
    });
  }

  setMessages((prev) =>
    prev.map((message) => {
      if (message.id !== assistantMsgId) {
        return message;
      }

      const updatedToolCalls = (message.toolCalls || []).map((toolCall) =>
        toolCall.id === data.tool_id
          ? {
              ...toolCall,
              status: isSuccess ? ("completed" as const) : ("failed" as const),
              result: normalizedResult,
              endTime: new Date(),
            }
          : toolCall,
      );
      const updatedContentParts = (message.contentParts || []).map((part) => {
        if (part.type !== "tool_use" || part.toolCall.id !== data.tool_id) {
          return part;
        }

        return {
          ...part,
          toolCall: {
            ...part.toolCall,
            status: isSuccess ? ("completed" as const) : ("failed" as const),
            result: normalizedResult,
            endTime: new Date(),
          },
        };
      });

      return {
        ...message,
        toolCalls: updatedToolCalls,
        contentParts: updatedContentParts,
      };
    }),
  );

  const artifactPaths = extractArtifactPathsFromMetadata(
    normalizedResult.metadata,
  );
  if (artifactPaths.length === 0) {
    return;
  }

  for (const artifactPath of artifactPaths) {
    const writeContext: WriteArtifactContext = {
      artifactId: `artifact:${assistantMsgId}:${artifactPath}`,
      source: "tool_result",
      sourceMessageId: assistantMsgId,
      status: isSuccess ? "complete" : "error",
      metadata: buildWriteMetadata(normalizedResult.metadata, {
        source: "tool_result",
        phase: isSuccess ? "completed" : "failed",
        content: "",
        isPartial: false,
      }),
    };
    const nextArtifact = upsertAssistantWriteArtifact({
      assistantMsgId,
      setMessages,
      filePath: artifactPath,
      content: "",
      context: writeContext,
    });
    const emittedArtifact =
      nextArtifact ||
      buildArtifactFromWrite({
        filePath: artifactPath,
        content: "",
        context: writeContext,
      });

    if (emittedArtifact) {
      onWriteFile?.(emittedArtifact.content, artifactPath, {
        artifact: emittedArtifact,
        artifactId: emittedArtifact.id,
        source: "tool_result",
        sourceMessageId: assistantMsgId,
        status: emittedArtifact.status,
        metadata: emittedArtifact.meta,
      });
    }
  }
}

export function handleArtifactSnapshotEvent({
  data,
  onWriteFile,
  setMessages,
  assistantMsgId,
}: BaseProcessorContext &
  ArtifactWriteOptions & {
    data: StreamEventArtifactSnapshot;
  }) {
  const artifactPath = data.artifact.filePath;
  if (!artifactPath) {
    return;
  }

  const metadata = data.artifact.metadata;
  const snapshotContent =
    typeof data.artifact.content === "string" ? data.artifact.content : "";
  const writeContext: WriteArtifactContext = {
    artifactId:
      data.artifact.artifactId || `artifact:${assistantMsgId}:${artifactPath}`,
    source: "artifact_snapshot",
    sourceMessageId: assistantMsgId,
    status: "streaming",
    metadata: buildWriteMetadata(metadata, {
      source: "artifact_snapshot",
      phase: metadata?.complete === false ? "streaming" : "persisted",
      content: snapshotContent,
      isPartial: metadata?.complete === false,
    }),
  };
  const nextArtifact = upsertAssistantWriteArtifact({
    assistantMsgId,
    setMessages,
    filePath: artifactPath,
    content: snapshotContent,
    context: writeContext,
  });
  const emittedArtifact =
    nextArtifact ||
    buildArtifactFromWrite({
      filePath: artifactPath,
      content: snapshotContent,
      context: writeContext,
    });

  if (emittedArtifact) {
    onWriteFile?.(emittedArtifact.content, artifactPath, {
      artifact: emittedArtifact,
      artifactId: emittedArtifact.id,
      source: "artifact_snapshot",
      sourceMessageId: assistantMsgId,
      status: emittedArtifact.status,
      metadata: emittedArtifact.meta,
    });
  }
}

export function handleActionRequiredEvent({
  data,
  actionLoggedKeys,
  effectiveExecutionStrategy,
  runtime,
  setPendingActions,
  setMessages,
  assistantMsgId,
  activeSessionId,
  resolvedWorkspaceId,
}: BaseProcessorContext & {
  data: StreamEventActionRequired;
  actionLoggedKeys: Set<string>;
  effectiveExecutionStrategy: AsterExecutionStrategy;
  runtime: AgentRuntimeAdapter;
  setPendingActions: Dispatch<SetStateAction<ActionRequired[]>>;
}) {
  const actionData: ActionRequired = {
    requestId: data.request_id,
    actionType: data.action_type,
    toolName: data.tool_name,
    arguments: data.arguments,
    prompt: data.prompt,
    questions: normalizeActionQuestions(data.questions, data.prompt),
    requestedSchema: data.requested_schema,
    isFallback: false,
  };
  const actionKey =
    actionData.requestId ||
    `${actionData.actionType}:${actionData.prompt || actionData.toolName || ""}`;
  if (!actionLoggedKeys.has(actionKey)) {
    actionLoggedKeys.add(actionKey);
    activityLogger.log({
      eventType: "action_required",
      status: "success",
      title: "等待用户确认",
      description:
        truncateForLog(actionData.prompt || "", 120) ||
        `类型: ${actionData.actionType}`,
      workspaceId: resolvedWorkspaceId,
      sessionId: activeSessionId,
      source: "aster-chat",
      correlationId: actionData.requestId,
      metadata: {
        actionType: actionData.actionType,
        toolName: actionData.toolName,
        requestId: actionData.requestId,
      },
    });
  }

  if (
    effectiveExecutionStrategy === "auto" &&
    actionData.actionType === "tool_confirmation"
  ) {
    void runtime
      .respondToAction({
        sessionId: activeSessionId,
        requestId: actionData.requestId,
        actionType: "tool_confirmation",
        confirmed: true,
        response: "Auto 模式自动确认",
      })
      .catch((error) => {
        console.error("[AsterChat] Auto 模式自动确认失败:", error);
        upsertAssistantActionRequest({
          assistantMsgId,
          actionData,
          setPendingActions,
          setMessages,
        });
        toast.error("Auto 模式自动确认失败，请手动确认");
      });
    return;
  }

  upsertAssistantActionRequest({
    assistantMsgId,
    actionData,
    replaceByPrompt:
      actionData.actionType === "ask_user" ||
      actionData.actionType === "elicitation",
    setPendingActions,
    setMessages,
  });
}

export function handleContextTraceEvent({
  data,
  setMessages,
  assistantMsgId,
}: BaseProcessorContext & {
  data: StreamEventContextTrace;
}) {
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    return;
  }

  setMessages((prev) =>
    prev.map((message) => {
      if (message.id !== assistantMsgId) {
        return message;
      }

      const seen = new Set(
        (message.contextTrace || []).map(
          (step) => `${step.stage}::${step.detail}`,
        ),
      );
      const nextSteps = [...(message.contextTrace || [])];

      for (const step of data.steps) {
        const key = `${step.stage}::${step.detail}`;
        if (!seen.has(key)) {
          seen.add(key);
          nextSteps.push(step);
        }
      }

      return {
        ...message,
        contextTrace: nextSteps,
        runtimeStatus: buildContextRuntimeStatus(nextSteps),
      };
    }),
  );
}
