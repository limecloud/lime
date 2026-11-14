import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { ModelProviderCapabilities } from "@/lib/api/modelRegistry";
import { VoiceChatSection } from "./VoiceChatSection";

const { mockReadModelProviderCapabilities, mockGetUserMedia, mockMintSecret } =
  vi.hoisted(() => ({
    mockReadModelProviderCapabilities: vi.fn(),
    mockGetUserMedia: vi.fn(),
    mockMintSecret: vi.fn(),
  }));

vi.mock("@/lib/api/modelRegistry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/modelRegistry")>();
  return {
    ...actual,
    readModelProviderCapabilities: mockReadModelProviderCapabilities,
  };
});

vi.mock("@/lib/api/realtimeVoice", () => ({
  createRealtimeVoiceClientSecret: mockMintSecret,
}));

interface FakeChannel {
  readyState: string;
  emit: (type: string, data?: unknown) => void;
  close: () => void;
}

const peerState: { current: FakePeer | null } = { current: null };

class FakePeer {
  iceGatheringState = "complete";
  connectionState = "new";
  localDescription: RTCSessionDescription | null = null;
  closed = false;
  readonly channel: FakeChannel;
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly channelListeners = new Map<
    string,
    Set<(event: { data?: unknown; target?: unknown }) => void>
  >();

  constructor() {
    peerState.current = this;
    this.channel = {
      readyState: "connecting",
      emit: (type, data) => {
        for (const listener of this.channelListeners.get(type) ?? []) {
          listener({ data, target: this.channel });
        }
      },
      close: () => {
        this.channel.readyState = "closed";
        for (const listener of this.channelListeners.get("close") ?? []) {
          listener({ target: this.channel });
        }
      },
    };
  }

  addEventListener(
    type: string,
    listener: globalThis.EventListenerOrEventListenerObject,
  ) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener as () => void);
    this.listeners.set(type, set);
  }

  removeEventListener(
    type: string,
    listener: globalThis.EventListenerOrEventListenerObject,
  ) {
    this.listeners.get(type)?.delete(listener as () => void);
  }

  createDataChannel() {
    return {
      addEventListener: (
        type: string,
        listener: (event: { data?: unknown; target?: unknown }) => void,
      ) => {
        const set = this.channelListeners.get(type) ?? new Set();
        set.add(listener);
        this.channelListeners.set(type, set);
      },
      removeEventListener: (
        type: string,
        listener: (event: { data?: unknown; target?: unknown }) => void,
      ) => {
        this.channelListeners.get(type)?.delete(listener);
      },
      close: this.channel.close,
      readyState: this.channel.readyState,
      send: vi.fn(),
    } as unknown as RTCDataChannel;
  }

  addTrack() {
    return {} as RTCRtpSender;
  }

  async createOffer() {
    return {
      type: "offer",
      sdp: "v=0\r\noffer",
    } as globalThis.RTCSessionDescriptionInit;
  }

  async setLocalDescription() {
    this.localDescription = {
      type: "offer",
      sdp: "v=0\r\noffer",
      toJSON: () => ({ type: "offer", sdp: "v=0\r\noffer" }),
    } as RTCSessionDescription;
  }

  async setRemoteDescription() {}

  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
}

function capabilities(
  overrides: Partial<ModelProviderCapabilities> = {},
): ModelProviderCapabilities {
  return {
    namespaceTools: false,
    imageGeneration: false,
    webSearch: false,
    realtime: false,
    realtimeBlockers: [
      "providerRealtimeUnsupported",
      "realtimeModelUnconfigured",
      "realtimeVoiceUnconfigured",
    ],
    realtimeModels: [],
    realtimeVoices: [],
    ...overrides,
  };
}

function providerReady(overrides: Partial<ModelProviderCapabilities> = {}) {
  return capabilities({
    realtimeBlockers: [
      "realtimeModelUnconfigured",
      "realtimeVoiceUnconfigured",
    ],
    realtimeModels: ["gpt-realtime-2.1", "gpt-realtime-2"],
    realtimeVoices: ["marin", "cedar"],
    ...overrides,
  });
}

function available(overrides: Partial<ModelProviderCapabilities> = {}) {
  return providerReady({
    realtime: true,
    realtimeBlockers: [],
    realtimeModel: "gpt-realtime-2.1",
    realtimeVoice: "marin",
    ...overrides,
  });
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(props: React.ComponentProps<typeof VoiceChatSection> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<VoiceChatSection {...props} />);
  });
  return container;
}

async function flush(times = 8) {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

function statusText() {
  return container?.querySelector('[role="status"]')?.textContent ?? "";
}

function button(label: string) {
  return Array.from(container?.querySelectorAll("button") ?? []).find(
    (candidate) => candidate.textContent === label,
  );
}

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  peerState.current = null;
  await changeLimeLocale("en-US");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mockGetUserMedia },
  });
  const track = { stop: vi.fn() };
  mockGetUserMedia.mockResolvedValue({
    getTracks: () => [track],
  });
  mockMintSecret.mockResolvedValue({
    clientSecret: "ek_renderer_ephemeral",
    expiresAt: 1_893_456_000,
    model: "gpt-realtime-2.1",
    voice: "marin",
    callsUrl: "https://api.openai.com/v1/realtime/calls",
    providerId: "openai",
  });
  vi.stubGlobal("RTCPeerConnection", class extends FakePeer {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "v=0\r\nanswer",
    }),
  );
});

afterEach(async () => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await changeLimeLocale("zh-CN");
});

describe("VoiceChatSection", () => {
  it("renders provider/model/voice blockers instead of fake controls", async () => {
    mockReadModelProviderCapabilities.mockResolvedValue(capabilities());
    render();
    await flush();

    expect(container?.textContent).toContain("Voice chat");
    expect(container?.textContent).toContain("Unavailable");
    expect(container?.textContent).toContain(
      "The default model provider is not an official OpenAI API-key route.",
    );
    expect(container?.textContent).toContain(
      "Choose an OpenAI Realtime model before starting.",
    );
    expect(
      container
        ?.querySelector('[role="status"]')
        ?.getAttribute("data-realtime-voice-availability"),
    ).toBe("false");

    // provider 不可用时不得出现模型/音色、开始/停止或设备控制。
    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    expect(buttons.map((candidate) => candidate.textContent)).toEqual([
      "Check again",
    ]);
    expect(container?.querySelector("select")).toBeNull();
    expect(container?.querySelector("audio")).toBeNull();
    expect(container?.querySelector("video")).toBeNull();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
    expect(mockMintSecret).not.toHaveBeenCalled();
  });

  it("shows model/voice options without start when only selection is missing", async () => {
    mockReadModelProviderCapabilities.mockResolvedValue(providerReady());
    render();
    await flush();

    expect(statusText()).toBe("Unavailable");
    expect(container?.textContent).toContain("Realtime model");
    expect(container?.textContent).toContain("Realtime voice");
    expect(container?.querySelectorAll("select")).toHaveLength(2);
    expect(button("Start voice chat")).toBeUndefined();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it("starts a real WebRTC session and renders data-channel transcripts", async () => {
    mockReadModelProviderCapabilities.mockResolvedValue(available());
    const onRealtimeSelectionChange = vi.fn().mockResolvedValue(true);
    render({ onRealtimeSelectionChange });
    await flush();

    expect(statusText()).toBe("Available");
    expect(button("Start voice chat")).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      button("Start voice chat")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush(16);
    });

    expect(mockMintSecret).toHaveBeenCalledTimes(1);
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1);
    expect(peerState.current).not.toBeNull();
    expect(container?.textContent).toContain("Connecting…");
    expect(container?.querySelector('[role="log"]')).toBeNull();

    await act(async () => {
      peerState.current?.channel.emit("message", {
        type: "session.created",
        session: { id: "sess_1" },
      });
      await flush();
    });
    expect(container?.textContent).toContain("Connected");

    await act(async () => {
      peerState.current?.channel.emit("message", {
        type: "conversation.item.input_audio_transcription.delta",
        item_id: "user-1",
        delta: "Hello from the microphone",
      });
      peerState.current?.channel.emit("message", {
        type: "response.output_audio_transcript.delta",
        item_id: "assistant-1",
        delta: "Hello back",
      });
      await flush();
    });
    const transcript = container?.querySelector('[role="log"]');
    expect(transcript?.textContent).toContain("You: Hello from the microphone");
    expect(transcript?.textContent).toContain("Lime: Hello back");

    await act(async () => {
      button("Stop voice chat")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush();
    });
    expect(container?.textContent).toContain("Conversation ended");
    expect(peerState.current?.closed).toBe(true);
  });

  it("fails closed with a clear error when the host cannot mint a secret", async () => {
    mockMintSecret.mockRejectedValue(new Error("providerKeyMissing"));
    mockReadModelProviderCapabilities.mockResolvedValue(available());
    render();
    await flush();

    await act(async () => {
      button("Start voice chat")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flush(12);
    });

    expect(mockGetUserMedia).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("providerKeyMissing");
    expect(container?.textContent).toContain("Connection failed");
  });

  it("fails closed when the capability request fails and retries in place", async () => {
    mockReadModelProviderCapabilities
      .mockRejectedValueOnce(new Error("app-server unavailable"))
      .mockResolvedValueOnce(capabilities());
    render();
    await flush();

    expect(statusText()).toBe(
      "Unable to check realtime voice availability. Try again.",
    );

    const retry = button("Check again");
    expect(retry).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(mockReadModelProviderCapabilities).toHaveBeenCalledTimes(2);
    expect(statusText()).toBe("Unavailable");
  });

  it("keeps loading state without controls until the capability resolves", async () => {
    let resolveCapability: (value: ModelProviderCapabilities) => void = () =>
      undefined;
    mockReadModelProviderCapabilities.mockReturnValue(
      new Promise<ModelProviderCapabilities>((resolve) => {
        resolveCapability = resolve;
      }),
    );
    render();
    await flush(2);

    expect(statusText()).toBe("Checking availability…");
    expect(container?.querySelectorAll("button")).toHaveLength(0);

    await act(async () => {
      resolveCapability(capabilities());
      await flush();
    });
    expect(statusText()).toBe("Unavailable");
  });

  it.each([
    ["zh-CN", "语音聊天", "不可用"],
    ["zh-TW", "語音聊天", "不可用"],
    ["ja-JP", "音声チャット", "利用不可"],
    ["ko-KR", "음성 채팅", "사용 불가"],
  ] as const)(
    "%s localizes the unavailable state",
    async (locale, title, unavailable) => {
      await changeLimeLocale(locale);
      mockReadModelProviderCapabilities.mockResolvedValue(capabilities());
      render();
      await flush();

      expect(container?.textContent).toContain(title);
      expect(container?.textContent).toContain(unavailable);
    },
  );
});
