import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRustyV8CargoEnv } from "../lib/rusty-v8-artifacts.mjs";
import { prepareLocalComputerUseResources } from "../lib/electron-desktop-resources.mjs";
import { packageLinuxGuest } from "./linux-guest-package.mjs";

// Build on the target OS. This uses the current runtime and resource owner;
// neither an Electron installation nor a second Cloud runtime is needed.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Linux guest builds require a native Linux x64 host");
}
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--out" || !path.isAbsolute(args[1])) {
  throw new Error(
    "Usage: node scripts/app-server/linux-guest-build.mjs --out <new-absolute-directory>",
  );
}
const output = path.resolve(args[1]);
const toolchain = readFileSync(
  path.join(root, "rust-toolchain.toml"),
  "utf8",
).match(/^channel\s*=\s*"([^"]+)"/mu)?.[1];
if (!toolchain) throw new Error("The repository Rust toolchain is required");
// An existing release is immutable. Never merge into a previous payload.
mkdirSync(output, { recursive: false, mode: 0o700 });
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
const profile = path.join(env.CARGO_TARGET_DIR, "debug");
const bin = path.join(output, "bin");
mkdirSync(bin, { mode: 0o755 });
for (const name of [
  "lime",
  "app-server",
  "code-mode-host",
  ...readdirSync(profile).filter((name) => /^lib.*\.so(?:\..*)?$/u.test(name)),
]) {
  copyFileSync(path.join(profile, name), path.join(bin, name));
  chmodSync(path.join(bin, name), 0o755);
}
const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;
prepareLocalComputerUseResources({
  binaryPath: path.join(bin, "app-server"),
  version,
});
for (const name of ["lime", "app-server", "code-mode-host"]) {
  const loaded = spawnSync("ldd", [path.join(bin, name)], {
    env: { ...env, LD_LIBRARY_PATH: bin },
    encoding: "utf8",
    shell: false,
  });
  if (loaded.error || loaded.status !== 0 || /not found/u.test(loaded.stdout)) {
    throw new Error(
      `Incomplete Linux loader closure for ${name}: ${loaded.stdout || loaded.stderr}`,
    );
  }
}
const legal = path.join(output, "licenses");
mkdirSync(legal);
for (const name of readdirSync(path.join(root, "licenses"))) {
  if (lstatSync(path.join(root, "licenses", name)).isFile())
    copyFileSync(path.join(root, "licenses", name), path.join(legal, name));
}
for (const name of ["LICENSE", "LICENSES.md", "NOTICE"]) {
  copyFileSync(path.join(root, name), path.join(output, name));
}
copyFileSync(
  path.join(root, "electron/native/linux/linux-guest.py"),
  path.join(output, "install.py"),
);
copyFileSync(
  path.join(root, "electron/native/linux/linux-guest-bootstrap.py"),
  path.join(output, "bootstrap.py"),
);
function filesAt(directory, prefix = "") {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const file = path.join(directory, name);
      const relative = prefix + name;
      const info = lstatSync(file);
      if (info.isSymbolicLink())
        throw new Error("Guest payload cannot contain symbolic links");
      return info.isDirectory()
        ? filesAt(file, relative + "/")
        : [
            {
              path: relative,
              size: info.size,
              sha256: createHash("sha256")
                .update(readFileSync(file))
                .digest("hex"),
            },
          ];
    });
}
writeFileSync(
  path.join(output, "guest-manifest.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      applicationId: "com.limecloud.lime",
      version,
      platform: "linux",
      arch: "x64",
      profile: "dev",
      files: filesAt(output),
    },
    null,
    2,
  ) + "\n",
);
const archive = await packageLinuxGuest(output);
console.log(`[linux-guest] built and loader-checked ${version}: ${output}`);
console.log(JSON.stringify(archive));
