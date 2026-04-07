import { useCallback, useState } from "react";
import { toast } from "sonner";
import { siteGetAdapterLaunchReadiness } from "@/lib/webview-api";
import { createAutomationJob } from "@/lib/api/automation";
import {
  createServiceSkillRun,
  getServiceSkillRun,
  isTerminalServiceSkillRunStatus,
  type ServiceSkillRun,
} from "@/lib/api/serviceSkillRuns";
import {
  createContent,
  getOrCreateDefaultProject,
  listProjects,
  type Project,
} from "@/lib/api/project";
import { normalizeThemeType } from "@/lib/workspace/workbenchContract";
import {
  type AutomationJobDialogInitialValues,
  type AutomationJobDialogSubmit,
} from "@/components/settings-v2/system/automation/AutomationJobDialog";
import type { BrowserRuntimePageParams, Page, PageParams } from "@/types/page";
import type { ChatToolPreferences } from "../utils/chatToolPreferences";
import type { CreationMode } from "../components/types";
import { normalizeProjectId } from "../utils/topicProjectResolution";
import {
  resolveWorkspaceEntry,
  type WorkspaceEntryPayload,
} from "../workspaceEntry";
import { composeServiceSkillPrompt } from "../service-skills/promptComposer";
import {
  buildServiceSkillAutomationAgentTurnPayloadContext,
  buildServiceSkillAutomationInitialValues,
  supportsServiceSkillLocalAutomation,
} from "../service-skills/automationDraft";
import { recordServiceSkillAutomationLink } from "../service-skills/automationLinkStorage";
import { recordServiceSkillCloudRun } from "../service-skills/cloudRunStorage";
import { buildServiceSkillWorkspaceSeed } from "../service-skills/workspaceLaunch";
import {
  buildSiteLaunchBlockedMessage,
  buildServiceSkillClawLaunchContext,
  buildServiceSkillClawLaunchRequestMetadata,
  buildServiceSkillSiteCapabilityArgs,
  buildServiceSkillSiteCapabilitySaveTitle,
  composeServiceSkillClawLaunchPrompt,
  isServiceSkillExecutableAsSiteAdapter,
  isSiteLaunchReadinessReady,
} from "../service-skills/siteCapabilityBinding";
import type { AutoMatchedSiteSkill } from "../service-skills/autoMatchSiteSkill";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotValues,
} from "../service-skills/types";
import type { TeamDefinition } from "../utils/teamDefinitions";
import { attachSelectedTeamToRequestMetadata } from "../utils/teamRequestMetadata";

const SERVICE_SKILL_RUN_STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  running: "运行中",
  success: "已完成",
  failed: "执行失败",
  canceled: "已取消",
  timeout: "已超时",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "请稍后重试";
}

function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function siteSkillRequiresProject(skill: ServiceSkillHomeItem): boolean {
  if (!isServiceSkillExecutableAsSiteAdapter(skill)) {
    return false;
  }

  return (
    skill.readinessRequirements?.requiresProject ||
    (skill.siteCapabilityBinding.saveMode ?? "project_resource") ===
      "project_resource"
  );
}

interface ServiceSkillLaunchOptions {
  launchUserInput?: string | null;
  fallbackToWorkspaceOnCloudSubmitFailure?: boolean;
}

function resolveServiceSkillLaunchUserInput(
  currentInput: string,
  options?: ServiceSkillLaunchOptions,
): string | undefined {
  if (options && "launchUserInput" in options) {
    return normalizeOptionalText(options.launchUserInput);
  }

  return normalizeOptionalText(currentInput);
}

function buildServiceSkillCloudResultBody(
  skill: ServiceSkillHomeItem,
  run: ServiceSkillRun,
): string {
  return (
    normalizeOptionalText(run.outputText) ||
    normalizeOptionalText(run.outputSummary) ||
    `# ${skill.title}\n\n云端结果已生成。`
  );
}

function buildServiceSkillCloudResultMetadata(
  run: ServiceSkillRun,
): Record<string, unknown> {
  return {
    cloudRun: {
      id: run.id,
      status: run.status,
      executorKind: run.executorKind ?? null,
      outputSummary: normalizeOptionalText(run.outputSummary) ?? null,
      errorCode: run.errorCode ?? null,
      errorMessage: run.errorMessage ?? null,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      updatedAt: run.updatedAt ?? null,
    },
  };
}

function resolveFallbackProjectType(theme?: string): Project["workspaceType"] {
  return normalizeThemeType(theme);
}

function buildFallbackAutomationWorkspace(
  projectId: string,
  theme?: string,
): Project {
  return {
    id: projectId,
    name: projectId,
    workspaceType: resolveFallbackProjectType(theme),
    rootPath: "",
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    isFavorite: false,
    isArchived: false,
    tags: [],
  };
}

function prioritizeAutomationWorkspaces(
  workspaces: Project[],
  projectId?: string | null,
  theme?: string,
): Project[] {
  const normalizedProjectId = normalizeProjectId(projectId);
  if (!normalizedProjectId) {
    return workspaces;
  }

  const matched = workspaces.find(
    (workspace) => workspace.id === normalizedProjectId,
  );
  const fallbackWorkspace =
    matched ?? buildFallbackAutomationWorkspace(normalizedProjectId, theme);
  const remaining = workspaces.filter(
    (workspace) => workspace.id !== normalizedProjectId,
  );

  return [fallbackWorkspace, ...remaining];
}

function getServiceSkillRunStatusLabel(status: string): string {
  return SERVICE_SKILL_RUN_STATUS_LABELS[status] ?? status;
}

function buildServiceSkillRunSuccessMessage(
  skill: ServiceSkillHomeItem,
  run: ServiceSkillRun,
): string {
  const summary = run.outputSummary || run.outputText || run.inputSummary;
  if (summary) {
    return `${skill.title} 云端运行完成：${summary}，正在回流本地工作区。`;
  }

  return `${skill.title} 云端运行完成，正在回流本地工作区。`;
}

interface PendingServiceSkillAutomationLaunch {
  skill: ServiceSkillHomeItem;
  prompt: string;
  slotValues: ServiceSkillSlotValues;
  userInput?: string;
  usage: {
    skillId: string;
    runnerType: ServiceSkillHomeItem["runnerType"];
  };
}

interface UseWorkspaceServiceSkillEntryActionsParams {
  activeTheme: string;
  creationMode: CreationMode;
  projectId?: string | null;
  contentId?: string | null;
  input: string;
  chatToolPreferences: ChatToolPreferences;
  preferredTeamPresetId?: string | null;
  selectedTeam?: TeamDefinition | null;
  selectedTeamLabel?: string | null;
  selectedTeamSummary?: string | null;
  onNavigate?: (page: Page, params?: PageParams) => void;
  recordServiceSkillUsage: (input: {
    skillId: string;
    runnerType: ServiceSkillHomeItem["runnerType"];
  }) => void;
}

export function useWorkspaceServiceSkillEntryActions({
  activeTheme,
  creationMode,
  projectId,
  contentId,
  input,
  chatToolPreferences,
  preferredTeamPresetId,
  selectedTeam,
  selectedTeamLabel,
  selectedTeamSummary,
  onNavigate,
  recordServiceSkillUsage,
}: UseWorkspaceServiceSkillEntryActionsParams) {
  const [selectedServiceSkill, setSelectedServiceSkill] =
    useState<ServiceSkillHomeItem | null>(null);
  const [serviceSkillDialogOpen, setServiceSkillDialogOpen] = useState(false);
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false);
  const [automationDialogInitialValues, setAutomationDialogInitialValues] =
    useState<AutomationJobDialogInitialValues | null>(null);
  const [automationWorkspaces, setAutomationWorkspaces] = useState<Project[]>(
    [],
  );
  const [automationJobSaving, setAutomationJobSaving] = useState(false);
  const [pendingServiceSkillAutomation, setPendingServiceSkillAutomation] =
    useState<PendingServiceSkillAutomationLaunch | null>(null);

  const currentProjectId = normalizeProjectId(projectId);
  const currentContentId = contentId?.trim() || null;

  const navigateToServiceSkillWorkspace = useCallback(
    (payload: WorkspaceEntryPayload): boolean => {
      const payloadWithSelectedTeamMetadata: WorkspaceEntryPayload = {
        ...payload,
        initialRequestMetadata: attachSelectedTeamToRequestMetadata(
          payload.initialRequestMetadata,
          {
            preferredTeamPresetId,
            selectedTeam,
            selectedTeamLabel,
            selectedTeamSummary,
          },
        ),
        initialAutoSendRequestMetadata: attachSelectedTeamToRequestMetadata(
          payload.initialAutoSendRequestMetadata,
          {
            preferredTeamPresetId,
            selectedTeam,
            selectedTeamLabel,
            selectedTeamSummary,
          },
        ),
      };
      const resolved = resolveWorkspaceEntry({
        projectId: payload.projectId ?? currentProjectId,
        activeTheme,
        creationMode,
        defaultToolPreferences: chatToolPreferences,
        payload: payloadWithSelectedTeamMetadata,
      });

      if (!resolved.ok) {
        if (resolved.reason === "missing_project") {
          toast.error("缺少项目工作区，请先选择项目后再启动技能。");
          return false;
        }
        toast.error("技能缺少可执行内容，请先补齐参数后重试。");
        return false;
      }

      if (!onNavigate) {
        toast.error("当前入口暂不支持切换技能工作区，请从桌面主界面重试。");
        return false;
      }

      onNavigate("agent", resolved.navigationParams);
      return true;
    },
    [
      activeTheme,
      chatToolPreferences,
      creationMode,
      currentProjectId,
      preferredTeamPresetId,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
      onNavigate,
    ],
  );

  const createServiceSkillSeededContent = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      targetProjectId?: string | null,
      options?: {
        body?: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      const normalizedProjectId = normalizeProjectId(
        targetProjectId ?? currentProjectId,
      );
      const seed = buildServiceSkillWorkspaceSeed(
        skill,
        skill.themeTarget ?? activeTheme,
      );

      if (!normalizedProjectId || !seed) {
        return null;
      }

      const mergedMetadata = {
        ...(seed.metadata ?? {}),
        ...(options?.metadata ?? {}),
      };

      return createContent({
        project_id: normalizedProjectId,
        title: seed.title,
        content_type: seed.contentType,
        body: options?.body ?? "",
        metadata:
          Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
      });
    },
    [activeTheme, currentProjectId],
  );

  const resolveSiteSkillProjectId = useCallback(
    async (skill: ServiceSkillHomeItem): Promise<string | undefined> => {
      if (!siteSkillRequiresProject(skill)) {
        return undefined;
      }

      if (currentProjectId) {
        return currentProjectId;
      }

      const defaultProject = await getOrCreateDefaultProject();
      const defaultProjectId = normalizeProjectId(defaultProject?.id);
      if (!defaultProjectId) {
        throw new Error("当前技能需要项目工作区，但默认项目准备失败。");
      }

      return defaultProjectId;
    },
    [currentProjectId],
  );

  const prepareServiceSkillWorkspacePayload = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      prompt: string,
      options?: {
        contentId?: string | null;
        projectId?: string | null;
      },
    ): Promise<WorkspaceEntryPayload> => {
      const normalizedProjectId = normalizeProjectId(
        options?.projectId ?? currentProjectId,
      );
      const existingContentId =
        options?.contentId?.trim() || currentContentId || undefined;
      const seed = buildServiceSkillWorkspaceSeed(
        skill,
        skill.themeTarget ?? activeTheme,
      );

      if (existingContentId) {
        return {
          prompt,
          contentId: existingContentId,
          themeOverride: skill.themeTarget,
          initialRequestMetadata: seed?.requestMetadata,
          autoRunInitialPromptOnMount: true,
        };
      }

      if (!normalizedProjectId || !seed) {
        return {
          prompt,
          themeOverride: skill.themeTarget,
          initialRequestMetadata: seed?.requestMetadata,
          autoRunInitialPromptOnMount: true,
        };
      }

      const created = await createServiceSkillSeededContent(
        skill,
        normalizedProjectId,
      );

      if (!created) {
        return {
          prompt,
          themeOverride: skill.themeTarget,
          initialRequestMetadata: seed.requestMetadata,
          autoRunInitialPromptOnMount: true,
        };
      }

      return {
        prompt,
        contentId: created.id,
        themeOverride: skill.themeTarget,
        initialRequestMetadata: seed.requestMetadata,
        autoRunInitialPromptOnMount: true,
      };
    },
    [
      activeTheme,
      createServiceSkillSeededContent,
      currentContentId,
      currentProjectId,
    ],
  );

  const prepareServiceSkillSiteWorkspacePayload = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      slotValues: ServiceSkillSlotValues,
      launchReadiness: Awaited<
        ReturnType<typeof siteGetAdapterLaunchReadiness>
      > | null,
      options?: ServiceSkillLaunchOptions,
    ): Promise<WorkspaceEntryPayload> => {
      if (!isServiceSkillExecutableAsSiteAdapter(skill)) {
        throw new Error("当前技能未绑定站点执行能力");
      }

      if (!isSiteLaunchReadinessReady(launchReadiness)) {
        throw new Error(buildSiteLaunchBlockedMessage(launchReadiness));
      }

      const resolvedProjectId = await resolveSiteSkillProjectId(skill);
      const binding = skill.siteCapabilityBinding;
      const saveMode = binding.saveMode ?? "project_resource";
      const initialSaveTitle = buildServiceSkillSiteCapabilitySaveTitle(
        skill,
        slotValues,
      );
      let nextContentId = currentContentId || undefined;

      if (
        saveMode === "current_content" &&
        !nextContentId &&
        resolvedProjectId
      ) {
        const created = await createServiceSkillSeededContent(
          skill,
          resolvedProjectId,
        );
        nextContentId = created?.id ?? undefined;
      }

      const clawLaunchContext = {
        ...buildServiceSkillClawLaunchContext(skill, slotValues, {
          contentId: nextContentId,
          projectId: resolvedProjectId,
          launchReadiness,
        }),
        saveTitle: nextContentId ? undefined : initialSaveTitle,
      };
      const prompt = composeServiceSkillClawLaunchPrompt({
        skill,
        slotValues,
        userInput: resolveServiceSkillLaunchUserInput(input, options),
        context: clawLaunchContext,
      });

      return {
        prompt,
        projectId: resolvedProjectId,
        contentId: nextContentId,
        themeOverride: "general",
        initialAutoSendRequestMetadata:
          buildServiceSkillClawLaunchRequestMetadata(clawLaunchContext),
        autoRunInitialPromptOnMount: true,
      };
    },
    [
      createServiceSkillSeededContent,
      currentContentId,
      input,
      resolveSiteSkillProjectId,
    ],
  );

  const prepareServiceSkillCloudResultWorkspacePayload = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      run: ServiceSkillRun,
    ): Promise<WorkspaceEntryPayload | null> => {
      const seed = buildServiceSkillWorkspaceSeed(
        skill,
        skill.themeTarget ?? activeTheme,
      );

      if (!currentProjectId || !seed) {
        return null;
      }

      const created = await createServiceSkillSeededContent(
        skill,
        currentProjectId,
        {
          body: buildServiceSkillCloudResultBody(skill, run),
          metadata: buildServiceSkillCloudResultMetadata(run),
        },
      );

      if (!created) {
        return null;
      }

      return {
        contentId: created.id,
        themeOverride: skill.themeTarget,
        initialRequestMetadata: seed.requestMetadata,
      };
    },
    [activeTheme, createServiceSkillSeededContent, currentProjectId],
  );

  const handleServiceSkillSelect = useCallback(
    (skill: ServiceSkillHomeItem) => {
      setSelectedServiceSkill(skill);
      setServiceSkillDialogOpen(true);
    },
    [],
  );

  const handleServiceSkillDialogOpenChange = useCallback((open: boolean) => {
    setServiceSkillDialogOpen(open);
    if (!open) {
      setSelectedServiceSkill(null);
    }
  }, []);

  const handleServiceSkillBrowserRuntimeLaunch = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      slotValues: ServiceSkillSlotValues,
    ): Promise<void> => {
      if (!isServiceSkillExecutableAsSiteAdapter(skill)) {
        return;
      }

      if (!onNavigate) {
        toast.error("当前入口暂不支持打开浏览器工作台，请从桌面主界面重试。");
        return;
      }

      let resolvedProjectId: string | undefined;
      try {
        resolvedProjectId = await resolveSiteSkillProjectId(skill);
      } catch (error) {
        toast.error(getErrorMessage(error));
        return;
      }

      const binding = skill.siteCapabilityBinding;
      let launchReadiness: Awaited<
        ReturnType<typeof siteGetAdapterLaunchReadiness>
      > | null = null;
      try {
        launchReadiness = await siteGetAdapterLaunchReadiness({
          adapter_name: binding.adapterName,
        });
      } catch {
        launchReadiness = null;
      }
      const saveMode = binding.saveMode ?? "project_resource";
      const initialArgs = buildServiceSkillSiteCapabilityArgs(
        skill,
        slotValues,
      );
      const initialSaveTitle = buildServiceSkillSiteCapabilitySaveTitle(
        skill,
        slotValues,
      );
      let nextContentId = currentContentId || undefined;

      if (
        saveMode === "current_content" &&
        !nextContentId &&
        resolvedProjectId
      ) {
        try {
          const created = await createServiceSkillSeededContent(
            skill,
            resolvedProjectId,
          );
          nextContentId = created?.id ?? undefined;
        } catch (error) {
          toast.error(`准备浏览器采集主稿失败：${getErrorMessage(error)}`);
          return;
        }
      }

      const navigationParams: BrowserRuntimePageParams = {
        projectId: resolvedProjectId,
        contentId: nextContentId,
        initialProfileKey:
          launchReadiness?.status === "ready"
            ? launchReadiness.profile_key
            : undefined,
        initialTargetId:
          launchReadiness?.status === "ready"
            ? launchReadiness.target_id
            : undefined,
        initialAdapterName: binding.adapterName,
        initialArgs,
        initialAutoRun: binding.autoRun ?? false,
        initialRequireAttachedSession: binding.requireAttachedSession ?? false,
        initialSaveTitle: nextContentId ? undefined : initialSaveTitle,
      };

      onNavigate("browser-runtime", navigationParams);
      recordServiceSkillUsage({
        skillId: skill.id,
        runnerType: skill.runnerType,
      });
      setServiceSkillDialogOpen(false);
      setSelectedServiceSkill(null);
    },
    [
      createServiceSkillSeededContent,
      currentContentId,
      onNavigate,
      recordServiceSkillUsage,
      resolveSiteSkillProjectId,
    ],
  );

  const handleServiceSkillLaunch = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      slotValues: ServiceSkillSlotValues,
      options?: ServiceSkillLaunchOptions,
    ) => {
      if (isServiceSkillExecutableAsSiteAdapter(skill)) {
        let launchReadiness: Awaited<
          ReturnType<typeof siteGetAdapterLaunchReadiness>
        > | null = null;
        try {
          launchReadiness = await siteGetAdapterLaunchReadiness({
            adapter_name: skill.siteCapabilityBinding.adapterName,
          });
        } catch {
          // 门禁检查失败时保持当前入口态，由后续阻断提示兜底。
        }

        if (!isSiteLaunchReadinessReady(launchReadiness)) {
          toast.info(buildSiteLaunchBlockedMessage(launchReadiness));
          return;
        }

        let workspacePayload: WorkspaceEntryPayload;
        try {
          workspacePayload = await prepareServiceSkillSiteWorkspacePayload(
            skill,
            slotValues,
            launchReadiness,
            options,
          );
        } catch (error) {
          toast.error(`准备站点技能失败：${getErrorMessage(error)}`);
          return;
        }

        const entered = navigateToServiceSkillWorkspace(workspacePayload);
        if (!entered) {
          return;
        }

        recordServiceSkillUsage({
          skillId: skill.id,
          runnerType: skill.runnerType,
        });
        setServiceSkillDialogOpen(false);
        setSelectedServiceSkill(null);
        return;
      }

      const prompt = composeServiceSkillPrompt({
        skill,
        slotValues,
        userInput: resolveServiceSkillLaunchUserInput(input, options),
      });

      if (skill.executionLocation === "cloud_required") {
        const toastId = toast.loading(`正在提交 ${skill.title} 到云端...`);
        let runCreated = false;

        try {
          setServiceSkillDialogOpen(false);
          setSelectedServiceSkill(null);

          let run = await createServiceSkillRun(skill.id, prompt);
          runCreated = true;
          recordServiceSkillCloudRun(skill.id, run);
          recordServiceSkillUsage({
            skillId: skill.id,
            runnerType: skill.runnerType,
          });

          if (!isTerminalServiceSkillRunStatus(run.status)) {
            toast.loading(
              `${skill.title} ${getServiceSkillRunStatusLabel(run.status)}，正在等待结果...`,
              {
                id: toastId,
              },
            );

            for (let attempt = 0; attempt < 12; attempt += 1) {
              await sleep(2_000);
              run = await getServiceSkillRun(run.id);
              recordServiceSkillCloudRun(skill.id, run);
              if (isTerminalServiceSkillRunStatus(run.status)) {
                break;
              }
            }
          }

          if (run.status === "success") {
            let workspacePayload: WorkspaceEntryPayload | null = null;
            let workspaceErrorMessage: string | null = null;

            try {
              workspacePayload =
                await prepareServiceSkillCloudResultWorkspacePayload(
                  skill,
                  run,
                );
            } catch (error) {
              workspaceErrorMessage = getErrorMessage(error);
            }

            toast.success(buildServiceSkillRunSuccessMessage(skill, run), {
              id: toastId,
            });

            if (workspacePayload) {
              const entered = navigateToServiceSkillWorkspace(workspacePayload);
              if (!entered) {
                toast.error(
                  "云端结果已生成，但进入工作区失败，请稍后手动打开。",
                );
              }
            } else if (workspaceErrorMessage) {
              toast.error(
                `云端结果已生成，但回流本地工作区失败：${workspaceErrorMessage}`,
              );
            }
            return;
          }

          if (isTerminalServiceSkillRunStatus(run.status)) {
            throw new Error(
              run.errorMessage ||
                `${skill.title} ${getServiceSkillRunStatusLabel(run.status)}`,
            );
          }

          toast.info(
            `${skill.title} 已提交云端，当前仍在 ${getServiceSkillRunStatusLabel(run.status)}。`,
            {
              id: toastId,
            },
          );
        } catch (error) {
          if (options?.fallbackToWorkspaceOnCloudSubmitFailure && !runCreated) {
            let workspacePayload: WorkspaceEntryPayload;
            try {
              workspacePayload = await prepareServiceSkillWorkspacePayload(
                skill,
                prompt,
              );
            } catch (workspaceError) {
              toast.error(
                `提交云端运行失败：${getErrorMessage(error)}；本地回退失败：${getErrorMessage(workspaceError)}`,
                {
                  id: toastId,
                },
              );
              return;
            }

            const entered = navigateToServiceSkillWorkspace(workspacePayload);
            if (!entered) {
              toast.error(
                `提交云端运行失败：${getErrorMessage(error)}；进入本地工作区失败，请稍后重试。`,
                {
                  id: toastId,
                },
              );
              return;
            }

            recordServiceSkillUsage({
              skillId: skill.id,
              runnerType: skill.runnerType,
            });
            toast.info(
              `${skill.title} 云端暂不可用，已切换到本地工作区继续。`,
              {
                id: toastId,
              },
            );
            return;
          }

          toast.error(`提交云端运行失败：${getErrorMessage(error)}`, {
            id: toastId,
          });
        }
        return;
      }

      if (skill.runnerType !== "instant") {
        toast.info(
          "当前先进入工作区生成首版方案，下一阶段再接本地自动化任务。",
        );
      }

      let workspacePayload: WorkspaceEntryPayload;
      try {
        workspacePayload = await prepareServiceSkillWorkspacePayload(
          skill,
          prompt,
        );
      } catch (error) {
        toast.error(`准备技能工作区失败：${getErrorMessage(error)}`);
        return;
      }

      const entered = navigateToServiceSkillWorkspace(workspacePayload);
      if (!entered) {
        return;
      }

      recordServiceSkillUsage({
        skillId: skill.id,
        runnerType: skill.runnerType,
      });
      setServiceSkillDialogOpen(false);
      setSelectedServiceSkill(null);
    },
    [
      input,
      navigateToServiceSkillWorkspace,
      prepareServiceSkillCloudResultWorkspacePayload,
      prepareServiceSkillSiteWorkspacePayload,
      prepareServiceSkillWorkspacePayload,
      recordServiceSkillUsage,
    ],
  );

  const handleAutoLaunchMatchedSiteSkill = useCallback(
    async (match: AutoMatchedSiteSkill<ServiceSkillHomeItem>) => {
      await handleServiceSkillLaunch(match.skill, match.slotValues, {
        launchUserInput: match.launchUserInput,
      });
    },
    [handleServiceSkillLaunch],
  );

  const handleServiceSkillAutomationSetup = useCallback(
    async (skill: ServiceSkillHomeItem, slotValues: ServiceSkillSlotValues) => {
      if (!supportsServiceSkillLocalAutomation(skill)) {
        await handleServiceSkillLaunch(skill, slotValues);
        return;
      }

      if (!currentProjectId) {
        toast.error("缺少项目工作区，请先选择项目后再创建本地自动化任务。");
        return;
      }

      const prompt = composeServiceSkillPrompt({
        skill,
        slotValues,
        userInput: input.trim() || undefined,
      });
      const userInput = input.trim() || undefined;

      try {
        let workspaces: Project[];
        try {
          workspaces = prioritizeAutomationWorkspaces(
            await listProjects(),
            currentProjectId,
            skill.themeTarget ?? activeTheme,
          );
        } catch {
          workspaces = [
            buildFallbackAutomationWorkspace(
              currentProjectId,
              skill.themeTarget ?? activeTheme,
            ),
          ];
        }

        setAutomationWorkspaces(workspaces);
        setAutomationDialogInitialValues(
          buildServiceSkillAutomationInitialValues({
            skill,
            slotValues,
            userInput,
            workspaceId: currentProjectId,
          }),
        );
        setPendingServiceSkillAutomation({
          skill,
          prompt,
          slotValues,
          userInput,
          usage: {
            skillId: skill.id,
            runnerType: skill.runnerType,
          },
        });
        setServiceSkillDialogOpen(false);
        setSelectedServiceSkill(null);
        setAutomationDialogOpen(true);
      } catch (error) {
        toast.error(`准备本地自动化任务失败：${getErrorMessage(error)}`);
      }
    },
    [activeTheme, currentProjectId, handleServiceSkillLaunch, input],
  );

  const handleAutomationDialogOpenChange = useCallback((open: boolean) => {
    setAutomationDialogOpen(open);
    if (!open) {
      setAutomationDialogInitialValues(null);
      setPendingServiceSkillAutomation(null);
    }
  }, []);

  const handleAutomationDialogSubmit = useCallback(
    async (payload: AutomationJobDialogSubmit) => {
      if (payload.mode !== "create") {
        throw new Error("当前技能入口只支持创建新的本地自动化任务");
      }

      setAutomationJobSaving(true);
      try {
        const pendingLaunch = pendingServiceSkillAutomation;
        let request = payload.request;
        let automationContentId = currentContentId;

        if (pendingLaunch && request.payload.kind === "agent_turn") {
          if (!automationContentId) {
            const createdContent = await createServiceSkillSeededContent(
              pendingLaunch.skill,
              request.workspace_id,
            );
            automationContentId = createdContent?.id ?? null;
          }

          request = {
            ...request,
            payload: {
              ...request.payload,
              ...buildServiceSkillAutomationAgentTurnPayloadContext({
                skill: pendingLaunch.skill,
                slotValues: pendingLaunch.slotValues,
                userInput: pendingLaunch.userInput,
                contentId: automationContentId,
              }),
            },
          };
        }

        const createdJob = await createAutomationJob(request);
        toast.success(`本地自动化任务已创建：${createdJob.name}`);

        setAutomationDialogOpen(false);
        setAutomationDialogInitialValues(null);
        setPendingServiceSkillAutomation(null);

        if (!pendingLaunch) {
          return;
        }

        recordServiceSkillAutomationLink({
          skillId: pendingLaunch.usage.skillId,
          jobId: createdJob.id,
          jobName: createdJob.name,
        });
        recordServiceSkillUsage(pendingLaunch.usage);

        let workspacePayload: WorkspaceEntryPayload;
        try {
          workspacePayload = await prepareServiceSkillWorkspacePayload(
            pendingLaunch.skill,
            pendingLaunch.prompt,
            {
              contentId: automationContentId,
              projectId: request.workspace_id,
            },
          );
        } catch (error) {
          toast.error(
            `自动化任务已创建，但准备工作区失败：${getErrorMessage(error)}`,
          );
          return;
        }

        const entered = navigateToServiceSkillWorkspace(workspacePayload);
        if (!entered) {
          toast.error("自动化任务已创建，但进入工作区失败，请稍后手动打开。");
        }
      } catch (error) {
        toast.error(`创建本地自动化任务失败：${getErrorMessage(error)}`);
        throw error;
      } finally {
        setAutomationJobSaving(false);
      }
    },
    [
      createServiceSkillSeededContent,
      currentContentId,
      navigateToServiceSkillWorkspace,
      pendingServiceSkillAutomation,
      prepareServiceSkillWorkspacePayload,
      recordServiceSkillUsage,
    ],
  );

  return {
    selectedServiceSkill,
    serviceSkillDialogOpen,
    automationDialogOpen,
    automationDialogInitialValues,
    automationWorkspaces,
    automationJobSaving,
    handleServiceSkillSelect,
    handleServiceSkillDialogOpenChange,
    handleServiceSkillLaunch,
    handleAutoLaunchMatchedSiteSkill,
    handleServiceSkillBrowserRuntimeLaunch,
    handleServiceSkillAutomationSetup,
    handleAutomationDialogOpenChange,
    handleAutomationDialogSubmit,
  };
}
