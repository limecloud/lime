import { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { toast } from "sonner";
import { prepareClawSolution } from "@/lib/api/clawSolutions";
import type { Page, PageParams } from "@/types/page";
import { SettingsTabs } from "@/types/settings";
import type { ThemeType } from "@/components/content-creator/types";
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
import {
  type AgentChatWorkspaceBootstrap,
  resolveHomeShellWorkspaceEntry,
  type HomeShellEnterWorkspacePayload,
} from "./homeShellEntry";

const SUPPORTED_ENTRY_THEMES: ThemeType[] = [
  "general",
  "social-media",
  "poster",
  "music",
  "knowledge",
  "planning",
  "document",
  "video",
  "novel",
];

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

function normalizeInitialTheme(value?: string): ThemeType {
  if (!value) return "general";
  if (SUPPORTED_ENTRY_THEMES.includes(value as ThemeType)) {
    return value as ThemeType;
  }
  return "general";
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
                    <ClawHomeSolutionsPanel
                      solutions={clawSolutions}
                      loading={clawSolutionsLoading}
                      onSelect={handleClawSolutionSelect}
                    />
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
            </ChatContainerInner>
          </ChatContainer>
        </ThemeWorkbenchLayoutShell>
      </MainArea>
    </PageContainer>
  );
}
