import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import { setActiveContentTarget } from "@/lib/activeContentTarget";
import { normalizeInitialTheme } from "../agentChatWorkspaceShared";
import type { TaskFile } from "../components/TaskFiles";
import type { CreationMode } from "../components/types";

interface UseWorkspaceEntryStateRuntimeParams {
  effectiveEntryBannerMessage?: string | null;
  entryBannerMessage?: string | null;
  initialCreationMode?: CreationMode | null;
  initialTheme?: string | null;
  setActiveTheme: Dispatch<SetStateAction<string>>;
  setCreationMode: Dispatch<SetStateAction<CreationMode>>;
  setEntryBannerVisible: Dispatch<SetStateAction<boolean>>;
  setRuntimeEntryBannerMessage: Dispatch<SetStateAction<string | null>>;
}

interface UseWorkspaceActiveContentTargetRuntimeParams {
  canvasType?: string | null;
  contentId?: string | null;
  projectId?: string | null;
}

interface UseWorkspaceTaskFilesRefSyncRuntimeParams {
  taskFiles: TaskFile[];
  taskFilesRef: MutableRefObject<TaskFile[]>;
}


interface UseWorkspaceServiceSkillDirectoryToastRuntimeParams {
  activeTheme: string;
  serviceSkillsError?: string | null;
}

export function resolveInitialActiveTheme(
  initialTheme?: string | null,
): string | null {
  return initialTheme ? normalizeInitialTheme(initialTheme) : null;
}

export function shouldResetRuntimeEntryBannerMessage(
  entryBannerMessage?: string | null,
): boolean {
  return Boolean(entryBannerMessage);
}

export function resolveWorkspaceEntryBannerVisible(
  effectiveEntryBannerMessage?: string | null,
): boolean {
  return Boolean(effectiveEntryBannerMessage);
}

export function shouldShowServiceSkillDirectoryErrorToast({
  activeTheme,
  serviceSkillsError,
}: UseWorkspaceServiceSkillDirectoryToastRuntimeParams): boolean {
  return activeTheme === "general" && Boolean(serviceSkillsError);
}

export function buildServiceSkillDirectoryErrorToastMessage(
  serviceSkillsError: string,
): string {
  return `加载技能目录失败：${serviceSkillsError}`;
}

export function useWorkspaceEntryStateRuntime({
  effectiveEntryBannerMessage,
  entryBannerMessage,
  initialCreationMode,
  initialTheme,
  setActiveTheme,
  setCreationMode,
  setEntryBannerVisible,
  setRuntimeEntryBannerMessage,
}: UseWorkspaceEntryStateRuntimeParams): void {
  useEffect(() => {
    const nextTheme = resolveInitialActiveTheme(initialTheme);
    if (!nextTheme) {
      return;
    }
    setActiveTheme(nextTheme);
  }, [initialTheme, setActiveTheme]);

  useEffect(() => {
    if (!initialCreationMode) {
      return;
    }
    setCreationMode(initialCreationMode);
  }, [initialCreationMode, setCreationMode]);

  useEffect(() => {
    if (shouldResetRuntimeEntryBannerMessage(entryBannerMessage)) {
      setRuntimeEntryBannerMessage(null);
    }
  }, [entryBannerMessage, setRuntimeEntryBannerMessage]);

  useEffect(() => {
    setEntryBannerVisible(
      resolveWorkspaceEntryBannerVisible(effectiveEntryBannerMessage),
    );
  }, [effectiveEntryBannerMessage, setEntryBannerVisible]);
}

export function useWorkspaceActiveContentTargetRuntime({
  canvasType,
  contentId,
  projectId,
}: UseWorkspaceActiveContentTargetRuntimeParams): void {
  useEffect(() => {
    setActiveContentTarget(projectId, contentId, canvasType ?? null);
  }, [canvasType, contentId, projectId]);
}

export function useWorkspaceTaskFilesRefSyncRuntime({
  taskFiles,
  taskFilesRef,
}: UseWorkspaceTaskFilesRefSyncRuntimeParams): void {
  useEffect(() => {
    taskFilesRef.current = taskFiles;
  }, [taskFiles, taskFilesRef]);
}


export function useWorkspaceServiceSkillDirectoryToastRuntime({
  activeTheme,
  serviceSkillsError,
}: UseWorkspaceServiceSkillDirectoryToastRuntimeParams): void {
  useEffect(() => {
    if (
      !shouldShowServiceSkillDirectoryErrorToast({
        activeTheme,
        serviceSkillsError,
      })
    ) {
      return;
    }

    toast.error(
      buildServiceSkillDirectoryErrorToastMessage(serviceSkillsError as string),
    );
  }, [activeTheme, serviceSkillsError]);
}
