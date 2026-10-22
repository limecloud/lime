import { createPreviewArtifactFromFile } from "@/lib/artifact/previewArtifact";
import type { Artifact } from "@/lib/artifact/types";
export interface WorkspaceFileSelection {
  path: string;
  title: string;
  status: "loading" | "ready" | "error" | "binary";
  content?: string;
  error?: string | null;
  size?: number;
}

export type FilePreviewTarget =
  | {
      kind: "text";
      title: string;
      content: string;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "artifact" | "synthetic-artifact";
      title: string;
      artifact: Artifact;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "loading";
      title: string;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "unsupported";
      title: string;
      reason: string;
      filePath?: string;
      absolutePath?: string;
    }
  | {
      kind: "empty";
      title: string;
    };

export function resolvePreviewContent(target: FilePreviewTarget): string {
  if (target.kind === "text") {
    return target.content;
  }

  if (target.kind === "artifact" || target.kind === "synthetic-artifact") {
    return target.artifact.content;
  }

  return "";
}

export function resolvePreviewPath(
  target: FilePreviewTarget,
): string | undefined {
  if (
    target.kind === "text" ||
    target.kind === "artifact" ||
    target.kind === "synthetic-artifact" ||
    target.kind === "loading" ||
    target.kind === "unsupported"
  ) {
    return target.absolutePath || target.filePath;
  }

  return undefined;
}

export interface FilePreviewContext {
  title: string;
  content: string;
  target: FilePreviewTarget;
  selectionPath?: string;
  subtitle?: string;
}

export function resolveFilePreviewTarget(
  file: WorkspaceFileSelection,
  copy: {
    workspaceFile: {
      binaryUnsupported: string;
      readFailed: string;
    };
  },
): FilePreviewTarget {
  const location = {
    title: file.title,
    filePath: file.path,
    absolutePath: file.path,
  };
  if (file.status === "loading") return { kind: "loading", ...location };
  if (file.status === "error" || file.error) {
    return {
      kind: "unsupported",
      reason: file.error || copy.workspaceFile.readFailed,
      ...location,
    };
  }
  const preview = createPreviewArtifactFromFile({
    filePath: file.path,
    title: file.title,
    content: file.content,
    isBinary: file.status === "binary",
    size: file.size,
    // 文件投影身份稳定；重新读取经过 loading 卸载原面板。
    now: 0,
  });
  if (
    preview.renderMode === "document_pages" ||
    preview.renderMode === "workbook" ||
    preview.renderMode === "presentation" ||
    preview.renderMode === "media"
  ) {
    return {
      kind: "synthetic-artifact",
      artifact: preview.artifact,
      ...location,
    };
  }
  if (file.status === "binary") {
    return {
      kind: "unsupported",
      reason: copy.workspaceFile.binaryUnsupported,
      ...location,
    };
  }
  return { kind: "text", content: file.content || "", ...location };
}
