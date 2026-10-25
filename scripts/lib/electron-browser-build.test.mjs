import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HOST_PRELOAD_BUILD_ENTRIES,
  HOST_CLIENT_BUILD_ENTRIES,
  HOST_SOURCE_DIRS,
  HOST_SOURCE_FILES,
  RENDERER_BUILD_ENTRIES,
  fingerprintBuildInputs,
} from "./electron-build-inputs.mjs";
import {
  beginRendererBuild,
  completeRendererBuild,
  inspectRendererBuildReceipt,
} from "./electron-renderer-build.mjs";
import {
  electronFixtureBuildRequiredFiles,
  inspectElectronFixtureBuildFreshness,
} from "./electron-fixture-build.mjs";

const roots = [];
const sourceTime = new Date("2026-01-01T00:00:00.000Z");
const artifactTime = new Date("2026-01-01T00:10:00.000Z");
function write(root, name, content, mtime = sourceTime) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  fs.utimesSync(target, mtime, mtime);
  return target;
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "electron-browser-build-"),
  );
  roots.push(root);
  for (const entry of [
    ...RENDERER_BUILD_ENTRIES,
    ...HOST_PRELOAD_BUILD_ENTRIES,
    ...HOST_CLIENT_BUILD_ENTRIES,
  ])
    write(root, entry.source, "source entry");
  for (const output of electronFixtureBuildRequiredFiles({ rootDir: root }))
    write(root, path.relative(root, output), "artifact", artifactTime);
  for (const entry of RENDERER_BUILD_ENTRIES)
    write(
      root,
      entry.output,
      `<script type="module" src="./assets/${entry.name}.js"></script><link rel="stylesheet" href="./assets/${entry.name}.css">`,
      artifactTime,
    );
  for (const entry of RENDERER_BUILD_ENTRIES) {
    write(root, `dist/assets/${entry.name}.js`, "export {};", artifactTime);
    write(root, `dist/assets/${entry.name}.css`, "body {}", artifactTime);
  }
  completeRendererBuild(beginRendererBuild(root));
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

describe("browser renderer build receipts", () => {
  it("binds every declared HTML entry to its compiled bytes", () => {
    const root = fixture();
    const receipt = inspectRendererBuildReceipt(root);
    expect(receipt).toMatchObject({
      ready: true,
      entries: RENDERER_BUILD_ENTRIES.map((entry) => ({
        ...entry,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })),
    });
    write(root, "dist/browser-annotation.html", "changed annotation entry");
    expect(inspectRendererBuildReceipt(root)).toMatchObject({
      ready: false,
      reason: "renderer-entry-mismatch",
    });
  });

  it.each(["modify", "delete"])(
    "rejects a %s of the annotation HTML source after the build",
    (mutation) => {
      const root = fixture();
      const source = path.join(root, "browser-annotation.html");
      if (mutation === "delete") fs.unlinkSync(source);
      else write(root, "browser-annotation.html", "source other");
      expect(inspectRendererBuildReceipt(root)).toMatchObject({
        ready: false,
        reason: "renderer-input-mismatch",
      });
    },
  );

  it("cannot complete a build when a declared annotation source is missing", () => {
    const root = fixture();
    fs.unlinkSync(path.join(root, "browser-annotation.html"));
    expect(() => completeRendererBuild(beginRendererBuild(root))).toThrow(
      "entry source is missing",
    );
    expect(inspectRendererBuildReceipt(root).ready).toBe(false);
  });
});

describe("browser fixture build artifacts", () => {
  it.each([
    "dist/browser-annotation.html",
    "dist-electron/preload/browserOverlay.cjs",
    "dist-electron/preload/browserPage.cjs",
    "dist-electron/preload/browserAnnotationEditor.cjs",
  ])("requires the %s artifact", (output) => {
    const root = fixture();
    expect(inspectElectronFixtureBuildFreshness({ rootDir: root }).ready).toBe(
      true,
    );
    fs.unlinkSync(path.join(root, output));
    expect(
      inspectElectronFixtureBuildFreshness({ rootDir: root }),
    ).toMatchObject({
      ready: false,
      reason: "missing-artifacts",
      missingFiles: [path.join(root, output)],
    });
    expect(inspectRendererBuildReceipt(root).ready).toBe(
      output !== "dist/browser-annotation.html",
    );
  });

  it.each(["js", "css"])(
    "checks annotation %s assets in addition to the main page",
    (extension) => {
      const root = fixture();
      fs.unlinkSync(
        path.join(root, `dist/assets/browserAnnotation.${extension}`),
      );
      expect(
        inspectElectronFixtureBuildFreshness({ rootDir: root }),
      ).toMatchObject({
        ready: false,
        reason: "invalid-renderer-assets",
        staleSegments: ["renderer"],
        invalidRendererAssets: [
          {
            reason: "missing-local-file",
            relativePath: path.join(
              "dist",
              "assets",
              `browserAnnotation.${extension}`,
            ),
          },
        ],
      });
    },
  );

  it.each([
    ["browser-annotation.html", "dist/browser-annotation.html", "renderer"],
    [
      "electron/browserPagePreload.ts",
      "dist-electron/preload/browserPage.cjs",
      "host",
    ],
    [
      "electron/browserAnnotationEditorPreload.ts",
      "dist-electron/preload/browserAnnotationEditor.cjs",
      "host",
    ],
  ])(
    "retains declared artifacts when source %s is deleted",
    (source, output, segment) => {
      const root = fixture();
      fs.unlinkSync(path.join(root, source));
      expect(electronFixtureBuildRequiredFiles({ rootDir: root })).toContain(
        path.join(root, output),
      );
      expect(
        inspectElectronFixtureBuildFreshness({ rootDir: root }),
      ).toMatchObject({
        ready: false,
        staleSegments: [segment],
        segments: {
          [segment]: { missingSourceFiles: [path.join(root, source)] },
        },
      });
    },
  );

  it.each([
    "electron/browserPagePreload.ts",
    "electron/browserAnnotationEditorPreload.ts",
    "src/lib/api/browserAnnotationEditorTypes.ts",
  ])("invalidates the host when %s changes", (source) => {
    const root = fixture();
    write(
      root,
      source,
      "changed host input",
      new Date("2026-01-01T00:20:00.000Z"),
    );
    expect(
      inspectElectronFixtureBuildFreshness({ rootDir: root }),
    ).toMatchObject({
      ready: false,
      staleSegments: source.startsWith("src/")
        ? ["renderer", "host"]
        : ["host"],
    });
  });

  it("does not require undeclared browser entries in isolated fixture roots", () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), "electron-isolated-build-"),
    );
    roots.push(root);
    const files = electronFixtureBuildRequiredFiles({ rootDir: root });
    expect(files).toContain(path.join(root, "dist", "index.html"));
    expect(files).toContain(
      path.join(root, "dist-electron/preload/preload.cjs"),
    );
    expect(files).not.toContain(
      path.join(root, "dist/browser-annotation.html"),
    );
    expect(files).not.toContain(
      path.join(root, "dist-electron/preload/browserPage.cjs"),
    );
  });
});

it("includes shared editor channel constants in host input fingerprints", () => {
  const root = fixture();
  const inputs = {
    sourceDirs: HOST_SOURCE_DIRS,
    sourceFiles: HOST_SOURCE_FILES,
  };
  const before = fingerprintBuildInputs(root, inputs);
  write(
    root,
    "src/lib/api/browserAnnotationEditorTypes.ts",
    "export const channel = 'update';",
  );
  expect(fingerprintBuildInputs(root, inputs).sha256).not.toBe(before.sha256);
});
