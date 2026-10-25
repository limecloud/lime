// 适配安装包 plugins-page-selectors 的连续子串匹配，压缩符号不作为原始命名。
export function matchesQuery(
  query: string,
  values: (string | null | undefined)[],
): boolean {
  const normalized = query.trim().toLowerCase();
  return !normalized || values.join(" ").toLowerCase().includes(normalized);
}
