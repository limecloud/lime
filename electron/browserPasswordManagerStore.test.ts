import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserPasswordManagerStore } from "./browserPasswordManagerStore";

let dir: string;
let store: BrowserPasswordManagerStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lime-password-manager-"));
  store = new BrowserPasswordManagerStore(path.join(dir, "store.json"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("BrowserPasswordManagerStore", () => {
  it("defaults to null and persists a provider", async () => {
    expect(await store.read()).toBeNull();
    await store.set("onepassword");
    expect(await store.read()).toBe("onepassword");
    await store.set("openai");
    expect(await store.read()).toBe("openai");
  });

  it("rejects unknown stored providers", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(dir, "store.json"), '{"provider":"unknown"}');
    expect(await store.read()).toBeNull();
  });
});
