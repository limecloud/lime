import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";

function git(root, args, input) {
  return execFileSync("git", args, {
    cwd: root,
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  });
}

/** Only this freshly created temporary repository receives objects or refs. */
export async function createComposerWorktreeGit(root, marker) {
  await fs.mkdir(root);
  const rootPath = await fs.realpath(root);
  const filePath = path.join(rootPath, "worktree-reference.md");
  const bytes = Buffer.alloc(128, " ");
  bytes.write(`# Worktree fixture\n${marker}\n`, "utf8");
  await fs.writeFile(filePath, bytes);
  git(rootPath, ["init", "--initial-branch=main"]);
  const blob = git(rootPath, [
    "hash-object",
    "-w",
    "worktree-reference.md",
  ]).trim();
  const tree = git(
    rootPath,
    ["mktree"],
    `100644 blob ${blob}\tworktree-reference.md\n`,
  ).trim();
  const commit = git(
    rootPath,
    ["commit-tree", tree],
    "Composer Worktree fixture\n",
  ).trim();
  git(rootPath, ["update-ref", "refs/heads/main", commit]);
  git(rootPath, ["read-tree", "HEAD"]);
  return { rootPath, filePath };
}

/** Read Git and actual tracked bytes, never infer checkout from RPC success. */
export async function readComposerWorktreeGit(rootPath, workspaceId = null) {
  // Apple's bundled Git lacks `worktree list -z`; owned paths use no line separators.
  const inventory = git(rootPath, [
    "-c",
    "core.quotePath=false",
    "worktree",
    "list",
    "--porcelain",
  ]);
  const worktrees = inventory
    .trim()
    .split(/\r?\n\r?\n/u)
    .filter(Boolean)
    .map((block) => {
      const fields = block.split(/\r?\n/u).filter(Boolean);
      const worktreePath = fields
        .find((line) => line.startsWith("worktree "))
        ?.slice(9);
      if (!worktreePath || worktreePath.startsWith('"')) {
        throw new Error(
          "Owned Worktree fixture requires an unquoted porcelain path",
        );
      }
      return {
        path: worktreePath,
        head: fields.find((line) => line.startsWith("HEAD "))?.slice(5),
        detached: fields.includes("detached"),
      };
    });
  return {
    rootPath,
    workspaceId,
    worktrees,
    head: git(rootPath, ["rev-parse", "HEAD"]).trim(),
    status: git(rootPath, [
      "status",
      "--porcelain",
      "--untracked-files=no",
    ]).trim(),
    trackedSha256: createHash("sha256")
      .update(await fs.readFile(path.join(rootPath, "worktree-reference.md")))
      .digest("hex"),
  };
}

/** Read the actual worktree-scoped selection and setup artifact after GUI creation. */
export async function readComposerWorktreeEnvironment(rootPath) {
  const configFile = git(rootPath, [
    "rev-parse",
    "--git-path",
    "config.worktree",
  ]).trim();
  const configPath = git(rootPath, [
    "config",
    "--file",
    configFile,
    "--get",
    "codex.localEnvironmentConfigPath",
  ]).trim();
  const marker = await fs.readFile(
    path.join(rootPath, "local-environment-setup.txt"),
  );
  return {
    configPath,
    configRaw: await fs.readFile(configPath, "utf8"),
    setupMarker: marker
      .toString("utf8")
      .replaceAll("\0", "")
      .includes("environment-fixture"),
    setupMarkerSha256: createHash("sha256").update(marker).digest("hex"),
  };
}
