import {
  Code2,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Search,
  Settings,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import { resolveContentWorkbenchToolCopy } from "./contentWorkbenchToolCopy";
import {
  BROWSER_TOOL_MATCHERS,
  EXACT_TOOL_CONFIGS,
  FALLBACK_TOOL_CONFIGS,
  MCP_OPERATION_TOOL_CONFIGS,
  PLANNING_TOOL_KEYS,
} from "./toolDisplayConfig";
import {
  resolveToolDisplayActionOverride,
  resolveToolDisplayConfigGroupTitle,
  resolveToolDisplayConfigLabel,
  resolveToolDisplayConfigVerb,
  selectToolAction,
  toUserFacingToolDisplayLabel,
} from "./toolDisplayCopy";
import {
  extractSearchQueryLabel,
  humanizeToolName,
  isContentWorkbenchToolKey,
  isDirectContentGenerationToolKey,
  isSiteToolKey,
  normalizeToolNameKey,
  parseToolCallArguments,
  resolveContentWorkbenchUserFacingLabel,
  resolveDirectContentGroupLabel,
  resolveToolFilePath,
  resolveToolPrimarySubject,
} from "./toolDisplaySubject";
import {
  classifyMcpToolOperationKind,
  isBrowserToolName,
  parseMcpToolName,
  type McpToolOperationKind,
  type ParsedMcpToolName,
} from "./toolNameFamily";
import { resolveRequiredAgentChatCopy } from "./agentChatCopy";
import { resolveToolDisplayName } from "./toolDisplayName";
import type {
  ToolCallStatus,
  ToolDisplayConfig,
  ToolDisplayDescriptor,
} from "./toolDisplayTypes";

export { classifyMcpToolOperationKind, isBrowserToolName, parseMcpToolName };
export {
  extractSearchQueryLabel,
  humanizeToolName,
  normalizeToolNameKey,
  parseToolCallArguments,
  resolveToolFilePath,
  resolveToolPrimarySubject,
};
export type { McpToolOperationKind, ParsedMcpToolName };
export type {
  ToolCallArgumentValue,
  ToolCallFamily,
  ToolCallStatus,
  ToolDisplayDescriptor,
} from "./toolDisplayTypes";

const getToolIcon = (toolName: string): LucideIcon => {
  const name = normalizeToolNameKey(toolName);
  if (name.includes("subagent")) {
    return Globe;
  }
  if (isBrowserToolName(name)) {
    return Globe;
  }
  if (
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("exec")
  ) {
    return Terminal;
  }
  if (name.includes("read")) {
    return Eye;
  }
  if (name.includes("replace") || name.includes("patch")) {
    return Edit3;
  }
  if (name.includes("list") || name.includes("dir")) {
    return FolderOpen;
  }
  if (
    name.includes("search") ||
    name.includes("find") ||
    name.includes("grep")
  ) {
    return Search;
  }
  if (name.includes("web") || name.includes("fetch") || name.includes("http")) {
    return Globe;
  }
  if (name.includes("code") || name.includes("eval")) {
    return Code2;
  }
  if (name.includes("config") || name.includes("setting")) {
    return Settings;
  }
  if (name.includes("file")) {
    return FileText;
  }
  return Wrench;
};

const toToolDisplayDescriptor = (
  config: ToolDisplayConfig,
  status: ToolCallStatus,
): ToolDisplayDescriptor => {
  const resolveConfigCopy = (key: string, fallback: string) =>
    key.startsWith("toolCall.")
      ? resolveRequiredAgentChatCopy(key)
      : resolveContentWorkbenchToolCopy(key, fallback);
  const label = config.labelKey
    ? resolveConfigCopy(config.labelKey, config.label)
    : resolveToolDisplayConfigLabel(config.label);
  const groupTitle = config.groupTitleKey
    ? resolveConfigCopy(config.groupTitleKey, config.groupTitle)
    : resolveToolDisplayConfigGroupTitle(config.groupTitle);
  const actionCopy =
    status === "failed"
      ? {
          key: config.actionKeys?.failed,
          defaultValue: config.actions?.failed,
        }
      : status === "completed"
        ? {
            key: config.actionKeys?.completed,
            defaultValue: config.actions?.completed,
          }
        : {
            key: config.actionKeys?.running,
            defaultValue: config.actions?.running,
          };
  const action =
    actionCopy.key && actionCopy.defaultValue
      ? resolveConfigCopy(actionCopy.key, actionCopy.defaultValue)
      : config.actions
        ? actionCopy.defaultValue
          ? resolveToolDisplayActionOverride(actionCopy.defaultValue)
          : selectToolAction(config.actionKey, status)
        : selectToolAction(config.actionKey, status);

  return {
    family: config.family,
    label,
    verb: resolveToolDisplayConfigVerb(config.verb),
    icon: config.icon,
    groupTitle,
    action,
  };
};

export const getToolDisplayInfo = (
  toolName: string,
  status: ToolCallStatus,
  metadata?: unknown,
): ToolDisplayDescriptor => {
  toolName = resolveToolDisplayName(toolName, metadata);
  const name = normalizeToolNameKey(toolName);
  const exactMatch = EXACT_TOOL_CONFIGS.get(name);
  if (exactMatch) {
    return toToolDisplayDescriptor(exactMatch, status);
  }

  const mcpOperationKind = classifyMcpToolOperationKind(toolName);
  if (mcpOperationKind && mcpOperationKind !== "browser") {
    return toToolDisplayDescriptor(
      MCP_OPERATION_TOOL_CONFIGS[mcpOperationKind],
      status,
    );
  }

  if (isBrowserToolName(name)) {
    const browserMatcher = BROWSER_TOOL_MATCHERS.find((item) =>
      item.match(name),
    );
    if (browserMatcher) {
      return toToolDisplayDescriptor(browserMatcher.config, status);
    }
  }

  if (mcpOperationKind) {
    return toToolDisplayDescriptor(
      MCP_OPERATION_TOOL_CONFIGS[mcpOperationKind],
      status,
    );
  }

  if (
    name.includes("workspace") ||
    name.includes("artifact") ||
    name.includes("snapshot")
  ) {
    return toToolDisplayDescriptor(FALLBACK_TOOL_CONFIGS.workspace, status);
  }

  if (name.includes("patch") || name.includes("replace")) {
    return toToolDisplayDescriptor(FALLBACK_TOOL_CONFIGS.edit, status);
  }

  if (PLANNING_TOOL_KEYS.has(name)) {
    return toToolDisplayDescriptor(FALLBACK_TOOL_CONFIGS.plan, status);
  }

  if (name.includes("write")) {
    return toToolDisplayDescriptor(FALLBACK_TOOL_CONFIGS.write, status);
  }

  if (name.includes("read")) {
    return toToolDisplayDescriptor(FALLBACK_TOOL_CONFIGS.read, status);
  }

  if (
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("exec")
  ) {
    return toToolDisplayDescriptor(FALLBACK_TOOL_CONFIGS.command, status);
  }

  if (
    name.includes("search") ||
    name.includes("grep") ||
    name.includes("find")
  ) {
    return toToolDisplayDescriptor(FALLBACK_TOOL_CONFIGS.search, status);
  }

  if (name.includes("list") || name.includes("dir")) {
    return toToolDisplayDescriptor(FALLBACK_TOOL_CONFIGS.list, status);
  }

  return {
    family: "generic",
    label: humanizeToolName(toolName),
    action: selectToolAction("generic", status),
    verb: resolveToolDisplayConfigVerb("处理"),
    icon: getToolIcon(toolName),
    groupTitle: resolveToolDisplayConfigGroupTitle("工具"),
  };
};

export const buildToolHeadline = (params: {
  toolDisplay: ToolDisplayDescriptor;
  subject?: string | null;
  toolName: string;
}): string => {
  const { toolDisplay, subject, toolName } = params;
  const normalizedSubject = subject?.trim();
  if (normalizedSubject) {
    return `${toolDisplay.action} ${normalizedSubject}`;
  }

  if (toolDisplay.label !== humanizeToolName(toolName)) {
    return toolDisplay.action;
  }

  return toolDisplay.label;
};

export const resolveToolDisplayLabel = (toolName: string): string =>
  getToolDisplayInfo(toolName, "completed").label;

export const resolveUserFacingToolDisplayLabel = (toolName: string): string =>
  resolveContentWorkbenchUserFacingLabel(toolName) ||
  toUserFacingToolDisplayLabel(
    resolveToolDisplayLabel(toolName).trim() || toolName,
  );

const buildContentWorkbenchGroupHeadline = (
  toolCalls: ToolCallState[],
): string | null => {
  if (
    toolCalls.length === 0 ||
    !toolCalls.every((item) => isContentWorkbenchToolKey(item.name))
  ) {
    return null;
  }

  const failed = toolCalls.some((item) => item.status === "failed");
  const running = toolCalls.some((item) => item.status === "running");
  const statusKey = failed ? "failed" : running ? "running" : "completed";

  if (toolCalls.length > 1) {
    return resolveContentWorkbenchToolCopy(
      `group.multiple.${statusKey}`,
      {
        failed: "内容任务失败 {{count}} 项",
        running: "内容任务进行中 {{count}} 项",
        completed: "已发起 {{count}} 个内容任务",
      }[statusKey],
      { count: toolCalls.length },
    );
  }

  const first = toolCalls[0]!;
  const info = getToolDisplayInfo(first.name, first.status, first.metadata);
  const mode = isDirectContentGenerationToolKey(first.name) ? "direct" : "task";
  const label =
    mode === "direct"
      ? resolveDirectContentGroupLabel(first.name) || info.label
      : info.label;

  return resolveContentWorkbenchToolCopy(
    `group.single.${mode}.${statusKey}`,
    mode === "direct"
      ? {
          failed: "{{label}}生成失败",
          running: "{{label}}生成中",
          completed: "已生成{{label}}",
        }[statusKey]
      : {
          failed: "{{label}}发起失败",
          running: "{{label}}发起中",
          completed: "已发起{{label}}",
        }[statusKey],
    { label },
  );
};

export const buildToolGroupHeadline = (toolCalls: ToolCallState[]): string => {
  const first = toolCalls[0]!;
  const info = getToolDisplayInfo(first.name, first.status, first.metadata);
  const failed = toolCalls.some((item) => item.status === "failed");
  const running = toolCalls.some((item) => item.status === "running");
  const statusKey = failed ? "failed" : running ? "running" : "completed";
  const countValues = { count: toolCalls.length };
  const contentWorkbenchHeadline =
    buildContentWorkbenchGroupHeadline(toolCalls);
  if (contentWorkbenchHeadline) {
    return contentWorkbenchHeadline;
  }

  const isSiteToolGroup = toolCalls.every((item) => isSiteToolKey(item.name));

  if (info.family === "search") {
    if (isSiteToolGroup) {
      return resolveRequiredAgentChatCopy(
        `toolCall.group.siteSearch.${statusKey}`,
      );
    }
    return resolveRequiredAgentChatCopy(`toolCall.group.search.${statusKey}`);
  }

  if (["read", "list"].includes(info.family)) {
    if (isSiteToolGroup) {
      return resolveRequiredAgentChatCopy(
        `toolCall.group.siteBrowse.${statusKey}`,
      );
    }
    return resolveRequiredAgentChatCopy(`toolCall.group.read.${statusKey}`);
  }

  if (info.family === "command") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.command.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "write") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.write.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "edit") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.edit.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "browser") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.browser.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "subagent") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.subagent.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "task") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.task.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "plan") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.plan.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "skill") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.skill.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "fetch") {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.fetch.${statusKey}`,
      countValues,
    );
  }

  if (info.family === "vision") {
    const normalizedName = normalizeToolNameKey(first.name);
    if (normalizedName === "viewimage") {
      return resolveRequiredAgentChatCopy(
        `toolCall.group.visionViewImage.${statusKey}`,
        countValues,
      );
    }

    return resolveRequiredAgentChatCopy(
      `toolCall.group.generic.${statusKey}`,
      countValues,
    );
  }

  if (isSiteToolGroup) {
    return resolveRequiredAgentChatCopy(
      `toolCall.group.siteOperation.${statusKey}`,
      countValues,
    );
  }

  return resolveRequiredAgentChatCopy(
    `toolCall.group.generic.${statusKey}`,
    countValues,
  );
};

export const buildGroupedChildLine = (toolCall: ToolCallState): string => {
  const info = getToolDisplayInfo(
    toolCall.name,
    toolCall.status,
    toolCall.metadata,
  );
  const args = parseToolCallArguments(toolCall.arguments);
  const filePath = resolveToolFilePath(args);
  const subject =
    resolveToolPrimarySubject(
      toolCall.name,
      args,
      filePath,
      toolCall.metadata,
    ) || humanizeToolName(toolCall.name);
  const normalizedSubject = subject?.trim();
  if (!normalizedSubject) {
    return info.label;
  }

  return `${info.verb} ${normalizedSubject}`;
};
