import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import type { ComposerEditorHandle } from "@/components/input-kit/ComposerEditor";
import { useInputbarDictation } from "./useInputbarDictation";

const historyApi = vi.hoisted(() => ({
  start: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  transcript: vi.fn(),
}));
vi.mock("@/lib/api/dictationHistory", () => ({
  startDictationHistory: historyApi.start,
  appendDictationHistoryAudio: historyApi.append,
  finishDictationHistory: historyApi.finish,
  setDictationHistoryTranscript: historyApi.transcript,
}));

const api = vi.hoisted(() => ({
  config: vi.fn(),
  transcribe: vi.fn(),
  polish: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: api.config,
  transcribeVoiceInputAudio: api.transcribe,
  polishVoiceInputText: api.polish,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({ toast: { error: api.toast } }));

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function stream() {
  const stop = vi.fn();
  return {
    value: { getTracks: () => [{ stop }] } as unknown as MediaStream,
    stop,
  };
}

export const recorders: FakeMediaRecorder[] = [];
export const processors: Array<{
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null;
}> = [];
const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
export let permission: ReturnType<typeof vi.fn>;

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported() {
    return true;
  }
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  constructor(public readonly stream: MediaStream) {
    super();
    recorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  requestData() {
    const event = new Event("dataavailable");
    Object.defineProperty(event, "data", {
      value: new Blob(["recorded-audio"], { type: this.mimeType }),
    });
    this.dispatchEvent(event);
  }
  stop() {
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

export class FakeAudioContext {
  sampleRate = 16000;
  destination = {};
  createMediaStreamSource() {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createScriptProcessor() {
    const processor = {
      onaudioprocess: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    processors.push(processor);
    return processor;
  }
  resume() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({
      numberOfChannels: 1,
      length: 16000,
      sampleRate: 16000,
      getChannelData: () => new Float32Array(16000).fill(0.2),
    } as unknown as AudioBuffer);
  }
}

type LifecycleContract = ReturnType<typeof useInputbarDictation>;

export function mount(
  controller = new ComposerController({ text: "原草稿", selectionStart: 3 }),
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const setText = vi.fn();
  const focus = vi.fn();
  const composition = { active: false };
  const editorRef = {
    current: {
      focus,
      isComposing: () => composition.active,
    } as unknown as ComposerEditorHandle,
  };
  let result!: LifecycleContract;
  function Harness({
    owner,
    sessionId,
  }: {
    owner: ComposerController;
    sessionId: string | null;
  }) {
    const options = {
      setText,
      editorRef,
      controller: owner,
      sessionId,
      disabled: false,
      isComposing: () => composition.active,
    };
    result = useInputbarDictation(options) as LifecycleContract;
    return <div>{result.dictationState}</div>;
  }
  const rerender = (
    owner: ComposerController,
    sessionId: string | null = "session-a",
  ) => act(() => root.render(<Harness owner={owner} sessionId={sessionId} />));
  rerender(controller);
  const unmount = () => {
    act(() => root.unmount());
    mounted.splice(
      mounted.findIndex((entry) => entry.root === root),
      1,
    );
    container.remove();
  };
  return {
    read: () => result,
    rerender,
    controller,
    setText,
    focus,
    composition,
    unmount,
  };
}

export async function settle() {
  await act(async () => {
    for (let count = 0; count < 12; count += 1) await Promise.resolve();
  });
}

export function start(harness: ReturnType<typeof mount>) {
  let operation!: Promise<void>;
  act(() => {
    operation = harness.read().handleDictationToggle();
  });
  return operation;
}

export async function startReady(harness: ReturnType<typeof mount>) {
  const operation = start(harness);
  await settle();
  await operation;
  expect(harness.read().dictationState).toBe("listening");
}

export function beginFinish(harness: ReturnType<typeof mount>) {
  act(() => {
    vi.advanceTimersByTime(500);
  });
  return start(harness);
}

export function sample() {
  processors.at(-1)?.onaudioprocess?.({
    inputBuffer: {
      numberOfChannels: 1,
      length: 16000,
      getChannelData: () => new Float32Array(16000).fill(0.2),
    },
  } as unknown as AudioProcessingEvent);
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
  historyApi.start.mockResolvedValue({ id: "recording-test" });
  historyApi.append.mockResolvedValue({});
  historyApi.finish.mockResolvedValue({});
  historyApi.transcript.mockResolvedValue({});
  api.config.mockResolvedValue({ sound_enabled: false });
  const defaultStream = stream();
  permission = vi.fn().mockResolvedValue(defaultStream.value);
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia: permission },
    platform: "MacIntel",
  });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("Blob", NodeBlob);
  api.transcribe.mockResolvedValue({
    text: "听写结果",
    provider: "openai",
    durationSecs: 1,
    sampleRate: 16000,
  });
  api.polish.mockImplementation(async ({ text }: { text: string }) => ({
    text,
  }));
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
  recorders.length = 0;
  processors.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetAllMocks();
});

export { api, historyApi };
