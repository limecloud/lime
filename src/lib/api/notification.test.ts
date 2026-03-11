import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { showSystemNotification } from "./notification";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("notification API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理系统通知命令", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    await expect(
      showSystemNotification({
        title: "title",
        body: "body",
        icon: "icon",
      }),
    ).resolves.toBeUndefined();
  });
});
