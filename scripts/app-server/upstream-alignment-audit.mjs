#!/usr/bin/env node

// 上游源码对齐审计：用可复现的指标衡量 lime-rs 与上游的复制/缺口状态。
// 事实源是 /Users/coso/Documents/dev/rust/codex（可用 UPSTREAM_ROOT 覆盖）。
// 输出 internal/refactor/upstream-alignment-audit.json，供执行计划引用。

import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const limeRoot = path.join(repoRoot, "lime-rs/crates");
const upstreamRoot = path.resolve(
  process.env.UPSTREAM_ROOT || "/Users/coso/Documents/dev/rust/codex/codex-rs",
);
const outputPath = path.join(
  repoRoot,
  "internal/refactor/upstream-alignment-audit.json",
);

// 主链 crate 的 owner 映射。limeCrates 为同语义 owner；capability 说明 Lime 当前形态：
// "split"=拆到多个 crate，"partial"=有实现但未整目录复制，"absent"=无实现，
// "excluded"=按产品边界不纳入，"equivalent"=能力等价但 crate 名不同。
const crateMapping = {
  core: { limeCrates: ["agent", "agent-runtime", "runtime-core", "tool-runtime"], capability: "split" },
  protocol: { limeCrates: ["agent-protocol"], capability: "split" },
  "app-server-protocol": { limeCrates: ["app-server-protocol"], capability: "equivalent" },
  "app-server-transport": { limeCrates: ["app-server-transport"], capability: "equivalent" },
  "app-server-client": { limeCrates: ["app-server-client"], capability: "equivalent" },
  "app-server": { limeCrates: ["app-server"], capability: "equivalent" },
  "app-server-daemon": { limeCrates: ["app-server-daemon"], capability: "partial" },
  "app-server-test-client": { limeCrates: ["app-server-test-client"], capability: "equivalent" },
  config: { limeCrates: ["config", "core"], capability: "split" },
  execpolicy: { limeCrates: ["execpolicy"], capability: "equivalent" },
  "apply-patch": { limeCrates: ["patch-apply"], capability: "equivalent" },
  tools: { limeCrates: ["tool-runtime"], capability: "split" },
  sandboxing: { limeCrates: [], capability: "partial", owner: "tool-runtime/src/sandbox" },
  "linux-sandbox": { limeCrates: [], capability: "absent" },
  "windows-sandbox-rs": { limeCrates: [], capability: "partial", owner: "tool-runtime/src/execution_process/windows_*" },
  "exec-server": { limeCrates: [], capability: "absent" },
  "thread-store": { limeCrates: ["thread-store"], capability: "partial" },
  permissions: { limeCrates: ["permissions"], capability: "equivalent" },
  "utils-path-uri": { limeCrates: ["utils-path-uri"], capability: "equivalent" },
  rollout: { limeCrates: [], capability: "partial", owner: "app-server/src/runtime/canonical_rollout" },
  state: { limeCrates: [], capability: "partial", owner: "core/src/database" },
  history: { limeCrates: [], capability: "partial", owner: "thread-store/src/history" },
  "file-search": { limeCrates: ["file-search"], capability: "equivalent" },
  skills: { limeCrates: ["skills"], capability: "equivalent" },
  hooks: { limeCrates: [], capability: "partial", owner: "tool-runtime/src/hook_*" },
  memories: { limeCrates: [], capability: "partial", owner: "tool-runtime/src/memory_store" },
  mcp: { limeCrates: ["mcp"], capability: "equivalent" },
  "model-provider": { limeCrates: ["model-provider"], capability: "equivalent" },
  otel: { limeCrates: [], capability: "excluded" },
  cli: { limeCrates: ["cli"], capability: "partial" },
  tui: { limeCrates: ["tui"], capability: "partial" },
};

const ignoredDirectories = new Set([
  "target",
  "node_modules",
  "__pycache__",
  ".git",
  "dist",
  "build",
  "gen",
]);

async function walkRustFiles(root) {
  const files = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith(".rs")) files.push(absolute);
    }
  }
  await visit(root);
  return files;
}

function normalizeLines(source) {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"));
}

const SHINGLE_SIZE = 3;

function shingleSet(lines) {
  const shingles = new Set();
  for (let index = 0; index + SHINGLE_SIZE <= lines.length; index += 1) {
    const window = lines.slice(index, index + SHINGLE_SIZE).join("\n");
    shingles.add(createHash("sha1").update(window).digest("base64"));
  }
  return shingles;
}

const shingleCache = new Map();

function cachedShingles(entry) {
  const key = entry.file;
  if (!shingleCache.has(key))
    shingleCache.set(key, shingleSet(normalizeLines(entry.source)));
  return shingleCache.get(key);
}

function jaccard(left, right) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const value of small) if (large.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function similarityBucket(score) {
  if (score >= 0.95) return "0.95-1.00";
  if (score >= 0.8) return "0.80-0.95";
  if (score >= 0.5) return "0.50-0.80";
  if (score >= 0.2) return "0.20-0.50";
  return "0.00-0.20";
}

async function indexSource(root) {
  const files = await walkRustFiles(root);
  const byName = new Map();
  let totalLines = 0;
  const identical = new Map();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const lines = source.split("\n");
    totalLines += lines.length;
    const digest = createHash("sha256").update(source).digest("hex");
    if (!identical.has(digest)) identical.set(digest, []);
    identical.get(digest).push(file);
    const base = path.basename(file);
    if (!byName.has(base)) byName.set(base, []);
    byName.get(base).push({ file, lines, source, digest });
  }
  return { files, totalLines, byName, identical };
}

async function cargoPackages() {
  const raw = execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      path.join(repoRoot, "lime-rs/Cargo.toml"),
      "--no-deps",
      "--format-version",
      "1",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return JSON.parse(raw).packages;
}

async function countCrateLines(packageNames) {
  const counts = new Map();
  for (const name of packageNames) {
    const directory = path.join(limeRoot, name.replace(/^lime-/, ""));
    const files = await walkRustFiles(directory);
    let lines = 0;
    for (const file of files) lines += (await readFile(file, "utf8")).split("\n").length;
    counts.set(name, { files: files.length, lines });
  }
  return counts;
}

async function main() {
  const lime = await indexSource(limeRoot);
  const upstream = await indexSource(upstreamRoot);
  const packages = await cargoPackages();

  const dependents = new Map();
  for (const entry of packages) {
    for (const dependency of entry.dependencies || []) {
      if (!dependents.has(dependency.name)) dependents.set(dependency.name, new Set());
      dependents.get(dependency.name).add(entry.name);
    }
  }

  // 已复制但尚未接线的 owner：不是“应删除”，而是下一刀的消费者迁移目标。
  const pendingWiring = new Set(["lime-utils-path-uri", "lime-permissions", "file-search"]);
  // 零消费者但被路线图/业务计划明确保留的 owner：休眠，不是死代码。
  const dormantByPlan = new Map([
    ["lime-server", "internal/bussniss/lime-oem-cloud-phase1-plan.md"],
    ["app-server-daemon", "internal/roadmap/appserver/service-extraction.md"],
  ]);
  const deadCrates = [];
  for (const entry of packages) {
    const targets = entry.targets || [];
    const hasBinary = targets.some((target) => target.kind.includes("bin"));
    const users = [...(dependents.get(entry.name) || [])];
    if (hasBinary || users.length > 0) continue;
    const status = pendingWiring.has(entry.name)
      ? "pending-wiring"
      : dormantByPlan.has(entry.name)
        ? "dormant-by-plan"
        : "unreachable";
    deadCrates.push({
      crate: entry.name,
      dependents: 0,
      status,
      ...(dormantByPlan.has(entry.name)
        ? { plan: dormantByPlan.get(entry.name) }
        : {}),
    });
  }

  const limeIdentical = new Set([...lime.identical.keys()]);
  const upstreamIdentical = new Set([...upstream.identical.keys()]);
  const identicalFiles = [];
  for (const digest of limeIdentical) {
    if (!upstreamIdentical.has(digest)) continue;
    identicalFiles.push({
      lime: path.relative(repoRoot, lime.identical.get(digest)[0]).split(path.sep).join("/"),
      upstream: path.relative(upstreamRoot, upstream.identical.get(digest)[0]).split(path.sep).join("/"),
    });
  }

  const buckets = new Map();
  let compared = 0;
  let bestScore = 0;
  const candidates = [];
  for (const [base, limeEntries] of lime.byName) {
    const upstreamEntries = upstream.byName.get(base);
    if (!upstreamEntries) continue;
    for (const limeEntry of limeEntries) {
      if (limeEntry.lines.length > 8000) continue;
      const limeShingles = cachedShingles(limeEntry);
      let best = { score: 0, file: null };
      for (const upstreamEntry of upstreamEntries) {
        if (upstreamEntry.lines.length > 8000) continue;
        const score = jaccard(limeShingles, cachedShingles(upstreamEntry));
        if (score > best.score) best = { score, file: upstreamEntry.file };
      }
      compared += 1;
      if (best.score > bestScore) bestScore = best.score;
      const bucket = similarityBucket(best.score);
      buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
      if (best.score >= 0.5)
        candidates.push({
          lime: path.relative(repoRoot, limeEntry.file).split(path.sep).join("/"),
          upstream: path.relative(upstreamRoot, best.file).split(path.sep).join("/"),
          similarity: Number(best.score.toFixed(3)),
        });
    }
  }
  candidates.sort((left, right) => right.similarity - left.similarity);

  const oversized = [];
  for (const entries of lime.byName.values()) {
    for (const entry of entries) {
      if (entry.lines.length <= 1000) continue;
      oversized.push({
        file: path.relative(repoRoot, entry.file).split(path.sep).join("/"),
        lines: entry.lines.length,
      });
    }
  }
  oversized.sort((left, right) => right.lines - left.lines);

  const crateCoverage = [];
  for (const [upstreamCrate, mapping] of Object.entries(crateMapping)) {
    const entry = {
      upstreamCrate,
      limeCrates: mapping.limeCrates,
      capability: mapping.capability,
      owner: mapping.owner || null,
    };
    if (mapping.limeCrates.length > 0) {
      let lines = 0;
      for (const crate of mapping.limeCrates) {
        lines += (await countCrateLines([crate])).get(crate)?.lines || 0;
      }
      entry.limeLines = lines;
    }
    crateCoverage.push(entry);
  }

  let revision = null;
  try {
    revision = execFileSync("git", ["-C", upstreamRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    revision = "unknown";
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sources: { lime: "lime-rs/crates", upstreamRoot, upstreamRevision: revision },
    totals: {
      limeFiles: lime.files.length,
      limeLines: lime.totalLines,
      upstreamFiles: upstream.files.length,
      upstreamLines: upstream.totalLines,
    },
    copyFidelity: {
      identicalFiles: identicalFiles.length,
      identical: identicalFiles.slice(0, 40),
      sameNameCompared: compared,
      similarityBuckets: Object.fromEntries(
        [...buckets.entries()].sort((left, right) => left[0].localeCompare(right[0])),
      ),
      highSimilarityFiles: candidates.length,
      topSimilarity: candidates.slice(0, 40),
    },
    crateCoverage,
    deadCrates,
    oversizedCrates: oversized,
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `[upstream-alignment] lime ${lime.files.length} files/${lime.totalLines} lines; ` +
      `upstream ${upstream.files.length} files/${upstream.totalLines} lines; ` +
      `identical=${identicalFiles.length}; compared=${compared}; ` +
      `highSimilarity=${candidates.length}; unreachable=${deadCrates.filter((entry) => entry.status === "unreachable").length}; ` +
      `pendingWiring=${deadCrates.filter((entry) => entry.status === "pending-wiring").length}; ` +
      `dormantByPlan=${deadCrates.filter((entry) => entry.status === "dormant-by-plan").length}`,
  );
  console.log(`[upstream-alignment] wrote ${path.relative(repoRoot, outputPath)}`);
}

await main();
