import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { withNativeSystemPath } from "./native-executable-env.mjs";

export const DEFAULT_PROJECT_GATE_EXCLUDES = [
  ".lime/qc/project-gates",
  "internal/exec-plans/project-gate-a-b-acceptance-plan.md",
  "internal/research/refactor/v2/13-evidence/project-gates",
];

export const DEFAULT_PROJECT_GATE_BLOCKING_TRACKERS = [
  "internal/roadmap/codeximport/implementation-tracker.md",
];

export const PROJECT_GATE_SURFACE_CONTRACT_PATH =
  "internal/test/project-gate-surfaces.manifest.json";

const EXPECTED_PROJECT_GATE_SURFACE_IDS = [
  "SHELL-01",
  "SHELL-02",
  "AGENT-01",
  "AGENT-02",
  "AGENT-03",
  "AGENT-04",
  "AGENT-05",
  "AGENT-06",
  "AGENT-07",
  "AGENT-08",
  "PROVIDER-01",
  "HOME-01",
  "WORK-01",
  "WORK-02",
  "WORK-03",
  "WORK-04",
  "WORK-05",
  "PAGE-01",
  "PAGE-02",
  "PAGE-03",
  "PAGE-04",
  "PAGE-05",
  "PAGE-06",
  "PAGE-07",
  "PAGE-08",
  "SETTINGS-01",
  "HOST-01",
  "HOST-02",
  "RELEASE-01",
  "RELEASE-02",
  "CROSS-01",
  "CROSS-02",
  "CROSS-03",
  "CROSS-04",
];

export const PROJECT_GATE_PROOF_LEVELS = new Set([
  "gate-a",
  "gate-b-f",
  "gate-b-r",
  "gate-b-l",
  "gate-b-p",
]);

const PROJECT_GATE_READY_TRACKER_STATUSES = new Set([
  "ready",
  "ready-for-gate",
  "completed",
  "closed",
]);

const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

export function parseGitNameStatus(buffer) {
  const tokens = splitNul(buffer);
  const entries = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    if (!status) {
      continue;
    }
    const code = status[0];
    if (code === "R" || code === "C") {
      const previousPath = tokens[index++];
      const filePath = tokens[index++];
      if (!previousPath || !filePath) {
        throw new Error(`无法解析 git ${status} 记录`);
      }
      entries.push({ status, path: filePath, previousPath });
      continue;
    }
    const filePath = tokens[index++];
    if (!filePath) {
      throw new Error(`无法解析 git ${status} 记录`);
    }
    entries.push({ status, path: filePath, previousPath: null });
  }
  return entries;
}

export function normalizeExcludes(excludes = []) {
  return Array.from(
    new Set(
      excludes
        .map((value) => normalizeRepoPath(value))
        .filter((value) => value && value !== "."),
    ),
  ).sort();
}

export function isExcludedProjectGatePath(filePath, excludes) {
  const normalizedPath = normalizeRepoPath(filePath);
  return excludes.some(
    (excludedPath) =>
      normalizedPath === excludedPath ||
      normalizedPath.startsWith(`${excludedPath}/`),
  );
}

export function compareProjectGateSnapshots(first, second) {
  const productDigestMatches =
    first.product_snapshot_digest === second.product_snapshot_digest;
  const gitDiffDigestMatches = first.git_diff_digest === second.git_diff_digest;
  const gitHeadMatches = first.git_head === second.git_head;
  const changedPathsMatch =
    JSON.stringify(first.changed_paths) ===
    JSON.stringify(second.changed_paths);
  const excludesMatch =
    JSON.stringify(first.digest_excludes) ===
    JSON.stringify(second.digest_excludes);
  return {
    stable:
      productDigestMatches &&
      gitDiffDigestMatches &&
      gitHeadMatches &&
      changedPathsMatch &&
      excludesMatch,
    productDigestMatches,
    gitDiffDigestMatches,
    gitHeadMatches,
    changedPathsMatch,
    excludesMatch,
  };
}

export function validateProjectGateCandidateDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("candidate 必须是 JSON object");
  }
  if (value.schema_version !== 3) {
    throw new Error(
      `不支持的 candidate schema_version: ${value.schema_version}`,
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.run_id ?? "")) {
    throw new Error("candidate run_id 非法");
  }
  for (const key of ["product_snapshot_digest", "git_diff_digest"]) {
    if (!/^[a-f0-9]{64}$/.test(value[key] ?? "")) {
      throw new Error(`candidate ${key} 非法`);
    }
  }
  if (!/^[a-f0-9]{40,64}$/.test(value.git_head ?? "")) {
    throw new Error("candidate git_head 非法");
  }
  if (!/^[a-f0-9]{40,64}$/.test(value.reference_commit ?? "")) {
    throw new Error("candidate reference_commit 非法");
  }
  if (
    !Array.isArray(value.blocking_trackers) ||
    !value.blocking_trackers.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.path === "string" &&
        PROJECT_GATE_READY_TRACKER_STATUSES.has(entry.status),
    )
  ) {
    throw new Error("candidate blocking_trackers 非法");
  }
  if (
    !value.surface_contract ||
    typeof value.surface_contract !== "object" ||
    value.surface_contract.path !== PROJECT_GATE_SURFACE_CONTRACT_PATH ||
    value.surface_contract.schema_version !== 1 ||
    value.surface_contract.surface_count !== 34 ||
    value.surface_contract.priority_counts?.P0 !== 17 ||
    value.surface_contract.priority_counts?.P1 !== 17 ||
    !/^[a-f0-9]{64}$/.test(value.surface_contract.digest ?? "")
  ) {
    throw new Error("candidate surface_contract 非法");
  }
  if (
    !Array.isArray(value.changed_paths) ||
    !value.changed_paths.every((entry) => typeof entry === "string")
  ) {
    throw new Error("candidate changed_paths 非法");
  }
  if (
    !Array.isArray(value.digest_excludes) ||
    !value.digest_excludes.every((entry) => typeof entry === "string")
  ) {
    throw new Error("candidate digest_excludes 非法");
  }
  if (value.stability?.stable !== true) {
    throw new Error("candidate 未通过双 snapshot 稳定性检查");
  }
  return value;
}

export function assertProjectGateTrackersReady({
  repoRoot = process.cwd(),
  trackerPaths = DEFAULT_PROJECT_GATE_BLOCKING_TRACKERS,
} = {}) {
  const root = fs.realpathSync(path.resolve(repoRoot));
  const trackers = trackerPaths.map((trackerPath) =>
    readProjectGateTracker(root, trackerPath),
  );
  const blocked = trackers.filter(
    ({ status }) => !PROJECT_GATE_READY_TRACKER_STATUSES.has(status),
  );
  if (blocked.length > 0) {
    const details = blocked
      .map(({ path: trackerPath, status }) => `${trackerPath} status=${status}`)
      .join(", ");
    throw new Error(
      `candidate blocker 未退出: ${details}; 需要 ready、ready-for-gate、completed 或 closed`,
    );
  }
  return trackers;
}

export function captureProjectGateSurfaceContract({
  repoRoot = process.cwd(),
  manifestPath = PROJECT_GATE_SURFACE_CONTRACT_PATH,
} = {}) {
  const root = fs.realpathSync(path.resolve(repoRoot));
  const resolved = resolveRepoRelativePath(
    root,
    manifestPath,
    "surface contract",
  );
  const value = JSON.parse(fs.readFileSync(resolved.absolutePath, "utf8"));
  if (value?.schemaVersion !== 1 || !Array.isArray(value.surfaces)) {
    throw new Error("project Gate surface contract schema 非法");
  }
  const ids = value.surfaces.map((surface) => surface?.id);
  if (
    JSON.stringify(ids) !== JSON.stringify(EXPECTED_PROJECT_GATE_SURFACE_IDS)
  ) {
    throw new Error("project Gate surface contract ID 集合或顺序漂移");
  }
  const priorityCounts = { P0: 0, P1: 0 };
  for (const surface of value.surfaces) {
    if (!(surface.priority in priorityCounts)) {
      throw new Error(`project Gate surface ${surface.id} priority 非法`);
    }
    priorityCounts[surface.priority] += 1;
    if (
      !Array.isArray(surface.owners) ||
      surface.owners.length === 0 ||
      !surface.owners.every(
        (owner) => typeof owner === "string" && owner.trim().length > 0,
      )
    ) {
      throw new Error(`project Gate surface ${surface.id} owners 非法`);
    }
    if (
      !Array.isArray(surface.requiredProofs) ||
      !surface.requiredProofs.includes("gate-a") ||
      !surface.requiredProofs.some((proof) => proof.startsWith("gate-b-")) ||
      !surface.requiredProofs.every((proof) =>
        PROJECT_GATE_PROOF_LEVELS.has(proof),
      ) ||
      new Set(surface.requiredProofs).size !== surface.requiredProofs.length
    ) {
      throw new Error(`project Gate surface ${surface.id} requiredProofs 非法`);
    }
  }
  if (priorityCounts.P0 !== 17 || priorityCounts.P1 !== 17) {
    throw new Error("project Gate surface priority 分母漂移");
  }
  return {
    path: resolved.relativePath,
    schema_version: value.schemaVersion,
    surface_count: value.surfaces.length,
    priority_counts: priorityCounts,
    digest: sha256(Buffer.from(stableJson(value), "utf8")),
  };
}

export function captureGitReferenceCommit(referenceRepo) {
  const root = fs.realpathSync(path.resolve(referenceRepo));
  assertGitRepository(root);
  const status = runGitText(root, ["status", "--porcelain=v1"]);
  if (status) {
    throw new Error("参考源码仓库存在未提交改动，不能冻结基线");
  }
  const commit = runGitText(root, ["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error("参考源码 HEAD 非法");
  }
  return commit;
}

export function captureProjectGateSnapshot({
  repoRoot = process.cwd(),
  excludes = DEFAULT_PROJECT_GATE_EXCLUDES,
} = {}) {
  const root = fs.realpathSync(path.resolve(repoRoot));
  const normalizedExcludes = normalizeExcludes(excludes);
  assertGitRepository(root);

  const inventoryBefore = collectInventory(root);
  const records = buildSnapshotRecords(
    root,
    inventoryBefore,
    normalizedExcludes,
  );
  assertRecordFingerprints(root, records);
  const inventoryAfter = collectInventory(root);
  if (
    inventorySignature(inventoryBefore, normalizedExcludes) !==
    inventorySignature(inventoryAfter, normalizedExcludes)
  ) {
    throw new Error("源码清单在 snapshot 计算期间发生变化，请重新运行");
  }

  const manifest = {
    schema_version: 1,
    digest_excludes: normalizedExcludes,
    files: records.map(({ fingerprint: _fingerprint, ...record }) => record),
  };
  const changedPaths = Array.from(
    new Set(
      records
        .filter((record) => record.status !== "clean")
        .map((record) => record.path),
    ),
  ).sort();
  const deletedCount = records.filter(
    (record) => record.kind === "deleted",
  ).length;
  const gitDiff = runGitBuffer(root, buildGitDiffArgs(normalizedExcludes));

  return {
    git_head: inventoryAfter.gitHead,
    product_snapshot_digest: sha256(Buffer.from(stableJson(manifest), "utf8")),
    git_diff_digest: sha256(gitDiff),
    changed_paths: changedPaths,
    digest_excludes: normalizedExcludes,
    snapshot_file_count: records.length,
    snapshot_deleted_count: deletedCount,
    captured_at: new Date().toISOString(),
  };
}

export function buildProjectGateCandidateDescriptor({
  snapshot,
  runId,
  startedAt,
  completedAt,
  stability,
  repoRoot = process.cwd(),
  backendMode = "unavailable",
  providerProtocol = "none",
  secretsPresent = false,
  referenceCommit,
  blockingTrackers,
  surfaceContract,
}) {
  const root = path.resolve(repoRoot);
  return {
    schema_version: 3,
    run_id: runId,
    ...snapshot,
    reference_commit: referenceCommit,
    blocking_trackers: blockingTrackers,
    surface_contract: surfaceContract,
    pnpm_lock_digest: digestFileOrNull(path.join(root, "pnpm-lock.yaml")),
    cargo_lock_digest: digestFileOrNull(
      path.join(root, "lime-rs", "Cargo.lock"),
    ),
    os_arch: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
    },
    node_npm: {
      node: process.version,
      npm: runVersion("npm", ["--version"], root),
    },
    rust_toolchain: {
      rustc: runVersion("rustc", ["-Vv"], root),
      cargo: runVersion("cargo", ["-V"], root),
    },
    electron_version: readElectronVersion(root),
    backend_mode: backendMode,
    provider_protocol: providerProtocol,
    secrets_present: secretsPresent === true,
    started_at: startedAt,
    completed_at: completedAt,
    stability,
  };
}

export function formatProjectGateRunId(date, digest) {
  const timestamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/u, "Z");
  return `${timestamp}-${digest.slice(0, 12)}`;
}

function readProjectGateTracker(root, trackerPath) {
  const resolved = resolveRepoRelativePath(
    root,
    trackerPath,
    "blocking tracker",
  );
  const source = fs.readFileSync(resolved.absolutePath, "utf8");
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!frontmatter) {
    throw new Error(
      `blocking tracker 缺少 YAML frontmatter: ${resolved.relativePath}`,
    );
  }
  const metadata = parseYaml(frontmatter[1]);
  const status =
    typeof metadata?.status === "string"
      ? metadata.status.trim().toLowerCase()
      : "missing";
  return { path: resolved.relativePath, status };
}

function resolveRepoRelativePath(root, filePath, label) {
  if (path.isAbsolute(filePath)) {
    throw new Error(`${label} 必须是仓库内相对路径: ${filePath}`);
  }
  const relativePath = normalizeRepoPath(filePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../")
  ) {
    throw new Error(`${label} 必须是仓库内相对路径: ${filePath}`);
  }
  return {
    relativePath,
    absolutePath: path.resolve(root, relativePath),
  };
}

function collectInventory(root) {
  return {
    gitHead: runGitText(root, ["rev-parse", "HEAD"]),
    tracked: splitNul(
      runGitBuffer(root, ["ls-files", "--cached", "-z"]),
    ).sort(),
    untracked: splitNul(
      runGitBuffer(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ).sort(),
    changes: parseGitNameStatus(
      runGitBuffer(root, ["diff", "--name-status", "-z", "HEAD", "--"]),
    ),
  };
}

function inventorySignature(inventory, excludes) {
  const included = (filePath) => !isExcludedProjectGatePath(filePath, excludes);
  return sha256(
    Buffer.from(
      stableJson({
        gitHead: inventory.gitHead,
        tracked: inventory.tracked.filter(included),
        untracked: inventory.untracked.filter(included),
        changes: inventory.changes.filter(
          (entry) =>
            included(entry.path) ||
            (entry.previousPath && included(entry.previousPath)),
        ),
      }),
      "utf8",
    ),
  );
}

function buildSnapshotRecords(root, inventory, excludes) {
  const statuses = new Map();
  for (const entry of inventory.changes) {
    statuses.set(entry.path, entry.status);
    if (entry.status.startsWith("R") && entry.previousPath) {
      statuses.set(entry.previousPath, "D");
    }
  }
  for (const filePath of inventory.untracked) {
    if (!statuses.has(filePath)) {
      statuses.set(filePath, "??");
    }
  }

  const paths = new Set([
    ...inventory.tracked,
    ...inventory.untracked,
    ...statuses.keys(),
  ]);
  return [...paths]
    .filter((filePath) => !isExcludedProjectGatePath(filePath, excludes))
    .sort()
    .map((filePath) =>
      describeRepoPath(root, filePath, statuses.get(filePath) ?? "clean"),
    );
}

function describeRepoPath(root, filePath, status) {
  const absolutePath = resolveInsideRoot(root, filePath);
  let stat;
  try {
    stat = fs.lstatSync(absolutePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        path: filePath,
        status,
        kind: "deleted",
        size: null,
        content_sha256: null,
        fingerprint: "missing",
      };
    }
    throw error;
  }

  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(absolutePath, "utf8");
    const after = fs.lstatSync(absolutePath, { bigint: true });
    assertSameStat(filePath, stat, after);
    return {
      path: filePath,
      status,
      kind: "symlink",
      size: Buffer.byteLength(target),
      content_sha256: sha256(Buffer.from(target, "utf8")),
      fingerprint: statFingerprint(stat, "symlink"),
    };
  }
  if (!stat.isFile()) {
    throw new Error(`snapshot 不支持非文件路径: ${filePath}`);
  }

  const contentHash = crypto.createHash("sha256");
  const fd = fs.openSync(absolutePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      contentHash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  const after = fs.lstatSync(absolutePath, { bigint: true });
  assertSameStat(filePath, stat, after);
  return {
    path: filePath,
    status,
    kind: "file",
    size: Number(stat.size),
    content_sha256: contentHash.digest("hex"),
    fingerprint: statFingerprint(stat, "file"),
  };
}

function assertRecordFingerprints(root, records) {
  for (const record of records) {
    const absolutePath = resolveInsideRoot(root, record.path);
    let currentFingerprint = "missing";
    try {
      const stat = fs.lstatSync(absolutePath, { bigint: true });
      const kind = stat.isSymbolicLink()
        ? "symlink"
        : stat.isFile()
          ? "file"
          : "unsupported";
      currentFingerprint = statFingerprint(stat, kind);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    if (currentFingerprint !== record.fingerprint) {
      throw new Error(`源码在 snapshot 计算期间发生变化: ${record.path}`);
    }
  }
}

function assertSameStat(filePath, before, after) {
  if (
    statFingerprint(before, "content") !== statFingerprint(after, "content")
  ) {
    throw new Error(`读取期间文件发生变化: ${filePath}`);
  }
}

function statFingerprint(stat, kind) {
  return [kind, stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs].join(
    ":",
  );
}

function buildGitDiffArgs(excludes) {
  const args = ["diff", "--binary", "HEAD", "--", "."];
  for (const excludedPath of excludes) {
    args.push(`:(exclude)${excludedPath}`);
    args.push(`:(exclude)${excludedPath}/**`);
  }
  return args;
}

function assertGitRepository(root) {
  const topLevel = runGitText(root, ["rev-parse", "--show-toplevel"]);
  if (fs.realpathSync(path.resolve(topLevel)) !== root) {
    throw new Error(`--repo-root 必须是 Git 仓库根目录: ${root}`);
  }
}

function resolveInsideRoot(root, filePath) {
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径越过仓库根目录: ${filePath}`);
  }
  return resolved;
}

function normalizeRepoPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\/$/u, "");
}

function splitNul(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter((value) => value.length > 0);
}

function runGitBuffer(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "buffer",
    env: { ...withNativeSystemPath(process.env), LC_ALL: "C" },
    maxBuffer: MAX_GIT_OUTPUT,
  });
}

function runGitText(root, args) {
  return runGitBuffer(root, args).toString("utf8").trim();
}

function runVersion(command, args, root) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  }).trim();
}

function readElectronVersion(root) {
  const installedPath = path.join(
    root,
    "node_modules",
    "electron",
    "package.json",
  );
  if (fs.existsSync(installedPath)) {
    return JSON.parse(fs.readFileSync(installedPath, "utf8")).version ?? null;
  }
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  return (
    packageJson.devDependencies?.electron ??
    packageJson.dependencies?.electron ??
    null
  );
}

function digestFileOrNull(filePath) {
  return fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : null;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
