#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";

const KNOWLEDGE_MATCHERS = [
  exact(".gitignore"),
  exact("README.md"),
  exact("RELEASE_NOTES.md"),
  exact("docs/README.md"),
  exact("package.json"),
  prefix("docs/roadmap/knowledge/"),
  prefix("docs/knowledge/skills/"),
  prefix("scripts/knowledge-"),
  prefix("src-tauri/crates/knowledge/"),
  exact("src-tauri/src/commands/aster_agent_cmd/runtime_turn.rs"),
  exact("src-tauri/src/commands/knowledge_cmd.rs"),
  exact("src-tauri/src/dev_bridge/dispatcher.rs"),
  exact("src-tauri/src/dev_bridge/dispatcher/files.rs"),
  exact("src-tauri/src/dev_bridge/dispatcher/knowledge.rs"),
  exact("src-tauri/src/skills/default_skills.rs"),
  exact("src-tauri/crates/core/src/models/mod.rs"),
  exact("src-tauri/crates/core/src/models/skill_model.rs"),
  prefix("src-tauri/resources/default-skills/knowledge_builder/"),
  prefix("src-tauri/resources/default-skills/personal-ip-knowledge-builder/"),
  prefix("src-tauri/resources/default-skills/brand-persona-knowledge-builder/"),
  prefix("src-tauri/resources/default-skills/brand-product-knowledge-builder/"),
  prefix("src-tauri/resources/default-skills/organization-knowhow-knowledge-builder/"),
  prefix("src-tauri/resources/default-skills/growth-strategy-knowledge-builder/"),
  prefix("src-tauri/resources/default-skills/content-operations-knowledge-builder/"),
  prefix("src-tauri/resources/default-skills/private-domain-operations-knowledge-builder/"),
  prefix("src-tauri/resources/default-skills/live-commerce-operations-knowledge-builder/"),
  prefix("src-tauri/resources/default-skills/campaign-operations-knowledge-builder/"),
  prefix("src/features/knowledge/"),
  prefix("src/components/agent/chat/"),
  exact("src/lib/api/knowledge.ts"),
  exact("src/lib/api/serviceSkills.ts"),
  prefix("src/lib/api/skillCatalog"),
  prefix("src/lib/base-setup/seededServiceSkillPackage"),
  prefix("src/lib/dev-bridge/mockPriorityCommands"),
  prefix("src/lib/tauri-mock/core"),
  exact("src/types/page.ts"),
];

const NON_KNOWLEDGE_MATCHERS = [
  exact("docs/aiprompts/commands.md"),
  prefix("docs/roadmap/ai-layered-design/"),
  prefix("scripts/benchmark-layered-design"),
  prefix("scripts/design-canvas"),
  prefix("scripts/layered-design"),
  prefix("scripts/verify-layered-design"),
  exact("src-tauri/src/commands/layered_design_cmd.rs"),
  exact("src/lib/api/layeredDesignProject.ts"),
  prefix("src/components/workspace/design/"),
  prefix("src/lib/layered-design/"),
  exact("src/pages/design-canvas-smoke.tsx"),
];

function exact(value) {
  return (filePath) => filePath === value;
}

function prefix(value) {
  return (filePath) => filePath.startsWith(value);
}

function printHelp() {
  console.log(`Usage: node scripts/knowledge-release-scope-report.mjs [options]

只读报告当前 dirty worktree 中哪些路径可进入 Knowledge-only 发布候选，哪些明显属于非 Knowledge 改动，哪些还需要人工分类。
不会 stage、commit、tag、push 或修改文件。

Options:
  --json                    输出 JSON
  --fail-on-non-knowledge   发现明确非 Knowledge 改动时返回非 0
  --fail-on-unknown         发现未知分类改动时返回非 0
  --help, -h                显示帮助
`);
}

function parseArgs(argv) {
  const options = {
    json: false,
    failOnNonKnowledge: false,
    failOnUnknown: false,
  };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--fail-on-non-knowledge") {
      options.failOnNonKnowledge = true;
      continue;
    }
    if (arg === "--fail-on-unknown") {
      options.failOnUnknown = true;
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

function readGitStatus() {
  const output = execFileSync("git", ["status", "--short"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parseStatusLine);
}

function parseStatusLine(line) {
  const status = line.slice(0, 2);
  const rawPath = line.slice(3);
  const paths = rawPath.includes(" -> ") ? rawPath.split(" -> ") : [rawPath];
  return {
    status,
    path: rawPath,
    paths,
  };
}

function matches(filePath, matchers) {
  return matchers.some((matcher) => matcher(filePath));
}

function classify(entry) {
  const knowledge = entry.paths.some((filePath) => matches(filePath, KNOWLEDGE_MATCHERS));
  const nonKnowledge = entry.paths.some((filePath) => matches(filePath, NON_KNOWLEDGE_MATCHERS));
  if (knowledge && !nonKnowledge) {
    return "knowledge";
  }
  if (nonKnowledge && !knowledge) {
    return "nonKnowledge";
  }
  if (knowledge && nonKnowledge) {
    return "mixed";
  }
  return "unknown";
}

function buildReport() {
  const entries = readGitStatus().map((entry) => ({
    ...entry,
    category: classify(entry),
  }));
  const byCategory = {
    knowledge: entries.filter((entry) => entry.category === "knowledge"),
    nonKnowledge: entries.filter((entry) => entry.category === "nonKnowledge"),
    mixed: entries.filter((entry) => entry.category === "mixed"),
    unknown: entries.filter((entry) => entry.category === "unknown"),
  };
  return {
    summary: Object.fromEntries(
      Object.entries(byCategory).map(([category, items]) => [category, items.length]),
    ),
    entries,
    byCategory,
  };
}

function printTextReport(report) {
  console.log("Knowledge release scope report");
  console.log(JSON.stringify(report.summary, null, 2));
  for (const [title, items] of [
    ["Knowledge-only candidates", report.byCategory.knowledge],
    ["Non-Knowledge changes", report.byCategory.nonKnowledge],
    ["Mixed changes", report.byCategory.mixed],
    ["Unknown changes", report.byCategory.unknown],
  ]) {
    console.log(`\n## ${title} (${items.length})`);
    for (const item of items) {
      console.log(`${item.status} ${item.path}`);
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = buildReport();
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }

  if (options.failOnNonKnowledge && report.byCategory.nonKnowledge.length > 0) {
    process.exitCode = 1;
  }
  if (options.failOnUnknown && report.byCategory.unknown.length > 0) {
    process.exitCode = 1;
  }
}

main();
