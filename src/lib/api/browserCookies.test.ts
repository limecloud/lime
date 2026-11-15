import { beforeEach, describe, expect, it, vi } from "vitest";
import { importChromeBrowserCookies } from "./browserCookies";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

describe("browserCookies", () => {
  beforeEach(() => invoke.mockReset());

  it("returns import counts", async () => {
    invoke.mockResolvedValue({ imported: 3, failed: 1, total: 4 });
    await expect(importChromeBrowserCookies()).resolves.toEqual({
      imported: 3,
      failed: 1,
      total: 4,
    });
    expect(invoke).toHaveBeenCalledWith("browser_cookies_import_chrome");
  });

  it("rejects invalid results", async () => {
    invoke.mockResolvedValue({ imported: "3" });
    await expect(importChromeBrowserCookies()).rejects.toThrow(
      "invalid result",
    );
  });
});
