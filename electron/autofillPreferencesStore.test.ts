import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AutofillPreferencesStore } from "./autofillPreferencesStore";

describe("AutofillPreferencesStore", () => {
  it("默认启用并可持久化关闭", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "lime-autofill-"));
    const store = new AutofillPreferencesStore(
      path.join(directory, "browser-autofill.json"),
    );
    await expect(store.read()).resolves.toBe(true);
    await expect(store.set(false)).resolves.toBe(false);
    await expect(store.read()).resolves.toBe(false);
    await expect(store.set(true)).resolves.toBe(true);
    await expect(store.read()).resolves.toBe(true);
  });
});
