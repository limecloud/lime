import { describe, expect, it, vi } from "vitest";
import { registerBrowserPasswordAutofill } from "./browserPasswordAutofillHost";
import type { BrowserPasswordStore } from "./browserPasswordStore";

function setup() {
  const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
  const ipcMain = {
    handle: vi.fn(
      (channel: string, handler: (event: unknown) => Promise<unknown>) => {
        handlers.set(channel, handler);
      },
    ),
    removeHandler: vi.fn(),
  };
  const lookupForUrl = vi
    .fn()
    .mockResolvedValue([{ username: "alice", password: "secret" }]);
  const session = {};
  const cleanup = registerBrowserPasswordAutofill({
    ipcMain: ipcMain as never,
    session: session as never,
    store: { lookupForUrl } as unknown as BrowserPasswordStore,
  });
  const channel = [...handlers.keys()][0];
  return { handlers, ipcMain, lookupForUrl, session, cleanup, channel };
}

describe("registerBrowserPasswordAutofill", () => {
  it("仅对嵌入浏览器 session 的页面返回来源凭据", async () => {
    const { handlers, lookupForUrl, session, channel } = setup();
    const handler = handlers.get(channel)!;
    await expect(
      handler({
        sender: { session, getURL: () => "https://example.com" },
        senderFrame: { url: "https://example.com/login" },
      }),
    ).resolves.toEqual([{ username: "alice", password: "secret" }]);
    expect(lookupForUrl).toHaveBeenCalledWith("https://example.com/login");

    await expect(
      handler({
        sender: { session: {}, getURL: () => "https://evil.example" },
        senderFrame: { url: "https://evil.example" },
      }),
    ).resolves.toEqual([]);
    expect(lookupForUrl).toHaveBeenCalledTimes(1);
  });

  it("自动填充关闭时不返回凭据", async () => {
    const handlers = new Map<string, (event: unknown) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, handler: (event: unknown) => Promise<unknown>) => {
          handlers.set(channel, handler);
        },
      ),
      removeHandler: vi.fn(),
    };
    const lookupForUrl = vi.fn();
    const session = {};
    registerBrowserPasswordAutofill({
      ipcMain: ipcMain as never,
      session: session as never,
      store: { lookupForUrl } as never,
      isEnabled: async () => false,
    });
    const handler = handlers.get([...handlers.keys()][0])!;
    await expect(
      handler({
        sender: { session, getURL: () => "https://example.com" },
        senderFrame: { url: "https://example.com" },
      }),
    ).resolves.toEqual([]);
    expect(lookupForUrl).not.toHaveBeenCalled();
  });

  it("无 senderFrame 时回退 sender URL，并可注销", async () => {
    const { handlers, lookupForUrl, session, cleanup, ipcMain, channel } =
      setup();
    const handler = handlers.get(channel)!;
    await handler({
      sender: { session, getURL: () => "https://example.com/tab" },
      senderFrame: null,
    });
    expect(lookupForUrl).toHaveBeenCalledWith("https://example.com/tab");
    cleanup();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(channel);
  });
});
