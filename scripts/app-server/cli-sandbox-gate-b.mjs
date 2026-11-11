#!/usr/bin/env node

// macOS CLI sandbox Gate B: prove the real `lime sandbox` command enforces
// workspace-write through the App Server and the seatbelt policy builder.
// The check writes one file inside the workspace and one under $HOME; the
// inside write must succeed and the outside write must be denied by seatbelt.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliBinaryPath = path.resolve(
  process.env.LIME_CLI_BIN || path.join(rootDir, "lime-rs/target/debug/lime"),
);

async function exists(file) {
  return access(file, constants.F_OK).then(
    () => true,
    () => false,
  );
}

async function main() {
  if (process.platform !== "darwin") {
    console.log(
      "[cli-sandbox-gate-b] skipped: macOS seatbelt evidence only; run on darwin",
    );
    return;
  }
  if (!(await exists(cliBinaryPath))) {
    throw new Error(`lime binary not found: ${cliBinaryPath}`);
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), "lime-cli-sandbox-gate-"));
  const configPath = path.join(temp, "config.yaml");
  const workspace = path.join(temp, "workspace");
  const inside = path.join(workspace, "inside.txt");
  const outside = path.join(os.homedir(), `.lime-cli-sandbox-gate-${process.pid}.txt`);
  try {
    await writeFile(
      configPath,
      'permissions:\n  cli-sandbox-gate:\n    extends: ":workspace"\n',
    );
    await rm(workspace, { recursive: true, force: true });
    await writeFile(path.join(temp, "keep.txt"), "keep\n");
    await mkdir(workspace, { recursive: true });
    await rm(outside, { force: true });

    const script = `echo ok > ${inside}; echo bad > ${outside}; true`;
    const result = await execFileAsync(
      cliBinaryPath,
      [
        "sandbox",
        "-P",
        "cli-sandbox-gate",
        "-C",
        workspace,
        "--",
        "/bin/sh",
        "-c",
        script,
      ],
      {
        cwd: temp,
        env: { ...process.env, LIME_CONFIG_PATH: configPath },
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 120_000,
      },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    if (!(await exists(inside))) {
      throw new Error(`workspace write did not happen\n${output}`);
    }
    if (await exists(outside)) {
      throw new Error(`write under $HOME was not denied\n${output}`);
    }
    if (!output.includes("Operation not permitted")) {
      throw new Error(`missing seatbelt denial evidence\n${output}`);
    }
    console.log(
      "CLI_SANDBOX_OK workspace-write=allowed home-write=denied seatbelt=Operation not permitted",
    );
  } finally {
    await rm(outside, { force: true });
    await rm(temp, { recursive: true, force: true });
  }
}

await main();
