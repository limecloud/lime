import React, { act, useCallback, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import { agentZhCNResource } from "@/i18n/agentResources";
import { InputbarCore } from "./InputbarCore";
import { createContextualSuggestionsFixture } from "./contextualSuggestions.testFixtures";
import { buildInputbarCoreCopy } from "./inputbarCoreCopy";

const api = vi.hoisted(() => ({
  config: vi.fn(),
  transcribe: vi.fn(),
  polish: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: api.config,
  transcribeVoiceInputAudio: api.transcribe,
  polishVoiceInputText: api.polish,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { info: api.info, error: api.error } }));
const copy = buildInputbarCoreCopy((key, values) =>
  Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.split(`{{${name}}}`).join(String(value)),
    agentZhCNResource[key] ?? key,
  ),
);
const mounted: Array<{ root: Root; container: HTMLElement }> = [];
const recorders: FakeRecorder[] = [];
const originalRanges = new Map(
  ["getClientRects", "getBoundingClientRect"].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(Range.prototype, name)] as const,
  ),
);
let permission: ReturnType<typeof vi.fn>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function microphone() {
  const stop = vi.fn();
  return {
    value: { getTracks: () => [{ stop }] } as unknown as MediaStream,
    stop,
  };
}

class FakeRecorder extends EventTarget {
  static isTypeSupported() {
    return true;
  }
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  constructor() {
    super();
    recorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  requestData() {
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", {
      value: new Blob(["audio"], { type: this.mimeType }),
    });
    this.dispatchEvent(event);
  }
  stop() {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

class FakeAudioContext {
  close() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({
      numberOfChannels: 1,
      length: 16000,
      sampleRate: 16000,
      getChannelData: () => new Float32Array(16000),
    } as unknown as AudioBuffer);
  }
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, 1, 1),
  });
  api.config.mockResolvedValue({});
  permission = vi.fn().mockResolvedValue(microphone().value);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: permission },
    platform: "MacIntel",
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("Blob", NodeBlob);
  api.transcribe.mockResolvedValue({ text: "语音结果" });
  api.polish.mockImplementation(async ({ text }: { text: string }) => ({
    text,
  }));
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  for (const [name, descriptor] of originalRanges) {
    if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
    else Reflect.deleteProperty(Range.prototype, name);
  }
  recorders.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetAllMocks();
});

function mount() {
  const controller = new ComposerController({
    text: "原稿",
    selectionStart: 2,
  });
  const onSend = vi.fn();
  const contextualSuggestions = createContextualSuggestionsFixture();
  const setText = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  function Host({ sessionId }: { sessionId: string }) {
    const [text, updateText] = useState(controller.getDocument().text);
    const onText = useCallback((value: string) => {
      setText(value);
      updateText(value);
    }, []);
    return (
      <InputbarCore
        controller={controller}
        uiCopy={copy}
        text={text}
        setText={onText}
        onSend={onSend}
        sessionId={sessionId}
        onToolClick={vi.fn()}
        contextualSuggestions={contextualSuggestions}
      />
    );
  }
  const rerender = (sessionId: string) =>
    act(() => root.render(<Host sessionId={sessionId} />));
  rerender("session-a");
  const editor = container.querySelector<HTMLElement>(
    '[data-testid="composer-editor"]',
  );
  if (!editor) throw new Error("ComposerEditor did not mount");
  return { controller, onSend, setText, container, rerender, editor };
}

async function settle() {
  await act(async () => {
    for (let count = 0; count < 12; count += 1) await Promise.resolve();
  });
}

function button(harness: ReturnType<typeof mount>, id: string) {
  const element = harness.container.querySelector<HTMLButtonElement>(
    `[data-testid="${id}"]`,
  );
  if (!element) throw new Error(`Missing button: ${id}`);
  return element;
}

async function click(harness: ReturnType<typeof mount>, id: string) {
  act(() =>
    button(harness, id).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    ),
  );
  await settle();
}

describe("InputbarCore real dictation lifecycle", () => {
  it("starting 显示连接状态与独立取消，重复点击不重复请求，取消后可重试", async () => {
    const request = deferred<MediaStream>();
    const stale = microphone();
    permission.mockReturnValueOnce(request.promise);
    const harness = mount();
    await click(harness, "inputbar-dictation-toggle");
    expect(
      button(harness, "inputbar-dictation-toggle").getAttribute("aria-label"),
    ).toBe("正在连接麦克风");
    expect(button(harness, "inputbar-dictation-toggle").disabled).toBe(true);
    expect(
      button(harness, "inputbar-dictation-cancel").getAttribute("aria-label"),
    ).toBe("取消语音输入");
    act(() => button(harness, "inputbar-dictation-toggle").click());
    expect(permission).toHaveBeenCalledOnce();
    expect(
      harness.container.querySelector('[data-testid="send-btn"]'),
    ).toBeNull();
    expect(harness.editor.getAttribute("aria-disabled")).toBe("true");
    await click(harness, "inputbar-dictation-cancel");
    request.resolve(stale.value);
    await settle();
    expect(stale.stop).toHaveBeenCalledOnce();
    expect(recorders).toHaveLength(0);
    expect(harness.controller.getDocument().text).toBe("原稿");
    expect(harness.onSend).not.toHaveBeenCalled();
    await click(harness, "inputbar-dictation-toggle");
    expect(recorders).toHaveLength(1);
  });

  it("结束录音只插入草稿，识别中可取消，成功后仍需显式发送", async () => {
    const response = deferred<{ text: string }>();
    api.transcribe.mockReturnValueOnce(response.promise);
    const harness = mount();
    await click(harness, "inputbar-dictation-toggle");
    act(() => vi.advanceTimersByTime(500));
    await click(harness, "inputbar-dictation-toggle");
    expect(
      button(harness, "inputbar-dictation-toggle").getAttribute("aria-label"),
    ).toBe("识别中");
    expect(button(harness, "inputbar-dictation-cancel").disabled).toBe(false);
    expect(harness.onSend).not.toHaveBeenCalled();
    response.resolve({ text: "语音结果" });
    await settle();
    expect(harness.controller.getDocument().text).toBe("原稿 语音结果");
    expect(
      harness.container.querySelector(
        '[data-testid="inputbar-dictation-cancel"]',
      ),
    ).toBeNull();
    expect(harness.onSend).not.toHaveBeenCalled();
    await click(harness, "send-btn");
    expect(harness.onSend).toHaveBeenCalledOnce();
  });

  it("已在中文组合输入时点击语音不请求麦克风", async () => {
    const harness = mount();
    act(() =>
      harness.editor.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
    );
    await click(harness, "inputbar-dictation-toggle");
    expect(permission).not.toHaveBeenCalled();
    expect(harness.controller.getDocument().text).toBe("原稿");
    expect(api.info).not.toHaveBeenCalled();
    act(() =>
      harness.editor.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true }),
      ),
    );
    await click(harness, "inputbar-dictation-toggle");
    expect(permission).toHaveBeenCalledOnce();
  });

  it.each(["starting", "listening", "transcribe", "polish"] as const)(
    "%s 与 compositionstart 相交使整段听写失效，compositionend 不插入迟到结果",
    async (stage) => {
      const response = deferred<MediaStream | { text: string }>();
      const stale = microphone();
      const harness = mount();
      if (stage === "starting")
        permission.mockReturnValueOnce(response.promise);
      else if (stage !== "listening")
        api[stage].mockReturnValueOnce(response.promise);
      await click(harness, "inputbar-dictation-toggle");
      if (stage === "transcribe" || stage === "polish") {
        act(() => vi.advanceTimersByTime(500));
        await click(harness, "inputbar-dictation-toggle");
      }
      const before = harness.controller.getSnapshot();
      act(() =>
        harness.editor.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true }),
        ),
      );
      expect(harness.controller.getSnapshot()).toBe(before);
      expect(harness.editor.getAttribute("aria-disabled")).toBe("false");
      expect(api.info).toHaveBeenCalledWith(
        "语音输入已取消，请完成文字输入后重试",
      );
      const nextText = "新的中文😀";
      const committed = new Promise<void>((resolve) => {
        const unsubscribe = harness.controller.subscribe(() => {
          if (harness.controller.getDocument().text !== nextText) return;
          unsubscribe();
          resolve();
        });
      });
      await act(async () => {
        const node = harness.editor.querySelector("p")?.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE)
          throw new Error("Expected paragraph text");
        node.nodeValue = nextText;
        document.getSelection()?.collapse(node, nextText.length);
        harness.editor.dispatchEvent(
          new CompositionEvent("compositionend", { bubbles: true }),
        );
        await committed;
      });
      const newer = harness.controller.getSnapshot();
      response.resolve(
        stage === "starting" ? stale.value : { text: "迟到语音" },
      );
      await settle();
      expect(harness.controller.getSnapshot()).toBe(newer);
      expect(harness.onSend).not.toHaveBeenCalled();
      if (stage === "starting") expect(stale.stop).toHaveBeenCalledOnce();
      else expect(recorders[0].state).toBe("inactive");
      await click(harness, "inputbar-dictation-toggle");
      expect(recorders.at(-1)?.state).toBe("recording");
    },
  );

  it("Core 传递 session scope，同 Controller 切会话也清理录音和旧 final", async () => {
    const response = deferred<{ text: string }>();
    api.transcribe.mockReturnValueOnce(response.promise);
    const live = microphone();
    permission.mockResolvedValueOnce(live.value);
    const harness = mount();
    await click(harness, "inputbar-dictation-toggle");
    act(() => vi.advanceTimersByTime(500));
    await click(harness, "inputbar-dictation-toggle");
    harness.rerender("session-b");
    const original = harness.controller.getSnapshot();
    response.resolve({ text: "旧会话" });
    await settle();
    expect(harness.controller.getSnapshot()).toBe(original);
    expect(live.stop).toHaveBeenCalledOnce();
    expect(
      harness.container.querySelector(
        '[data-testid="inputbar-dictation-cancel"]',
      ),
    ).toBeNull();
    expect(harness.onSend).not.toHaveBeenCalled();
    await click(harness, "inputbar-dictation-toggle");
    expect(recorders.at(-1)?.state).toBe("recording");
  });
});
