import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceShortcutRuntimeStatus } from "@/lib/api/hotkeys";
import { VoiceShortcutTestStep } from "./VoiceShortcutTestStep";

const listeners = vi.hoisted(() => ({
  start: null as null | (() => void | Promise<void>),
  stop: null as null | (() => void | Promise<void>),
  getVoiceShortcutRuntimeStatus: vi.fn<
    () => Promise<VoiceShortcutRuntimeStatus>
  >(async () => ({
    shortcut_registered: true,
    registered_shortcut: "CommandOrControl+Shift+V",
    translate_shortcut_registered: false,
    registered_translate_shortcut: null,
  })),
}));

vi.mock("@/lib/api/voiceShortcutEvents", () => ({
  onVoiceStartRecording: vi.fn(async (callback: () => void | Promise<void>) => {
    listeners.start = callback;
    return () => {
      listeners.start = null;
    };
  }),
  onVoiceStopRecording: vi.fn(async (callback: () => void | Promise<void>) => {
    listeners.stop = callback;
    return () => {
      listeners.stop = null;
    };
  }),
}));

vi.mock("@/lib/api/hotkeys", () => ({
  getVoiceShortcutRuntimeStatus: listeners.getVoiceShortcutRuntimeStatus,
}));

vi.mock("@/lib/api/asrProvider", () => ({
  cancelRecording: vi.fn(async () => undefined),
}));

const mounted: Array<{ container: HTMLDivElement; root: Root }> = [];

async function renderStep() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <VoiceShortcutTestStep
        shortcut="CommandOrControl+Shift+V"
        onSuccess={vi.fn()}
        onSkip={vi.fn()}
      />,
    );
  });

  await act(async () => {
    await Promise.resolve();
  });

  mounted.push({ container, root });
  return container;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop();
    if (!item) break;

    act(() => {
      item.root.unmount();
    });
    item.container.remove();
  }

  listeners.start = null;
  listeners.stop = null;
  vi.clearAllMocks();
});

describe("VoiceShortcutTestStep", () => {
  it("应忽略未先收到开始事件的停止事件，并在完整按下松开后才成功", async () => {
    const container = await renderStep();

    await act(async () => {
      await listeners.stop?.();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("请按下快捷键进行测试");
    expect(container.textContent).not.toContain("快捷键工作正常");

    await act(async () => {
      await listeners.start?.();
      await listeners.stop?.();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("快捷键工作正常");
    expect(container.textContent).toContain("继续");
  });

  it("运行时未注册快捷键时应给出明确提示", async () => {
    listeners.getVoiceShortcutRuntimeStatus.mockResolvedValueOnce({
      shortcut_registered: false,
      registered_shortcut: null,
      translate_shortcut_registered: false,
      registered_translate_shortcut: null,
    });

    const container = await renderStep();

    expect(container.textContent).toContain(
      "当前运行时没有把这组语音快捷键注册到系统",
    );
  });
});
