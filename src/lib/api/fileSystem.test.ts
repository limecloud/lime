import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { openPathWithDefaultApp, revealPathInFinder } from "./fileSystem";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("fileSystem API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理 reveal_in_finder", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    await expect(revealPathInFinder("/tmp/demo.txt")).resolves.toBeUndefined();
    expect(safeInvoke).toHaveBeenCalledWith("reveal_in_finder", {
      path: "/tmp/demo.txt",
    });
  });

  it("应代理 open_with_default_app", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);

    await expect(
      openPathWithDefaultApp("/tmp/demo.txt"),
    ).resolves.toBeUndefined();
    expect(safeInvoke).toHaveBeenCalledWith("open_with_default_app", {
      path: "/tmp/demo.txt",
    });
  });
});
