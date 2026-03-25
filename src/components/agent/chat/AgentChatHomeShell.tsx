import { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { toast } from "sonner";
import { createAutomationJob } from "@/lib/api/automation";
import { prepareClawSolution } from "@/lib/api/clawSolutions";
import {
  createServiceSkillRun,
  getServiceSkillRun,
  isTerminalServiceSkillRunStatus,
  type ServiceSkillRun,
} from "@/lib/api/serviceSkillRuns";
import { listProjects, type Project } from "@/lib/api/project";
import {
  AutomationJobDialog,
  type AutomationJobDialogInitialValues,
  type AutomationJobDialogSubmit,
} from "@/components/settings-v2/system/automation/AutomationJobDialog";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import { EmptyState } from "./components/EmptyState";
import type { CreationMode } from "./components/types";
import {
  saveChatToolPreferences,
} from "./utils/chatToolPreferences";
import { isTeamRuntimeRecommendation } from "./utils/contextualRecommendations";
import { resolveClawWorkspaceProviderSelection } from "./utils/clawWorkspaceProviderSelection";
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
import {
  enableSubagentPreference,
  resolveClawSolutionLaunch,
  resolveClawSolutionSetupTarget,
} from "./claw-solutions/actionDispatcher";
import { useClawSolutions } from "./claw-solutions/useClawSolutions";
import { ClawHomeSolutionsPanel } from "./claw-solutions/ClawHomeSolutionsPanel";
import type { ClawSolutionHomeItem } from "./claw-solutions/types";
import { normalizeInitialTheme } from "./agentChatWorkspaceShared";
import {
  type AgentChatWorkspaceBootstrap,
  resolveHomeShellWorkspaceEntry,
  type HomeShellEnterWorkspacePayload,
} from "./homeShellEntry";
import { useServiceSkills } from "./service-skills/useServiceSkills";
import { ServiceSkillHomePanel } from "./service-skills/ServiceSkillHomePanel";
import { ServiceSkillLaunchDialog } from "./service-skills/ServiceSkillLaunchDialog";
import { composeServiceSkillPrompt } from "./service-skills/promptComposer";
import {
  buildServiceSkillAutomationInitialValues,
  supportsServiceSkillLocalAutomation,
} from "./service-skills/automationDraft";
import { recordServiceSkillAutomationLink } from "./service-skills/automationLinkStorage";
import type {
  ServiceSkillHomeItem,
  ServiceSkillSlotValues,
} from "./service-skills/types";

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
  backdrop-filter: blur(18px);
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

function resolveFallbackProjectType(theme?: string): Project["workspaceType"] {
  switch (theme) {
    case "social-media":
    case "poster":
    case "music":
    case "knowledge":
    case "planning":
    case "document":
    case "video":
    case "novel":
    case "general":
      return theme;
    default:
      return "general";
  }
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

  const matched = workspaces.find((workspace) => workspace.id === normalizedProjectId);
  const fallbackWorkspace =
    matched ?? buildFallbackAutomationWorkspace(normalizedProjectId, theme);
  const remaining = workspaces.filter((workspace) => workspace.id !== normalizedProjectId);

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
    return `${skill.title} 云端运行完成：${summary}`;
  }

  return `${skill.title} 云端运行完成。`;
}

interface PendingServiceSkillAutomationLaunch {
  enterWorkspacePayload: HomeShellEnterWorkspacePayload;
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
  const { chatToolPreferences, setChatToolPreferences } =
    useThemeScopedChatToolPreferences(activeTheme);
  const {
    projectId: currentProjectId,
    setProjectId: setCurrentProjectId,
    rememberProjectId,
  } = usePersistedProjectId(externalProjectId, LAST_PROJECT_ID_KEY);
  const {
    providerType,
    setProviderType,
    model,
    setModel,
    executionStrategy,
    setExecutionStrategy,
  } = useHomeShellAgentPreferences(currentProjectId);
  const projectMemory = useHomeShellProjectMemory(currentProjectId);
  const { skills, skillsLoading, refreshSkills } = useHomeShellSkills();
  const [browserAssistLoading, setBrowserAssistLoading] = useState(false);
  const {
    selectedTeam,
    setSelectedTeam: handleSelectTeam,
    enableSuggestedTeam: handleEnableSuggestedTeam,
  } = useSelectedTeamPreference(activeTheme);
  const {
    solutions: clawSolutions,
    isLoading: clawSolutionsLoading,
    error: clawSolutionsError,
    recordUsage: recordClawSolutionUsage,
  } = useClawSolutions(activeTheme === "general");
  const {
    skills: serviceSkills,
    catalogMeta: serviceSkillCatalogMeta,
    isLoading: serviceSkillsLoading,
    error: serviceSkillsError,
    recordUsage: recordServiceSkillUsage,
  } = useServiceSkills(activeTheme === "general");
  const [selectedServiceSkill, setSelectedServiceSkill] =
    useState<ServiceSkillHomeItem | null>(null);
  const [serviceSkillDialogOpen, setServiceSkillDialogOpen] = useState(false);
  const [automationDialogOpen, setAutomationDialogOpen] = useState(false);
  const [automationDialogInitialValues, setAutomationDialogInitialValues] =
    useState<AutomationJobDialogInitialValues | null>(null);
  const [automationWorkspaces, setAutomationWorkspaces] = useState<Project[]>([]);
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

    toast.error(`加载服务型技能失败：${serviceSkillsError}`);
  }, [activeTheme, serviceSkillsError]);

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

  const handleEnterWorkspace = useCallback(
    (payload: HomeShellEnterWorkspacePayload) => {
      const normalizedProjectId = normalizeProjectId(currentProjectId);
      const resolved = resolveHomeShellWorkspaceEntry({
        projectId: normalizedProjectId,
        activeTheme,
        creationMode,
        defaultToolPreferences: chatToolPreferences,
        payload,
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
      chatToolPreferences,
      creationMode,
      currentProjectId,
      rememberProjectId,
      onEnterWorkspace,
      onNavigate,
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
            onNavigate("settings", { tab: setupTab });
            return;
          }
          toast.error(preparation.readinessMessage);
          return;
        }

        const launch = resolveClawSolutionLaunch(
          preparation,
          chatToolPreferences,
        );
        const targetTheme =
          launch.enterWorkspacePayload.themeOverride ?? activeTheme;

        try {
          const providerSelection = await resolveClawWorkspaceProviderSelection({
            currentProviderType: providerType,
            currentModel: model,
            theme: targetTheme,
          });

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
      chatToolPreferences,
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

  const handleServiceSkillSelect = useCallback((skill: ServiceSkillHomeItem) => {
    setSelectedServiceSkill(skill);
    setServiceSkillDialogOpen(true);
  }, []);

  const handleOpenServiceSkillAutomationJob = useCallback(
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

  const handleServiceSkillLaunch = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      slotValues: ServiceSkillSlotValues,
    ) => {
      const prompt = composeServiceSkillPrompt({
        skill,
        slotValues,
        userInput: input.trim() || undefined,
      });

      if (skill.executionLocation === "cloud_required") {
        const toastId = toast.loading(`正在提交 ${skill.title} 到云端...`);

        try {
          setServiceSkillDialogOpen(false);
          setSelectedServiceSkill(null);

          let run = await createServiceSkillRun(skill.id, prompt);
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
              if (isTerminalServiceSkillRunStatus(run.status)) {
                break;
              }
            }
          }

          if (run.status === "success") {
            toast.success(buildServiceSkillRunSuccessMessage(skill, run), {
              id: toastId,
            });
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
        toast.info("当前先进入工作区生成首版方案，下一阶段再接本地自动化任务。");
      }

      const entered = handleEnterWorkspace({
        prompt,
        themeOverride: skill.themeTarget,
      });

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
    [handleEnterWorkspace, input, recordServiceSkillUsage],
  );

  const handleServiceSkillAutomationSetup = useCallback(
    async (
      skill: ServiceSkillHomeItem,
      slotValues: ServiceSkillSlotValues,
    ) => {
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
            userInput: input.trim() || undefined,
            workspaceId: normalizedProjectId,
          }),
        );
        setPendingServiceSkillAutomation({
          enterWorkspacePayload: {
            prompt,
            themeOverride: skill.themeTarget,
          },
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
        throw new Error("服务型技能入口当前只支持创建新的本地自动化任务");
      }

      setAutomationJobSaving(true);
      try {
        const createdJob = await createAutomationJob(payload.request);
        toast.success(`本地自动化任务已创建：${createdJob.name}`);

        const pendingLaunch = pendingServiceSkillAutomation;
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
        const entered = handleEnterWorkspace(pendingLaunch.enterWorkspacePayload);
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
    [handleEnterWorkspace, pendingServiceSkillAutomation, recordServiceSkillUsage],
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
        enableSubagentPreference(chatToolPreferences);

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
      chatToolPreferences,
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
                  if (sendExecutionStrategy) {
                    setExecutionStrategy(sendExecutionStrategy);
                  }
                  handleEnterWorkspace({
                    prompt: value,
                    images,
                  });
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
                webSearchEnabled={chatToolPreferences.webSearch}
                onWebSearchEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    webSearch: enabled,
                  }))
                }
                thinkingEnabled={chatToolPreferences.thinking}
                onThinkingEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    thinking: enabled,
                  }))
                }
                taskEnabled={chatToolPreferences.task}
                onTaskEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    task: enabled,
                  }))
                }
                subagentEnabled={chatToolPreferences.subagent}
                onSubagentEnabledChange={(enabled) =>
                  setChatToolPreferences((previous) => ({
                    ...previous,
                    subagent: enabled,
                  }))
                }
                selectedTeam={selectedTeam}
                onSelectTeam={handleSelectTeam}
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
                    <>
                      <ServiceSkillHomePanel
                        skills={serviceSkills}
                        catalogMeta={serviceSkillCatalogMeta}
                        loading={serviceSkillsLoading}
                        onSelect={handleServiceSkillSelect}
                        onOpenAutomationJob={handleOpenServiceSkillAutomationJob}
                      />
                      <ClawHomeSolutionsPanel
                        solutions={clawSolutions}
                        loading={clawSolutionsLoading}
                        onSelect={handleClawSolutionSelect}
                      />
                    </>
                  ) : undefined
                }
                characters={projectMemory?.characters || []}
                skills={skills}
                isSkillsLoading={skillsLoading}
                onNavigateToSettings={() => {
                  onNavigate?.("settings", {
                    tab: SettingsTabs.Skills,
                  });
                }}
                onRefreshSkills={handleRefreshSkills}
                onLaunchBrowserAssist={() => {
                  if (activeTheme !== "general") {
                    return;
                  }
                  setBrowserAssistLoading(true);
                  handleEnterWorkspace({
                    prompt: input,
                    openBrowserAssistOnMount: true,
                  });
                }}
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
