import { afterEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/api/cloudDesktopConnection", () => ({
  configureCloudDesktopConnection: invoke,
}));
import { prepareCloudRuntimeRelease } from "./prepareCloudRuntimeRelease";

const context = { profile: "fixture", regionId: "cn-hangzhou" };
const ready = {
  kind: "guestPreparation",
  version: "1.175.0",
  phase: "ready",
  busy: false,
};
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("local runtime preparation", () => {
  it("starts once, polls read-only status, and waits for verified ready", async () => {
    vi.useFakeTimers();
    invoke
      .mockResolvedValueOnce({
        ...ready,
        phase: "downloading",
        busy: true,
        receivedBytes: 8,
        totalBytes: 10,
      })
      .mockResolvedValueOnce({
        ...ready,
        phase: "verifying",
        busy: true,
        receivedBytes: 10,
        totalBytes: 10,
      })
      .mockResolvedValueOnce(ready);
    const progress = vi.fn();
    const result = prepareCloudRuntimeRelease(() => true, progress, context);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe(true);
    expect(invoke.mock.calls).toEqual([
      [{ action: "prepareRuntimeRelease", ...context }],
      [{ action: "runtimeReleaseStatus", ...context }],
      [{ action: "runtimeReleaseStatus", ...context }],
    ]);
    expect(progress.mock.calls.map(([status]) => status.phase)).toEqual([
      "downloading",
      "verifying",
      "ready",
    ]);
  });

  it("stops polling after context changes while leaving Main's reusable download alone", async () => {
    vi.useFakeTimers();
    let current = true;
    invoke.mockResolvedValue({ ...ready, phase: "downloading", busy: true });
    const result = prepareCloudRuntimeRelease(() => current, vi.fn(), context);
    await vi.advanceTimersByTimeAsync(0);
    current = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe(false);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it.each([
    { ...ready, receivedBytes: 11, totalBytes: 10 },
    { ...ready, receivedBytes: -1, totalBytes: 10 },
    { ...ready, receivedBytes: 1.5, totalBytes: 10 },
    { ...ready, totalBytes: 1024 ** 3 + 1 },
    { ...ready, receivedBytes: 1 },
    { ...ready, phase: "unknown" },
    { ...ready, busy: "false" },
    { ...ready, version: null },
    { kind: "guestRelease", available: true },
  ])(
    "rejects malformed progress before treating preparation as ready %#",
    async (status) => {
      invoke.mockResolvedValue(status);
      await expect(
        prepareCloudRuntimeRelease(() => true, vi.fn(), context),
      ).rejects.toThrow(/^CLOUD_INSTALL_PACKAGE_INVALID$/);
      expect(invoke).toHaveBeenCalledOnce();
    },
  );

  it("does not silently restart failed or interrupted work during polling", async () => {
    invoke.mockResolvedValue({
      ...ready,
      phase: "failed",
      diagnostic: "private diagnostic",
    });
    await expect(
      prepareCloudRuntimeRelease(() => true, vi.fn(), context),
    ).rejects.toThrow(/^CLOUD_INSTALL_RELEASE_UNAVAILABLE$/);
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]).toEqual([
      { action: "prepareRuntimeRelease", ...context },
    ]);
  });

  it("rejects a version change between the original preparation and a later status", async () => {
    vi.useFakeTimers();
    invoke
      .mockResolvedValueOnce({ ...ready, phase: "checking", busy: true })
      .mockResolvedValueOnce({ ...ready, version: "1.176.0" });
    const result = expect(
      prepareCloudRuntimeRelease(() => true, vi.fn(), context),
    ).rejects.toThrow(/^CLOUD_INSTALL_PACKAGE_INVALID$/);
    await vi.advanceTimersByTimeAsync(1000);
    await result;
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
