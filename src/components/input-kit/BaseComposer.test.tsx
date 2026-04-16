import React, { useState } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseComposer } from "./BaseComposer";

interface RenderResult {
  container: HTMLDivElement;
  root: Root;
  onSend: ReturnType<typeof vi.fn<() => void>>;
  onStop: ReturnType<typeof vi.fn<() => void>>;
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
  vi.clearAllMocks();
});

interface HarnessProps {
  initialText?: string;
  isLoading?: boolean;
  disabled?: boolean;
  hasAdditionalContent?: boolean;
  onSend: () => void;
  onStop: () => void;
}

const Harness: React.FC<HarnessProps> = ({
  initialText = "",
  isLoading = false,
  disabled = false,
  hasAdditionalContent = false,
  onSend,
  onStop,
}) => {
  const [text, setText] = useState(initialText);

  return (
    <BaseComposer
      text={text}
      setText={setText}
      onSend={onSend}
      onStop={onStop}
      isLoading={isLoading}
      disabled={disabled}
      hasAdditionalContent={hasAdditionalContent}
      placeholder="输入内容"
    >
      {({ textareaRef, textareaProps, onPrimaryAction, isPrimaryDisabled }) => (
        <div>
          <textarea
            data-testid="composer-textarea"
            ref={textareaRef}
            {...textareaProps}
          />
          <button
            data-testid="composer-primary"
            onClick={onPrimaryAction}
            disabled={isPrimaryDisabled}
          >
            action
          </button>
        </div>
      )}
    </BaseComposer>
  );
};

const renderHarness = (props: Partial<HarnessProps> = {}): RenderResult => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSend = vi.fn<() => void>();
  const onStop = vi.fn<() => void>();

  act(() => {
    root.render(
      <Harness
        initialText={props.initialText}
        isLoading={props.isLoading}
        disabled={props.disabled}
        hasAdditionalContent={props.hasAdditionalContent}
        onSend={onSend}
        onStop={onStop}
      />,
    );
  });

  mountedRoots.push({ root, container });
  return { container, root, onSend, onStop };
};

const getTextarea = (container: HTMLElement): HTMLTextAreaElement => {
  const textarea = container.querySelector(
    '[data-testid="composer-textarea"]',
  ) as HTMLTextAreaElement | null;
  if (!textarea) {
    throw new Error("未找到输入框");
  }
  return textarea;
};

const getPrimaryButton = (container: HTMLElement): HTMLButtonElement => {
  const button = container.querySelector(
    '[data-testid="composer-primary"]',
  ) as HTMLButtonElement | null;
  if (!button) {
    throw new Error("未找到主操作按钮");
  }
  return button;
};

describe("BaseComposer", () => {
  it("按 Enter 应发送消息", () => {
    const { container, onSend } = renderHarness({ initialText: "hello" });
    const textarea = getTextarea(container);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("生成中按 Enter 不应触发发送", () => {
    const { container, onSend } = renderHarness({
      initialText: "hello",
      isLoading: true,
    });
    const textarea = getTextarea(container);

    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("输入法合成阶段按 Enter 不应触发发送", () => {
    const { container, onSend } = renderHarness({ initialText: "你好" });
    const textarea = getTextarea(container);

    const imeEnterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
    });
    Object.defineProperty(imeEnterEvent, "isComposing", {
      value: true,
      configurable: true,
    });

    act(() => {
      textarea.dispatchEvent(imeEnterEvent);
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("生成中点击主按钮应触发停止", () => {
    const { container, onSend, onStop } = renderHarness({
      initialText: "hello",
      isLoading: true,
    });
    const button = getPrimaryButton(container);

    act(() => {
      button.click();
    });

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("仅附件内容存在时应允许发送", () => {
    const { container, onSend } = renderHarness({
      initialText: "",
      hasAdditionalContent: true,
    });
    const button = getPrimaryButton(container);

    act(() => {
      button.click();
    });

    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("应为输入框提供稳定的 id 与 name，避免表单告警", () => {
    const { container } = renderHarness();
    const textarea = getTextarea(container);

    expect(textarea.getAttribute("id")).toBeTruthy();
    expect(textarea.getAttribute("name")).toBe("agent-chat-message");
  });
});
