import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  discordChannelProbe,
  gatewayChannelStart,
  gatewayTunnelCreate,
  gatewayTunnelStatus,
  telegramChannelProbe,
} from "./channelsRuntime";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("channelsRuntime API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理渠道运行时命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ channel: "telegram" })
      .mockResolvedValueOnce({ account_id: "default", ok: true })
      .mockResolvedValueOnce({ account_id: "default", ok: true });

    await expect(
      gatewayChannelStart({ channel: "telegram", accountId: "default" }),
    ).resolves.toEqual(expect.objectContaining({ channel: "telegram" }));
    await expect(
      telegramChannelProbe({ accountId: "default" }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(
      discordChannelProbe({ accountId: "default" }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it("应代理隧道运行时命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        result: { ok: true },
        status: { running: false },
      })
      .mockResolvedValueOnce({ running: true });

    await expect(
      gatewayTunnelCreate({ tunnelName: "proxycast", persist: true }),
    ).resolves.toEqual(expect.objectContaining({ result: expect.any(Object) }));
    await expect(gatewayTunnelStatus()).resolves.toEqual(
      expect.objectContaining({ running: true }),
    );
  });
});
