import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { ModelProviderCapabilities } from "@/lib/api/modelRegistry";
import { VoiceChatSection } from "./VoiceChatSection";

const { mockReadModelProviderCapabilities, mockGetUserMedia } = vi.hoisted(
  () => ({
    mockReadModelProviderCapabilities: vi.fn(),
    mockGetUserMedia: vi.fn(),
  }),
);

vi.mock("@/lib/api/modelRegistry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api/modelRegistry")>();
  return {
    ...actual,
    readModelProviderCapabilities: mockReadModelProviderCapabilities,
  };
});

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
      "realtimeTransportUnimplemented",
    ],
    ...overrides,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<VoiceChatSection />);
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

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  await changeLimeLocale("en-US");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: mockGetUserMedia },
  });
});

afterEach(async () => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  await changeLimeLocale("zh-CN");
});

describe("VoiceChatSection", () => {
  it("renders the provider and transport blockers instead of fake controls", async () => {
    mockReadModelProviderCapabilities.mockResolvedValue(capabilities());
    render();
    await flush();

    expect(container?.textContent).toContain("Voice chat");
    expect(container?.textContent).toContain("Unavailable");
    expect(container?.textContent).toContain(
      "The current model provider does not support realtime audio.",
    );
    expect(container?.textContent).toContain(
      "This build does not include a realtime voice session runtime yet.",
    );
    expect(
      container?.querySelector('[data-settings-search-target="voice-chat"]'),
    ).toBeInstanceOf(HTMLDivElement);
    expect(
      container
        ?.querySelector('[role="status"]')
        ?.getAttribute("data-realtime-voice-availability"),
    ).toBe("false");

    // 不可用状态下不得出现任何开始/停止、设备或音色控制。
    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Check again",
    ]);
    expect(container?.querySelector("audio")).toBeNull();
    expect(container?.querySelector("video")).toBeNull();
    expect(container?.querySelector("select")).toBeNull();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it("shows availability without audio capture when the server reports ready", async () => {
    mockReadModelProviderCapabilities.mockResolvedValue(
      capabilities({ realtime: true, realtimeBlockers: [] }),
    );
    render();
    await flush();

    expect(statusText()).toBe("Available");
    expect(
      container
        ?.querySelector('[role="status"]')
        ?.getAttribute("data-realtime-voice-availability"),
    ).toBe("true");
    expect(mockGetUserMedia).not.toHaveBeenCalled();
    expect(container?.querySelectorAll("audio")).toHaveLength(0);
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

    const retry = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === "Check again",
    );
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
