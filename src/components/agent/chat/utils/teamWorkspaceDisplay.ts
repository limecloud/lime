const TEAM_WORKSPACE_DISPLAY_REPLACEMENTS: Array<readonly [RegExp, string]> = [
  [/\bteam\s*状态事件\b/gi, "任务状态事件"],
  [/\bTeam\b/g, "分工方案"],
  [/\bteam\b/g, "分工方案"],
  [/任务方案/g, "分工方案"],
  [/主任务/g, "主助手"],
  [/子代理/g, "子任务"],
  [/多代理/g, "任务拆分"],
];

function normalizeInsertedChineseSpacing(value: string): string {
  return value
    .replace(/([\u4e00-\u9fff])\s+(分工方案|任务|子任务|任务拆分)/g, "$1$2")
    .replace(/(分工方案|任务|子任务|任务拆分)\s+([\u4e00-\u9fff])/g, "$1$2");
}

export function normalizeTeamWorkspaceDisplayText(
  value?: string | null,
): string {
  if (typeof value !== "string") {
    return "";
  }

  const replaced = TEAM_WORKSPACE_DISPLAY_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    value,
  );

  return normalizeInsertedChineseSpacing(replaced);
}

export function normalizeTeamWorkspaceDisplayValue(
  value?: string | null,
): string | null {
  const normalized = normalizeTeamWorkspaceDisplayText(value).trim();
  return normalized || null;
}
