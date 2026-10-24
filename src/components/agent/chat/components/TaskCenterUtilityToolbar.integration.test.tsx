import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { TaskCenterUtilityToolbar } from "./TaskCenterUtilityToolbar";
import { ProjectGitWorktreeSetupError } from "@/lib/api/projectGit";
import { ensureProjectWorkspace } from "@/lib/api/project";
import { readLocalEnvironmentSelection } from "@/lib/api/localEnvironmentSelection";
import { toast } from "sonner";

const {
  mockRevealPathInFinder,
  mockOpenExternalUrlWithSystemBrowser,
  mockCheckoutProjectGitBranch,
  mockCreateProjectGitBranch,
  mockCreateProjectGitWorktree,
  mockReadProjectGitDiff,
  mockReadProjectGitStatus,
  translate,
} = vi.hoisted(() => ({
  mockRevealPathInFinder: vi.fn(),
  mockOpenExternalUrlWithSystemBrowser: vi.fn(),
  mockCheckoutProjectGitBranch: vi.fn(),
  mockCreateProjectGitBranch: vi.fn(),
  mockCreateProjectGitWorktree: vi.fn(),
  mockReadProjectGitDiff: vi.fn(),
  mockReadProjectGitStatus: vi.fn(),
  translate: (key: string, options?: Record<string, unknown>) => {
    const template =
      typeof options?.defaultValue === "string" ? options.defaultValue : key;
    return template.replace(/{{\s*([^}]+?)\s*}}/g, (_, name: string) =>
      String(options?.[name.trim()] ?? ""),
    );
  },
}));

vi.mock("@/lib/api/fileSystem", () => ({
  revealPathInFinder: mockRevealPathInFinder,
}));

vi.mock("@/lib/api/externalUrl", () => ({
  openExternalUrlWithSystemBrowser: mockOpenExternalUrlWithSystemBrowser,
}));

vi.mock("@/lib/api/projectGit", async () => ({
  ...(await vi.importActual<typeof import("@/lib/api/projectGit")>(
    "@/lib/api/projectGit",
  )),
  checkoutProjectGitBranch: mockCheckoutProjectGitBranch,
  createProjectGitBranch: mockCreateProjectGitBranch,
  createProjectGitWorktree: mockCreateProjectGitWorktree,
  readProjectGitDiff: mockReadProjectGitDiff,
  readProjectGitStatus: mockReadProjectGitStatus,
}));
vi.mock("@/lib/api/project", () => ({ ensureProjectWorkspace: vi.fn() }));
vi.mock("@/lib/api/localEnvironmentSelection", () => ({
  readLocalEnvironmentSelection: vi.fn(),
}));
vi.mock("../hooks/agentProjectStorage", () => ({ markProjectOpened: vi.fn() }));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/i18n/createI18n", () => ({
  changeLimeLocale: vi.fn(async () => "zh-CN"),
}));

vi.mock("./harnessPanelText", () => ({
  agentText: (
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>,
  ) => translate(key, { defaultValue, ...options }),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: () => undefined,
  },
  useTranslation: () => ({ t: translate }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      variant?: string;
      size?: string;
    }
  >(
    (
      {
        children,
        onClick,
        disabled,
        type,
        variant: _variant,
        size: _size,
        ...rest
      },
      ref,
    ) => (
      <button
        ref={ref}
        type={type ?? "button"}
        onClick={onClick}
        disabled={disabled}
        {...rest}
      >
        {children}
      </button>
    ),
  ),
}));

const PopoverTestContext = React.createContext<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} | null>(null);

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <PopoverTestContext.Provider value={{ open, onOpenChange }}>
      {children}
    </PopoverTestContext.Provider>
  ),
  PopoverContent: ({
    children,
    align: _align,
    sideOffset: _sideOffset,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    align?: string;
    sideOffset?: number;
  }) => <div {...props}>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => {
    const context = React.useContext(PopoverTestContext);
    if (!React.isValidElement(children)) {
      return <>{children}</>;
    }
    const child = children as React.ReactElement<{
      onClick?: React.MouseEventHandler<HTMLElement>;
    }>;
    return React.cloneElement(child, {
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        child.props.onClick?.(event);
        context?.onOpenChange?.(!context.open);
      },
    });
  },
}));

interface MountedHarness {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedHarness[] = [];

beforeEach(async () => {
  vi.mocked(readLocalEnvironmentSelection).mockResolvedValue(null);
  vi.mocked(ensureProjectWorkspace).mockResolvedValue({
    id: "checkout",
    rootPath: "/checkout",
  } as Awaited<ReturnType<typeof ensureProjectWorkspace>>);
  mockCreateProjectGitWorktree.mockResolvedValue({ worktreePath: "/checkout" });
  vi.useRealTimers();
  await changeLimeLocale("zh-CN");
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.PointerEvent) {
    Object.defineProperty(globalThis, "PointerEvent", {
      configurable: true,
      value: MouseEvent,
    });
  }
  HTMLElement.prototype.setPointerCapture ??= vi.fn();
  HTMLElement.prototype.releasePointerCapture ??= vi.fn();
  mockRevealPathInFinder.mockResolvedValue(undefined);
  mockOpenExternalUrlWithSystemBrowser.mockResolvedValue(undefined);
  mockCheckoutProjectGitBranch.mockResolvedValue({
    rootPath: "/tmp/project",
    hasGitRepository: true,
    currentBranch: "main",
    branches: ["main", "feature/task-center"],
    uncommittedFileCount: 3,
  });
  mockCreateProjectGitBranch.mockResolvedValue({
    rootPath: "/tmp/project",
    hasGitRepository: true,
    currentBranch: "new-branch",
    branches: ["new-branch", "feature/task-center"],
    uncommittedFileCount: 3,
  });
  mockReadProjectGitDiff.mockResolvedValue({
    rootPath: "/tmp/project",
    hasGitRepository: true,
    patch: "+added\n-removed\n",
    uncommittedFileCount: 3,
    currentRef: "feature/task-center",
    comparisonBaseRef: null,
  });
  mockReadProjectGitStatus.mockResolvedValue({
    rootPath: "/tmp/project",
    hasGitRepository: true,
    currentBranch: "feature/task-center",
    branches: [
      "feature/task-center",
      "main",
      "dev-electron",
      "dark-sol-drifts-02h23",
      "hotfix/v1.16.0-republish",
      "release/v1.12.1",
    ],
    uncommittedFileCount: 3,
  });
});

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
  await changeLimeLocale("en-US");
});

function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(node);
  });

  mountedRoots.push({ container, root });
  return container;
}

function renderToolbar(
  props?: Partial<React.ComponentProps<typeof TaskCenterUtilityToolbar>>,
) {
  return mount(
    <TaskCenterUtilityToolbar
      projectRootPath="/tmp/project"
      onProjectChange={vi.fn()}
      {...props}
    />,
  );
}

describe("TaskCenterUtilityToolbar", () => {
  it("projects the visible conversation workspace independently of new-chat controls", () => {
    const container = renderToolbar({
      workspaceId: "target-workspace",
      projectRootPath: "/tmp/target",
    });
    const toolbar = container.querySelector(
      '[data-testid="task-center-utility-toolbar"]',
    );
    expect(toolbar?.getAttribute("data-workspace-id")).toBe("target-workspace");
    expect(toolbar?.getAttribute("data-workspace-root")).toBe("/tmp/target");
  });

  it.each([null, "/tmp/project/.codex/environments/dev.toml"])(
    "creates using the canonical environment selection %s",
    async (configPath) => {
      vi.mocked(readLocalEnvironmentSelection).mockResolvedValueOnce(
        configPath,
      );
      const onProjectChange = vi.fn();
      const container = renderToolbar({ onProjectChange });
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            '[data-testid="task-center-app-switcher-trigger"]',
          )!
          .click(),
      );
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>(
            '[data-testid="task-center-location-worktree"]',
          )!
          .click(),
      );
      expect(readLocalEnvironmentSelection).toHaveBeenCalledWith(
        "/tmp/project",
      );
      expect(mockCreateProjectGitWorktree).toHaveBeenCalledWith(
        "/tmp/project",
        {
          baseBranch: undefined,
          localEnvironmentConfigPath: configPath,
        },
      );
      expect(onProjectChange).toHaveBeenCalledWith("checkout");
    },
  );

  it("offers the existing checkout after setup failure and opens it only on request", async () => {
    mockCreateProjectGitWorktree.mockRejectedValueOnce(
      new ProjectGitWorktreeSetupError("setup failed", "/checkout"),
    );
    const onProjectChange = vi.fn();
    const container = renderToolbar({ onProjectChange });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-center-app-switcher-trigger"]',
        )!
        .click(),
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-center-location-worktree"]',
        )!
        .click(),
    );
    expect(onProjectChange).not.toHaveBeenCalled();
    expect(ensureProjectWorkspace).not.toHaveBeenCalled();
    const options = vi.mocked(toast.error).mock.calls.at(-1)![1]!;
    expect(options.description).toContain("/checkout");
    const action = options.action;
    expect(action).toMatchObject({
      label: "agentChat.navbar.appSwitcher.openWorktree",
    });
    if (!action || !("onClick" in action))
      throw Error("Missing recovery action");
    await act(async () =>
      action.onClick({} as React.MouseEvent<HTMLButtonElement>),
    );
    expect(ensureProjectWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: "/checkout" }),
    );
    expect(onProjectChange).toHaveBeenCalledExactlyOnceWith("checkout");
    expect(mockCreateProjectGitWorktree).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("统一工具栏只承接一个侧边面板入口，保持紧凑单行", () => {
    const toggle = vi.fn();
    const container = renderToolbar({
      sidePanelLauncher: (
        <button data-testid="side-panel-launcher" onClick={toggle}>
          打开侧边面板
        </button>
      ),
    });
    expect(
      container.querySelectorAll('[data-testid="side-panel-launcher"]'),
    ).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="task-center-tool-group-panels"]'),
    ).toBeNull();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="side-panel-launcher"]')
        ?.click(),
    );
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("打开位置应展示处理位置菜单，并通过文件壳网关打开本地目录", async () => {
    const container = renderToolbar();
    const trigger = container.querySelector(
      '[data-testid="task-center-app-switcher-trigger"]',
    ) as HTMLButtonElement | null;

    expect(trigger?.textContent).toContain("打开位置");

    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const popover = document.body.querySelector(
      '[data-testid="task-center-app-switcher-popover"]',
    );
    expect(popover?.textContent).toContain("继续使用");
    expect(popover?.textContent).toContain("在本地处理");
    expect(popover?.textContent).toContain("关联 Codex web");
    expect(popover?.textContent).toContain("发送至云端");
    expect(popover?.textContent).toContain("工作树");
    expect(popover?.className).toContain("w-[min(216px,calc(100vw-1rem))]");
    const codexWebButton = popover?.querySelector<HTMLButtonElement>(
      '[data-testid="task-center-location-codex-web"]',
    );
    expect(codexWebButton?.disabled).toBe(false);
    expect(
      popover?.querySelector<HTMLButtonElement>(
        '[data-testid="task-center-location-cloud"]',
      )?.disabled,
    ).toBe(true);
    expect(
      popover?.querySelector<HTMLButtonElement>(
        '[data-testid="task-center-location-worktree"]',
      )?.disabled,
    ).toBe(false);
    const localButton = popover?.querySelector<HTMLButtonElement>(
      '[data-testid="task-center-location-local"]',
    );

    await act(async () => {
      codexWebButton?.click();
      await Promise.resolve();
    });
    expect(mockOpenExternalUrlWithSystemBrowser).toHaveBeenCalledWith(
      "https://chatgpt.com/codex",
    );

    await act(async () => {
      localButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mockRevealPathInFinder).toHaveBeenCalledWith("/tmp/project");
  });

  it("环境信息应读取真实 Git 状态并展示分支与未提交文件数", async () => {
    const container = renderToolbar();
    const trigger = container.querySelector(
      '[data-testid="task-center-environment-trigger"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const popover = document.body.querySelector(
      '[data-testid="task-center-environment-popover"]',
    );
    expect(mockReadProjectGitStatus).toHaveBeenCalledWith("/tmp/project");
    expect(popover?.textContent).toContain("feature/task-center");
    expect(popover?.textContent).toContain("+1 -1");
    expect(popover?.textContent).toContain("提交或推送");
    expect(popover?.textContent).toContain("比较分支");
    expect(popover?.className).toContain("w-[min(300px,calc(100vw-1rem))]");
    expect(
      popover?.querySelector('[data-testid="task-center-environment-add"]'),
    ).not.toBeNull();
    expect(
      popover?.querySelector('[data-testid="task-center-environment-local"]'),
    ).not.toBeNull();
    expect(
      popover?.querySelector('[data-testid="task-center-environment-branch"]'),
    ).not.toBeNull();
    expect(
      popover?.querySelectorAll(
        '[data-testid="task-center-environment-compare"] svg',
      ),
    ).toHaveLength(2);
  });

  it("任务详情存在时环境信息仍应保持紧凑", async () => {
    const onOpenOutput = vi.fn();
    const container = renderToolbar({
      taskRail: {
        workflowSteps: [
          { id: "read", title: "读取任务区结构", status: "completed" },
          { id: "build", title: "接入顶部任务轨道", status: "active" },
          { id: "verify", title: "验证顶部浮层", status: "pending" },
          { id: "ship", title: "整理交付结果", status: "pending" },
        ],
        messages: [
          {
            id: "assistant-task",
            role: "assistant",
            content: "",
            timestamp: new Date("2026-06-16T10:00:00.000Z"),
            toolCalls: [
              {
                id: "tool-rg",
                name: "rg",
                arguments: JSON.stringify({
                  query: "TaskCenterUtilityToolbar",
                }),
                status: "completed",
                result: {
                  success: true,
                  output: "找到顶部工具栏",
                },
                startTime: new Date("2026-06-16T10:00:01.000Z"),
              },
            ],
            artifacts: [
              {
                id: "artifact-plan",
                type: "document",
                title: "agent-workspace-task-rail.md",
                content: "task rail",
                status: "complete",
                createdAt: new Date("2026-06-16T10:00:02.000Z").getTime(),
                updatedAt: new Date("2026-06-16T10:00:02.000Z").getTime(),
                position: { start: 0, end: 9 },
                meta: {
                  filePath: "internal/roadmap/agent-workspace/task-rail.md",
                },
              },
            ],
          },
        ],
        providerType: "cloud",
        model: "reasoner-pro",
        accessMode: "current",
        reasoningEffort: "medium",
        workspaceRootPath: "/tmp/project",
        threadGoal: {
          createdAt: 1,
          objective: "完成任务轨道",
          status: "active",
          threadId: "thread-1",
          timeUsedSeconds: 0,
          tokensUsed: 0,
          updatedAt: 1,
        },
        threadRead: {
          thread_id: "thread-1",
          active_turn_id: "turn-1",
          profile_status: "running",
          context_summary: {
            sources: [
              "AG-UI spec",
              "https://example.com/report",
              "docs/context.md",
            ],
          },
          evidence_summary: {
            evidence_refs: ["evidence/task-rail.json"],
          },
          change_summary: {
            changed_file_count: 2,
            changed_files: ["src/App.tsx", "src/index.ts"],
            patch_count: 2,
            running_patch_count: 1,
          },
        } as any,
        canonicalChildren: [
          {
            name: "实现",
            parentThreadId: "thread-parent",
            sessionId: "subagent-1",
            status: "running",
            threadId: "thread-subagent-1",
            updatedAtMs: 2,
          },
          {
            name: "验证",
            parentThreadId: "thread-parent",
            sessionId: "subagent-2",
            status: "completed",
            threadId: "thread-subagent-2",
            updatedAtMs: 2,
          },
          {
            name: "收尾",
            parentThreadId: "thread-parent",
            sessionId: "subagent-3",
            status: "completed",
            threadId: "thread-subagent-3",
            updatedAtMs: 2,
          },
        ],
        onOpenOutput,
      },
    });
    const trigger = container.querySelector(
      '[data-testid="task-center-environment-trigger"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const popover = document.body.querySelector(
      '[data-testid="task-center-environment-popover"]',
    );
    expect(popover?.textContent).toContain("环境信息");
    expect(popover?.className).toContain("w-[min(300px,calc(100vw-1rem))]");
    expect(popover?.className).not.toContain("30rem");
    expect(
      document.body.querySelector('[data-testid="task-center-task-rail"]'),
    ).toBeNull();
  });

  it("环境信息的分支菜单应提供搜索、当前分支状态和创建入口", async () => {
    const container = renderToolbar();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="task-center-environment-trigger"]',
        )
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const menu = document.body.querySelector(
      '[data-testid="task-center-environment-branch-menu"]',
    );
    expect(menu?.textContent).toContain("分支");
    expect(menu?.textContent).toContain("feature/task-center");
    expect(menu?.textContent).toContain("未提交：3 个文件");
    expect(menu?.textContent).toContain("main");
    expect(menu?.textContent).toContain("创建并检出新分支...");
    expect(
      menu?.querySelector<HTMLInputElement>('input[placeholder="搜索分支"]'),
    ).not.toBeNull();

    const mainBranchButton = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.includes("main"));
    await act(async () => {
      mainBranchButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mockCheckoutProjectGitBranch).toHaveBeenCalledWith(
      "/tmp/project",
      "main",
    );
  });

  it("默认不打开环境信息时不应读取项目 Git 状态", () => {
    renderToolbar({
      taskRail: {
        workflowSteps: [
          { id: "read", title: "读取任务区结构", status: "completed" },
        ],
        messages: [],
        threadRead: {
          thread_id: "thread-heavy",
          active_turn_id: "turn-heavy",
          status: "completed",
        },
        canonicalChildren: [
          {
            name: "实现",
            parentThreadId: "thread-parent",
            sessionId: "subagent-heavy",
            status: "completed",
            threadId: "thread-subagent-heavy",
            updatedAtMs: 2,
          },
        ],
      },
    });

    expect(mockReadProjectGitStatus).not.toHaveBeenCalled();
    expect(
      document.body.querySelector('[data-testid="task-center-task-rail"]'),
    ).toBeNull();
  });

  it("导入 provenance 不应创建 imported-only 完整运行记录入口", async () => {
    const container = renderToolbar({
      taskRail: {
        sessionId: "session-imported",
        workflowSteps: [],
        messages: [],
        context: {
          sourceCount: 1,
          sourceLabels: ["restored-history"],
        },
        threadItems: [
          {
            id: "imported-command",
            type: "command_execution",
            thread_id: "thread-1",
            turn_id: "turn-1",
            sequence: 1,
            status: "completed",
            command: "npm test",
            cwd: "/workspace/imported-history",
            started_at: "2026-06-16T10:00:00.000Z",
            completed_at: "2026-06-16T10:00:01.000Z",
            updated_at: "2026-06-16T10:00:01.000Z",
            metadata: {
              imported: true,
              source_client: "codex",
              sourcePath: "/Users/example/.codex/sessions/thread.jsonl",
            },
          },
        ],
      },
    });
    const trigger = container.querySelector(
      '[data-testid="task-center-environment-trigger"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(
      document.body.querySelector(
        '[data-testid="imported-runtime-detail-toggle"]',
      ),
    ).toBeNull();
    expect(
      document.body.querySelector(
        '[data-testid="imported-runtime-detail-panel"]',
      ),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("查看完整记录");
    expect(document.body.textContent).not.toContain(
      "/Users/example/.codex/sessions/thread.jsonl",
    );
  });

  it("普通来源会话不应显示完整运行记录入口", async () => {
    const container = renderToolbar({
      taskRail: {
        sessionId: "session-normal",
        workflowSteps: [],
        messages: [],
        context: {
          sourceCount: 1,
          sourceLabels: ["docs.example.com"],
        },
        threadItems: [
          {
            id: "web-source",
            type: "web_search",
            thread_id: "thread-1",
            turn_id: "turn-1",
            sequence: 1,
            status: "completed",
            query: "workspace docs",
            started_at: "2026-06-16T10:00:00.000Z",
            completed_at: "2026-06-16T10:00:01.000Z",
            updated_at: "2026-06-16T10:00:01.000Z",
          },
        ],
      },
    });
    const trigger = container.querySelector(
      '[data-testid="task-center-environment-trigger"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      trigger?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(
      document.body.querySelector(
        '[data-testid="imported-runtime-detail-panel"]',
      ),
    ).toBeNull();
  });
});
