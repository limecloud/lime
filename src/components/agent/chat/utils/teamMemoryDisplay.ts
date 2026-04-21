export function normalizeTeamMemoryDisplayText(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/^Team[:：]\s*/gm, "分工方案：")
    .replace(/^任务方案[:：]\s*/gm, "分工方案：")
    .replace(/^子代理[:：]\s*/gm, "子任务：");
}
