import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputbarCore } from "./InputbarCore";

const {
  mockGetVoiceInputConfig,
  mockStartRecording,
  mockStopRecording,
  mockTranscribeAudio,
  mockPolishVoiceText,
  mockCancelRecording,
} = vi.hoisted(() => ({
  mockGetVoiceInputConfig: vi.fn(async () => ({
    enabled: true,
    shortcut: "Alt+Space",
    processor: {
      polish_enabled: true,
      default_instruction_id: "default",
    },
    output: {
      mode: "type",
      type_delay_ms: 0,
    },
    instructions: [],
    sound_enabled: false,
    translate_instruction_id: "",
  })),
  mockStartRecording: vi.fn(async () => undefined),
  mockStopRecording: vi.fn(async () => ({
    audio_data: [1, 2, 3, 4],
    sample_rate: 16000,
    duration: 1.2,
  })),
  mockTranscribeAudio: vi.fn(async () => ({
    text: "原始识别文本",
    provider: "mock",
  })),
  mockPolishVoiceText: vi.fn(async () => ({
    text: "润色后的文本",
    instruction_name: "默认润色",
  })),
  mockCancelRecording: vi.fn(async () => undefined),
}));

vi.mock("./InputbarTools", () => ({
  InputbarTools: () => <div data-testid="inputbar-tools">tools</div>,
}));

vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: mockGetVoiceInputConfig,
  startRecording: mockStartRecording,
  stopRecording: mockStopRecording,
  transcribeAudio: mockTranscribeAudio,
  polishVoiceText: mockPolishVoiceText,
  cancelRecording: mockCancelRecording,
}));

vi.mock("@/hooks/useVoiceSound", () => ({
  useVoiceSound: () => ({
    playStartSound: vi.fn(),
    playStopSound: vi.fn(),
  }),
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

const renderInputbarCore = async (
  props?: Partial<React.ComponentProps<typeof InputbarCore>>,
) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <InputbarCore
        text=""
        setText={vi.fn()}
        onSend={vi.fn()}
        activeTools={{}}
        onToolClick={vi.fn()}
        toolMode="attach-only"
        visualVariant="floating"
        {...props}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });

  mountedRoots.push({ root, container });
  return container;
};

describe("InputbarCore", () => {
  it("挂载时不应主动预取语音配置", async () => {
    await renderInputbarCore({
      visualVariant: "default",
      toolMode: "default",
    });

    expect(mockGetVoiceInputConfig).not.toHaveBeenCalled();
  });

  it("主题工作台未聚焦时应使用单行紧凑态，点击展开，移出后收起", async () => {
    const container = await renderInputbarCore();
    const textarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    const inputBar = container.querySelector(
      '[data-testid="inputbar-core-container"]',
    ) as HTMLDivElement | null;
    expect(textarea).toBeTruthy();
    expect(inputBar).toBeTruthy();
    expect(textarea?.className).toContain("floating-collapsed");
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeNull();

    act(() => {
      inputBar?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      textarea?.focus();
    });

    expect(textarea?.className).not.toContain("floating-collapsed");
    expect(
      container.querySelector('button[aria-label="添加图片"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeNull();

    act(() => {
      inputBar?.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });

    expect(textarea?.className).not.toContain("floating-collapsed");
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeNull();

    act(() => {
      textarea?.blur();
      inputBar?.dispatchEvent(
        new MouseEvent("mouseout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      );
    });

    expect(textarea?.className).toContain("floating-collapsed");
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeNull();
  });

  it("点击展开按钮应切换输入框展开态", async () => {
    const container = await renderInputbarCore({
      visualVariant: "default",
      toolMode: "default",
    });
    const textarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    const expandButton = container.querySelector(
      'button[aria-label="展开输入框"]',
    ) as HTMLButtonElement | null;

    expect(textarea?.className).not.toContain("composer-expanded");
    expect(expandButton).toBeTruthy();

    await act(async () => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(textarea?.className).toContain("composer-expanded");
    expect(
      container.querySelector('button[aria-label="收起输入框"]'),
    ).toBeTruthy();
  });

  it("点击麦克风按钮应执行语音识别并把结果写回输入框", async () => {
    const setText = vi.fn();
    const container = await renderInputbarCore({
      visualVariant: "default",
      toolMode: "default",
      setText,
    });

    await act(async () => {
      await Promise.resolve();
    });

    const micButton = container.querySelector(
      'button[aria-label="开始语音输入"]',
    ) as HTMLButtonElement | null;
    expect(micButton).toBeTruthy();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mockGetVoiceInputConfig).toHaveBeenCalledTimes(1);
    expect(mockStartRecording).toHaveBeenCalledTimes(1);

    const stopDictationButton = container.querySelector(
      'button[aria-label="停止语音输入"]',
    ) as HTMLButtonElement | null;
    expect(stopDictationButton).toBeTruthy();

    await act(async () => {
      stopDictationButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockStopRecording).toHaveBeenCalledTimes(1);
    expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
    expect(mockPolishVoiceText).toHaveBeenCalledWith("原始识别文本");
    expect(setText).toHaveBeenCalledWith("润色后的文本");
  });

  it("生成中应显示稍后处理与停止按钮，并渲染待处理列表", async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const container = await renderInputbarCore({
      text: "下一条需求",
      onSend,
      onStop,
      isLoading: true,
      queuedTurns: [
        {
          queued_turn_id: "queued-1",
          message_preview: "本周复盘摘要",
          message_text: "这里是完整的排队输入内容，点击后应展开查看。",
          created_at: 1700000000000,
          image_count: 0,
          position: 1,
        },
      ],
    });

    const queueButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("稍后处理"),
    );
    const stopButton = container.querySelector(
      'button[aria-label="停止"]',
    ) as HTMLButtonElement | null;

    expect(queueButton).toBeTruthy();
    expect(stopButton).toBeTruthy();
    expect(container.textContent).toContain("稍后处理 1");
    expect(container.textContent).not.toContain("这里是完整的排队输入内容");

    const queueCard = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("本周复盘摘要"),
    );
    expect(queueCard).toBeTruthy();

    act(() => {
      queueCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("这里是完整的排队输入内容");

    act(() => {
      queueButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    act(() => {
      stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("点击图片删除按钮应触发 onRemoveImage", async () => {
    const onRemoveImage = vi.fn();
    const container = await renderInputbarCore({
      pendingImages: [
        {
          data: "aGVsbG8=",
          mediaType: "image/png",
        },
      ],
      onRemoveImage,
    });

    const removeButton = container.querySelector(
      'button[aria-label="移除图片 1"]',
    ) as HTMLButtonElement | null;

    expect(removeButton).toBeTruthy();

    act(() => {
      removeButton?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
      removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRemoveImage).toHaveBeenCalledWith(0);
  });
});
