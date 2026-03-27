#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildLegacySurfaceReport,
  printLegacySurfaceReport,
  toSerializableLegacySurfaceReport,
} from "./lib/legacy-surface-report-core.mjs";

export {
  buildLegacySurfaceReport,
  printLegacySurfaceReport,
  toSerializableLegacySurfaceReport,
} from "./lib/legacy-surface-report-core.mjs";

function parseCliArgs(argv) {
  const options = {
    json: false,
    output: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--output" && argv[index + 1]) {
      options.output = String(argv[index + 1]).trim();
      index += 1;
    }
  }

  return options;
}

function runLegacySurfaceReportCli() {
  const options = parseCliArgs(process.argv.slice(2));
  const report = buildLegacySurfaceReport();

  if (options.json) {
    const serialized = JSON.stringify(
      toSerializableLegacySurfaceReport(report),
      null,
      2,
    );
    if (options.output) {
      fs.mkdirSync(path.dirname(options.output), { recursive: true });
      fs.writeFileSync(options.output, serialized, "utf8");
      console.log(`[lime] legacy surface report JSON: ${options.output}`);
    } else {
      console.log(serialized);
    }
  } else {
    printLegacySurfaceReport(report);
  }

  if (report.violations.length > 0) {
    console.error("");
    console.error(
      "[lime] legacy surface report 检测到边界违规，请先治理再继续扩展。",
    );
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  runLegacySurfaceReportCli();
}
