import type { ReactNode } from "react";
import type { DocumentVersion } from "@/components/content-creator/canvas/document/types";
import type { Artifact } from "@/lib/artifact/types";
import type { CanvasWorkbenchPreviewTarget } from "../components/CanvasWorkbenchLayout";
import type {
  ArtifactWorkbenchDocumentController,
  ArtifactWorkbenchLayoutMode,
} from "./artifactWorkbenchDocument";

export interface RenderArtifactWorkbenchPreviewOptions {
  stackedWorkbenchTrigger?: ReactNode;
  artifactDocumentLayoutMode?: ArtifactWorkbenchLayoutMode;
  onArtifactDocumentControllerChange?: (
    controller: ArtifactWorkbenchDocumentController | null,
  ) => void;
}

export function resolvePreviousDocumentVersionContent(
  version: DocumentVersion | null | undefined,
  versions: DocumentVersion[],
): string | null {
  if (!version) {
    return null;
  }

  const parentVersionId = version.metadata?.parentVersionId?.trim();
  if (parentVersionId) {
    const parentVersion = versions.find((item) => item.id === parentVersionId);
    if (parentVersion) {
      return parentVersion.content;
    }
  }

  const currentIndex = versions.findIndex((item) => item.id === version.id);
  if (currentIndex > 0) {
    return versions[currentIndex - 1]?.content || null;
  }

  return null;
}

export function wrapPreviewWithWorkbenchTrigger(
  preview: ReactNode,
  stackedWorkbenchTrigger?: ReactNode,
) {
  if (!stackedWorkbenchTrigger) {
    return preview;
  }

  return (
    <div className="relative h-full">
      {preview}
      <div className="pointer-events-none absolute bottom-4 right-4 z-20">
        <div className="pointer-events-auto">{stackedWorkbenchTrigger}</div>
      </div>
    </div>
  );
}

function renderWorkbenchStatePreview(
  kind: "loading" | "unsupported" | "empty",
  options: {
    text: string;
    stackedWorkbenchTrigger?: ReactNode;
  },
) {
  return wrapPreviewWithWorkbenchTrigger(
    <div
      data-testid={`canvas-workbench-preview-${kind}`}
      className="flex h-full items-center justify-center rounded-[24px] border border-dashed border-slate-200 bg-slate-50 px-6 text-sm text-slate-500"
    >
      {options.text}
    </div>,
    options.stackedWorkbenchTrigger,
  );
}

export function renderCanvasWorkbenchPreviewTarget(params: {
  target: CanvasWorkbenchPreviewTarget;
  stackedWorkbenchTrigger?: ReactNode;
  renderDefaultCanvasPreview: (stackedWorkbenchTrigger?: ReactNode) => ReactNode;
  renderArtifactPreview: (
    artifact: Artifact,
    options?: RenderArtifactWorkbenchPreviewOptions,
  ) => ReactNode;
  renderTeamWorkbenchPreview: (
    stackedWorkbenchTrigger?: ReactNode,
  ) => ReactNode;
}) {
  const { target, stackedWorkbenchTrigger } = params;

  switch (target.kind) {
    case "default-canvas":
      return params.renderDefaultCanvasPreview(stackedWorkbenchTrigger);
    case "artifact":
    case "synthetic-artifact":
      return params.renderArtifactPreview(target.artifact, {
        stackedWorkbenchTrigger,
      });
    case "loading":
      return renderWorkbenchStatePreview("loading", {
        text: "正在准备预览...",
        stackedWorkbenchTrigger,
      });
    case "unsupported":
      return renderWorkbenchStatePreview("unsupported", {
        text: target.reason,
        stackedWorkbenchTrigger,
      });
    case "empty":
      return renderWorkbenchStatePreview("empty", {
        text: "暂无可预览内容",
        stackedWorkbenchTrigger,
      });
    case "team-workbench":
      return params.renderTeamWorkbenchPreview(stackedWorkbenchTrigger);
    default:
      return null;
  }
}
