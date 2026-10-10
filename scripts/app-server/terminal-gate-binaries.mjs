import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { resolveRustyV8CargoEnv } from "../lib/rusty-v8-artifacts.mjs";

// Supplied artifacts keep their package context; locally built files leave the shared target.
export async function snapshotTerminalGateBinaries({
  env = process.env,
  cliBinaryPath,
  appServerBinaryPath,
  directory,
}) {
  const paths = { cliBinaryPath, appServerBinaryPath };
  const sources = [
    ["cliBinaryPath", !env.LIME_CLI_BIN?.trim()],
    ["appServerBinaryPath", !env.APP_SERVER_BIN?.trim()],
  ].filter(([, built]) => built);
  if (sources.length === 0) return paths;
  await mkdir(directory, { recursive: true });
  const sourceDirectories = new Set();
  for (const [key] of sources) {
    const source = paths[key];
    const target = path.join(directory, path.basename(source));
    await copyFile(source, target, constants.COPYFILE_FICLONE);
    paths[key] = target;
    sourceDirectories.add(path.dirname(source));
  }
  // Preserve loader libraries and available runtime siblings on macOS and Windows.
  for (const sourceDirectory of sourceDirectories) {
    for (const entry of await readdir(sourceDirectory, {
      withFileTypes: true,
    })) {
      if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        (/\.(?:dll|dylib|so(?:\.\d+)*)$/iu.test(entry.name) ||
          /^(?:code-mode-host|windows-sandbox-setup|windows-sandbox-runner)(?:\.exe)?$/u.test(
            entry.name,
          ))
      ) {
        await copyFile(
          path.join(sourceDirectory, entry.name),
          path.join(directory, entry.name),
          constants.COPYFILE_FICLONE,
        );
      }
    }
  }
  return paths;
}

export function terminalGateBuildPackages(env = process.env) {
  const packages = [];
  if (!env.LIME_CLI_BIN?.trim()) {
    packages.push("cli");
  }
  if (!env.APP_SERVER_BIN?.trim()) {
    packages.push("app-server");
  }
  return packages;
}

export function terminalGateCargoBuildArgs({
  env = process.env,
  repoRoot = process.cwd(),
} = {}) {
  const packages = terminalGateBuildPackages(env);
  if (packages.length === 0) {
    return [];
  }
  return [
    "build",
    "--manifest-path",
    path.resolve(repoRoot, "lime-rs", "Cargo.toml"),
    ...packages.flatMap((packageName) => ["-p", packageName]),
  ];
}

export async function buildTerminalGateBinaries({
  env = process.env,
  repoRoot = process.cwd(),
  runner = spawn,
  resolveV8Env = resolveRustyV8CargoEnv,
} = {}) {
  const args = terminalGateCargoBuildArgs({ env, repoRoot });
  if (args.length === 0) {
    return;
  }
  const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";
  await new Promise((resolve, reject) => {
    const child = runner(cargoCommand, args, {
      cwd: repoRoot,
      env: {
        ...env,
        ...resolveV8Env({ env, repoRoot }),
      },
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal ? `signal=${signal}` : `code=${code ?? "unknown"}`;
      reject(
        new Error(`cargo build terminal Gate B binaries failed (${detail})`),
      );
    });
  });
}
