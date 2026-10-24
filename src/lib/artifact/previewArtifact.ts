import type { Artifact, ArtifactMeta, ArtifactType } from "./types";
import { convertLocalFileSrc } from "@/lib/api/fileSystem";

export type PreviewArtifactSource =
  | "file"
  | "artifact"
  | "task"
  | "url"
  | "session_file"
  | "app"
  | "database_record";

export type PreviewArtifactContentKind =
  | "text"
  | "markdown"
  | "code"
  | "html"
  | "image"
  | "document"
  | "workbook"
  | "presentation"
  | "audio"
  | "video"
  | "binary"
  | "app_shell"
  | "unsupported";

export type PreviewArtifactRenderMode =
  | "inline"
  | "canvas"
  | "media"
  | "document_pages"
  | "workbook"
  | "presentation"
  | "external_window"
  | "system_open"
  | "unsupported";

export interface PreviewArtifactCapabilities {
  preview: boolean;
  edit: boolean;
  save: boolean;
  reveal: boolean;
  systemOpen: boolean;
  externalWindow: boolean;
}

export interface PreviewArtifactInput {
  source: PreviewArtifactSource;
  sourceRef: string;
  title?: string | null;
  path?: string | null;
  content?: string | null;
  isBinary?: boolean | null;
  mimeType?: string | null;
  size?: number | null;
  error?: string | null;
  previewUrl?: string | null;
  meta?: ArtifactMeta;
  now?: number;
}

export interface PreviewArtifactProjection {
  artifact: Artifact;
  contentKind: PreviewArtifactContentKind;
  renderMode: PreviewArtifactRenderMode;
  artifactType: ArtifactType;
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "svg",
]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi"]);
const DOCUMENT_EXTENSIONS = new Set([
  "docx",
  "doc",
  "pdf",
  "rtf",
  "odt",
  "xls",
  "ppt",
  "pptx",
]);
const WORKBOOK_EXTENSIONS = new Set(["xlsx", "csv", "tsv"]);
const WORKBOOK_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/tab-separated-values",
]);
const PAGED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  h: "c",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kt: "kotlin",
  mjs: "javascript",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

const DEFAULT_CAPABILITIES: PreviewArtifactCapabilities = {
  preview: true,
  edit: false,
  save: false,
  reveal: true,
  systemOpen: true,
  externalWindow: false,
};

function extractExtension(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  const lastSegment = normalized.split("/").pop() || normalized;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) {
    return "";
  }
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

function extractFilename(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim();
  return normalized.split("/").pop()?.trim() || normalized || "preview";
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

function hashPreviewArtifactId(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function resolveContentKind(input: {
  source: PreviewArtifactSource;
  path: string;
  content: string;
  isBinary: boolean;
  mimeType?: string | null;
  error?: string | null;
}): PreviewArtifactContentKind {
  if (input.error) {
    return "unsupported";
  }
  if (input.source === "app") {
    return "app_shell";
  }
  const mimeType = input.mimeType?.toLowerCase() || "";
  const extension = extractExtension(input.path);
  if (
    extension === "pptx" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  )
    return "presentation";
  if (WORKBOOK_EXTENSIONS.has(extension) || WORKBOOK_MIME_TYPES.has(mimeType)) {
    return "workbook";
  }
  if (input.isBinary) {
    if (mimeType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
      return "image";
    }
    if (mimeType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) {
      return "audio";
    }
    if (mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) {
      return "video";
    }
    if (
      DOCUMENT_EXTENSIONS.has(extension) ||
      PAGED_DOCUMENT_MIME_TYPES.has(mimeType)
    ) {
      return "document";
    }
    return "binary";
  }
  if (HTML_EXTENSIONS.has(extension) || mimeType.includes("html")) {
    return "html";
  }
  if (
    DOCUMENT_EXTENSIONS.has(extension) ||
    PAGED_DOCUMENT_MIME_TYPES.has(mimeType)
  ) {
    return "document";
  }
  if (MARKDOWN_EXTENSIONS.has(extension) || looksLikeMarkdown(input.content)) {
    return "markdown";
  }
  if (CODE_LANGUAGE_BY_EXTENSION[extension]) {
    return CODE_LANGUAGE_BY_EXTENSION[extension] === "text" ? "text" : "code";
  }
  return "text";
}

function resolveArtifactType(
  contentKind: PreviewArtifactContentKind,
): ArtifactType {
  if (contentKind === "html") {
    return "html";
  }
  if (contentKind === "code") {
    return "code";
  }
  return "document";
}

function resolveRenderMode(
  contentKind: PreviewArtifactContentKind,
  input: {
    source: PreviewArtifactSource;
    path: string;
    mimeType?: string | null;
  },
): PreviewArtifactRenderMode {
  if (input.source === "url" || input.source === "database_record") {
    return "inline";
  }

  switch (contentKind) {
    case "html":
      return "external_window";
    case "image":
    case "audio":
    case "video":
      return "media";
    case "document":
      if (
        ["pdf", "docx"].includes(extractExtension(input.path)) ||
        PAGED_DOCUMENT_MIME_TYPES.has(input.mimeType?.toLowerCase() ?? "")
      ) {
        return "document_pages";
      }
      return "system_open";
    case "workbook":
      return "workbook";
    case "presentation":
      return "presentation";
    case "binary":
      return "system_open";
    case "unsupported":
      return "unsupported";
    case "app_shell":
      return "inline";
    default:
      return "canvas";
  }
}

function resolvePreviewContent(input: {
  content: string;
  contentKind: PreviewArtifactContentKind;
  renderMode: PreviewArtifactRenderMode;
  previewUrl?: string | null;
  path: string;
  error?: string | null;
}): string {
  if (input.content.trim()) {
    return input.content;
  }
  if (input.error) {
    return `无法预览该文件。\n\n${input.error}`;
  }
  if (input.contentKind === "binary") {
    return `该文件暂不支持在工作台内嵌预览。\n\n${input.path}`;
  }
  if (input.contentKind === "document" && input.renderMode === "system_open") {
    return `该文档暂不支持在工作台内嵌预览。\n\n${input.path}`;
  }
  if (
    input.contentKind === "image" ||
    input.contentKind === "audio" ||
    input.contentKind === "video"
  ) {
    return input.previewUrl || "";
  }
  return "";
}

function resolvePreviewUrl(
  contentKind: PreviewArtifactContentKind,
  path: string,
  renderMode: PreviewArtifactRenderMode,
): string | undefined {
  if (
    contentKind !== "image" &&
    contentKind !== "audio" &&
    contentKind !== "video" &&
    renderMode !== "document_pages"
  ) {
    return undefined;
  }
  return convertLocalFileSrc(path);
}

export function createPreviewArtifact(
  input: PreviewArtifactInput,
): PreviewArtifactProjection {
  const sourceRef = input.sourceRef.trim();
  const path = input.path?.trim() || sourceRef;
  const content = input.content ?? "";
  const contentKind = resolveContentKind({
    source: input.source,
    path,
    content,
    isBinary: Boolean(input.isBinary),
    mimeType: input.mimeType,
    error: input.error,
  });
  const renderMode = resolveRenderMode(contentKind, {
    source: input.source,
    path,
    mimeType: input.mimeType,
  });
  const artifactType = resolveArtifactType(contentKind);
  const filename = extractFilename(path);
  const now = input.now ?? Date.now();
  const language =
    artifactType === "code"
      ? CODE_LANGUAGE_BY_EXTENSION[extractExtension(path)]
      : undefined;
  const capabilities: PreviewArtifactCapabilities = {
    ...DEFAULT_CAPABILITIES,
    preview: renderMode !== "system_open" && renderMode !== "unsupported",
    externalWindow: contentKind === "html",
    edit:
      input.source !== "url" &&
      input.source !== "database_record" &&
      input.source !== "app" &&
      (contentKind === "markdown" ||
        contentKind === "text" ||
        contentKind === "code" ||
        contentKind === "html"),
  };
  if (input.source === "database_record" || input.source === "app") {
    capabilities.systemOpen = false;
    capabilities.reveal = false;
  }
  const previewUrl =
    input.previewUrl?.trim() ||
    resolvePreviewUrl(contentKind, path, renderMode);
  const previewContent = resolvePreviewContent({
    content,
    contentKind,
    renderMode,
    previewUrl,
    path,
    error: input.error,
  });

  const meta: ArtifactMeta = {
    ...input.meta,
    previewArtifact: true,
    isSourceBacked: true,
    source: input.source,
    sourceRef,
    sourcePath: path,
    filePath: path,
    filename,
    contentKind,
    renderMode,
    lifecycle: "transient",
    capabilities,
    mimeType: input.mimeType || undefined,
    fileKind: extractExtension(path) || undefined,
    size: typeof input.size === "number" ? input.size : undefined,
    previewError: input.error || undefined,
    previewUrl,
    language,
  };

  return {
    artifact: {
      id: `preview-${input.source}-${hashPreviewArtifactId(`${input.source}:${sourceRef}`)}`,
      type: artifactType,
      title: input.title?.trim() || filename,
      content: previewContent,
      status: input.error ? "error" : "complete",
      meta,
      position: { start: 0, end: previewContent.length },
      createdAt: now,
      updatedAt: now,
      error: input.error || undefined,
    },
    contentKind,
    renderMode,
    artifactType,
  };
}

export function createPreviewArtifactFromFile(
  input: Omit<PreviewArtifactInput, "source" | "sourceRef"> & {
    filePath: string;
  },
): PreviewArtifactProjection {
  return createPreviewArtifact({
    ...input,
    source: "file",
    sourceRef: input.filePath,
    path: input.path || input.filePath,
  });
}

export function isPreviewArtifact(artifact: Pick<Artifact, "meta">): boolean {
  return artifact.meta.previewArtifact === true;
}
