import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import {
  closeTerminal,
  createTerminalSession,
  decodeBase64,
  decodeBytes,
  encodeBase64,
  getTerminalSession,
  listTerminalSessions,
  onSessionOutput,
  resizeTerminal,
  writeToTerminal,
  writeToTerminalRaw,
} from "./terminal";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));

describe("terminal API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理终端会话命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ session_id: "session-1" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: "session-1", status: "running" }])
      .mockResolvedValueOnce({ id: "session-1", status: "running" });

    await expect(createTerminalSession("/tmp")).resolves.toBe("session-1");
    await expect(writeToTerminal("session-1", "ls\n")).resolves.toBeUndefined();
    await expect(
      writeToTerminalRaw("session-1", "bHMK"),
    ).resolves.toBeUndefined();
    await expect(resizeTerminal("session-1", 24, 80)).resolves.toBeUndefined();
    await expect(listTerminalSessions()).resolves.toEqual([
      expect.objectContaining({ id: "session-1" }),
    ]);
    await expect(getTerminalSession("session-1")).resolves.toEqual(
      expect.objectContaining({ id: "session-1" }),
    );
  });

  it("应支持编码与监听输出", async () => {
    expect(decodeBytes(decodeBase64(encodeBase64("hello")))).toBe("hello");

    const listener = vi.fn();
    vi.mocked(safeListen).mockImplementation(async (_event, handler) => {
      handler({
        payload: { session_id: "session-1", data: encodeBase64("hi") },
      });
      return vi.fn();
    });

    await onSessionOutput("session-1", listener);
    expect(listener).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it("应代理关闭终端命令", async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce(undefined);
    await expect(closeTerminal("session-1")).resolves.toBeUndefined();
  });
});
