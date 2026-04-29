import type { CanvasState as GeneralCanvasState } from "@/components/general-chat/bridge";

type GeneralCanvasContentType = GeneralCanvasState["contentType"];

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  md: "markdown",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

function extractExtension(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").trim();
  const lastSegment = normalized.split("/").pop() || normalized;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) {
    return "";
  }
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

function looksLikeMarkdown(content: string): boolean {
  return (
    /^#{1,6}\s+/m.test(content) ||
    /^>\s+/m.test(content) ||
    /^[-*]\s+/m.test(content) ||
    /\[[^\]]+\]\([^)]+\)/.test(content) ||
    /!\[[^\]]*\]\([^)]+\)/.test(content) ||
    /```/.test(content)
  );
}

export function resolveGeneralCanvasFileContentType(
  filePath: string,
  content: string,
): {
  contentType: GeneralCanvasContentType;
  language?: string;
} {
  const extension = extractExtension(filePath);
  const language = extension
    ? CODE_LANGUAGE_BY_EXTENSION[extension]
    : undefined;

  if (MARKDOWN_EXTENSIONS.has(extension) || looksLikeMarkdown(content)) {
    return { contentType: "markdown" };
  }

  if (language && language !== "markdown") {
    return { contentType: "code", language };
  }

  return { contentType: "markdown" };
}

export function buildGeneralCanvasStateFromWorkspaceFile(
  filePath: string,
  content: string,
): GeneralCanvasState {
  const { contentType, language } = resolveGeneralCanvasFileContentType(
    filePath,
    content,
  );

  return {
    isOpen: true,
    contentType,
    content,
    language,
    filename: filePath,
    isEditing: false,
  };
}
