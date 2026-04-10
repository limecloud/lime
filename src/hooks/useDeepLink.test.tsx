import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeepLink } from "./useDeepLink";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { getCurrent } from "@tauri-apps/plugin-deep-link";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";

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

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function renderHook() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Probe() {
    useDeepLink();
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
});
