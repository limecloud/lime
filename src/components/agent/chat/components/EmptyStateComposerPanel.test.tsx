import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyStateComposerPanel } from "./EmptyStateComposerPanel";

vi.mock("./ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="empty-state-model-selector" />,
}));

vi.mock("./Inputbar/components/CharacterMention", () => ({
  CharacterMention: () => <div data-testid="empty-state-character-mention" />,
}));

vi.mock("./Inputbar/components/SkillBadge", () => ({
  SkillBadge: () => <div data-testid="empty-state-skill-badge" />,
}));

vi.mock("./Inputbar/components/SkillSelector", () => ({
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
    executionStrategyLabel: "ReAct",
    setExecutionStrategy: vi.fn(),
    onManageProviders: vi.fn(),
    isGeneralTheme: false,
    isEntryTheme: false,
    entryTaskType: "direct",
    entryTaskTypes: [],
    getEntryTaskTemplate: vi.fn(),
    entryTemplate: {
      type: "direct",
      label: "直接写作",
      description: "直接按需求写作",
      pattern: "{input}",
      slots: [],
    },
    entryPreview: "",
    entrySlotValues: {},
    onEntryTaskTypeChange: vi.fn(),
    onEntrySlotChange: vi.fn(),
    characters: [],
    skills: [],
    activeSkill: null,
    setActiveSkill: vi.fn(),
    clearActiveSkill: vi.fn(),
    isSkillsLoading: false,
    onNavigateToSettings: vi.fn(),
    onImportSkill: vi.fn(),
    onRefreshSkills: vi.fn(),
    showCreationModeSelector: false,
    creationMode: "guided",
    onCreationModeChange: vi.fn(),
    platform: "xiaohongshu",
    setPlatform: vi.fn(),
    depth: "deep",
    setDepth: vi.fn(),
    ratio: "3:4",
    setRatio: vi.fn(),
    style: "minimal",
    setStyle: vi.fn(),
    ratioPopoverOpen: false,
    setRatioPopoverOpen: vi.fn(),
    stylePopoverOpen: false,
    setStylePopoverOpen: vi.fn(),
    thinkingEnabled: false,
    onThinkingEnabledChange: vi.fn(),
    taskEnabled: false,
    onTaskEnabledChange: vi.fn(),
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
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const StatefulPanel = () => {
    const [subagentEnabled, setSubagentEnabled] = React.useState(false);
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
        executionStrategyLabel="ReAct"
        setExecutionStrategy={vi.fn()}
        onManageProviders={vi.fn()}
        isGeneralTheme
        isEntryTheme={false}
        entryTaskType="direct"
        entryTaskTypes={[]}
        getEntryTaskTemplate={vi.fn()}
        entryTemplate={{
          type: "direct",
          label: "直接写作",
          description: "直接按需求写作",
          pattern: "{input}",
          slots: [],
        }}
        entryPreview=""
        entrySlotValues={{}}
        onEntryTaskTypeChange={vi.fn()}
        onEntrySlotChange={vi.fn()}
        characters={[]}
        skills={[]}
        activeSkill={null}
        setActiveSkill={vi.fn()}
        clearActiveSkill={vi.fn()}
        isSkillsLoading={false}
        onNavigateToSettings={vi.fn()}
        onImportSkill={vi.fn()}
        onRefreshSkills={vi.fn()}
        showCreationModeSelector={false}
        creationMode="guided"
        onCreationModeChange={vi.fn()}
        platform="xiaohongshu"
        setPlatform={vi.fn()}
        depth="deep"
        setDepth={vi.fn()}
        ratio="3:4"
        setRatio={vi.fn()}
        style="minimal"
        setStyle={vi.fn()}
        ratioPopoverOpen={false}
        setRatioPopoverOpen={vi.fn()}
        stylePopoverOpen={false}
        setStylePopoverOpen={vi.fn()}
        thinkingEnabled={false}
        onThinkingEnabledChange={vi.fn()}
        taskEnabled={false}
        onTaskEnabledChange={vi.fn()}
        subagentEnabled={subagentEnabled}
        onSubagentEnabledChange={setSubagentEnabled}
        webSearchEnabled={false}
        onWebSearchEnabledChange={vi.fn()}
        pendingImages={[]}
        onFileSelect={vi.fn()}
        onPaste={vi.fn()}
        onRemoveImage={vi.fn()}
        {...props}
      />
    );
  };

  act(() => {
    root.render(<StatefulPanel />);
  });

  mountedRoots.push({ root, container });
  return container;
}

describe("EmptyStateComposerPanel", () => {
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

    expect(container.querySelector('img[alt="待发送图片 1"]')).toBeTruthy();

    const removeButton = container.querySelector(
      'button[aria-label="移除待发送图片 1"]',
    ) as HTMLButtonElement | null;

    expect(removeButton).toBeTruthy();

    act(() => {
      removeButton?.click();
    });

    expect(onRemoveImage).toHaveBeenCalledWith(0);
  });

  it("复杂任务应显示 Team 建议并支持开启多代理", () => {
    const onSubagentEnabledChange = vi.fn();
    const container = renderPanel({
      isGeneralTheme: true,
      input:
        "请帮我分析这个 Rust GUI 多代理实现差异，拆分任务并行推进，再补回归测试和最终汇总结论。",
      onSubagentEnabledChange,
    });

    expect(container.textContent).toContain("当前任务更适合 Team 协作");
    expect(container.textContent).toContain("建议角色：分析");

    const enableTeamButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("启用 Team"));

    expect(enableTeamButton).toBeTruthy();

    act(() => {
      enableTeamButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubagentEnabledChange).toHaveBeenCalledWith(true);
  });

  it("继续单代理后应隐藏当前输入对应的 Team 建议", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      input:
        "请把任务拆成多个子任务分别分析、实现、验证，并在最后统一汇总输出。",
      onSubagentEnabledChange: vi.fn(),
    });

    const continueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("继续单代理"),
    );

    expect(continueButton).toBeTruthy();

    act(() => {
      continueButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(container.textContent).not.toContain("当前任务更适合 Team 协作");
  });

  it("开启 Team mode 后应显示 TeamSelector", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      subagentEnabled: true,
    });

    expect(
      container.querySelector('[data-testid="empty-state-team-selector"]'),
    ).toBeTruthy();
  });

  it("未开启 Team mode 时应显示显式开启按钮，并可直接启用", () => {
    const onSubagentEnabledChange = vi.fn();
    const container = renderPanel({
      isGeneralTheme: true,
      subagentEnabled: false,
      onSubagentEnabledChange,
    });

    const enableButton = container.querySelector(
      '[data-testid="empty-state-team-mode-enable-button"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeTruthy();
    expect(enableButton?.textContent).toContain("开启 Team");

    act(() => {
      enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSubagentEnabledChange).toHaveBeenCalledWith(true);
  });

  it("点击开启 Team 后应自动透传 Team 配置面板打开令牌", async () => {
    const container = renderStatefulPanel();

    const enableButton = container.querySelector(
      '[data-testid="empty-state-team-mode-enable-button"]',
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

  it("复杂任务但未开启 Team 时，首页开启按钮应显示推荐态", () => {
    const container = renderPanel({
      isGeneralTheme: true,
      subagentEnabled: false,
      input: "请拆成多个子任务分别分析、实现、验证，并最终统一回归验收",
    });

    const enableButton = container.querySelector(
      '[data-testid="empty-state-team-mode-enable-button"]',
    ) as HTMLButtonElement | null;

    expect(enableButton).toBeTruthy();
    expect(enableButton?.textContent).toContain("开启 Team");
    expect(enableButton?.textContent).toContain("推荐");
  });
});
