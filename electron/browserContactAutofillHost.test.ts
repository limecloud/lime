import { describe, expect, it, vi } from "vitest";
import { registerBrowserContactAutofill } from "./browserContactAutofillHost";
import type { ContactAutofillStore } from "./contactAutofillStore";

describe("registerBrowserContactAutofill", () => {
  it("仅对嵌入浏览器 session 返回资料", async () => {
    const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (event: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        },
      ),
      removeHandler: vi.fn(),
    };
    const profile = {
      fullName: "Alice",
      email: "a@example.com",
      phone: "",
      address: "",
    };
    const store = { read: vi.fn().mockResolvedValue(profile) };
    const session = {};
    const cleanup = registerBrowserContactAutofill({
      ipcMain: ipcMain as never,
      session: session as never,
      store: store as unknown as ContactAutofillStore,
      isEnabled: async () => false,
    });
    const handler = handlers.get([...handlers.keys()][0])!;
    await expect(
      handler({
        sender: { session },
        senderFrame: { url: "https://example.com/login" },
      }),
    ).resolves.toBeNull();
    await expect(
      handler({
        sender: { session },
        senderFrame: { url: "http://example.com/login" },
      }),
    ).resolves.toBeNull();
    await expect(handler({ sender: { session: {} } })).resolves.toBeNull();
    cleanup();
    expect(ipcMain.removeHandler).toHaveBeenCalled();
  });
});
