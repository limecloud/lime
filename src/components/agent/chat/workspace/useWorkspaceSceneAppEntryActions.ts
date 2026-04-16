import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  listSceneAppCatalog,
  type SceneAppCatalog,
} from "@/lib/api/sceneapp";
import {
  buildSceneAppEntryCard,
  FEATURED_SCENEAPP_IDS,
  readStoredSceneAppCatalog,
  resolveSceneAppSeed,
  useSceneAppLaunchRuntime,
} from "@/lib/sceneapp";
import type { SceneAppEntryCardItem } from "../sceneappEntryTypes";
import type { CreationMode } from "../components/types";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import { extractExplicitUrlFromText } from "../utils/browserAssistIntent";
import type { Page, PageParams } from "@/types/page";

interface UseWorkspaceSceneAppEntryActionsParams {
  activeTheme: string;
  creationMode: CreationMode;
  projectId?: string | null;
  input: string;
  selectedText?: string;
  defaultToolPreferences: ChatToolPreferences;
  onNavigate?: (page: Page, params?: PageParams) => void;
}

export function useWorkspaceSceneAppEntryActions({
  activeTheme,
  creationMode,
  projectId,
  input,
  selectedText,
  defaultToolPreferences,
  onNavigate,
}: UseWorkspaceSceneAppEntryActionsParams) {
  const [catalog, setCatalog] = useState<SceneAppCatalog | null>(null);
  const [sceneAppsLoading, setSceneAppsLoading] = useState(false);
  const launchRuntime = useSceneAppLaunchRuntime({
    activeTheme,
    creationMode,
    projectId,
    defaultToolPreferences,
    onNavigate,
  });

  useEffect(() => {
    if (activeTheme !== "general") {
      setCatalog(null);
      setSceneAppsLoading(false);
      return;
    }

    let cancelled = false;
    setSceneAppsLoading(true);

    void listSceneAppCatalog()
      .then((nextCatalog) => {
        if (cancelled) {
          return;
        }
        setCatalog(nextCatalog);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const storedCatalog = readStoredSceneAppCatalog();
        if (storedCatalog) {
          setCatalog(storedCatalog);
          return;
        }

        console.warn("[SceneApp] 加载目录失败:", error);
        setCatalog(null);
      })
      .finally(() => {
        if (!cancelled) {
          setSceneAppsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTheme]);

  const descriptorMap = useMemo(
    () =>
      new Map(
        (catalog?.items ?? []).map((descriptor) => [descriptor.id, descriptor]),
      ),
    [catalog],
  );

  const urlCandidate = useMemo(
    () =>
      extractExplicitUrlFromText(input) ||
      extractExplicitUrlFromText(selectedText || ""),
    [input, selectedText],
  );

  const featuredSceneApps = useMemo(() => {
    if (activeTheme !== "general") {
      return [] as SceneAppEntryCardItem[];
    }

    return FEATURED_SCENEAPP_IDS.flatMap((sceneappId) => {
      const descriptor = descriptorMap.get(sceneappId);
      if (!descriptor) {
        return [];
      }

      const item = buildSceneAppEntryCard({
        descriptor,
        projectId,
        input,
        selectedText,
        urlCandidate,
      });

      return item ? [item] : [];
    });
  }, [
    activeTheme,
    descriptorMap,
    input,
    projectId,
    selectedText,
    urlCandidate,
  ]);

  const handleLaunchSceneApp = useCallback(
    async (sceneappId: string) => {
      const descriptor = descriptorMap.get(sceneappId);
      if (!descriptor) {
        toast.error("当前场景应用目录尚未就绪，请稍后重试");
        return;
      }

      const seed = resolveSceneAppSeed({
        descriptor,
        input,
        selectedText,
        urlCandidate,
      });
      if (!seed) {
        toast.error("当前场景应用还缺少启动内容，请先补充输入");
        return;
      }

      await launchRuntime.launchSceneApp({
        descriptor,
        seed,
        entrySource: "workspace_card",
      });
    },
    [
      descriptorMap,
      input,
      launchRuntime,
      selectedText,
      urlCandidate,
    ],
  );

  return {
    featuredSceneApps,
    sceneAppsLoading,
    sceneAppLaunchingId: launchRuntime.sceneAppLaunchingId,
    automationDialogOpen: launchRuntime.automationDialogOpen,
    automationDialogInitialValues: launchRuntime.automationDialogInitialValues,
    automationWorkspaces: launchRuntime.automationWorkspaces,
    automationJobSaving: launchRuntime.automationJobSaving,
    handleLaunchSceneApp,
    handleAutomationDialogOpenChange:
      launchRuntime.handleAutomationDialogOpenChange,
    handleAutomationDialogSubmit: launchRuntime.handleAutomationDialogSubmit,
  };
}
