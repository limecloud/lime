#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  DEFAULT_PROJECT_GATE_EXCLUDES,
  assertProjectGateTrackersReady,
  buildProjectGateCandidateDescriptor,
  captureGitReferenceCommit,
  captureProjectGateSurfaceContract,
  captureProjectGateSnapshot,
  compareProjectGateSnapshots,
  formatProjectGateRunId,
  isExcludedProjectGatePath,
  normalizeExcludes,
  validateProjectGateCandidateDescriptor,
} from "../lib/project-gate-candidate-core.mjs";

const BACKEND_MODES = new Set(["unavailable", "external", "runtime", "live"]);
const PROVIDER_PROTOCOLS = new Set([
  "none",
  "responses",
  "chat",
  "anthropic",
  "media",
]);

function printHelp() {
  console.log(`
Project Gate Candidate Snapshot

用法:
  npm run agent-qc:project-gate-candidate
  npm run agent-qc:project-gate-candidate -- --snapshot-only

选项:
  --repo-root <path>          Git 仓库根目录，默认当前目录
  --reference-repo <path>
                              干净的只读参考源码仓库；生成 candidate 时必填
  owner guard                默认要求源码导入 tracker 已 ready/completed
  --output <path>             candidate JSON；必须位于 digest exclusion 内
  --verify-candidate <path>   重算当前 snapshot 并与既有 candidate 比较
  --interval-ms <ms>          两次 snapshot 间隔，默认 5000，最小 5000
  --run-id <id>               显式 run-id；默认由时间与 product digest 生成
  --exclude <path>            追加仓库相对排除路径，可重复
  --backend-mode <mode>       unavailable | external | runtime | live
  --provider-protocol <mode>  none | responses | chat | anthropic | media
  --secrets-present           只记录 boolean marker，不读取或保存 secret
  --snapshot-only             只打印单次诊断 snapshot，不生成 candidate
  -h, --help                  显示帮助
`);
}

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    referenceRepo: process.env.LIME_REFERENCE_REPO ?? null,
    output: null,
    verifyCandidate: null,
    intervalMs: 5_000,
    runId: null,
    excludes: [...DEFAULT_PROJECT_GATE_EXCLUDES],
    backendMode: "unavailable",
    providerProtocol: "none",
    secretsPresent: false,
    snapshotOnly: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--repo-root" && next) {
      options.repoRoot = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--reference-repo" && next) {
      options.referenceRepo = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      options.output = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--verify-candidate" && next) {
      options.verifyCandidate = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--interval-ms" && next) {
      options.intervalMs = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--run-id" && next) {
      options.runId = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--exclude" && next) {
      options.excludes.push(next);
      index += 1;
      continue;
    }
    if (arg === "--backend-mode" && next) {
      options.backendMode = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--provider-protocol" && next) {
      options.providerProtocol = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--secrets-present") {
      options.secretsPresent = true;
      continue;
    }
    if (arg === "--snapshot-only") {
      options.snapshotOnly = true;
      continue;
    }
    throw new Error(`未知参数: ${arg}`);
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 5_000) {
    throw new Error("--interval-ms 必须是 >= 5000 的数字");
  }
  if (
    options.runId &&
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.runId)
  ) {
    throw new Error("--run-id 只能包含字母、数字、点、下划线和连字符");
  }
  if (!BACKEND_MODES.has(options.backendMode)) {
    throw new Error(`不支持的 --backend-mode: ${options.backendMode}`);
  }
  if (!PROVIDER_PROTOCOLS.has(options.providerProtocol)) {
    throw new Error(
      `不支持的 --provider-protocol: ${options.providerProtocol}`,
    );
  }
  options.repoRoot = fs.realpathSync(path.resolve(options.repoRoot));
  if (options.referenceRepo) {
    options.referenceRepo = path.resolve(options.referenceRepo);
  }
  if (options.output) {
    options.output = path.resolve(options.repoRoot, options.output);
  }
  if (options.verifyCandidate) {
    options.verifyCandidate = path.resolve(
      options.repoRoot,
      options.verifyCandidate,
    );
  }
  if (options.verifyCandidate && options.snapshotOnly) {
    throw new Error("--verify-candidate 与 --snapshot-only 不能同时使用");
  }
  if (options.verifyCandidate && options.output) {
    throw new Error("--verify-candidate 与 --output 不能同时使用");
  }
  for (const excludedPath of options.excludes) {
    if (
      path.isAbsolute(excludedPath) ||
      excludedPath === ".." ||
      excludedPath.startsWith("../")
    ) {
      throw new Error(`--exclude 必须是仓库内相对路径: ${excludedPath}`);
    }
  }
  options.excludes = normalizeExcludes(options.excludes);
  return options;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertOutputExcluded(repoRoot, outputPath, excludes) {
  const relative = path.relative(repoRoot, outputPath).replaceAll("\\", "/");
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !isExcludedProjectGatePath(relative, excludes)
  ) {
    throw new Error(
      `--output 必须位于 digest exclusion 内，当前路径: ${outputPath}`,
    );
  }
}

function readCandidate(filePath) {
  return validateProjectGateCandidateDescriptor(
    JSON.parse(fs.readFileSync(filePath, "utf8")),
  );
}

function summarizeChangedPathDrift(expectedPaths, currentPaths) {
  const expected = new Set(expectedPaths);
  const current = new Set(currentPaths);
  return {
    added: currentPaths
      .filter((filePath) => !expected.has(filePath))
      .slice(0, 50),
    removed: expectedPaths
      .filter((filePath) => !current.has(filePath))
      .slice(0, 50),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.verifyCandidate) {
    const candidate = readCandidate(options.verifyCandidate);
    options.excludes = normalizeExcludes(candidate.digest_excludes);
    const current = captureProjectGateSnapshot(options);
    const comparison = compareProjectGateSnapshots(candidate, current);
    const result = {
      status: comparison.stable ? "match" : "drift",
      run_id: candidate.run_id,
      comparison,
      expected_product_snapshot_digest: candidate.product_snapshot_digest,
      current_product_snapshot_digest: current.product_snapshot_digest,
      changed_path_count: current.changed_paths.length,
      changed_path_drift: summarizeChangedPathDrift(
        candidate.changed_paths,
        current.changed_paths,
      ),
    };
    console.log(JSON.stringify(result, null, 2));
    if (!comparison.stable) {
      process.exitCode = 1;
    }
    return;
  }

  if (options.output) {
    assertOutputExcluded(options.repoRoot, options.output, options.excludes);
  }
  if (!options.referenceRepo && !options.snapshotOnly) {
    throw new Error(
      "生成 candidate 必须提供 --reference-repo 或 LIME_REFERENCE_REPO",
    );
  }
  const startedAt = new Date();
  const firstSurfaceContract = captureProjectGateSurfaceContract({
    repoRoot: options.repoRoot,
  });
  const firstBlockingTrackers = options.snapshotOnly
    ? null
    : assertProjectGateTrackersReady({ repoRoot: options.repoRoot });
  const firstReferenceCommit = options.referenceRepo
    ? captureGitReferenceCommit(options.referenceRepo)
    : null;
  const first = captureProjectGateSnapshot(options);
  if (options.snapshotOnly) {
    console.log(
      JSON.stringify(
        { ...first, surface_contract: firstSurfaceContract },
        null,
        2,
      ),
    );
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  const second = captureProjectGateSnapshot(options);
  const secondSurfaceContract = captureProjectGateSurfaceContract({
    repoRoot: options.repoRoot,
  });
  const secondBlockingTrackers = assertProjectGateTrackersReady({
    repoRoot: options.repoRoot,
  });
  const secondReferenceCommit = captureGitReferenceCommit(
    options.referenceRepo,
  );
  const comparison = compareProjectGateSnapshots(first, second);
  const referenceCommitMatches =
    firstReferenceCommit === secondReferenceCommit;
  const blockingTrackersMatch =
    JSON.stringify(firstBlockingTrackers) ===
    JSON.stringify(secondBlockingTrackers);
  const surfaceContractMatches =
    firstSurfaceContract.digest === secondSurfaceContract.digest;
  const stability = {
    ...comparison,
    stable:
      comparison.stable &&
      referenceCommitMatches &&
      blockingTrackersMatch &&
      surfaceContractMatches,
    referenceCommitMatches,
    blockingTrackersMatch,
    surfaceContractMatches,
  };
  if (!stability.stable) {
    console.error(
      JSON.stringify(
        {
          status: "unstable",
          first,
          second,
          comparison: stability,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  const completedAt = new Date();
  const runId =
    options.runId ||
    formatProjectGateRunId(completedAt, second.product_snapshot_digest);
  const outputPath = options.output
    ? options.output
    : path.join(
        options.repoRoot,
        ".lime",
        "qc",
        "project-gates",
        runId,
        "candidate.json",
      );
  assertOutputExcluded(options.repoRoot, outputPath, options.excludes);
  const descriptor = buildProjectGateCandidateDescriptor({
    snapshot: second,
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    stability: {
      ...stability,
      interval_ms: options.intervalMs,
      first_captured_at: first.captured_at,
      second_captured_at: second.captured_at,
    },
    repoRoot: options.repoRoot,
    backendMode: options.backendMode,
    providerProtocol: options.providerProtocol,
    secretsPresent: options.secretsPresent,
    referenceCommit: secondReferenceCommit,
    blockingTrackers: secondBlockingTrackers,
    surfaceContract: secondSurfaceContract,
  });
  writeJson(outputPath, descriptor);
  console.log(
    JSON.stringify(
      {
        status: "stable",
        run_id: runId,
        product_snapshot_digest: second.product_snapshot_digest,
        reference_commit: secondReferenceCommit,
        blocking_trackers: secondBlockingTrackers,
        surface_contract: secondSurfaceContract,
        changed_path_count: second.changed_paths.length,
        output: outputPath,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`[agent-qc:project-gate-candidate] ${error.message}`);
  process.exitCode = 1;
});
