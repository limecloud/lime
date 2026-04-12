import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyStateComposerPanel } from "./EmptyStateComposerPanel";
import {
  createSkillSelectionProps,
  type SkillSelectionProps,
} from "../skill-selection/skillSelectionBindings";

vi.mock("./ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="empty-state-model-selector" />,
}));

vi.mock("../skill-selection/CharacterMention", () => ({
  CharacterMention: () => <div data-testid="empty-state-character-mention" />,
}));

vi.mock("../skill-selection/SkillBadge", () => ({
  SkillBadge: () => <div data-testid="empty-state-skill-badge" />,
}));

vi.mock("../skill-selection/SkillSelector", () => ({
  SkillSelector: () => <div data-testid="empty-state-skill-selector" />,
}));

vi.mock("./Inputbar/components/TeamSelector", () => ({
  TeamSelector: (props: { autoOpenToken?: number | null }) => (
    <div
      data-testid="empty-state-team-selector"
      data-auto-open-token={String(props.autoOpenToken ?? "")}
    />
  ),
}));

const mockSelectedTeam = {
  id: "frontend-triage-team",
  source: "builtin" as const,
  label: "前端联调团队",
  description: "分析、实现、验证三段式推进。",
  roles: [
    {
      id: "analysis",
      label: "分析",
      summary: "负责拆解问题。",
    },
  ],
};

function createGithubSearchServiceSkill() {
  return {
    id: "github-repo-radar",
    title: "GitHub 仓库线索检索",
    summary: "复用 GitHub 登录态检索项目。",
    category: "情报研究",
    outputHint: "仓库列表 + 关键线索",
    source: "cloud_catalog" as const,
    runnerType: "instant" as const,
    defaultExecutorBinding: "browser_assist" as const,
    executionLocation: "client_default" as const,
    version: "seed-v1",
    badge: "云目录",
    recentUsedAt: null,
    isRecent: false,
    runnerLabel: "浏览器站点执行",
    runnerTone: "emerald" as const,
    runnerDescription: "直接复用浏览器登录态执行。",
    actionLabel: "启动采集",
    automationStatus: null,
    slotSchema: [
      {
        key: "repository_query",
        label: "检索主题",
        type: "text" as const,
        required: true,
        placeholder: "例如 AI Agent",
      },
    ],
    siteCapabilityBinding: {
      adapterName: "github/search",
      autoRun: true,
      requireAttachedSession: true,
      saveMode: "current_content" as const,
      slotArgMap: {
        repository_query: "query",
      },
      fixedArgs: {
        limit: 10,
      },
    },
  };
}

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

function createSkillSelection(
  overrides: Partial<SkillSelectionProps> = {},
): SkillSelectionProps {
  return createSkillSelectionProps({
    skills: [],
    onSelectSkill: vi.fn(),
    onClearSkill: vi.fn(),
    onNavigateToSettings: vi.fn(),
    onImportSkill: vi.fn(),
    onRefreshSkills: vi.fn(),
    ...overrides,
  });
}

function renderPanel(
  props?: Partial<React.ComponentProps<typeof EmptyStateComposerPanel>>,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const defaultProps: React.ComponentProps<typeof EmptyStateComposerPanel> = {
    input: "",
    setInput: vi.fn(),
    placeholder: "输入内容",
    onSend: vi.fn(),
    activeTheme: "general",
    providerType: "openai",
    setProviderType: vi.fn(),
    model: "gpt-4.1",
    setModel: vi.fn(),
    executionStrategy: "react",
    setExecutionStrategy: vi.fn(),
    onManageProviders: vi.fn(),
    isGeneralTheme: false,
    characters: [],
    skillSelection: createSkillSelection(),
    showCreationModeSelector: false,
    creationMode: "guided",
    onCreationModeChange: vi.fn(),
    thinkingEnabled: false,
    onThinkingEnabledChange: vi.fn(),
    subagentEnabled: false,
    onSubagentEnabledChange: vi.fn(),
    webSearchEnabled: false,
    onWebSearchEnabledChange: vi.fn(),
    pendingImages: [],
    onFileSelect: vi.fn(),
    onPaste: vi.fn(),
    onRemoveImage: vi.fn(),
  };

  act(() => {
    root.render(<EmptyStateComposerPanel {...defaultProps} {...props} />);
  });

  mountedRoots.push({ root, container });
  return container;
}

function renderStatefulPanel(
  props?: Partial<React.ComponentProps<typeof EmptyStateComposerPanel>>,
  initialSubagentEnabled = false,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const {
    subagentEnabled: _ignoredSubagentEnabled,
    onSubagentEnabledChange: _ignoredOnSubagentEnabledChange,
    ...restProps
  } = props || {};

  const StatefulPanel = () => {
    const [subagentEnabled, setSubagentEnabled] = React.useState(
      initialSubagentEnabled,
    );
    return (
      <EmptyStateComposerPanel
        input=""
        setInput={vi.fn()}
        placeholder="输入内容"
        onSend={vi.fn()}
        activeTheme="general"
        providerType="openai"
        setProviderType={vi.fn()}
        model="gpt-4.1"
        setModel={vi.fn()}
        executionStrategy="react"
        setExecutionStrategy={vi.fn()}
        onManageProviders={vi.fn()}
        isGeneralTheme
        characters={[]}
        skillSelection={createSkillSelection()}
        showCreationModeSelector={false}
        creationMode="guided"
        onCreationModeChange={vi.fn()}
        thinkingEnabled={false}
        onThinkingEnabledChange={vi.fn()}
        subagentEnabled={subagentEnabled}
        onSubagentEnabledChange={setSubagentEnabled}
        webSearchEnabled={false}
        onWebSearchEnabledChange={vi.fn()}
        pendingImages={[]}
        onFileSelect={vi.fn()}
        onPaste={vi.fn()}
        onRemoveImage={vi.fn()}
        {...restProps}
      />
    );
  };

  act(() => {
    root.render(<StatefulPanel />);
  });

  mountedRoots.push({ root, container });
  return container;
}

function expandAdvancedControls(container: HTMLDivElement) {
  const toggleButton = container.querySelector(
    '[data-testid="empty-state-advanced-toggle"]',
  ) as HTMLButtonElement | null;

  expect(toggleButton).toBeTruthy();

  act(() => {
    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  return toggleButton;
}

describe("EmptyStateComposerPanel", () => {
  it("首页空态输入区默认隐藏技能入口，展开高级设置后与 @ 面板共用同一技能入口", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      skillSelection: createSkillSelection({
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
      }),
    });

    expect(
      container.querySelector('[data-testid="empty-state-character-mention"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="empty-state-skill-selector"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    expect(
      container.querySelector('[data-testid="empty-state-skill-selector"]'),
    ).toBeTruthy();
  });

  it("首页空态输入区应使用新的浮层输入壳，而不是旧默认输入壳", () => {
    const container = renderPanel({
      isGeneralTheme: true,
    });

    const composer = container.querySelector(
      '[data-testid="inputbar-core-container"]',
    ) as HTMLDivElement | null;

    expect(composer).toBeTruthy();
    expect(composer?.className).toContain("floating-composer");
  });

  it("通用对话且存在站点型 service skill 时不应再展示首页专属提示按钮", () => {
    const container = renderPanel({
      input: "",
      isGeneralTheme: true,
      skillSelection: createSkillSelection({
        serviceSkills: [createGithubSearchServiceSkill()],
      }),
    });

    const hint = container.querySelector(
      '[data-testid="empty-state-site-skill-natural-hint"]',
    );

    expect(hint).toBeFalsy();
  });

  it("应将 onPaste 绑定到输入框", () => {
    const onPaste = vi.fn();
    const container = renderPanel({ onPaste });
    const textarea = container.querySelector("textarea");

    expect(textarea).toBeTruthy();

    act(() => {
      textarea?.dispatchEvent(new Event("paste", { bubbles: true }));
    });

    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it("发送准备中应禁用首页发送入口并展示忙碌态", () => {
    const onSend = vi.fn();
    const container = renderPanel({
      input: "请帮我梳理首页首次发送链路",
      isLoading: true,
      disabled: true,
      onSend,
    });

    const textarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    const pendingButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("稍后处理"),
    ) as HTMLButtonElement | undefined;

    expect(textarea?.disabled).toBe(true);
    expect(pendingButton).toBeTruthy();
    expect(pendingButton?.disabled).toBe(true);
    expect(container.querySelector('button[title="发送"]')).toBeNull();

    act(() => {
      pendingButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("有待发送图片时应显示预览并支持删除", () => {
    const onRemoveImage = vi.fn();
    const container = renderPanel({
      pendingImages: [
        {
          data: "aGVsbG8=",
          mediaType: "image/png",
        },
      ],
      onRemoveImage,
    });

    expect(container.querySelector('img[alt="预览 1"]')).toBeTruthy();

    const removeButton = container.querySelector(
      'button[aria-label="移除图片 1"]',
    ) as HTMLButtonElement | null;

    expect(removeButton).toBeTruthy();

    act(() => {
      removeButton?.click();
    });

    expect(onRemoveImage).toHaveBeenCalledWith(0);
  });

  it("复杂任务应显示任务分工建议并支持开启多代理", () => {
    const onSubagentEnabledChange = vi.fn();
    const container = renderPanel({
      isGeneralTheme: true,
      input:
        "请帮我分析这个 Rust GUI 多代理实现差异，拆分任务并行推进，再补回归测试和最终汇总结论。",
      onSubagentEnabledChange,
    });

    expect(container.textContent).toContain("当前任务更适合分工推进");
    expect(container.textContent).toContain("建议角色：分析");

    const enableTeamButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("启用任务分工"));

    expect(enableTeamButton).toBeTruthy();

    act(() => {
      enableTeamButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onSubagentEnabledChange).toHaveBeenCalledWith(true);
  });

  it("继续单代理后应隐藏当前输入对应的任务分工建议", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      input:
        "请把任务拆成多个子任务分别分析、实现、验证，并在最后统一汇总输出。",
      onSubagentEnabledChange: vi.fn(),
    });

    const continueButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("继续单代理"));

    expect(continueButton).toBeTruthy();

    act(() => {
      continueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("当前任务更适合分工推进");
  });

  it("开启 Team mode 后应显示 TeamSelector", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      subagentEnabled: true,
    });

    expect(
      container.querySelector('[data-testid="empty-state-team-selector"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    expect(
      container.querySelector('[data-testid="empty-state-team-selector"]'),
    ).toBeTruthy();
  });

  it("未开启 Team mode 时默认不暴露多代理开关，只保留高级设置入口", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      subagentEnabled: false,
    });

    expect(
      container.querySelector('[data-testid="empty-state-team-selector"]'),
    ).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="empty-state-team-mode-enable-button"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('button[title="多代理偏好已关闭"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="empty-state-advanced-toggle"]'),
    ).toBeTruthy();
  });

  it("应通过高级设置中的 Plan 开关透传执行策略切换，不再渲染执行模式下拉", () => {
    const setExecutionStrategy = vi.fn();
    const container = renderPanel({
      executionStrategy: "react",
      setExecutionStrategy,
    });

    expect(
      container.querySelector('[data-testid="inputbar-plan-toggle"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    const planToggle = container.querySelector(
      '[data-testid="inputbar-plan-toggle"]',
    ) as HTMLButtonElement | null;

    expect(planToggle).toBeTruthy();
    expect(container.textContent).not.toContain("ReAct");
    expect(container.textContent).not.toContain("Auto");

    act(() => {
      planToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(setExecutionStrategy).toHaveBeenCalledWith("code_orchestrated");
  });

  it("即使已经保留 Team 方案，关闭 Team mode 后也不应显示 TeamSelector", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      subagentEnabled: false,
      selectedTeam: mockSelectedTeam,
    });

    expect(
      container.querySelector('[data-testid="empty-state-team-selector"]'),
    ).toBeNull();

    const enableButton = container.querySelector(
      '[data-testid="empty-state-team-mode-enable-button"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeNull();
    expect(
      container.querySelector('button[title="多代理偏好已关闭"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="empty-state-advanced-toggle"]'),
    ).toBeTruthy();
  });

  it("命中稳妥模式模型时不应再展示额外横幅", () => {
    const container = renderPanel({
      providerType: "openai",
      model: "glm-4.7",
    });

    expect(
      container.querySelector(
        '[data-testid="empty-state-stable-processing-notice"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("稳妥模式");
  });

  it("点击多代理图标后应自动透传 Team 配置面板打开令牌", async () => {
    const container = renderStatefulPanel();

    expandAdvancedControls(container);

    const enableButton = container.querySelector(
      'button[title="多代理偏好已关闭"]',
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
      '[data-testid="empty-state-team-selector"]',
    ) as HTMLDivElement | null;

    expect(teamSelector).toBeTruthy();
    expect(teamSelector?.getAttribute("data-auto-open-token")).toBe("1");
  });

  it("关闭多代理偏好后应立即隐藏 TeamSelector 并回到显式开启入口", async () => {
    const container = renderStatefulPanel(
      {
        selectedTeam: mockSelectedTeam,
      },
      true,
    );

    expandAdvancedControls(container);

    expect(
      container.querySelector('[data-testid="empty-state-team-selector"]'),
    ).toBeTruthy();

    const toggleButton = container.querySelector(
      'button[title="多代理偏好已开启"]',
    ) as HTMLButtonElement | null;

    expect(toggleButton).toBeTruthy();

    act(() => {
      toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="empty-state-team-selector"]'),
    ).toBeNull();
    expect(
      container.querySelector('button[title="多代理偏好已关闭"]'),
    ).toBeTruthy();
  });

  it("复杂任务但未开启 Team 时，首页保留推荐提示但不再渲染重复入口", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      subagentEnabled: false,
      input: "请拆成多个子任务分别分析、实现、验证，并最终统一回归验收",
    });

    const enableButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("启用任务分工"),
    ) as HTMLButtonElement | undefined;

    expect(
      container.querySelector(
        '[data-testid="empty-state-team-mode-enable-button"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('button[title="多代理偏好已关闭"]'),
    ).toBeNull();
    expect(enableButton).toBeTruthy();
    expect(enableButton?.textContent).toContain("启用任务分工");
    expect(container.textContent).toContain("当前任务更适合分工推进");
  });

  it("折叠态应保留当前模型轻提示，展开高级设置后再允许修改", () => {
    const container = renderPanel({
      providerType: "claude",
      model: "claude-sonnet-4-5",
    });

    expect(container.textContent).toContain("当前模型");
    expect(container.textContent).toContain("claude-sonnet-4-5");
    expect(
      container.querySelector('[data-testid="empty-state-model-selector"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    expect(
      container.querySelector('[data-testid="empty-state-model-selector"]'),
    ).toBeTruthy();
  });

  it("应在高级设置中渲染权限模式选择并透传切换", () => {
    const setAccessMode = vi.fn();
    const container = renderPanel({
      accessMode: "current",
      setAccessMode,
    });

    expect(
      container.querySelector('[data-testid="inputbar-access-mode-select"]'),
    ).toBeNull();

    expandAdvancedControls(container);

    const select = container.querySelector(
      '[data-testid="inputbar-access-mode-select"]',
    ) as HTMLSelectElement | null;

    expect(select).toBeTruthy();
    expect(select?.value).toBe("current");

    act(() => {
      if (select) {
        select.value = "full-access";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(setAccessMode).toHaveBeenCalledWith("full-access");
  });
});
