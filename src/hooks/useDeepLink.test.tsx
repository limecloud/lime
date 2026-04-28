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
import { readStoredOemCloudReferralInvite } from "@/lib/oemCloudReferralClaim";
import { setStoredOemCloudSessionState } from "@/lib/oemCloudSession";

const {
  mockClaimClientReferral,
  mockToastError,
  mockToastInfo,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockClaimClientReferral: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

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

vi.mock("@/lib/api/oemCloudControlPlane", () => ({
  claimClientReferral: mockClaimClientReferral,
}));

vi.mock("@/lib/oemLimeHubProvider", () => ({
  resolveOemLimeHubProviderName: vi.fn(() => "Lime Hub"),
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
    mockClaimClientReferral.mockResolvedValue({});
    window.localStorage.clear();
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
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
    delete window.__LIME_BOOTSTRAP__;
    delete window.__LIME_OEM_CLOUD__;
    delete window.__LIME_SESSION_TOKEN__;
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

  it("应缓存邀请 deep link，等待云端登录后自动领取", async () => {
    vi.mocked(getCurrent).mockResolvedValue([
      "lime://invite?code=nm-45bc-8dhw&tenantId=tenant-0001",
    ]);

    await renderHook();

    expect(mockClaimClientReferral).not.toHaveBeenCalled();
    expect(readStoredOemCloudReferralInvite()).toMatchObject({
      code: "NM-45BC-8DHW",
      tenantId: "tenant-0001",
    });
    expect(mockToastInfo).toHaveBeenCalledWith(
      "邀请码已保存",
      expect.objectContaining({
        description: expect.stringContaining("登录 Lime 云端账号后"),
      }),
    );
  });

  it("已有云端会话时应自动调用邀请 claim 接口", async () => {
    setStoredOemCloudSessionState({
      token: "session-token-001",
      tenant: { id: "tenant-0001", name: "Lime" },
      user: { id: "user-001", displayName: "晚风" },
      session: { id: "session-001" },
    });
    vi.mocked(getCurrent).mockResolvedValue([
      "https://limeai.run/invite?code=LIME-2026&tenantId=tenant-0001",
    ]);

    await renderHook();

    expect(mockClaimClientReferral).toHaveBeenCalledWith(
      "tenant-0001",
      expect.objectContaining({
        code: "LIME-2026",
        claimMethod: "auto",
        entrySource: "link",
        landingPath: "/invite?code=LIME-2026&tenantId=tenant-0001",
      }),
    );
    expect(readStoredOemCloudReferralInvite()).toBeNull();
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "邀请码已领取",
      expect.objectContaining({
        description: expect.stringContaining("云端邀请奖励已提交"),
      }),
    );
  });
});
