// 轻量连续子串匹配，供 MCP 服务器筛选复用。
export function matchesQuery(
  query: string,
  values: (string | null | undefined)[],
): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || values.join(" ").toLowerCase().includes(normalized);
}
