import { scorePreferredResultFilePath } from "../workspace/resultFilePriority";

export interface RenderableTaskFileCandidate {
  id: string;
  name: string;
  content?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResolveCanvasTaskFileTargetResult<
  T extends RenderableTaskFileCandidate,
> {
  targetFile: T | null;
  nextSelectedFileId: string | null;
}

export function resolveCanvasTaskFileTarget<
  T extends RenderableTaskFileCandidate,
>(files: T[], selectedFileId?: string): ResolveCanvasTaskFileTargetResult<T> {
  if (files.length === 0) {
    return {
      targetFile: null,
      nextSelectedFileId: null,
    };
  }

  const selectedFile = selectedFileId
    ? files.find((file) => file.id === selectedFileId) || null
    : null;
  if (selectedFile?.content) {
    return {
      targetFile: selectedFile,
      nextSelectedFileId: null,
    };
  }

  const latestFile = files.reduce<T | null>((candidate, file) => {
    if (!candidate) {
      return file;
    }

    const candidatePriority = scorePreferredResultFilePath(candidate.name);
    const filePriority = scorePreferredResultFilePath(file.name);
    if (filePriority !== candidatePriority) {
      return filePriority > candidatePriority ? file : candidate;
    }

    const candidateTimestamp = Math.max(
      candidate.updatedAt,
      candidate.createdAt,
    );
    const fileTimestamp = Math.max(file.updatedAt, file.createdAt);
    return fileTimestamp >= candidateTimestamp ? file : candidate;
  }, null);

  if (!latestFile?.content) {
    return {
      targetFile: null,
      nextSelectedFileId: null,
    };
  }

  return {
    targetFile: latestFile,
    nextSelectedFileId: selectedFileId === latestFile.id ? null : latestFile.id,
  };
}

export function shouldDeferCanvasSyncWhileEditing(options: {
  canvasType: string | null;
  editorFocused: boolean;
}): boolean {
  return options.editorFocused && options.canvasType === "document";
}
