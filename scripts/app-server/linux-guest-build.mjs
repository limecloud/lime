import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRustyV8CargoEnv } from "../lib/rusty-v8-artifacts.mjs";
import { stageLinuxGuest } from "./linux-guest-stage.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export function parseLinuxGuestBuildArgs(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (
      !["--out", "--profile", "--download-url"].includes(key) ||
      options.has(key) ||
      typeof value !== "string" ||
      !value ||
      value.startsWith("--")
    )
      throw new Error("Invalid Linux guest build options");
    options.set(key, value);
  }
  const output = options.get("--out");
  const profileName = options.get("--profile") ?? "dev";
  if (
    !output ||
    !path.isAbsolute(output) ||
    !["dev", "release"].includes(profileName)
  )
    throw new Error(
      "Usage: node scripts/app-server/linux-guest-build.mjs --out <new-absolute-directory> [--profile dev|release] [--download-url <published-public-https-url>]",
    );
  return {
    output: path.resolve(output),
    profileName,
    downloadUrl: options.get("--download-url"),
  };
}

// Build on the target OS using the same runtime and resource owner.
async function main() {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Linux guest builds require a native Linux x64 host");
  const { output, profileName, downloadUrl } = parseLinuxGuestBuildArgs(
    process.argv.slice(2),
  );
  if (lstatSync(output, { throwIfNoEntry: false }))
    throw new Error("Linux guest output must be a new directory");
  const toolchain = readFileSync(
    path.join(root, "rust-toolchain.toml"),
    "utf8",
  ).match(/^channel\s*=\s*"([^"]+)"/mu)?.[1];
  if (!toolchain) throw new Error("The repository Rust toolchain is required");
  const env = {
    ...process.env,
    ...resolveRustyV8CargoEnv({ repoRoot: root }),
    CARGO_TARGET_DIR: path.join(root, "lime-rs/target"),
    CARGO_PROFILE_DEV_DEBUG: "0",
    CARGO_INCREMENTAL: "0",
    RUSTUP_TOOLCHAIN: toolchain,
  };
  const built = spawnSync(
    "cargo",
    [
      "build",
      "--locked",
      "--profile",
      profileName,
      "--manifest-path",
      path.join(root, "lime-rs/Cargo.toml"),
      "-j",
      "2",
      "-p",
      "cli",
      "--bin",
      "lime",
      "-p",
      "app-server",
      "--bin",
      "app-server",
      "-p",
      "code-mode-host",
      "--bin",
      "code-mode-host",
    ],
    { cwd: root, env, stdio: "inherit", shell: false },
  );
  if (built.error || built.status !== 0)
    throw built.error || new Error("Linux runtime build failed");
  const profile = path.join(
    env.CARGO_TARGET_DIR,
    profileName === "dev" ? "debug" : "release",
  );
  const version = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const archive = await stageLinuxGuest({
    runtimeDir: profile,
    output,
    version,
    profileName,
    downloadUrl,
  });
  console.log(
    `[linux-guest] built and loader-checked ${version} (${profileName}): ${output}`,
  );
  console.log(JSON.stringify(archive));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
