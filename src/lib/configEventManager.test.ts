import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dev-bridge", () => ({
  safeListen: vi.fn(),
}));

vi.mock("@/lib/tauri-runtime", () => ({
  hasTauriInvokeCapability: vi.fn(() => true),
}));

import { safeListen } from "@/lib/dev-bridge";
import { hasTauriInvokeCapability } from "@/lib/tauri-runtime";
import { configEventManager } from "./configEventManager";

describe("configEventManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configEventManager.unsubscribe();
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(true);
    vi.mocked(safeListen).mockResolvedValue(vi.fn());
  });

  it("浏览器开发模式下不应占用 config-changed 事件桥连接", async () => {
    vi.mocked(hasTauriInvokeCapability).mockReturnValue(false);

    await configEventManager.subscribe();

    expect(safeListen).not.toHaveBeenCalled();
    expect(configEventManager.isSubscribed()).toBe(false);
  });
});
