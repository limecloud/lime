import { ExternalLink, FileQuestion, FileText } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { resolveArtifactProtocolFilePath } from "@/lib/artifact-protocol";
import { cn } from "@/lib/utils";
import type { Artifact } from "@/lib/artifact/types";

export type PreviewArtifactFallbackMode = "system_open" | "unsupported";

interface PreviewArtifactFallbackSurfaceProps {
  artifact: Artifact;
  mode: PreviewArtifactFallbackMode;
  tone?: "dark" | "light";
}

function readStringMeta(meta: Artifact["meta"], key: string): string | null {
  const value = meta[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveTitleKey(mode: PreviewArtifactFallbackMode): string {
  return mode === "system_open"
    ? "workspace.artifactRenderer.previewFallback.systemOpen.title"
    : "workspace.artifactRenderer.previewFallback.unsupported.title";
}

function resolveDetailKey(mode: PreviewArtifactFallbackMode): string {
  return mode === "system_open"
    ? "workspace.artifactRenderer.previewFallback.systemOpen.detail"
    : "workspace.artifactRenderer.previewFallback.unsupported.detail";
}

export const PreviewArtifactFallbackSurface = memo(
  function PreviewArtifactFallbackSurface({
    artifact,
    mode,
    tone = "dark",
  }: PreviewArtifactFallbackSurfaceProps) {
    const { t } = useTranslation("workspace");
    const translateWorkspace = (key: string): string =>
      String(t(key as never));
    const isLight = tone === "light";
    const filePath =
      resolveArtifactProtocolFilePath(artifact) ||
      readStringMeta(artifact.meta, "sourcePath");
    const filename =
      readStringMeta(artifact.meta, "filename") ||
      artifact.title ||
      t("workspace.artifactRenderer.previewFallback.titleFallback");
    const mimeType = readStringMeta(artifact.meta, "mimeType");
    const previewError =
      readStringMeta(artifact.meta, "previewError") || artifact.error?.trim();
    const Icon = mode === "system_open" ? ExternalLink : FileQuestion;

    return (
      <div
        data-testid="preview-artifact-fallback-surface"
        data-preview-render-mode={mode}
        className={cn(
          "flex h-full min-h-[320px] items-center justify-center px-6 py-8 text-center",
          isLight ? "bg-[#f5f6f8]" : "bg-[#1e2227]",
        )}
      >
        <div
          className={cn(
            "w-full max-w-lg rounded-[10px] border p-6 shadow-sm",
            isLight
              ? "border-slate-200 bg-white text-slate-500 shadow-slate-950/5"
              : "border-white/10 bg-white/5 text-gray-400 shadow-black/10",
          )}
        >
          <div
            className={cn(
              "mx-auto flex h-14 w-14 items-center justify-center rounded-[10px] border",
              mode === "system_open"
                ? isLight
                  ? "border-sky-200 bg-sky-50 text-sky-700"
                  : "border-sky-400/20 bg-sky-400/10 text-sky-200"
                : isLight
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-amber-400/20 bg-amber-400/10 text-amber-200",
            )}
          >
            <Icon className="h-6 w-6" />
          </div>
          <h2
            className={cn(
              "mt-5 text-base font-semibold",
              isLight ? "text-slate-950" : "text-white",
            )}
          >
            {translateWorkspace(resolveTitleKey(mode))}
          </h2>
          <p
            className={cn(
              "mx-auto mt-2 max-w-md text-sm leading-6",
              isLight ? "text-slate-500" : "text-gray-400",
            )}
          >
            {translateWorkspace(resolveDetailKey(mode))}
          </p>
          <div
            className={cn(
              "mt-5 rounded-[10px] border border-dashed px-4 py-3 text-left text-xs leading-6",
              isLight
                ? "border-slate-200 bg-slate-50 text-slate-500"
                : "border-white/10 bg-black/20 text-gray-400",
            )}
          >
            <div
              className={cn(
                "flex min-w-0 items-center gap-2 font-medium",
                isLight ? "text-slate-700" : "text-gray-200",
              )}
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{filename}</span>
            </div>
            {filePath ? <div className="mt-1 truncate">{filePath}</div> : null}
            {mimeType ? (
              <div>
                {t("workspace.artifactRenderer.previewFallback.mimeType", {
                  mimeType,
                })}
              </div>
            ) : null}
            {previewError ? (
              <div
                className={cn(
                  "mt-2 border-t pt-2",
                  isLight ? "border-slate-200" : "border-white/10",
                )}
              >
                {previewError}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  },
);

PreviewArtifactFallbackSurface.displayName = "PreviewArtifactFallbackSurface";
