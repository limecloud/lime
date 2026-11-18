import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { acceptedSubmission } from "../hooks/agentSendResult.testFixtures";
import {
  openContextSuggestions,
  createSkillSelection,
  renderPanel,
  updateComposerEditorValue,
} from "./EmptyStateComposerPanel.testFixtures";
import {
  COMPOSER_EDITOR_SELECTOR,
  getComposerEditorText,
} from "@/components/input-kit/composerEditor.testUtils";

describe("EmptyStateComposerPanel", () => {
  it("requests the shared lazy Skill catalog from the Home mention surface", () => {
    const onSkillSuggestionsNeeded = vi.fn();
    const container = renderPanel({
      skillSelection: createSkillSelection({ onSkillSuggestionsNeeded }),
    });
    openContextSuggestions(container);
    expect(onSkillSuggestionsNeeded).toHaveBeenCalledOnce();
  });
  it("不应重新接入 input restore request 子面板 fallback", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/components/agent/chat/components/EmptyStateComposerPanel.tsx",
      ),
      "utf8",
    );

    expect(source).not.toContain("inputRestoreRequest");
    expect(source).not.toContain("InterruptedInputRestoreRequest");
  });

  it("输入为空时不再展示 Tab 起手建议，也不拦截 Tab 输入", async () => {
    const container = renderPanel();

    expect(
      container.querySelector('[data-testid="home-input-tab-suggestion"]'),
    ).toBeNull();

    const editor = container.querySelector<HTMLElement>(
      COMPOSER_EDITOR_SELECTOR,
    );
    await act(async () => {
      editor?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
      await Promise.resolve();
    });

    expect(getComposerEditorText(editor)).toBe("");
  }, 15_000);

  it("Shift+Tab 保持焦点切换，不填入起手建议", () => {
    const container = renderPanel();

    const editor = container.querySelector<HTMLElement>(
      COMPOSER_EDITOR_SELECTOR,
    );
    act(() => {
      editor?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(getComposerEditorText(editor)).toBe("");
  });

  it("应将 onPaste 绑定到输入框", () => {
    const onPaste = vi.fn();
    const container = renderPanel({ onPaste });
    const editor = container.querySelector<HTMLElement>(
      COMPOSER_EDITOR_SELECTOR,
    );

    expect(editor).toBeTruthy();

    act(() => {
      editor?.dispatchEvent(new Event("paste", { bubbles: true }));
    });

    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it("首页空输入时发送按钮保持可点击，对齐参考空态", () => {
    const container = renderPanel({ allowEmptySend: true });
    const sendButton = container.querySelector(
      '[data-testid="send-btn"]',
    ) as HTMLButtonElement | null;

    expect(sendButton).toBeTruthy();
    expect(sendButton?.disabled).toBe(false);
  });

  it("发送时应把本地草稿显式传给首页发送链", async () => {
    const onSend = vi.fn(async () => acceptedSubmission());
    const container = renderPanel({ onSend });
    const editor = container.querySelector<HTMLElement>(
      COMPOSER_EDITOR_SELECTOR,
    );

    updateComposerEditorValue(editor, "帮我快速开一个新对话");

    const sendButton = container.querySelector(
      'button[title="发送"]',
    ) as HTMLButtonElement | null;

    expect(sendButton?.disabled).toBe(false);

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSend).toHaveBeenCalledWith(
      "帮我快速开一个新对话",
      {
        goalEnabled: false,
        planEnabled: false,
        subagentEnabled: false,
      },
      expect.objectContaining({
        triggerSource: "button",
        triggeredAt: expect.any(Number),
      }),
    );
    expect(getComposerEditorText(editor)).toBe("");
  });

  it("选择插件应在草稿插入 inline atom，并将显示文本发送", async () => {
    const onSend = vi.fn(async () => acceptedSubmission());
    const plugin = {
      pluginId: "content-factory-app",
      displayName: "写文章",
      trigger: "@写文章",
      description: "生成文章草稿",
    };
    const container = renderPanel({
      input: "帮我整理项目资料",
      onSend,
      pluginSuggestions: [plugin],
    });
    openContextSuggestions(container);
    const item = document.querySelector<HTMLButtonElement>(
      '[data-suggestion-key="plugin:content-factory-app"]',
    )!;
    await act(async () => item.click());

    expect(
      container.querySelector('[data-composer-token="plugin"]')?.textContent,
    ).toContain("写文章");
    expect(
      getComposerEditorText(container.querySelector(COMPOSER_EDITOR_SELECTOR)),
    ).toBe("帮我整理项目资料 @写文章");
    expect(
      container
        .querySelector('[data-composer-token="plugin"]')
        ?.getAttribute("contenteditable"),
    ).toBe("false");
    expect(
      container.querySelector('[data-testid="inputbar-plugin-badge"]'),
    ).toBeNull();

    const sendButton = container.querySelector(
      'button[title="发送"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSend).toHaveBeenCalledWith(
      "帮我整理项目资料 @写文章",
      {
        goalEnabled: false,
        planEnabled: false,
        subagentEnabled: false,
      },
      expect.objectContaining({
        triggerSource: "button",
        triggeredAt: expect.any(Number),
      }),
    );
  });

  it("发送准备中应禁用首页发送入口并展示忙碌态", () => {
    const onSend = vi.fn(async () => acceptedSubmission());
    const container = renderPanel({
      input: "请帮我梳理首页首次发送链路",
      isLoading: true,
      disabled: true,
      onSend,
    });

    const editor = container.querySelector<HTMLElement>(
      COMPOSER_EDITOR_SELECTOR,
    );
    const runningButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("正在输出"),
    ) as HTMLButtonElement | undefined;

    expect(editor?.getAttribute("aria-disabled")).toBe("true");
    expect(editor?.getAttribute("contenteditable")).toBe("false");
    expect(runningButton).toBeTruthy();
    expect(runningButton?.disabled).toBe(true);
    expect(container.querySelector('button[title="发送"]')).toBeNull();

    act(() => {
      runningButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("运行中应把空态停止按钮接到 onStop", () => {
    const onStop = vi.fn();
    const container = renderPanel({
      input: "请帮我梳理首页首次发送链路",
      isLoading: true,
      disabled: true,
      onStop,
    });

    const stopButton = container.querySelector(
      'button[title="停止"]',
    ) as HTMLButtonElement | null;

    expect(stopButton).toBeTruthy();
    expect(stopButton?.disabled).toBe(false);

    act(() => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onStop).toHaveBeenCalledTimes(1);
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
});
