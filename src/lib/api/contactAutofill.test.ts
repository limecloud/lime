import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearContactAutofillProfile,
  readContactAutofillProfile,
  saveContactAutofillProfile,
} from "./contactAutofill";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

const profile = {
  fullName: "Alice",
  email: "alice@example.com",
  phone: "123",
  address: "1 Main St",
};

beforeEach(() => vi.clearAllMocks());

describe("contactAutofill API", () => {
  it("读取并校验资料", async () => {
    invoke.mockResolvedValue(profile);
    await expect(readContactAutofillProfile()).resolves.toEqual(profile);
    invoke.mockResolvedValue(null);
    await expect(readContactAutofillProfile()).resolves.toBeNull();
    invoke.mockResolvedValue({ fullName: "x" });
    await expect(readContactAutofillProfile()).rejects.toThrow(
      "invalid result",
    );
  });

  it("保存资料并校验返回值", async () => {
    invoke.mockResolvedValue(profile);
    await expect(
      saveContactAutofillProfile({ fullName: "Alice" }),
    ).resolves.toEqual(profile);
    expect(invoke).toHaveBeenCalledWith("browser_contact_profile_save", {
      fullName: "Alice",
    });
    invoke.mockResolvedValue("nope");
    await expect(
      saveContactAutofillProfile({ fullName: "Alice" }),
    ).rejects.toThrow("invalid result");
  });

  it("清除资料并校验返回值", async () => {
    invoke.mockResolvedValue(true);
    await expect(clearContactAutofillProfile()).resolves.toBe(true);
    invoke.mockResolvedValue(undefined);
    await expect(clearContactAutofillProfile()).rejects.toThrow(
      "invalid result",
    );
  });
});
