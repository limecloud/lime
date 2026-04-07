import type { SkillDetailInfo } from "@/lib/api/skill-execution";
import type { Message } from "../types";
import type {
  ExecLogEntry,
  ExecLogEntryDetail,
} from "./GeneralWorkbenchExecLog";
import { resolveToolDisplayLabel } from "../utils/toolDisplayInfo";
import type {
  GeneralWorkbenchActivityLogGroup,
  GeneralWorkbenchCreationTaskGroup,
} from "./generalWorkbenchWorkflowData";

interface BuildGeneralWorkbenchExecLogEntriesParams {
  messages: Message[];
  groupedActivityLogs: GeneralWorkbenchActivityLogGroup[];
  groupedCreationTaskEvents: GeneralWorkbenchCreationTaskGroup[];
  skillDetailMap: Record<string, SkillDetailInfo | null>;
}

function truncate(text: string, max = 300): string {
  if (!text) {
    return "";
  }
  const normalized = text.trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function formatExecLogJson(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    try {
      return JSON.stringify(JSON.parse(normalized), null, 2);
    } catch {
      return normalized;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildTimestampFromActivityTimeLabel(timeLabel: string): Date {
  try {
    const parts = timeLabel.split(":");
    if (parts.length >= 2) {
      const date = new Date();
      date.setHours(
        Number(parts[0]),
        Number(parts[1]),
        Number(parts[2] || 0),
        0,
      );
      if (date.getTime() > Date.now()) {
        date.setDate(date.getDate() - 1);
      }
      return date;
    }
  } catch {
    // noop
  }
  return new Date(0);
}

function buildToolCallEntry(
  messageId: string,
  toolCall: NonNullable<Message["toolCalls"]>[number],
  fallbackTimestamp: Date,
  index: number,
): ExecLogEntry {
  let argsPreview = "";
  let parsedArguments: unknown = undefined;

  try {
    const parsed = JSON.parse(toolCall.arguments || "{}");
    parsedArguments = parsed;
    const keys = Object.keys(parsed);
    argsPreview = keys
      .slice(0, 2)
      .map((key) => {
        const value = String(parsed[key] ?? "");
        return `${key}: ${value.slice(0, 60)}${value.length > 60 ? "…" : ""}`;
      })
      .join(" · ");
  } catch {
    argsPreview = truncate(toolCall.arguments || "", 120);
    parsedArguments = toolCall.arguments || undefined;
  }

  const resultMeta = toolCall.result?.error
    ? `❌ ${truncate(toolCall.result.error, 120)}`
    : toolCall.result?.output
      ? truncate(toolCall.result.output, 200)
      : undefined;

  const detail: ExecLogEntryDetail | undefined =
    toolCall.arguments || toolCall.result?.output || toolCall.result?.error
      ? {
          kind: "tool",
          argumentsText: formatExecLogJson(parsedArguments),
          resultText: formatExecLogJson(toolCall.result?.output),
          errorText: toolCall.result?.error?.trim() || undefined,
        }
      : undefined;

  return {
    id: `${messageId}-tc-${toolCall.id}-${index}`,
    type: "tool",
    typeLabel: resolveToolDisplayLabel(toolCall.name),
    content: argsPreview || toolCall.name,
    meta: resultMeta,
    timestamp: toolCall.startTime || fallbackTimestamp,
    status: toolCall.status,
    detail,
  };
}

function buildRunEntry(
  group: GeneralWorkbenchActivityLogGroup,
  skillDetailMap: Record<string, SkillDetailInfo | null>,
): ExecLogEntry {
  const timestamp = buildTimestampFromActivityTimeLabel(group.timeLabel);
  const skillLog = group.logs.find((log) => log.source === "skill");
  const rawSourceRef =
    group.logs.find((log) => log.sourceRef?.trim())?.sourceRef?.trim() || null;
  const sourceRef = rawSourceRef;
  const skillDetail = sourceRef ? skillDetailMap[sourceRef] || null : null;
  const skillName =
    skillDetail?.display_name?.trim() || skillLog?.name || group.source || "";
  const detailSummary = skillDetail?.description?.trim() || null;
  const workflowSteps = (skillDetail?.workflow_steps || [])
    .map((step) => step.name?.trim() || step.id?.trim() || "")
    .filter((step): step is string => Boolean(step));
  const allowedTools = (skillDetail?.allowed_tools || [])
    .map((toolName) => resolveToolDisplayLabel(toolName))
    .filter((toolName): toolName is string => Boolean(toolName));

  const detail: ExecLogEntryDetail | undefined =
    sourceRef ||
    detailSummary ||
    workflowSteps.length > 0 ||
    allowedTools.length > 0 ||
    skillDetail?.when_to_use?.trim() ||
    group.artifactPaths.length > 0
      ? {
          kind: "skill",
          sourceRef: sourceRef || undefined,
          description: detailSummary || undefined,
          workflowSteps: workflowSteps.length > 0 ? workflowSteps : undefined,
          allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
          whenToUse: skillDetail?.when_to_use?.trim() || undefined,
          artifactPaths:
            group.artifactPaths.length > 0
              ? [...group.artifactPaths]
              : undefined,
        }
      : undefined;

  const artifactSummary =
    group.artifactPaths.length > 0
      ? `产物：${group.artifactPaths.map((path) => path.split("/").pop()).join("、")}`
      : undefined;
  const durationLabel = group.logs.find(
    (log) => log.durationLabel,
  )?.durationLabel;
  const meta = [
    sourceRef ? `技能标识：${sourceRef}` : null,
    detailSummary,
    artifactSummary,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ");

  return {
    id: `run-${group.key}`,
    type: "run",
    typeLabel: skillName ? `技能：${skillName}` : "编排运行",
    content: skillName
      ? `执行技能 ${skillName}${durationLabel ? `  ${durationLabel}` : ""}`
      : `编排运行${durationLabel ? `  ${durationLabel}` : ""}`,
    meta: meta || undefined,
    timestamp,
    status: group.status,
    detail,
  };
}

export function buildGeneralWorkbenchExecLogEntries({
  messages,
  groupedActivityLogs,
  groupedCreationTaskEvents,
  skillDetailMap,
}: BuildGeneralWorkbenchExecLogEntriesParams): ExecLogEntry[] {
  const entries: ExecLogEntry[] = [];
  let toolCallIndex = 0;

  for (const message of messages) {
    if (message.role === "user") {
      entries.push({
        id: `${message.id}-user`,
        type: "user",
        typeLabel: "用户请求",
        content: truncate(message.content, 200),
        timestamp: message.timestamp,
      });
      continue;
    }

    if (message.thinkingContent) {
      entries.push({
        id: `${message.id}-thinking`,
        type: "thinking",
        typeLabel: "深度思考",
        content: truncate(message.thinkingContent, 200),
        timestamp: message.timestamp,
      });
    }

    for (const toolCall of message.toolCalls || []) {
      entries.push(
        buildToolCallEntry(
          message.id,
          toolCall,
          message.timestamp,
          toolCallIndex,
        ),
      );
      toolCallIndex += 1;
    }

    if (message.content?.trim() && !message.isThinking) {
      entries.push({
        id: `${message.id}-resp`,
        type: "response",
        typeLabel: "AI 响应",
        content: truncate(message.content, 200),
        timestamp: message.timestamp,
      });
    }
  }

  for (const group of groupedActivityLogs) {
    entries.push(buildRunEntry(group, skillDetailMap));
  }

  for (const group of groupedCreationTaskEvents) {
    const latestTask = group.tasks[group.tasks.length - 1];
    entries.push({
      id: `task-${group.key}`,
      type: "task",
      typeLabel: "任务提交",
      content: group.label || group.taskType,
      timestamp: latestTask?.createdAt
        ? new Date(latestTask.createdAt)
        : new Date(0),
      status: "completed",
    });
  }

  entries.sort((left, right) => {
    const leftTime =
      left.timestamp instanceof Date ? left.timestamp.getTime() : 0;
    const rightTime =
      right.timestamp instanceof Date ? right.timestamp.getTime() : 0;
    return leftTime - rightTime;
  });

  return entries;
}

export function filterGeneralWorkbenchExecLogEntries(
  entries: ExecLogEntry[],
  clearedAt: number | null,
): ExecLogEntry[] {
  if (clearedAt === null) {
    return entries;
  }

  return entries.filter((entry) => {
    const timestamp =
      entry.timestamp instanceof Date
        ? entry.timestamp.getTime()
        : new Date(entry.timestamp).getTime();
    return Number.isFinite(timestamp) && timestamp > clearedAt;
  });
}
