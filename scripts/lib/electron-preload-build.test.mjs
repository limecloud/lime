// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { buildPreload } from "../electron/build-host.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("sandbox preload bundles", () => {
  it("executes both preloads that share a module with only Electron's sandbox require", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "electron-preload-bundle-"),
    );
    roots.push(root);
    await mkdir(path.join(root, "electron"));
    await writeFile(
      path.join(root, "electron/shared.ts"),
      'export const value = "shared-design-value";',
    );
    const entries = ["page", "editor"].map((name) => ({
      name,
      source: `electron/${name}.ts`,
      output: `dist-electron/preload/${name}.cjs`,
    }));
    for (const entry of entries)
      await writeFile(
        path.join(root, entry.source),
        `import { ipcRenderer } from "electron"; import { value } from "./shared"; ipcRenderer.send("${entry.name}", value);`,
      );
    await buildPreload(root, entries);
    const events = [];
    for (const entry of entries) {
      const code = await readFile(path.join(root, entry.output), "utf8");
      const module = { exports: {} };
      vm.runInNewContext(code, {
        module,
        exports: module.exports,
        require(specifier) {
          if (specifier !== "electron")
            throw new Error(`Sandbox cannot load ${specifier}`);
          return { ipcRenderer: { send: (...args) => events.push(args) } };
        },
      });
    }
    expect(events).toEqual([
      ["page", "shared-design-value"],
      ["editor", "shared-design-value"],
    ]);
  });
});
