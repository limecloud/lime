/**
 * @file Document Artifact 渲染器
 * @description 渲染 Markdown / 文本文档，支持预览与源码切换
 * @module components/artifact/renderers/DocumentRenderer
 */

import React, { memo, useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { ArtifactRendererProps } from "@/lib/artifact/types";
import { MarkdownRenderer } from "@/components/agent/chat/components/MarkdownRenderer";
import { resolveArtifactProtocolDocumentPayload } from "@/lib/artifact-protocol";
import { CodeRenderer } from "./CodeRenderer";
import { ArtifactDocumentRenderer } from "./ArtifactDocumentRenderer";

type ViewMode = "preview" | "source";

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
  tone?: "dark" | "light";
}

const ViewModeToggle: React.FC<ViewModeToggleProps> = memo(
  ({ value, onChange, tone = "dark" }) => (
    <div
      className={`inline-flex items-center rounded p-0.5 ${
        tone === "light" ? "bg-black/5" : "bg-white/5"
      }`}
    >
      <button
        type="button"
        onClick={() => onChange("preview")}
        className={`px-2 py-1 text-xs rounded transition-all ${
          value === "preview"
            ? tone === "light"
              ? "bg-white text-foreground shadow-sm"
              : "bg-white/10 text-white"
            : tone === "light"
              ? "text-muted-foreground hover:text-foreground"
              : "text-gray-400 hover:text-white"
        }`}
      >
        预览
      </button>
      <button
        type="button"
        onClick={() => onChange("source")}
        className={`px-2 py-1 text-xs rounded transition-all ${
          value === "source"
            ? tone === "light"
              ? "bg-white text-foreground shadow-sm"
              : "bg-white/10 text-white"
            : tone === "light"
              ? "text-muted-foreground hover:text-foreground"
              : "text-gray-400 hover:text-white"
        }`}
      >
        源码
      </button>
    </div>
  ),
);

ViewModeToggle.displayName = "DocumentViewModeToggle";

export const DocumentRenderer: React.FC<ArtifactRendererProps> = memo(
  ({
    artifact,
    isStreaming = false,
    hideToolbar = false,
    viewMode: externalViewMode,
    tone = "dark",
  }) => {
    const [internalViewMode, setInternalViewMode] =
      useState<ViewMode>("preview");
    const viewMode = externalViewMode ?? internalViewMode;
    const artifactDocument = useMemo(
      () =>
        resolveArtifactProtocolDocumentPayload({
          content: artifact.content,
          metadata: artifact.meta,
        }),
      [artifact.content, artifact.meta],
    );

    const sourceArtifact = useMemo(
      () => ({
        ...artifact,
        type: "code" as const,
        meta: {
          ...artifact.meta,
          language:
            typeof artifact.meta.language === "string" && artifact.meta.language
              ? artifact.meta.language
              : artifactDocument
                ? "json"
                : "markdown",
        },
      }),
      [artifact, artifactDocument],
    );

    return (
      <div
        className={`relative h-full flex flex-col overflow-hidden ${
          tone === "light" ? "bg-background" : "bg-[#1e2227]"
        }`}
      >
        {!hideToolbar && (
          <div
            className={`flex items-center justify-between px-3 py-2 border-b ${
              tone === "light"
                ? "bg-background border-border"
                : "bg-[#21252b] border-white/10"
            }`}
          >
            <div
              className={`flex items-center gap-2 text-sm min-w-0 ${
                tone === "light" ? "text-foreground" : "text-white"
              }`}
            >
              <FileText
                className={`w-4 h-4 shrink-0 ${
                  tone === "light" ? "text-muted-foreground" : "text-gray-400"
                }`}
              />
              <span className="truncate">{artifact.title}</span>
              {isStreaming ? (
                <span className="flex items-center gap-1 text-xs text-blue-400 shrink-0">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>生成中...</span>
                </span>
              ) : null}
            </div>
            <ViewModeToggle
              value={viewMode}
              onChange={setInternalViewMode}
              tone={tone}
            />
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {viewMode === "source" ? (
            tone === "light" ? (
              <div className="h-full overflow-auto bg-background px-4 py-3">
                <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-4 font-mono text-sm leading-6 text-foreground">
                  {artifact.content}
                </pre>
              </div>
            ) : (
              <CodeRenderer
                artifact={sourceArtifact}
                isStreaming={isStreaming}
                hideToolbar={true}
              />
            )
          ) : (
            <>
              {artifactDocument ? (
                <ArtifactDocumentRenderer
                  document={artifactDocument}
                  tone={tone}
                />
              ) : (
                <div
                  className={`h-full overflow-auto px-4 py-3 ${
                    tone === "light" ? "bg-background" : ""
                  }`}
                >
                  <MarkdownRenderer
                    content={artifact.content}
                    isStreaming={isStreaming}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  },
);

DocumentRenderer.displayName = "DocumentRenderer";

export default DocumentRenderer;
