import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageLinuxGuest } from "./linux-guest-stage.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const args = process.argv.slice(2);
if (
  args.length !== 6 ||
  args[0] !== "--runtime-dir" ||
  args[2] !== "--out" ||
  args[4] !== "--version"
)
  throw new Error(
    "Usage: node scripts/app-server/linux-guest-release.mjs --runtime-dir <absolute-directory> --out <new-absolute-directory> --version <release-version>",
  );
const metadata = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const version = args[5];
const repository = metadata.repository.url
  .replace(/^git\+/u, "")
  .replace(/\.git$/u, "");
const archive = `lime-guest-linux-x64-${version}.tar.gz`;
if (
  version !== metadata.version ||
  !/^\d+\.\d+\.\d+$/u.test(version) ||
  !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u.test(repository) ||
  path.basename(args[3]) !== archive.slice(0, -7)
)
  throw new Error(
    "Linux guest release must match the application version and repository",
  );
const receipt = await stageLinuxGuest({
  runtimeDir: args[1],
  output: args[3],
  version,
  profileName: "release",
  downloadUrl: `${repository}/releases/download/v${version}/${archive}`,
});
console.log(JSON.stringify(receipt));
