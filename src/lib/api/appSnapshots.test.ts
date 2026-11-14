import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));
import { listAppSnapshotWindows } from "./appSnapshots";

describe("listAppSnapshotWindows", () => {
  beforeEach(() => invoke.mockReset());

  it("validates and returns window thumbnails", async () => {
    invoke.mockResolvedValueOnce([
      { id: "1", name: "Editor", thumbnail: "data:image/png;base64,x" },
      { id: 2 },
    ]);
    await expect(listAppSnapshotWindows()).resolves.toEqual([
      { id: "1", name: "Editor", thumbnail: "data:image/png;base64,x" },
    ]);
  });
});
