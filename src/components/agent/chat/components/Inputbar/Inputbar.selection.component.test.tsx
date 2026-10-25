import {
  dispatchInputbarDrop,
  renderInputbar,
  expectInputbarSend,
  openContextSuggestions,
  mockInputbarCore,
} from "./Inputbar.testFixtures";

import { act } from "react";

import { describe, expect, it, vi } from "vitest";

import { changeLimeLocale } from "@/i18n/createI18n";
import { toast } from "sonner";

import type { Skill } from "@/lib/api/skills";

describe("Inputbar selection current integration", () => {
  it("选择当前安装技能后，发送 canonical mention 与 typed Skill", async () => {
    const onSend = vi.fn();
    const skill = {
      key: "writer",
      name: "写作助手",
      description: "用于写作",
      directory: "writer",
      installed: true,
      sourceKind: "builtin",
    } as Skill;
    renderInputbar({
      input: "整理最近发布计划",
      onSend,
      activeTheme: "general",
      skills: [skill],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const secondCall =
      mockInputbarCore.mock.lastCall?.[0].contextualSuggestions;

    await act(async () => {
      secondCall?.onSelectInputCapability?.({
        kind: "installed_skill",
        skill,
      });
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expectInputbarSend(onSend, {
      textOverride: "整理最近发布计划 [$写作助手](writer/SKILL.md)",
    });
    expect(
      onSend.mock.calls[0]?.[0]?.composerSubmission?.inputMentions,
    ).toEqual([{ type: "skill", name: "写作助手", path: "writer/SKILL.md" }]);
    expect(
      onSend.mock.calls[0]?.[0]?.sendOptions?.capabilityRoute,
    ).toBeUndefined();
  });

  it.each(["plan-mode", "goal"] as const)(
    "共享菜单选择 %s 后发送下传实际模式",
    async (mode) => {
      const onSend = vi.fn();
      const { container } = renderInputbar({
        input: "继续执行当前任务",
        onSend,
        activeTheme: "general",
        projectId: "project-mode",
        sessionId: "thread-mode",
      });
      openContextSuggestions(container);
      const item = document.querySelector<HTMLButtonElement>(
        '[data-suggestion-key="command:' + mode + '"]',
      )!;
      expect(item).toBeTruthy();
      await act(async () => item.click());
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[data-testid="send-btn"]')!
          .click(),
      );
      expectInputbarSend(onSend, {
        textOverride:
          mode === "goal" ? "/goal 继续执行当前任务" : "继续执行当前任务",
        sendOptions:
          mode === "plan-mode"
            ? {
                collaborationMode: "plan",
                displayContent: "继续执行当前任务",
                toolPreferencesOverride: { task: true, subagent: false },
              }
            : {
                threadGoal: { objective: "继续执行当前任务" },
              },
      });
    },
  );

  it("canonical Goal 应按 thread identity 常显，不由发送模式开关拥有", async () => {
    const { container } = renderInputbar({
      activeTheme: "general",
      projectId: "project-goal",
      sessionId: "thread-inputbar-goal-panel",
      threadId: "thread-canonical-goal-panel",
      threadGoal: {
        createdAt: 10,
        objective: "完成 canonical Goal GUI",
        status: "active",
        threadId: "thread-canonical-goal-panel",
        timeUsedSeconds: 20,
        tokenBudget: null,
        tokensUsed: 100,
        updatedAt: 20,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const objectivePanel = container.querySelector(
      '[data-testid="thread-goal-inline-panel"]',
    );
    expect(objectivePanel).toBeTruthy();
    expect(objectivePanel?.getAttribute("data-thread-id")).toBe(
      "thread-canonical-goal-panel",
    );
    expect(objectivePanel?.getAttribute("data-objective")).toBe(
      "完成 canonical Goal GUI",
    );

    openContextSuggestions(container);
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-suggestion-key="command:goal"]',
        )!
        .click();
    });

    await act(async () => {
      container
        .querySelector('[data-testid="inputbar-objective-status"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="thread-goal-inline-panel"]'),
    ).toBeTruthy();
  });

  it("Plan/Goal 相互切换且各自可关闭，权限与模型保持原位置", async () => {
    const { container } = renderInputbar({
      input: "继续执行当前任务",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
      accessMode: "full-access",
      setAccessMode: vi.fn(),
    });
    async function choose(id: string) {
      openContextSuggestions(container);
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>(
            '[data-suggestion-key="command:' + id + '"]',
          )!
          .click(),
      );
    }
    await choose("plan-mode");
    expect(
      container.querySelector('[data-testid="inputbar-task-mode-status"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="inputbar-objective-status"]'),
    ).toBeNull();
    await choose("goal");
    expect(
      container.querySelector('[data-testid="inputbar-task-mode-status"]'),
    ).toBeNull();
    const goal = container.querySelector<HTMLButtonElement>(
      '[data-testid="inputbar-objective-status"]',
    )!;
    expect(goal).toBeTruthy();
    const left = container.querySelector('[data-testid="inputbar-meta-left"]')!;
    const access = left.querySelector(
      '[data-testid="inputbar-access-mode-select"]',
    )!;
    expect(
      access.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(left.querySelector('[data-testid="model-selector"]')).toBeNull();
    expect(
      container.querySelector(
        '[data-testid="inputbar-meta-trailing"] [data-testid="model-selector"]',
      ),
    ).toBeTruthy();
    await act(async () => goal.click());
    expect(
      container.querySelector('[data-testid="inputbar-objective-status"]'),
    ).toBeNull();
  });

  it("工作台输入区也应把模型切换器放在右侧", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      activeTheme: "general",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-5.2",
      setModel: vi.fn(),
      accessMode: "full-access",
      setAccessMode: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    const leftExtra = container.querySelector(
      '[data-testid="inputbar-meta-left"]',
    );
    const trailingMeta = container.querySelector(
      '[data-testid="inputbar-meta-trailing"]',
    );

    expect(
      leftExtra?.querySelector('[data-testid="inputbar-access-mode-select"]'),
    ).toBeTruthy();
    expect(
      leftExtra?.querySelector('[data-testid="model-selector"]'),
    ).toBeNull();
    expect(
      trailingMeta?.querySelector('[data-testid="model-selector"]'),
    ).toBeTruthy();
  });

  it("parent-owned 禁用态应锁定输入、工具与模型设置", async () => {
    const { container } = renderInputbar({
      variant: "workspace",
      disabled: true,
      disabledPlaceholder: "此子线程由父线程管理，无法直接输入",
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-5.4",
      setModel: vi.fn(),
      accessMode: "full-access",
      setAccessMode: vi.fn(),
      toolStates: { plan: true },
    });

    await act(async () => {
      await Promise.resolve();
    });

    const coreProps = mockInputbarCore.mock.calls.at(-1)?.[0];
    const accessSelect = container.querySelector(
      '[data-testid="inputbar-access-mode-select"]',
    ) as HTMLSelectElement;
    const planChip = container.querySelector(
      '[data-testid="inputbar-task-mode-status"]',
    ) as HTMLButtonElement;
    const modelTrigger = container.querySelector(
      '[data-testid="inputbar-meta-trailing"] [data-testid="model-selector"]',
    ) as HTMLButtonElement;

    expect(coreProps?.disabled).toBe(true);
    expect(coreProps?.placeholder).toBe("此子线程由父线程管理，无法直接输入");
    expect(accessSelect.disabled).toBe(true);
    expect(planChip.disabled).toBe(true);
    expect(modelTrigger.disabled).toBe(true);
  });

  it("选择本地安装技能发送时，保留 canonical name 与 Skill 路径", async () => {
    const onSend = vi.fn();
    const skill = {
      key: "local:writer",
      name: "写作助手",
      description: "用于写作",
      directory: "writer",
      installed: true,
      sourceKind: "other",
    } as Skill;
    renderInputbar({
      input: "整理最近发布计划",
      onSend,
      activeTheme: "general",
      skills: [skill],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const latestCall =
      mockInputbarCore.mock.lastCall?.[0].contextualSuggestions;

    await act(async () => {
      latestCall?.onSelectInputCapability?.({
        kind: "installed_skill",
        skill,
      });
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expectInputbarSend(onSend, {
      textOverride: "整理最近发布计划 [$写作助手](writer/SKILL.md)",
    });
    expect(
      onSend.mock.calls[0]?.[0]?.composerSubmission?.inputMentions,
    ).toEqual([{ type: "skill", name: "写作助手", path: "writer/SKILL.md" }]);
    expect(
      onSend.mock.calls[0]?.[0]?.sendOptions?.capabilityRoute,
    ).toBeUndefined();
  });

  it("仅添加路径引用时应允许发送并写入 request metadata", async () => {
    const onSend = vi.fn();
    renderInputbar({
      input: "",
      onSend,
      pathReferences: [
        {
          id: "dir:/Users/demo/Downloads",
          path: "/Users/demo/Downloads",
          name: "Downloads",
          isDir: true,
          source: "file_manager",
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expectInputbarSend(onSend, {
      textOverride: "请查看这些文件或文件夹。",
      sendOptions: {
        requestMetadata: {
          path_references: [
            {
              path: "/Users/demo/Downloads",
              name: "Downloads",
              is_dir: true,
              isDir: true,
              size: null,
              mime_type: null,
              mimeType: null,
              source: "file_manager",
            },
          ],
          harness: {
            file_references: [
              {
                path: "/Users/demo/Downloads",
                name: "Downloads",
                is_dir: true,
                isDir: true,
                size: null,
                mime_type: null,
                mimeType: null,
                source: "file_manager",
              },
            ],
            fileReferences: [
              {
                path: "/Users/demo/Downloads",
                name: "Downloads",
                is_dir: true,
                isDir: true,
                size: null,
                mime_type: null,
                mimeType: null,
                source: "file_manager",
              },
            ],
          },
        },
      },
    });
  });

  it("无法读取系统文件路径时应按 en-US 资源提示", async () => {
    await changeLimeLocale("en-US");
    const onAddPathReferences = vi.fn();
    const { container } = renderInputbar({
      onAddPathReferences,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const dropEvent = dispatchInputbarDrop(container, {
      files: [
        new File(["notes"], "notes.txt", {
          type: "text/plain",
        }),
      ],
      getData: () => "",
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Cannot read the file path. Add the file using the attachment button.",
    );
    expect(onAddPathReferences).not.toHaveBeenCalled();
    expect(dropEvent.defaultPrevented).toBe(true);
  });

  it("通用输入区 chrome 文案应跟随 en-US 资源", async () => {
    await changeLimeLocale("en-US");
    const { container } = renderInputbar({
      providerType: "openai",
      setProviderType: vi.fn(),
      model: "gpt-4.1",
      setModel: vi.fn(),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      container.querySelector('[data-testid="model-selector"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("Advanced settings");

    const plusTrigger = container.querySelector(
      '[data-testid="inputbar-plus-trigger"]',
    ) as HTMLButtonElement | null;
    expect(plusTrigger?.getAttribute("aria-label")).toBe("Add context");
    expect(plusTrigger?.getAttribute("title")).toBe("Add context");

    openContextSuggestions(container);
    expect(document.body.textContent).toContain("Plan mode");
  });

  it("带着初始已安装技能进入时，应插入 inline atom 并按 typed Skill 发送", async () => {
    const onSend = vi.fn();
    const skill = {
      key: "writer",
      name: "写作助手",
      description: "用于写作",
      directory: "writer",
      installed: true,
      sourceKind: "builtin",
    } as Skill;
    renderInputbar({
      input: "整理最近发布计划",
      onSend,
      activeTheme: "general",
      skills: [skill],
      initialInputCapability: {
        skill,
        requestKey: 20260418,
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(
      document
        .querySelector('[data-composer-token="skill"]')
        ?.getAttribute("data-composer-path"),
    ).toBe("writer/SKILL.md");

    const sendButton = document.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.click();
      await Promise.resolve();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expectInputbarSend(onSend, {
      textOverride: "整理最近发布计划 [$写作助手](writer/SKILL.md)",
    });
    expect(
      onSend.mock.calls[0]?.[0]?.composerSubmission?.inputMentions,
    ).toEqual([{ type: "skill", name: "写作助手", path: "writer/SKILL.md" }]);
    expect(
      onSend.mock.calls[0]?.[0]?.sendOptions?.capabilityRoute,
    ).toBeUndefined();
  });
});
