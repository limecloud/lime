import { normalizeLegacyToolSurfaceName } from "@/lib/api/agentTextNormalization";
import { resolveToolDisplayName } from "./toolDisplayName";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import { extractArtifactProtocolPathsFromValue } from "@/lib/artifact-protocol";
import {
  containsAssistantProtocolResidue,
  stripAssistantProtocolResidue,
} from "./protocolResidue";
import { resolveRequiredAgentChatCopy } from "./agentChatCopy";
import { resolveContentWorkbenchToolCopy } from "./contentWorkbenchToolCopy";
import {
  CONTENT_CREATE_TASK_TOOL_KEYS,
  CONTENT_TOOL_USER_FACING_COPY,
  DIRECT_CONTENT_GENERATION_TOOL_KEYS,
  DIRECT_CONTENT_GROUP_LABEL_COPY,
  SITE_TOOL_KEYS,
} from "./toolDisplayConfig";
import { resolveToolSubjectFallback } from "./toolDisplayCopy";
import {
  classifyMcpToolOperationKind,
  isBrowserToolName,
} from "./toolNameFamily";
import type { ToolCallArgumentValue } from "./toolDisplayTypes";

const stringifyToolArgumentValue = (
  value: ToolCallArgumentValue | unknown,
): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => stringifyToolArgumentValue(item))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
};

const truncatePreviewText = (value: string, max = 48): string =>
  value.length > max ? `${value.slice(0, max)}...` : value;

const resolveToolArgumentPreview = (
  args: Record<string, ToolCallArgumentValue>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = stringifyToolArgumentValue(args[key]);
    if (value) {
      return truncatePreviewText(value);
    }
  }
  return null;
};

const getFileName = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

const resolveVisionImageSubject = (
  args: Record<string, ToolCallArgumentValue>,
): string | null => {
  for (const key of ["path", "image_path", "imagePath", "image_url", "url"]) {
    const value = stringifyToolArgumentValue(args[key]);
    if (!value) {
      continue;
    }

    if (value.startsWith("data:image/")) {
      return resolveToolSubjectFallback("image");
    }

    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value);
        const pathName = url.pathname.trim();
        return pathName && pathName !== "/"
          ? getFileName(pathName)
          : url.hostname;
      } catch {
        return truncatePreviewText(value);
      }
    }

    return getFileName(value);
  }

  return null;
};

const TOOL_NAME_KEY_ALIASES: Record<string, string> = {
  requestuserinput: "requestuserinput",
  requestuserinputtool: "requestuserinput",
  "clock.sleep": "sleep",
  clocksleep: "sleep",
  sleep: "sleep",
  mcptool: "mcp",
  mcpauthtool: "mcpauth",
  repltool: "repl",
  spawnagent: "agent",
  subagenttask: "agent",
  agenttool: "agent",
  sendinput: "sendmessage",
  sendmessagetool: "sendmessage",
  bashtool: "bash",
  updateplan: "updateplan",
  updateplantool: "updateplan",
  update_plan: "updateplan",
  update_plan_tool: "updateplan",
  filereadtool: "read",
  readfiletool: "read",
  globtool: "glob",
  greptool: "grep",
  listmcpresourcestool: "listmcpresources",
  listmcpresourcetemplatestool: "listmcpresourcetemplates",
  readmcpresourcetool: "readmcpresource",
  memoryaddnote: "memoryaddnote",
  memoryaddnotetool: "memoryaddnote",
  memorylist: "memorylist",
  memorylisttool: "memorylist",
  memoryread: "memoryread",
  memoryreadtool: "memoryread",
  memorysearch: "memorysearch",
  memorysearchtool: "memorysearch",
  powershelltool: "powershell",
  skilltool: "skill",
  syntheticoutputtool: "structuredoutput",
  taskcreatetool: "taskcreate",
  taskgettool: "taskget",
  tasklisttool: "tasklist",
  taskoutputtool: "taskoutput",
  agentoutputtool: "taskoutput",
  bashoutputtool: "taskoutput",
  taskstoptool: "taskstop",
  taskupdatetool: "taskupdate",
  teamcreatetool: "teamcreate",
  teamdeletetool: "teamdelete",
  toolsearchtool: "toolsearch",
  webfetchtool: "webfetch",
  websearchtool: "websearch",
  task: "bash",
  killshell: "taskstop",
  todowrite: "taskupdate",
  writetodos: "taskupdate",
};

export const normalizeToolNameKey = (value: string): string => {
  const normalized = (normalizeLegacyToolSurfaceName(value) || value)
    .replace(/[\s_-]+/g, "")
    .trim()
    .toLowerCase();
  return TOOL_NAME_KEY_ALIASES[normalized] || normalized;
};

export const isContentWorkbenchToolKey = (toolName: string): boolean => {
  const name = normalizeToolNameKey(toolName);
  return (
    CONTENT_CREATE_TASK_TOOL_KEYS.has(name) ||
    DIRECT_CONTENT_GENERATION_TOOL_KEYS.has(name)
  );
};

export const isDirectContentGenerationToolKey = (toolName: string): boolean =>
  DIRECT_CONTENT_GENERATION_TOOL_KEYS.has(normalizeToolNameKey(toolName));

export const isSiteToolKey = (toolName: string): boolean =>
  SITE_TOOL_KEYS.has(normalizeToolNameKey(toolName));

export const resolveContentWorkbenchUserFacingLabel = (
  toolName: string,
): string | null => {
  const copy = CONTENT_TOOL_USER_FACING_COPY[normalizeToolNameKey(toolName)];
  return copy
    ? resolveContentWorkbenchToolCopy(copy.key, copy.defaultValue)
    : null;
};

export const resolveDirectContentGroupLabel = (
  toolName: string,
): string | null => {
  const copy = DIRECT_CONTENT_GROUP_LABEL_COPY[normalizeToolNameKey(toolName)];
  return copy
    ? resolveContentWorkbenchToolCopy(copy.key, copy.defaultValue)
    : null;
};

export const humanizeToolName = (toolName: string): string =>
  toolName
    .replace(/^mcp__/, "")
    .replace(/__/g, " / ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim() || resolveRequiredAgentChatCopy("toolCall.label.generic");

export const parseToolCallArguments = (
  value?: unknown,
): Record<string, ToolCallArgumentValue> => {
  if (value === undefined || value === null) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, ToolCallArgumentValue>;
  }
  const parseNamedArguments = (
    parsed: unknown,
  ): Record<string, ToolCallArgumentValue> | null => {
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    const entries = parsed
      .filter(
        (item): item is { name: string; value: ToolCallArgumentValue } =>
          Boolean(item) &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          typeof (item as { name?: unknown }).name === "string" &&
          (item as { name: string }).name.trim().length > 0 &&
          "value" in item,
      )
      .map((item) => [item.name, item.value] as const);
    return entries.length === parsed.length
      ? Object.fromEntries(entries)
      : null;
  };
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, ToolCallArgumentValue>;
    }
    const namedArguments = parseNamedArguments(parsed);
    if (namedArguments) {
      return namedArguments;
    }
    if (typeof parsed === "string" && parsed.trim()) {
      const nested = JSON.parse(parsed);
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        return nested as Record<string, ToolCallArgumentValue>;
      }
      const nestedNamedArguments = parseNamedArguments(nested);
      if (nestedNamedArguments) {
        return nestedNamedArguments;
      }
    }
  } catch {
    // ignore parse failure
  }
  return {};
};

export const resolveToolFilePath = (
  args: Record<string, ToolCallArgumentValue>,
): string | null => {
  return extractArtifactProtocolPathsFromValue(args)[0] ?? null;
};

export const resolveToolPrimarySubject = (
  toolName: string,
  args: Record<string, ToolCallArgumentValue>,
  filePath?: string | null,
  metadata?: unknown,
): string | null => {
  toolName = resolveToolDisplayName(toolName, metadata);
  const normalizedName = normalizeToolNameKey(toolName);

  if (filePath) return getFileName(filePath);

  if (
    normalizedName === "bash" ||
    normalizedName === "execcommand" ||
    normalizedName.includes("execcommand") ||
    normalizedName.includes("shell")
  ) {
    return resolveToolArgumentPreview(args, ["command", "cmd", "cwd"]);
  }

  if (normalizedName === "agent") {
    return resolveToolArgumentPreview(args, [
      "description",
      "task",
      "taskType",
      "role",
      "agent_type",
      "model",
    ]);
  }

  if (normalizedName === "sendmessage") {
    return (
      resolveToolArgumentPreview(args, ["message", "id", "agent_id"]) ||
      resolveToolSubjectFallback("targetSubtask")
    );
  }

  if (normalizedName === "teamcreate" || normalizedName === "teamdelete") {
    return (
      resolveToolArgumentPreview(args, ["team_name", "teamName"]) ||
      resolveToolSubjectFallback("currentSubagentGroup")
    );
  }

  if (normalizedName === "listpeers") {
    return (
      resolveToolArgumentPreview(args, ["team_name", "teamName"]) ||
      resolveToolSubjectFallback("currentSubagentGroup")
    );
  }

  if (
    normalizedName === "waitagent" ||
    normalizedName === "resumeagent" ||
    normalizedName === "closeagent"
  ) {
    return resolveToolArgumentPreview(args, ["id", "ids", "session_id"]);
  }

  if (
    normalizedName === "skill" ||
    normalizedName === "listskills" ||
    normalizedName === "loadskill"
  ) {
    return resolveToolArgumentPreview(args, [
      "name",
      "skill",
      "path",
      "query",
      "command",
    ]);
  }

  if (
    normalizedName === "memorylist" ||
    normalizedName === "memoryread" ||
    normalizedName === "memorysearch" ||
    normalizedName === "memoryaddnote"
  ) {
    return resolveToolArgumentPreview(args, [
      "path",
      "queries",
      "query",
      "title",
      "scope",
    ]);
  }

  if (
    normalizedName === "listmcpresources" ||
    normalizedName === "listmcpresourcetemplates"
  ) {
    return resolveToolArgumentPreview(args, ["server", "serverName", "name"]);
  }

  if (normalizedName === "readmcpresource") {
    return resolveToolArgumentPreview(args, [
      "uri",
      "resource_uri",
      "resourceUri",
      "resource",
      "server",
      "serverName",
    ]);
  }

  if (normalizedName === "viewimage") {
    return resolveVisionImageSubject(args);
  }

  if (isBrowserToolName(normalizedName)) {
    return (
      resolveToolArgumentPreview(args, [
        "url",
        "text",
        "textGone",
        "element",
        "name",
        "label",
        "ref",
        "key",
        "values",
        "value",
        "filename",
        "index",
        "id",
      ]) || resolveToolSubjectFallback("page")
    );
  }

  if (classifyMcpToolOperationKind(toolName)) {
    return resolveToolArgumentPreview(args, [
      "query",
      "q",
      "pattern",
      "path",
      "file_path",
      "url",
      "uri",
      "resource_uri",
      "resource",
      "title",
      "subject",
      "action",
      "name",
      "id",
      "repo",
      "repository",
      "owner",
      "ref",
      "key",
      "slug",
    ]);
  }

  if (
    normalizedName === "webfetch" ||
    normalizedName === "open" ||
    normalizedName === "finance" ||
    normalizedName === "weather" ||
    normalizedName === "sports" ||
    normalizedName === "time"
  ) {
    return resolveToolArgumentPreview(args, [
      "url",
      "location",
      "ticker",
      "team",
      "league",
      "utc_offset",
      "ref_id",
    ]);
  }

  if (
    normalizedName === "taskcreate" ||
    normalizedName === "tasklist" ||
    normalizedName === "taskget" ||
    normalizedName === "taskupdate" ||
    normalizedName === "updateplan" ||
    normalizedName === "taskoutput" ||
    normalizedName === "taskstop" ||
    normalizedName.startsWith("limecreate") ||
    normalizedName === "socialgeneratecoverimage" ||
    normalizedName === "generateimage"
  ) {
    return resolveToolArgumentPreview(args, [
      "subject",
      "title",
      "topic",
      "query",
      "q",
      "keyword",
      "prompt",
      "description",
      "source_url",
      "sourceUrl",
      "source_path",
      "sourcePath",
      "url",
      "resource_type",
      "resourceType",
      "target_platform",
      "targetPlatform",
      "extract_goal",
      "extractGoal",
      "content",
      "taskId",
      "task_id",
    ]);
  }

  if (normalizedName === "limerunserviceskill") {
    return (
      resolveToolArgumentPreview(args, [
        "skill_title",
        "skillTitle",
        "service_skill_id",
        "serviceSkillId",
        "scene_key",
        "sceneKey",
        "adapter_name",
        "name",
      ]) || resolveToolSubjectFallback("serviceSkill")
    );
  }

  if (normalizedName === "limesitelist") {
    return resolveToolSubjectFallback("siteCapabilityCatalog");
  }

  if (normalizedName === "limesiterun" || normalizedName === "limesiteinfo") {
    return (
      resolveToolArgumentPreview(args, [
        "skill_title",
        "skillTitle",
        "adapter_name",
        "name",
        "save_title",
        "saveTitle",
        "query",
        "repo",
        "url",
        "profile_key",
        "profileKey",
        "target_id",
        "targetId",
      ]) || resolveToolSubjectFallback("siteAdapter")
    );
  }

  if (normalizedName === "limesiterecommend") {
    return (
      resolveToolArgumentPreview(args, ["query", "q", "goal"]) ||
      resolveToolSubjectFallback("siteCapability")
    );
  }

  if (normalizedName === "limesitesearch") {
    return (
      resolveToolArgumentPreview(args, [
        "query",
        "q",
        "adapter_name",
        "name",
      ]) || resolveToolSubjectFallback("siteCapability")
    );
  }

  if (normalizedName === "toolsearch") {
    return resolveToolSubjectFallback("toolEntry");
  }

  if (normalizedName === "requestuserinput") {
    return resolveToolArgumentPreview(args, [
      "question",
      "header",
      "prompt",
      "request_id",
    ]);
  }

  return (
    resolveToolArgumentPreview(args, [
      "pattern",
      "query",
      "q",
      "search_query",
      "libraryName",
      "request_id",
      "path",
      "url",
      "command",
    ]) || null
  );
};

export const extractSearchQueryLabel = (toolCall: ToolCallState): string => {
  if (normalizeToolNameKey(toolCall.name) === "toolsearch") {
    return resolveToolSubjectFallback("toolEntry");
  }

  const record = parseToolCallArguments(toolCall.arguments) as Record<
    string,
    unknown
  >;
  for (const key of ["query", "q", "pattern", "search", "url"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      const sanitized = stripAssistantProtocolResidue(value).trim();
      if (sanitized) {
        return sanitized;
      }

      if (containsAssistantProtocolResidue(value)) {
        return resolveToolSubjectFallback("internalProcess");
      }

      return value.trim();
    }
  }

  return toolCall.name;
};
