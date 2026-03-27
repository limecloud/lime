#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import legacySurfaceCatalog from "../src/lib/governance/legacySurfaceCatalog.json" with { type: "json" };
import {
  DOC_FRESHNESS_SPECS,
  buildDocFreshnessReport,
  renderDocFreshnessText,
} from "./lib/doc-freshness-core.mjs";

export {
  DOC_FRESHNESS_SPECS,
  buildDocFreshnessReport,
  renderDocFreshnessText,
} from "./lib/doc-freshness-core.mjs";

function parseArgs(argv) {
  const options = {
    format: "text",
    help: false,
    output: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--format" && argv[index + 1]) {
      options.format = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--output" && argv[index + 1]) {
      options.output = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.format = "json";
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Lime Doc Freshness Check

用法:
  node scripts/check-doc-freshness.mjs
  node scripts/check-doc-freshness.mjs --json
  node scripts/check-doc-freshness.mjs --format json --output "./tmp/doc-freshness.json"

选项:
  --format FMT   标准输出格式：text | json
  --json         等价于 --format json
  --output PATH  将结果写入指定路径
  -h, --help     显示帮助
`);
}

function buildDeletedSurfaceTargets(repoRoot) {
  return (legacySurfaceCatalog.imports ?? [])
    .flatMap((entry) => entry.targets ?? [])
    .filter((target) => {
      const absolutePath = path.resolve(repoRoot, target);
      return !fs.existsSync(absolutePath);
    });
}

function readMonitoredDocuments(repoRoot) {
  return DOC_FRESHNESS_SPECS.flatMap((spec) => {
    const absolutePath = path.resolve(repoRoot, spec.path);
    if (!fs.existsSync(absolutePath)) {
      return [];
    }

    return [
      {
        path: spec.path,
        content: fs.readFileSync(absolutePath, "utf8"),
      },
    ];
  });
}

export function buildLiveDocFreshnessReport(repoRoot) {
  return buildDocFreshnessReport({
    repoRoot,
    documents: readMonitoredDocuments(repoRoot),
    deletedSurfaceTargets: buildDeletedSurfaceTargets(repoRoot),
    pathExists: (absolutePath) => fs.existsSync(absolutePath),
  });
}

function renderOutput(report, format) {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  return renderDocFreshnessText(report);
}

function runDocFreshnessCli() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  const report = buildLiveDocFreshnessReport(repoRoot);

  const output = renderOutput(report, options.format);
  if (options.output) {
    const targetPath = path.resolve(repoRoot, options.output);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, output, "utf8");
    console.log(`[lime] doc freshness output: ${targetPath}`);
  } else {
    process.stdout.write(output);
  }

  if (report.summary.issueCount > 0) {
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runDocFreshnessCli();
}
