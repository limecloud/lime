import { useState } from "react";
import {
  LAST_PROJECT_ID_KEY,
  loadPersistedProjectId,
} from "@/components/agent/chat/hooks/agentProjectStorage";
import { VideoCanvas } from "./VideoCanvas";
import {
  createInitialVideoState,
  type VideoCanvasState,
} from "./types";

export function VideoPage() {
  const [state, setState] = useState<VideoCanvasState>(() =>
    createInitialVideoState(),
  );
  const [projectId] = useState<string | null>(() =>
    loadPersistedProjectId(LAST_PROJECT_ID_KEY),
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <VideoCanvas
        state={state}
        onStateChange={setState}
        projectId={projectId}
      />
    </div>
  );
}
