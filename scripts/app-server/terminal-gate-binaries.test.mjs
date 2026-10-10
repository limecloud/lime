import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  terminalGateBuildPackages,
  terminalGateCargoBuildArgs,
  snapshotTerminalGateBinaries,
} from "./terminal-gate-binaries.mjs";

describe("terminal Gate B binaries", () => {
  it("builds both current binaries for default paths", () => {
    expect(terminalGateBuildPackages({})).toEqual(["cli", "app-server"]);
    expect(
      terminalGateCargoBuildArgs({ env: {}, repoRoot: "/workspace/lime" }),
    ).toEqual([
      "build",
      "--manifest-path",
      path.resolve("/workspace/lime/lime-rs/Cargo.toml"),
      "-p",
      "cli",
      "-p",
      "app-server",
    ]);
  });

  it("only builds owners whose binary path was not supplied", () => {
    expect(terminalGateBuildPackages({ LIME_CLI_BIN: "/tmp/lime" })).toEqual([
      "app-server",
    ]);
    expect(
      terminalGateBuildPackages({ APP_SERVER_BIN: "/tmp/app-server" }),
    ).toEqual(["cli"]);
  });

  it("does not rebuild explicitly supplied artifacts", () => {
    const env = {
      LIME_CLI_BIN: "/tmp/lime",
      APP_SERVER_BIN: "/tmp/app-server",
    };
    expect(terminalGateBuildPackages(env)).toEqual([]);
    expect(terminalGateCargoBuildArgs({ env })).toEqual([]);
  });

  it("keeps built executables and runtime dependencies stable when the shared target is replaced", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "terminal-gate-artifacts-"),
    );
    try {
      const source = path.join(directory, "target");
      await mkdir(source);
      const cliBinaryPath = path.join(source, "lime");
      const appServerBinaryPath = path.join(source, "app-server");
      for (const [name, data] of [
        ["lime", "current cli"],
        ["app-server", "current server"],
        ["runtime.dll", "current loader"],
        ["code-mode-host", "current runtime sibling"],
      ])
        await writeFile(path.join(source, name), data, { mode: 0o755 });
      const snapshot = path.join(directory, "scenario", "binaries");
      const paths = await snapshotTerminalGateBinaries({
        env: {},
        cliBinaryPath,
        appServerBinaryPath,
        directory: snapshot,
      });
      await writeFile(cliBinaryPath, "another build");
      await writeFile(appServerBinaryPath, "another server build");
      await writeFile(path.join(source, "runtime.dll"), "another loader");
      assertSnapshotPaths(paths, snapshot);
      expect(await readFile(paths.cliBinaryPath, "utf8")).toBe("current cli");
      expect(await readFile(paths.appServerBinaryPath, "utf8")).toBe(
        "current server",
      );
      expect(await readFile(path.join(snapshot, "runtime.dll"), "utf8")).toBe(
        "current loader",
      );
      expect(
        await readFile(path.join(snapshot, "code-mode-host"), "utf8"),
      ).toBe("current runtime sibling");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves explicit npm launcher paths and snapshots only the locally built owner", async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "terminal-gate-installed-"),
    );
    try {
      const cliBinaryPath = path.join(
        directory,
        "node_modules",
        "cli",
        "bin",
        "lime.js",
      );
      const appServerBinaryPath = path.join(directory, "app-server");
      await writeFile(appServerBinaryPath, "server");
      const snapshot = path.join(directory, "scenario", "binaries");
      const paths = await snapshotTerminalGateBinaries({
        env: { LIME_CLI_BIN: cliBinaryPath },
        cliBinaryPath,
        appServerBinaryPath,
        directory: snapshot,
      });
      expect(paths.cliBinaryPath).toBe(cliBinaryPath);
      expect(paths.appServerBinaryPath).toBe(path.join(snapshot, "app-server"));
      expect(await readFile(paths.appServerBinaryPath, "utf8")).toBe("server");
      expect(
        await snapshotTerminalGateBinaries({
          env: {
            LIME_CLI_BIN: cliBinaryPath,
            APP_SERVER_BIN: appServerBinaryPath,
          },
          cliBinaryPath,
          appServerBinaryPath,
          directory: path.join(directory, "unused"),
        }),
      ).toEqual({ cliBinaryPath, appServerBinaryPath });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function assertSnapshotPaths(paths, directory) {
  expect(path.dirname(paths.cliBinaryPath)).toBe(directory);
  expect(path.dirname(paths.appServerBinaryPath)).toBe(directory);
}
