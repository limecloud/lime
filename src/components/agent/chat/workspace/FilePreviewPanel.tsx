import { memo, type ReactNode } from "react";
import { Eye, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveLocalFilePreviewUrl } from "@/lib/api/fileSystem";
import { ArtifactRenderer } from "@/components/artifact";
import { CodePreview } from "@/components/general-chat/bridge";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { type FilePreviewContext } from "./filePreviewTarget";

import type { FilePreviewMode, FilePreviewModeState } from "./filePreviewModel";
import { resolveHtmlPreviewFrameState } from "./filePreviewModel";
import {
  FilePreviewHeader,
  type FilePreviewDownloadAction,
} from "./FilePreviewHeader";

type FilePreviewTranslation = (
  key: string,
  options?: Record<string, unknown>,
) => string;

interface FilePreviewPanelProps {
  context: FilePreviewContext | null;
  mode: FilePreviewMode;
  modeState: FilePreviewModeState;
  translate: FilePreviewTranslation;
  onSelectMode?: (mode: FilePreviewMode) => void;
  toolbarActions?: ReactNode;
  download?: FilePreviewDownloadAction;
  className?: string;
}

function shouldRenderArtifactDirectly(
  artifact: NonNullable<
    Extract<
      FilePreviewContext["target"],
      { kind: "artifact" | "synthetic-artifact" }
    >["artifact"]
  >,
): boolean {
  if (artifact.meta.previewArtifact !== true) {
    return false;
  }

  return (
    artifact.meta.renderMode === "media" ||
    artifact.meta.renderMode === "document_pages" ||
    artifact.meta.renderMode === "workbook" ||
    artifact.meta.renderMode === "presentation" ||
    artifact.meta.renderMode === "system_open" ||
    artifact.meta.renderMode === "unsupported"
  );
}

export const FilePreviewPanel = memo(function FilePreviewPanel({
  context,
  mode,
  modeState,
  translate,
  onSelectMode,
  toolbarActions,
  download,
  className,
}: FilePreviewPanelProps) {
  if (!context) {
    return (
      <div
        data-testid="file-preview-panel"
        data-preview-mode={mode}
        className={cn("h-full min-h-0 bg-background p-5", className)}
      >
        <div className="rounded-[10px] border border-dashed border-border bg-muted/50 px-4 py-5 text-sm text-muted-foreground">
          {translate("agentChat.filePreview.empty")}
        </div>
      </div>
    );
  }

  if (context.target.kind === "loading") {
    return (
      <div
        data-testid="file-preview-panel"
        data-preview-mode={mode}
        className={cn("h-full min-h-0 bg-background p-5", className)}
      >
        <div
          className="rounded-[10px] border border-dashed border-border bg-muted/50 px-4 py-5 text-sm text-muted-foreground"
          data-testid="file-preview-loading"
        >
          {translate("agentChat.filePreview.loading")}
        </div>
      </div>
    );
  }

  if (context.target.kind === "unsupported") {
    return (
      <div
        data-testid="file-preview-panel"
        data-preview-mode={mode}
        className={cn("h-full min-h-0 bg-background p-5", className)}
      >
        <div
          className="rounded-[10px] border border-dashed border-border bg-muted/50 px-4 py-5 text-sm text-muted-foreground"
          data-testid="file-preview-unsupported"
        >
          {context.target.reason}
        </div>
      </div>
    );
  }

  if (!modeState.hasContent) {
    return (
      <div
        data-testid="file-preview-panel"
        data-preview-mode={mode}
        className={cn("h-full min-h-0 bg-background p-5", className)}
      >
        <div className="rounded-[10px] border border-dashed border-border bg-muted/50 px-4 py-5 text-sm text-muted-foreground">
          {translate("agentChat.filePreview.empty")}
        </div>
      </div>
    );
  }

  const artifactPreviewCandidate =
    context.target.kind === "artifact" ||
    context.target.kind === "synthetic-artifact"
      ? context.target.artifact
      : null;
  const artifactPreview =
    artifactPreviewCandidate &&
    shouldRenderArtifactDirectly(artifactPreviewCandidate)
      ? artifactPreviewCandidate
      : null;
  const htmlPreviewFrame =
    mode === "html"
      ? resolveHtmlPreviewFrameState(context, resolveLocalFilePreviewUrl)
      : null;
  const codeLanguage = mode === "html" ? "html" : modeState.language || "text";
  const previewMode = modeState.isMarkdownLike
    ? "markdown"
    : modeState.isHtmlLike
      ? "html"
      : null;
  const nextMode = mode === "code" ? previewMode : "code";
  const switchLabel = translate(
    mode === "code"
      ? "agentChat.filePreview.viewPreview"
      : "agentChat.filePreview.viewSource",
  );

  return (
    <section
      data-testid="file-preview-panel"
      data-preview-mode={mode}
      className={cn("flex h-full min-h-0 flex-col bg-background", className)}
    >
      <FilePreviewHeader title={context.title} download={download}>
        {!artifactPreview && previewMode && nextMode && onSelectMode ? (
          <button
            type="button"
            data-testid="file-preview-mode-toggle"
            aria-label={switchLabel}
            title={switchLabel}
            onClick={() => onSelectMode(nextMode)}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {mode === "code" ? (
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {switchLabel}
          </button>
        ) : null}
        {toolbarActions}
      </FilePreviewHeader>

      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        {artifactPreview ? (
          <ArtifactRenderer
            artifact={artifactPreview}
            hideToolbar={true}
            tone="light"
          />
        ) : mode === "markdown" ? (
          <div
            data-testid="file-preview-markdown"
            className="h-full overflow-auto bg-background px-6 py-5"
          >
            <MarkdownRenderer
              content={context.content}
              baseFilePath={context.selectionPath}
            />
          </div>
        ) : mode === "html" ? (
          <iframe
            data-testid="file-preview-html"
            src={htmlPreviewFrame?.src || undefined}
            srcDoc={htmlPreviewFrame?.srcDoc}
            sandbox={htmlPreviewFrame?.sandbox}
            className="h-full min-h-[420px] w-full border-0 bg-background"
            title={
              context.title || translate("agentChat.filePreview.htmlTitle")
            }
          />
        ) : (
          <div
            data-testid="file-preview-code"
            className="h-full min-h-0 bg-background"
          >
            <CodePreview
              code={context.content}
              language={codeLanguage}
              isEditing={false}
            />
          </div>
        )}
      </div>
    </section>
  );
});

FilePreviewPanel.displayName = "FilePreviewPanel";
