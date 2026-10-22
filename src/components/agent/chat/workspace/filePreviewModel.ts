import type { ArtifactType } from "@/lib/artifact/types";
import {
  resolvePreviewPath,
  type FilePreviewContext,
} from "./filePreviewTarget";

export type FilePreviewMode = "markdown" | "html" | "code";

export interface FilePreviewModeOption {
  mode: FilePreviewMode;
  enabled: boolean;
}

export interface FilePreviewModeState {
  defaultMode: FilePreviewMode;
  language: string;
  modes: Record<FilePreviewMode, FilePreviewModeOption>;
  path: string;
  hasContent: boolean;
  isHtmlLike: boolean;
  isMarkdownLike: boolean;
}

export interface HtmlPreviewFrameState {
  sandbox: string;
  src: string | null;
  srcDoc: string | undefined;
}

export type LocalPreviewUrlResolver = (path?: string | null) => string | null;

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  cjs: "javascript",
  css: "css",
  go: "go",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  md: "markdown",
  mdx: "mdx",
  mjs: "javascript",
  py: "python",
  rs: "rust",
  sh: "bash",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  txt: "text",
  yaml: "yaml",
  yml: "yaml",
};

const HTML_FILE_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-modals allow-same-origin";
const HTML_SRCDOC_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-modals";

function normalizeValue(value?: string | null): string {
  return value?.trim() || "";
}

function resolveArtifactType(
  context: FilePreviewContext | null | undefined,
): ArtifactType | null {
  const target = context?.target;
  if (
    !target ||
    (target.kind !== "artifact" && target.kind !== "synthetic-artifact")
  ) {
    return null;
  }
  return target.artifact.type;
}

function resolveArtifactLanguage(
  context: FilePreviewContext | null | undefined,
): string {
  const target = context?.target;
  if (
    !target ||
    (target.kind !== "artifact" && target.kind !== "synthetic-artifact")
  ) {
    return "";
  }
  const language = target.artifact.meta.language;
  return typeof language === "string" ? language.trim().toLowerCase() : "";
}

function resolvePreviewModePath(
  context: FilePreviewContext | null | undefined,
): string {
  if (!context) {
    return "";
  }
  return (
    normalizeValue(context.selectionPath) ||
    normalizeValue(context.subtitle) ||
    normalizeValue(resolvePreviewPath(context.target)) ||
    normalizeValue(context.title)
  );
}

function extractExtension(path: string): string {
  const leaf = path.split(/[\\/]/).filter(Boolean).at(-1) || path;
  const match = /\.([a-zA-Z0-9]+)$/.exec(leaf);
  return match?.[1]?.toLowerCase() || "";
}

export function inferFilePreviewLanguage(
  context: FilePreviewContext | null | undefined,
): string {
  const artifactLanguage = resolveArtifactLanguage(context);
  if (artifactLanguage) {
    return artifactLanguage;
  }

  const extension = extractExtension(resolvePreviewModePath(context));
  return EXTENSION_LANGUAGE_MAP[extension] || "text";
}

function looksLikeHtml(content: string): boolean {
  const value = content.trim().slice(0, 500).toLowerCase();
  return (
    value.startsWith("<!doctype html") ||
    value.startsWith("<html") ||
    /<body[\s>]/.test(value)
  );
}

function resolveIsHtmlLike(
  context: FilePreviewContext | null | undefined,
  path: string,
  language: string,
): boolean {
  const extension = extractExtension(path);
  const artifactType = resolveArtifactType(context);
  return (
    artifactType === "html" ||
    extension === "html" ||
    extension === "htm" ||
    language === "html" ||
    looksLikeHtml(context?.content || "")
  );
}

function resolveIsMarkdownLike(
  context: FilePreviewContext | null | undefined,
  path: string,
  language: string,
  isHtmlLike: boolean,
): boolean {
  if (isHtmlLike) {
    return false;
  }

  const extension = extractExtension(path);
  const artifactType = resolveArtifactType(context);
  return (
    artifactType === "document" ||
    extension === "md" ||
    extension === "mdx" ||
    extension === "markdown" ||
    language === "markdown" ||
    language === "mdx"
  );
}

export function resolvePreferredFilePreviewMode(
  path: string | null | undefined,
): FilePreviewMode {
  const extension = extractExtension(path || "");
  if (extension === "html" || extension === "htm") {
    return "html";
  }
  if (extension === "md" || extension === "mdx" || extension === "markdown") {
    return "markdown";
  }
  return "code";
}

export function resolveFilePreviewModeState(
  context: FilePreviewContext | null | undefined,
): FilePreviewModeState {
  const path = resolvePreviewModePath(context);
  const hasContent = Boolean(
    context &&
    (context.target.kind === "text" ||
      context.target.kind === "artifact" ||
      context.target.kind === "synthetic-artifact"),
  );
  const language = inferFilePreviewLanguage(context);
  const isHtmlLike = resolveIsHtmlLike(context, path, language);
  const isMarkdownLike = resolveIsMarkdownLike(
    context,
    path,
    language,
    isHtmlLike,
  );
  const defaultMode: FilePreviewMode = isHtmlLike
    ? "html"
    : isMarkdownLike
      ? "markdown"
      : "code";

  return {
    defaultMode,
    language,
    path,
    hasContent,
    isHtmlLike,
    isMarkdownLike,
    modes: {
      markdown: {
        mode: "markdown",
        enabled: hasContent && isMarkdownLike,
      },
      html: {
        mode: "html",
        enabled: hasContent && isHtmlLike,
      },
      code: {
        mode: "code",
        enabled: hasContent,
      },
    },
  };
}

export function resolveHtmlPreviewFrameState(
  context: FilePreviewContext | null | undefined,
  resolveLocalPreviewUrl: LocalPreviewUrlResolver,
): HtmlPreviewFrameState {
  const inlineContent = context?.content ?? "";
  if (inlineContent.trim()) {
    return {
      sandbox: HTML_SRCDOC_SANDBOX,
      src: null,
      srcDoc: inlineContent,
    };
  }

  const src = resolveLocalPreviewUrl(context?.selectionPath) || null;
  return {
    sandbox: src ? HTML_FILE_SANDBOX : HTML_SRCDOC_SANDBOX,
    src,
    srcDoc: src ? undefined : inlineContent,
  };
}

export function isFilePreviewMode(value: string): value is FilePreviewMode {
  return value === "markdown" || value === "html" || value === "code";
}
