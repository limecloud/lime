import { useEffect, useState } from "react";
import {
  VideoCanvas,
  createInitialVideoState,
  type VideoCanvasState,
} from "@/lib/workspace/workbenchCanvas";
import type { ThemeWorkspaceRendererProps } from "@/features/themes/types";

export function VideoThemeWorkspace({
  projectId,
  resetAt,
  onBackHome,
}: ThemeWorkspaceRendererProps) {
  const [videoCanvasState, setVideoCanvasState] = useState<VideoCanvasState>(
    () => createInitialVideoState(),
  );

  useEffect(() => {
    setVideoCanvasState(createInitialVideoState());
  }, [resetAt]);

  return (
    <div className="flex-1 min-h-0" data-testid="video-theme-workspace">
      <VideoCanvas
        state={videoCanvasState}
        onStateChange={setVideoCanvasState}
        projectId={projectId}
        onBackHome={onBackHome}
      />
    </div>
  );
}
