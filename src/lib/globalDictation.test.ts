import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armGlobalDictation,
  cancelGlobalDictation,
  consumeGlobalDictation,
  insertGlobalDictation,
  isGlobalDictationArmed,
} from "./globalDictation";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/electron-host", () => ({
  getElectronHostBridge: () => ({ invoke: mocks.invoke }),
}));

describe("globalDictation", () => {
  afterEach(() => {
    cancelGlobalDictation();
    vi.clearAllMocks();
  });

  it("arm 后只能消费一次，cancel 清除状态", () => {
    armGlobalDictation();
    expect(isGlobalDictationArmed()).toBe(true);
    expect(consumeGlobalDictation()).toBe(true);
    expect(consumeGlobalDictation()).toBe(false);
    armGlobalDictation();
    cancelGlobalDictation();
    expect(isGlobalDictationArmed()).toBe(false);
  });

  it("通过 host text_insert 注入文本", async () => {
    mocks.invoke.mockResolvedValue(null);
    await expect(insertGlobalDictation("hello")).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("text_insert", { text: "hello" });
  });
});
