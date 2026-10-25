import { describe, expect, it } from "vitest";
import { TEAM_PRIMARY_CHAT_PANEL_WIDTH } from "./WorkspaceStyles";
import { resolveWorkspaceShellChromeRuntime } from "./workspaceShellChromeRuntime";

function baseInput(
  overrides: Partial<
    Parameters<typeof resolveWorkspaceShellChromeRuntime>[0]
  > = {},
): Parameters<typeof resolveWorkspaceShellChromeRuntime>[0] {
  return {
    activeTheme: "general",
    agentEntry: "conversation",
    contextWorkspaceEnabled: false,
    effectiveShowChatPanel: true,
    gateStatus: "idle",
    generalWorkbenchPanelCollapseEnabled: false,
    generalWorkbenchSidebarCollapsed: false,
    hasCanvasWorkbenchContent: false,
    hasDisplayMessages: false,
    hasHomeConversationActivity: false,
    hasPendingA2UIForm: false,
    hideTopBar: false,
    isBootstrapDispatchPending: false,
    isPreparingSend: false,
    isSending: false,
    isTaskCenterDraftSendPending: false,
    isThemeWorkbench: false,
    layoutMode: "chat",
    normalizedInitialSessionId: null,
    queuedTurnCount: 0,
    sessionId: null,
    shouldRenderTaskCenterEmbeddedHome: false,
    shouldSuppressTaskCenterDraftContent: false,
    shouldUseBrowserWorkspaceHomeChrome: false,
    shouldUseCompactGeneralWorkbench: false,
    showSidebar: true,
    subagentsRuntimeVisible: false,
    hasRuntimeSessions: false,
    themeWorkbenchRunState: "idle",
    topBarChrome: "full",
    ...overrides,
  };
}

describe("resolveWorkspaceShellChromeRuntime", () => {
  it("Task Center 首页 surface 激活时应隐藏聊天布局但保留顶部 chrome", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        shouldRenderTaskCenterEmbeddedHome: true,
        shouldUseBrowserWorkspaceHomeChrome: true,
      }),
    );

    expect(runtime.showChatLayout).toBe(false);
    expect(runtime.shouldRenderTopBar).toBe(true);
  });

  it("new-task 首页后台运行旧 session 时不应因为旧消息或发送中状态显示聊天布局", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        agentEntry: "new-task",
        hasDisplayMessages: true,
        hasHomeConversationActivity: false,
        isSending: true,
        queuedTurnCount: 1,
        sessionId: "running-session",
        shouldUseBrowserWorkspaceHomeChrome: true,
      }),
    );

    expect(runtime.showChatLayout).toBe(false);
    expect(runtime.shouldRenderTopBar).toBe(true);
  });

  it("new-task 首页首发 pending preview 尚无 session 时应立即显示聊天布局", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        agentEntry: "new-task",
        hasDisplayMessages: true,
        hasHomeConversationActivity: false,
        isTaskCenterDraftSendPending: true,
        sessionId: null,
        shouldUseBrowserWorkspaceHomeChrome: true,
      }),
    );

    expect(runtime.showChatLayout).toBe(true);
    expect(runtime.shouldRenderTopBar).toBe(true);
  });

  it("claw 首页首发 pending preview 尚无 session 时应立即显示聊天布局", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        agentEntry: "conversation",
        effectiveShowChatPanel: true,
        hasDisplayMessages: true,
        hasHomeConversationActivity: true,
        isTaskCenterDraftSendPending: true,
        sessionId: null,
        shouldUseBrowserWorkspaceHomeChrome: true,
      }),
    );

    expect(runtime.showChatLayout).toBe(true);
    expect(runtime.shouldRenderTopBar).toBe(true);
  });

  it("Subagents runtime 可见时应切换主聊天面板宽度", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        hasCanvasWorkbenchContent: true,
        hasDisplayMessages: true,
        hasRuntimeSessions: true,
        isThemeWorkbench: true,
        layoutMode: "chat-canvas",
        sessionId: "session-1",
        subagentsRuntimeVisible: true,
      }),
    );

    expect(runtime.layoutTransitionChatPanelWidth).toBe(
      TEAM_PRIMARY_CHAT_PANEL_WIDTH,
    );
  });

  it("General Workbench 左侧栏未折叠时显示侧栏并隐藏展开按钮", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        isThemeWorkbench: true,
      }),
    );

    expect(runtime.showGeneralWorkbenchSidebar).toBe(true);
    expect(runtime.showGeneralWorkbenchLeftExpandButton).toBe(false);
  });

  it("General Workbench 左侧栏折叠时隐藏侧栏并显示展开按钮", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        generalWorkbenchPanelCollapseEnabled: true,
        generalWorkbenchSidebarCollapsed: true,
        isThemeWorkbench: true,
      }),
    );

    expect(runtime.showGeneralWorkbenchSidebar).toBe(false);
    expect(runtime.showGeneralWorkbenchLeftExpandButton).toBe(true);
  });

  it("Compact General Workbench 恢复已有会话时保留浮层输入区", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        contextWorkspaceEnabled: true,
        hasDisplayMessages: true,
        isThemeWorkbench: true,
        sessionId: "session-expert-panel",
        shouldUseCompactGeneralWorkbench: true,
        topBarChrome: "workspace-compact",
      }),
    );

    expect(runtime.showChatLayout).toBe(true);
    expect(runtime.shouldHideGeneralWorkbenchInputForTheme).toBe(true);
    expect(runtime.shouldShowGeneralWorkbenchFloatingInputOverlay).toBe(true);
  });

  it("Claw 工作台会话打开右侧面板时仍保留浮层输入区", () => {
    const runtime = resolveWorkspaceShellChromeRuntime(
      baseInput({
        contextWorkspaceEnabled: true,
        hasCanvasWorkbenchContent: true,
        hasDisplayMessages: true,
        isThemeWorkbench: false,
        layoutMode: "chat-canvas",
        sessionId: "session-expert-panel",
        shouldUseCompactGeneralWorkbench: false,
        topBarChrome: "workspace-compact",
      }),
    );

    expect(runtime.showChatLayout).toBe(true);
    expect(runtime.shouldHideGeneralWorkbenchInputForTheme).toBe(false);
    expect(runtime.shouldShowGeneralWorkbenchFloatingInputOverlay).toBe(true);
  });
});
