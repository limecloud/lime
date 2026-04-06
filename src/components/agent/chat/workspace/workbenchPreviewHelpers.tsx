import type { ReactNode } from "react";
import type { DocumentVersion } from "@/lib/workspace/workbenchCanvas";

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
