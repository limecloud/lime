#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildGeneratedSlopReport,
  renderGeneratedSlopMarkdown,
  renderGeneratedSlopText,
} from "./lib/generated-slop-report-core.mjs";
import { buildLiveDocFreshnessReport } from "./check-doc-freshness.mjs";
import {
  buildLegacySurfaceReport,
  toSerializableLegacySurfaceReport,
} from "./report-legacy-surfaces.mjs";

const TREND_REPORT_PATH = "scripts/harness-eval-trend-report.mjs";

export {
  buildGeneratedSlopReport,
  renderGeneratedSlopMarkdown,
  renderGeneratedSlopText,
} from "./lib/generated-slop-report-core.mjs";

function parseArgs(argv) {
  const result = {
    format: "text",
    help: false,
    docFreshnessInput: "",
    legacyInput: "",
    outputJson: "",
    outputMarkdown: "",
    trendHistoryDir: "",
    trendInput: "",
    workspaceRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--trend-input" && argv[index + 1]) {
      result.trendInput = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--doc-freshness-input" && argv[index + 1]) {
      result.docFreshnessInput = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--legacy-input" && argv[index + 1]) {
      result.legacyInput = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--trend-history-dir" && argv[index + 1]) {
      result.trendHistoryDir = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--workspace-root" && argv[index + 1]) {
      result.workspaceRoot = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--format" && argv[index + 1]) {
      result.format = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--output-json" && argv[index + 1]) {
      result.outputJson = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--output-markdown" && argv[index + 1]) {
      result.outputMarkdown = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
Lime Harness Cleanup / Slop Report

用法:
  node scripts/report-generated-slop.mjs
  node scripts/report-generated-slop.mjs --trend-input "./tmp/harness-eval-trend.json"
  node scripts/report-generated-slop.mjs --doc-freshness-input "./tmp/doc-freshness.json"
  node scripts/report-generated-slop.mjs --legacy-input "./tmp/legacy-surface-report.json"
  node scripts/report-generated-slop.mjs --trend-history-dir "./artifacts/history"
  node scripts/report-generated-slop.mjs --output-json "./tmp/harness-cleanup-report.json" --output-markdown "./tmp/harness-cleanup-report.md"

选项:
  --trend-input PATH        显式指定 harness eval trend JSON
  --doc-freshness-input PATH 显式指定 doc freshness JSON
  --legacy-input PATH       显式指定 governance / legacy surface report JSON
  --trend-history-dir PATH  透传给 trend report，用历史 summary 生成趋势
  --workspace-root PATH     未提供 trend-input 时，用该工作区生成当前 trend 报告
  --format FMT              标准输出格式：text | json | markdown
  --output-json PATH        将 cleanup/slop 报告 JSON 写入指定路径
  --output-markdown PATH    将 cleanup/slop 报告 Markdown 写入指定路径
  -h, --help                显示帮助
`);
}

function resolvePath(baseDir, targetPath) {
  return path.resolve(baseDir, targetPath);
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function detectDefaultTrendHistoryDir(repoRoot) {
  const candidate = resolvePath(repoRoot, "./artifacts/history");
  if (!fs.existsSync(candidate)) {
    return "";
  }

  const hasJson = fs
    .readdirSync(candidate, { withFileTypes: true })
    .some((entry) => entry.isFile() && entry.name.endsWith(".json"));

  return hasJson ? candidate : "";
}

function buildTrendReport(repoRoot, options) {
  if (options.trendInput) {
    const resolvedPath = resolvePath(repoRoot, options.trendInput);
    return {
      report: readJsonFile(resolvedPath),
      source: {
        kind: "input-json",
        path: resolvedPath,
      },
    };
  }

  const nodeCommand = process.execPath;
  const trendScriptPath = resolvePath(repoRoot, TREND_REPORT_PATH);
  const args = [trendScriptPath, "--format", "json"];
  const effectiveHistoryDir =
    options.trendHistoryDir || detectDefaultTrendHistoryDir(repoRoot);

  if (effectiveHistoryDir) {
    args.push("--history-dir", effectiveHistoryDir);
  }

  if (options.workspaceRoot) {
    args.push("--workspace-root", options.workspaceRoot);
  }

  const output = execFileSync(nodeCommand, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });

  return {
    report: JSON.parse(output),
    source: {
      kind: effectiveHistoryDir ? "generated-history" : "generated-current",
      path: effectiveHistoryDir
        ? resolvePath(repoRoot, effectiveHistoryDir)
        : "",
    },
  };
}

function buildGovernanceReport(repoRoot, options) {
  if (options.legacyInput) {
    const resolvedPath = resolvePath(repoRoot, options.legacyInput);
    return {
      report: readJsonFile(resolvedPath),
      source: {
        kind: "input-json",
        path: resolvedPath,
      },
    };
  }

  return {
    report: toSerializableLegacySurfaceReport(buildLegacySurfaceReport()),
    source: {
      kind: "live-scan",
      path: "",
    },
  };
}

function buildDocFreshnessReport(repoRoot, options) {
  if (options.docFreshnessInput) {
    const resolvedPath = resolvePath(repoRoot, options.docFreshnessInput);
    return {
      report: readJsonFile(resolvedPath),
      source: {
        kind: "input-json",
        path: resolvedPath,
      },
    };
  }

  return {
    report: buildLiveDocFreshnessReport(repoRoot),
    source: {
      kind: "live-scan",
      path: "",
    },
  };
}

function renderOutput(report, format) {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  if (format === "markdown") {
    return renderGeneratedSlopMarkdown(report);
  }

  return renderGeneratedSlopText(report);
}

function runGeneratedSlopReportCli() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  const trendResult = buildTrendReport(repoRoot, options);
  const docFreshnessResult = buildDocFreshnessReport(repoRoot, options);
  const governanceResult = buildGovernanceReport(repoRoot, options);
  const report = buildGeneratedSlopReport({
    repoRoot,
    trendReport: trendResult.report,
    docFreshnessReport: docFreshnessResult.report,
    governanceReport: governanceResult.report,
    sources: {
      trend: trendResult.source,
      docFreshness: docFreshnessResult.source,
      governance: governanceResult.source,
    },
  });

  if (options.outputJson) {
    const targetPath = resolvePath(repoRoot, options.outputJson);
    ensureParentDirectory(targetPath);
    fs.writeFileSync(targetPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`[lime] cleanup/slop report JSON: ${targetPath}`);
  }

  if (options.outputMarkdown) {
    const targetPath = resolvePath(repoRoot, options.outputMarkdown);
    ensureParentDirectory(targetPath);
    fs.writeFileSync(targetPath, renderGeneratedSlopMarkdown(report), "utf8");
    console.log(`[lime] cleanup/slop report Markdown: ${targetPath}`);
  }

  process.stdout.write(renderOutput(report, options.format));
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runGeneratedSlopReportCli();
}
