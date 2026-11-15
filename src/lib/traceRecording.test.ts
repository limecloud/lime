import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadTraceRecording,
  isTraceRecording,
  startTraceRecording,
  stopTraceRecording,
} from "./traceRecording";

vi.mock("@/lib/dev-bridge/safeInvoke", () => ({
  clearInvokeErrorBuffer: vi.fn(),
  clearInvokeTraceBuffer: vi.fn(),
  getInvokeErrorBuffer: vi.fn(() => [{ command: "x" }]),
  getInvokeTraceBuffer: vi.fn(() => [{ command: "x" }]),
}));

describe("traceRecording", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (isTraceRecording()) stopTraceRecording();
  });

  it("start/stop 生成快照，stop 后可再次开始", () => {
    startTraceRecording();
    expect(isTraceRecording()).toBe(true);
    const snapshot = stopTraceRecording();
    expect(snapshot?.invokeTrace).toHaveLength(1);
    expect(snapshot?.invokeErrors).toHaveLength(1);
    expect(isTraceRecording()).toBe(false);
    expect(stopTraceRecording()).toBeNull();
  });

  it("导出 trace 触发下载", () => {
    const click = vi.fn();
    const createObjectURL = vi.fn(() => "blob:trace");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.spyOn(document, "createElement").mockReturnValue({
      click,
      href: "",
      download: "",
    } as unknown as HTMLAnchorElement);
    downloadTraceRecording({
      startedAt: "2026-11-15T00:00:00.000Z",
      endedAt: "2026-11-15T00:00:01.000Z",
      invokeTrace: [],
      invokeErrors: [],
    });
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:trace");
  });
});
