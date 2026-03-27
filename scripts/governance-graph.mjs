#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cruise } from "dependency-cruiser";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import YAML from "yaml";
import { buildLegacySurfaceReport } from "./lib/legacy-surface-report-core.mjs";
import {
  buildRustModuleIndex,
  buildRustModulePathFromFile,
  createDirNodeId,
  expandRustUseTree,
  isFrontendCodePath,
  isPagePath,
  isRustCodePath,
  isTestLikePath,
  normalizePath,
  resolveMatchingGovernanceRule,
  resolveRustUseToFile,
  validateGovernanceRules,
} from "./lib/governance-graph-core.mjs";

const DEFAULT_SINCE_DAYS = 30;
const DEFAULT_OUTPUT_DIR = "./tmp/project-heatmap-governance";
const DEFAULT_RULES_PATH = "./governance/surfaces.yml";
const DEFAULT_KNIP_CONFIG = "./knip.governance.json";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "target-codex-verify",
  "tmp",
  "vendor",
  "modified_files",
]);

const FRONTEND_ENTRYPOINTS = ["src/main.tsx", "src/RootRouter.tsx"];
const STATUS_PRIORITY = new Map([
  ["dead", 4],
  ["deprecated", 3],
  ["compat", 2],
  ["current", 1],
  ["unclassified", 0],
]);

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const repoRoot = resolveRepoRoot(path.resolve(options.root || process.cwd()));
const outputDir = path.resolve(repoRoot, options.output || DEFAULT_OUTPUT_DIR);
const rulesPath = path.resolve(repoRoot, options.rules || DEFAULT_RULES_PATH);
const knipConfigPath = path.resolve(
  repoRoot,
  options.knipConfig || DEFAULT_KNIP_CONFIG,
);

const report = await buildGovernanceGraphReport({
  repoRoot,
  outputDir,
  sinceDays: options.days,
  rulesPath,
  knipConfigPath,
});

fs.mkdirSync(outputDir, { recursive: true });

const jsonOutputPath = path.join(outputDir, "governance-graph.json");
const htmlOutputPath = path.join(outputDir, "governance-graph.html");

fs.writeFileSync(jsonOutputPath, JSON.stringify(report, null, 2), "utf8");
fs.writeFileSync(htmlOutputPath, renderHtml(report), "utf8");

console.log("[governance-graph] 治理图谱已生成");
console.log(`[governance-graph] HTML: ${htmlOutputPath}`);
console.log(`[governance-graph] JSON: ${jsonOutputPath}`);
if (report.links.heatmapHtmlHref) {
  console.log(
    `[governance-graph] 同目录热力图: ${path.join(outputDir, "index.html")}`,
  );
}

function parseArgs(argv) {
  const result = {
    root: "",
    output: "",
    rules: "",
    knipConfig: "",
    days: DEFAULT_SINCE_DAYS,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if ((arg === "-h" || arg === "--help") && !result.help) {
      result.help = true;
      continue;
    }

    if (arg === "--root" && argv[index + 1]) {
      result.root = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--output" && argv[index + 1]) {
      result.output = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--rules" && argv[index + 1]) {
      result.rules = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--knip-config" && argv[index + 1]) {
      result.knipConfig = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--days" && argv[index + 1]) {
      result.days = normalizePositiveNumber(
        argv[index + 1],
        DEFAULT_SINCE_DAYS,
      );
      index += 1;
    }
  }

  return result;
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function printHelp() {
  console.log(`
Lime 治理图谱生成器

用法:
  npm run governance:graph
  npm run governance:graph -- --output "./tmp/project-heatmap-governance"
  npm run governance:graph -- --days 60 --rules "./governance/surfaces.yml"

选项:
  --root PATH         指定仓库根目录，默认当前目录
  --output PATH       指定输出目录，默认 ${DEFAULT_OUTPUT_DIR}
  --rules PATH        指定治理规则 YAML，默认 ${DEFAULT_RULES_PATH}
  --knip-config PATH  指定 knip 配置，默认 ${DEFAULT_KNIP_CONFIG}
  --days N            最近 N 天 churn，默认 ${DEFAULT_SINCE_DAYS}
  -h, --help          显示帮助
`);
}

async function buildGovernanceGraphReport({
  repoRoot,
  outputDir,
  sinceDays,
  rulesPath,
  knipConfigPath,
}) {
  const fileInventory = collectGovernanceFiles(repoRoot);
  const fileIndex = new Map(
    fileInventory.map((fileRecord) => [fileRecord.path, fileRecord]),
  );
  const gitCommand = process.platform === "win32" ? "git.exe" : "git";
  const fileChurn = collectGitChurn({
    gitCommand,
    repoRoot,
    sinceDays,
    trackedFiles: fileIndex,
  });
  const frontendGraph = await collectFrontendDependencies(repoRoot, fileIndex);
  const rustGraph = collectRustDependencies(repoRoot, fileInventory, fileIndex);
  const governanceRules = loadGovernanceRules(rulesPath);
  const knipSignals = collectKnipSignals(repoRoot, knipConfigPath);
  const legacyReport = buildLegacySurfaceReport();
  const legacyOverlays = buildLegacyOverlays(legacyReport);
  const frontendReachable = collectReachableFiles(
    FRONTEND_ENTRYPOINTS.filter((entryPath) => fileIndex.has(entryPath)),
    frontendGraph.edges,
  );
  const baseNodes = buildFileNodes({
    repoRoot,
    fileInventory,
    fileChurn,
    governanceRules,
    knipSignals,
    legacyOverlays,
    reachableFrontendPaths: frontendReachable,
  });
  const edges = dedupeEdges([...frontendGraph.edges, ...rustGraph.edges]);
  const nodes = finalizeNodeSignals(baseNodes, edges, governanceRules);
  const dirNodes = buildDirectoryNodes(nodes);
  const allNodes = [...dirNodes, ...nodes];
  const signalsSummary = summarizeSignals(nodes);
  const summary = buildSummary(nodes, edges, signalsSummary);
  const links = {
    selfHtmlHref: pathToFileURL(path.join(outputDir, "governance-graph.html"))
      .href,
    selfJsonHref: pathToFileURL(path.join(outputDir, "governance-graph.json"))
      .href,
    heatmapHtmlHref: fs.existsSync(path.join(outputDir, "index.html"))
      ? pathToFileURL(path.join(outputDir, "index.html")).href
      : "",
  };

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: normalizePath(repoRoot),
    rulesPath: normalizePath(path.relative(repoRoot, rulesPath)),
    knipConfigPath: normalizePath(path.relative(repoRoot, knipConfigPath)),
    summary,
    signalsSummary,
    nodes: allNodes,
    edges,
    links,
  };
}

function resolveRepoRoot(targetPath) {
  const gitCommand = process.platform === "win32" ? "git.exe" : "git";

  try {
    const output = execFileSync(
      gitCommand,
      ["-C", targetPath, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();

    if (output) {
      return path.resolve(output);
    }
  } catch {
    return targetPath;
  }

  return targetPath;
}

function collectGovernanceFiles(repoRoot) {
  const records = [];
  const roots = ["src", "src-tauri/src"];

  for (const root of roots) {
    const absoluteRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    walkDirectory(absoluteRoot, repoRoot, (absolutePath) => {
      const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
      const isCodePath =
        isFrontendCodePath(relativePath) || isRustCodePath(relativePath);
      if (!isCodePath || isTestLikePath(relativePath)) {
        return;
      }

      const ext = path.extname(relativePath).toLowerCase();
      const language = ext === ".rs" ? "rs" : ext.replace(/^\./, "");
      const layer = relativePath.startsWith("src-tauri/src/")
        ? "rust"
        : "frontend";

      records.push({
        path: relativePath,
        kind: isPagePath(relativePath) ? "page" : "file",
        layer,
        language,
        loc: countLinesSafely(absolutePath),
      });
    });
  }

  return records.sort((left, right) => left.path.localeCompare(right.path));
}

function walkDirectory(currentDir, repoRoot, onFile) {
  const dirEntries = fs
    .readdirSync(currentDir, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of dirEntries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = normalizePath(path.relative(repoRoot, absolutePath));

    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name, relativePath)) {
        continue;
      }
      walkDirectory(absolutePath, repoRoot, onFile);
      continue;
    }

    if (entry.isFile()) {
      onFile(absolutePath);
    }
  }
}

function shouldIgnoreDirectory(entryName, relativePath) {
  if (IGNORED_DIRECTORIES.has(entryName)) {
    return true;
  }

  return relativePath
    .split("/")
    .filter(Boolean)
    .some((segment) => IGNORED_DIRECTORIES.has(segment));
}

function countLinesSafely(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    if (!content) {
      return 0;
    }
    return content.split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

function collectGitChurn({ gitCommand, repoRoot, sinceDays, trackedFiles }) {
  const fileChurn = new Map();

  let output = "";

  try {
    output = execFileSync(
      gitCommand,
      [
        "-C",
        repoRoot,
        "log",
        `--since=${sinceDays}.days`,
        "--numstat",
        "--date=short",
        "--format=format:@@@%cs",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return fileChurn;
  }

  let currentDate = "";

  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    if (line.startsWith("@@@")) {
      currentDate = line.slice(3).trim();
      continue;
    }

    const parts = line.split("\t");
    if (parts.length !== 3 || !currentDate) {
      continue;
    }

    const [added, deleted, rawPath] = parts;
    if (added === "-" || deleted === "-") {
      continue;
    }

    const normalizedGitPath = normalizeGitPath(rawPath);
    if (!trackedFiles.has(normalizedGitPath)) {
      continue;
    }

    const churn = Number.parseInt(added, 10) + Number.parseInt(deleted, 10);
    if (!Number.isFinite(churn) || churn <= 0) {
      continue;
    }

    fileChurn.set(
      normalizedGitPath,
      (fileChurn.get(normalizedGitPath) || 0) + churn,
    );
  }

  return fileChurn;
}

function normalizeGitPath(rawPath) {
  let normalized = rawPath.trim().replaceAll("\\", "/");

  if (!normalized.includes("=>")) {
    return normalized;
  }

  normalized = normalized.replace(
    /\{([^{}]+)\s=>\s([^{}]+)\}/g,
    (_match, _before, after) => after,
  );

  if (normalized.includes("=>")) {
    const parts = normalized.split("=>");
    normalized = parts[parts.length - 1].trim();
  }

  return normalized.replaceAll("//", "/");
}

async function collectFrontendDependencies(repoRoot, fileIndex) {
  const cruiseResult = await cruise(
    ["src"],
    {
      includeOnly: "^src",
      exclude: "(^|/)(node_modules|dist|coverage)(/|$)",
    },
    undefined,
    {
      tsConfig: extractTSConfig(path.join(repoRoot, "tsconfig.json")),
    },
  );
  const edges = [];

  for (const moduleRecord of cruiseResult.output.modules ?? []) {
    const sourcePath = normalizePath(moduleRecord.source || "");
    if (!fileIndex.has(sourcePath)) {
      continue;
    }

    for (const dependency of moduleRecord.dependencies ?? []) {
      const targetPath = normalizePath(dependency.resolved || "");
      if (
        !targetPath ||
        dependency.couldNotResolve ||
        !fileIndex.has(targetPath) ||
        targetPath === sourcePath
      ) {
        continue;
      }

      edges.push({
        id: `import:${sourcePath}->${targetPath}`,
        source: sourcePath,
        target: targetPath,
        kind: "import",
      });
    }
  }

  return { edges };
}

function collectRustDependencies(repoRoot, fileInventory, fileIndex) {
  const rustFiles = fileInventory.filter(
    (fileRecord) => fileRecord.layer === "rust",
  );
  const rustFileSet = new Set(rustFiles.map((fileRecord) => fileRecord.path));
  const moduleIndex = buildRustModuleIndex([...rustFileSet]);
  const edges = [];

  for (const fileRecord of rustFiles) {
    const absolutePath = path.join(repoRoot, fileRecord.path);
    const sourceCode = fs.readFileSync(absolutePath, "utf8");
    const currentModulePath =
      buildRustModulePathFromFile(fileRecord.path) || "";

    for (const moduleName of extractRustModDeclarations(sourceCode)) {
      const targetPath = resolveRustSubmodulePath(
        repoRoot,
        fileRecord.path,
        moduleName,
      );
      if (!targetPath || !fileIndex.has(targetPath)) {
        continue;
      }
      edges.push({
        id: `rust_mod:${fileRecord.path}->${targetPath}`,
        source: fileRecord.path,
        target: targetPath,
        kind: "rust_mod",
      });
    }

    for (const statement of extractRustUseStatements(sourceCode)) {
      for (const usePath of expandRustUseTree(statement)) {
        const targetPath = resolveRustUseToFile(
          moduleIndex,
          currentModulePath,
          usePath,
        );

        if (!targetPath || targetPath === fileRecord.path) {
          continue;
        }

        edges.push({
          id: `rust_use:${fileRecord.path}->${targetPath}:${usePath}`,
          source: fileRecord.path,
          target: targetPath,
          kind: "rust_use",
        });
      }
    }
  }

  return { edges };
}

function extractRustModDeclarations(sourceCode) {
  const matches = sourceCode.matchAll(
    /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/g,
  );
  return [...matches].map((match) => match[1]);
}

function extractRustUseStatements(sourceCode) {
  const matches = sourceCode.matchAll(
    /(?:^|\n)\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\s\S]*?);/g,
  );
  return [...matches].map((match) => `use ${String(match[1]).trim()};`);
}

function resolveRustSubmodulePath(repoRoot, relativePath, moduleName) {
  const normalizedPath = normalizePath(relativePath);
  const fileName = path.posix.basename(normalizedPath);
  const dirName = path.posix.dirname(normalizedPath);
  const moduleFolder =
    fileName === "mod.rs" || fileName === "main.rs" || fileName === "lib.rs"
      ? dirName
      : path.posix.join(dirName, fileName.replace(/\.rs$/u, ""));

  const directCandidate = path.posix.join(moduleFolder, `${moduleName}.rs`);
  if (fs.existsSync(path.join(repoRoot, directCandidate))) {
    return normalizePath(directCandidate);
  }

  const nestedCandidate = path.posix.join(moduleFolder, moduleName, "mod.rs");
  if (fs.existsSync(path.join(repoRoot, nestedCandidate))) {
    return normalizePath(nestedCandidate);
  }

  return null;
}

function loadGovernanceRules(rulesPath) {
  if (!fs.existsSync(rulesPath)) {
    return [];
  }

  const document = YAML.parse(fs.readFileSync(rulesPath, "utf8")) || {};
  const rules = document.rules || [];
  validateGovernanceRules(rules);
  return rules;
}

function collectKnipSignals(repoRoot, knipConfigPath) {
  if (!fs.existsSync(knipConfigPath)) {
    return {
      unusedFiles: new Set(),
      unusedExportsByFile: new Map(),
    };
  }

  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const output = execFileSync(
    npxCommand,
    [
      "--no-install",
      "knip",
      "--config",
      knipConfigPath,
      "--reporter",
      "json",
      "--include",
      "files,exports",
      "--no-exit-code",
      "--directory",
      repoRoot,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );

  const parsed = JSON.parse(output);
  const unusedFiles = new Set();
  const unusedExportsByFile = new Map();

  for (const issue of parsed.issues ?? []) {
    for (const fileIssue of issue.files ?? []) {
      const filePath = normalizePath(fileIssue.name);
      if (isFrontendCodePath(filePath)) {
        unusedFiles.add(filePath);
      }
    }

    if ((issue.exports ?? []).length > 0) {
      const filePath = normalizePath(issue.file);
      if (!isFrontendCodePath(filePath)) {
        continue;
      }

      const exportNames = (unusedExportsByFile.get(filePath) ?? []).concat(
        issue.exports.map((item) => item.name),
      );
      unusedExportsByFile.set(filePath, exportNames);
    }
  }

  return {
    unusedFiles,
    unusedExportsByFile,
  };
}

function buildLegacyOverlays(legacyReport) {
  const surfaceOverlays = new Map();
  const callsiteOverlays = new Map();

  for (const result of legacyReport.importResults) {
    for (const targetPath of result.existingTargets) {
      pushOverlay(surfaceOverlays, targetPath, {
        source: "legacy-report",
        overlayType: "surface",
        monitorId: result.id,
        classification: result.classification,
        description: result.description,
        statusHint: mapLegacyClassificationToStatus(result.classification),
      });
    }
  }

  for (const result of legacyReport.commandResults) {
    for (const references of result.referencesByCommand.values()) {
      for (const callerPath of references) {
        pushOverlay(callsiteOverlays, callerPath, {
          source: "legacy-report",
          overlayType: "callsite",
          monitorId: result.id,
          classification: result.classification,
          description: result.description,
        });
      }
    }
  }

  for (const result of [
    ...legacyReport.frontendTextResults,
    ...legacyReport.rustTextResults,
  ]) {
    for (const callerPath of result.references) {
      pushOverlay(callsiteOverlays, callerPath, {
        source: "legacy-report",
        overlayType: "callsite",
        monitorId: result.id,
        classification: result.classification,
        description: result.description,
      });
    }
  }

  for (const result of legacyReport.rustTextCountResults) {
    for (const callerPath of result.runtimeMatches.map(
      (item) => item.relativePath,
    )) {
      pushOverlay(callsiteOverlays, callerPath, {
        source: "legacy-report",
        overlayType: "callsite",
        monitorId: result.id,
        classification: result.classification,
        description: result.description,
      });
    }
  }

  return {
    surfaceOverlays,
    callsiteOverlays,
  };
}

function pushOverlay(bucket, targetPath, overlay) {
  const normalizedPath = normalizePath(targetPath);
  const existing = bucket.get(normalizedPath) ?? [];
  existing.push(overlay);
  bucket.set(normalizedPath, existing);
}

function mapLegacyClassificationToStatus(classification) {
  if (classification === "compat" || classification === "deprecated") {
    return classification;
  }
  return null;
}

function buildFileNodes({
  repoRoot,
  fileInventory,
  fileChurn,
  governanceRules,
  knipSignals,
  legacyOverlays,
  reachableFrontendPaths,
}) {
  const nodes = [];

  for (const fileRecord of fileInventory) {
    const matchingRule = resolveMatchingGovernanceRule(
      fileRecord.path,
      governanceRules,
    );
    const surfaceOverlays =
      legacyOverlays.surfaceOverlays.get(fileRecord.path) ?? [];
    const callsiteOverlays =
      legacyOverlays.callsiteOverlays.get(fileRecord.path) ?? [];
    const explicitStatus = matchingRule?.status ?? "unclassified";
    const overlayStatus = pickOverlayStatus(surfaceOverlays);
    const status =
      explicitStatus !== "unclassified" ? explicitStatus : overlayStatus;
    const ruleSource = matchingRule
      ? {
          reason: matchingRule.reason || "",
          sourceOfTruth: matchingRule.sourceOfTruth || "",
          exitCriteria: matchingRule.exitCriteria || "",
          ignoreSignals: matchingRule.ignoreSignals || [],
        }
      : null;
    const overlayReason = surfaceOverlays[0]?.description || "";
    const signals = new Set();

    if (knipSignals.unusedFiles.has(fileRecord.path)) {
      signals.add("unused-file");
    }

    if (
      (knipSignals.unusedExportsByFile.get(fileRecord.path) ?? []).length > 0
    ) {
      signals.add("unused-export");
    }

    if (
      surfaceOverlays.some(
        (overlay) => overlay.classification === "dead-candidate",
      )
    ) {
      signals.add("dead-candidate");
    }

    if (callsiteOverlays.length > 0) {
      signals.add("legacy-callsite");
    }

    const node = {
      id: fileRecord.path,
      label: path.posix.basename(fileRecord.path),
      path: fileRecord.path,
      kind: fileRecord.kind,
      layer: fileRecord.layer,
      language: fileRecord.language,
      status,
      loc: fileRecord.loc,
      churn: fileChurn.get(fileRecord.path) || 0,
      size: calculateNodeSize(fileRecord.loc),
      href: pathToFileURL(path.join(repoRoot, fileRecord.path)).href,
      parent: createParentDirectoryId(fileRecord.path),
      reason: ruleSource?.reason || overlayReason,
      sourceOfTruth: ruleSource?.sourceOfTruth || "",
      exitCriteria: ruleSource?.exitCriteria || "",
      ignoredSignals: ruleSource?.ignoreSignals || [],
      overlays: [...surfaceOverlays, ...callsiteOverlays],
      signals: [...signals].sort(),
      reachable:
        fileRecord.layer === "frontend"
          ? reachableFrontendPaths.has(fileRecord.path)
          : true,
    };

    nodes.push(node);
  }

  return nodes;
}

function finalizeNodeSignals(nodes, edges, governanceRules) {
  const fileNodesByPath = new Map(nodes.map((node) => [node.path, node]));
  const indegree = new Map();

  for (const edge of edges) {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
  }

  const inboundIndex = buildInboundIndex(edges);

  return nodes.map((node) => {
    const signals = new Set(node.signals);

    if (!node.reachable && node.kind === "page" && node.layer === "frontend") {
      signals.add("page-unreachable");
    }

    if (
      (indegree.get(node.path) || 0) === 0 &&
      !isProtectedEntryNode(node, governanceRules)
    ) {
      signals.add("zero-inbound");
    }

    const inbound = inboundIndex.get(node.path) ?? [];
    if (
      inbound.length > 0 &&
      inbound.every((sourcePath) => {
        const sourceNode = fileNodesByPath.get(sourcePath);
        return (
          sourceNode &&
          ["compat", "deprecated", "dead"].includes(sourceNode.status)
        );
      })
    ) {
      signals.add("legacy-only-incoming");
    }

    for (const ignoredSignal of node.ignoredSignals || []) {
      signals.delete(ignoredSignal);
    }

    return {
      ...node,
      signals: [...signals].sort(),
      candidateScore: calculateCandidateScore({
        ...node,
        signals: [...signals],
      }),
    };
  });
}

function pickOverlayStatus(surfaceOverlays) {
  const candidates = surfaceOverlays
    .map((overlay) => overlay.statusHint || "unclassified")
    .filter((status) => status !== "unclassified");

  if (candidates.length === 0) {
    return "unclassified";
  }

  return candidates.sort(
    (left, right) =>
      (STATUS_PRIORITY.get(right) || 0) - (STATUS_PRIORITY.get(left) || 0),
  )[0];
}

function calculateNodeSize(loc) {
  return Math.max(
    26,
    Math.min(86, Math.round(18 + Math.sqrt(Math.max(loc, 1)))),
  );
}

function createParentDirectoryId(relativePath) {
  const dirPath = path.posix.dirname(relativePath);
  if (!dirPath || dirPath === ".") {
    return "";
  }
  return createDirNodeId(dirPath);
}

function buildDirectoryNodes(fileNodes) {
  const dirMap = new Map();

  for (const node of fileNodes) {
    const dirPath = path.posix.dirname(node.path);
    if (!dirPath || dirPath === ".") {
      continue;
    }

    const segments = dirPath.split("/").filter(Boolean);
    for (let length = 1; length <= segments.length; length += 1) {
      const currentPath = segments.slice(0, length).join("/");
      if (dirMap.has(currentPath)) {
        continue;
      }
      dirMap.set(currentPath, {
        id: createDirNodeId(currentPath),
        label: segments[length - 1],
        path: currentPath,
        kind: "dir",
        layer: currentPath.startsWith("src-tauri/") ? "rust" : "frontend",
        parent:
          length > 1
            ? createDirNodeId(segments.slice(0, length - 1).join("/"))
            : "",
      });
    }
  }

  return [...dirMap.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function collectReachableFiles(entryPaths, edges) {
  const adjacency = new Map();
  const queue = [...entryPaths];
  const visited = new Set(entryPaths);

  for (const edge of edges) {
    const currentTargets = adjacency.get(edge.source) ?? [];
    currentTargets.push(edge.target);
    adjacency.set(edge.source, currentTargets);
  }

  while (queue.length > 0) {
    const currentPath = queue.shift();
    for (const nextPath of adjacency.get(currentPath) ?? []) {
      if (visited.has(nextPath)) {
        continue;
      }
      visited.add(nextPath);
      queue.push(nextPath);
    }
  }

  return visited;
}

function dedupeEdges(edges) {
  const edgeMap = new Map();
  for (const edge of edges) {
    const key = `${edge.kind}:${edge.source}->${edge.target}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        ...edge,
        id: key,
      });
    }
  }
  return [...edgeMap.values()];
}

function buildInboundIndex(edges) {
  const inboundIndex = new Map();
  for (const edge of edges) {
    const entries = inboundIndex.get(edge.target) ?? [];
    entries.push(edge.source);
    inboundIndex.set(edge.target, entries);
  }
  return inboundIndex;
}

function isProtectedEntryNode(node, governanceRules) {
  if (node.status === "current") {
    return true;
  }

  if (FRONTEND_ENTRYPOINTS.includes(node.path)) {
    return true;
  }

  if (/(?:^|\/)(main|lib)\.rs$/u.test(node.path)) {
    return true;
  }

  return (
    resolveMatchingGovernanceRule(node.path, governanceRules)?.status ===
    "current"
  );
}

function calculateCandidateScore(node) {
  let score = 0;

  for (const signal of node.signals) {
    if (signal === "unused-file") {
      score += 5;
    } else if (signal === "page-unreachable") {
      score += 5;
    } else if (signal === "dead-candidate") {
      score += 4;
    } else if (signal === "zero-inbound") {
      score += 2;
    } else if (signal === "legacy-only-incoming") {
      score += 2;
    } else if (signal === "unused-export") {
      score += 1;
    } else if (signal === "legacy-callsite") {
      score += 1;
    }
  }

  return score;
}

function summarizeSignals(nodes) {
  const counts = new Map();
  for (const node of nodes) {
    for (const signal of node.signals) {
      counts.set(signal, (counts.get(signal) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([signal, count]) => ({ signal, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.signal.localeCompare(right.signal),
    );
}

function buildSummary(nodes, edges, signalsSummary) {
  const fileNodes = nodes.filter((node) => node.kind !== "dir");
  const statusCounts = Object.fromEntries(
    ["current", "compat", "deprecated", "dead", "unclassified"].map(
      (status) => [
        status,
        fileNodes.filter((node) => node.status === status).length,
      ],
    ),
  );
  const layerCounts = Object.fromEntries(
    ["frontend", "rust"].map((layer) => [
      layer,
      fileNodes.filter((node) => node.layer === layer).length,
    ]),
  );
  const topCandidates = fileNodes
    .filter((node) => node.candidateScore > 0)
    .sort(
      (left, right) =>
        right.candidateScore - left.candidateScore ||
        right.churn - left.churn ||
        left.path.localeCompare(right.path),
    )
    .slice(0, 20)
    .map((node) => ({
      path: node.path,
      status: node.status,
      candidateScore: node.candidateScore,
      signals: node.signals,
      churn: node.churn,
    }));

  return {
    nodeCount: fileNodes.length,
    edgeCount: edges.length,
    pageCount: fileNodes.filter((node) => node.kind === "page").length,
    statusCounts,
    layerCounts,
    topCandidates,
    signalsSummary,
  };
}

function renderHtml(report) {
  const payload = serializeForHtml(report);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Lime 治理图谱</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5f8f7;
        --panel: #ffffff;
        --panel-muted: #f4f7f6;
        --border: #d6e2de;
        --text: #11302e;
        --subtle: #5d7671;
        --current: #16a34a;
        --compat: #2563eb;
        --deprecated: #f59e0b;
        --dead: #dc2626;
        --unclassified: #6b7280;
        --highlight: #7c3aed;
        --shadow: 0 16px 48px rgba(17, 48, 46, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family:
          "SF Pro Text",
          "PingFang SC",
          "Microsoft YaHei",
          sans-serif;
        background: var(--bg);
        color: var(--text);
      }

      a {
        color: #0f766e;
      }

      .page {
        display: grid;
        grid-template-rows: auto auto 1fr;
        min-height: 100vh;
        gap: 16px;
        padding: 20px;
      }

      .hero,
      .toolbar,
      .layout,
      .card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        box-shadow: var(--shadow);
      }

      .hero {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        padding: 20px 24px;
      }

      .hero h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }

      .hero p {
        margin: 0;
        color: var(--subtle);
        line-height: 1.6;
      }

      .hero-links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-content: flex-start;
      }

      .hero-links a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 140px;
        height: 38px;
        padding: 0 14px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: var(--panel-muted);
        text-decoration: none;
        color: var(--text);
      }

      .toolbar {
        display: grid;
        grid-template-columns: 2fr repeat(4, minmax(120px, 1fr)) auto auto;
        gap: 12px;
        padding: 16px;
        align-items: center;
      }

      .toolbar label {
        display: grid;
        gap: 6px;
        font-size: 12px;
        color: var(--subtle);
      }

      .toolbar input,
      .toolbar select,
      .toolbar button {
        height: 40px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: #fff;
        color: var(--text);
        padding: 0 12px;
        font: inherit;
      }

      .toolbar button {
        cursor: pointer;
        background: var(--panel-muted);
      }

      .layout {
        display: grid;
        grid-template-columns: 260px minmax(0, 920px) 320px;
        justify-content: center;
        align-items: start;
        gap: 16px;
        padding: 16px;
        min-height: 0;
      }

      .sidebar,
      .inspector {
        display: grid;
        gap: 16px;
        align-content: start;
      }

      .sidebar {
        position: sticky;
        top: 20px;
      }

      .card {
        padding: 16px;
      }

      .card h2,
      .card h3 {
        margin: 0 0 12px;
        font-size: 15px;
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }

      .stat {
        padding: 12px;
        border-radius: 14px;
        background: var(--panel-muted);
        border: 1px solid #e4ece9;
      }

      .stat strong {
        display: block;
        font-size: 22px;
        margin-bottom: 4px;
      }

      .legend {
        display: grid;
        gap: 8px;
      }

      .legend-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--subtle);
        font-size: 13px;
      }

      .swatch {
        width: 12px;
        height: 12px;
        border-radius: 999px;
        display: inline-block;
      }

      .candidate-list,
      .signal-list,
      .detail-list,
      .overlay-list {
        display: grid;
        gap: 8px;
      }

      .candidate-item,
      .signal-item,
      .detail-item,
      .overlay-item {
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 10px 12px;
        background: var(--panel-muted);
      }

      .candidate-item button {
        width: 100%;
        display: grid;
        gap: 6px;
        text-align: left;
        border: none;
        background: transparent;
        color: inherit;
        padding: 0;
        cursor: pointer;
      }

      .candidate-item button.is-selected strong {
        color: var(--highlight);
      }

      .candidate-path,
      .detail-item code,
      .overlay-item code {
        font-family:
          "SFMono-Regular",
          "JetBrains Mono",
          "Consolas",
          monospace;
        font-size: 12px;
        word-break: break-all;
      }

      .ascii-panel {
        display: grid;
        grid-template-rows: auto auto;
        gap: 12px;
        align-content: start;
        justify-items: start;
      }

      .ascii-header {
        max-width: 760px;
      }

      .ascii-header p {
        margin: 6px 0 0;
        color: var(--subtle);
        font-size: 12px;
        line-height: 1.6;
      }

      .batch-panel {
        width: min(100%, 760px);
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .batch-group {
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 12px;
        background: var(--panel-muted);
      }

      .batch-group h3 {
        margin: 0 0 6px;
        font-size: 14px;
      }

      .batch-group p {
        margin: 0;
        color: var(--subtle);
        font-size: 12px;
        line-height: 1.6;
      }

      .batch-meta {
        margin-top: 8px;
        color: var(--subtle);
        font-size: 12px;
      }

      .batch-list {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }

      .batch-item {
        width: 100%;
        text-align: left;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: #fff;
        color: inherit;
        padding: 10px 12px;
        cursor: pointer;
      }

      .batch-item.is-selected {
        border-color: var(--highlight);
        box-shadow: inset 0 0 0 1px rgba(124, 58, 237, 0.18);
      }

      .batch-item strong {
        display: block;
        margin-bottom: 4px;
      }

      .batch-empty {
        width: min(100%, 760px);
        border: 1px dashed var(--border);
        border-radius: 16px;
        padding: 14px 16px;
        color: var(--subtle);
        background: var(--panel-muted);
        line-height: 1.6;
      }

      #graph {
        margin: 0;
        display: inline-block;
        width: fit-content;
        min-width: min(100%, 560px);
        max-width: 100%;
        min-height: 0;
        max-height: min(72vh, 760px);
        padding: 16px 18px;
        border-radius: 16px;
        border: 1px solid var(--border);
        background:
          linear-gradient(180deg, rgba(14, 116, 144, 0.04), transparent 28%),
          #fbfdfc;
        color: var(--text);
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.7;
        font-family:
          "SFMono-Regular",
          "JetBrains Mono",
          "Consolas",
          monospace;
        font-size: 12px;
      }

      .inspector-empty {
        color: var(--subtle);
        line-height: 1.6;
      }

      .status-pill,
      .signal-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 26px;
        padding: 0 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: #fff;
        font-size: 12px;
        color: var(--text);
      }

      .pill-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .footer-note {
        color: var(--subtle);
        font-size: 12px;
        line-height: 1.6;
      }

      @media (max-width: 1440px) {
        .layout {
          grid-template-columns: 240px minmax(0, 1fr);
        }

        .inspector {
          grid-column: 2;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .sidebar {
          position: static;
        }
      }

      @media (max-width: 960px) {
        .hero,
        .toolbar,
        .layout,
        .inspector {
          display: grid;
          grid-template-columns: 1fr;
        }

        #graph {
          min-width: 100%;
        }

        .batch-panel {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="hero">
        <div>
          <h1>Lime 治理图谱</h1>
          <p>
            文件 / 页面级依赖图 + 治理标签 + 疑似失效信号。状态只来自
            <code>governance/surfaces.yml</code> 与现有治理规则；自动脚本只补 signals 与 overlay。
          </p>
        </div>
        <div class="hero-links">
          <a href="${escapeAttribute(report.links.selfJsonHref)}">打开 JSON</a>
          ${
            report.links.heatmapHtmlHref
              ? `<a href="${escapeAttribute(report.links.heatmapHtmlHref)}">打开同目录热力图</a>`
              : ""
          }
        </div>
      </section>

      <section class="toolbar">
        <label>
          搜索路径 / 文件名
          <input id="search-input" type="search" placeholder="例如 src/components/agent" />
        </label>
        <label>
          状态
          <select id="status-filter">
            <option value="all">全部状态</option>
            <option value="current">current</option>
            <option value="compat">compat</option>
            <option value="deprecated">deprecated</option>
            <option value="dead">dead</option>
            <option value="unclassified">unclassified</option>
          </select>
        </label>
        <label>
          分层
          <select id="layer-filter">
            <option value="all">全部层</option>
            <option value="frontend">frontend</option>
            <option value="rust">rust</option>
          </select>
        </label>
        <label>
          信号
          <select id="signal-filter">
            <option value="all">全部信号</option>
          </select>
        </label>
        <label>
          候选
          <select id="candidate-filter">
            <option value="all">全部节点</option>
            <option value="only-candidates">仅疑似失效候选</option>
          </select>
        </label>
        <button id="relayout-button" type="button">聚焦候选</button>
        <button id="clear-selection-button" type="button">仅看摘要</button>
      </section>

      <section class="layout">
        <aside class="sidebar">
          <div class="card">
            <h2>摘要</h2>
            <div id="stats-grid" class="stats-grid"></div>
          </div>

          <div class="card">
            <h2>状态图例</h2>
            <div class="legend">
              <div class="legend-row"><span class="swatch" style="background: var(--current)"></span> current</div>
              <div class="legend-row"><span class="swatch" style="background: var(--compat)"></span> compat</div>
              <div class="legend-row"><span class="swatch" style="background: var(--deprecated)"></span> deprecated</div>
              <div class="legend-row"><span class="swatch" style="background: var(--dead)"></span> dead</div>
              <div class="legend-row"><span class="swatch" style="background: var(--unclassified)"></span> unclassified</div>
            </div>
          </div>

          <div class="card">
            <h2>Top 候选</h2>
            <div id="candidate-list" class="candidate-list"></div>
          </div>

          <div class="card">
            <h2>Signals</h2>
            <div id="signal-list" class="signal-list"></div>
          </div>
        </aside>

        <main class="card ascii-panel">
          <div class="ascii-header">
            <h2>ASCII 视图</h2>
            <p>默认先看治理总览与批量治理工作台；点击任意候选后，再看单节点的上游 / 当前 / 下游。</p>
          </div>
          <div id="batch-panel"></div>
          <pre id="graph"></pre>
        </main>

        <aside class="inspector">
          <div class="card">
            <h2>节点详情</h2>
            <div id="inspector-panel" class="inspector-empty">点击左侧候选后在这里查看路径、标签、信号、治理理由和 legacy overlay。</div>
          </div>

          <div class="card">
            <h2>说明</h2>
            <div class="footer-note">
              - <code>dead</code> 只会来自人工治理规则，不会由自动脚本直接判定。<br />
              - <code>dead-candidate</code>、<code>unused-file</code>、<code>zero-inbound</code> 等仅表示疑似失效信号。<br />
              - 中间主视图改为 ASCII 邻接视图，避免大图缩到不可读。
            </div>
          </div>
        </aside>
      </section>
    </div>

    <script>
      const GOVERNANCE_REPORT = ${payload};
      const fileNodes = GOVERNANCE_REPORT.nodes.filter((node) => node.kind !== "dir");
      const fileNodeMap = new Map(fileNodes.map((node) => [node.id, node]));
      const edgeList = GOVERNANCE_REPORT.edges.filter(
        (edge) => fileNodeMap.has(edge.source) && fileNodeMap.has(edge.target),
      );
      const inboundIndex = new Map();
      const outboundIndex = new Map();
      const signalOptions = new Set();

      for (const node of fileNodes) {
        for (const signal of node.signals) {
          signalOptions.add(signal);
        }
      }

      for (const edge of edgeList) {
        pushIndex(outboundIndex, edge.source, edge.target);
        pushIndex(inboundIndex, edge.target, edge.source);
      }

      const controls = {
        search: document.getElementById("search-input"),
        status: document.getElementById("status-filter"),
        layer: document.getElementById("layer-filter"),
        signal: document.getElementById("signal-filter"),
        candidates: document.getElementById("candidate-filter"),
      };

      const graphPanel = document.getElementById("graph");
      const batchPanel = document.getElementById("batch-panel");
      const inspectorPanel = document.getElementById("inspector-panel");
      const statsGrid = document.getElementById("stats-grid");
      const candidateList = document.getElementById("candidate-list");
      const signalList = document.getElementById("signal-list");
      const viewState = {
        hasAppliedInitialFocus: false,
        selectedNodeId: "",
        pinnedOverview: true,
        visibleNodeIds: new Set(fileNodes.map((node) => node.id)),
      };

      for (const signal of Array.from(signalOptions).sort()) {
        const option = document.createElement("option");
        option.value = signal;
        option.textContent = signal;
        controls.signal.appendChild(option);
      }

      document
        .getElementById("relayout-button")
        .addEventListener("click", () => {
          viewState.selectedNodeId = "";
          viewState.pinnedOverview = false;
          viewState.hasAppliedInitialFocus = false;
          focusDefaultVisibleNode({ force: true });
        });

      document
        .getElementById("clear-selection-button")
        .addEventListener("click", () => {
          clearSelection();
        });

      Object.values(controls).forEach((element) => {
        element.addEventListener("input", applyFilters);
        element.addEventListener("change", applyFilters);
      });

      applyFilters();

      function pushIndex(index, key, value) {
        const nextValues = index.get(key) ?? [];
        nextValues.push(value);
        index.set(key, nextValues);
      }

      function applyFilters() {
        const query = controls.search.value.trim().toLowerCase();
        const status = controls.status.value;
        const layer = controls.layer.value;
        const signal = controls.signal.value;
        const candidatesOnly = controls.candidates.value === "only-candidates";
        const visibleNodeIds = new Set();

        for (const node of fileNodes) {
          const matchesQuery =
            !query ||
            node.path.toLowerCase().includes(query) ||
            node.label.toLowerCase().includes(query);
          const matchesStatus = status === "all" || node.status === status;
          const matchesLayer = layer === "all" || node.layer === layer;
          const matchesSignal =
            signal === "all" || (node.signals || []).includes(signal);
          const matchesCandidate = !candidatesOnly || (node.candidateScore || 0) > 0;

          if (
            matchesQuery &&
            matchesStatus &&
            matchesLayer &&
            matchesSignal &&
            matchesCandidate
          ) {
            visibleNodeIds.add(node.id);
          }
        }

        viewState.visibleNodeIds = visibleNodeIds;
        renderStats();
        renderCandidates();
        renderBatchWorkbench();
        renderSignals();
        restoreVisibleSelection();
      }

      function renderStats() {
        const visibleFiles = getVisibleFileNodes();
        const cards = [
          ["可见节点", String(visibleFiles.length)],
          ["可见页面", String(visibleFiles.filter((node) => node.kind === "page").length)],
          [
            "疑似候选",
            String(visibleFiles.filter((node) => (node.candidateScore || 0) > 0).length),
          ],
          ["可见边", String(getVisibleEdgeCount())],
        ];

        statsGrid.innerHTML = cards
          .map(
            ([label, value]) => \`<div class="stat"><strong>\${escapeHtml(
              value,
            )}</strong><span>\${escapeHtml(label)}</span></div>\`,
          )
          .join("");
      }

      function renderCandidates() {
        const visibleCandidates = getVisibleFileNodes()
          .filter((node) => (node.candidateScore || 0) > 0)
          .sort(compareNodesForPriority)
          .slice(0, 16);

        if (visibleCandidates.length === 0) {
          candidateList.innerHTML =
            '<div class="inspector-empty">当前筛选下没有疑似失效候选。</div>';
          return;
        }

        candidateList.innerHTML = visibleCandidates
          .map((node) => {
            const isSelected = node.id === viewState.selectedNodeId && !viewState.pinnedOverview;
            return \`
              <div class="candidate-item">
                <button
                  type="button"
                  class="\${isSelected ? "is-selected" : ""}"
                  data-node-id="\${escapeAttribute(node.id)}"
                >
                  <strong>\${escapeHtml(node.label)}</strong>
                  <div class="candidate-path">\${escapeHtml(node.path)}</div>
                  <div>score=\${escapeHtml(String(node.candidateScore || 0))} · \${escapeHtml(
                    (node.signals || []).join(", ") || "无 signal",
                  )}</div>
                </button>
              </div>
            \`;
          })
          .join("");

        candidateList.querySelectorAll("button[data-node-id]").forEach((button) => {
          button.addEventListener("click", () => {
            selectNode(button.getAttribute("data-node-id"));
          });
        });
      }

      function renderSignals() {
        const visibleCounts = new Map();

        for (const node of getVisibleFileNodes()) {
          for (const signal of node.signals) {
            visibleCounts.set(signal, (visibleCounts.get(signal) || 0) + 1);
          }
        }

        const rows = Array.from(visibleCounts.entries())
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

        signalList.innerHTML = rows.length
          ? rows
              .map(
                ([signal, count]) =>
                  \`<div class="signal-item"><strong>\${escapeHtml(
                    signal,
                  )}</strong><div>\${escapeHtml(String(count))} 个节点</div></div>\`,
              )
              .join("")
          : '<div class="inspector-empty">当前筛选下没有 signal。</div>';
      }

      function getVisibleFileNodes() {
        return fileNodes.filter((node) => viewState.visibleNodeIds.has(node.id));
      }

      function getVisibleEdgeCount() {
        let count = 0;
        for (const edge of edgeList) {
          if (
            viewState.visibleNodeIds.has(edge.source) &&
            viewState.visibleNodeIds.has(edge.target)
          ) {
            count += 1;
          }
        }
        return count;
      }

      function getStatusRank(status) {
        if (status === "dead") {
          return 4;
        }
        if (status === "deprecated") {
          return 3;
        }
        if (status === "compat") {
          return 2;
        }
        if (status === "current") {
          return 1;
        }
        return 0;
      }

      function compareNodesForPriority(left, right) {
        return (
          Number((right.candidateScore || 0) > 0) -
            Number((left.candidateScore || 0) > 0) ||
          (right.candidateScore || 0) - (left.candidateScore || 0) ||
          getStatusRank(right.status) - getStatusRank(left.status) ||
          Number(right.kind === "page") - Number(left.kind === "page") ||
          (right.churn || 0) - (left.churn || 0) ||
          left.path.localeCompare(right.path)
        );
      }

      function pickDefaultVisibleNode() {
        const visibleNodes = getVisibleFileNodes();
        if (visibleNodes.length === 0) {
          return null;
        }

        return [...visibleNodes].sort(compareNodesForPriority)[0];
      }

      function focusDefaultVisibleNode(options = {}) {
        const { force = false } = options;
        if (!force && viewState.selectedNodeId && fileNodeMap.has(viewState.selectedNodeId)) {
          const currentNode = fileNodeMap.get(viewState.selectedNodeId);
          if (currentNode && viewState.visibleNodeIds.has(currentNode.id)) {
            renderAsciiGraph();
            renderInspector(currentNode);
            return;
          }
        }

        const defaultNode = pickDefaultVisibleNode();
        viewState.hasAppliedInitialFocus = true;

        if (!defaultNode) {
          viewState.selectedNodeId = "";
          renderAsciiGraph();
          renderInspector(null);
          return;
        }

        selectNode(defaultNode.id);
      }

      function clearSelection() {
        viewState.selectedNodeId = "";
        viewState.pinnedOverview = true;
        viewState.hasAppliedInitialFocus = true;
        renderBatchWorkbench();
        renderAsciiGraph();
        renderInspector(null);
      }

      function restoreVisibleSelection() {
        const selectedNode = viewState.selectedNodeId
          ? fileNodeMap.get(viewState.selectedNodeId)
          : null;

        if (selectedNode && viewState.visibleNodeIds.has(selectedNode.id)) {
          renderAsciiGraph();
          renderInspector(selectedNode);
          return;
        }

        viewState.selectedNodeId = "";

        if (getVisibleFileNodes().length === 0) {
          renderAsciiGraph();
          renderInspector(null);
          return;
        }

        if (viewState.pinnedOverview) {
          viewState.hasAppliedInitialFocus = true;
          renderAsciiGraph();
          renderInspector(null);
          return;
        }

        renderAsciiGraph();
        renderInspector(null);
      }

      function selectNode(nodeId) {
        if (!nodeId) {
          return;
        }

        const node = fileNodeMap.get(nodeId);
        if (!node || !viewState.visibleNodeIds.has(node.id)) {
          return;
        }

        viewState.selectedNodeId = node.id;
        viewState.pinnedOverview = false;
        viewState.hasAppliedInitialFocus = true;
        renderBatchWorkbench();
        renderAsciiGraph();
        renderInspector(node);
        renderCandidates();
      }

      function renderBatchWorkbench() {
        const candidateNodes = getVisibleFileNodes()
          .filter((node) => (node.candidateScore || 0) > 0)
          .sort(compareNodesForPriority);

        if (candidateNodes.length === 0) {
          batchPanel.innerHTML =
            '<div class="batch-empty">当前筛选下没有可进入批量治理工作台的候选。</div>';
          return;
        }

        const groups = buildBatchGroups(candidateNodes);
        batchPanel.innerHTML = groups
          .map((group) => {
            const previewItems = group.items.slice(0, group.preview);
            return \`
              <section class="batch-group">
                <h3>\${escapeHtml(group.title)}</h3>
                <p>\${escapeHtml(group.description)}</p>
                <div class="batch-meta">候选 \${escapeHtml(String(group.items.length))} 个 · 本组预览 \${escapeHtml(String(previewItems.length))} 个</div>
                <div class="batch-list">
                  \${previewItems
                    .map((node) => {
                      const isSelected =
                        node.id === viewState.selectedNodeId && !viewState.pinnedOverview;
                      return \`
                        <button
                          type="button"
                          class="batch-item \${isSelected ? "is-selected" : ""}"
                          data-node-id="\${escapeAttribute(node.id)}"
                        >
                          <strong>\${escapeHtml(node.label)}</strong>
                          <div class="candidate-path">\${escapeHtml(node.path)}</div>
                          <div>score=\${escapeHtml(String(node.candidateScore || 0))} · \${escapeHtml(
                            (node.signals || []).join(", ") || "无 signal",
                          )}</div>
                        </button>
                      \`;
                    })
                    .join("")}
                  \${group.items.length > group.preview
                    ? \`<div class="batch-meta">… 还有 \${escapeHtml(
                        String(group.items.length - group.preview),
                      )} 个同类候选</div>\`
                    : ""}
                </div>
              </section>
            \`;
          })
          .join("");

        batchPanel.querySelectorAll("button[data-node-id]").forEach((button) => {
          button.addEventListener("click", () => {
            selectNode(button.getAttribute("data-node-id"));
          });
        });
      }

      function renderAsciiGraph() {
        const visibleNodes = getVisibleFileNodes();
        const selectedNode = viewState.selectedNodeId
          ? fileNodeMap.get(viewState.selectedNodeId)
          : null;

        if (visibleNodes.length === 0) {
          graphPanel.textContent = [
            "ASCII 治理视图",
            "════════════════════════════════════════════════════════════════",
            "当前筛选下没有可见节点。",
            "",
            "建议：",
            "  - 放宽搜索关键字",
            "  - 切回全部状态 / 全部信号",
            "  - 关闭“仅疑似失效候选”",
          ].join("\\n");
          return;
        }

        if (!selectedNode || !viewState.visibleNodeIds.has(selectedNode.id)) {
          graphPanel.textContent = buildOverviewAscii(visibleNodes);
          return;
        }

        graphPanel.textContent = buildFocusAscii(selectedNode);
      }

      function buildOverviewAscii(visibleNodes) {
        const candidateNodes = [...visibleNodes]
          .filter((node) => (node.candidateScore || 0) > 0);
        const topCandidates = [...candidateNodes]
          .sort(compareNodesForPriority)
          .slice(0, 16);
        const statusLines = buildCountLines(
          visibleNodes,
          ["current", "compat", "deprecated", "dead", "unclassified"],
          (node) => node.status,
        );
        const layerLines = buildCountLines(
          visibleNodes,
          ["frontend", "rust"],
          (node) => node.layer,
        );
        const topSignalLines = buildSignalSummaryLines(candidateNodes);
        const directoryLines = buildCandidateDirectoryLines(candidateNodes);

        return [
          "ASCII 治理视图",
          "════════════════════════════════════════════════════════════════",
          "当前模式：治理总览（未聚焦单个节点）",
          "",
          \`可见节点 : \${visibleNodes.length}\`,
          \`可见页面 : \${visibleNodes.filter((node) => node.kind === "page").length}\`,
          \`可见边   : \${getVisibleEdgeCount()}\`,
          \`疑似候选 : \${candidateNodes.length}\`,
          "",
          "状态分布",
          ...statusLines,
          "",
          "分层分布",
          ...layerLines,
          "",
          "高频信号簇",
          ...(topSignalLines.length > 0 ? topSignalLines : ["  (当前筛选下无 signal)"]),
          "",
          "高优先目录簇",
          ...(directoryLines.length > 0 ? directoryLines : ["  (当前筛选下无目录簇)"]),
          "",
          \`Top 候选预览（前 \${topCandidates.length} / 共 \${candidateNodes.length}）\`,
          ...(topCandidates.length > 0
            ? topCandidates.map(
                (node, index) =>
                  \`  \${String(index + 1).padStart(2, "0")}. \${formatNodeLine(node)}\`,
              )
            : ["  (当前筛选下无候选)"]),
          "",
          "操作提示",
          "  - 上方批量治理工作台会把候选按类型分组，不代表只有预览里的这些可治理",
          "  - 点击左侧 Top 候选可聚焦某个文件 / 页面",
          "  - 点击中间批量治理工作台里的按钮也可直接进入单节点治理",
          "  - 上方筛选会同步裁剪 ASCII 关系视图",
          "  - “聚焦候选” 会跳到当前筛选下最值得先看的节点",
        ].join("\\n");
      }

      function buildFocusAscii(node) {
        const incomingIds = uniqueIds(inboundIndex.get(node.id) ?? []);
        const outgoingIds = uniqueIds(outboundIndex.get(node.id) ?? []);
        const visibleIncoming = sortNodesForView(
          incomingIds
            .filter((id) => viewState.visibleNodeIds.has(id))
            .map((id) => fileNodeMap.get(id))
            .filter(Boolean),
        );
        const visibleOutgoing = sortNodesForView(
          outgoingIds
            .filter((id) => viewState.visibleNodeIds.has(id))
            .map((id) => fileNodeMap.get(id))
            .filter(Boolean),
        );
        const hiddenIncoming = incomingIds.length - visibleIncoming.length;
        const hiddenOutgoing = outgoingIds.length - visibleOutgoing.length;
        const overlayLines = (node.overlays || []).length
          ? node.overlays.slice(0, 6).map((overlay) => {
              const monitorId = overlay.monitorId || overlay.source || "overlay";
              const classification = overlay.classification || "unclassified";
              const description = overlay.description || "无说明";
              return \`  - [\${classification}] \${monitorId}: \${description}\`;
            })
          : ["  (无 overlay)"];

        return [
          "ASCII 治理视图",
          "════════════════════════════════════════════════════════════════",
          \`Focus : \${node.path}\`,
          \`状态  : \${node.status} · \${node.layer} · \${node.language} · \${node.kind}\`,
          \`指标  : LOC \${node.loc || 0} · churn \${node.churn || 0} · score \${node.candidateScore || 0} · reachable \${Boolean(node.reachable)}\`,
          \`信号  : \${(node.signals || []).length > 0 ? node.signals.join(", ") : "无"}\`,
          "",
          "上游",
          ...renderNeighborLines(visibleIncoming, hiddenIncoming, "  (无上游依赖)"),
          "",
          "当前",
          \`  ┌─ \${node.label}\`,
          \`  │  path   : \${node.path}\`,
          \`  │  status : \${node.status}\`,
          \`  │  reason : \${node.reason || "未标注"}\`,
          ...(
            node.sourceOfTruth
              ? [\`  │  source : \${node.sourceOfTruth}\`]
              : []
          ),
          ...(
            node.exitCriteria
              ? [\`  │  exit   : \${node.exitCriteria}\`]
              : []
          ),
          ...(
            (node.ignoredSignals || []).length > 0
              ? [\`  │  ignore : \${node.ignoredSignals.join(", ")}\`]
              : []
          ),
          \`  └─ signals: \${(node.signals || []).length > 0 ? node.signals.join(", ") : "无"}\`,
          "",
          "下游",
          ...renderNeighborLines(visibleOutgoing, hiddenOutgoing, "  (无下游依赖)"),
          "",
          "Legacy overlay",
          ...overlayLines,
        ].join("\\n");
      }

      function renderNeighborLines(nodes, hiddenCount, emptyLabel) {
        if (nodes.length === 0 && hiddenCount === 0) {
          return [emptyLabel];
        }

        const shownNodes = nodes.slice(0, 10);
        const lines = shownNodes.map((item, index) => {
          const hasTail = index < shownNodes.length - 1 || nodes.length > shownNodes.length || hiddenCount > 0;
          return \`\${hasTail ? "  ├─" : "  └─"} \${formatNodeLine(item)}\`;
        });

        if (nodes.length > shownNodes.length) {
          lines.push(\`  ├─ … 还有 \${nodes.length - shownNodes.length} 个可见邻居已折叠\`);
        }

        if (hiddenCount > 0) {
          lines.push(\`  └─ … \${hiddenCount} 个邻居因当前筛选隐藏\`);
        }

        return lines;
      }

      function buildCountLines(nodes, orderedKeys, selector) {
        const counts = new Map();
        for (const node of nodes) {
          const key = selector(node);
          counts.set(key, (counts.get(key) || 0) + 1);
        }

        return orderedKeys.map((key) => \`  - \${key.padEnd(12, " ")} \${counts.get(key) || 0}\`);
      }

      function buildCandidateDirectoryLines(candidateNodes) {
        const directoryMap = new Map();

        for (const node of candidateNodes) {
          const parts = node.path.split("/");
          const directory =
            parts.length >= 3 ? parts.slice(0, 3).join("/") : parts.slice(0, -1).join("/") || "(root)";
          const entry = directoryMap.get(directory) ?? {
            count: 0,
            totalScore: 0,
            totalChurn: 0,
          };
          entry.count += 1;
          entry.totalScore += node.candidateScore || 0;
          entry.totalChurn += node.churn || 0;
          directoryMap.set(directory, entry);
        }

        return [...directoryMap.entries()]
          .sort(
            (left, right) =>
              right[1].count - left[1].count ||
              right[1].totalScore - left[1].totalScore ||
              right[1].totalChurn - left[1].totalChurn ||
              left[0].localeCompare(right[0]),
          )
          .slice(0, 10)
          .map(
            ([directory, metrics]) =>
              \`  - \${directory} · 候选 \${metrics.count} · score \${metrics.totalScore} · churn \${metrics.totalChurn}\`,
          );
      }

      function buildSignalSummaryLines(candidateNodes) {
        const signalCounts = new Map();

        for (const node of candidateNodes) {
          for (const signal of node.signals || []) {
            signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1);
          }
        }

        return [...signalCounts.entries()]
          .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
          .slice(0, 8)
          .map(([signal, count]) => \`  - \${signal.padEnd(18, " ")} \${count}\`);
      }

      function buildBatchGroups(candidateNodes) {
        const groups = [
          {
            title: "第一批：孤儿候选",
            description: "优先处理 unused-file + zero-inbound / page-unreachable，一般最容易确认。",
            preview: 8,
            match: (node) =>
              (node.signals || []).includes("unused-file") &&
              ((node.signals || []).includes("zero-inbound") ||
                (node.signals || []).includes("page-unreachable")),
          },
          {
            title: "第二批：旧链路收口",
            description: "legacy-only-incoming / legacy-callsite，说明还挂在旧调用链上。",
            preview: 8,
            match: (node) =>
              (node.signals || []).includes("legacy-only-incoming") ||
              (node.signals || []).includes("legacy-callsite"),
          },
          {
            title: "第三批：已标注待收口",
            description: "已经是 compat / deprecated，但还没彻底删干净。",
            preview: 8,
            match: (node) => ["compat", "deprecated"].includes(node.status),
          },
          {
            title: "第四批：待人工判定",
            description: "剩余高分候选，优先看 churn 高、路径集中的未分类文件。",
            preview: 8,
            match: () => true,
          },
        ];

        const usedNodeIds = new Set();

        return groups
          .map((group) => {
            const items = candidateNodes.filter((node) => {
              if (usedNodeIds.has(node.id)) {
                return false;
              }
              if (!group.match(node)) {
                return false;
              }
              usedNodeIds.add(node.id);
              return true;
            });

            return {
              ...group,
              items,
            };
          })
          .filter((group) => group.items.length > 0);
      }

      function uniqueIds(values) {
        return [...new Set(values)];
      }

      function sortNodesForView(nodes) {
        return [...nodes].sort(compareNodesForPriority);
      }

      function formatNodeLine(node) {
        const signalText =
          (node.signals || []).length > 0
            ? \` · \${node.signals.slice(0, 3).join(", ")}\`
            : "";
        return \`\${node.path} [\${node.status}/\${node.layer}] score=\${node.candidateScore || 0}\${signalText}\`;
      }

      function renderInspector(node) {
        if (!node) {
          inspectorPanel.innerHTML =
            '<div class="inspector-empty">点击左侧候选后在这里查看路径、标签、信号、治理理由和 legacy overlay。</div>';
          return;
        }

        const overlayHtml = (node.overlays || []).length
          ? \`<div class="overlay-list">\${node.overlays
              .map(
                (overlay) => \`
                  <div class="overlay-item">
                    <div><strong>\${escapeHtml(overlay.monitorId || overlay.source || "overlay")}</strong></div>
                    <div>\${escapeHtml(overlay.description || "")}</div>
                    <div class="candidate-path">\${escapeHtml(overlay.classification || "")}</div>
                  </div>
                \`,
              )
              .join("")}</div>\`
          : '<div class="inspector-empty">无 overlay。</div>';

        inspectorPanel.innerHTML = \`
          <div class="detail-list">
            <div class="detail-item">
              <strong>\${escapeHtml(node.label)}</strong>
              <div class="candidate-path">\${escapeHtml(node.path)}</div>
              <div class="pill-row" style="margin-top: 10px;">
                <span class="status-pill">\${escapeHtml(node.status)}</span>
                <span class="status-pill">\${escapeHtml(node.layer)}</span>
                <span class="status-pill">\${escapeHtml(node.language)}</span>
              </div>
            </div>
            <div class="detail-item">
              <strong>指标</strong>
              <div>LOC: \${escapeHtml(String(node.loc || 0))}</div>
              <div>Churn: \${escapeHtml(String(node.churn || 0))}</div>
              <div>Candidate Score: \${escapeHtml(String(node.candidateScore || 0))}</div>
              <div>Reachable: \${escapeHtml(String(Boolean(node.reachable)))}</div>
            </div>
            <div class="detail-item">
              <strong>治理说明</strong>
              <div>\${escapeHtml(node.reason || "未标注")}</div>
              \${
                node.sourceOfTruth
                  ? \`<div style="margin-top: 8px;">事实源：<code>\${escapeHtml(
                      node.sourceOfTruth,
                    )}</code></div>\`
                  : ""
              }
              \${
                node.exitCriteria
                  ? \`<div style="margin-top: 8px;">退出条件：\${escapeHtml(
                      node.exitCriteria,
                    )}</div>\`
                  : ""
              }
              \${
                (node.ignoredSignals || []).length > 0
                  ? \`<div style="margin-top: 8px;">忽略信号：<code>\${escapeHtml(
                      node.ignoredSignals.join(", "),
                    )}</code></div>\`
                  : ""
              }
            </div>
            <div class="detail-item">
              <strong>Signals</strong>
              <div class="pill-row">
                \${
                  (node.signals || []).length > 0
                    ? node.signals
                        .map(
                          (signal) =>
                            \`<span class="signal-pill">\${escapeHtml(signal)}</span>\`,
                        )
                        .join("")
                    : '<span class="inspector-empty">无</span>'
                }
              </div>
            </div>
            <div class="detail-item">
              <strong>打开文件</strong><br />
              <a href="\${escapeAttribute(node.href)}">\${escapeHtml(node.path)}</a>
            </div>
            <div class="detail-item">
              <strong>Legacy Overlay</strong>
              \${overlayHtml}
            </div>
          </div>
        \`;
      }

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;");
      }

      function escapeAttribute(value) {
        return escapeHtml(value).replaceAll('"', "&quot;");
      }
    </script>
  </body>
</html>`;
}

function serializeForHtml(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function escapeAttribute(value) {
  return String(value).replaceAll('"', "&quot;");
}
