import { describe, expect, it, vi } from "vitest";
import { loadModuleWithRetry } from "./agentChatWorkspaceLoader";

describe("loadModuleWithRetry", () => {
  it("应在模块动态导入瞬时失败时自动重试", async () => {
    const loader = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(
        new Error("Failed to fetch dynamically imported module: /agent"),
      )
      .mockResolvedValueOnce({ ok: true });

    await expect(loadModuleWithRetry(loader, [0])).resolves.toEqual({
      ok: true,
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("非模块导入错误不应重试", async () => {
    const loader = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockRejectedValueOnce(new Error("workspace init failed"));

    await expect(loadModuleWithRetry(loader, [0, 0])).rejects.toThrow(
      "workspace init failed",
    );
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
