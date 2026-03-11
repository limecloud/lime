import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { runAutoFixConfiguration } from "./autoFix";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("autoFix API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理自动修复命令", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      issues_found: ["issue"],
      fixes_applied: ["fix"],
      warnings: [],
    });

    await expect(runAutoFixConfiguration()).resolves.toEqual(
      expect.objectContaining({
        issues_found: ["issue"],
        fixes_applied: ["fix"],
      }),
    );
  });
});
