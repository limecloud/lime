import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listBrowserExtensions,
  loadBrowserExtension,
  removeBrowserExtension,
  setBrowserExtensionEnabled,
} from "./browserExtensions";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

const extension = {
  id: "abc123",
  name: "Fixture",
  version: "1.0.0",
  manifestVersion: 3,
  path: "/tmp/ext",
  enabled: true,
};

describe("browserExtensions", () => {
  beforeEach(() => invoke.mockReset());

  it("列出扩展并校验返回结构", async () => {
    invoke.mockResolvedValue([extension]);
    await expect(listBrowserExtensions()).resolves.toEqual([extension]);
    expect(invoke).toHaveBeenCalledWith("browser_extensions_list");

    invoke.mockResolvedValue([{ id: "" }]);
    await expect(listBrowserExtensions()).rejects.toThrow("invalid list");
  });

  it("加载扩展并校验结果", async () => {
    invoke.mockResolvedValue(extension);
    await expect(loadBrowserExtension("/tmp/ext")).resolves.toEqual(extension);
    expect(invoke).toHaveBeenCalledWith("browser_extensions_load", {
      path: "/tmp/ext",
    });

    invoke.mockResolvedValue(null);
    await expect(loadBrowserExtension("/tmp/ext")).rejects.toThrow(
      "invalid result",
    );
  });

  it("删除扩展要求 Host 返回 true", async () => {
    invoke.mockResolvedValue(true);
    await expect(removeBrowserExtension("abc123")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith("browser_extensions_remove", {
      id: "abc123",
    });

    invoke.mockResolvedValue(false);
    await expect(removeBrowserExtension("abc123")).rejects.toThrow(
      "remove failed",
    );
  });

  it("启用/禁用扩展并校验返回结构", async () => {
    const disabled = { ...extension, enabled: false };
    invoke.mockResolvedValue(disabled);
    await expect(setBrowserExtensionEnabled("abc123", false)).resolves.toEqual(
      disabled,
    );
    expect(invoke).toHaveBeenCalledWith("browser_extensions_set_enabled", {
      id: "abc123",
      enabled: false,
    });
  });
});
