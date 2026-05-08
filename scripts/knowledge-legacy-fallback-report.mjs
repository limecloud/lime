#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const options = {
    workingDir: process.cwd(),
    json: false,
    failOnFallback: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--working-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--working-dir 需要目录参数");
      }
      options.workingDir = value;
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--fail-on-fallback") {
      options.failOnFallback = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }

  return options;
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function countMarkdownFiles(dir) {
  if (!(await exists(dir))) {
    return 0;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countMarkdownFiles(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      count += 1;
    }
  }
  return count;
}

async function readPackStatus(packRoot) {
  const compiledRoot = path.join(packRoot, "compiled");
  const briefPath = path.join(compiledRoot, "brief.md");
  const indexPath = path.join(compiledRoot, "index.json");
  const splitsRoot = path.join(compiledRoot, "splits");
  const splitCount = await countMarkdownFiles(splitsRoot);
  const hasBrief = await exists(briefPath);
  const hasIndex = await exists(indexPath);
  const hasSplits = splitCount > 0;

  let status = "current";
  if (hasBrief && !hasIndex && !hasSplits) {
    status = "legacy-fallback";
  } else if (hasBrief && (hasIndex || hasSplits)) {
    status = "stale-brief";
  } else if (!hasIndex || !hasSplits) {
    status = "needs-compile";
  }

  return {
    name: path.basename(packRoot),
    status,
    hasBrief,
    hasIndex,
    splitCount,
  };
}

async function buildReport(workingDir) {
  const root = path.resolve(workingDir, ".lime", "knowledge", "packs");
  if (!(await exists(root))) {
    return {
      workingDir: path.resolve(workingDir),
      root,
      packs: [],
      summary: {
        total: 0,
        current: 0,
        legacyFallback: 0,
        staleBrief: 0,
        needsCompile: 0,
      },
    };
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const packs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    packs.push(await readPackStatus(path.join(root, entry.name)));
  }
  packs.sort((left, right) => left.name.localeCompare(right.name));

  const summary = {
    total: packs.length,
    current: packs.filter((pack) => pack.status === "current").length,
    legacyFallback: packs.filter((pack) => pack.status === "legacy-fallback")
      .length,
    staleBrief: packs.filter((pack) => pack.status === "stale-brief").length,
    needsCompile: packs.filter((pack) => pack.status === "needs-compile")
      .length,
  };

  return {
    workingDir: path.resolve(workingDir),
    root,
    packs,
    summary,
  };
}

function printTextReport(report) {
  console.log("[knowledge-legacy-fallback-report]");
  console.log(`workingDir: ${report.workingDir}`);
  console.log(`root: ${report.root}`);
  console.log(
    `summary: total=${report.summary.total} current=${report.summary.current} legacyFallback=${report.summary.legacyFallback} staleBrief=${report.summary.staleBrief} needsCompile=${report.summary.needsCompile}`,
  );

  for (const pack of report.packs) {
    console.log(
      `- ${pack.name}: ${pack.status} brief=${pack.hasBrief ? "yes" : "no"} index=${pack.hasIndex ? "yes" : "no"} splits=${pack.splitCount}`,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`Usage: npm run knowledge:legacy-fallback-report -- [options]

Options:
  --working-dir <dir>    Workspace root. Defaults to current directory.
  --json                 Print JSON.
  --fail-on-fallback     Exit 1 when legacy fallback or stale brief exists.
`);
    return;
  }

  const report = await buildReport(options.workingDir);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }

  const hasFallback =
    report.summary.legacyFallback > 0 || report.summary.staleBrief > 0;
  if (options.failOnFallback && hasFallback) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[knowledge-legacy-fallback-report] ${error.message}`);
  process.exitCode = 1;
});
