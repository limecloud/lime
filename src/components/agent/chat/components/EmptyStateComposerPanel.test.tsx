import {
  getComposerEditorText,
  setComposerEditorText,
} from "@/components/input-kit/composerEditor.testUtils";
import { act } from "react";
import { changeLimeLocale } from "@/i18n/createI18n";
import { describe, expect, it, vi } from "vitest";
import {
  createSkillSelection,
  openContextSuggestions,
  renderPanel,
  TEST_EN_COMPOSER_COPY,
  TEST_EN_INPUTBAR_CORE_COPY,
} from "./EmptyStateComposerPanel.testFixtures";

describe("EmptyStateComposerPanel", () => {
  it("已开启的偏好若缺少 runtime current tools，也不应再显示页级告警", () => {
    const container = renderPanel({
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
      "Subagents 本轮可能不会完全生效",
    );
  });

  it("首页 + 与 typed @ 使用同一个建议视图，空查询隐藏 Skills", async () => {
    const container = renderPanel({
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
    const editor = container.querySelector<HTMLElement>(
      '[data-testid="composer-editor"]',
    )!;
    openContextSuggestions(container);
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    expect(
      document.querySelector('[data-suggestion-key="skill:writer"]'),
    ).toBeNull();
    act(() => setComposerEditorText(editor, "@写作"));
    expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
    const skill = document.querySelector<HTMLButtonElement>(
      '[data-suggestion-key="skill:writer"]',
    )!;
    expect(skill).toBeTruthy();
    await act(async () => skill.click());
    expect(editor.querySelector('[data-composer-token="skill"]')).toBeTruthy();
    expect(document.activeElement).toBe(editor);
  });

  it("打开共享建议时加载插件，loading 和错误显示明确状态", () => {
    const onPluginSuggestionsNeeded = vi.fn();
    const container = renderPanel({
      onPluginSuggestionsNeeded,
      pluginSuggestionsLoading: true,
    });
    openContextSuggestions(container);
    expect(onPluginSuggestionsNeeded).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "加载中…",
    );
  });

  it("首页选择插件保留正文和 editor，删除 atom 不会自动恢复", async () => {
    const container = renderPanel({
      input: "整理今天的选题",
      pluginSuggestions: [
        { pluginId: "content-workbench", displayName: "内容工厂" },
      ],
    });
    const editor = container.querySelector<HTMLElement>(
      '[data-testid="composer-editor"]',
    )!;
    openContextSuggestions(container);
    const item = document.querySelector<HTMLButtonElement>(
      '[data-suggestion-key="plugin:content-workbench"]',
    )!;
    await act(async () => item.click());
    expect(
      editor.querySelector('[data-composer-token="plugin"]')?.textContent,
    ).toContain("内容工厂");
    expect(getComposerEditorText(editor)).toBe("整理今天的选题 @内容工厂");
    expect(document.activeElement).toBe(editor);
    act(() => setComposerEditorText(editor, "整理今天的选题"));
    expect(editor.querySelector('[data-composer-token="plugin"]')).toBeNull();
  });

  it("插件名称为空时显示实际 plugin id，阻断插件不能写入文档", async () => {
    const container = renderPanel({
      pluginSuggestions: [
        { pluginId: "content-workbench", displayName: " " },
        {
          pluginId: "blocked",
          displayName: "Blocked",
          blockerCodes: ["login"],
        },
      ],
    });
    openContextSuggestions(container);
    const item = document.querySelector<HTMLButtonElement>(
      '[data-suggestion-key="plugin:content-workbench"]',
    )!;
    expect(item.textContent).toContain("content-workbench");
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-suggestion-key="plugin:blocked"]',
      )!.disabled,
    ).toBe(true);
    await act(async () => item.click());
    expect(
      container.querySelector('[data-composer-token="plugin"]')?.textContent,
    ).toContain("content-workbench");
  });

  it("首页空态输入区应使用紧凑输入壳，避免遮挡主视觉", () => {
    const container = renderPanel({});

    const composer = container.querySelector(
      '[data-testid="inputbar-core-container"]',
    ) as HTMLDivElement | null;

    expect(composer).toBeTruthy();
    expect(composer?.className).not.toContain("floating-composer");
  });

  it("首页空态输入区应在右下角显示语音和发送主操作", () => {
    const container = renderPanel({});

    const primaryActions = container.querySelector(
      '[data-testid="inputbar-primary-actions"]',
    );
    const dictationButton = container.querySelector(
      '[data-testid="inputbar-dictation-toggle"]',
    ) as HTMLButtonElement | null;
    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;

    expect(primaryActions).toBeTruthy();
    expect(dictationButton).toBeTruthy();
    expect(dictationButton?.textContent).toBe("");
    expect(
      dictationButton?.closest('[data-testid="inputbar-primary-actions"]'),
    ).toBe(primaryActions);
    expect(
      sendButton?.closest('[data-testid="inputbar-primary-actions"]'),
    ).toBe(primaryActions);
    expect(
      container.querySelector('[data-testid="inputbar-expand-toggle"]'),
    ).toBeNull();
  });

  it("首页项目栏应连接在同一个输入壳内以继承聚焦态", () => {
    const container = renderPanel({
      projectId: "default",
      openedProjects: [
        {
          id: "default",
          name: "默认项目",
          rootPath: "/workspace/default",
        },
      ],
      projectContextModeLabel: "本地模式",
    });

    const connectedComposer = container.querySelector(
      '[data-testid="inputbar-connected-composer"]',
    );
    const composer = container.querySelector(
      '[data-testid="inputbar-core-container"]',
    );
    const projectContextSlot = container.querySelector(
      '[data-testid="inputbar-context-bar-slot"]',
    );

    expect(connectedComposer).toBeTruthy();
    expect(composer).toBeTruthy();
    expect(projectContextSlot).toBeTruthy();
    expect(connectedComposer?.contains(composer ?? null)).toBe(true);
    expect(connectedComposer?.contains(projectContextSlot ?? null)).toBe(true);
  });

  it("没有真实项目时不应把 UUID 会话号显示成项目", () => {
    const staleProjectId = "240ed157-3e7a-456c-a2c2-a05d499f5991";
    const container = renderPanel({
      projectId: staleProjectId,
      openedProjects: [
        {
          id: staleProjectId,
          name: staleProjectId,
          rootPath: null,
        },
      ],
    });

    const trigger = container.querySelector(
      '[data-testid="composer-utility-project-trigger"]',
    ) as HTMLButtonElement | null;

    expect(trigger?.textContent).toContain("选择项目");
    expect(trigger?.textContent).not.toContain(staleProjectId);
    expect(container.textContent).not.toContain(staleProjectId);

    act(() => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const menu = document.body.querySelector(
      '[data-testid="composer-utility-menu"]',
    );
    expect(menu?.textContent).toContain("添加新项目");
    expect(menu?.textContent).toContain("继续普通对话");
    expect(menu?.textContent).not.toContain(staleProjectId);
  });

  it("首页空态输入区 chrome 文案应支持 en-US", async () => {
    await changeLimeLocale("en-US");
    const container = renderPanel({
      copy: TEST_EN_COMPOSER_COPY,
      inputbarCopy: TEST_EN_INPUTBAR_CORE_COPY,
    });

    const plusTrigger = container.querySelector(
      '[data-testid="inputbar-plus-trigger"]',
    ) as HTMLButtonElement | null;
    expect(plusTrigger?.getAttribute("aria-label")).toBe("Add context");
    expect(plusTrigger?.getAttribute("title")).toBe("Add context");
    expect(container.textContent).not.toContain("Current model");
    expect(
      container.querySelector('[data-testid="empty-state-model-selector"]'),
    ).toBeTruthy();

    expect(container.textContent).not.toContain("General task context");
  });

  it("首页 Plan 和 Goal 状态标签应在权限后显示，并可单独关闭", () => {
    const onTaskEnabledChange = vi.fn();
    const onObjectiveEnabledChange = vi.fn();
    const container = renderPanel({
      taskEnabled: true,
      onTaskEnabledChange,
      objectiveEnabled: true,
      onObjectiveEnabledChange,
      accessMode: "full-access",
      setAccessMode: vi.fn(),
    });

    const leftMeta = container.querySelector(
      '[data-testid="inputbar-meta-left"]',
    );
    const rightMeta = container.querySelector(
      '[data-testid="inputbar-meta-trailing"]',
    );
    const planChip = leftMeta?.querySelector(
      '[data-testid="empty-state-task-mode-status"]',
    ) as HTMLButtonElement | null;
    const objectiveChip = leftMeta?.querySelector(
      '[data-testid="empty-state-objective-status"]',
    ) as HTMLButtonElement | null;

    expect(
      leftMeta?.querySelector('[data-testid="inputbar-access-mode-select"]'),
    ).toBeTruthy();
    expect(planChip?.textContent).toContain("计划");
    expect(objectiveChip?.textContent).toContain("追求目标");
    expect(
      getComputedStyle(
        planChip?.querySelector(
          '[data-testid="empty-state-task-mode-status-remove-mark"]',
        ) as HTMLElement,
      ).opacity,
    ).toBe("0");
    expect(
      getComputedStyle(
        objectiveChip?.querySelector(
          '[data-testid="empty-state-objective-status-remove-mark"]',
        ) as HTMLElement,
      ).opacity,
    ).toBe("0");
    expect(
      leftMeta?.querySelector('[data-testid="empty-state-model-selector"]'),
    ).toBeNull();
    expect(
      rightMeta?.querySelector('[data-testid="empty-state-model-selector"]'),
    ).toBeTruthy();

    act(() => {
      planChip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onTaskEnabledChange).toHaveBeenCalledWith(false);
    expect(onObjectiveEnabledChange).not.toHaveBeenCalled();

    act(() => {
      objectiveChip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onObjectiveEnabledChange).toHaveBeenCalledWith(false);
  });

  it("未取得 canonical thread identity 时不应从 session 猜测 Goal", () => {
    const container = renderPanel({
      objectiveEnabled: true,
      projectId: "home-project",
      sessionId: "home-session-goal",
      isLoading: true,
    });

    expect(
      container.querySelector('[data-testid="thread-goal-inline-panel"]'),
    ).toBeNull();
  });
});
