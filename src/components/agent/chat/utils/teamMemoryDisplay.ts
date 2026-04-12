export function normalizeTeamMemoryDisplayText(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/^Team[:：]\s*/gm, "任务方案：")
    .replace(/^子代理[:：]\s*/gm, "子任务：");
}
