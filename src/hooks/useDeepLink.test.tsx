import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeepLink } from "./useDeepLink";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { getCurrent } from "@tauri-apps/plugin-deep-link";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import {
  OEM_CLOUD_PAYMENT_RETURN_EVENT,
  readStoredOemCloudPaymentReturn,
} from "@/lib/oemCloudPaymentReturn";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: vi.fn(),
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: vi.fn(() => true),
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

vi.mock("@/lib/oemCloudDesktopAuth", () => ({
  completeOemCloudDesktopOAuthLogin: vi.fn(),
  parseOemCloudDesktopOAuthCallbackUrl: vi.fn(() => null),
}));

vi.mock("@/lib/api/oemCloudRuntime", () => ({
  resolveOemCloudRuntimeContext: vi.fn(() => null),
}));

vi.mock("@/lib/oemLimeHubProvider", () => ({
  resolveOemLimeHubProviderName: vi.fn(() => "Lime Hub"),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook(
  options?: Parameters<typeof useDeepLink>[0],
) {
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
  beforeEach(() => {
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(true);
    vi.mocked(safeListen).mockResolvedValue(vi.fn());
    vi.mocked(safeInvoke).mockResolvedValue({});
    vi.mocked(getCurrent).mockResolvedValue([]);
    window.localStorage.clear();
  });

  afterEach(() => {
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
  });

  it("浏览器开发模式下不应注册 deep-link 事件桥", async () => {
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);

    await renderHook();

    expect(safeListen).not.toHaveBeenCalled();
    expect(getCurrent).not.toHaveBeenCalled();
  });

  it("应解析官网 open deep link 并回调前端导航", async () => {
    const onOpenWebsiteDeepLink = vi.fn();
    vi.mocked(getCurrent).mockResolvedValue([
      "lime://open?kind=prompt&slug=gemini-longform-master&source=website&v=1",
    ]);
    vi.mocked(safeInvoke).mockImplementation(async (command) => {
      if (command === "handle_open_deep_link") {
        return {
          payload: {
            kind: "prompt",
            slug: "gemini-longform-master",
            source: "website",
            version: "1",
          },
        };
      }

      return {};
    });

    await renderHook({
      onOpenWebsiteDeepLink,
    });

    expect(safeInvoke).toHaveBeenCalledWith("handle_open_deep_link", {
      url: "lime://open?kind=prompt&slug=gemini-longform-master&source=website&v=1",
    });
    expect(onOpenWebsiteDeepLink).toHaveBeenCalledWith({
      kind: "prompt",
      slug: "gemini-longform-master",
      source: "website",
      version: "1",
    });
  });

  it("应解析支付回跳 deep link 并分发给云端购买状态刷新链路", async () => {
    const received: unknown[] = [];
    const listener = (event: Event) => {
      received.push(event instanceof CustomEvent ? event.detail : null);
    };
    window.addEventListener(OEM_CLOUD_PAYMENT_RETURN_EVENT, listener);
    vi.mocked(getCurrent).mockResolvedValue([
      "lime://payment/return?tenantId=tenant-0001&orderId=order-001&kind=plan_order&status=success",
    ]);

    await renderHook();

    window.removeEventListener(OEM_CLOUD_PAYMENT_RETURN_EVENT, listener);
    expect(safeInvoke).not.toHaveBeenCalled();
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      tenantId: "tenant-0001",
      orderId: "order-001",
      kind: "plan_order",
      status: "success",
    });
    expect(readStoredOemCloudPaymentReturn()).toMatchObject({
      tenantId: "tenant-0001",
      orderId: "order-001",
      kind: "plan_order",
    });
  });
});
