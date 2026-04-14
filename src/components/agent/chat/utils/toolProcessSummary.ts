import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import { extractLimeToolMetadataBlock } from "../hooks/agentChatToolResult";
import type { AgentThreadItem } from "../types";
import {
  getHostnameFromUrl,
  isUnifiedWebSearchToolName,
  resolveSearchResultPreviewItemsFromText,
} from "./searchResultPreview";
import {
  normalizeSiteToolResultSummary,
  resolveSiteProjectTargetLabel,
} from "./siteToolResultSummary";
import {
  getToolDisplayInfo,
  isBrowserToolName,
  normalizeToolNameKey,
  parseToolCallArguments,
  resolveToolFilePath,
  resolveToolPrimarySubject,
  type ToolCallArgumentValue,
} from "./toolDisplayInfo";
import {
  normalizeToolSearchResultSummary,
  resolveUserFacingToolSearchItemLabel,
} from "./toolSearchResultSummary";

type ToolProcessStatus =
  | ToolCallState["status"]
  | Extract<AgentThreadItem["status"], "in_progress">;

type ToolProcessNarrativeSource =
  | "none"
  | "error"
  | "tool_search"
  | "search_results"
  | "site"
  | "plain_result"
  | "generic";

export interface ToolProcessNarrative {
  preSummary: string | null;
  postSummary: string | null;
  summary: string | null;
  postSource: ToolProcessNarrativeSource;
}

interface ToolProcessInput {
  toolName: string;
  argumentsValue?: string | Record<string, unknown>;
  status: ToolProcessStatus;
  output?: string;
  error?: string;
  metadata?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function collapseWhitespace(value: string): string {
  return value
    .replace(/\s+([，。！？、；：,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(
  value: string | null | undefined,
  maxLength = 80,
): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function stripFencedCode(value: string): string {
  return value.replace(/```[\s\S]*?```/g, "").trim();
}

function looksLikeCodeOrJson(value: string): boolean {
  return /^(?:[{[]|import\s|export\s|const\s|let\s|var\s|function\s|class\s|if\s*\(|for\s*\(|while\s*\(|return\s|<\w+)/i.test(
    value,
  );
}

function looksLikeOpaqueAck(value: string): boolean {
  return /^(?:ok|okay|done|success|completed|true|false|null|undefined)$/i.test(
    value.trim(),
  );
}

function normalizePlainResultLine(
  value: string | null | undefined,
  maxLength = 96,
): string | null {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const stripped = stripFencedCode(extractLimeToolMetadataBlock(raw).text);
  if (!stripped) {
    return null;
  }

  const line =
    stripped
      .split(/\r?\n/)
      .map((entry) => collapseWhitespace(entry))
      .find(Boolean) || "";
  if (!line || looksLikeCodeOrJson(line) || looksLikeOpaqueAck(line)) {
    return null;
  }

  return shorten(line, maxLength);
}

function normalizeArgumentsRecord(
  value?: string | Record<string, unknown>,
): Record<string, unknown> {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    return parseToolCallArguments(value) as Record<string, unknown>;
  }

  return value;
}

function resolveToolSubject(
  toolName: string,
  argumentsValue?: string | Record<string, unknown>,
): string | null {
  const args = normalizeArgumentsRecord(argumentsValue);
  const toolArgs = args as Record<string, ToolCallArgumentValue>;
  return resolveToolPrimarySubject(
    toolName,
    toolArgs,
    resolveToolFilePath(toolArgs),
  );
}

function resolveUrlLabel(
  args: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
): string | null {
  const rawUrl =
    readString(args, ["url", "pageUrl", "page_url", "href"]) ||
    readString(metadata, ["url", "pageUrl", "page_url", "href"]);
  if (!rawUrl) {
    return null;
  }

  const hostname = shorten(getHostnameFromUrl(rawUrl), 48);
  return hostname || shorten(rawUrl, 64);
}

function buildToolSearchPreSummary(args: Record<string, unknown>): string {
  const query = readString(args, ["query", "q"]) || "";
  if (/^(?:select|tool|tools|name|tag):/i.test(query)) {
    return "先确认可用工具和入口";
  }
  if (query) {
    return `先找能处理 ${shorten(query, 32)} 的工具入口`;
  }
  return "先确认可用工具和入口";
}

function buildToolSearchPostSummary(output: string): string | null {
  const summary = normalizeToolSearchResultSummary(output);
  if (!summary) {
    return null;
  }

  const toolNames = summary.tools
    .slice(0, 2)
    .map((item) => resolveUserFacingToolSearchItemLabel(item.name))
    .filter(Boolean);
  const prefix = `已确认可用工具 ${summary.count} 个`;

  if (toolNames.length === 0) {
    return prefix;
  }

  return `${prefix} · ${toolNames.join(" · ")}`;
}

function buildWebSearchPostSummary(output: string): string | null {
  const items = resolveSearchResultPreviewItemsFromText(output);
  if (items.length === 0) {
    return null;
  }

  return `已找到 ${items.length} 个可参考来源`;
}

function buildSitePostSummary(metadata: unknown): string | null {
  const summary = normalizeSiteToolResultSummary(metadata);
  if (!summary) {
    return null;
  }

  if (summary.saveErrorMessage) {
    return `自动保存失败：${shorten(summary.saveErrorMessage, 56)}`;
  }

  if (summary.savedContent?.title) {
    return `已保存到${resolveSiteProjectTargetLabel({
      source: summary.savedBy,
      projectId: summary.savedProjectId || summary.savedContent.projectId,
    })}：${summary.savedContent.title}`;
  }

  if (summary.savedContent?.markdownRelativePath) {
    return "已导出 Markdown 文稿";
  }

  if (summary.saveSkippedProjectId) {
    return `未保存到${resolveSiteProjectTargetLabel({
      source: summary.saveSkippedBy,
      projectId: summary.saveSkippedProjectId,
    })}`;
  }

  return null;
}

const LIME_TASK_SUMMARY_LABELS: Partial<Record<string, string>> = {
  limecreatevideogenerationtask: "视频生成",
  limecreatetranscriptiontask: "转写",
  limecreatebroadcastgenerationtask: "口播生成",
  limecreatecovergenerationtask: "封面生成",
  limecreateresourcesearchtask: "素材检索",
  limecreatemodalresourcesearchtask: "素材检索",
  limecreateimagegenerationtask: "图片生成",
  limecreateurlparsetask: "链接解析",
  limecreatetypesettingtask: "排版",
};

function normalizeNarrativeSubject(
  subject: string | null,
  placeholders: string[] = [],
): string | null {
  const normalized = shorten(subject, 48);
  if (!normalized) {
    return null;
  }

  return placeholders.includes(normalized) ? null : normalized;
}

function buildLimeTaskSummary(
  phase: "pre" | "post",
  normalizedName: string,
  subject: string | null,
): string | null {
  const taskLabel = LIME_TASK_SUMMARY_LABELS[normalizedName];
  if (!taskLabel) {
    return null;
  }

  const normalizedSubject = normalizeNarrativeSubject(subject);
  const prefix = phase === "pre" ? "先提交" : "已提交";

  return normalizedSubject
    ? `${prefix} ${normalizedSubject} 的${taskLabel}任务`
    : `${prefix}${taskLabel}任务`;
}

function buildSiteToolSummary(
  phase: "pre" | "post",
  normalizedName: string,
  subject: string | null,
): string | null {
  const normalizedSubject = normalizeNarrativeSubject(subject, [
    "站点能力",
    "站点能力目录",
    "站点适配器",
  ]);

  if (normalizedName === "limesitelist") {
    return phase === "pre" ? "先查看可用站点能力" : "已查看可用站点能力";
  }

  if (normalizedName === "limesiterecommend") {
    return normalizedSubject
      ? `${phase === "pre" ? "先推荐适合" : "已推荐适合"} ${normalizedSubject} 的站点能力`
      : phase === "pre"
        ? "先推荐合适的站点能力"
        : "已推荐站点能力";
  }

  if (normalizedName === "limesitesearch") {
    return normalizedSubject
      ? `${phase === "pre" ? "先搜索" : "已搜索"} ${normalizedSubject} 相关站点能力`
      : phase === "pre"
        ? "先搜索站点能力"
        : "已搜索站点能力";
  }

  if (normalizedName === "limesiteinfo") {
    return normalizedSubject
      ? `${phase === "pre" ? "先确认" : "已确认"} ${normalizedSubject} 的参数与登录要求`
      : phase === "pre"
        ? "先确认站点能力的参数与登录要求"
        : "已确认站点能力的参数与登录要求";
  }

  if (normalizedName === "limesiterun") {
    return normalizedSubject
      ? `${phase === "pre" ? "先执行" : "已执行"}站点能力 ${normalizedSubject}`
      : phase === "pre"
        ? "先执行站点能力"
        : "已执行站点能力";
  }

  return null;
}

function buildCommandPreSummary(
  normalizedName: string,
  args: Record<string, unknown>,
): string | null {
  const command = readString(args, ["command", "cmd", "script"]) || "";
  if (normalizedName === "bash" || normalizedName.includes("shell")) {
    if (/^(?:rg|grep|findstr)\b/i.test(command)) {
      return "先搜索代码位置";
    }
    if (/^(?:sed|cat|head|tail)\b/i.test(command)) {
      return "先查看文件片段";
    }
    if (/^git\s+status\b/i.test(command)) {
      return "先确认工作区状态";
    }
    if (/^git\s+diff\b/i.test(command)) {
      return "先查看变更差异";
    }
  }

  return "先运行命令确认当前状态";
}

function buildBrowserPreSummary(
  normalizedName: string,
  args: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
): string | null {
  const urlLabel = resolveUrlLabel(args, metadata);
  const target =
    readString(args, ["selector", "element", "target", "label", "text"]) ||
    readString(metadata, ["selector", "element", "target", "label", "text"]);

  if (normalizedName.includes("navigate") || normalizedName.includes("goto")) {
    return urlLabel ? `先打开 ${urlLabel}` : "先打开目标页面";
  }

  if (
    normalizedName.includes("snapshot") ||
    normalizedName.includes("screenshot")
  ) {
    return "先抓取页面状态";
  }

  if (normalizedName.includes("click")) {
    return target ? `先操作 ${shorten(target, 28)}` : "先操作页面元素";
  }

  if (
    normalizedName.includes("fill") ||
    normalizedName.includes("type") ||
    normalizedName.includes("selectoption") ||
    normalizedName.includes("presskey")
  ) {
    return target ? `先填写 ${shorten(target, 28)}` : "先继续页面操作";
  }

  if (
    normalizedName.includes("evaluate") ||
    normalizedName.includes("runtime")
  ) {
    return "先读取页面信息";
  }

  return "先查看页面状态";
}

function buildBrowserPostSummary(
  normalizedName: string,
  args: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
): string | null {
  const urlLabel = resolveUrlLabel(args, metadata);

  if (normalizedName.includes("navigate") || normalizedName.includes("goto")) {
    return urlLabel ? `已打开 ${urlLabel}` : "已打开目标页面";
  }

  if (
    normalizedName.includes("snapshot") ||
    normalizedName.includes("screenshot")
  ) {
    return "已拿到页面快照";
  }

  if (
    normalizedName.includes("evaluate") ||
    normalizedName.includes("runtime")
  ) {
    return "已拿到页面状态";
  }

  return "已完成页面操作";
}

function buildGenericPostSummary(params: {
  toolName: string;
  status: ToolProcessStatus;
  subject: string | null;
}): string | null {
  const { toolName, subject, status } = params;
  const normalizedName = normalizeToolNameKey(toolName);
  const display = getToolDisplayInfo(
    toolName,
    status === "in_progress" ? "running" : status,
  );
  const normalizedSubject = normalizeNarrativeSubject(subject);

  if (normalizedName === "enterworktree") {
    return "已进入隔离工作树";
  }
  if (normalizedName === "exitworktree") {
    return "已回到主工作区";
  }
  if (normalizedName === "config") {
    return "已更新运行配置";
  }
  if (normalizedName === "workflow") {
    return "已执行工作流";
  }
  if (normalizedName === "sleep") {
    return "已完成等待";
  }
  if (normalizedName === "enterplanmode") {
    return "已进入计划模式";
  }
  if (normalizedName === "exitplanmode") {
    return "已退出计划模式";
  }
  if (normalizedName === "structuredoutput") {
    return "已整理最终答复";
  }
  if (normalizedName === "skill") {
    return normalizedSubject ? `已执行技能 ${normalizedSubject}` : "已执行技能";
  }
  if (normalizedName === "listskills") {
    return "已查看可用技能";
  }
  if (normalizedName === "loadskill") {
    return normalizedSubject ? `已加载技能 ${normalizedSubject}` : "已加载技能";
  }
  if (normalizedName === "listmcpresources") {
    return "已查看可用 MCP 资源";
  }
  if (normalizedName === "readmcpresource") {
    return normalizedSubject
      ? `已读取 ${normalizedSubject}`
      : "已读取 MCP 资源";
  }
  if (normalizedName === "tasklist") {
    return "已查看任务列表";
  }
  if (normalizedName === "taskcreate") {
    return normalizedSubject ? `已创建任务 ${normalizedSubject}` : "已创建任务";
  }
  if (normalizedName === "taskget") {
    return normalizedSubject
      ? `已查看任务 ${normalizedSubject}`
      : "已查看任务详情";
  }
  if (normalizedName === "taskupdate") {
    return normalizedSubject ? `已更新任务 ${normalizedSubject}` : "已更新任务";
  }
  if (normalizedName === "taskoutput") {
    return normalizedSubject
      ? `已查看 ${normalizedSubject} 的任务结果`
      : "已查看任务结果";
  }
  if (normalizedName === "taskstop") {
    return normalizedSubject ? `已终止任务 ${normalizedSubject}` : "已终止任务";
  }
  if (normalizedName === "teamcreate") {
    return normalizedSubject
      ? `已创建团队 ${normalizedSubject}`
      : "已创建协作团队";
  }
  if (normalizedName === "teamdelete") {
    return normalizedSubject
      ? `已删除团队 ${normalizedSubject}`
      : "已删除协作团队";
  }
  if (normalizedName === "listpeers") {
    return normalizedSubject
      ? `已查看 ${normalizedSubject} 的协作成员`
      : "已查看团队成员";
  }
  if (normalizedName === "croncreate") {
    return normalizedSubject
      ? `已创建定时触发器 ${normalizedSubject}`
      : "已创建定时触发器";
  }
  if (normalizedName === "cronlist") {
    return "已查看定时触发器";
  }
  if (normalizedName === "crondelete") {
    return normalizedSubject
      ? `已删除定时触发器 ${normalizedSubject}`
      : "已删除定时触发器";
  }
  if (normalizedName === "remotetrigger") {
    return normalizedSubject
      ? `已处理 ${normalizedSubject}`
      : "已处理远程触发器";
  }
  const limeTaskSummary = buildLimeTaskSummary(
    "post",
    normalizedName,
    normalizedSubject,
  );
  if (limeTaskSummary) {
    return limeTaskSummary;
  }
  const siteToolSummary = buildSiteToolSummary(
    "post",
    normalizedName,
    normalizedSubject,
  );
  if (siteToolSummary) {
    return siteToolSummary;
  }
  if (normalizedName === "limerunserviceskill") {
    return normalizedSubject
      ? `已执行服务技能 ${normalizedSubject}`
      : "已执行服务技能";
  }
  if (normalizedName === "mcp") {
    return "已完成 MCP 工具调用";
  }
  if (normalizedName === "mcpauth") {
    return "已完成 MCP 授权";
  }

  switch (display.family) {
    case "read":
      return normalizedSubject
        ? `已查看 ${normalizedSubject}`
        : "已查看相关文件";
    case "list":
      return normalizedSubject
        ? `已定位 ${normalizedSubject}`
        : "已定位相关文件";
    case "write":
      return normalizedSubject ? `已写入 ${normalizedSubject}` : "已写入文件";
    case "edit":
      return normalizedSubject
        ? `已修改 ${normalizedSubject}`
        : "已修改目标文件";
    case "command":
      return "已拿到命令结果";
    case "fetch":
      return normalizedSubject
        ? `已获取 ${normalizedSubject} 内容`
        : "已获取外部内容";
    case "task":
      return "已创建任务";
    case "subagent":
      return "已把任务拆给子任务继续处理";
    case "search":
      return normalizedSubject
        ? `已搜索 ${normalizedSubject}`
        : "已拿到搜索结果";
    case "browser":
      return "已完成页面操作";
    case "plan":
      return normalizedSubject
        ? `已处理 ${normalizedSubject}`
        : "已完成计划操作";
    default:
      return normalizedSubject ? `已处理 ${normalizedSubject}` : null;
  }
}

function buildGenericPreSummary(params: {
  toolName: string;
  argumentsValue?: string | Record<string, unknown>;
  metadata?: unknown;
}): string | null {
  const { toolName, argumentsValue, metadata } = params;
  const normalizedName = normalizeToolNameKey(toolName);
  const args = normalizeArgumentsRecord(argumentsValue);
  const metadataRecord = asRecord(metadata);
  const subject = resolveToolSubject(toolName, argumentsValue);
  const query =
    readString(args, ["query", "q", "pattern", "search_query"]) ||
    readString(metadataRecord, ["query", "q", "pattern", "search_query"]);

  if (normalizedName === "toolsearch") {
    return buildToolSearchPreSummary(args);
  }

  if (normalizedName === "agent") {
    return "先拆成子任务并行处理";
  }

  if (normalizedName === "sendmessage") {
    return "先补充子任务说明";
  }

  if (normalizedName === "waitagent") {
    return "先等待子任务返回结果";
  }

  if (normalizedName === "closeagent") {
    return "先结束不再需要的子任务";
  }

  if (normalizedName === "askuserquestion") {
    return subject
      ? `先确认 ${shorten(subject, 40)}`
      : "先确认继续执行所需信息";
  }

  if (normalizedName === "enterworktree") {
    return "先进入隔离工作树";
  }

  if (normalizedName === "exitworktree") {
    return "先回到主工作区";
  }

  if (normalizedName === "config") {
    return "先查看或调整运行配置";
  }

  if (normalizedName === "workflow") {
    return "先执行预设工作流";
  }

  if (normalizedName === "sleep") {
    return "先等待一段时间再继续";
  }

  if (normalizedName === "sendusermessage" || normalizedName === "brief") {
    return "先把中间结论同步给主线程";
  }

  if (isUnifiedWebSearchToolName(toolName)) {
    return query ? `先搜索 ${shorten(query, 36)}` : "先搜索相关资料";
  }

  if (isBrowserToolName(normalizedName)) {
    return buildBrowserPreSummary(normalizedName, args, metadataRecord);
  }

  const display = getToolDisplayInfo(toolName, "running");
  const normalizedSubject = normalizeNarrativeSubject(subject);

  if (normalizedName === "enterplanmode") {
    return "先进入计划模式拆解方案";
  }

  if (normalizedName === "exitplanmode") {
    return "先退出计划模式继续执行";
  }

  if (normalizedName === "structuredoutput") {
    return "先整理最终答复";
  }

  if (normalizedName === "skill") {
    return normalizedSubject ? `先执行技能 ${normalizedSubject}` : "先执行技能";
  }

  if (normalizedName === "listskills") {
    return "先查看可用技能";
  }

  if (normalizedName === "loadskill") {
    return normalizedSubject ? `先加载技能 ${normalizedSubject}` : "先加载技能";
  }

  if (normalizedName === "listmcpresources") {
    return "先查看可用 MCP 资源";
  }

  if (normalizedName === "readmcpresource") {
    return normalizedSubject
      ? `先读取 ${normalizedSubject}`
      : "先读取 MCP 资源";
  }

  if (normalizedName === "taskcreate") {
    return normalizedSubject
      ? `先创建任务 ${normalizedSubject}`
      : "先创建结构化任务";
  }

  if (normalizedName === "tasklist") {
    return "先查看任务列表";
  }

  if (normalizedName === "taskget") {
    return normalizedSubject
      ? `先查看任务 ${normalizedSubject}`
      : "先查看任务详情";
  }

  if (normalizedName === "taskupdate") {
    return normalizedSubject
      ? `先更新任务 ${normalizedSubject}`
      : "先更新任务状态";
  }

  if (normalizedName === "taskoutput") {
    return normalizedSubject
      ? `先查看 ${normalizedSubject} 的任务结果`
      : "先查看任务结果";
  }

  if (normalizedName === "taskstop") {
    return normalizedSubject ? `先终止任务 ${normalizedSubject}` : "先终止任务";
  }

  if (normalizedName === "teamcreate") {
    return normalizedSubject
      ? `先创建团队 ${normalizedSubject}`
      : "先创建协作团队";
  }

  if (normalizedName === "teamdelete") {
    return normalizedSubject
      ? `先删除团队 ${normalizedSubject}`
      : "先删除协作团队";
  }

  if (normalizedName === "listpeers") {
    return normalizedSubject
      ? `先查看 ${normalizedSubject} 的协作成员`
      : "先查看团队成员";
  }

  if (normalizedName === "croncreate") {
    return normalizedSubject
      ? `先创建定时触发器 ${normalizedSubject}`
      : "先创建定时触发器";
  }

  if (normalizedName === "cronlist") {
    return "先查看定时触发器";
  }

  if (normalizedName === "crondelete") {
    return normalizedSubject
      ? `先删除定时触发器 ${normalizedSubject}`
      : "先删除定时触发器";
  }

  if (normalizedName === "remotetrigger") {
    return normalizedSubject
      ? `先处理 ${normalizedSubject}`
      : "先处理远程触发器";
  }
  const limeTaskSummary = buildLimeTaskSummary(
    "pre",
    normalizedName,
    normalizedSubject,
  );
  if (limeTaskSummary) {
    return limeTaskSummary;
  }
  const siteToolSummary = buildSiteToolSummary(
    "pre",
    normalizedName,
    normalizedSubject,
  );
  if (siteToolSummary) {
    return siteToolSummary;
  }

  if (normalizedName === "limerunserviceskill") {
    return normalizedSubject
      ? `先执行服务技能 ${normalizedSubject}`
      : "先执行服务技能";
  }

  if (normalizedName === "mcp") {
    return "先调用 MCP 工具";
  }

  if (normalizedName === "mcpauth") {
    return "先完成 MCP 授权";
  }

  switch (display.family) {
    case "read":
      return normalizedSubject
        ? `先查看 ${normalizedSubject}`
        : "先查看相关文件";
    case "list":
      if (normalizedName.includes("grep") || normalizedName.includes("glob")) {
        return normalizedSubject
          ? `先定位 ${normalizedSubject}`
          : "先定位相关文件";
      }
      return normalizedSubject
        ? `先查看 ${normalizedSubject}`
        : "先查看目录结构";
    case "command":
      return buildCommandPreSummary(normalizedName, args);
    case "fetch": {
      const urlLabel = resolveUrlLabel(args, metadataRecord);
      return urlLabel ? `先获取 ${urlLabel} 内容` : "先获取外部内容";
    }
    case "search":
      return query ? `先搜索 ${shorten(query, 36)}` : "先搜索相关资料";
    case "write":
      return normalizedSubject
        ? `准备写入 ${normalizedSubject}`
        : "准备写入文件";
    case "edit":
      return normalizedSubject
        ? `准备修改 ${normalizedSubject}`
        : "准备修改目标文件";
    case "task":
      return "先创建生成任务";
    case "plan":
      return normalizedSubject
        ? `先处理 ${normalizedSubject}`
        : "先处理计划任务";
    default:
      return normalizedSubject ? `先处理 ${normalizedSubject}` : null;
  }
}

function buildNarrative(input: ToolProcessInput): ToolProcessNarrative {
  const preSummary = buildGenericPreSummary({
    toolName: input.toolName,
    argumentsValue: input.argumentsValue,
    metadata: input.metadata,
  });
  const normalizedName = normalizeToolNameKey(input.toolName);
  const resultOutput = input.output || "";
  const plainError = normalizePlainResultLine(input.error, 88);
  const plainOutput = normalizePlainResultLine(resultOutput, 96);
  const args = normalizeArgumentsRecord(input.argumentsValue);
  const metadata = asRecord(input.metadata);
  const subject = resolveToolSubject(input.toolName, input.argumentsValue);

  let postSummary: string | null = null;
  let postSource: ToolProcessNarrativeSource = "none";

  if (input.status === "failed") {
    postSummary =
      plainError || (plainOutput ? `执行失败：${plainOutput}` : null);
    if (postSummary) {
      if (!postSummary.startsWith("执行失败：")) {
        postSummary = `执行失败：${postSummary}`;
      }
      postSource = "error";
    }
  }

  if (!postSummary) {
    const siteSummary = buildSitePostSummary(input.metadata);
    if (siteSummary) {
      postSummary = siteSummary;
      postSource = "site";
    }
  }

  if (!postSummary && normalizedName === "toolsearch") {
    const toolSearchSummary = buildToolSearchPostSummary(resultOutput);
    if (toolSearchSummary) {
      postSummary = toolSearchSummary;
      postSource = "tool_search";
    }
  }

  if (!postSummary && isUnifiedWebSearchToolName(input.toolName)) {
    const searchSummary = buildWebSearchPostSummary(resultOutput);
    if (searchSummary) {
      postSummary = searchSummary;
      postSource = "search_results";
    }
  }

  if (!postSummary && isBrowserToolName(normalizedName)) {
    postSummary = buildBrowserPostSummary(normalizedName, args, metadata);
    postSource = postSummary ? "generic" : "none";
  }

  if (!postSummary && plainOutput) {
    postSummary = plainOutput;
    postSource = "plain_result";
  }

  if (!postSummary) {
    postSummary = buildGenericPostSummary({
      toolName: input.toolName,
      status: input.status,
      subject,
    });
    postSource = postSummary ? "generic" : "none";
  }

  const summary =
    input.status === "running" || input.status === "in_progress"
      ? preSummary
      : postSummary || preSummary;

  return {
    preSummary,
    postSummary,
    summary,
    postSource,
  };
}

export function resolveToolProcessNarrative(
  toolCall: ToolCallState,
): ToolProcessNarrative {
  return buildNarrative({
    toolName: toolCall.name,
    argumentsValue: toolCall.arguments,
    status: toolCall.status,
    output: toolCall.result?.output,
    error: toolCall.result?.error,
    metadata: toolCall.result?.metadata,
  });
}

export function resolveAgentThreadToolProcessNarrative(
  item: AgentThreadItem,
): ToolProcessNarrative | null {
  if (item.type === "tool_call") {
    return buildNarrative({
      toolName: item.tool_name,
      argumentsValue: asRecord(item.arguments) || undefined,
      status: item.status,
      output: item.output,
      error: item.error,
      metadata: item.metadata,
    });
  }

  if (item.type === "command_execution") {
    return buildNarrative({
      toolName: "exec_command",
      argumentsValue: {
        command: item.command,
        cwd: item.cwd,
      },
      status: item.status,
      output: item.aggregated_output,
      error: item.error,
      metadata:
        item.exit_code !== undefined
          ? {
              exit_code: item.exit_code,
              cwd: item.cwd,
            }
          : { cwd: item.cwd },
    });
  }

  if (item.type === "web_search") {
    return buildNarrative({
      toolName: item.action || "web_search",
      argumentsValue: item.query ? { query: item.query } : undefined,
      status: item.status,
      output: item.output,
    });
  }

  return null;
}

export function resolveAgentThreadToolProcessPreview(
  item: AgentThreadItem,
): string | null {
  const narrative = resolveAgentThreadToolProcessNarrative(item);
  if (!narrative) {
    return null;
  }

  if (item.status !== "completed") {
    return narrative.summary;
  }

  return narrative.postSource !== "generic" ? narrative.summary : null;
}
