import type { Artifact } from "@/lib/artifact/types";
import type { WriteArtifactContext } from "../types";

function readArtifactSource(
  artifact: Pick<Artifact, "meta">,
  context?: Pick<WriteArtifactContext, "source">,
): WriteArtifactContext["source"] | null {
  if (context?.source) {
    return context.source;
  }

  const source = artifact.meta.source;
  return source === "tool_start" ||
    source === "artifact_snapshot" ||
    source === "tool_result" ||
    source === "message_content"
    ? source
    : null;
}

export function shouldKeepGeneralArtifactInBackground(
  artifact: Pick<Artifact, "type" | "meta">,
  context?: Pick<WriteArtifactContext, "source">,
): boolean {
  const source = readArtifactSource(artifact, context);
  if (source === "tool_result") {
    return true;
  }

  if (
    artifact.type === "document" &&
    (source === "tool_start" || source === "artifact_snapshot")
  ) {
    return true;
  }

  return false;
}

export function shouldAutoSelectGeneralArtifact(
  artifact: Pick<Artifact, "type" | "meta">,
): boolean {
  return !shouldKeepGeneralArtifactInBackground(artifact);
}
