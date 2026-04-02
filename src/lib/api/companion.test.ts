import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  getCompanionPetStatus,
  launchCompanionPet,
  listenCompanionPetStatus,
  sendCompanionPetCommand,
} from "./companion";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));

describe("companion API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应读取桌宠状态并代理命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({
        endpoint: "ws://127.0.0.1:45554/companion/pet",
        server_listening: true,
        connected: true,
        client_id: "lime",
        platform: "macos",
        capabilities: ["bubble", "movement"],
        last_event: "pet.ready",
        last_error: null,
        last_state: "walking",
      })
      .mockResolvedValueOnce({
        launched: true,
        resolved_path: "/Applications/Lime Pet.app/Contents/MacOS/Lime Pet",
        endpoint: "ws://127.0.0.1:45554/companion/pet",
        message: null,
      })
      .mockResolvedValueOnce({
        delivered: true,
        connected: true,
      });

    await expect(getCompanionPetStatus()).resolves.toEqual(
      expect.objectContaining({
        connected: true,
        client_id: "lime",
      }),
    );
    await expect(
      launchCompanionPet({ app_path: "/Applications/Lime Pet.app" }),
    ).resolves.toEqual(expect.objectContaining({ launched: true }));
    await expect(
      sendCompanionPetCommand({
        event: "pet.show_bubble",
        payload: { text: "你好" },
      }),
    ).resolves.toEqual({ delivered: true, connected: true });
  });

  it("应代理桌宠状态监听", async () => {
    vi.mocked(safeListen).mockImplementationOnce(async (_event, handler) => {
      handler({
        payload: {
          endpoint: "ws://127.0.0.1:45554/companion/pet",
          server_listening: true,
          connected: false,
          client_id: null,
          platform: null,
          capabilities: [],
          last_event: "pet.disconnected",
          last_error: "桌宠连接已关闭",
          last_state: null,
        },
      });
      return vi.fn();
    });

    const handler = vi.fn();
    await listenCompanionPetStatus(handler);

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        connected: false,
        last_event: "pet.disconnected",
      }),
    );
  });
});
