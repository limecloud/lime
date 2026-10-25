import { useCallback, useEffect, useRef, useState } from "react";
import { skillsChangedServerNotification } from "@limecloud/app-server-client";
import { subscribeAppServerNotifications } from "@/lib/api/appServerEventBus";
import type { AppServerSkillsListResponse } from "@/lib/api/appServerTypes";
import { listProjects } from "@/lib/api/project";
import { listSkills, writeProtocolSkillEnabled } from "@/lib/api/skillConfig";

export type SettingsSkill =
  AppServerSkillsListResponse["data"][number]["skills"][number];
type SkillsSettingsError = "load" | "save" | "refresh" | "overridden";

export function useSkillsSettings() {
  const [skills, setSkills] = useState<SettingsSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<SkillsSettingsError | null>(null);
  const epoch = useRef(0);
  const busy = useRef(false);
  const queued = useRef(false);
  const unconfirmed = useRef<{ path: string; enabled: boolean } | null>(null);
  const invalidate = useCallback(() => {
    ++epoch.current;
    busy.current = false;
    queued.current = false;
  }, []);

  const read = useCallback(async () => {
    const projects = await listProjects();
    const cwds = [
      ...new Set(
        projects
          .filter((project) => !project.isArchived)
          .map((project) => project.rootPath)
          .filter(Boolean),
      ),
    ];
    const response = await listSkills({
      ...(cwds.length ? { cwds } : {}),
      forceReload: true,
    });
    const installed = new Map<string, SettingsSkill>();
    for (const entry of response.data) {
      // 不完整扫描不能把已有完整列表替换成错误的空态。
      if (entry.errors.length)
        throw new Error("Incomplete skills/list response");
      for (const skill of entry.skills) {
        if (!installed.has(skill.path)) installed.set(skill.path, skill);
      }
    }
    return [...installed.values()];
  }, []);

  const accept = useCallback((next: SettingsSkill[]) => {
    setSkills(next);
    const expected = unconfirmed.current;
    unconfirmed.current = null;
    const confirmed =
      !expected ||
      next.some(
        (skill) =>
          skill.path === expected.path && skill.enabled === expected.enabled,
      );
    setError(confirmed ? null : "overridden");
    return confirmed;
  }, []);

  const reload = useCallback(async (): Promise<boolean> => {
    if (busy.current) return false;
    const request = epoch.current;
    busy.current = true;
    queued.current = false;
    setLoading(true);
    try {
      const next = await read();
      if (request !== epoch.current) return false;
      return accept(next);
    } catch {
      if (request === epoch.current)
        setError(unconfirmed.current ? "refresh" : "load");
      return false;
    } finally {
      if (request === epoch.current) {
        busy.current = false;
        setLoading(false);
        if (queued.current) void reload();
      }
    }
  }, [accept, read]);

  useEffect(() => {
    ++epoch.current;
    const subscription = epoch.current;
    busy.current = false;
    setPending(false);
    void reload();
    const unsubscribe = subscribeAppServerNotifications({
      onNotifications: (messages) => {
        if (subscription !== epoch.current) return;
        if (
          messages.some(
            (message) => skillsChangedServerNotification(message) !== undefined,
          )
        ) {
          queued.current = true;
          void reload();
        }
      },
    });
    return () => {
      invalidate();
      unsubscribe();
    };
  }, [invalidate, reload]);

  const mutate = async (path: string, enabled: boolean) => {
    if (
      busy.current ||
      unconfirmed.current ||
      !skills.some((skill) => skill.path === path)
    )
      return false;
    const request = epoch.current;
    busy.current = true;
    setPending(true);
    setError(null);
    let saved = false;
    try {
      const effective = await writeProtocolSkillEnabled({ path, enabled });
      saved = true;
      if (request !== epoch.current) return false;
      unconfirmed.current = { path, enabled };
      const next = await read();
      if (request !== epoch.current) return false;
      const confirmed = accept(next);
      if (effective !== enabled) setError("overridden");
      return confirmed && effective === enabled;
    } catch {
      if (request === epoch.current) setError(saved ? "refresh" : "save");
      return false;
    } finally {
      if (request === epoch.current) {
        busy.current = false;
        setPending(false);
        if (queued.current) void reload();
      }
    }
  };

  return { skills, loading, pending, error, reload, mutate };
}

export type SkillsSettingsController = ReturnType<typeof useSkillsSettings>;
