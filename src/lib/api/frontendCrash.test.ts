import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { reportFrontendCrash } from "./frontendCrash";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("frontendCrash API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理前端崩溃上报命令", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    await expect(
      reportFrontendCrash({ message: "boom" }),
    ).resolves.toBeUndefined();
  });
});
