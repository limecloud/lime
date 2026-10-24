import { AppShell, AppShellHeader } from "@/components/app-shell/AppShell";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceConversationScene } from "./WorkspaceConversationScene";
import { ComposerController, ComposerEditor } from "@/components/input-kit";
import { getComposerEditorText } from "@/components/input-kit/composerEditor.testUtils";

const {
  mockChatNavbar,
  mockThreadProjectSelector,
  mockWorkspaceMainArea,
  mockWorkspacePendingA2UIPanel,
  mockMessageList,
  mockTaskCenterUtilityToolbar,
} = vi.hoisted(() => ({
  mockChatNavbar: vi.fn(),
  mockThreadProjectSelector: vi.fn(),
  mockWorkspaceMainArea: vi.fn(),
  mockWorkspacePendingA2UIPanel: vi.fn(),
  mockMessageList: vi.fn(),
  mockTaskCenterUtilityToolbar: vi.fn(),
}));

vi.mock("../components/CanvasWorkbenchLayout", () => ({
  CanvasWorkbenchLayout: (props: { topRightTools?: React.ReactNode }) => (
    <div data-testid="canvas-layout-stub">
      {props.topRightTools ? (
        <div data-testid="canvas-layout-top-right-tools">
          {props.topRightTools}
        </div>
      ) : null}
    </div>
  ),
}));

vi.mock("../components/ChatNavbar", () => ({
  ChatNavbar: (props: Record<string, unknown>) => {
    mockChatNavbar(props);
    return <div data-testid="chat-navbar-stub" />;
  },
}));

vi.mock("../components/ThreadProjectSelector", () => ({
  ThreadProjectSelector: (props: Record<string, unknown>) => {
    mockThreadProjectSelector(props);
    return props.threadId ? (
      <div data-testid="thread-project-selector" />
    ) : null;
  },
}));

vi.mock("../components/TaskCenterUtilityToolbar", () => ({
  TaskCenterUtilityToolbar: (props: {
    placement?: string;
    sidePanelLauncher?: React.ReactNode;
  }) => {
    mockTaskCenterUtilityToolbar(props);
    return (
      <div data-testid="task-center-utility-toolbar-stub">
        {props.sidePanelLauncher}
      </div>
    );
  },
}));

vi.mock("../components/EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state-stub" />,
}));

vi.mock("../components/MessageList", () => ({
  MessageList: (props: {
    leadingContent?: React.ReactNode;
    trailingContent?: React.ReactNode;
  }) => {
    mockMessageList(props);
    const { leadingContent, trailingContent } = props;
    return (
      <div data-testid="message-list-stub">
        {leadingContent}
        {trailingContent}
      </div>
    );
  },
}));

vi.mock("./WorkspacePendingA2UIPanel", () => ({
  WorkspacePendingA2UIPanel: (props: {
    pendingA2UIForm?: { id?: string } | null;
    placement?: string;
  }) => {
    mockWorkspacePendingA2UIPanel(props);
    return (
      <div
        data-testid="workspace-pending-a2ui-panel"
        data-placement={props.placement || "dock"}
      >
        {props.pendingA2UIForm?.id || ""}
      </div>
    );
  },
}));

vi.mock("./WorkspaceMainArea", () => ({
  WorkspaceMainArea: ({
    navbarNode,
    taskCenterShellPanelNode,
    mainToolbar,
    chatContent,
    canvasContent,
    rightSurfaceContent,
    ...rest
  }: {
    navbarNode?: React.ReactNode;
    taskCenterShellPanelNode?: React.ReactNode;
    mainToolbar?: React.ReactNode;
    chatContent?: React.ReactNode;
    canvasContent?: React.ReactNode;
    rightSurfaceContent?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <div
      data-testid="workspace-main-area-stub"
      ref={() => {
        mockWorkspaceMainArea({
          mainToolbar,
          taskCenterShellPanelNode,
          chatContent,
          canvasContent,
          rightSurfaceContent,
          ...rest,
        });
      }}
    >
      {navbarNode}
      {mainToolbar}
      {chatContent}
      {canvasContent}
      {rightSurfaceContent}
      {taskCenterShellPanelNode}
    </div>
  ),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function importedThreadItems() {
  return [
    {
      id: "imported-command",
      type: "command_execution",
      thread_id: "thread-1",
      turn_id: "turn-1",
      sequence: 1,
      status: "completed",
      command: "npm test",
      cwd: "/workspace/imported-local-history",
      metadata: {
        source_client: "external-history",
        source_provenance: {
          sourceClient: "external-history",
          sourceThreadId: "thread-imported-20260617abcdef",
        },
        importFidelity: {
          messages: 6,
          reasoning: 2,
          commands: 1,
          tools: 4,
          patches: 1,
          approvals: 1,
          webSearch: 1,
        },
      },
      started_at: "2026-06-17T10:00:00.000Z",
      completed_at: "2026-06-17T10:00:01.000Z",
      updated_at: "2026-06-17T10:00:01.000Z",
    },
  ];
}

type RenderSceneProps = Partial<
  React.ComponentProps<typeof WorkspaceConversationScene>
> &
  Record<string, unknown>;

function renderScene(props?: RenderSceneProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const propsRecord = (props || {}) as Record<string, unknown>;
  const defaultLandingSurface = {
    entryBannerVisible: Boolean(propsRecord.entryBannerVisible),
    entryBannerMessage: propsRecord.entryBannerMessage as string | undefined,
    onDismissEntryBanner:
      (propsRecord.onDismissEntryBanner as (() => void) | undefined) ?? vi.fn(),
    creationReplaySurface:
      propsRecord.creationReplaySurface === undefined
        ? null
        : (propsRecord.creationReplaySurface as never),
    serviceSkillExecutionCard:
      propsRecord.serviceSkillExecutionCard as React.ReactNode,
    emptyStateProps: {} as never,
  };

  const defaultProps: React.ComponentProps<typeof WorkspaceConversationScene> =
    {
      landingSurface: defaultLandingSurface,
      showChatLayout: true,
      compactChrome: false,
      contextWorkspaceEnabled: false,
      messageListProps: {
        messages: [],
        turns: [],
        threadItems: [],
        currentTurnId: null,
        threadRead: false,
        pendingActions: [],
        submittedActionsInFlight: [],
        isSending: false,
        onInterruptCurrentTurn: vi.fn(),
      } as any,
      workspaceAlertVisible: false,
      onSelectWorkspaceDirectory: vi.fn(),
      onDismissWorkspaceAlert: vi.fn(),
      shouldHideGeneralWorkbenchInputForTheme: false,
      inputbarNode: null,
      input: "",
      setInput: vi.fn(),
      onSendMessage: vi.fn(),
      emptyStateIsLoading: false,
      emptyStateDisabled: false,
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
      executionStrategy: "react",
      setExecutionStrategy: vi.fn(),
      accessMode: "default" as any,
      setAccessMode: vi.fn(),
      onManageProviders: vi.fn(),
      toolPreferences: {
        task: false,
        subagent: false,
      },
      onToolPreferenceChange: vi.fn(),
      activeTheme: "general",
      onThemeChange: vi.fn(),
      themeLocked: false,
      artifactsCount: 0,
      generalCanvasContent: "",
      resolvedCanvasState: null,
      selectedText: "",
      characters: [],
      skills: [],
      serviceSkills: [],
      serviceSkillGroups: [],
      isSkillsLoading: false,
      onSelectServiceSkill: vi.fn(),
      onNavigateToSettings: vi.fn(),
      onRefreshSkills: vi.fn(),
      onLaunchBrowserAssist: vi.fn(),
      projectId: null,
      onProjectChange: vi.fn(),
      onOpenSettings: vi.fn(),
      runtimeToolAvailability: null,
      onOpenChromeRelay: vi.fn(),
      navbarVisible: false,
      isRunning: false,
      navbarChrome: "default" as any,
      onBackToProjectManagement: undefined,
      layoutMode: "chat" as any,
      onToggleCanvas: vi.fn(),
      onBackHome: vi.fn(),
      showHarnessToggle: false,
      harnessPanelVisible: false,
      onToggleHarnessPanel: vi.fn(),
      harnessPendingCount: 0,
      harnessAttentionLevel: "idle" as any,
      harnessToggleLabel: undefined,
      showContextCompactionAction: false,
      contextCompactionRunning: false,
      onCompactContext: vi.fn(),
      isThemeWorkbench: false,
      contentId: undefined,
      syncStatus: "idle",
      hasLiveCanvasPreviewContent: false,
      liveCanvasPreview: null,
      currentImageWorkbenchActive: false,
      shouldShowCanvasLoadingState: false,
      canvasWorkbenchLayoutProps: {
        artifacts: [],
      } as any,
      shellBottomInset: "0px",
      chatPanelWidth: undefined,
      generalWorkbenchDialog: null,
      showFloatingInputOverlay: false,
      hasPendingA2UIForm: false,
    } as any;

  const sceneProps = {
    ...defaultProps,
    ...props,
    landingSurface: {
      ...defaultLandingSurface,
      ...((props?.landingSurface as Record<string, unknown> | undefined) ?? {}),
    },
  };

  act(() => {
    root.render(
      <AppShell>
        <AppShellHeader />
        <WorkspaceConversationScene {...sceneProps} />
      </AppShell>,
    );
  });

  mountedRoots.push({ root, container });
  return container;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

describe("WorkspaceConversationScene", () => {
  it("空 Thread 应使用可见页头的 canonical identity 渲染 Project 入口", () => {
    const container = renderScene({
      navbarVisible: true,
      navbarContextVariant: "task-center",
      threadHeader: {
        sessionId: "thread-empty",
        title: "空对话",
        workingDirectory: "/workspace/lime",
      },
      projectId: "workspace-1",
      projectRootPath: "/workspace/lime",
      openedProjects: [
        {
          id: "workspace-1",
          name: "Lime",
          rootPath: "/workspace/lime",
        },
      ],
    });

    expect(
      container.querySelector(
        '[data-header-action-id="unified-workspace-controls"] [data-testid="thread-project-selector"]',
      ),
    ).not.toBeNull();
    expect(mockThreadProjectSelector).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: "thread-empty" }),
    );
  });

  it("入口提示条应把长文案和关闭按钮分开渲染", () => {
    const onDismissEntryBanner = vi.fn();
    const container = renderScene({
      entryBannerVisible: true,
      entryBannerMessage: "欢迎回来：继续处理上次的内容并保留当前上下文。",
      onDismissEntryBanner,
    });

    const banner = container.querySelector(
      '[data-testid="workspace-entry-banner"]',
    );
    const bannerText = container.querySelector(
      '[data-testid="workspace-entry-banner-text"]',
    );
    const closeButton = banner?.querySelector<HTMLButtonElement>("button");

    expect(banner).not.toBeNull();
    expect(bannerText?.textContent).toContain("欢迎回来");
    expect(closeButton).not.toBeNull();
    expect(
      [
        "关闭",
        "Close",
        "agentChat.workspaceConversation.entryBanner.close",
      ].includes(closeButton?.textContent || ""),
    ).toBe(true);

    act(() => {
      closeButton?.click();
    });

    expect(onDismissEntryBanner).toHaveBeenCalledTimes(1);
  });

  it("普通导入会话不应在主线消息列表前展示独立导入状态条", () => {
    const container = renderScene({
      messageListProps: {
        messages: [
          {
            id: "imported-user",
            role: "user",
            content: "请帮我修复运行时问题",
            timestamp: new Date("2026-06-17T10:00:00.000Z"),
          },
          {
            id: "imported-assistant",
            role: "assistant",
            content: "已完成修复并补充测试。",
            timestamp: new Date("2026-06-17T10:00:01.000Z"),
          },
        ],
        turns: [],
        threadItems: importedThreadItems(),
        currentTurnId: null,
        threadRead: false,
        pendingActions: [],
        submittedActionsInFlight: [],
        isSending: false,
        onInterruptCurrentTurn: vi.fn(),
      } as any,
    });

    const banner = container.querySelector(
      '[data-testid="imported-source-banner"]',
    );
    expect(
      mockMessageList.mock.calls.some((call) =>
        Boolean(call[0]?.leadingContent),
      ),
    ).toBe(false);
    expect(banner).toBeNull();
    expect(container.textContent).not.toContain("本地历史导入");
    expect(container.textContent).not.toContain("已还原");
    expect(container.textContent).not.toContain("imported_read_only");
    expect(container.textContent).not.toContain("thread-imported");
    expect(container.textContent).not.toContain("npm test");
  });

  it("生成应显示当前带入的灵感横条", () => {
    const container = renderScene({
      creationReplaySurface: {
        kind: "memory_entry",
        eyebrow: "当前带入灵感",
        badgeLabel: "参考",
        title: "品牌风格样本",
        summary: "保留轻盈但专业的表达。",
        hint: "后续结果模板会默认把它一起带入。",
        defaultReferenceMemoryIds: ["memory-1"],
        defaultReferenceEntries: [
          {
            id: "memory-1",
            title: "品牌风格样本",
            summary: "保留轻盈但专业的表达。",
            category: "context",
            categoryLabel: "参考",
            tags: ["品牌", "语气"],
          },
        ],
      },
    });

    expect(container.textContent).toContain("当前带入灵感");
    expect(container.textContent).toContain("品牌风格样本");
    expect(container.textContent).toContain("后续结果模板会默认把它一起带入。");
  });

  it("任务中心场景应固定展示顶部导航，不再传入自动隐藏开关", () => {
    renderScene({
      navbarVisible: true,
      navbarChrome: "workspace-compact",
      navbarContextVariant: "task-center",
    });

    expect(mockWorkspaceMainArea).toHaveBeenCalled();
    expect(
      mockWorkspaceMainArea.mock.calls.at(-1)?.[0]?.autoHideTaskCenterNavbar,
    ).toBeUndefined();
  });

  it("场景把唯一侧边面板入口交给共享页头，旧底部Shell不再占位", () => {
    const toggle = vi.fn();
    const launcher = (
      <button data-testid="side-panel-launcher" onClick={toggle}>
        Open side panel
      </button>
    );
    const container = renderScene({
      navbarContextVariant: "task-center",
      rightSurfaceLauncher: launcher,
    });
    expect(
      mockTaskCenterUtilityToolbar.mock.calls.at(-1)?.[0]?.sidePanelLauncher,
    ).toBe(launcher);
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="side-panel-launcher"]')
        ?.click(),
    );
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="task-center-shell-panel-stub"]'),
    ).toBeNull();
    expect(mockWorkspaceMainArea.mock.calls.at(-1)?.[0]?.shellBottomInset).toBe(
      "0px",
    );
  });

  it.each(["chat", "canvas"] as const)(
    "active Thread 在 %s 布局使用页头工具栏",
    (layoutMode) => {
      const container = renderScene({
        layoutMode,
        navbarVisible: true,
        navbarChrome: "workspace-compact",
        navbarContextVariant: "task-center",
        threadHeader: {
          sessionId: "thread-1",
          title: "对齐 Codex App GUI",
          workingDirectory: "/workspace/lime",
        },
      });

      expect(
        container.querySelector('[data-testid="thread-workspace-header"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[data-testid="thread-workspace-header-title"]')
          ?.textContent,
      ).toBe("对齐 Codex App GUI");
      expect(
        container.querySelector(
          '[data-header-action-id="unified-workspace-controls"] [data-testid="task-center-utility-toolbar-stub"]',
        ),
      ).not.toBeNull();
      expect(
        mockWorkspaceMainArea.mock.calls.at(-1)?.[0]?.mainToolbar,
      ).toBeTruthy();
      expect(
        mockTaskCenterUtilityToolbar.mock.calls.at(-1)?.[0]?.placement,
      ).toBe("workbench-header");
    },
  );

  it("标题栏打开独立Summary并委托同一canonical子线程动作", async () => {
    const onOpenSubagentSession = vi.fn();
    const container = renderScene({
      navbarVisible: true,
      navbarContextVariant: "task-center",
      threadHeader: {
        sessionId: "thread-1",
        title: "当前 Thread",
        workingDirectory: "/workspace/lime",
      },
      messageListProps: {
        onOpenSubagentSession,
        messages: [],
        threadItems: [
          {
            id: "cmd-1",
            type: "command_execution",
            command: "npm test",
            cwd: "/workspace/lime",
          },
        ],
        canonicalChildren: [
          {
            name: "reviewer",
            parentThreadId: "thread-1",
            sessionId: null,
            status: "running",
            taskSummary: "检查补丁",
            threadId: "child-1",
            updatedAtMs: 1,
          },
        ],
      },
    });

    expect(
      document.querySelector('[data-testid="thread-summary-popover"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="thread-workspace-summary-toggle"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="thread-workspace-summary-toggle"]',
        ) as HTMLButtonElement
      ).click();
    });

    const panel = document.querySelector(
      '[data-testid="thread-summary-panel"]',
    );
    expect(panel?.textContent).toContain("reviewer");
    expect(panel?.textContent).not.toContain("npm test");
    act(() =>
      (
        panel?.querySelector('button[title="reviewer"]') as HTMLButtonElement
      ).click(),
    );
    expect(onOpenSubagentSession).toHaveBeenCalledWith("child-1");
  });

  it("普通会话复用共享页头，不恢复页头内的全局导航", () => {
    const container = renderScene({
      navbarVisible: true,
      navbarChrome: "full",
      navbarContextVariant: "default",
      threadHeader: {
        sessionId: "thread-default-1",
        title: "普通工作区任务",
      },
    });
    expect(
      container.querySelector('[data-testid="thread-workspace-header-title"]')
        ?.textContent,
    ).toBe("普通工作区任务");
    expect(
      container.querySelector(
        '[data-testid="thread-workspace-header-navigation"]',
      ),
    ).toBeNull();
  });

  it("右侧 Surface 内容应透传给主区域并由内层承载区渲染", () => {
    const container = renderScene({
      rightSurfaceOpen: true,
      rightSurfaceContent: (
        <div data-testid="workspace-right-surface-probe">expert</div>
      ),
    });

    expect(
      mockWorkspaceMainArea.mock.calls.at(-1)?.[0]?.rightSurfaceContent,
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="workspace-right-surface-probe"]'),
    ).not.toBeNull();
  });

  it("有消息来源的 pending A2UI 不应再渲染底部补参面板", () => {
    const container = renderScene({
      pendingA2UIForm: {
        id: "assistant-inline-a2ui",
        root: "root",
        components: [],
      },
      onPendingA2UISubmit: vi.fn(),
      messageListProps: {
        messages: [],
        activePendingA2UISource: {
          kind: "assistant_message",
          messageId: "msg-assistant-a2ui",
        },
      } as any,
    });

    expect(
      container.querySelector('[data-testid="workspace-pending-a2ui-panel"]'),
    ).toBeNull();
    expect(mockWorkspacePendingA2UIPanel).not.toHaveBeenCalled();
  });

  it("无消息来源的 pending A2UI 应作为消息列表尾部卡片渲染", () => {
    const container = renderScene({
      pendingA2UIForm: {
        id: "service-skill-a2ui",
        root: "root",
        components: [],
      },
      onPendingA2UISubmit: vi.fn(),
      messageListProps: {
        messages: [],
        activePendingA2UISource: {
          kind: "service_skill",
          skillId: "daily-trend-briefing",
          requestKey: "req-1",
          messageId: undefined,
        },
      } as any,
    });

    const pendingPanel = container.querySelector(
      '[data-testid="workspace-pending-a2ui-panel"]',
    );
    expect(pendingPanel?.getAttribute("data-placement")).toBe("message");
    expect(pendingPanel?.textContent).toContain("service-skill-a2ui");
    expect(mockWorkspacePendingA2UIPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "message",
        pendingA2UIForm: expect.objectContaining({
          id: "service-skill-a2ui",
        }),
      }),
    );
  });

  it("inline 输入区应留在聊天 flex 栈内，避免矮窗口被父级 overflow 裁切", () => {
    const container = renderScene({
      contextWorkspaceEnabled: false,
      shouldHideGeneralWorkbenchInputForTheme: false,
      showFloatingInputOverlay: false,
      inputbarNode: (
        <ComposerEditor
          testId="workspace-inline-inputbar"
          controller={new ComposerController({ text: "整理今天的国际新闻" })}
        />
      ),
    });

    const messageList = container.querySelector(
      '[data-testid="message-list-stub"]',
    );
    const inputSlot = container.querySelector(
      '[data-testid="workspace-inline-input-slot"]',
    );
    const inputbar = container.querySelector(
      '[data-testid="workspace-inline-inputbar"]',
    );

    expect(messageList).not.toBeNull();
    expect(inputSlot).not.toBeNull();
    expect(inputbar).not.toBeNull();
    expect(inputbar?.getAttribute("role")).toBe("textbox");
    expect(getComposerEditorText(inputbar as HTMLElement)).toBe(
      "整理今天的国际新闻",
    );
    expect(inputSlot?.parentElement?.contains(messageList)).toBe(true);
    expect(inputSlot?.parentElement?.lastElementChild).toBe(inputSlot);
    expect(
      mockWorkspaceMainArea.mock.calls.at(-1)?.[0]?.showFloatingInputOverlay,
    ).toBe(false);
  });

  it("浮动输入区应在消息滚动内容尾部预留响应式避让空间", () => {
    const container = renderScene({
      contextWorkspaceEnabled: true,
      showFloatingInputOverlay: true,
    });

    const spacer = container.querySelector(
      '[data-testid="message-list-floating-input-spacer"]',
    );

    expect(spacer).not.toBeNull();
    expect(spacer?.className).toContain("h-8");
    expect(spacer?.className).toContain("max-[960px]:h-16");
    expect(
      container
        .querySelector('[data-testid="message-list-stub"]')
        ?.contains(spacer),
    ).toBe(true);
  });
});
