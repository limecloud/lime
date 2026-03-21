import { useEffect, useState } from "react";
import { getProjectMemory, type ProjectMemory } from "@/lib/api/memory";
import { logAgentDebug } from "@/lib/agentDebug";
import { normalizeProjectId } from "../utils/topicProjectResolution";

export function useHomeShellProjectMemory(projectId?: string | null) {
  const normalizedProjectId = normalizeProjectId(projectId);
  const [projectMemory, setProjectMemory] = useState<ProjectMemory | null>(
    null,
  );

  useEffect(() => {
    if (!normalizedProjectId) {
      setProjectMemory(null);
      return;
    }

    let cancelled = false;
    const startedAt = Date.now();
    logAgentDebug("useHomeShellProjectMemory", "load.start", {
      projectId: normalizedProjectId,
    });

    void getProjectMemory(normalizedProjectId)
      .then((memory) => {
        if (cancelled) {
          return;
        }
        setProjectMemory(memory);
        logAgentDebug("useHomeShellProjectMemory", "load.success", {
          durationMs: Date.now() - startedAt,
          projectId: normalizedProjectId,
          charactersCount: memory.characters.length,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setProjectMemory(null);
        logAgentDebug(
          "useHomeShellProjectMemory",
          "load.error",
          {
            durationMs: Date.now() - startedAt,
            error,
            projectId: normalizedProjectId,
          },
          { level: "warn" },
        );
      });

    return () => {
      cancelled = true;
    };
  }, [normalizedProjectId]);

  return projectMemory;
}
