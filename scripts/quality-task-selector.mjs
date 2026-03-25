#!/usr/bin/env node

import process from "node:process";

import { planQualityTasks } from "./quality-task-planner.mjs";

function parseArgs(argv) {
  const result = {
    base: "",
    format: "json",
    full: false,
    help: false,
    staged: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--full") {
      result.full = true;
      continue;
    }
    if (arg === "--staged") {
      result.staged = true;
      continue;
    }
    if (arg === "--base" && argv[index + 1]) {
      result.base = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg === "--format" && argv[index + 1]) {
      result.format = String(argv[index + 1]).trim();
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
Lime 质量任务规划器

用法:
  node scripts/quality-task-selector.mjs
  node scripts/quality-task-selector.mjs --staged
  node scripts/quality-task-selector.mjs --base origin/main
  node scripts/quality-task-selector.mjs --format github

选项:
  --full          忽略改动检测，返回全量任务
  --staged        仅基于已暂存文件判断
  --base REF      基于指定基线判断
  --format FMT    输出格式：json | github
  -h, --help      显示帮助
`);
}

function printGithubFormat(result) {
  const { changedFiles, tasks } = result;
  const lines = [
    `changed_count=${changedFiles.length}`,
    `integrity=${tasks.integrity}`,
    `frontend=${tasks.frontend}`,
    `rust=${tasks.rust}`,
    `bridge=${tasks.bridge}`,
    `gui_smoke=${tasks.guiSmoke}`,
    `docs=${tasks.docs}`,
    `docs_only=${tasks.docsOnly}`,
    `fallback=${tasks.fallback}`,
    `workflow=${tasks.workflow}`,
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = planQualityTasks(options);

  if (options.format === "github") {
    printGithubFormat(result);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
