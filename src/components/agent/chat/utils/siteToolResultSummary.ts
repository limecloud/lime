import type { SiteAdapterRunResult } from "@/lib/webview-api";
import type { SiteSavedContentTarget } from "../types";
import { normalizeManagedWorkspacePathForDisplay } from "../workspace/workspacePath";

export interface SiteToolResultSummary {
  savedContent?: {
    contentId?: string;
    projectId?: string;
    title?: string;
    projectRootPath?: string;
    bundleRelativeDir?: string;
    markdownRelativePath?: string;
    imagesRelativeDir?: string;
    metaRelativePath?: string;
    imageCount?: number;
  };
  savedProjectId?: string;
  savedBy?: string;
  saveSkippedProjectId?: string;
  saveSkippedBy?: string;
  saveErrorMessage?: string;
  adapterSourceKind?: string;
  adapterSourceVersion?: string;
}

function normalizeToolResultMetadata(
  rawMetadata: unknown,
): Record<string, unknown> | undefined {
  if (
    !rawMetadata ||
    typeof rawMetadata !== "object" ||
    Array.isArray(rawMetadata)
  ) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(rawMetadata));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readFirstNonEmptyString(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function readFirstFiniteNumber(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): number | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
  }
  return undefined;
}

function readFirstBoolean(
  candidates: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
): boolean | undefined {
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "boolean") {
        return value;
      }
    }
  }
  return undefined;
}

export function isPreloadSiteToolResultMetadata(rawMetadata: unknown): boolean {
  const metadata = normalizeToolResultMetadata(rawMetadata);
  if (!metadata) {
    return false;
  }

  const metadataResult = asRecord(metadata.result);
  const candidates = [metadata, metadataResult];
  return (
    readFirstNonEmptyString(candidates, [
      "execution_origin",
      "executionOrigin",
    ]) === "preload" ||
    readFirstBoolean(candidates, ["preload"]) === true
  );
}

export function resolveSiteSavedContentTarget(
  summary: SiteToolResultSummary | null,
): SiteSavedContentTarget | null {
  if (!summary?.savedContent?.contentId) {
    return null;
  }

  const projectId =
    summary.savedContent.projectId?.trim() || summary.savedProjectId?.trim();
  if (!projectId) {
    return null;
  }

  return {
    projectId,
    contentId: summary.savedContent.contentId,
    title: summary.savedContent.title,
    ...(summary.savedContent.markdownRelativePath
      ? {
          preferredTarget: "project_file" as const,
          projectFile: {
            relativePath: summary.savedContent.markdownRelativePath,
          },
        }
      : {}),
  };
}

export function resolveSiteSavedContentTargetFromMetadata(
  rawMetadata: unknown,
): SiteSavedContentTarget | null {
  if (isPreloadSiteToolResultMetadata(rawMetadata)) {
    return null;
  }
  return resolveSiteSavedContentTarget(normalizeSiteToolResultSummary(rawMetadata));
}

export function hasMeaningfulSiteToolResultSignal(
  rawMetadata: unknown,
): boolean {
  const summary = normalizeSiteToolResultSummary(rawMetadata);
  return Boolean(
    summary?.savedContent ||
      summary?.savedProjectId ||
      summary?.saveSkippedProjectId ||
      summary?.saveErrorMessage,
  );
}

export function resolveSiteSavedContentTargetRelativePath(
  target: SiteSavedContentTarget | null | undefined,
): string | null {
  const relativePath = target?.projectFile?.relativePath?.trim();
  return relativePath || null;
}

export function resolveSiteSavedContentTargetDisplayName(
  target: SiteSavedContentTarget | null | undefined,
): string | null {
  const relativePath = resolveSiteSavedContentTargetRelativePath(target);
  if (relativePath) {
    const normalized = relativePath.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    return segments.at(-1) || normalized;
  }

  const title = target?.title?.trim();
  return title || null;
}

export function resolveSiteSavedContentTargetFromRunResult(
  result: Pick<SiteAdapterRunResult, "saved_content" | "saved_project_id"> | null,
): SiteSavedContentTarget | null {
  const savedContent = result?.saved_content;
  if (!savedContent) {
    return null;
  }

  const contentId = savedContent?.content_id?.trim();
  if (!contentId) {
    return null;
  }

  const projectId =
    savedContent.project_id?.trim() || result?.saved_project_id?.trim();
  if (!projectId) {
    return null;
  }

  const markdownRelativePath = savedContent.markdown_relative_path?.trim();
  return {
    projectId,
    contentId,
    ...(savedContent.title?.trim() ? { title: savedContent.title.trim() } : {}),
    ...(markdownRelativePath
      ? {
          preferredTarget: "project_file" as const,
          projectFile: {
            relativePath: markdownRelativePath,
          },
        }
      : {}),
  };
}

export function normalizeSiteToolResultSummary(
  rawMetadata: unknown,
): SiteToolResultSummary | null {
  const metadata = normalizeToolResultMetadata(rawMetadata);
  if (!metadata) {
    return null;
  }

  const metadataResult = asRecord(metadata.result);
  const savedContentRecord =
    asRecord(metadata.saved_content) || asRecord(metadataResult?.saved_content);
  const candidates = [metadata, metadataResult, savedContentRecord];
  const toolFamily = readFirstNonEmptyString(candidates, [
    "tool_family",
    "toolFamily",
  ]);
  const savedProjectId = readFirstNonEmptyString(candidates, [
    "saved_project_id",
    "savedProjectId",
  ]);
  const saveSkippedProjectId = readFirstNonEmptyString(candidates, [
    "save_skipped_project_id",
    "saveSkippedProjectId",
  ]);
  const saveErrorMessage = readFirstNonEmptyString(candidates, [
    "save_error_message",
    "saveErrorMessage",
  ]);
  const adapterSourceKind = readFirstNonEmptyString(candidates, [
    "adapter_source_kind",
    "adapterSourceKind",
  ]);
  const adapterSourceVersion = readFirstNonEmptyString(candidates, [
    "adapter_source_version",
    "adapterSourceVersion",
  ]);

  const hasSavedContent =
    !!savedContentRecord &&
    [
      savedContentRecord.content_id,
      savedContentRecord.contentId,
      savedContentRecord.project_id,
      savedContentRecord.projectId,
      savedContentRecord.title,
    ].some((value) => typeof value === "string" && value.trim());

  const isSiteTool =
    toolFamily === "site" ||
    hasSavedContent ||
    !!savedProjectId ||
    !!saveSkippedProjectId ||
    !!saveErrorMessage ||
    !!adapterSourceKind;

  if (!isSiteTool) {
    return null;
  }

  return {
    savedContent: hasSavedContent
      ? {
          contentId: readFirstNonEmptyString(
            [savedContentRecord],
            ["content_id", "contentId"],
          ),
          projectId: readFirstNonEmptyString(
            [savedContentRecord],
            ["project_id", "projectId"],
          ),
          title: readFirstNonEmptyString([savedContentRecord], ["title"]),
          projectRootPath:
            normalizeManagedWorkspacePathForDisplay(
              readFirstNonEmptyString([savedContentRecord], [
                "project_root_path",
                "projectRootPath",
              ]),
            ) || undefined,
          bundleRelativeDir: readFirstNonEmptyString(
            [savedContentRecord],
            ["bundle_relative_dir", "bundleRelativeDir"],
          ),
          markdownRelativePath: readFirstNonEmptyString(
            [savedContentRecord],
            ["markdown_relative_path", "markdownRelativePath"],
          ),
          imagesRelativeDir: readFirstNonEmptyString(
            [savedContentRecord],
            ["images_relative_dir", "imagesRelativeDir"],
          ),
          metaRelativePath: readFirstNonEmptyString(
            [savedContentRecord],
            ["meta_relative_path", "metaRelativePath"],
          ),
          imageCount: readFirstFiniteNumber(
            [savedContentRecord],
            ["image_count", "imageCount"],
          ),
        }
      : undefined,
    savedProjectId,
    savedBy: readFirstNonEmptyString(candidates, ["saved_by", "savedBy"]),
    saveSkippedProjectId,
    saveSkippedBy: readFirstNonEmptyString(candidates, [
      "save_skipped_by",
      "saveSkippedBy",
    ]),
    saveErrorMessage,
    adapterSourceKind,
    adapterSourceVersion,
  };
}

export function resolveSiteProjectSourceLabel(source?: string): string | null {
  if (source === "context_project") {
    return "来自当前项目上下文";
  }
  if (source === "explicit_project") {
    return "来自显式项目参数";
  }
  return null;
}

export function resolveSiteAdapterSourceLabel(
  summary: SiteToolResultSummary,
): string | null {
  if (summary.adapterSourceKind === "server_synced") {
    return summary.adapterSourceVersion
      ? `服务端脚本 · ${summary.adapterSourceVersion}`
      : "服务端脚本";
  }
  if (summary.adapterSourceKind === "bundled") {
    return summary.adapterSourceVersion
      ? `内置脚本 · ${summary.adapterSourceVersion}`
      : "内置脚本";
  }
  return null;
}
