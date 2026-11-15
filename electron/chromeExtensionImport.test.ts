import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copyChromeExtension,
  discoverChromeExtensions,
} from "./chromeExtensionImport";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lime-chrome-ext-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeExtension(id: string, version: string, name: string) {
  const dir = path.join(root, "Default", "Extensions", id, version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ name, version, manifest_version: 3 }),
  );
  return dir;
}

describe("chromeExtensionImport", () => {
  it("discovers newest extension version per id", async () => {
    writeExtension("ext-a", "1.0.0", "A");
    writeExtension("ext-a", "1.2.0", "A newer");
    writeExtension("ext-b", "2.0.0", "B");
    const found = await discoverChromeExtensions([root]);
    expect(found).toHaveLength(2);
    expect(found.find((item) => item.id === "ext-a")).toMatchObject({
      name: "A newer",
      version: "1.2.0",
    });
  });

  it("resolves localized manifest names", async () => {
    const dir = path.join(root, "Default", "Extensions", "ext-d", "1.0.0");
    mkdirSync(path.join(dir, "_locales", "zh_CN"), { recursive: true });
    writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({
        name: "__MSG_name__",
        version: "1.0.0",
        manifest_version: 3,
        default_locale: "zh_CN",
      }),
    );
    writeFileSync(
      path.join(dir, "_locales", "zh_CN", "messages.json"),
      JSON.stringify({ name: { message: "本地化扩展" } }),
    );
    const found = await discoverChromeExtensions([root]);
    expect(found.find((item) => item.id === "ext-d")?.name).toBe("本地化扩展");
  });

  it("copies an extension into the target root", async () => {
    const source = writeExtension("ext-c", "1.0.0", "C");
    const target = await copyChromeExtension(
      source,
      path.join(root, "out"),
      "ext-c",
      "1.0.0",
    );
    expect(target).toContain("ext-c-1.0.0");
  });
});
