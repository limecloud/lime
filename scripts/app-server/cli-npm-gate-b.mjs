#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { prepareLocalComputerUseResources } from "../lib/electron-desktop-resources.mjs";

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(__filename), "../..");
const cliPackageDir = path.join(rootDir, "packages", "cli");
const buildScript = path.join(cliPackageDir, "scripts", "build_npm_package.py");

const PLATFORM = resolvePlatform();

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "cli-npm-gate-b-"));
  try {
    const version = JSON.parse(
      await readFile(path.join(rootDir, "package.json"), "utf8"),
    ).version;
    const scenarios = (
      process.env.LIME_CLI_NPM_GATE_SCENARIOS || "cli,tui"
    ).split(",");
    if (
      !scenarios.every((scenario) => ["cli", "tui", "wps"].includes(scenario))
    )
      throw new Error("Unknown npm Gate B scenario");
    const profileDir = path.resolve(
      process.env.LIME_CLI_GATE_B_PROFILE_DIR ||
        path.join(rootDir, "lime-rs", "target", "debug"),
    );
    const vendorRoot = path.join(tempDir, "vendor");
    const vendorBin = path.join(vendorRoot, PLATFORM.targetTriple, "bin");
    await mkdir(vendorBin, { recursive: true });
    await stageRuntimePayload(profileDir, vendorBin);

    const rootStage = path.join(tempDir, "root-stage");
    const platformStage = path.join(tempDir, "platform-stage");
    const rootArchive = path.join(tempDir, "lime.tgz");
    const platformArchive = path.join(tempDir, "platform.tgz");
    await run("python3", [
      buildScript,
      "--package",
      "lime",
      "--version",
      version,
      "--staging-dir",
      rootStage,
      "--pack-output",
      rootArchive,
    ]);
    await run("python3", [
      buildScript,
      "--package",
      PLATFORM.package,
      "--version",
      version,
      "--staging-dir",
      platformStage,
      "--vendor-src",
      vendorRoot,
      "--pack-output",
      platformArchive,
    ]);

    const installScope = path.join(
      tempDir,
      "install",
      "node_modules",
      "@limecloud",
    );
    const installedRoot = path.join(installScope, "lime");
    const installedPlatform = path.join(installScope, PLATFORM.aliasName);
    await mkdir(installScope, { recursive: true });
    await extractPackedPackage(rootArchive, installedRoot);
    await extractPackedPackage(platformArchive, installedPlatform);

    const executableSuffix = process.platform === "win32" ? ".exe" : "";
    const launcherPath = path.join(installedRoot, "bin", "lime.js");
    await assertFile(
      path.join(installedRoot, "exec-events.schema.json"),
      "installed exec event schema",
    );
    const packagedAppServer = path.join(
      installedPlatform,
      "vendor",
      PLATFORM.targetTriple,
      "bin",
      `app-server${executableSuffix}`,
    );
    if (scenarios.includes("cli"))
      await run(
        process.execPath,
        [path.join(rootDir, "scripts", "app-server", "cli-gate-b.mjs")],
        {
          APP_SERVER_BIN: packagedAppServer,
          LIME_CLI_BIN: launcherPath,
          LIME_CLI_GATE_B_USE_SIBLING_APP_SERVER: "1",
        },
      );
    if (scenarios.includes("tui"))
      await run(
        process.execPath,
        [path.join(rootDir, "scripts", "app-server", "tui-gate-b.mjs")],
        {
          APP_SERVER_BIN: packagedAppServer,
          LIME_CLI_BIN: launcherPath,
          LIME_TUI_GATE_B_SCENARIOS: "complete,user-input",
        },
      );
    if (scenarios.includes("wps"))
      await run(
        process.execPath,
        [path.join(rootDir, "scripts/app-server/computer-use-wps-fixture.mjs")],
        {
          APP_SERVER_BIN: packagedAppServer,
          LIME_CLI_BIN: launcherPath,
          LIME_COMPUTER_USE_HOST: "cli",
          LIME_WPS_USE_PACKAGED_RESOURCES: "1",
        },
      );

    if (scenarios.includes("wps")) {
      const evidenceDir = path.join(
        rootDir,
        ".lime/qc/computer-use-integrations-20261025",
      );
      const wps = JSON.parse(
        await readFile(path.join(evidenceDir, "wps-cli.json"), "utf8"),
      );
      if (wps.result !== "pass") throw new Error("packaged WPS receipt failed");
      const manifest = JSON.parse(
        await readFile(
          path.join(
            path.dirname(packagedAppServer),
            "desktop-resources.manifest.json",
          ),
          "utf8",
        ),
      );
      await writeFile(
        path.join(evidenceDir, "wps-cli-package.json"),
        JSON.stringify(
          {
            result: "pass",
            checkedAt: new Date().toISOString(),
            platform: process.platform,
            arch: process.arch,
            version,
            claimBoundary:
              "Local npm tarballs installed into isolated optional platform package; real Node launcher, sibling lime/App Server/helper and WPS; HTTP model fixture, no release signature or other-platform claim",
            rootArchiveSha256: await digest(rootArchive),
            platformArchiveSha256: await digest(platformArchive),
            cliSha256: await digest(
              path.join(
                path.dirname(packagedAppServer),
                `lime${executableSuffix}`,
              ),
            ),
            appServerSha256: await digest(packagedAppServer),
            manifest,
            wpsReceipt: "wps-cli.json",
            threadId: wps.turns[0].threadId,
          },
          null,
          2,
        ) + "\n",
      );
    }

    console.log(
      `[smoke:cli-npm-gate-b] ok target=${PLATFORM.targetTriple} launcher=${launcherPath} appServer=sibling scenarios=${scenarios.join(",")} installedFrom=npm-tarballs`,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function resolvePlatform() {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return {
      aliasName: "lime-darwin-arm64",
      package: "lime-darwin-arm64",
      targetTriple: "aarch64-apple-darwin",
    };
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return {
      aliasName: "lime-darwin-x64",
      package: "lime-darwin-x64",
      targetTriple: "x86_64-apple-darwin",
    };
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return {
      aliasName: "lime-linux-x64",
      package: "lime-linux-x64",
      targetTriple: "x86_64-unknown-linux-gnu",
    };
  }
  if (process.platform === "win32" && process.arch === "x64") {
    return {
      aliasName: "lime-win32-x64",
      package: "lime-win32-x64",
      targetTriple: "x86_64-pc-windows-msvc",
    };
  }
  throw new Error(
    `Unsupported CLI npm Gate B host: ${process.platform}/${process.arch}`,
  );
}

async function stageRuntimePayload(profileDir, vendorBin) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const binaryNames = [
    `lime${suffix}`,
    `app-server${suffix}`,
    `code-mode-host${suffix}`,
  ];
  if (process.platform === "win32") {
    binaryNames.push("windows-sandbox-setup.exe", "windows-sandbox-runner.exe");
  }

  const entries = await readdir(profileDir, { withFileTypes: true });
  const runtimeLibraries = entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => /(?:\.dylib|\.dll|\.so(?:\..*)?)$/u.test(name));
  for (const name of [...binaryNames, ...runtimeLibraries]) {
    const source = path.join(profileDir, name);
    const destination = path.join(vendorBin, name);
    await assertFile(source, name);
    await copyFile(source, destination, constants.COPYFILE_FICLONE);
  }
  if (["darwin", "win32"].includes(process.platform)) {
    prepareLocalComputerUseResources({
      binaryPath: path.join(vendorBin, `app-server${suffix}`),
    });
  }
}

async function extractPackedPackage(archive, destination) {
  await run("python3", [
    "-c",
    `import pathlib,sys,tarfile
root=pathlib.Path(sys.argv[2]);root.mkdir(parents=True)
with tarfile.open(sys.argv[1],"r:gz") as archive:
 for member in archive:
  name=pathlib.PurePosixPath(member.name)
  if not name.parts or name.parts[0]!="package" or ".." in name.parts: raise RuntimeError("invalid npm archive member")
  target=root.joinpath(*name.parts[1:])
  if member.isdir(): target.mkdir(parents=True,exist_ok=True)
  elif member.isfile():
   target.parent.mkdir(parents=True,exist_ok=True)
   with archive.extractfile(member) as source, target.open("wb") as output:
    import shutil;shutil.copyfileobj(source,output)
   target.chmod(member.mode & 0o777)
  else: raise RuntimeError("unexpected npm archive member type")`,
    archive,
    destination,
  ]);
}

async function assertFile(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(
      `${label} is missing: ${filePath}\n` +
        '先构建：cargo build --manifest-path "lime-rs/Cargo.toml" -p cli -p app-server -p code-mode-host --bin code-mode-host',
    );
  }
}

async function run(command, args, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}`,
        ),
      );
    });
  });
}

main().catch((error) => {
  console.error(
    `[smoke:cli-npm-gate-b] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
