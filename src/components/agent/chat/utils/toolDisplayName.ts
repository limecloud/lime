/** 只解释 canonical 工具的展示作用域，不改变执行名或协议身份。 */
export function resolveToolDisplayName(
  toolName: string,
  metadata?: unknown,
): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return toolName;
  }
  const record = metadata as Record<string, unknown>;
  if (
    record.canonical_type !== "dynamicToolCall" ||
    record.namespace !== "browser" ||
    toolName.includes("__") ||
    toolName.includes(".")
  ) {
    return toolName;
  }
  return `browser__${toolName}`;
}
