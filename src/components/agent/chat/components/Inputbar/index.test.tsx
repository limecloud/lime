import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inputbar } from "./index";
import type { Character } from "@/lib/api/memory";
import type { Skill } from "@/lib/api/skills";
import type { ServiceSkillHomeItem } from "@/components/agent/chat/service-skills/types";

const mockCharacterMention =
  vi.fn<
    (props: {
      characters?: Character[];
      skills?: Skill[];
      serviceSkills?: ServiceSkillHomeItem[];
      onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
    }) => React.ReactNode
  >();
const mockInputbarCore = vi.fn(
  (props: {
    onToolClick?: (tool: string) => void;
    activeTools?: Record<string, boolean>;
    onSend?: () => void;
    leftExtra?: React.ReactNode;
    topExtra?: React.ReactNode;
    placeholder?: string;
    toolMode?: "default" | "attach-only";
    showMetaTools?: boolean;
  }) => (
    <div data-testid="inputbar-core">
      {props.showMetaTools ? (
        <>
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
            data-testid="toggle-subagent-mode"
            onClick={() => props.onToolClick?.("subagent_mode")}
          >
            切换任务拆分
          </button>
          <span data-testid="subagent-state">
            {props.activeTools?.subagent_mode ? "on" : "off"}
          </span>
        </>
      ) : null}
      <button
        type="button"
        data-testid="send-btn"
        onClick={() => props.onSend?.()}
      >
        发送
      </button>
      <div data-testid="left-extra">{props.leftExtra}</div>
      <div data-testid="top-extra">{props.topExtra}</div>
    </div>
  ),
);

vi.mock("./components/InputbarCore", () => ({
  InputbarCore: (props: {
    onToolClick?: (tool: string) => void;
    activeTools?: Record<string, boolean>;
    onSend?: () => void;
    leftExtra?: React.ReactNode;
    topExtra?: React.ReactNode;
    placeholder?: string;
    toolMode?: "default" | "attach-only";
    showMetaTools?: boolean;
  }) => mockInputbarCore(props),
}));

vi.mock("../../skill-selection/CharacterMention", () => ({
  CharacterMention: (props: {
    characters?: Character[];
    skills?: Skill[];
    serviceSkills?: ServiceSkillHomeItem[];
    onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
  }) => {
    mockCharacterMention(props);
    return <div data-testid="character-mention-stub" />;
  },
}));

vi.mock("../TaskFiles", () => ({
  TaskFileList: () => <div data-testid="task-file-list" />,
}));

vi.mock("../../skill-selection/useActiveSkill", () => ({
  useActiveSkill: () => ({
    activeSkill: null,
    setActiveSkill: vi.fn(),
    clearActiveSkill: vi.fn(),
    buildSkillSelection: (source: {
      skills?: Skill[];
      serviceSkills?: ServiceSkillHomeItem[];
      isSkillsLoading?: boolean;
      onSelectServiceSkill?: (skill: ServiceSkillHomeItem) => void;
      onNavigateToSettings?: () => void;
      onImportSkill?: () => void | Promise<void>;
      onRefreshSkills?: () => void | Promise<void>;
    }) => ({
      skills: source.skills ?? [],
      serviceSkills: source.serviceSkills ?? [],
      activeSkill: null,
      isSkillsLoading: source.isSkillsLoading ?? false,
      onSelectSkill: vi.fn(),
      onSelectServiceSkill: source.onSelectServiceSkill,
      onClearSkill: vi.fn(),
      onNavigateToSettings: source.onNavigateToSettings,
      onImportSkill: source.onImportSkill,
      onRefreshSkills: source.onRefreshSkills,
    }),
  }),
}));

vi.mock("../../skill-selection/SkillBadge", () => ({
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
  vi.useRealTimers();
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

  const render = (
    nextProps?: Partial<React.ComponentProps<typeof Inputbar>>,
  ) => {
    act(() => {
      root.render(<Inputbar {...defaultProps} {...props} {...nextProps} />);
    });
  };

  render();

  mountedRoots.push({ root, container });
  return {
    container,
    rerender: render,
  };
}

function expandAdvancedControls(container: HTMLDivElement) {
  const toggleButton = container.querySelector(
    '[data-testid="inputbar-advanced-toggle"]',
  ) as HTMLButtonElement | null;

  expect(toggleButton).toBeTruthy();

  act(() => {
    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  return toggleButton;
}
describe("Inputbar", () => {
  it("即使角色和技能为空，也应挂载 CharacterMention", async () => {
    const { container } = renderInputbar();
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

  it("应将服务型技能目录与选择回调透传给 CharacterMention", async () => {
    const serviceSkills = [
      {
        id: "daily-trend-briefing",
        title: "每日趋势摘要",
      },
    ] as ServiceSkillHomeItem[];
    const onSelectServiceSkill = vi.fn();

    renderInputbar({
      serviceSkills,
      onSelectServiceSkill,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCharacterMention.mock.calls.length).toBeGreaterThan(0);
    const latestCall =
      mockCharacterMention.mock.calls[
        mockCharacterMention.mock.calls.length - 1
      ][0];

    expect(latestCall.serviceSkills).toBe(serviceSkills);
    expect(latestCall.onSelectServiceSkill).toBe(onSelectServiceSkill);
  });

  it("应把任务文件与额外浮层控件放进同一条输入栏 overlay row", async () => {
    const { container } = renderInputbar({
      taskFiles: [
        {
          id: "file-1",
          name: "notes.md",
          type: "document",
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      overlayAccessory: (
        <button type="button" data-testid="team-inline-toggle">
          查看任务进展 · 2
        </button>
      ),
    });

    await act(async () => {
      await Promise.resolve();
    });

    const row = container.querySelector<HTMLElement>(
      '[data-testid="inputbar-secondary-controls"]',
    );
    expect(row).toBeTruthy();
    expect(getComputedStyle(row as HTMLElement).position).toBe("absolute");
    expect(getComputedStyle(row as HTMLElement).pointerEvents).toBe("none");
    expect(getComputedStyle(row as HTMLElement).zIndex).toBe("80");
    expect(
      row?.querySelector('[data-testid="task-files-panel-area"]'),
    ).toBeTruthy();
    expect(
      row?.querySelector('[data-testid="team-inline-toggle"]'),
    ).toBeTruthy();

    const fileInput = container.querySelector(
      'input[type="file"][accept="image/*"]',
    ) as HTMLInputElement | null;
    expect(fileInput).toBeTruthy();
    expect(fileInput?.multiple).toBe(true);
  });

  it("没有任务文件和额外控件时不应渲染 overlay row", async () => {
    const { container } = renderInputbar({
      taskFiles: [],
      overlayAccessory: null,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-secondary-controls"]'),
    ).toBeNull();
  });

  it("主线程任务状态不应再在输入区单独渲染 task strip", async () => {
    const { container } = renderInputbar({
      input: "分析 claudecode 项目结构并继续执行",
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="agent-task-strip"]')).toBeNull();
  });

  it("工作区输入区默认隐藏技能入口，展开高级设置后与 @ 面板共用同一技能数据源", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
      skills: [
        {
          key: "writer",
          name: "写作助手",
          description: "用于写作",
          directory: "writer",
          installed: true,
          sourceKind: "builtin",
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="skill-selector-trigger"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="inputbar-advanced-toggle"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="character-mention-stub"]'),
    ).toBeTruthy();

    expandAdvancedControls(container);

    expect(
      container.querySelector('[data-testid="skill-selector-trigger"]'),
    ).toBeTruthy();
  });

  it("存在 executionRuntime 时折叠态应保留当前模型提示，展开后再显示模型选择器", async () => {
    const { container } = renderInputbar({
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-5.4-mini",
      setModel: vi.fn(),
      executionRuntime: {
        session_id: "session-1",
        provider_selector: "openai",
        provider_name: "openai",
        model_name: "gpt-5.4",
        source: "turn_context",
        output_schema_runtime: {
          source: "turn",
          strategy: "native",
          providerName: "openai",
          modelName: "gpt-5.4",
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("当前模型");
    expect(container.textContent).toContain("gpt-5.4-mini");
    expect(container.textContent).not.toContain("最近执行模型");
    expect(
      container.querySelector('[data-testid="model-selector"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    expect(
      container.querySelector('[data-testid="model-selector"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("结构化输出");
    expect(container.textContent).not.toContain("Native schema");
  });

  it("应在高级设置中渲染 Plan 开关与权限模式，并透传对应回调", async () => {
    const setExecutionStrategy = vi.fn();
    const setAccessMode = vi.fn();
    const { container } = renderInputbar({
      executionStrategy: "react",
      setExecutionStrategy,
      accessMode: "current",
      setAccessMode,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-plan-toggle"]'),
    ).toBeNull();
    expect(container.querySelector('select[aria-label="权限模式"]')).toBeNull();

    expandAdvancedControls(container);

    const planToggle = container.querySelector(
      '[data-testid="inputbar-plan-toggle"]',
    ) as HTMLButtonElement | null;
    const accessSelect = container.querySelector(
      'select[aria-label="权限模式"]',
    ) as HTMLSelectElement | null;

    expect(planToggle).toBeTruthy();
    expect(accessSelect).toBeTruthy();
    expect(container.querySelector('select[aria-label="执行模式"]')).toBeNull();

    act(() => {
      planToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      accessSelect!.value = "full-access";
      accessSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(setExecutionStrategy).toHaveBeenCalledWith("code_orchestrated");
    expect(setAccessMode).toHaveBeenCalledWith("full-access");
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

    expect(
      container.querySelector('[data-testid="toggle-web-search"]'),
    ).toBeNull();

    expandAdvancedControls(container);

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
      subagent: false,
    });
  });

  it("通用聊天态复杂任务应显示任务分工建议并支持开启多代理", async () => {
    const onToolStatesChange = vi.fn();
    const { container } = renderInputbar({
      input:
        "请拆分这个多代理调试任务，分别分析、实现、验证，再由主线程汇总结论。",
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: false,
      },
      onToolStatesChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const suggestionBar = container.querySelector(
      '[data-testid="team-suggestion-bar"]',
    );
    expect(suggestionBar).toBeTruthy();
    expect(suggestionBar?.textContent).toContain("分工建议");

    const enableTeamButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("启用任务分工"));

    expect(enableTeamButton).toBeTruthy();

    act(() => {
      enableTeamButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onToolStatesChange).toHaveBeenCalledWith({
      webSearch: false,
      thinking: false,
      subagent: true,
    });
  });

  it("仅在 Team mode 开启时显示 TeamSelector", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: false,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="team-selector-stub"]'),
    ).toBeNull();

    const { container: enabledContainer } = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: true,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      enabledContainer.querySelector('[data-testid="team-selector-stub"]'),
    ).toBeNull();

    expandAdvancedControls(enabledContainer);

    expect(
      enabledContainer.querySelector('[data-testid="team-selector-stub"]'),
    ).toBeTruthy();
  });

  it("未开启 Team mode 时默认不暴露多代理开关，展开高级设置后可启用", async () => {
    const onToolStatesChange = vi.fn();
    const { container } = renderInputbar({
      activeTheme: "general",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: false,
      },
      onToolStatesChange,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="team-mode-enable-button"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-subagent-mode"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    const enableButton = container.querySelector(
      '[data-testid="toggle-subagent-mode"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeTruthy();

    act(() => {
      enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToolStatesChange).toHaveBeenCalledWith({
      webSearch: false,
      thinking: false,
      subagent: true,
    });
  });

  it("点击多代理图标后应自动透传 Team 配置面板打开令牌", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expandAdvancedControls(container);

    const enableButton = container.querySelector(
      '[data-testid="toggle-subagent-mode"]',
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

  it("复杂任务但未开启 Team 时，保留推荐提示但不再渲染重复入口", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
      input: "请把这个跨模块问题拆分成分析、实现、验证三个并行子任务再汇总",
      toolStates: {
        webSearch: false,
        thinking: false,
        subagent: false,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const recommendationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("启用任务分工"));

    expect(
      container.querySelector('[data-testid="team-mode-enable-button"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="toggle-subagent-mode"]'),
    ).toBeNull();
    expect(recommendationButton).toBeTruthy();
    const suggestionBar = container.querySelector(
      '[data-testid="team-suggestion-bar"]',
    );
    expect(suggestionBar).toBeTruthy();
    expect(suggestionBar?.textContent).toContain("分工建议");
  });

  it("内容主题默认发送时不应再注入旧 skill 前缀", async () => {
    const onSend = vi.fn();
    const { container } = renderInputbar({
      activeTheme: "general",
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
      undefined,
      "react",
    );
  });

  it("社媒主题输入 slash 命令时不应重复注入默认 skill", async () => {
    const onSend = vi.fn();
    const { container } = renderInputbar({
      activeTheme: "general",
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

  it("工作区工作流模式应启用 PRD 浮层输入配置", async () => {
    renderInputbar({
      variant: "workspace",
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
    expect(
      Object.prototype.hasOwnProperty.call(latestCall, "showTranslate"),
    ).toBe(false);
    expect(latestCall.placeholder).toContain("试着输入任何指令");
    expect(latestCall.leftExtra).toBeDefined();
  });

  it("已选择 Provider 时不应再将 prompt cache 提示组件常驻挂到输入区顶部", async () => {
    const { container } = renderInputbar({
      providerType: "custom-provider-id",
      setProviderType: vi.fn(),
      model: "glm-5.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="inputbar-prompt-cache-warning"]'),
    ).toBeNull();
  });

  it("生成工作区应使用继续推进型输入提示", async () => {
    renderInputbar({
      variant: "workspace",
      contextVariant: "task-center",
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
    expect(latestCall.placeholder).toContain(
      "继续补充当前生成任务，或回到左侧继续旧历史",
    );
  });

  it("工作区工作流在待启动状态下不应显示闸门条", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      workflowGate: {
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

  it("工作区工作流闸门快捷操作应能快速填充输入", async () => {
    const setInput = vi.fn();
    const { container } = renderInputbar({
      variant: "workspace",
      setInput,
      workflowGate: {
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

  it("工作区工作流生成中应展示任务面板并支持停止", async () => {
    const onStop = vi.fn();
    const { container } = renderInputbar({
      variant: "workspace",
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

    expect(container.textContent).toContain("任务视图");
    expect(container.textContent).toContain("检索项目素材");
    expect(container.textContent).toContain("任务队列");
    expect(container.querySelector('[data-testid="inputbar-core"]')).toBeNull();

    const stopButton = container.querySelector(
      '[data-testid="workflow-stop"]',
    ) as HTMLButtonElement | null;
    expect(stopButton).toBeTruthy();
    act(() => {
      stopButton?.click();
    });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("工作区工作流生成中应支持折叠与展开待办列表", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
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
    ).find((button) => button.getAttribute("aria-label") === "折叠任务队列");
    expect(collapseButton).toBeTruthy();

    act(() => {
      collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    ).toHaveLength(0);

    const expandButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "展开任务队列",
    );
    expect(expandButton).toBeTruthy();

    act(() => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    ).toHaveLength(2);
  });

  it("工作区任务队列应展示统一进度计数并按优先级排序", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      workflowSteps: [
        { id: "done", title: "完成选题", status: "completed" },
        { id: "pending", title: "等待补充案例", status: "pending" },
        { id: "active", title: "撰写主稿", status: "active" },
        { id: "error", title: "封面生成失败", status: "error" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("已完成 1/4");

    const queueItems = Array.from(
      container.querySelectorAll('[data-testid="workflow-queue-item"]'),
    );
    expect(queueItems.map((item) => item.getAttribute("data-status"))).toEqual([
      "active",
      "error",
      "pending",
    ]);
  });

  it("工作区工作流在 auto_running 状态下应展示生成面板（不依赖 isLoading）", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: false,
      workflowRunState: "auto_running",
      workflowSteps: [
        { id: "research", title: "检索项目素材", status: "active" },
        { id: "write", title: "编写正文草稿", status: "pending" },
      ],
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("任务视图");
    expect(container.textContent).toContain("检索项目素材");
    expect(container.querySelector('[data-testid="inputbar-core"]')).toBeNull();
  });

  it("工作区工作流在 await_user_decision 状态下应显示输入框", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      isLoading: true,
      workflowRunState: "await_user_decision",
      workflowGate: {
        key: "topic_select",
        title: "等待用户确认选题",
        status: "waiting",
        description: "等待你确认后继续推进下一步。",
      },
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
    expect(container.textContent).toContain("任务视图");
    expect(container.textContent).toContain("等待用户确认选题");
    expect(container.textContent).not.toContain("正在生成中");
  });
});
