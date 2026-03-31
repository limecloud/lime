import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { toast } from "sonner";
import { createAutomationJob } from "@/lib/api/automation";
import { prepareClawSolution } from "@/lib/api/clawSolutions";
import { siteGetAdapterLaunchReadiness } from "@/lib/webview-api";
import {
  createServiceSkillRun,
  getServiceSkillRun,
  isTerminalServiceSkillRunStatus,
  type ServiceSkillRun,
} from "@/lib/api/serviceSkillRuns";
import {
  createContent,
  getProject,
  listProjects,
  type Project,
} from "@/lib/api/project";
import { readTeamMemorySnapshot } from "@/lib/teamMemorySync";
import {
  AutomationJobDialog,
  type AutomationJobDialogInitialValues,
  type AutomationJobDialogSubmit,
} from "@/components/settings-v2/system/automation/AutomationJobDialog";
import type { BrowserRuntimePageParams, Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { EmptyState } from "./components/EmptyState";
import type { CreationMode } from "./components/types";
import type { MessageImage } from "./types";
import {
  alignChatToolPreferencesWithExecutionStrategy,
  saveChatToolPreferences,
} from "./utils/chatToolPreferences";
import { isTeamRuntimeRecommendation } from "./utils/contextualRecommendations";
import { resolveClawWorkspaceProviderSelection } from "./utils/clawWorkspaceProviderSelection";
import { createChatToolPreferencesFromExecutionRuntime } from "./utils/sessionExecutionRuntime";
import { normalizeProjectId } from "./utils/topicProjectResolution";
import {
  LAST_PROJECT_ID_KEY,
  usePersistedProjectId,
} from "./hooks/agentProjectStorage";
import { useHomeShellAgentPreferences } from "./hooks/useHomeShellAgentPreferences";
import { useHomeShellProjectMemory } from "./hooks/useHomeShellProjectMemory";
import { useHomeShellSkills } from "./hooks/useHomeShellSkills";
import { useThemeScopedChatToolPreferences } from "./hooks/useThemeScopedChatToolPreferences";
import { useSelectedTeamPreference } from "./hooks/useSelectedTeamPreference";
import { syncTeamMemoryShadowSnapshot } from "./hooks/useTeamMemoryShadowSync";
import { attachSelectedTeamToRequestMetadata } from "./utils/teamRequestMetadata";
import {
  enableSubagentPreference,
  resolveClawSolutionLaunch,
  resolveClawSolutionSetupTarget,
} from "./claw-solutions/actionDispatcher";
import { useClawSolutions } from "./claw-solutions/useClawSolutions";
import { ClawHomeSolutionsPanel } from "./claw-solutions/ClawHomeSolutionsPanel";
import type { ClawSolutionHomeItem } from "./claw-solutions/types";
import { normalizeInitialTheme } from "./agentChatWorkspaceShared";
import { normalizeThemeType } from "@/lib/workspace/workbenchContract";
import {
  type AgentChatWorkspaceBootstrap,
  resolveHomeShellWorkspaceEntry,
  type HomeShellEnterWorkspacePayload,
} from "./homeShellEntry";
import { useServiceSkills } from "./service-skills/useServiceSkills";
import { ServiceSkillLaunchDialog } from "./service-skills/ServiceSkillLaunchDialog";
import { matchAutoLaunchSiteSkillFromText } from "./service-skills/autoMatchSiteSkill";
import { composeServiceSkillPrompt } from "./service-skills/promptComposer";
import {
  buildServiceSkillAutomationAgentTurnPayloadContext,
  buildServiceSkillAutomationInitialValues,
  supportsServiceSkillLocalAutomation,
} from "./service-skills/automationDraft";
import { recordServiceSkillAutomationLink } from "./service-skills/automationLinkStorage";
import { recordServiceSkillCloudRun } from "./service-skills/cloudRunStorage";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotValues,
} from "./service-skills/types";
import { buildServiceSkillWorkspaceSeed } from "./service-skills/workspaceLaunch";
import {
  buildSiteLaunchBlockedMessage,
  buildServiceSkillClawLaunchContext,
  buildServiceSkillClawLaunchRequestMetadata,
  buildServiceSkillSiteCapabilityArgs,
  buildServiceSkillSiteCapabilitySaveTitle,
  composeServiceSkillClawLaunchPrompt,
  isServiceSkillExecutableAsSiteAdapter,
  isSiteLaunchReadinessReady,
} from "./service-skills/siteCapabilityBinding";

const PageContainer = styled.div<{ $compact?: boolean }>`
  display: flex;
  height: 100%;
  width: 100%;
  position: relative;
  min-height: 0;
  gap: ${({ $compact }) => ($compact ? "8px" : "14px")};
  padding: ${({ $compact }) => ($compact ? "8px" : "14px")};
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
  background:
    radial-gradient(
      circle at 14% 18%,
      rgba(56, 189, 248, 0.1),
      transparent 30%
    ),
    radial-gradient(
      circle at 86% 14%,
      rgba(16, 185, 129, 0.08),
      transparent 28%
    ),
    radial-gradient(
      circle at 72% 84%,
      rgba(245, 158, 11, 0.06),
      transparent 24%
    ),
    linear-gradient(
      180deg,
      rgba(248, 250, 252, 0.98) 0%,
      rgba(248, 250, 252, 0.96) 42%,
      rgba(242, 251, 247, 0.94) 100%
    );

  > * {
    position: relative;
    z-index: 1;
  }
`;

const MainArea = styled.div<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(226, 232, 240, 0.88);
  border-radius: ${({ $compact }) => ($compact ? "24px" : "32px")};
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.96) 0%,
    rgba(248, 250, 252, 0.94) 56%,
    rgba(248, 250, 252, 0.88) 100%
  );
  box-shadow:
    0 24px 72px -36px rgba(15, 23, 42, 0.18),
    0 16px 28px -24px rgba(15, 23, 42, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.76);
`;

const ChatContainer = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
`;

const ChatContainerInner = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    rgba(248, 250, 252, 0.78) 0%,
    rgba(255, 255, 255, 0.12) 18%,
    rgba(255, 255, 255, 0) 100%
  );
`;

const ThemeWorkbenchLayoutShell = styled.div<{ $bottomInset: string }>`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding-bottom: ${({ $bottomInset }) => $bottomInset};
  transition: padding-bottom 0.2s ease;
`;

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

interface ServiceSkillLaunchOptions {
  launchUserInput?: string | null;
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

export type { AgentChatWorkspaceBootstrap } from "./homeShellEntry";

interface AgentChatHomeShellProps {
  onNavigate?: (page: Page, params?: PageParams) => void;
  projectId?: string;
  theme?: string;
  initialCreationMode?: CreationMode;
  lockTheme?: boolean;
  onEnterWorkspace: (payload: AgentChatWorkspaceBootstrap) => void;
}

export function AgentChatHomeShell({
  onNavigate,
  projectId: externalProjectId,
  theme: initialTheme,
  initialCreationMode,
  lockTheme = false,
  onEnterWorkspace,
}: AgentChatHomeShellProps) {
  const normalizedEntryTheme = normalizeInitialTheme(initialTheme);
  const [input, setInput] = useState("");
  const [activeTheme, setActiveTheme] = useState<string>(normalizedEntryTheme);
  const [creationMode, setCreationMode] = useState<CreationMode>(
    initialCreationMode ?? "guided",
  );
  const {
    projectId: currentProjectId,
    setProjectId: setCurrentProjectId,
    rememberProjectId,
  } = usePersistedProjectId(externalProjectId, LAST_PROJECT_ID_KEY);
  const {
    chatToolPreferences,
    setChatToolPreferences,
    syncChatToolPreferencesSource,
  } = useThemeScopedChatToolPreferences(activeTheme, {
    scopeId: currentProjectId,
  });
  const {
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
    recentExecutionRuntime,
  } = useHomeShellAgentPreferences(currentProjectId);
  const projectMemory = useHomeShellProjectMemory(currentProjectId);
  const { skills, skillsLoading, refreshSkills } = useHomeShellSkills();
  const [browserAssistLoading, setBrowserAssistLoading] = useState(false);
  const [currentProjectRootPath, setCurrentProjectRootPath] = useState<
    string | null
  >(null);
  const [manualTeamShadowSyncState, setManualTeamShadowSyncState] = useState<{
    projectId: string | null;
    version: number;
  }>({
    projectId: null,
    version: 0,
  });

  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(currentProjectId);
    if (!normalizedProjectId) {
      setCurrentProjectRootPath(null);
      return;
    }

    let cancelled = false;
    void getProject(normalizedProjectId)
      .then((project) => {
        if (cancelled) {
          return;
        }
        setCurrentProjectRootPath(project?.rootPath?.trim() || null);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setCurrentProjectRootPath(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  const persistedTeamMemoryShadowSnapshot = useMemo(() => {
    if (!currentProjectRootPath || typeof localStorage === "undefined") {
      return null;
    }

    return readTeamMemorySnapshot(localStorage, currentProjectRootPath);
  }, [currentProjectRootPath]);
  const {
    selectedTeam,
    setSelectedTeam: handleSelectTeam,
    enableSuggestedTeam: handleEnableSuggestedTeam,
    preferredTeamPresetId,
    selectedTeamLabel,
    selectedTeamSummary,
  } = useSelectedTeamPreference(activeTheme, {
    runtimeSelection: recentExecutionRuntime?.recent_team_selection ?? null,
    shadowSnapshot: persistedTeamMemoryShadowSnapshot,
    allowPersistedThemeFallback: !currentProjectId,
  });

  useEffect(() => {
    const normalizedProjectId = normalizeProjectId(currentProjectId);
    if (
      manualTeamShadowSyncState.version <= 0 ||
      manualTeamShadowSyncState.projectId !== normalizedProjectId ||
      !currentProjectRootPath ||
      typeof localStorage === "undefined"
    ) {
      return;
    }

    syncTeamMemoryShadowSnapshot({
      repoScope: currentProjectRootPath,
      activeTheme,
      selectedTeam,
      storage: localStorage,
    });
  }, [
    activeTheme,
    currentProjectRootPath,
    currentProjectId,
    manualTeamShadowSyncState,
    selectedTeam,
  ]);

  const handleManualSelectTeam = useCallback(
    (team: Parameters<typeof handleSelectTeam>[0]) => {
      handleSelectTeam(team);
      setManualTeamShadowSyncState((previous) => ({
        projectId: normalizeProjectId(currentProjectId),
        version: previous.version + 1,
      }));
    },
    [currentProjectId, handleSelectTeam],
  );
  const runtimeChatToolPreferences = useMemo(
    () => createChatToolPreferencesFromExecutionRuntime(recentExecutionRuntime),
    [recentExecutionRuntime],
  );
  const effectiveChatToolPreferences = useMemo(
    () =>
      alignChatToolPreferencesWithExecutionStrategy(
        chatToolPreferences,
        executionStrategy,
      ),
    [chatToolPreferences, executionStrategy],
  );
  const {
    solutions: clawSolutions,
    isLoading: clawSolutionsLoading,
    error: clawSolutionsError,
    recordUsage: recordClawSolutionUsage,
  } = useClawSolutions(activeTheme === "general");
  const {
    skills: serviceSkills,
    groups: _serviceSkillGroups,
    catalogMeta: _serviceSkillCatalogMeta,
    isLoading: _serviceSkillsLoading,
    error: serviceSkillsError,
    recordUsage: recordServiceSkillUsage,
  } = useServiceSkills(activeTheme === "general");
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

  useEffect(() => {
    setActiveTheme(normalizeInitialTheme(initialTheme));
  }, [initialTheme]);

  useEffect(() => {
    if (!initialCreationMode) {
      return;
    }
    setCreationMode(initialCreationMode);
  }, [initialCreationMode]);

  useEffect(() => {
    if (activeTheme !== "general" || !clawSolutionsError) {
      return;
    }

    toast.error(`加载 Claw 方案失败：${clawSolutionsError}`);
  }, [activeTheme, clawSolutionsError]);

  useEffect(() => {
    if (activeTheme !== "general" || !serviceSkillsError) {
      return;
    }

    toast.error(`加载技能目录失败：${serviceSkillsError}`);
  }, [activeTheme, serviceSkillsError]);

  useEffect(() => {
    syncChatToolPreferencesSource(activeTheme, runtimeChatToolPreferences);
  }, [activeTheme, runtimeChatToolPreferences, syncChatToolPreferencesSource]);

  useEffect(() => {
    if (chatToolPreferences.task === effectiveChatToolPreferences.task) {
      return;
    }

    setChatToolPreferences(effectiveChatToolPreferences);
  }, [
    chatToolPreferences.task,
    effectiveChatToolPreferences,
    setChatToolPreferences,
  ]);

  const handleRefreshSkills = useCallback(async () => {
    await refreshSkills(true);
  }, [refreshSkills]);

  const handleProjectChange = useCallback(
    (nextProjectId: string) => {
      if (externalProjectId) {
        return;
      }

      const normalizedProjectId = normalizeProjectId(nextProjectId);
      setCurrentProjectId(normalizedProjectId);
      if (normalizedProjectId) {
        rememberProjectId(normalizedProjectId);
      }
    },
    [externalProjectId, rememberProjectId, setCurrentProjectId],
  );

  const handleOpenBrowserRuntimeFromHome = useCallback(() => {
    if (!onNavigate) {
      toast.error("当前入口暂不支持打开浏览器工作台，请从桌面主界面重试。");
      return;
    }

    const normalizedProjectId = normalizeProjectId(currentProjectId);
    if (normalizedProjectId) {
      rememberProjectId(normalizedProjectId);
    }

    onNavigate(
      "browser-runtime",
      normalizedProjectId
        ? {
            projectId: normalizedProjectId,
          }
        : undefined,
    );
  }, [currentProjectId, onNavigate, rememberProjectId]);

  const handleEnterWorkspace = useCallback(
    (payload: HomeShellEnterWorkspacePayload) => {
      const normalizedProjectId = normalizeProjectId(currentProjectId);
      const payloadWithSelectedTeamMetadata: HomeShellEnterWorkspacePayload = {
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
      const resolved = resolveHomeShellWorkspaceEntry({
        projectId: normalizedProjectId,
        activeTheme,
        creationMode,
        defaultToolPreferences: effectiveChatToolPreferences,
        payload: payloadWithSelectedTeamMetadata,
      });

      if (!resolved.ok) {
        if (resolved.reason === "missing_project") {
          toast.error("缺少项目工作区，请先选择项目后再使用 Agent");
        }
        return false;
      }

      if (normalizedProjectId) {
        rememberProjectId(normalizedProjectId);
      }
      saveChatToolPreferences(resolved.toolPreferences, resolved.targetTheme);

      if (onNavigate) {
        onNavigate("agent", resolved.navigationParams);
        return true;
      }

      onEnterWorkspace(resolved.workspaceBootstrap);
      return true;
    },
    [
      activeTheme,
      effectiveChatToolPreferences,
      creationMode,
      currentProjectId,
      rememberProjectId,
      onEnterWorkspace,
      onNavigate,
      preferredTeamPresetId,
      selectedTeam,
      selectedTeamLabel,
      selectedTeamSummary,
    ],
  );

  const handleClawSolutionSelect = useCallback(
    async (solution: ClawSolutionHomeItem) => {
      try {
        const preparation = await prepareClawSolution(solution.id, {
          projectId: normalizeProjectId(currentProjectId) ?? undefined,
          userInput: input.trim() || undefined,
        });

        if (preparation.readiness !== "ready") {
          const setupTab = resolveClawSolutionSetupTarget(
            preparation.readiness,
            preparation.reasonCode,
          );
          if (setupTab && onNavigate) {
            if (setupTab === SettingsTabs.Skills) {
              onNavigate("skills");
            } else {
              onNavigate("settings", { tab: setupTab });
            }
            return;
          }
          toast.error(preparation.readinessMessage);
          return;
        }

        const launch = resolveClawSolutionLaunch(
          preparation,
          effectiveChatToolPreferences,
        );
        const targetTheme =
          launch.enterWorkspacePayload.themeOverride ?? activeTheme;

        try {
          const providerSelection = await resolveClawWorkspaceProviderSelection(
            {
              currentProviderType: providerType,
              currentModel: model,
              theme: targetTheme,
            },
          );

          if (providerSelection) {
            if (providerSelection.providerType !== providerType) {
              setProviderType(providerSelection.providerType);
            }
            if (providerSelection.model !== model) {
              setModel(providerSelection.model);
            }
          }
        } catch (selectionError) {
          console.warn(
            "[AgentChatHomeShell] 解析 Claw 工作区默认 provider/model 失败，继续沿用当前选择:",
            selectionError,
          );
        }

        if (launch.preferencesChanged) {
          setChatToolPreferences(launch.nextToolPreferences);
        }

        if (launch.shouldStartBrowserAssistLoading) {
          setBrowserAssistLoading(true);
        }

        const entered = handleEnterWorkspace(launch.enterWorkspacePayload);

        if (!entered) {
          if (launch.shouldStartBrowserAssistLoading) {
            setBrowserAssistLoading(false);
          }
          return;
        }

        recordClawSolutionUsage(launch.usageRecord);
      } catch (error) {
        setBrowserAssistLoading(false);
        toast.error(`启动方案失败：${getErrorMessage(error)}`);
      }
    },
    [
      effectiveChatToolPreferences,
      currentProjectId,
      handleEnterWorkspace,
      input,
      model,
      onNavigate,
      providerType,
      recordClawSolutionUsage,
      setChatToolPreferences,
      setModel,
      setProviderType,
      activeTheme,
    ],
  );

  const handleServiceSkillSelect = useCallback(
    (skill: ServiceSkillHomeItem) => {
      setSelectedServiceSkill(skill);
      setServiceSkillDialogOpen(true);
    },
    [],
  );

  const _handleOpenServiceSkillAutomationJob = useCallback(
    (skill: ServiceSkillHomeItem) => {
      const jobId = skill.automationStatus?.jobId;
      if (!jobId || !onNavigate) {
        return;
      }

      onNavigate("automation", {
        selectedJobId: jobId,
        workspaceTab: "tasks",
      });
    },
    [onNavigate],
  );

  const createServiceSkillSeededContent = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      projectId?: string | null,
      options?: {
        body?: string;
        metadata?: Record<string, unknown>;
      },
    ) => {
      const normalizedProjectId = normalizeProjectId(
        projectId ?? currentProjectId,
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

  const prepareServiceSkillCloudResultWorkspacePayload = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      run: ServiceSkillRun,
    ): Promise<HomeShellEnterWorkspacePayload | null> => {
      const normalizedProjectId = normalizeProjectId(currentProjectId);
      const seed = buildServiceSkillWorkspaceSeed(
        skill,
        skill.themeTarget ?? activeTheme,
      );

      if (!normalizedProjectId || !seed) {
        return null;
      }

      const created = await createServiceSkillSeededContent(
        skill,
        normalizedProjectId,
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

  const prepareServiceSkillWorkspacePayload = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      prompt: string,
      options?: {
        contentId?: string | null;
        projectId?: string | null;
      },
    ): Promise<HomeShellEnterWorkspacePayload> => {
      const normalizedProjectId = normalizeProjectId(
        options?.projectId ?? currentProjectId,
      );
      const existingContentId = options?.contentId?.trim();
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
    [activeTheme, createServiceSkillSeededContent, currentProjectId],
  );

  const prepareServiceSkillSiteWorkspacePayload = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      slotValues: ServiceSkillSlotValues,
      launchReadiness:
        | Awaited<ReturnType<typeof siteGetAdapterLaunchReadiness>>
        | null,
      options?: ServiceSkillLaunchOptions,
    ): Promise<HomeShellEnterWorkspacePayload> => {
      if (!isServiceSkillExecutableAsSiteAdapter(skill)) {
        throw new Error("当前技能未绑定站点执行能力");
      }

      if (!isSiteLaunchReadinessReady(launchReadiness)) {
        throw new Error(buildSiteLaunchBlockedMessage(launchReadiness));
      }

      const normalizedProjectId = normalizeProjectId(currentProjectId);
      if (
        skill.readinessRequirements?.requiresProject &&
        !normalizedProjectId
      ) {
        throw new Error("缺少项目工作区，请先选择项目后再启动站点技能。");
      }
      const binding = skill.siteCapabilityBinding;
      const saveMode = binding.saveMode ?? "project_resource";
      const initialSaveTitle = buildServiceSkillSiteCapabilitySaveTitle(
        skill,
        slotValues,
      );
      let nextContentId: string | undefined;

      if (saveMode === "current_content" && normalizedProjectId) {
        const created = await createServiceSkillSeededContent(
          skill,
          normalizedProjectId,
        );
        nextContentId = created?.id ?? undefined;
      }

      const clawLaunchContext = {
        ...buildServiceSkillClawLaunchContext(skill, slotValues, {
          contentId: nextContentId,
          projectId: normalizedProjectId,
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
        contentId: nextContentId,
        themeOverride: "general",
        initialAutoSendRequestMetadata:
          buildServiceSkillClawLaunchRequestMetadata(clawLaunchContext),
        autoRunInitialPromptOnMount: true,
      };
    },
    [createServiceSkillSeededContent, currentProjectId, input],
  );

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

      const normalizedProjectId = normalizeProjectId(currentProjectId);
      if (
        skill.readinessRequirements?.requiresProject &&
        !normalizedProjectId
      ) {
        toast.error("缺少项目工作区，请先选择项目后再启动浏览器采集。");
        return;
      }

      const binding = skill.siteCapabilityBinding;
      let launchReadiness:
        | Awaited<ReturnType<typeof siteGetAdapterLaunchReadiness>>
        | null = null;
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
      let contentId: string | undefined;

      if (saveMode === "current_content" && normalizedProjectId) {
        try {
          const created = await createServiceSkillSeededContent(
            skill,
            normalizedProjectId,
          );
          contentId = created?.id ?? undefined;
        } catch (error) {
          toast.error(`准备浏览器采集主稿失败：${getErrorMessage(error)}`);
          return;
        }
      }

      const navigationParams: BrowserRuntimePageParams = {
        projectId: normalizedProjectId ?? undefined,
        contentId,
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
        initialSaveTitle: contentId ? undefined : initialSaveTitle,
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
      currentProjectId,
      onNavigate,
      recordServiceSkillUsage,
    ],
  );

  const handleServiceSkillLaunch = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      slotValues: ServiceSkillSlotValues,
      options?: ServiceSkillLaunchOptions,
    ) => {
      if (isServiceSkillExecutableAsSiteAdapter(skill)) {
        let launchReadiness:
          | Awaited<ReturnType<typeof siteGetAdapterLaunchReadiness>>
          | null = null;
        try {
          launchReadiness = await siteGetAdapterLaunchReadiness({
            adapter_name: skill.siteCapabilityBinding.adapterName,
          });
        } catch {
          // 门禁检查失败时保持弹窗可见，交由后续阻断提示兜底。
        }

        if (!isSiteLaunchReadinessReady(launchReadiness)) {
          toast.info(buildSiteLaunchBlockedMessage(launchReadiness));
          return;
        }

        let workspacePayload: HomeShellEnterWorkspacePayload;
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

        const entered = handleEnterWorkspace(workspacePayload);
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

        try {
          setServiceSkillDialogOpen(false);
          setSelectedServiceSkill(null);

          let run = await createServiceSkillRun(skill.id, prompt);
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
            let workspacePayload: HomeShellEnterWorkspacePayload | null = null;
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
              const entered = handleEnterWorkspace(workspacePayload);
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
          toast.error(`提交云端运行失败：${getErrorMessage(error)}`, {
            id: toastId,
          });
        }
        return;
      }

      if (skill.runnerType !== "instant") {
        toast.info("当前先进入工作区生成首版结果；如需持续运行，可继续创建本地任务。");
      }

      let workspacePayload: HomeShellEnterWorkspacePayload;
      try {
        workspacePayload = await prepareServiceSkillWorkspacePayload(
          skill,
          prompt,
        );
      } catch (error) {
        toast.error(`准备技能工作区失败：${getErrorMessage(error)}`);
        return;
      }

      const entered = handleEnterWorkspace(workspacePayload);

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
      handleEnterWorkspace,
      input,
      prepareServiceSkillCloudResultWorkspacePayload,
      prepareServiceSkillSiteWorkspacePayload,
      prepareServiceSkillWorkspacePayload,
      recordServiceSkillUsage,
    ],
  );

  const handleEmptyStateSend = useCallback(
    async (
      value: string,
      sendExecutionStrategy?: "react" | "code_orchestrated" | "auto",
      images?: MessageImage[],
    ) => {
      if (sendExecutionStrategy) {
        setExecutionStrategy(sendExecutionStrategy);
      }

      const trimmedValue = value.trim();
      if (
        activeTheme === "general" &&
        !images?.length &&
        trimmedValue &&
        !trimmedValue.startsWith("/") &&
        !trimmedValue.startsWith("@")
      ) {
        const matchedSiteSkill = matchAutoLaunchSiteSkillFromText({
          inputText: trimmedValue,
          serviceSkills,
        });
        if (matchedSiteSkill) {
          await handleServiceSkillLaunch(
            matchedSiteSkill.skill,
            matchedSiteSkill.slotValues,
            {
              launchUserInput: matchedSiteSkill.launchUserInput,
            },
          );
          return;
        }
      }

      handleEnterWorkspace({
        prompt: value,
        images,
      });
    },
    [
      activeTheme,
      handleEnterWorkspace,
      handleServiceSkillLaunch,
      serviceSkills,
      setExecutionStrategy,
    ],
  );

  const handleServiceSkillAutomationSetup = useCallback(
    async (skill: ServiceSkillHomeItem, slotValues: ServiceSkillSlotValues) => {
      if (!supportsServiceSkillLocalAutomation(skill)) {
        await handleServiceSkillLaunch(skill, slotValues);
        return;
      }

      const normalizedProjectId = normalizeProjectId(currentProjectId);
      if (!normalizedProjectId) {
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
            normalizedProjectId,
            skill.themeTarget ?? activeTheme,
          );
        } catch {
          workspaces = [
            buildFallbackAutomationWorkspace(
              normalizedProjectId,
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
            workspaceId: normalizedProjectId,
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
        let automationContentId: string | null = null;

        if (pendingLaunch && request.payload.kind === "agent_turn") {
          const createdContent = await createServiceSkillSeededContent(
            pendingLaunch.skill,
            request.workspace_id,
          );
          automationContentId = createdContent?.id ?? null;
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
        let workspacePayload: HomeShellEnterWorkspacePayload;
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
        const entered = handleEnterWorkspace(workspacePayload);
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
      handleEnterWorkspace,
      pendingServiceSkillAutomation,
      prepareServiceSkillWorkspacePayload,
      recordServiceSkillUsage,
    ],
  );

  const handleRecommendationClick = useCallback(
    (shortLabel: string, fullPrompt: string) => {
      setInput(fullPrompt);

      if (
        activeTheme !== "general" ||
        !isTeamRuntimeRecommendation(shortLabel, fullPrompt)
      ) {
        return;
      }

      const { nextToolPreferences, changed } =
        enableSubagentPreference(effectiveChatToolPreferences);

      if (changed) {
        setChatToolPreferences(nextToolPreferences);
      }
      saveChatToolPreferences(nextToolPreferences, activeTheme);
      handleEnterWorkspace({
        prompt: fullPrompt,
        toolPreferences: nextToolPreferences,
      });
    },
    [
      activeTheme,
      effectiveChatToolPreferences,
      handleEnterWorkspace,
      setChatToolPreferences,
    ],
  );

  return (
    <PageContainer>
      <MainArea>
        <ThemeWorkbenchLayoutShell $bottomInset="0">
          <ChatContainer>
            <ChatContainerInner>
              <EmptyState
                input={input}
                setInput={setInput}
                onSend={(value, sendExecutionStrategy, images) => {
                  void handleEmptyStateSend(
                    value,
                    sendExecutionStrategy,
                    images,
                  );
                }}
                providerType={providerType}
                setProviderType={setProviderType}
                model={model}
                setModel={setModel}
                modelSelectorBackgroundPreload="idle"
                executionStrategy={executionStrategy}
                setExecutionStrategy={setExecutionStrategy}
                onManageProviders={() => {
                  onNavigate?.("settings", {
                    tab: SettingsTabs.Providers,
                  });
                }}
                webSearchEnabled={effectiveChatToolPreferences.webSearch}
                onWebSearchEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    webSearch: enabled,
                  }))
                }
                thinkingEnabled={effectiveChatToolPreferences.thinking}
                onThinkingEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    thinking: enabled,
                  }))
                }
                subagentEnabled={effectiveChatToolPreferences.subagent}
                onSubagentEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    subagent: enabled,
                  }))
                }
                selectedTeam={selectedTeam}
                onSelectTeam={handleManualSelectTeam}
                onEnableSuggestedTeam={handleEnableSuggestedTeam}
                creationMode={creationMode}
                onCreationModeChange={setCreationMode}
                activeTheme={activeTheme}
                onThemeChange={(theme) => {
                  if (!lockTheme) {
                    setActiveTheme(theme);
                  }
                }}
                showThemeTabs={false}
                hasCanvasContent={false}
                hasContentId={false}
                selectedText=""
                onRecommendationClick={handleRecommendationClick}
                supportingSlotOverride={
                  activeTheme === "general" ? (
                    <ClawHomeSolutionsPanel
                      solutions={clawSolutions}
                      loading={clawSolutionsLoading}
                      onSelect={handleClawSolutionSelect}
                    />
                  ) : undefined
                }
                characters={projectMemory?.characters || []}
                skills={skills}
                serviceSkills={activeTheme === "general" ? serviceSkills : []}
                isSkillsLoading={skillsLoading}
                onSelectServiceSkill={handleServiceSkillSelect}
                onNavigateToSettings={() => {
                  onNavigate?.("skills");
                }}
                onRefreshSkills={handleRefreshSkills}
                onLaunchBrowserAssist={
                  activeTheme === "general"
                    ? handleOpenBrowserRuntimeFromHome
                    : undefined
                }
                browserAssistLoading={browserAssistLoading}
                projectId={currentProjectId}
                onProjectChange={handleProjectChange}
                skipProjectSelectorWorkspaceReadyCheck
                deferProjectSelectorListLoad
                configLoadStrategy="idle"
                onOpenSettings={() => {
                  onNavigate?.("settings", {
                    tab: SettingsTabs.Appearance,
                  });
                }}
              />
              <ServiceSkillLaunchDialog
                skill={selectedServiceSkill}
                open={serviceSkillDialogOpen}
                onOpenChange={(open) => {
                  setServiceSkillDialogOpen(open);
                  if (!open) {
                    setSelectedServiceSkill(null);
                  }
                }}
                onLaunch={handleServiceSkillLaunch}
                onCreateAutomation={handleServiceSkillAutomationSetup}
                onOpenBrowserRuntime={handleServiceSkillBrowserRuntimeLaunch}
              />
              <AutomationJobDialog
                open={automationDialogOpen}
                mode="create"
                workspaces={automationWorkspaces}
                initialValues={automationDialogInitialValues}
                saving={automationJobSaving}
                onOpenChange={handleAutomationDialogOpenChange}
                onSubmit={handleAutomationDialogSubmit}
              />
            </ChatContainerInner>
          </ChatContainer>
        </ThemeWorkbenchLayoutShell>
      </MainArea>
    </PageContainer>
  );
}
