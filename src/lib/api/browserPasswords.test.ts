import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBrowserPasswords,
  listBrowserPasswords,
  removeBrowserPassword,
  revealBrowserPassword,
  saveBrowserPassword,
} from "./browserPasswords";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

const summary = {
  id: "p1",
  origin: "https://example.com",
  username: "alice",
  updatedAt: 1,
};

beforeEach(() => vi.clearAllMocks());

describe("browserPasswords API", () => {
  it("列出并校验摘要", async () => {
    invoke.mockResolvedValue([summary]);
    await expect(listBrowserPasswords()).resolves.toEqual([summary]);
    invoke.mockResolvedValue([{ ...summary, extra: "password" }]);
    await expect(listBrowserPasswords()).resolves.toHaveLength(1);
    invoke.mockResolvedValue([{ id: "x" }]);
    await expect(listBrowserPasswords()).rejects.toThrow("invalid list");
  });

  it("保存、移除与显示密码", async () => {
    invoke.mockResolvedValue(summary);
    await expect(
      saveBrowserPassword({
        origin: "https://example.com",
        username: "alice",
        password: "secret",
      }),
    ).resolves.toEqual(summary);
    expect(invoke).toHaveBeenCalledWith("browser_passwords_save", {
      origin: "https://example.com",
      username: "alice",
      password: "secret",
    });

    invoke.mockResolvedValue(true);
    await expect(removeBrowserPassword("p1")).resolves.toBe(true);
    invoke.mockResolvedValue(null);
    await expect(revealBrowserPassword("p1")).resolves.toBeNull();
    invoke.mockResolvedValue("secret");
    await expect(revealBrowserPassword("p1")).resolves.toBe("secret");
  });

  it("拒绝非法返回值", async () => {
    invoke.mockResolvedValue(null);
    await expect(
      saveBrowserPassword({
        origin: "https://example.com",
        username: "alice",
        password: "secret",
      }),
    ).rejects.toThrow("invalid result");
    invoke.mockResolvedValue("yes");
    await expect(removeBrowserPassword("p1")).rejects.toThrow("invalid result");
    invoke.mockResolvedValue(42);
    await expect(revealBrowserPassword("p1")).rejects.toThrow("invalid result");
  });

  it("清除所有密码并校验返回值", async () => {
    invoke.mockResolvedValue(true);
    await expect(clearBrowserPasswords()).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("browser_passwords_clear");
    invoke.mockResolvedValue(null);
    await expect(clearBrowserPasswords()).rejects.toThrow("invalid result");
  });
});
