import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  electronFixtureBuildReadyEnv,
  electronFixtureBuildRequiredFiles,
  ensureElectronFixtureBuild,
  inspectElectronFixtureBuildFreshness,
} from "./electron-fixture-build.mjs";
import {
  beginRendererBuild,
  completeRendererBuild,
} from "./electron-renderer-build.mjs";

const tempRoots = [];

function createTempRoot() {
  const rootDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "electron-fixture-build-"),
  );
  tempRoots.push(rootDir);
  return rootDir;
}

function writeFile(filePath, content, mtime) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  fs.utimesSync(filePath, mtime, mtime);
}

function writeRequiredFiles(rootDir, mtime) {
  for (const filePath of electronFixtureBuildRequiredFiles({ rootDir })) {
    writeFile(filePath, "fixture artifact", mtime);
  }
  writeFile(
    path.join(rootDir, "dist", "index.html"),
    '<script type="module" src="./assets/entry.js"></script>',
    mtime,
  );
  writeFile(
    path.join(rootDir, "dist", "assets", "entry.js"),
    "export {};",
    mtime,
  );
  completeRendererBuild(beginRendererBuild(rootDir));
}

function createRecordingRunner() {
  const calls = [];
  return {
    calls,
    runCommand(step) {
      calls.push({
        command: step.command,
        args: step.args,
      });
      return { status: 0 };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempRoots.length > 0) {
    const rootDir = tempRoots.pop();
    fs.rmSync(rootDir, { force: true, recursive: true });
  }
});

describe("Electron renderer entry assets", () => {
  const artifactTime = new Date("2026-01-01T00:10:00.000Z");

  it.each(["building", "invalid", "corrupt"])(
    "does not trust newer artifacts with a %s renderer build receipt",
    (status) => {
      const rootDir = createTempRoot();
      writeRequiredFiles(rootDir, artifactTime);
      writeFile(
        path.join(rootDir, ".lime", "electron-renderer-build.json"),
        status === "corrupt" ? "{" : JSON.stringify({ status }),
        artifactTime,
      );
      expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
        ready: false,
        staleSegments: ["renderer"],
        segments: { renderer: { ready: false } },
      });
    },
  );

  it.each(["postcss.config.js", "tailwind.config.js"])(
    "invalidates the renderer when %s changes",
    (config) => {
      const rootDir = createTempRoot();
      writeRequiredFiles(rootDir, artifactTime);
      writeFile(
        path.join(rootDir, config),
        "export default {};",
        new Date("2026-01-01T00:20:00.000Z"),
      );
      expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
        ready: false,
        reason: "stale-source",
        staleSegments: ["renderer"],
        segments: {
          renderer: { newestSource: { relativePath: config } },
          host: { ready: true },
          appServer: { ready: true },
        },
      });
    },
  );

  function rendererFixture(html) {
    const rootDir = createTempRoot();
    writeRequiredFiles(rootDir, artifactTime);
    writeFile(path.join(rootDir, "dist", "index.html"), html, artifactTime);
    writeFile(
      path.join(rootDir, "dist", "assets", "app.css"),
      "body{}",
      artifactTime,
    );
    writeFile(
      path.join(rootDir, "src", "App.tsx"),
      "export const app = true;",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    completeRendererBuild(beginRendererBuild(rootDir));
    return rootDir;
  }

  it.each([
    ['<script type="module" src="/assets/entry.js"></script>', "root-absolute"],
    [
      '<script type="module" src="./assets/entry.js"></script><link rel="stylesheet" href="/assets/app.css">',
      "root-absolute",
    ],
    [
      '<script type="module" src="./assets/missing.js"></script>',
      "missing-local-file",
    ],
    [
      '<script type="module" src="./assets/entry.js"></script><link href="./assets/missing.css" rel="stylesheet">',
      "missing-local-file",
    ],
    [
      '<script type="module" src="https://fixture.invalid/entry.js"></script>',
      "non-local-url",
    ],
    ['<script type="module" src=""></script>', "empty-reference"],
    [
      '<script type="module" src="./assets/entry%ZZ.js"></script>',
      "invalid-url",
    ],
    ["<html></html>", "missing-module-entry"],
    ['<script src="./assets/entry.js"></script>', "missing-module-entry"],
    [
      '<!-- <script type="module" src="./assets/entry.js"></script> -->',
      "missing-module-entry",
    ],
    [
      '<script>const text = \'<script type="module" src="./assets/entry.js">\';</script>',
      "missing-module-entry",
    ],
    [
      '<script type="module">throw new Error("must not execute");</script>',
      "missing-module-entry",
    ],
    [
      '<body><noscript><script type="module" src="./assets/entry.js"></script></noscript></body>',
      "missing-module-entry",
    ],
  ])("rejects fresh but unloadable entry assets: %s", (html, reason) => {
    const rootDir = rendererFixture(html);
    const freshness = inspectElectronFixtureBuildFreshness({ rootDir });

    expect(freshness).toMatchObject({
      ready: false,
      reason: "invalid-renderer-assets",
      staleSegments: ["renderer"],
      segments: {
        renderer: { ready: false, reason: "invalid-renderer-assets" },
        host: { ready: true },
        appServer: { ready: true },
      },
    });
    expect(freshness.segments.renderer.invalidRendererAssets).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason })]),
    );
    expect(freshness.segments.renderer.oldestArtifact.mtimeMs).toBeGreaterThan(
      freshness.segments.renderer.newestSource.mtimeMs,
    );
  });

  it("resolves relative assets with real HTML attributes, entities and URL query/hash", () => {
    const rootDir = rendererFixture(`
      <!doctype html><html><head>
      <SCRIPT crossorigin data-note="/assets/ignored" SRC='./assets/entry%20main.js?x=1&amp;y=2#module' TYPE="module"></SCRIPT>
      <LINK HREF=./assets/app.css?version=1#style REL="alternate stylesheet">
      <link rel="icon" href="/missing-icon.png">
      <script src="/oem-non-module.js"></script>
      <!-- <script type="module" src="/assets/fake.js"></script> -->
      <script>const fake = '<link rel="stylesheet" href="/assets/fake.css">'; throw new Error('must not execute');</script>
      </head></html>`);
    writeFile(
      path.join(rootDir, "dist", "assets", "entry main.js"),
      "export {};",
      artifactTime,
    );

    expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
      ready: true,
      reason: "fresh-artifacts",
      staleSegments: [],
    });
  });

  it("resolves assets against the actual HTML baseURI", () => {
    const rootDir = rendererFixture(
      '<base href="./assets/"><script type="module" src="entry.js"></script><link rel="stylesheet" href="app.css">',
    );
    expect(inspectElectronFixtureBuildFreshness({ rootDir }).ready).toBe(true);
    writeFile(
      path.join(rootDir, "dist", "index.html"),
      '<base href="./missing/"><script type="module" src="entry.js"></script>',
      artifactTime,
    );
    expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
      ready: false,
      staleSegments: ["renderer"],
      segments: {
        renderer: {
          invalidRendererAssets: [
            expect.objectContaining({ reason: "missing-local-file" }),
          ],
        },
      },
    });
  });

  it("only parses HTML and does not execute an inline script that removes the entry", () => {
    const rootDir = rendererFixture(
      '<script type="module" src="./assets/entry.js"></script><script>document.querySelector("script[type=module]").remove();</script>',
    );
    expect(inspectElectronFixtureBuildFreshness({ rootDir }).ready).toBe(true);
  });

  it("preserves independent Rust staleness alongside invalid renderer assets", () => {
    const rootDir = rendererFixture(
      '<script type="module" src="/assets/entry.js"></script>',
    );
    writeFile(
      path.join(rootDir, "lime-rs", "crates", "agent-runtime", "src", "lib.rs"),
      "pub fn changed() {}",
      new Date("2026-01-01T00:20:00.000Z"),
    );
    expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
      ready: false,
      staleSegments: ["renderer", "appServer"],
      segments: {
        host: { ready: true },
        appServer: { reason: "stale-source" },
      },
    });
  });

  it("rejects a local directory referenced as the entry module", () => {
    const rootDir = rendererFixture(
      '<script type="module" src="./assets/"></script>',
    );
    expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
      ready: false,
      staleSegments: ["renderer"],
    });
  });

  it("rebuilds only renderer when fresh artifacts contain browser-root asset URLs", () => {
    const rootDir = rendererFixture(
      '<script type="module" src="/assets/entry.js"></script>',
    );
    const runner = createRecordingRunner();
    const envKey = electronFixtureBuildReadyEnv();
    const previousEnv = process.env[envKey];
    delete process.env[envKey];
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = ensureElectronFixtureBuild({
        rootDir,
        logPrefix: "entry-assets-test",
        runCommand: runner.runCommand,
      });
      expect(result).toMatchObject({
        status: "rebuilt",
        rebuiltSegments: ["renderer"],
      });
      expect(runner.calls.map(({ args }) => args)).toEqual([
        ["run", "verify:app-version"],
        ["run", "build:renderer:electron:smoke"],
      ]);
    } finally {
      if (previousEnv === undefined) delete process.env[envKey];
      else process.env[envKey] = previousEnv;
    }
  });

  it.each([
    [{ status: null, signal: "SIGINT" }, "signal=SIGINT"],
    [{ status: null, signal: "SIGTERM" }, "signal=SIGTERM"],
    [{ status: null }, "exit=unknown"],
  ])(
    "stops all later build steps after an interrupted result %j",
    (result, reason) => {
      const rootDir = rendererFixture(
        '<script type="module" src="/assets/entry.js"></script>',
      );
      writeFile(
        path.join(rootDir, "lime-rs", "crates", "app-server", "src", "lib.rs"),
        "pub fn changed() {}",
        new Date("2026-01-01T00:20:00.000Z"),
      );
      const envKey = electronFixtureBuildReadyEnv();
      const previousEnv = process.env[envKey];
      delete process.env[envKey];
      const runCommand = vi
        .fn()
        .mockReturnValueOnce({ status: 0 })
        .mockReturnValue(result);
      vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        expect(() =>
          ensureElectronFixtureBuild({
            rootDir,
            logPrefix: "interrupted-build-test",
            runCommand,
          }),
        ).toThrow(reason);
        expect(runCommand.mock.calls.map(([step]) => step.args)).toEqual([
          ["run", "verify:app-version"],
          ["run", "build:renderer:electron:smoke"],
        ]);
        expect(process.env[envKey]).toBeUndefined();
        expect(
          fs.existsSync(
            path.join(rootDir, ".lime", "electron-fixture-build.lock"),
          ),
        ).toBe(false);
      } finally {
        if (previousEnv === undefined) delete process.env[envKey];
        else process.env[envKey] = previousEnv;
      }
    },
  );

  it("preserves explicit app URL and trusted build-ready overrides", () => {
    const rootDir = rendererFixture(
      '<script type="module" src="/assets/entry.js"></script>',
    );
    const runner = createRecordingRunner();
    expect(
      ensureElectronFixtureBuild({
        rootDir,
        appUrl: "http://fixture.invalid",
        runCommand: runner.runCommand,
      }),
    ).toEqual({ status: "skipped", reason: "app-url" });
    const envKey = electronFixtureBuildReadyEnv();
    const previousEnv = process.env[envKey];
    process.env[envKey] = "1";
    try {
      expect(
        ensureElectronFixtureBuild({ rootDir, runCommand: runner.runCommand }),
      ).toEqual({ status: "skipped", reason: envKey });
      expect(runner.calls).toEqual([]);
    } finally {
      if (previousEnv === undefined) delete process.env[envKey];
      else process.env[envKey] = previousEnv;
    }
  });
});

describe("electron fixture build freshness", () => {
  it.each([
    "electron/native/computer-use-cursor-motion.h",
    "electron/native/windows/windows-computer-use-cursor-frames.h",
  ])("invalidates native helper artifacts when header %s changes", (header) => {
    const rootDir = createTempRoot();
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:10:00.000Z"));
    expect(inspectElectronFixtureBuildFreshness({ rootDir }).ready).toBe(true);
    writeFile(
      path.join(rootDir, header),
      "// changed native input",
      new Date("2026-01-01T00:20:00.000Z"),
    );
    expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
      ready: false,
      reason: "stale-source",
      staleSegments: ["host"],
      segments: {
        host: { newestSource: { relativePath: header } },
        renderer: { ready: true },
        appServer: { ready: true },
      },
    });
  });

  it.each([
    ["src/index.testFixtures.tsx", "src/App.tsx", "renderer"],
    ["electron/preload.testFixtures.ts", "electron/main.ts", "host"],
  ])(
    "ignores dedicated test fixtures %s while retaining product staleness",
    (fixturePath, productPath, segment) => {
      const rootDir = createTempRoot();
      writeFile(
        path.join(rootDir, productPath),
        "export const product = true;",
        new Date("2026-01-01T00:00:00.000Z"),
      );
      writeRequiredFiles(rootDir, new Date("2026-01-01T00:10:00.000Z"));
      writeFile(
        path.join(rootDir, fixturePath),
        "export const fixture = true;",
        new Date("2026-01-01T00:20:00.000Z"),
      );

      expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
        ready: true,
        staleSegments: [],
      });

      writeFile(
        path.join(rootDir, productPath),
        "export const product = false;",
        new Date("2026-01-01T00:30:00.000Z"),
      );
      expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
        ready: false,
        reason: "stale-source",
        staleSegments: [segment],
      });
    },
  );

  it("serializes stale packaged fixture rebuilds behind a repository lock", () => {
    const content = fs.readFileSync(
      "scripts/lib/electron-fixture-build.mjs",
      "utf8",
    );

    expect(content).toContain("electron-fixture-build.lock");
    expect(content).toContain("acquireElectronFixtureBuildLock");
    expect(content).toContain("waiting for Electron fixture packaged");
    expect(content).toContain("const lockedFreshness");
    expect(content).toContain("inspectElectronFixtureBuildFreshness");
    expect(content).toContain("buildStaleElectronFixtureSegments");
  });

  it("reuses packaged artifacts when build inputs are older", () => {
    const rootDir = createTempRoot();
    writeFile(
      path.join(rootDir, "src", "App.tsx"),
      "export const app = true;",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:10:00.000Z"));

    const freshness = inspectElectronFixtureBuildFreshness({ rootDir });

    expect(freshness).toMatchObject({
      ready: true,
      reason: "fresh-artifacts",
      missingFiles: [],
    });
    expect(freshness.newestSource.relativePath).toBe(
      path.join("src", "App.tsx"),
    );
  });

  it("marks the current process build-ready when fresh artifacts are reused", () => {
    const rootDir = createTempRoot();
    const envKey = electronFixtureBuildReadyEnv();
    const previousEnv = process.env[envKey];
    const previousLog = console.log;
    delete process.env[envKey];
    writeFile(
      path.join(rootDir, "src", "App.tsx"),
      "export const app = true;",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:10:00.000Z"));

    try {
      console.log = () => {};
      const result = ensureElectronFixtureBuild({
        rootDir,
        logPrefix: "electron-fixture-build-test",
      });

      expect(result).toMatchObject({
        status: "reused",
        reason: "fresh-artifacts",
      });
      expect(process.env[envKey]).toBe("1");
    } finally {
      if (previousEnv === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previousEnv;
      }
      console.log = previousLog;
    }
  });

  it("marks packaged artifacts stale when a build input is newer", () => {
    const rootDir = createTempRoot();
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:00:00.000Z"));
    writeFile(
      path.join(rootDir, "electron", "main.ts"),
      "export const main = true;",
      new Date("2026-01-01T00:10:00.000Z"),
    );

    const freshness = inspectElectronFixtureBuildFreshness({ rootDir });

    expect(freshness).toMatchObject({
      ready: false,
      reason: "stale-source",
      missingFiles: [],
      staleSegments: ["host"],
    });
    expect(freshness.segments.host.ready).toBe(false);
    expect(freshness.segments.renderer.ready).toBe(true);
    expect(freshness.segments.appServer.ready).toBe(true);
    expect(freshness.newestSource.relativePath).toBe(
      path.join("electron", "main.ts"),
    );
  });

  it.each(["pnpm-lock.yaml", "pnpm-workspace.yaml"])(
    "invalidates renderer and host when %s changes without a manifest edit",
    (dependencyInput) => {
      const rootDir = createTempRoot();
      writeRequiredFiles(rootDir, new Date("2026-01-01T00:10:00.000Z"));
      writeFile(
        path.join(rootDir, dependencyInput),
        "changed dependency input",
        new Date("2026-01-01T00:20:00.000Z"),
      );

      expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
        ready: false,
        reason: "stale-source",
        staleSegments: ["renderer", "host"],
        segments: {
          renderer: { newestSource: { relativePath: dependencyInput } },
          host: { newestSource: { relativePath: dependencyInput } },
          appServer: { ready: true },
        },
      });
    },
  );

  it("does not mark renderer stale when only Rust app-server sources are newer", () => {
    const rootDir = createTempRoot();
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:10:00.000Z"));
    writeFile(
      path.join(rootDir, "lime-rs", "crates", "tool-runtime", "src", "lib.rs"),
      "pub fn changed() {}",
      new Date("2026-01-01T00:20:00.000Z"),
    );

    const freshness = inspectElectronFixtureBuildFreshness({ rootDir });

    expect(freshness).toMatchObject({
      ready: false,
      reason: "stale-source",
      missingFiles: [],
      staleSegments: ["appServer"],
    });
    expect(freshness.segments.renderer.ready).toBe(true);
    expect(freshness.segments.host.ready).toBe(true);
    expect(freshness.segments.appServer.ready).toBe(false);
    expect(freshness.segments.appServer.newestSource.relativePath).toBe(
      path.join("lime-rs", "crates", "tool-runtime", "src", "lib.rs"),
    );
  });

  it("invalidates only app-server artifacts when embedded resources change", () => {
    const rootDir = createTempRoot();
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:10:00.000Z"));
    const resource = path.join(
      "lime-rs",
      "resources",
      "default-skills",
      "example",
      "SKILL.md",
    );
    writeFile(
      path.join(rootDir, resource),
      "changed embedded skill",
      new Date("2026-01-01T00:20:00.000Z"),
    );

    expect(inspectElectronFixtureBuildFreshness({ rootDir })).toMatchObject({
      ready: false,
      reason: "stale-source",
      staleSegments: ["appServer"],
      segments: {
        renderer: { ready: true },
        host: { ready: true },
        appServer: { newestSource: { relativePath: resource } },
      },
    });
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:30:00.000Z"));
    expect(inspectElectronFixtureBuildFreshness({ rootDir }).ready).toBe(true);
  });

  it("only rebuilds the app-server segment for Rust-only fixture staleness", () => {
    const rootDir = createTempRoot();
    const envKey = electronFixtureBuildReadyEnv();
    const previousEnv = process.env[envKey];
    const previousLog = console.log;
    const runner = createRecordingRunner();
    delete process.env[envKey];
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:10:00.000Z"));
    writeFile(
      path.join(rootDir, "lime-rs", "crates", "app-server", "src", "lib.rs"),
      "pub fn changed() {}",
      new Date("2026-01-01T00:20:00.000Z"),
    );

    try {
      console.log = () => {};
      const result = ensureElectronFixtureBuild({
        rootDir,
        logPrefix: "electron-fixture-build-test",
        runCommand: runner.runCommand,
      });
      const commandLines = runner.calls.map((call) =>
        [path.basename(call.command), ...call.args].join(" "),
      );

      expect(result).toMatchObject({
        status: "rebuilt",
        rebuiltSegments: ["appServer"],
      });
      expect(commandLines).toContain("npm run verify:app-version");
      expect(commandLines).toContain(
        "npm run electron:build:app-server-assets",
      );
      expect(commandLines).not.toContain(
        "npm run build:renderer:electron:smoke",
      );
      expect(commandLines).not.toContain("npm run typecheck:electron");
      expect(process.env[envKey]).toBe("1");
    } finally {
      if (previousEnv === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = previousEnv;
      }
      console.log = previousLog;
    }
  });

  it("treats app-server asset helper changes as build inputs", () => {
    const rootDir = createTempRoot();
    writeRequiredFiles(rootDir, new Date("2026-01-01T00:00:00.000Z"));
    writeFile(
      path.join(rootDir, "scripts", "lib", "electron-app-server-assets.mjs"),
      "export const changed = true;",
      new Date("2026-01-01T00:10:00.000Z"),
    );

    const freshness = inspectElectronFixtureBuildFreshness({ rootDir });

    expect(freshness).toMatchObject({
      ready: false,
      reason: "stale-source",
      missingFiles: [],
      staleSegments: ["appServer"],
    });
    expect(freshness.newestSource.relativePath).toBe(
      path.join("scripts", "lib", "electron-app-server-assets.mjs"),
    );
  });

  it("requires preload and packaged app-server artifacts", () => {
    const rootDir = createTempRoot();
    writeFile(
      path.join(rootDir, "dist", "index.html"),
      "<html></html>",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    writeFile(
      path.join(rootDir, "dist-electron", "main", "main.js"),
      "console.log('main');",
      new Date("2026-01-01T00:00:00.000Z"),
    );
    writeFile(
      path.join(rootDir, "dist-electron", "app-server.release.json"),
      "{}",
      new Date("2026-01-01T00:00:00.000Z"),
    );

    const freshness = inspectElectronFixtureBuildFreshness({ rootDir });
    const missingRelativePaths = freshness.missingFiles.map((filePath) =>
      path.relative(rootDir, filePath),
    );

    expect(freshness.ready).toBe(false);
    expect(freshness.reason).toBe("missing-artifacts");
    expect(missingRelativePaths).toContain(
      path.join("dist-electron", "preload", "preload.cjs"),
    );
    expect(
      missingRelativePaths.some((filePath) =>
        filePath.startsWith(path.join("dist-electron", "app-server")),
      ),
    ).toBe(true);
  });
});
