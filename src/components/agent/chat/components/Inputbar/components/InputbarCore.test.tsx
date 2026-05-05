import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_VOICE_MODEL_SETTINGS_EVENT } from "@/lib/voiceModelSettingsNavigation";
import { InputbarCore } from "./InputbarCore";

const {
  mockGetVoiceInputConfig,
  mockStartRecording,
  mockStopRecording,
  mockTranscribeAudio,
  mockPolishVoiceText,
  mockCancelRecording,
  mockGetRecordingSegment,
  mockGetRecordingStatus,
  mockGetDefaultLocalVoiceModelReadiness,
  mockToastError,
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
  mockGetRecordingSegment: vi.fn(async () => ({
    audio_data: [1, 2, 3, 4],
    sample_rate: 16000,
    duration: 0.8,
    start_sample: 0,
    end_sample: 12800,
    total_samples: 12800,
  })),
  mockGetRecordingStatus: vi.fn(async () => ({
    is_recording: true,
    volume: 62,
    duration: 3.4,
  })),
  mockGetDefaultLocalVoiceModelReadiness: vi.fn(async () => ({
    ready: true,
  })),
  mockToastError: vi.fn(),
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
  getRecordingSegment: mockGetRecordingSegment,
  getRecordingStatus: mockGetRecordingStatus,
}));

vi.mock("@/lib/api/voiceModels", () => ({
  getDefaultLocalVoiceModelReadiness: mockGetDefaultLocalVoiceModelReadiness,
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    info: vi.fn(),
  },
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
  vi.useRealTimers();
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

  it("主题工作台空输入时应保持单行紧凑态，聚焦后也不应放大", async () => {
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

    expect(textarea?.className).toContain("floating-collapsed");
    expect(
      container.querySelector('[data-testid="inputbar-tools"]'),
    ).toBeNull();
  });

  it("主题工作台有输入内容时应展开为常规编辑态", async () => {
    const container = await renderInputbarCore({
      text: "继续补充当前分析",
    });
    const textarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;

    expect(textarea).toBeTruthy();
    expect(textarea?.className).not.toContain("floating-collapsed");
    expect(
      container.querySelector('button[aria-label="添加图片"]'),
    ).toBeTruthy();
  });

  it("添加路径引用时应显示 chip 并允许移除", async () => {
    const onRemovePathReference = vi.fn();
    const container = await renderInputbarCore({
      pathReferences: [
        {
          id: "dir:/Users/demo/Downloads",
          path: "/Users/demo/Downloads",
          name: "Downloads",
          isDir: true,
          source: "file_manager",
        },
      ],
      onRemovePathReference,
    });

    expect(container.textContent).toContain("Downloads");
    expect(container.textContent).toContain("本地文件夹");
    expect(container.textContent).not.toContain("/Users/demo/Downloads");
    expect(
      container.querySelector('[data-testid="inputbar-path-reference-chip"]'),
    ).toBeTruthy();

    const removeButton = container.querySelector(
      'button[aria-label="移除路径 Downloads"]',
    ) as HTMLButtonElement | null;
    expect(removeButton).toBeTruthy();

    await act(async () => {
      removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onRemovePathReference).toHaveBeenCalledWith(
      "dir:/Users/demo/Downloads",
    );
  });

  it("文本路径引用应提供设为项目资料动作", async () => {
    const onImportPathReferenceAsKnowledge = vi.fn();
    const reference = {
      id: "file:/Users/demo/brief.txt",
      path: "/Users/demo/brief.txt",
      name: "brief.txt",
      isDir: false,
      mimeType: "text/plain",
      source: "file_manager" as const,
    };
    const container = await renderInputbarCore({
      pathReferences: [reference],
      onImportPathReferenceAsKnowledge,
    });

    const importButton = container.querySelector(
      'button[aria-label="设为项目资料 brief.txt"]',
    ) as HTMLButtonElement | null;
    expect(importButton).toBeTruthy();

    await act(async () => {
      importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onImportPathReferenceAsKnowledge).toHaveBeenCalledWith(reference);
  });

  it("非文本路径引用不应展示设为项目资料动作", async () => {
    const onImportPathReferenceAsKnowledge = vi.fn();
    const reference = {
      id: "file:/Users/demo/contract.pdf",
      path: "/Users/demo/contract.pdf",
      name: "contract.pdf",
      isDir: false,
      mimeType: "application/pdf",
      source: "file_manager" as const,
    };
    const container = await renderInputbarCore({
      pathReferences: [reference],
      onImportPathReferenceAsKnowledge,
    });

    expect(
      container.querySelector('button[aria-label="设为项目资料 contract.pdf"]'),
    ).toBeNull();
    expect(container.textContent).toContain("contract.pdf");
  });

  it("从输入框正文区域拖放时应由容器优先接收 drop", async () => {
    const onDrop = vi.fn((event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const onDragOver = vi.fn((event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const container = await renderInputbarCore({
      onDrop,
      onDragOver,
    });
    const textarea = container.querySelector(
      "textarea",
    ) as HTMLTextAreaElement | null;
    expect(textarea).toBeTruthy();

    await act(async () => {
      textarea?.dispatchEvent(new Event("dragover", { bubbles: true }));
      textarea?.dispatchEvent(new Event("drop", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onDragOver).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
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
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();

    const stopDictationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.getAttribute("aria-label")?.startsWith("录音中"),
    ) as HTMLButtonElement | undefined;
    expect(stopDictationButton).toBeTruthy();
    expect(stopDictationButton?.textContent).toMatch(/\d+:\d{2}/);

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

  it("录音中应定时写回实时识别文本", async () => {
    vi.useFakeTimers();
    mockTranscribeAudio.mockResolvedValueOnce({
      text: "实时识别文本",
      provider: "mock",
    });
    const setText = vi.fn();
    const container = await renderInputbarCore({
      visualVariant: "default",
      toolMode: "default",
      setText,
    });

    const micButton = container.querySelector(
      'button[aria-label="开始语音输入"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(750);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetRecordingSegment).toHaveBeenCalledWith(0, 1.2);
    expect(mockTranscribeAudio).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3, 4]),
      16000,
    );
    expect(setText).toHaveBeenCalledWith("实时识别文本");
    const recordingButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.getAttribute("aria-label")?.includes("实时识别"));
    expect(recordingButton).toBeTruthy();
  });

  it("录音中遇到静音片段时不应触发实时识别", async () => {
    vi.useFakeTimers();
    mockGetRecordingSegment.mockResolvedValueOnce({
      audio_data: [0, 0, 0, 0],
      sample_rate: 16000,
      duration: 0.8,
      start_sample: 0,
      end_sample: 12800,
      total_samples: 12800,
    });
    const setText = vi.fn();
    const container = await renderInputbarCore({
      visualVariant: "default",
      toolMode: "default",
      setText,
    });

    const micButton = container.querySelector(
      'button[aria-label="开始语音输入"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(750);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetRecordingSegment).toHaveBeenCalledWith(0, 1.2);
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
    expect(setText).not.toHaveBeenCalledWith("实时识别文本");
  });

  it("语音润色失败时应保留原始识别内容且不弹错误提示", async () => {
    mockPolishVoiceText.mockRejectedValueOnce(new Error("模型不可用"));
    const setText = vi.fn();
    const container = await renderInputbarCore({
      visualVariant: "default",
      toolMode: "default",
      setText,
    });

    const micButton = container.querySelector(
      'button[aria-label="开始语音输入"]',
    ) as HTMLButtonElement | null;

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const stopDictationButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) =>
      button.getAttribute("aria-label")?.startsWith("录音中"),
    ) as HTMLButtonElement | undefined;

    await act(async () => {
      stopDictationButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockPolishVoiceText).toHaveBeenCalledWith("原始识别文本");
    expect(setText).toHaveBeenCalledWith("原始识别文本");
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("本地语音模型未安装时不应开始录音", async () => {
    mockGetDefaultLocalVoiceModelReadiness.mockResolvedValueOnce({
      ready: false,
      model_id: "sensevoice-small-int8-2024-07-17",
      installed: false,
      message: "先下载语音模型",
    } as any);
    const navigationRequests: unknown[] = [];
    const handleNavigationRequest = (event: Event) => {
      navigationRequests.push(
        event instanceof CustomEvent ? event.detail : undefined,
      );
    };
    window.addEventListener(
      OPEN_VOICE_MODEL_SETTINGS_EVENT,
      handleNavigationRequest,
    );
    const container = await renderInputbarCore({
      visualVariant: "default",
      toolMode: "default",
    });

    const micButton = container.querySelector(
      'button[aria-label="开始语音输入"]',
    ) as HTMLButtonElement | null;
    expect(micButton).toBeTruthy();

    await act(async () => {
      micButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    window.removeEventListener(
      OPEN_VOICE_MODEL_SETTINGS_EVENT,
      handleNavigationRequest,
    );

    expect(mockGetDefaultLocalVoiceModelReadiness).toHaveBeenCalledTimes(1);
    expect(mockStartRecording).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-live="polite"]')).toBeNull();
    expect(navigationRequests).toEqual([
      expect.objectContaining({
        source: "inputbar",
        reason: "missing-model",
        modelId: "sensevoice-small-int8-2024-07-17",
      }),
    ]);
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
