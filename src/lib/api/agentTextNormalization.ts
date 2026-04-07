const LEGACY_DECISION_PREFIX_RE = /^已决定[:：]\s*/;
const LEGACY_TOOL_SURFACE_ALIASES: Record<string, string> = {
  ask: "AskUserQuestion",
  requestuserinput: "AskUserQuestion",
  requestuserinputtool: "AskUserQuestion",
  askuserquestiontool: "AskUserQuestion",
  brief: "SendUserMessage",
  brieftool: "SendUserMessage",
  sendusermessage: "SendUserMessage",
  sendusermessagetool: "SendUserMessage",
  spawnagent: "Agent",
  subagenttask: "Agent",
  agenttool: "Agent",
  sendinput: "SendMessage",
  sendmessagetool: "SendMessage",
  bashtool: "Bash",
  configtool: "Config",
  enterplanmodetool: "EnterPlanMode",
  exitplanmodetool: "ExitPlanMode",
  enterworktreetool: "EnterWorktree",
  exitworktreetool: "ExitWorktree",
  filereadtool: "Read",
  readfiletool: "Read",
  filewritetool: "Write",
  writefiletool: "Write",
  createfiletool: "Write",
  fileedittool: "Edit",
  globtool: "Glob",
  greptool: "Grep",
  lsptool: "LSP",
  listmcpresourcestool: "ListMcpResourcesTool",
  readmcpresourcetool: "ReadMcpResourceTool",
  notebookedittool: "NotebookEdit",
  powershelltool: "PowerShell",
  remotetriggertool: "RemoteTrigger",
  schedulecrontool: "CronCreate",
  croncreatetool: "CronCreate",
  cronlisttool: "CronList",
  crondeletetool: "CronDelete",
  skilltool: "Skill",
  sleeptool: "Sleep",
  syntheticoutputtool: "StructuredOutput",
  taskcreatetool: "TaskCreate",
  taskgettool: "TaskGet",
  tasklisttool: "TaskList",
  taskoutputtool: "TaskOutput",
  agentoutputtool: "TaskOutput",
  bashoutputtool: "TaskOutput",
  taskstoptool: "TaskStop",
  taskupdatetool: "TaskUpdate",
  teamcreatetool: "TeamCreate",
  teamdeletetool: "TeamDelete",
  toolsearchtool: "ToolSearch",
  webfetchtool: "WebFetch",
  websearchtool: "WebSearch",
};

export function normalizeLegacyRuntimeStatusTitle(title: string): string {
  return title.replace(LEGACY_DECISION_PREFIX_RE, "").trim();
}

function normalizeLegacyTurnSummaryText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return "";
  }

  const [firstLine = "", ...rest] = normalized.split(/\r?\n/);
  const normalizedFirstLine = normalizeLegacyRuntimeStatusTitle(firstLine);

  if (rest.length === 0) {
    return normalizedFirstLine;
  }

  return [normalizedFirstLine, ...rest]
    .filter((line, index) => index > 0 || line)
    .join("\n");
}

export function normalizeLegacyToolSurfaceName(
  value?: string | null,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const key = normalized.replace(/[\s_-]+/g, "").toLowerCase();
  return LEGACY_TOOL_SURFACE_ALIASES[key] || normalized;
}

export function normalizeLegacyThreadItem<
  T extends { type?: unknown; text?: unknown },
>(item: T): T {
  if (item.type !== "turn_summary" || typeof item.text !== "string") {
    return item;
  }

  return {
    ...item,
    text: normalizeLegacyTurnSummaryText(item.text),
  };
}

export function normalizeLegacyThreadItems<
  T extends { type?: unknown; text?: unknown },
>(items: T[]): T[] {
  return items.map((item) => normalizeLegacyThreadItem(item));
}
