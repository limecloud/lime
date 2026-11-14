import { useEffect } from "react";
import { subscribeWorkspaceReviewTabRequest } from "@/lib/workspaceReviewTabEvents";
import type { WorkspaceRightSurfaceKind } from "./right-surface";

export function useWorkspaceReviewTabShortcuts({
  activeSurface,
  onOpen,
  onClose,
}: {
  activeSurface: WorkspaceRightSurfaceKind | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  useEffect(
    () =>
      subscribeWorkspaceReviewTabRequest((action) => {
        const changesOpen = activeSurface === "changes";
        if (action === "open") {
          if (!changesOpen) onOpen();
          return;
        }
        if (action === "close") {
          if (changesOpen) onClose();
          return;
        }
        if (changesOpen) onClose();
        else onOpen();
      }),
    [activeSurface, onClose, onOpen],
  );
}
