import { useCallback, useEffect, useState } from "react";
import type { Artifact } from "@/lib/artifact/types";
import { resolveDefaultArtifactViewMode } from "../utils/messageArtifacts";

export type ArtifactViewMode = "source" | "preview";

export interface ApplyArtifactViewModeOptions {
  artifactId?: string | null;
}

export type ApplyArtifactViewMode = (
  mode: ArtifactViewMode,
  options?: ApplyArtifactViewModeOptions,
) => void;

interface UseWorkspaceArtifactViewModeControlParams {
  activeTheme: string;
  displayedArtifact: Artifact | null;
  activeArtifactId?: string | null;
}

function normalizeArtifactId(artifactId?: string | null): string | null {
  const normalized = artifactId?.trim();
  return normalized ? normalized : null;
}

export function useWorkspaceArtifactViewModeControl({
  activeTheme,
  displayedArtifact,
  activeArtifactId,
}: UseWorkspaceArtifactViewModeControlParams) {
  const [artifactViewMode, setArtifactViewMode] =
    useState<ArtifactViewMode>("source");
  const [manuallyControlledArtifactId, setManuallyControlledArtifactId] =
    useState<string | null>(null);
  const normalizedActiveArtifactId = normalizeArtifactId(activeArtifactId);

  useEffect(() => {
    setManuallyControlledArtifactId((current) =>
      current && current === normalizedActiveArtifactId ? current : null,
    );
  }, [normalizedActiveArtifactId]);

  const applyAutoArtifactViewMode = useCallback(
    (mode: ArtifactViewMode, options: ApplyArtifactViewModeOptions = {}) => {
      const targetArtifactId =
        normalizeArtifactId(options.artifactId) || normalizedActiveArtifactId;
      if (
        targetArtifactId &&
        manuallyControlledArtifactId === targetArtifactId
      ) {
        return;
      }

      setArtifactViewMode((current) => (current === mode ? current : mode));
    },
    [manuallyControlledArtifactId, normalizedActiveArtifactId],
  );

  const handleArtifactViewModeChange = useCallback(
    (mode: ArtifactViewMode) => {
      if (normalizedActiveArtifactId) {
        setManuallyControlledArtifactId(normalizedActiveArtifactId);
      }
      setArtifactViewMode((current) => (current === mode ? current : mode));
    },
    [normalizedActiveArtifactId],
  );

  useEffect(() => {
    if (activeTheme !== "general" || !displayedArtifact) {
      return;
    }

    applyAutoArtifactViewMode(
      resolveDefaultArtifactViewMode(displayedArtifact, {
        preferSourceWhenStreaming: true,
      }),
      {
        artifactId: displayedArtifact.id,
      },
    );
  }, [activeTheme, applyAutoArtifactViewMode, displayedArtifact]);

  return {
    artifactViewMode,
    applyAutoArtifactViewMode,
    handleArtifactViewModeChange,
  };
}
