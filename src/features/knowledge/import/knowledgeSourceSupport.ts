export const KNOWLEDGE_TEXT_SOURCE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdown",
  "mkd",
  "txt",
  "text",
]);

export interface KnowledgeSourceCandidate {
  name?: string | null;
  path?: string | null;
  isDir?: boolean | null;
  size?: number | null;
  mimeType?: string | null;
}

export function getKnowledgeSourceDisplayName(
  source: KnowledgeSourceCandidate,
): string {
  const name = source.name?.trim();
  if (name) {
    return name;
  }
  const normalizedPath = source.path?.trim().replace(/\\/g, "/") ?? "";
  return normalizedPath.split("/").filter(Boolean).at(-1) || "项目资料";
}

export function getKnowledgeSourceExtension(value: string): string {
  const basename = value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
  const index = basename.lastIndexOf(".");
  return index >= 0 ? basename.slice(index + 1).toLowerCase() : "";
}

export function normalizeKnowledgeSourceTitle(value: string): string {
  const basename = value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
  return (
    basename
      .replace(/\.[^.]+$/, "")
      .replace(/^\d{8,}[-_\s]*/, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "项目资料"
  );
}

export function isKnowledgeTextSourceCandidate(
  source: KnowledgeSourceCandidate,
): boolean {
  if (source.isDir) {
    return false;
  }

  const name = getKnowledgeSourceDisplayName(source);
  const extension = getKnowledgeSourceExtension(name);
  if (KNOWLEDGE_TEXT_SOURCE_EXTENSIONS.has(extension)) {
    return true;
  }

  const mimeType = source.mimeType?.trim().toLowerCase() ?? "";
  return mimeType.startsWith("text/") || mimeType === "application/markdown";
}

export function getKnowledgeUnsupportedSourceMessage(
  source: KnowledgeSourceCandidate,
): string | null {
  if (isKnowledgeTextSourceCandidate(source)) {
    return null;
  }
  if (source.isDir) {
    return "文件夹可以先添加到对话，暂不能直接整理为项目资料。";
  }
  return "当前支持 Markdown 或文本文件。PDF、Word 可先复制正文，或转成 Markdown 后添加。";
}
