#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { assertGeneratedSlopReportContract } from "./lib/generated-slop-report-core.mjs";

const GENERATED_SLOP_REPORT_SCRIPT = "scripts/report-generated-slop.mjs";

function parseArgs(argv) {
  const result = {
    format: "text",
    generateCurrent: false,
    help: false,
    input: ".lime/harness/reports/harness-cleanup-report.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--input" && argv[index + 1]) {
      result.input = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--format" && argv[index + 1]) {
      result.format = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--generate-current") {
      result.generateCurrent = true;
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
Lime Harness Cleanup Report Contract Check

用法:
  node scripts/check-generated-slop-report.mjs
  node scripts/check-generated-slop-report.mjs --generate-current
  node scripts/check-generated-slop-report.mjs --input ".lime/harness/reports/harness-cleanup-report.json"
  node scripts/check-generated-slop-report.mjs --input "./tmp/harness-cleanup-report.json" --format json

选项:
  --input PATH     cleanup report JSON 路径，默认 ".lime/harness/reports/harness-cleanup-report.json"
  --generate-current 先生成当前 cleanup report，再校验其契约
  --format FMT     输出格式：text | json
  -h, --help       显示帮助
`);
}

function resolveInputPath(inputPath) {
  return path.resolve(process.cwd(), inputPath);
}

function buildCurrentCleanupReport() {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "lime-cleanup-report-contract-"),
  );
  const outputPath = path.join(tempRoot, "harness-cleanup-report.json");

  try {
    execFileSync(
      process.execPath,
      [
        path.resolve(process.cwd(), GENERATED_SLOP_REPORT_SCRIPT),
        "--format",
        "json",
        "--output-json",
        outputPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return outputPath;
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

function buildSummary(report, resolvedPath) {
  return {
    status: "ok",
    inputPath: resolvedPath,
    recommendationCount: Array.isArray(report?.recommendations)
      ? report.recommendations.length
      : 0,
    verificationFailureFocusCount: Array.isArray(
      report?.focus?.observabilityVerificationOutcomes,
    )
      ? report.focus.observabilityVerificationOutcomes.length
      : 0,
    currentRecoveredBaselineCount: Array.isArray(
      report?.focus?.currentRecoveredObservabilityVerificationOutcomes,
    )
      ? report.focus.currentRecoveredObservabilityVerificationOutcomes.length
      : 0,
  };
}

function renderSummary(summary, format) {
  if (format === "json") {
    return `${JSON.stringify(summary, null, 2)}\n`;
  }

  return [
    "[harness-cleanup-contract] ok",
    `[harness-cleanup-contract] input: ${summary.inputPath}`,
    `[harness-cleanup-contract] recommendations: ${summary.recommendationCount}`,
    `[harness-cleanup-contract] verification failure focus: ${summary.verificationFailureFocusCount}`,
    `[harness-cleanup-contract] current recovered baseline: ${summary.currentRecoveredBaselineCount}`,
  ].join("\n") + "\n";
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const resolvedPath = options.generateCurrent
    ? buildCurrentCleanupReport()
    : resolveInputPath(options.input);

  try {
    const report = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const validatedReport = assertGeneratedSlopReportContract(report);
    const summary = buildSummary(validatedReport, resolvedPath);
    process.stdout.write(renderSummary(summary, options.format));
  } finally {
    if (options.generateCurrent) {
      fs.rmSync(path.dirname(resolvedPath), { recursive: true, force: true });
    }
  }
}

main();
