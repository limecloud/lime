import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createAutomationJob,
  type AutomationJobRequest,
} from "@/lib/api/automation";
import {
  planSceneAppLaunch,
  type SceneAppDescriptor,
  type SceneAppPlanResult,
} from "@/lib/api/sceneapp";
import type { Project } from "@/lib/api/project";
import type {
  AutomationJobDialogInitialValues,
  AutomationJobDialogSubmit,
} from "@/components/settings-v2/system/automation/AutomationJobDialog";
import type { CreationMode } from "@/components/agent/chat/components/types";
import type { ChatToolPreferences } from "@/components/agent/chat/utils/chatToolPreferences";
import type { Page, PageParams } from "@/types/page";
import {
  loadSceneAppAutomationWorkspaces,
  mergeSceneAppAutomationJobRequest,
} from "./automation";
import { formatSceneAppErrorMessage } from "./error";
import { resolveSceneAppLaunchAction } from "./launchBridge";
import type { SceneAppSeed } from "./presentation";

export interface UseSceneAppLaunchRuntimeParams {
  activeTheme: string;
  creationMode: CreationMode;
  projectId?: string | null;
  defaultToolPreferences: ChatToolPreferences;
  onNavigate?: (page: Page, params?: PageParams) => void;
}

export interface SceneAppLaunchRequest {
  descriptor: SceneAppDescriptor;
  seed: SceneAppSeed;
  entrySource: string;
  referenceMemoryIds?: string[];
  planResult?: SceneAppPlanResult;
}

export function useSceneAppLaunchRuntime({
  activeTheme,
  creationMode,
  projectId,
  defaultToolPreferences,
  onNavigate,
}: UseSceneAppLaunchRuntimeParams) {
  const [sceneAppLaunchingId, setSceneAppLaunchingId] = useState<string | null>(
    null,
  );
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false);
  const [automationDialogInitialValues, setAutomationDialogInitialValues] =
    useState<AutomationJobDialogInitialValues | null>(null);
  const [automationWorkspaces, setAutomationWorkspaces] = useState<Project[]>(
    [],
  );
  const [automationJobSaving, setAutomationJobSaving] = useState(false);
  const [pendingAutomationRequest, setPendingAutomationRequest] =
    useState<AutomationJobRequest | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const prepareAutomationDialog = useCallback(
    async (payload: {
      initialValues: AutomationJobDialogInitialValues;
      request: AutomationJobRequest;
    }) => {
      setAutomationDialogInitialValues(payload.initialValues);
      setPendingAutomationRequest(payload.request);
      setAutomationDialogOpen(true);
      setAutomationWorkspaces([]);

      try {
        const workspaces = await loadSceneAppAutomationWorkspaces(projectId);
        if (!isMountedRef.current) {
          return;
        }
        setAutomationWorkspaces(workspaces);
      } catch (error) {
        if (!isMountedRef.current) {
          return;
        }
        toast.error(
          `准备 SceneApp 自动化任务失败：${formatSceneAppErrorMessage(error)}`,
        );
        setAutomationDialogOpen(false);
        setAutomationDialogInitialValues(null);
        setPendingAutomationRequest(null);
        setAutomationWorkspaces([]);
      }
    },
    [projectId],
  );

  const launchSceneApp = useCallback(
    async ({
      descriptor,
      seed,
      entrySource,
      referenceMemoryIds,
      planResult,
    }: SceneAppLaunchRequest) => {
      setSceneAppLaunchingId(descriptor.id);
      try {
        const trimmedProjectId = projectId?.trim() || undefined;
        const resolvedPlanResult =
          planResult ??
          (await planSceneAppLaunch({
            sceneappId: descriptor.id,
            entrySource,
            workspaceId: trimmedProjectId,
            projectId: trimmedProjectId,
            userInput: seed.userInput,
            referenceMemoryIds:
              referenceMemoryIds && referenceMemoryIds.length > 0
                ? referenceMemoryIds
                : undefined,
            slots: seed.slots,
          }));

        const resolvedAction = resolveSceneAppLaunchAction({
          planResult: resolvedPlanResult,
          projectId,
          activeTheme,
          creationMode,
          defaultToolPreferences,
        });

        if (!resolvedAction.ok) {
          toast.error(resolvedAction.message);
          return;
        }

        if (resolvedAction.kind === "automation_job") {
          await prepareAutomationDialog({
            initialValues:
              resolvedAction.executionDraft.automationDialogInitialValues,
            request: resolvedAction.executionDraft.automationRequest,
          });
          return;
        }

        if (!onNavigate) {
          toast.error(
            "当前入口暂不支持切换到 Skills 工作区，请从桌面主界面重试。",
          );
          return;
        }

        onNavigate("agent", resolvedAction.resolvedEntry.navigationParams);
      } catch (error) {
        toast.error(`启动 Skill 失败：${formatSceneAppErrorMessage(error)}`);
      } finally {
        if (isMountedRef.current) {
          setSceneAppLaunchingId(null);
        }
      }
    },
    [
      activeTheme,
      creationMode,
      defaultToolPreferences,
      onNavigate,
      prepareAutomationDialog,
      projectId,
    ],
  );

  const handleAutomationDialogOpenChange = useCallback((open: boolean) => {
    setAutomationDialogOpen(open);
    if (!open) {
      setAutomationDialogInitialValues(null);
      setPendingAutomationRequest(null);
    }
  }, []);

  const handleAutomationDialogSubmit = useCallback(
    async (payload: AutomationJobDialogSubmit) => {
      if (payload.mode !== "create") {
        throw new Error("SceneApp 入口当前只支持新建自动化任务");
      }

      setAutomationJobSaving(true);
      try {
        const request = mergeSceneAppAutomationJobRequest(
          payload.request,
          pendingAutomationRequest,
        );
        const createdJob = await createAutomationJob(request);
        toast.success(`SceneApp 自动化已创建：${createdJob.name}`);
        setAutomationDialogOpen(false);
        setAutomationDialogInitialValues(null);
        setPendingAutomationRequest(null);
      } catch (error) {
        toast.error(
          `创建 SceneApp 自动化失败：${formatSceneAppErrorMessage(error)}`,
        );
      } finally {
        setAutomationJobSaving(false);
      }
    },
    [pendingAutomationRequest],
  );

  return {
    sceneAppLaunchingId,
    automationDialogOpen,
    automationDialogInitialValues,
    automationWorkspaces,
    automationJobSaving,
    launchSceneApp,
    handleAutomationDialogOpenChange,
    handleAutomationDialogSubmit,
  };
}
