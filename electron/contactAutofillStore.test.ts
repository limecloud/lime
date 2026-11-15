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
  it("保存时裁剪空白、去重并读取", async () => {
    const store = await createStore();
    expect(await store.read()).toBeNull();
    await expect(
      store.save({
        emails: [" a@example.com ", "a@example.com"],
        phones: [" 123 "],
      }),
    ).resolves.toEqual({
      emails: ["a@example.com"],
      phones: ["123"],
      addresses: [],
    });
    expect(await store.read()).toEqual({
      emails: ["a@example.com"],
      phones: ["123"],
      addresses: [],
    });
  });

  it("清除资料后读取为 null", async () => {
    const store = await createStore();
    await store.save({ emails: ["a@example.com"] });
    await store.clear();
    expect(await store.read()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it("至少需要一项，空资料读取为 null", async () => {
    const store = await createStore();
    await expect(store.save({ emails: ["  "] })).rejects.toThrow("至少填写");
  });

  it("校验邮箱格式", async () => {
    const store = await createStore();
    await expect(store.save({ emails: ["not-an-email"] })).rejects.toThrow(
      "邮箱格式",
    );
    await expect(
      store.save({ emails: ["alice@example.com"] }),
    ).resolves.toMatchObject({ emails: ["alice@example.com"] });
  });
});
