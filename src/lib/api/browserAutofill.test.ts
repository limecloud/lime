import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readBrowserAutofillEnabled,
  setBrowserAutofillEnabled,
} from "./browserAutofill";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

beforeEach(() => vi.clearAllMocks());

describe("browserAutofill API", () => {
  it("读取与设置自动填充开关", async () => {
    invoke.mockResolvedValue(true);
    await expect(readBrowserAutofillEnabled()).resolves.toBe(true);
    invoke.mockResolvedValue(false);
    await expect(setBrowserAutofillEnabled(false)).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledWith("browser_autofill_set", {
      enabled: false,
    });
  });

  it("拒绝非法返回值", async () => {
    invoke.mockResolvedValue("yes");
    await expect(readBrowserAutofillEnabled()).rejects.toThrow("invalid state");
    await expect(setBrowserAutofillEnabled(true)).rejects.toThrow(
      "invalid state",
    );
  });
});
