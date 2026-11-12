import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeepLink } from "./useDeepLink";
import { changeLimeLocale } from "@/i18n/createI18n";
import { getCurrent, onOpenUrl } from "@/lib/desktop-host/deep-link";
import { hasDesktopHostInvokeCapability } from "@/lib/desktop-runtime";
import { showDeepLinkError } from "@/lib/utils/connectError";

const {
  mockResolveConnectDeepLink,
  mockResolveOpenDeepLink,
  mockSaveConnectRelayApiKey,
  mockToastError,
  mockToastInfo,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockResolveConnectDeepLink: vi.fn(),
  mockResolveOpenDeepLink: vi.fn(),
  mockSaveConnectRelayApiKey: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("@/lib/api/connect", () => ({
  resolveConnectDeepLink: mockResolveConnectDeepLink,
  resolveOpenDeepLink: mockResolveOpenDeepLink,
  saveConnectRelayApiKey: mockSaveConnectRelayApiKey,
}));

vi.mock("@/lib/desktop-host/deep-link", () => ({
  getCurrent: vi.fn(),
  onOpenUrl: vi.fn(),
}));

vi.mock("@/lib/desktop-runtime", () => ({
  hasDesktopHostInvokeCapability: vi.fn(() => true),
}));

vi.mock("./useConnectCallback", () => ({
  useConnectCallback: () => ({
    sendSuccessCallback: vi.fn(),
    sendCancelledCallback: vi.fn(),
    sendErrorCallback: vi.fn(),
  }),
}));

vi.mock("@/lib/utils/connectError", () => ({
  showDeepLinkError: vi.fn(),
  showApiKeySaveError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mockToastError,
    info: mockToastInfo,
    success: mockToastSuccess,
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook(options?: Parameters<typeof useDeepLink>[0]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe() {
    useDeepLink(options);
    return null;
  }

  mountedRoots.push({ root, container });

  return act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useDeepLink", () => {
  beforeEach(async () => {
    await changeLimeLocale("en-US");
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(hasDesktopHostInvokeCapability).mockReturnValue(true);
    vi.mocked(getCurrent).mockResolvedValue([]);
    vi.mocked(onOpenUrl).mockResolvedValue(vi.fn());
    mockResolveConnectDeepLink.mockResolvedValue({
      payload: {
        relay: "relay-one",
        key: "sk-relay-key",
        name: "Relay Key",
      },
      relay_info: null,
      is_verified: false,
    });
    mockResolveOpenDeepLink.mockResolvedValue({
      payload: {
        kind: "prompt",
        slug: "gemini-longform-master",
        source: "website",
        version: "1",
      },
    });
    mockSaveConnectRelayApiKey.mockResolvedValue({
      provider_id: "provider-1",
      key_id: "key-1",
      provider_name: "Relay Key",
      is_new_provider: true,
    });
    window.localStorage.clear();
  });

  afterEach(async () => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) {
        break;
      }
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }

    await changeLimeLocale("zh-CN");
  });

  it("浏览器开发模式下不应注册 deep-link 事件桥", async () => {
    vi.mocked(hasDesktopHostInvokeCapability).mockReturnValue(false);

    await renderHook();

    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(getCurrent).not.toHaveBeenCalled();
  });

  it("运行中的 Electron deep link 事件应经 Desktop Host bridge 进入 Connect 处理链", async () => {
    let deepLinkHandler: ((urls: string[]) => void) | null = null;
    vi.mocked(onOpenUrl).mockImplementation(async (handler) => {
      deepLinkHandler = handler;
      return vi.fn();
    });

    await renderHook();

    await act(async () => {
      deepLinkHandler?.([
        "lime://connect?relay=relay-one&key=sk-relay-key&name=Relay%20Key",
      ]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(mockResolveConnectDeepLink).toHaveBeenCalledWith(
      "lime://connect?relay=relay-one&key=sk-relay-key&name=Relay%20Key",
    );
  });

  it("应解析官网 open deep link 并回调前端导航", async () => {
    const onOpenWebsiteDeepLink = vi.fn();
    vi.mocked(getCurrent).mockResolvedValue([
      "lime://open?kind=prompt&slug=gemini-longform-master&source=website&v=1",
    ]);

    await renderHook({
      onOpenWebsiteDeepLink,
    });

    expect(mockResolveOpenDeepLink).toHaveBeenCalledWith(
      "lime://open?kind=prompt&slug=gemini-longform-master&source=website&v=1",
    );
    expect(onOpenWebsiteDeepLink).toHaveBeenCalledWith({
      kind: "prompt",
      slug: "gemini-longform-master",
      source: "website",
      version: "1",
    });
  });

  it("应把官网 install action 透传给前端安装链路", async () => {
    const onOpenWebsiteDeepLink = vi.fn();
    vi.mocked(getCurrent).mockResolvedValue([
      "lime://open?kind=skill&slug=viral-content-breakdown&source=website&v=1&action=install",
    ]);
    mockResolveOpenDeepLink.mockResolvedValueOnce({
      payload: {
        kind: "skill",
        slug: "viral-content-breakdown",
        source: "website",
        version: "1",
        action: "install",
      },
    });

    await renderHook({
      onOpenWebsiteDeepLink,
    });

    expect(onOpenWebsiteDeepLink).toHaveBeenCalledWith({
      kind: "skill",
      slug: "viral-content-breakdown",
      source: "website",
      version: "1",
      action: "install",
    });
  });

  it.each([
    "lime://oauth/callback?token=untrusted",
    "lime://payment/return?orderId=untrusted",
    "https://untrusted.example.test/connect",
  ])("拒绝废弃或外部回调 %s", async (url) => {
    vi.mocked(getCurrent).mockResolvedValue([url]);
    await renderHook();
    expect(showDeepLinkError).toHaveBeenCalledWith(
      "This link is not supported.",
      "UNSUPPORTED_URL",
    );
    expect(mockResolveConnectDeepLink).not.toHaveBeenCalled();
    expect(mockResolveOpenDeepLink).not.toHaveBeenCalled();
  });
});
