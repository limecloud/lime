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

vi.mock("../skill-selection/CuratedTaskBadge", () => ({
  CuratedTaskBadge: (props: {
    referenceEntries?: Array<{ id: string; sourceKind?: string }>;
  }) => (
    <div
      data-testid="empty-state-curated-task-badge"
      data-reference-count={String(props.referenceEntries?.length ?? 0)}
      data-first-source-kind={props.referenceEntries?.[0]?.sourceKind ?? ""}
    />
  ),
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
    onSelectInputCapability: vi.fn(),
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

function updateTextareaValue(
  textarea: HTMLTextAreaElement | null,
  value: string,
) {
  expect(textarea).toBeTruthy();

  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;

  act(() => {
    valueSetter?.call(textarea, value);
    textarea?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("EmptyStateComposerPanel", () => {
  it("已开启的偏好若缺少 runtime current tools，也不应再显示页级告警", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      webSearchEnabled: true,
      subagentEnabled: true,
    });

    expect(
      container.querySelector(
        '[data-testid="empty-state-runtime-tool-warning"]',
      ),
    ).toBeNull();
    expect(container.textContent).not.toContain("当前 runtime tool surface");
    expect(container.textContent).not.toContain("联网搜索偏好本轮可能不会生效");
    expect(container.textContent).not.toContain(
      "任务拆分偏好本轮可能不会完全生效",
    );
  });

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

  it("输入为空时展示 Tab 起手建议，按 Tab 后填入当前建议", async () => {
    const container = renderPanel({
      inputSuggestions: [
        {
          id: "suggestion-email",
          label: "帮我写一封工作邮件",
          prompt: "请帮我写一封工作邮件。",
          order: 10,
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="home-input-tab-suggestion"]')
        ?.textContent,
    ).toContain("帮我写一封工作邮件");

    const textarea = container.querySelector("textarea");
    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(
      (container.querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("请帮我写一封工作邮件。");
    expect(
      container.querySelector('[data-testid="home-input-tab-suggestion"]'),
    ).toBeNull();
  });

  it("Shift+Tab 保持焦点切换，不填入起手建议", () => {
    const container = renderPanel({
      inputSuggestions: [
        {
          id: "suggestion-email",
          label: "帮我写一封工作邮件",
          prompt: "请帮我写一封工作邮件。",
          order: 10,
        },
      ],
    });

    const textarea = container.querySelector("textarea");
    act(() => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      (container.querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  it("引导帮助模式应展示可关闭的上下文 badge 并隐藏 Tab 起手建议", () => {
    const onClearGuideHelp = vi.fn();
    const container = renderPanel({
      guideHelpActive: true,
      guideHelpLabel: "Lime 引导帮助",
      onClearGuideHelp,
      inputSuggestions: [
        {
          id: "suggestion-meeting",
          label: "帮我整理一下会议纪要",
          prompt: "帮我整理一下会议纪要。",
          order: 10,
        },
      ],
    });

    expect(
      container.querySelector('[data-testid="home-guide-help-active-badge"]')
        ?.textContent,
    ).toContain("Lime 引导帮助");
    expect(
      container.querySelector('[data-testid="home-guide-help-toolbar-badge"]')
        ?.textContent,
    ).toContain("引导帮助");
    expect(
      container.querySelector('[data-testid="home-input-tab-suggestion"]'),
    ).toBeNull();

    const closeButton = container.querySelector(
      '[data-testid="home-guide-help-active-badge"] button',
    ) as HTMLButtonElement | null;
    act(() => {
      closeButton?.click();
    });

    expect(onClearGuideHelp).toHaveBeenCalledTimes(1);

    const toolbarCloseButton = container.querySelector(
      '[data-testid="home-guide-help-toolbar-badge"]',
    ) as HTMLButtonElement | null;
    act(() => {
      toolbarCloseButton?.click();
    });

    expect(onClearGuideHelp).toHaveBeenCalledTimes(2);
  });

  it("存在当前带入的灵感时，应在输入区顶部展示被带入的参考对象", () => {
    const container = renderPanel({
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

    expect(container.textContent).toContain("参考");
    expect(container.textContent).toContain("品牌风格样本");
  });

  it("首页输入区应直接聚焦输入主路径，不再展示额外起始卡片", () => {
    const container = renderPanel();
    const textarea = container.querySelector("textarea");

    expect(
      container.querySelector('[data-testid="empty-state-kickoff-guide"]'),
    ).toBeNull();
    expect(textarea).toBeTruthy();
  });

  it("带入项目参考时，应继续在输入区顶部展示参考对象", () => {
    const container = renderPanel({
      projectId: "project-1",
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

    expect(
      container.querySelector('[data-testid="empty-state-kickoff-guide"]'),
    ).toBeNull();
    expect(container.textContent).toContain("参考");
    expect(container.textContent).toContain("品牌风格样本");
  });

  it("首页输入区已激活复盘模板时，应把 sceneapp 项目结果引用继续透传给 badge", () => {
    const container = renderPanel({
      activeCapability: {
        kind: "curated_task",
        task: {
          id: "account-project-review",
          title: "复盘这个账号/项目",
          summary: "围绕已有结果判断当前该怎么推进。",
          outputHint: "判断摘要 + 下一步建议",
          resultDestination: "判断摘要会先回到当前内容。",
          categoryLabel: "判断与优化",
          prompt: "请帮我判断这个账号或项目当前该怎么推进",
          requiredInputs: ["账号或项目目标", "已有结果或数据"],
          requiredInputFields: [],
          optionalReferences: ["最近内容链接"],
          outputContract: ["判断摘要", "下一轮动作建议"],
          followUpActions: ["继续做趋势摘要"],
          badge: "结果模板",
          actionLabel: "进入生成",
          statusLabel: "可直接开始",
          statusTone: "emerald",
          recentUsedAt: null,
          isRecent: false,
        },
        referenceEntries: [
          {
            id: "sceneapp:content-pack:run:1",
            sourceKind: "sceneapp_execution_summary",
            title: "AI 内容周报",
            summary: "当前已有一轮项目结果，可直接作为复盘基线。",
            category: "experience",
            categoryLabel: "成果",
            tags: ["复盘"],
          },
        ],
      },
    });

    const badge = container.querySelector(
      '[data-testid="empty-state-curated-task-badge"]',
    ) as HTMLDivElement | null;

    expect(badge?.dataset.referenceCount).toBe("1");
    expect(badge?.dataset.firstSourceKind).toBe("sceneapp_execution_summary");
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

  it("发送时应把本地草稿显式传给首页发送链", () => {
    const onSend = vi.fn();
    const container = renderPanel({ onSend });
    const textarea = container.querySelector("textarea");

    updateTextareaValue(textarea, "帮我快速开一个新对话");

    const sendButton = container.querySelector(
      'button[title="发送"]',
    ) as HTMLButtonElement | null;

    expect(sendButton?.disabled).toBe(false);

    act(() => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSend).toHaveBeenCalledWith("帮我快速开一个新对话");
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

    expect(
      container.querySelector('[data-testid="team-suggestion-bar"]'),
    ).toBeNull();
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
      container.querySelector('button[title="任务拆分偏好已关闭"]'),
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
      container.querySelector('button[title="任务拆分偏好已关闭"]'),
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
      'button[title="任务拆分偏好已关闭"]',
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
      'button[title="任务拆分偏好已开启"]',
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
      container.querySelector('button[title="任务拆分偏好已关闭"]'),
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
      container.querySelector('button[title="任务拆分偏好已关闭"]'),
    ).toBeNull();
    expect(enableButton).toBeTruthy();
    expect(enableButton?.textContent).toContain("启用任务分工");
    const suggestionBar = container.querySelector(
      '[data-testid="team-suggestion-bar"]',
    );
    expect(suggestionBar).toBeTruthy();
    expect(suggestionBar?.textContent).toContain("分工建议");
  });

  it("折叠态应显示只读模型信息，展开高级设置后再允许修改", () => {
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
