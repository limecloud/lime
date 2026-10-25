import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

describe("AgentChatWorkspace local display boundary", () => {
  it("旧任务标签和顶部补位已删除，展示注册不能成为第二业务store", () => {
    for (const path of [
      "src/components/agent/chat/components/TaskCenterTabStrip.tsx",
      "src/components/agent/chat/workspace/useTaskCenterTabChrome.tsx",
      "src/components/agent/chat/workspace/taskCenterTabProjection.ts",
      "src/components/agent/chat/workspace/ThreadActivityPanel.tsx",
    ])
      expect(existsSync(join(process.cwd(), path)), path).toBe(false);
    const source = ["WorkspaceMainArea.tsx", "WorkspaceStyles.tsx"]
      .map((path) =>
        readFileSync(
          join(process.cwd(), "src/components/agent/chat/workspace", path),
          "utf8",
        ),
      )
      .join("\n");
    expect(source).not.toMatch(
      /AutoHideNavbar|TASK_CENTER_SPLIT_CHROME_TOP_INSET|shouldDetachTaskCenterToolbar|taskCenterTabsNode/,
    );
    const layoutOwners = [
      "src/components/workspace/layout/LayoutTransition.tsx",
      ...[
        "WorkspaceMainArea.tsx",
        "WorkspaceStyles.tsx",
        "workspaceShellChromeRuntime.ts",
        "useWorkspaceConversationSceneRuntime.tsx",
        "WorkspaceConversationScene.tsx",
      ].map((file) => `src/components/agent/chat/workspace/${file}`),
    ]
      .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
      .join("\n");
    expect(layoutOwners).not.toMatch(
      /\bchatPanelMinWidth\b|layoutTransitionChatPanelMinWidth|CHAT_PANEL_MIN_WIDTH/,
    );
    expect(layoutOwners).not.toMatch(
      /rightSurfaceActivityOpen|onToggleRightSurfaceActivity/,
    );
    const registry = readFileSync(
      join(process.cwd(), "src/components/app-shell/shellRegistry.ts"),
      "utf8",
    );
    expect(registry).not.toMatch(
      /openSurfaces|thread\/|turn\/|localStorage|safeInvoke/,
    );
  });
  it("草稿、恢复、选择、横幅、布局和预览状态必须由 local display owner 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useAgentChatWorkspaceLocalDisplayState.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain(
      "useAgentChatWorkspaceLocalDisplayState({",
    );
    expect(ownerSource.split("\n").length).toBeLessThan(180);
    const retiredInputStore = /\[\s*input\s*,\s*setInput\s*\]\s*=\s*useState/;
    expect(ownerSource).not.toMatch(retiredInputStore);
    expect(workspaceSource).not.toMatch(retiredInputStore);
    for (const localDisplayStateOwner of [
      "useComposerController();",
      "const input = composerSnapshot.document.text;",
      "composerController.setText(",
      "composerController.clear();",
      "useState<InterruptedInputRestoreRequest | null>",
      "const [selectedText, setSelectedText] = useState",
      "const [entryBannerVisible, setEntryBannerVisible] = useState",
      "const [activeTheme, setActiveTheme] = useState",
      "const [layoutMode, setLayoutMode] = useState",
      "const [artifactPreviewSize, setArtifactPreviewSize] = useState",
      "const [canvasWorkbenchLayoutMode, setCanvasWorkbenchLayoutMode] =",
      'logAgentDebug("AgentChatWorkspace", "inputRestoreRequest.received"',
    ]) {
      expect(workspaceSource).not.toContain(localDisplayStateOwner);
      expect(ownerSource).toContain(localDisplayStateOwner);
    }
    for (const forbiddenRuntimeTruth of [
      "queuedTurns",
      "threadRead",
      "pendingActions",
      "submittedActionsInFlight",
      "turn.completed",
      "streamListener",
      "approval",
    ]) {
      expect(ownerSource).not.toContain(forbiddenRuntimeTruth);
    }
  });
});

describe("AgentChatWorkspace home input navigation boundary", () => {
  it("首页首发创建真实 session 后不得同步路由重挂页面", () => {
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceTaskCenterSendRuntime.ts",
      ),
      "utf8",
    );
    const handlerStart = ownerSource.indexOf("const handleSessionAccepted");
    const handlerEnd = ownerSource.indexOf(
      "const handleSendFromEmptyState = useTaskCenterEmptyStateSendRuntime",
      handlerStart,
    );
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);

    const handlerSource = ownerSource.slice(handlerStart, handlerEnd);
    expect(handlerSource).toMatch(
      /upsertTaskCenterOpenTab\(\s*readySessionId,\s*executionScope\?\.workspaceId\s*\?\?\s*options\?\.sendSource\?\.workspaceId\s*\?\?\s*taskCenterWorkspaceId,?\s*\)/,
    );
    expect(handlerSource).toContain(
      "if (options && !isSendSourceCurrent(options, acceptedSessionId)) return",
    );
    expect(handlerSource).toContain(
      "markTaskCenterLocalSessionOverride(readySessionId)",
    );
    expect(handlerSource).toContain("switchToReadySession?.(readySessionId");
    expect(handlerSource).not.toContain(
      "persistMaterializedSessionNavigation(readySessionId)",
    );
  });
});

describe("AgentChatWorkspace plan decision boundary", () => {
  it("Plan decision 状态机必须由 workspace plan decision runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspacePlanDecisionRuntime.tsx",
      ),
      "utf8",
    );
    expect(workspaceSource).toContain("useWorkspacePlanDecisionRuntime({");
    expect(workspaceSource).not.toContain("selectLatestPlanComposerDecision(");
    expect(workspaceSource).not.toContain(
      "filterPlanComposerDecisionFromPendingActions(",
    );
    expect(workspaceSource).not.toContain(
      "selectProposedPlanImplementationDecision(",
    );
    expect(workspaceSource).not.toContain("buildPlanImplementationSubmitPlan(");
    expect(workspaceSource).not.toContain(
      "readPlanImplementationConfirmationKeys(",
    );
    expect(workspaceSource).not.toContain("dismissedLocalPlanRequestIds");
    expect(workspaceSource).not.toContain("submittedLocalPlanRequestIds");
    expect(workspaceSource).not.toContain("<PlanComposerDecisionPanel");
    expect(ownerSource).toContain("selectLatestPlanComposerDecision(");
    expect(ownerSource).toContain(
      "filterPlanComposerDecisionFromPendingActions(",
    );
    expect(ownerSource).toContain("selectProposedPlanImplementationDecision(");
    expect(ownerSource).toContain("buildPlanImplementationSubmitPlan(");
    expect(ownerSource).toContain("readPlanImplementationConfirmationKeys(");
    expect(ownerSource).toContain("dismissedLocalPlanRequestIds");
    expect(ownerSource).toContain("submittedLocalPlanRequestIds");
    expect(ownerSource).toContain("<PlanComposerDecisionPanel");
  });
});

describe("AgentChatWorkspace task center draft state boundary", () => {
  it("Task Center draft state 和 initial navigation 派生必须由 draft state runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const commandWiringSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandWiring.ts",
      ),
      "utf8",
    );
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceTaskCenterDraftStateRuntime.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain("useAgentChatWorkspaceCommandWiring({");
    expect(workspaceSource).not.toContain(
      "useWorkspaceTaskCenterDraftStateRuntime({",
    );
    expect(commandWiringSource).toContain(
      "useWorkspaceTaskCenterDraftStateRuntime(",
    );
    expect(workspaceSource).not.toContain("const [taskCenterDraftSendRequest");
    expect(workspaceSource).not.toContain("const [homePendingPreviewRequest");
    expect(workspaceSource).not.toContain(
      "const taskCenterHomeSurfaceActiveRef = useRef",
    );
    expect(workspaceSource).not.toContain("const [taskCenterDraftTabs");
    expect(workspaceSource).not.toContain("const [activeTaskCenterDraftTabId");
    expect(workspaceSource).not.toContain(
      "shouldPauseTaskCenterInitialSessionNavigation({",
    );
    expect(workspaceSource).not.toContain(
      "const hasTaskCenterHomeHotpathPending = Boolean(",
    );
    expect(ownerSource).toContain("const [taskCenterDraftSendRequest");
    expect(ownerSource).toContain("const [homePendingPreviewRequest");
    expect(ownerSource).toContain(
      "const taskCenterHomeSurfaceActiveRef = useRef",
    );
    expect(ownerSource).not.toContain("const [taskCenterDraftTabs");
    expect(ownerSource).not.toContain("const [activeTaskCenterDraftTabId");
    expect(ownerSource).toContain(
      "shouldPauseTaskCenterInitialSessionNavigation({",
    );
    expect(ownerSource).toContain(
      "const hasTaskCenterHomeHotpathPending = Boolean(",
    );
  });
});

describe("AgentChatWorkspace general workbench sidebar boundary", () => {
  it("General Workbench sidebar runtime 和 host action 必须由 sidebar host runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceGeneralWorkbenchSidebarHostRuntime.tsx",
      ),
      "utf8",
    );
    const compositionSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceRightSurfaceCompositionRuntime.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain(
      "useWorkspaceGeneralWorkbenchSidebarHostRuntime({",
    );
    expect(workspaceSource).not.toContain(
      "useWorkspaceGeneralWorkbenchSidebarRuntime({",
    );
    expect(workspaceSource).not.toContain(
      "renderWorkspaceGeneralWorkbenchSidebarRuntime({",
    );
    expect(workspaceSource).not.toContain(
      "const handleSubmitCodeFixPrompt = useCallback",
    );
    expect(workspaceSource).not.toContain(
      "const handleCollapseGeneralWorkbenchSidebar = useCallback",
    );
    expect(workspaceSource).not.toContain(
      "const handleDeleteGeneralWorkbenchVersion",
    );
    expect(workspaceSource).not.toContain(
      "const generalWorkbenchSidebarNode = renderGeneralWorkbenchSidebarNode({\n    contextWorkspace:",
    );
    expect(workspaceSource).not.toContain(
      "onToggleHarnessPanel: handleToggleRightSurfaceHarness",
    );
    expect(workspaceSource).toContain("renderGeneralWorkbenchSidebarNode,");
    expect(compositionSource).toContain(
      "generalWorkbenchSidebarNode: renderGeneralWorkbenchSidebarNode({",
    );
    expect(ownerSource).toContain(
      "useWorkspaceGeneralWorkbenchSidebarRuntime({",
    );
    expect(ownerSource).toContain(
      "renderWorkspaceGeneralWorkbenchSidebarRuntime({",
    );
    expect(ownerSource).toContain(
      'rightSurfaceChrome: Pick<\n    WorkspaceConversationRightSurfaceChromeRuntime,\n    "harnessPanelVisible" | "onToggleHarnessPanel"',
    );
    expect(ownerSource).toContain("generalWorkbenchHarnessSummary,");
    expect(ownerSource).toContain("onToggleHarnessPanel:");
    expect(ownerSource).toContain(
      "const handleSubmitCodeFixPrompt = useCallback",
    );
    expect(ownerSource).toContain(
      "const handleCollapseGeneralWorkbenchSidebar = useCallback",
    );
    expect(ownerSource).toContain("const handleDeleteGeneralWorkbenchVersion");
  });
});

describe("AgentChatWorkspace general workbench harness surface boundary", () => {
  it("General Workbench Harness Surface props 必须由 harness surface runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceGeneralWorkbenchHarnessSurfaceRuntime.ts",
      ),
      "utf8",
    );
    const inputbarSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx",
      ),
      "utf8",
    );
    const inputbarCallStart = workspaceSource.indexOf(
      "useWorkspaceInputbarSceneRuntime({",
    );
    const inputbarCallEnd = workspaceSource.indexOf(
      "const canvasScene = useWorkspaceCanvasSceneRuntime({",
      inputbarCallStart,
    );
    expect(inputbarCallStart).toBeGreaterThanOrEqual(0);
    expect(inputbarCallEnd).toBeGreaterThan(inputbarCallStart);
    const inputbarCallSource = workspaceSource.slice(
      inputbarCallStart,
      inputbarCallEnd,
    );
    const inputbarParamsStart = inputbarSource.indexOf(
      "interface UseWorkspaceInputbarSceneRuntimeParams",
    );
    const inputbarParamsEnd = inputbarSource.indexOf(
      "export function useWorkspaceInputbarSceneRuntime",
      inputbarParamsStart,
    );
    expect(inputbarParamsStart).toBeGreaterThanOrEqual(0);
    expect(inputbarParamsEnd).toBeGreaterThan(inputbarParamsStart);
    const inputbarParamsSource = inputbarSource.slice(
      inputbarParamsStart,
      inputbarParamsEnd,
    );
    const inputbarDestructuringStart = inputbarSource.indexOf(
      "export function useWorkspaceInputbarSceneRuntime({",
    );
    const inputbarDestructuringEnd = inputbarSource.indexOf(
      "}: UseWorkspaceInputbarSceneRuntimeParams)",
      inputbarDestructuringStart,
    );
    expect(inputbarDestructuringStart).toBeGreaterThanOrEqual(0);
    expect(inputbarDestructuringEnd).toBeGreaterThan(
      inputbarDestructuringStart,
    );
    const inputbarDestructuringSource = inputbarSource.slice(
      inputbarDestructuringStart,
      inputbarDestructuringEnd,
    );

    expect(workspaceSource).toContain(
      "useWorkspaceGeneralWorkbenchHarnessSurfaceRuntime({",
    );
    expect(workspaceSource).not.toContain(
      "const generalWorkbenchHarnessPanelBaseProps = {",
    );
    expect(workspaceSource).not.toContain(
      "ComponentProps<typeof GeneralWorkbenchHarnessSurfaceSection>",
    );
    expect(ownerSource).toContain(
      "environment: contextHarnessRuntime.harnessEnvironment",
    );
    expect(ownerSource).toContain(
      "toolInventory: harnessInventoryRuntime.toolInventory",
    );
    for (const retiredPluginMcpSurface of [
      "plugin_mcp_targets",
      "onPrepareMcpTargets",
      "prepareMcpTargets",
    ]) {
      expect(ownerSource).not.toContain(retiredPluginMcpSurface);
    }
    expect(ownerSource).toContain("onSubmitCodeFixPrompt");
    expect(ownerSource).toContain("onReplayPendingRequest");
    expect(ownerSource).toContain("threadGoal");
    for (const retiredObjectiveSurface of [
      "onObjectiveChanged",
      "threadRead.managed_objective",
      "objectiveClient",
      "ManagedObjectivePanel",
    ]) {
      expect(ownerSource).not.toContain(retiredObjectiveSurface);
    }
    expect(inputbarCallSource).toContain(
      "generalWorkbenchHarnessPanelBaseProps,",
    );
    expect(inputbarCallSource).not.toContain("harnessEnvironment:");
    expect(inputbarCallSource).not.toContain("toolInventory:");
    expect(inputbarCallSource).not.toContain("pendingActions:");
    expect(inputbarCallSource).not.toContain("threadRead,");
    expect(inputbarCallSource).not.toContain("messages:");
    expect(inputbarCallSource).not.toContain("queuedTurns,");
    expect(inputbarCallSource).not.toContain("selectedTeam,");
    expect(inputbarSource).toContain(
      "...generalWorkbenchHarnessPanelBaseProps",
    );
    expect(inputbarSource).toContain(
      "generalWorkbenchHarnessPanelBaseProps.toolInventory",
    );
    expect(inputbarSource).toContain(
      "generalWorkbenchHarnessPanelBaseProps.pendingActions",
    );
    expect(inputbarSource).not.toContain("environment: harnessEnvironment");
    for (const retiredInputbarParam of [
      "harnessEnvironment",
      "toolInventory",
      "pendingActions",
      "threadRead",
      "messages",
      "queuedTurns",
      "selectedTeam",
      "handleHarnessLoadFilePreview",
      "handleFileClick",
      "handleOpenSubagentSession",
    ]) {
      expect(inputbarParamsSource).not.toContain(retiredInputbarParam);
      expect(inputbarDestructuringSource).not.toContain(retiredInputbarParam);
    }
  });
});

describe("AgentChatWorkspace retired message knowledge save boundary", () => {
  it("消息与文件产物不得恢复独立知识保存入口或 fallback import", () => {
    for (const ownerPath of [
      "src/components/agent/chat/workspace/useWorkspaceMessageKnowledgeSaveRuntime.ts",
      "src/components/agent/chat/workspace/knowledge/knowledgeSaveNavigation.ts",
      "src/components/agent/chat/components/messageListKnowledgeSource.ts",
      "src/features/knowledge/import/knowledgeSourceImport.ts",
      "src/features/knowledge/import/knowledgeSourceSupport.ts",
    ]) {
      expect(existsSync(join(process.cwd(), ownerPath)), ownerPath).toBe(false);
    }
    const surfaceSource = [
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
      "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx",
      "src/components/agent/chat/components/MessageList.types.ts",
      "src/components/agent/chat/components/MessageActionButtons.tsx",
      "src/components/agent/chat/components/MessageArtifactCards.tsx",
      "src/components/agent/chat/components/AgentThreadTimelineArtifactCard.tsx",
      "src/components/agent/chat/components/messageListItemProjectionArtifacts.ts",
      "src/components/agent/chat/components/artifactFrameRegistry.ts",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    expect(surfaceSource).not.toMatch(
      /onSaveMessageAsKnowledge|onSaveFileArtifactAsKnowledge|onImportTextAsKnowledge|canSaveMessageAsKnowledge|knowledgeArtifactSource/,
    );
    expect(existsSync(join(process.cwd(), "src/features/knowledge"))).toBe(
      false,
    );
    const pageParams = readFileSync(
      join(process.cwd(), "src/types/page.ts"),
      "utf8",
    );

    expect(pageParams).not.toContain("saveDraft");
  });
});

describe("AgentChatWorkspace general workbench entry prompt actions boundary", () => {
  it("General Workbench entry prompt 的继续、重启和 follow-up 应用必须由 entry prompt actions runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceGeneralWorkbenchEntryPromptActionsRuntime.ts",
      ),
      "utf8",
    );
    const compositionSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceWorkbenchActionSurfaceRuntime.ts",
      ),
      "utf8",
    );
    const commandWiringSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandWiring.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain("useAgentChatWorkspaceCommandWiring({");
    expect(workspaceSource).not.toContain(
      "useWorkspaceWorkbenchActionSurfaceRuntime({",
    );
    expect(commandWiringSource).toContain(
      "useWorkspaceWorkbenchActionSurfaceRuntime({",
    );
    expect(compositionSource).toContain(
      "useWorkspaceGeneralWorkbenchEntryPromptActionsRuntime(",
    );
    expect(ownerSource.split("\n").length).toBeLessThan(180);
    for (const retiredWorkspaceEntryPromptOwner of [
      "const handleContinueGeneralWorkbenchEntryPrompt = useCallback",
      "const applyWorkbenchFollowUpActionPayload = useCallback",
      "const handleRestartGeneralWorkbenchEntryPrompt = useCallback",
      "buildRuntimeInitialInputCapabilityFromFollowUpAction({",
      "dismissGeneralWorkbenchEntryPrompt({",
      "请先补充要继续执行的内容",
    ]) {
      expect(workspaceSource).not.toContain(retiredWorkspaceEntryPromptOwner);
      expect(ownerSource).toContain(retiredWorkspaceEntryPromptOwner);
    }
  });
});

describe("AgentChatWorkspace expert skill panel runtime boundary", () => {
  it("专家技能、Workspace Skill enable 和插件建议运行态必须由 expert skill panel runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceExpertSkillPanelRuntime.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain("useWorkspaceExpertSkillPanelRuntime({");
    expect(ownerSource.split("\n").length).toBeLessThan(240);
    for (const retiredExpertSkillPanelOwner of [
      "threadExpertRequestMetadataOverride",
      "setThreadExpertRequestMetadataOverride",
      "resolveSessionExpertRequestMetadata(",
      "resolveExpertPanelRequestMetadata({",
      "useExpertWorkspaceSkillRuntime({",
      "useWorkspaceExpertAgentLaunchSyncRuntime({",
      "resolveWorkspaceRequestMetadataWithExpertSkills({",
      "useWorkspacePluginCatalogSuggestions({",
    ]) {
      expect(workspaceSource).not.toContain(retiredExpertSkillPanelOwner);
      expect(ownerSource).toContain(retiredExpertSkillPanelOwner);
    }
  });
});

describe("Workspace Inputbar scene presentation boundary", () => {
  it("Inputbar scene 的 UI presentation 必须由 presentation runtime 提供", () => {
    const inputbarSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceInputbarSceneRuntime.tsx",
      ),
      "utf8",
    );
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceInputbarScenePresentationRuntime.tsx",
      ),
      "utf8",
    );

    expect(inputbarSource).toContain(
      "useWorkspaceInputbarScenePresentationRuntime({",
    );
    expect(inputbarSource.split("\n").length).toBeLessThan(800);
    expect(ownerSource.split("\n").length).toBeLessThan(800);
    for (const retiredPresentationOwner of [
      "styled.",
      "renderGeneralWorkbenchEntryPromptAccessory",
      "InputbarControlReplacement",
      "<GeneralWorkbenchDialogSection",
      "resolveCanvasTaskFileTarget(",
      "isRenderableTaskFile(",
    ]) {
      expect(inputbarSource).not.toContain(retiredPresentationOwner);
      expect(ownerSource).toContain(retiredPresentationOwner);
    }
    expect(inputbarSource).not.toMatch(/<Inputbar\s/u);
    expect(ownerSource).toMatch(/<Inputbar\s/u);
  });
});

describe("AgentChatWorkspace shell chrome boundary", () => {
  it("Shell chrome projection 必须由 workspace shell chrome runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceShellChromeRuntime.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain("useWorkspaceShellChromeRuntime({");
    expect(workspaceSource).not.toContain(
      "resolveWorkspaceShellChromeRuntime({",
    );
    expect(workspaceSource).not.toContain(
      "const shellChromeRuntime = useMemo(() =>",
    );
    expect(ownerSource).toContain("resolveWorkspaceShellChromeRuntime({");
    expect(ownerSource).toContain("return useMemo(");
    expect(ownerSource).toContain("queuedTurnCount");
    expect(ownerSource).toContain("topBarChrome");
  });
});

describe("AgentChatWorkspace service skill execution card boundary", () => {
  it("已删除的站点技能执行卡片 owner 不得回流", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    for (const deletedOwnerPath of [
      "src/components/agent/chat/workspace/ServiceSkillExecutionCard.tsx",
      "src/components/agent/chat/workspace/useWorkspaceServiceSkillExecutionCardRuntime.tsx",
    ]) {
      expect(existsSync(join(process.cwd(), deletedOwnerPath))).toBe(false);
    }
    expect(workspaceSource).not.toContain("ServiceSkillExecutionCard");
    expect(workspaceSource).not.toContain(
      "useWorkspaceServiceSkillExecutionCardRuntime(",
    );
  });
});

describe("AgentChatWorkspace conversation landing surface boundary", () => {
  it("入口 landing / EmptyState 组装必须由 conversation landing surface runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const conversationRuntimeSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceConversationSceneRuntime.tsx",
      ),
      "utf8",
    );
    const messageListOwnerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceConversationMessageListRuntime.ts",
      ),
      "utf8",
    );
    const sceneSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/WorkspaceConversationScene.tsx",
      ),
      "utf8",
    );
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceConversationLandingSurfaceRuntime.tsx",
      ),
      "utf8",
    );
    const compositionOwnerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceConversationCompositionRuntime.ts",
      ),
      "utf8",
    );
    const sceneCompositionSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneComposition.tsx",
      ),
      "utf8",
    );
    const compositionCallStart = workspaceSource.indexOf(
      "useAgentChatWorkspaceSceneComposition({",
    );
    const landingCallStart = workspaceSource.indexOf(
      "landing: {",
      compositionCallStart,
    );
    const landingCallEnd = workspaceSource.indexOf(
      "messageList: {",
      landingCallStart,
    );
    const sceneCallStart = workspaceSource.indexOf("scene: {", landingCallEnd);
    const sceneCallEnd = workspaceSource.indexOf(
      "\n    shell:",
      sceneCallStart,
    );
    expect(compositionCallStart).toBeGreaterThanOrEqual(0);
    expect(landingCallStart).toBeGreaterThanOrEqual(0);
    expect(landingCallEnd).toBeGreaterThan(landingCallStart);
    expect(sceneCallStart).toBeGreaterThanOrEqual(0);
    expect(sceneCallEnd).toBeGreaterThan(sceneCallStart);
    const landingCallSource = workspaceSource.slice(
      landingCallStart,
      landingCallEnd,
    );
    const sceneCallSource = workspaceSource.slice(sceneCallStart, sceneCallEnd);

    expect(landingCallSource).not.toContain("inputbarScene,");
    for (const retiredInputbarLandingParam of [
      "onImportPathReferenceAsKnowledge:",
      "onManageKnowledgePacks:",
      "onSelectKnowledgePack:",
      "onStartKnowledgeOrganize:",
      "onToggleKnowledgeCompanionPack:",
      "onToggleKnowledgePack:",
      "runtimeToolAvailability:",
      "knowledgePackOptions:",
      "knowledgePackSelection:",
    ]) {
      expect(landingCallSource).not.toContain(retiredInputbarLandingParam);
    }
    expect(workspaceSource).not.toContain(
      "useWorkspaceConversationLandingSurfaceRuntime(",
    );
    expect(sceneCompositionSource).toContain(
      "useWorkspaceConversationCompositionRuntime({",
    );
    expect(compositionOwnerSource).toContain(
      "useWorkspaceConversationLandingSurfaceRuntime(",
    );
    expect(compositionOwnerSource).toContain("landingSurface,");
    expect(workspaceSource).not.toContain(
      "useWorkspaceConversationMessageListRuntime({",
    );
    expect(compositionOwnerSource).toContain(
      "useWorkspaceConversationMessageListRuntime(",
    );
    expect(compositionOwnerSource).toContain("messageListRuntime,");
    expect(sceneCallSource).not.toContain("messageListRuntime:");
    expect(messageListOwnerSource).toContain(
      "WorkspaceConversationMessageListRuntime",
    );
    expect(messageListOwnerSource).toContain("onRefreshSessionReadModel:");
    for (const retiredMessageListSceneParam of [
      "\n    messageListEmptyStateVariant:",
      "\n    displayMessages:",
      "\n    effectiveThreadItems:",
      "\n    currentTurnId:",
      "\n    threadRead:",
      "\n    executionRuntime:",
      "\n    pendingActions:",
      "\n    submittedActionsInFlight:",
      "\n    queuedTurns:",
      "\n    sessionHistoryWindow,",
      "\n    loadFullSessionHistory:",
      "\n    stopSending,",
      "\n    resumeThread,",
      "\n    replayPendingAction,",
      "\n    deleteMessage,",
      "\n    editMessage,",
      "\n    handleA2UISubmit:",
      "\n    handleWriteFile,",
      "\n    handleFileClick:",
      "\n    handleArtifactClick:",
      "\n    handleOpenSubagentSession,",
      "\n    handlePermissionResponse,",
      "\n    shouldCollapseCodeBlocks,",
      "\n    shouldCollapseCodeBlockInChat,",
      "\n    handleCodeBlockClick,",
    ]) {
      expect(sceneCallSource).not.toContain(retiredMessageListSceneParam);
    }
    expect(conversationRuntimeSource).toContain(
      "interface WorkspaceConversationMessageListRuntime",
    );
    expect(conversationRuntimeSource).toContain(
      "messageListRuntime: WorkspaceConversationMessageListRuntime;",
    );
    expect(conversationRuntimeSource).not.toContain(
      "DEFAULT_WORKSPACE_CONVERSATION_MESSAGE_LIST_RUNTIME",
    );
    for (const retiredSceneParam of [
      "entryBannerVisible,",
      "entryBannerMessage:",
      "creationReplaySurface:",
      "defaultCuratedTaskReferenceMemoryIds,",
      "pathReferences,",
      "inputRestoreRequest,",
      "fileManagerOpen:",
      "pluginHistoryRestoreLandingCard:",
      "serviceSkillExecutionCard,",
      "chatToolPreferences:",
      "setChatToolPreferences,",
    ]) {
      expect(sceneCallSource).not.toContain(retiredSceneParam);
    }
    expect(conversationRuntimeSource).toContain("landingSurface:");
    expect(conversationRuntimeSource).not.toContain(
      "useWorkspaceConversationLandingSessionRuntime({",
    );
    expect(conversationRuntimeSource).not.toContain(
      "buildWorkspaceEmptyStateProps({",
    );
    expect(conversationRuntimeSource).not.toContain(
      "buildAgentTaskRuntimeCardModel({",
    );
    expect(conversationRuntimeSource).not.toContain(
      "...landingSurface.emptyStateProps",
    );
    expect(conversationRuntimeSource).not.toContain(
      "const landingSurfaceWithSceneRuntime",
    );
    expect(sceneSource).toContain("landingSurface.emptyStateProps");
    expect(sceneSource).not.toContain("buildWorkspaceEmptyStateProps({");
    expect(ownerSource).toContain("buildWorkspaceEmptyStateProps({");
    for (const retiredLandingState of [
      "buildAgentTaskRuntimeCardModel({",
      "...landingSurface.emptyStateProps",
      "suppressRecentSessionRecovery",
      "useWorkspaceConversationLandingSessionRuntime",
    ]) {
      expect(ownerSource).not.toContain(retiredLandingState);
    }
  });
});

describe("AgentChatWorkspace artifact open boundary", () => {
  it("Artifact / 文件预览动作必须由 artifact open runtime 提供", () => {
    const workspaceSource = [
      "src/components/agent/chat/useAgentChatWorkspaceRuntime.tsx",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceEntryRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSetupRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceCommandRuntime.ts",
      "src/components/agent/chat/workspace/useAgentChatWorkspaceSceneRuntime.tsx",
    ]
      .map((ownerPath) => readFileSync(join(process.cwd(), ownerPath), "utf8"))
      .join("\n");
    const actionOwnerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceArtifactActionRuntime.ts",
      ),
      "utf8",
    );
    const ownerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceArtifactOpenRuntime.tsx",
      ),
      "utf8",
    );
    const documentSaveOwnerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceArtifactDocumentSaveRuntime.ts",
      ),
      "utf8",
    );
    const serviceSkillOwnerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useWorkspaceServiceSkillResultFileRuntime.ts",
      ),
      "utf8",
    );
    const interactionOwnerSource = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/workspace/useAgentChatWorkspaceArtifactInteractionRuntime.ts",
      ),
      "utf8",
    );

    expect(workspaceSource).toContain(
      "useAgentChatWorkspaceArtifactInteractionRuntime({",
    );
    expect(workspaceSource).not.toContain(
      "useWorkspaceArtifactActionRuntime({",
    );
    expect(interactionOwnerSource).toContain(
      "useWorkspaceArtifactActionRuntime(action)",
    );
    expect(workspaceSource).not.toContain("useWorkspaceArtifactOpenRuntime({");
    expect(actionOwnerSource).toContain("useWorkspaceArtifactOpenRuntime({");
    expect(ownerSource.split("\n").length).toBeLessThan(800);
    expect(documentSaveOwnerSource.split("\n").length).toBeLessThan(200);
    expect(serviceSkillOwnerSource.split("\n").length).toBeLessThan(200);
    for (const retiredWorkspaceArtifactOwner of [
      "useWorkspaceArtifactPreviewActions({",
      "useWorkspaceArtifactWorkbenchActions({",
      "useWorkspaceMediaReferencePreviewRuntime({",
      "useWorkspaceRightSurfaceArtifactOpenRuntime({",
      "const handleSaveArtifactDocument = useCallback",
      "const handleWorkspaceFileClick = useCallback",
      "const openProjectFilePreviewInCanvas = useCallback",
      "const handleOpenSavedSiteContent = useCallback",
      "const openMessageAttachmentPreview = useCallback",
      "const renderArtifactWorkbenchToolbarActions = useCallback",
      "const handleOpenMessagePreview = useCallback",
      "const handleOpenArtifactFromTimeline = useCallback",
      "const handleOpenServiceSkillResultFile = useCallback",
      "handledInitialProjectFileOpenSignatureRef",
      "resolveSiteSavedContentTargetFromRunResult(",
    ]) {
      expect(workspaceSource).not.toContain(retiredWorkspaceArtifactOwner);
      expect(interactionOwnerSource).not.toContain(
        retiredWorkspaceArtifactOwner,
      );
    }
    expect(ownerSource).toContain("useWorkspaceArtifactPreviewActions({");
    expect(ownerSource).toContain("useWorkspaceArtifactWorkbenchActions({");
    expect(ownerSource).toContain("useWorkspaceMediaReferencePreviewRuntime({");
    expect(ownerSource).toContain(
      "useWorkspaceRightSurfaceArtifactOpenRuntime({",
    );
    expect(ownerSource).toContain("useWorkspaceArtifactDocumentSaveRuntime({");
    expect(ownerSource).toContain(
      "useWorkspaceServiceSkillResultFileRuntime({",
    );
    expect(documentSaveOwnerSource).toContain(
      "saveAgentRuntimeArtifactDocumentSnapshot(",
    );
    expect(serviceSkillOwnerSource).toContain(
      "resolvePreferredServiceSkillResultFileTarget({",
    );
  });
});
