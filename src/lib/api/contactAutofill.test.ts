import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearContactAutofillData,
  readContactAutofillData,
  saveContactAutofillData,
} from "./contactAutofill";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dev-bridge", () => ({ safeInvoke: invoke }));

const data = {
  emails: ["alice@example.com"],
  phones: ["123"],
  addresses: ["1 Main St"],
};

beforeEach(() => vi.clearAllMocks());

describe("contactAutofill API", () => {
  it("读取并校验联系信息", async () => {
    invoke.mockResolvedValue(data);
    await expect(readContactAutofillData()).resolves.toEqual(data);
    invoke.mockResolvedValue(null);
    await expect(readContactAutofillData()).resolves.toBeNull();
    invoke.mockResolvedValue({ emails: "x" });
    await expect(readContactAutofillData()).rejects.toThrow("invalid result");
  });

  it("保存并校验返回值", async () => {
    invoke.mockResolvedValue(data);
    await expect(
      saveContactAutofillData({ emails: ["alice@example.com"] }),
    ).resolves.toEqual(data);
    expect(invoke).toHaveBeenCalledWith("browser_contact_profile_save", {
      emails: ["alice@example.com"],
    });
    invoke.mockResolvedValue("nope");
    await expect(
      saveContactAutofillData({ emails: ["a@example.com"] }),
    ).rejects.toThrow("invalid result");
  });

  it("清除并校验返回值", async () => {
    invoke.mockResolvedValue(true);
    await expect(clearContactAutofillData()).resolves.toBe(true);
    invoke.mockResolvedValue(undefined);
    await expect(clearContactAutofillData()).rejects.toThrow("invalid result");
  });
});
