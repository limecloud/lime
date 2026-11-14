import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ContactAutofillStore } from "./contactAutofillStore";

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lime-contact-"));
  return new ContactAutofillStore(
    path.join(directory, "contact-autofill.json"),
  );
}

describe("ContactAutofillStore", () => {
  it("保存时裁剪空白并读取", async () => {
    const store = await createStore();
    expect(await store.read()).toBeNull();
    await expect(
      store.save({ fullName: " Alice ", email: " a@example.com " }),
    ).resolves.toEqual({
      fullName: "Alice",
      email: "a@example.com",
      phone: "",
      address: "",
    });
    expect(await store.read()).toEqual({
      fullName: "Alice",
      email: "a@example.com",
      phone: "",
      address: "",
    });
  });

  it("清除资料后读取为 null", async () => {
    const store = await createStore();
    await store.save({ fullName: "Alice" });
    await store.clear();
    expect(await store.read()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it("至少需要一项，空资料读取为 null", async () => {
    const store = await createStore();
    await expect(store.save({ fullName: "  " })).rejects.toThrow("至少填写");
  });

  it("校验邮箱格式", async () => {
    const store = await createStore();
    await expect(store.save({ email: "not-an-email" })).rejects.toThrow(
      "邮箱格式",
    );
    await expect(
      store.save({ email: "alice@example.com" }),
    ).resolves.toMatchObject({ email: "alice@example.com" });
  });
});
