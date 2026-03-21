import { useCallback, useEffect, useRef, useState } from "react";
import { logAgentDebug } from "@/lib/agentDebug";
import { skillsApi, type Skill } from "@/lib/api/skills";

const SKILLS_IDLE_TIMEOUT_MS = 1_500;
const SKILLS_FALLBACK_DELAY_MS = 180;

function scheduleDeferredSkillsLoad(task: () => void): () => void {
  if (typeof window === "undefined") {
    task();
    return () => undefined;
  }

  if (typeof window.requestIdleCallback === "function") {
    const idleId = window.requestIdleCallback(() => task(), {
      timeout: SKILLS_IDLE_TIMEOUT_MS,
    });
    return () => {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
    };
  }

  const timeoutId = window.setTimeout(task, SKILLS_FALLBACK_DELAY_MS);
  return () => {
    window.clearTimeout(timeoutId);
  };
}

interface UseLimeSkillsOptions {
  autoLoad?: "immediate" | "deferred" | false;
  logScope?: string;
  onError?: (error: unknown) => void;
}

export function useLimeSkills(options: UseLimeSkillsOptions = {}) {
  const {
    autoLoad = "immediate",
    logScope = "useLimeSkills",
    onError,
  } = options;
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const latestRequestIdRef = useRef(0);

  const refreshSkills = useCallback(
    async (includeRemote = false): Promise<Skill[]> => {
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;

      const startedAt = Date.now();
      logAgentDebug(logScope, "loadSkills.start", {
        includeRemote,
      });
      setSkillsLoading(true);

      try {
        const loadedSkills = includeRemote
          ? await skillsApi.getAll("lime")
          : await skillsApi.getLocal("lime");

        if (latestRequestIdRef.current !== requestId) {
          return loadedSkills;
        }

        setSkills(loadedSkills);
        logAgentDebug(logScope, "loadSkills.success", {
          durationMs: Date.now() - startedAt,
          includeRemote,
          skillsCount: loadedSkills.length,
        });
        return loadedSkills;
      } catch (error) {
        if (latestRequestIdRef.current !== requestId) {
          return [];
        }

        setSkills([]);
        onError?.(error);
        logAgentDebug(
          logScope,
          "loadSkills.error",
          {
            durationMs: Date.now() - startedAt,
            error,
            includeRemote,
          },
          { level: "warn" },
        );
        return [];
      } finally {
        if (latestRequestIdRef.current === requestId) {
          setSkillsLoading(false);
        }
      }
    },
    [logScope, onError],
  );

  useEffect(() => {
    if (autoLoad === false) {
      return;
    }

    if (autoLoad === "deferred") {
      return scheduleDeferredSkillsLoad(() => {
        void refreshSkills(false);
      });
    }

    void refreshSkills(false);
    return;
  }, [autoLoad, refreshSkills]);

  useEffect(() => {
    return () => {
      latestRequestIdRef.current += 1;
    };
  }, []);

  return {
    skills,
    skillsLoading,
    refreshSkills,
  };
}
