import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { checkCliBoundary } from "./cli-boundary.mjs";

const temporaryRoots = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe("CLI current owner boundary", () => {
  it("keeps CLI/TUI on the App Server owner and retired task CLI absent", () => {
    expect(checkCliBoundary()).toEqual([]);
  });

  it.each(["lime-rs/upstream", "lime-rs/codex-rs", "codex-rs"])(
    "rejects a restored source mirror at %s",
    (relativePath) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lime-cli-boundary-"));
      temporaryRoots.push(root);
      fs.mkdirSync(path.join(root, relativePath), { recursive: true });
      expect(checkCliBoundary(root)).toContain(
        `retired CLI path must stay deleted: ${relativePath}`,
      );
    },
  );

  it.each([
    ["lime-rs/Cargo.toml", "upstream/execpolicy"],
    ["lime-rs/crates/cli/Cargo.toml", "../../upstream/execpolicy"],
    ["lime-rs/Cargo.toml", "../codex-rs/cli"],
    ["lime-rs/Cargo.toml", "upstream\\\\execpolicy"],
  ])("rejects a stale dependency in %s pointing to %s", (manifest, target) => {
    const readFileSync = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation((file, options) => {
      const contents = readFileSync(file, options);
      return path.resolve(String(file)) === path.resolve(manifest)
        ? `${contents}\n[dependencies.retired]\npath = "${target}"\n`
        : contents;
    });
    expect(checkCliBoundary()).toContain(
      `Cargo dependencies must use current Lime owners: ${manifest}`,
    );
  });
});
