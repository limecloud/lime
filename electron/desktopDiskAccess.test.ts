// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { readDesktopDiskAccess } from "./desktopDiskAccess";

vi.mock("node:fs/promises", () => ({ open: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe("disk access operational probe", () => {
  it("closes the system sentinel without reading any contents or following links", async () => {
    const close = vi.fn(async () => undefined);
    vi.mocked(open).mockResolvedValue({ close } as never);
    expect(await readDesktopDiskAccess()).toBe("granted");
    expect(open).toHaveBeenCalledWith(
      "/Library/Application Support/com.apple.TCC/TCC.db",
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    ["EPERM", "denied"],
    ["EACCES", "denied"],
    ["ENOENT", "unknown"],
    ["EIO", "unknown"],
  ])("keeps %s truthful as %s", async (code, expected) => {
    vi.mocked(open).mockRejectedValue({ code });
    expect(await readDesktopDiskAccess()).toBe(expected);
  });
});
