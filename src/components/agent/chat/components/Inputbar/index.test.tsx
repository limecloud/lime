import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inputbar } from "./index";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";

const mockCharacterMention =
  vi.fn<
    (props: { characters?: Character[]; skills?: Skill[] }) => React.ReactNode
  >();
const mockInputbarCore = vi.fn(
  (props: {
    onToolClick?: (tool: string) => void;
    activeTools?: Record<string, boolean>;
    onSend?: () => void;
    rightExtra?: React.ReactNode;
    leftExtra?: React.ReactNode;
    topExtra?: React.ReactNode;
    placeholder?: string;
    toolMode?: "default" | "attach-only";
    showTranslate?: boolean;
  }) => (
    <div data-testid="inputbar-core">
      <button
        type="button"
        data-testid="toggle-web-search"
        onClick={() => props.onToolClick?.("web_search")}
      >
        切换联网
      </button>
      <span data-testid="web-search-state">
        {props.activeTools?.web_search ? "on" : "off"}
      </span>
      <button
        type="button"
        data-testid="send-btn"
        onClick={() => props.onSend?.()}
      >
        发送
      </button>
      <div data-testid="left-extra">{props.leftExtra}</div>
      <div data-testid="right-extra">{props.rightExtra}</div>
      <div data-testid="top-extra">{props.topExtra}</div>
    </div>
  ),
);

vi.mock("./components/InputbarCore", () => ({
  InputbarCore: (props: {
    onToolClick?: (tool: string) => void;
    activeTools?: Record<string, boolean>;
    onSend?: () => void;
    rightExtra?: React.ReactNode;
    leftExtra?: React.ReactNode;
    topExtra?: React.ReactNode;
    placeholder?: string;
    toolMode?: "default" | "attach-only";
    showTranslate?: boolean;
  }) => mockInputbarCore(props),
}));

vi.mock("./components/CharacterMention", () => ({
  CharacterMention: (props: { characters?: Character[]; skills?: Skill[] }) => {
    mockCharacterMention(props);
    return <div data-testid="character-mention-stub" />;
  },
}));

vi.mock("../TaskFiles", () => ({
  TaskFileList: () => <div data-testid="task-file-list" />,
}));

vi.mock("./hooks/useActiveSkill", () => ({
  useActiveSkill: () => ({
    activeSkill: null,
    setActiveSkill: vi.fn(),
    clearActiveSkill: vi.fn(),
  }),
}));

vi.mock("./components/SkillBadge", () => ({
  SkillBadge: () => <div data-testid="skill-badge" />,
}));

vi.mock("./components/TeamSelector", () => ({
  TeamSelector: (props: { autoOpenToken?: number | null }) => (
    <div
      data-testid="team-selector-stub"
      data-auto-open-token={String(props.autoOpenToken ?? "")}
    />
  ),
}));

vi.mock("../ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="model-selector" />,
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(async () => []),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/input-kit", () => ({
  createAgentInputAdapter: (options: {
    text: string;
    setText: (value: string) => void;
    isSending: boolean;
    disabled?: boolean;
    attachments?: unknown[];
    providerType: string;
    model: string;
    setProviderType: (providerType: string) => void;
    setModel: (model: string) => void;
    stop?: () => void;
  }) => ({
    state: {
      text: options.text,
      isSending: options.isSending,
      disabled: options.disabled,
      attachments: options.attachments,
    },
    model: {
      providerType: options.providerType,
      model: options.model,
    },
    actions: {
      setText: options.setText,
      send: vi.fn(),
      stop: options.stop,
      setProviderType: options.setProviderType,
      setModel: options.setModel,
    },
    ui: {
      showModelSelector: true,
      showToolBar: true,
      showExecutionStrategy: true,
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) break;
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
  vi.clearAllMocks();
});

function renderInputbar(
  props?: Partial<React.ComponentProps<typeof Inputbar>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof Inputbar> = {
    input: "",
    setInput: vi.fn(),
    onSend: vi.fn(),
    isLoading: false,
    characters: [],
    skills: [],
  };

  act(() => {
    root.render(<Inputbar {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("Inputbar", () => {
  it("即使角色和技能为空，也应挂载 CharacterMention", async () => {
    const container = renderInputbar();
    await act(async () => {
      await Promise.resolve();
    });

    const mention = container.querySelector(
      '[data-testid="character-mention-stub"]',
    );
    expect(mention).toBeTruthy();
    expect(mockCharacterMention.mock.calls.length).toBeGreaterThan(0);
    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];
    expect(latestCall.characters).toEqual([]);
    expect(latestCall.skills).toEqual([]);
  });

  it("受控模式下点击联网搜索应透传状态变更", async () => {
    const onToolStatesChange = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <Inputbar
          input=""
          setInput={vi.fn()}
          onSend={vi.fn()}
          isLoading={false}
          characters={[]}
          skills={[]}
          toolStates={{ webSearch: false, thinking: false }}
          onToolStatesChange={onToolStatesChange}
        />,
      );
    });

    mountedRoots.push({ root, container });
    await act(async () => {
      await Promise.resolve();
    });

    const toggleButton = container.querySelector(
      '[data-testid="toggle-web-search"]',
    ) as HTMLButtonElement | null;
    expect(toggleButton).toBeTruthy();

    act(() => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToolStatesChange).toHaveBeenCalledWith({
      webSearch: true,
      thinking: false,
      task: false,
      subagent: false,
    });
  });

  it("通用聊天态复杂任务应显示 Team 建议并支持开启多代理", async () => {
    const onToolStatesChange = vi.fn();
    const container = renderInputbar({
      input: "请拆分这个多代理调试任务，分别分析、实现、验证，再由主线程汇总结论。",
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: false,
      },
      onToolStatesChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前任务更适合 Team 协作");

    const enableTeamButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("启用 Team"));

    expect(enableTeamButton).toBeTruthy();

    act(() => {
      enableTeamButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToolStatesChange).toHaveBeenCalledWith({
      webSearch: false,
      thinking: false,
      task: false,
      subagent: true,
    });
  });

  it("仅在 Team mode 开启时显示 TeamSelector", async () => {
    const container = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: false,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="team-selector-stub"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="team-mode-enable-button"]'),
    ).toBeTruthy();

    const enabledContainer = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: true,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      enabledContainer.querySelector('[data-testid="team-selector-stub"]'),
    ).toBeTruthy();
    expect(
      enabledContainer.querySelector('[data-testid="team-mode-enable-button"]'),
    ).toBeNull();
  });

  it("未开启 Team mode 时应显示显式开启按钮，并可直接启用", async () => {
    const onToolStatesChange = vi.fn();
    const container = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: false,
      },
      onToolStatesChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const enableButton = container.querySelector(
      '[data-testid="team-mode-enable-button"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeTruthy();
    expect(enableButton?.textContent).toContain("开启 Team");

    act(() => {
      enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToolStatesChange).toHaveBeenCalledWith({
      webSearch: false,
      thinking: false,
      task: false,
      subagent: true,
    });
  });

  it("点击开启 Team 后应自动透传 Team 配置面板打开令牌", async () => {
    const container = renderInputbar({
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const enableButton = container.querySelector(
      '[data-testid="team-mode-enable-button"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeTruthy();

    act(() => {
      enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const teamSelector = container.querySelector(
      '[data-testid="team-selector-stub"]',
    ) as HTMLDivElement | null;

    expect(teamSelector).toBeTruthy();
    expect(teamSelector?.getAttribute("data-auto-open-token")).toBe("1");
  });

  it("复杂任务但未开启 Team 时，开启按钮应显示推荐态", async () => {
    const container = renderInputbar({
      activeTheme: "general",
      input: "请把这个跨模块问题拆分成分析、实现、验证三个并行子任务再汇总",
      toolStates: {
        webSearch: false,
        thinking: false,
        task: false,
        subagent: false,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const enableButton = container.querySelector(
      '[data-testid="team-mode-enable-button"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeTruthy();
    expect(enableButton?.textContent).toContain("开启 Team");
    expect(enableButton?.textContent).toContain("推荐");
  });

  it("社媒主题默认应自动注入 social_post_with_cover skill", async () => {
    const onSend = vi.fn();
    const container = renderInputbar({
      activeTheme: "social-media",
      input: "写一篇春季上新种草文案",
      onSend,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      "/social_post_with_cover 写一篇春季上新种草文案",
      "react",
    );
  });

  it("社媒主题输入 slash 命令时不应重复注入默认 skill", async () => {
    const onSend = vi.fn();
    const container = renderInputbar({
      activeTheme: "social-media",
      input: "/custom_skill 写一篇品牌故事",
      onSend,
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledWith(
      undefined,
      false,
      false,
      undefined,
      "react",
    );
  });

  it("主题工作台模式应启用 PRD 浮层输入配置", async () => {
    renderInputbar({
      variant: "theme_workbench",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
      executionStrategy: "auto",
      setExecutionStrategy: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const latestCall =
      mockInputbarCore.mock.calls[mockInputbarCore.mock.calls.length - 1]?.[0];
    expect(latestCall).toBeTruthy();
    expect(latestCall.toolMode).toBe("attach-only");
    expect(latestCall.showTranslate).toBe(false);
    expect(latestCall.placeholder).toContain("试着输入任何指令");
    expect(latestCall.rightExtra).toBeDefined();
  });

  it("主题工作台在待启动状态下不应显示闸门条", async () => {
    const container = renderInputbar({
      variant: "theme_workbench",
      themeWorkbenchGate: {
        key: "draft_start",
        title: "编排待启动",
        status: "idle",
        description: "输入目标后将自动进入编排执行。",
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("编排待启动");
    expect(container.textContent).not.toContain("待启动");
  });

  it("主题工作台闸门快捷操作应能快速填充输入", async () => {
    const setInput = vi.fn();
    const container = renderInputbar({
      variant: "theme_workbench",
      setInput,
      themeWorkbenchGate: {
        key: "topic_select",
        title: "选题闸门",
        status: "waiting",
        description: "请选择优先推进的选题方向。",
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("选题闸门");
    expect(container.textContent).not.toContain("当前闸门");
    expect(container.textContent).not.toContain("请选择优先推进的选题方向。");

    const quickActionButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("生成 3 个选题"));
    expect(quickActionButton).toBeTruthy();

    act(() => {
      quickActionButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(setInput).toHaveBeenCalledWith(
      "请给我 3 个可执行选题方向，并说明目标读者与传播价值。",
    );
  });

  it("主题工作台生成中应展示任务面板并支持停止", async () => {
    const onStop = vi.fn();
    const container = renderInputbar({
      variant: "theme_workbench",
      isLoading: true,
      onStop,
      workflowSteps: [
        { id: "research", title: "检索项目素材", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前待办");
    expect(container.textContent).toContain("正在生成中");
    expect(container.querySelector('[data-testid="inputbar-core"]')).toBeNull();

    const stopButton = container.querySelector(
      '[data-testid="theme-workbench-stop"]',
    ) as HTMLButtonElement | null;
    expect(stopButton).toBeTruthy();
    act(() => {
      stopButton?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("主题工作台生成中应支持折叠与展开待办列表", async () => {
    const container = renderInputbar({
      variant: "theme_workbench",
      isLoading: true,
      workflowSteps: [
        { id: "research", title: "检索项目素材", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("检索项目素材");

    const collapseButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.getAttribute("aria-label") === "折叠待办列表");
    expect(collapseButton).toBeTruthy();

    act(() => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("检索项目素材");

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "展开待办列表",
    );
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("检索项目素材");
  });

  it("主题工作台在 auto_running 状态下应展示生成面板（不依赖 isLoading）", async () => {
    const container = renderInputbar({
      variant: "theme_workbench",
      isLoading: false,
      themeWorkbenchRunState: "auto_running",
      workflowSteps: [
        { id: "research", title: "检索项目素材", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前待办");
    expect(container.textContent).toContain("正在生成中");
    expect(container.querySelector('[data-testid="inputbar-core"]')).toBeNull();
  });

  it("主题工作台在 await_user_decision 状态下应显示输入框", async () => {
    const container = renderInputbar({
      variant: "theme_workbench",
      isLoading: true,
      themeWorkbenchRunState: "await_user_decision",
      workflowSteps: [
        { id: "topic", title: "等待用户确认选题", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-core"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("正在生成中");
  });
});
