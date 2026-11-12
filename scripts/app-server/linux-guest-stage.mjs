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
import { prepareLocalComputerUseResources } from "../lib/electron-desktop-resources.mjs";
import { packageLinuxGuest } from "./linux-guest-package.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Stage the same native runtime for manual builds and the release pipeline. */
export async function stageLinuxGuest({
  runtimeDir: profile,
  output,
  version,
  profileName,
  downloadUrl,
}) {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error("Linux guest staging requires a native Linux x64 host");
  const metadata = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  );
  if (
    !path.isAbsolute(profile) ||
    !path.isAbsolute(output) ||
    version !== metadata.version ||
    !["dev", "release"].includes(profileName)
  )
    throw new Error("Invalid Linux guest staging identity");
  mkdirSync(output, { recursive: false, mode: 0o700 });
  const bin = path.join(output, "bin");
  mkdirSync(bin, { mode: 0o755 });
  for (const name of [
    "lime",
    "app-server",
    "code-mode-host",
    ...readdirSync(profile).filter((name) =>
      /^lib.*\.so(?:\..*)?$/u.test(name),
    ),
  ]) {
    copyFileSync(path.join(profile, name), path.join(bin, name));
    chmodSync(path.join(bin, name), 0o755);
  }

  prepareLocalComputerUseResources({
    binaryPath: path.join(bin, "app-server"),
    version,
  });
  for (const name of ["lime", "app-server", "code-mode-host"]) {
    const loaded = spawnSync("ldd", [path.join(bin, name)], {
      env: { ...process.env, LD_LIBRARY_PATH: bin },
      encoding: "utf8",
      shell: false,
    });
    if (
      loaded.error ||
      loaded.status !== 0 ||
      /not found/u.test(loaded.stdout)
    ) {
      throw new Error(
        `Incomplete Linux loader closure for ${name}: ${loaded.stdout || loaded.stderr}`,
      );
    }
  }
  const identity = spawnSync(path.join(bin, "lime"), ["--version"], {
    env: { ...process.env, LD_LIBRARY_PATH: bin },
    encoding: "utf8",
    timeout: 15_000,
    shell: false,
  });
  if (
    identity.error ||
    identity.status !== 0 ||
    identity.stdout.trim() !== `lime ${version}`
  )
    throw new Error(
      "Linux guest binary version does not match the application",
    );
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
  const manifest =
    JSON.stringify(
      {
        schemaVersion: 1,
        applicationId: "com.limecloud.lime",
        version,
        platform: "linux",
        arch: "x64",
        profile: profileName,
        files: filesAt(output),
      },
      null,
      2,
    ) + "\n";
  writeFileSync(path.join(output, "guest-manifest.json"), manifest);
  const verified = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      "import importlib.util,pathlib,sys;root=pathlib.Path(sys.argv[1]);spec=importlib.util.spec_from_file_location('lime_guest',root/'install.py');guest=importlib.util.module_from_spec(spec);spec.loader.exec_module(guest);guest.verify_payload(root,sys.argv[2])",
      output,
      createHash("sha256").update(manifest).digest("hex"),
    ],
    { encoding: "utf8", shell: false },
  );
  if (verified.error || verified.status !== 0)
    throw new Error(
      `Linux guest manifest verification failed: ${verified.stderr}`,
    );
  return packageLinuxGuest(output, { downloadUrl });
}
