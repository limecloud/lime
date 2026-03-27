#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MANIFEST_PATH = "docs/test/harness-evals.manifest.json";

function parseArgs(argv) {
  const result = {
    format: "text",
    help: false,
    manifest: DEFAULT_MANIFEST_PATH,
    outputJson: "",
    outputMarkdown: "",
    strict: true,
    workspaceRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manifest" && argv[index + 1]) {
      result.manifest = String(argv[index + 1]).trim();
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

    if (arg === "--no-strict") {
      result.strict = false;
      continue;
    }

    if (arg === "--strict") {
      result.strict = true;
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
Lime Harness Eval Runner

用法:
  node scripts/harness-eval-runner.mjs
  node scripts/harness-eval-runner.mjs --format json
  node scripts/harness-eval-runner.mjs --workspace-root "/path/to/workspace"
  node scripts/harness-eval-runner.mjs --output-json "./tmp/harness-eval-summary.json" --output-markdown "./tmp/harness-eval-summary.md"

选项:
  --manifest PATH        指定 manifest，默认 docs/test/harness-evals.manifest.json
  --workspace-root PATH  指定工作区根目录，默认当前目录
  --format FMT           控制标准输出格式：text | json | markdown
  --output-json PATH     将 JSON 摘要写入指定路径
  --output-markdown PATH 将 Markdown 摘要写入指定路径
  --strict               严格模式（默认），发现 invalid case 时返回非 0
  --no-strict            非严格模式，只输出摘要，不因 invalid case 退出失败
  -h, --help             显示帮助
`);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolvePath(baseDir, relativePath) {
  return path.resolve(baseDir, relativePath);
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function mergeUniqueStrings(...groups) {
  return [...new Set(groups.flatMap((group) => normalizeStringList(group)))];
}

function createBreakdownEntry(name) {
  return {
    name,
    caseCount: 0,
    readyCount: 0,
    invalidCount: 0,
    pendingRequestCaseCount: 0,
    needsHumanReviewCount: 0,
  };
}

function aggregateCaseBreakdown(cases, selector) {
  const breakdownMap = new Map();

  for (const entry of cases) {
    const labels = mergeUniqueStrings(selector(entry));
    for (const label of labels) {
      const current = breakdownMap.get(label) ?? createBreakdownEntry(label);
      current.caseCount += 1;
      if (entry.status === "ready") {
        current.readyCount += 1;
      } else if (entry.status === "invalid") {
        current.invalidCount += 1;
      }
      if (entry.pendingRequestCount > 0) {
        current.pendingRequestCaseCount += 1;
      }
      if (entry.requiresHumanReview) {
        current.needsHumanReviewCount += 1;
      }
      breakdownMap.set(label, current);
    }
  }

  return Array.from(breakdownMap.values()).sort((left, right) => {
    if (right.caseCount !== left.caseCount) {
      return right.caseCount - left.caseCount;
    }
    return left.name.localeCompare(right.name);
  });
}

function getValueByPath(target, dottedPath) {
  return dottedPath
    .split(".")
    .reduce(
      (current, segment) => (current == null ? undefined : current[segment]),
      target,
    );
}

function isPresentValue(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return true;
}

function collectFieldIssues(jsonPayload, fields, label) {
  const issues = [];
  for (const field of fields) {
    if (!isPresentValue(getValueByPath(jsonPayload, field))) {
      issues.push(`${label} 缺少字段: ${field}`);
    }
  }
  return issues;
}

function listReplayDirectories(rootPath) {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootPath, entry.name, "replay"))
    .filter((replayPath) => {
      try {
        return fs.statSync(replayPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((left, right) => left.localeCompare(right));
}

function validateCaseDirectory(caseDir, caseConfig, defaults, context) {
  const requiredArtifacts = normalizeStringList(
    caseConfig.requiredArtifacts ?? defaults.requiredArtifacts,
  );
  const requiredInputFields = normalizeStringList(
    caseConfig.requiredInputFields ?? defaults.requiredInputFields,
  );
  const requiredExpectedFields = normalizeStringList(
    caseConfig.requiredExpectedFields ?? defaults.requiredExpectedFields,
  );
  const requiredEvidenceFields = normalizeStringList(
    caseConfig.requiredEvidenceFields ?? defaults.requiredEvidenceFields,
  );

  const issues = [];
  const resolvedCaseDir = path.resolve(caseDir);
  const files = {};

  for (const artifactName of requiredArtifacts) {
    const artifactPath = path.join(resolvedCaseDir, artifactName);
    files[artifactName] = artifactPath;
    if (!fs.existsSync(artifactPath)) {
      issues.push(`缺少文件: ${artifactName}`);
    }
  }

  let inputPayload = null;
  let expectedPayload = null;
  let evidencePayload = null;

  if (fs.existsSync(files["input.json"] ?? "")) {
    try {
      inputPayload = readJsonFile(files["input.json"]);
      issues.push(
        ...collectFieldIssues(inputPayload, requiredInputFields, "input.json"),
      );
    } catch (error) {
      issues.push(`input.json 解析失败: ${String(error.message ?? error)}`);
    }
  }

  if (fs.existsSync(files["expected.json"] ?? "")) {
    try {
      expectedPayload = readJsonFile(files["expected.json"]);
      issues.push(
        ...collectFieldIssues(
          expectedPayload,
          requiredExpectedFields,
          "expected.json",
        ),
      );
    } catch (error) {
      issues.push(`expected.json 解析失败: ${String(error.message ?? error)}`);
    }
  }

  if (fs.existsSync(files["evidence-links.json"] ?? "")) {
    try {
      evidencePayload = readJsonFile(files["evidence-links.json"]);
      issues.push(
        ...collectFieldIssues(
          evidencePayload,
          requiredEvidenceFields,
          "evidence-links.json",
        ),
      );
    } catch (error) {
      issues.push(
        `evidence-links.json 解析失败: ${String(error.message ?? error)}`,
      );
    }
  }

  const pendingRequestCount = Array.isArray(
    inputPayload?.runtimeContext?.pendingRequests,
  )
    ? inputPayload.runtimeContext.pendingRequests.length
    : 0;
  const classificationTags = mergeUniqueStrings(
    context.tags,
    inputPayload?.classification?.suiteTags,
  );
  const failureModes = normalizeStringList(
    inputPayload?.classification?.failureModes,
  );
  const primaryBlockingKind =
    typeof inputPayload?.classification?.primaryBlockingKind === "string"
      ? inputPayload.classification.primaryBlockingKind.trim()
      : "";
  const requiresHumanReview =
    expectedPayload?.graderSuggestion?.requiresHumanReview === true;
  const preferredMode =
    typeof expectedPayload?.graderSuggestion?.preferredMode === "string"
      ? expectedPayload.graderSuggestion.preferredMode
      : "";

  return {
    caseId: context.caseId,
    title: context.title,
    suiteId: context.suiteId,
    suiteTitle: context.suiteTitle,
    source: context.source,
    priority: context.priority ?? "",
    tags: classificationTags,
    failureModes,
    primaryBlockingKind,
    caseDir: resolvedCaseDir,
    relativeCaseDir: path.relative(context.repoRoot, resolvedCaseDir) || ".",
    sessionId:
      inputPayload?.session?.sessionId ??
      expectedPayload?.sessionId ??
      path.basename(path.dirname(resolvedCaseDir)),
    threadId:
      inputPayload?.session?.threadId ?? expectedPayload?.threadId ?? "",
    goalSummary:
      inputPayload?.task?.goalSummary ?? expectedPayload?.goalSummary ?? "",
    pendingRequestCount,
    requiresHumanReview,
    preferredMode,
    status: issues.length === 0 ? "ready" : "invalid",
    issues,
  };
}

function expandSuiteCases(suiteConfig, defaults, repoRoot, workspaceRoot) {
  const suiteCases = [];
  const configuredCases = Array.isArray(suiteConfig.cases)
    ? suiteConfig.cases
    : [];

  for (const caseConfig of configuredCases) {
    const source = String(caseConfig.source ?? "").trim();
    if (source === "repo_fixture") {
      const caseDir = resolvePath(repoRoot, String(caseConfig.caseDir ?? ""));
      suiteCases.push(
        validateCaseDirectory(caseDir, caseConfig, defaults, {
          caseId: String(caseConfig.id ?? "unnamed-case"),
          priority: suiteConfig.priority,
          repoRoot,
          source,
          suiteId: String(suiteConfig.id ?? "unnamed-suite"),
          suiteTitle: String(suiteConfig.title ?? "未命名 Suite"),
          tags: caseConfig.tags,
          title: String(caseConfig.title ?? caseConfig.id ?? "未命名 Case"),
        }),
      );
      continue;
    }

    if (source === "workspace_replay_discovery") {
      const discoveryRoot = resolvePath(
        workspaceRoot,
        String(caseConfig.root ?? ".lime/harness/sessions"),
      );
      const replayDirectories = listReplayDirectories(discoveryRoot);

      if (
        replayDirectories.length === 0 &&
        caseConfig.allowZeroMatches !== true
      ) {
        suiteCases.push({
          caseId: String(caseConfig.id ?? "workspace-discovery"),
          title: String(caseConfig.title ?? "工作区 Replay 自动发现"),
          suiteId: String(suiteConfig.id ?? "unnamed-suite"),
          suiteTitle: String(suiteConfig.title ?? "未命名 Suite"),
          source,
          priority: suiteConfig.priority ?? "",
          tags: normalizeStringList(caseConfig.tags),
          failureModes: [],
          primaryBlockingKind: "",
          caseDir: discoveryRoot,
          relativeCaseDir: path.relative(repoRoot, discoveryRoot) || ".",
          sessionId: "",
          threadId: "",
          goalSummary: "",
          pendingRequestCount: 0,
          requiresHumanReview: false,
          preferredMode: "",
          status: "invalid",
          issues: [
            `未发现 replay case 目录: ${path.relative(workspaceRoot, discoveryRoot) || "."}`,
          ],
        });
        continue;
      }

      for (const replayDir of replayDirectories) {
        const sessionId = path.basename(path.dirname(replayDir));
        suiteCases.push(
          validateCaseDirectory(replayDir, caseConfig, defaults, {
            caseId: `${String(caseConfig.id ?? "workspace-case")}:${sessionId}`,
            priority: suiteConfig.priority,
            repoRoot,
            source,
            suiteId: String(suiteConfig.id ?? "unnamed-suite"),
            suiteTitle: String(suiteConfig.title ?? "未命名 Suite"),
            tags: caseConfig.tags,
            title: `${String(caseConfig.title ?? "工作区 Replay 样本")} / ${sessionId}`,
          }),
        );
      }
      continue;
    }

    suiteCases.push({
      caseId: String(caseConfig.id ?? "unknown-case"),
      title: String(caseConfig.title ?? "未命名 Case"),
      suiteId: String(suiteConfig.id ?? "unnamed-suite"),
      suiteTitle: String(suiteConfig.title ?? "未命名 Suite"),
      source,
      priority: suiteConfig.priority ?? "",
      tags: normalizeStringList(caseConfig.tags),
      failureModes: [],
      primaryBlockingKind: "",
      caseDir: "",
      relativeCaseDir: "",
      sessionId: "",
      threadId: "",
      goalSummary: "",
      pendingRequestCount: 0,
      requiresHumanReview: false,
      preferredMode: "",
      status: "invalid",
      issues: [`不支持的 case source: ${source || "(empty)"}`],
    });
  }

  const readyCount = suiteCases.filter(
    (entry) => entry.status === "ready",
  ).length;
  const invalidCount = suiteCases.length - readyCount;
  const discoveredCount = suiteCases.filter(
    (entry) => entry.source === "workspace_replay_discovery",
  ).length;

  return {
    id: String(suiteConfig.id ?? "unnamed-suite"),
    title: String(suiteConfig.title ?? "未命名 Suite"),
    priority: String(suiteConfig.priority ?? ""),
    roadmap: String(suiteConfig.roadmap ?? ""),
    description: String(suiteConfig.description ?? ""),
    upstream: suiteConfig.upstream ?? {},
    cases: suiteCases,
    stats: {
      configuredCaseCount: configuredCases.length,
      discoveredCaseCount: discoveredCount,
      caseCount: suiteCases.length,
      readyCount,
      invalidCount,
    },
  };
}

function buildSummary(manifest, suites, options) {
  const allCases = suites.flatMap((suite) => suite.cases);
  const readyCases = allCases.filter((entry) => entry.status === "ready");
  const invalidCases = allCases.filter((entry) => entry.status === "invalid");
  const reviewCases = allCases.filter((entry) => entry.requiresHumanReview);
  const pendingCases = allCases.filter(
    (entry) => entry.pendingRequestCount > 0,
  );

  return {
    manifestVersion: String(manifest.manifestVersion ?? "unknown"),
    title: String(manifest.title ?? "Lime Harness Eval Summary"),
    generatedAt: new Date().toISOString(),
    repoRoot: process.cwd(),
    workspaceRoot: path.resolve(options.workspaceRoot),
    strict: options.strict,
    totals: {
      suiteCount: suites.length,
      caseCount: allCases.length,
      readyCount: readyCases.length,
      invalidCount: invalidCases.length,
      needsHumanReviewCount: reviewCases.length,
      pendingRequestCaseCount: pendingCases.length,
    },
    breakdowns: {
      suiteTags: aggregateCaseBreakdown(allCases, (entry) => entry.tags),
      failureModes: aggregateCaseBreakdown(
        allCases,
        (entry) => entry.failureModes,
      ),
    },
    suites,
  };
}

function renderText(summary) {
  const lines = [
    `[harness-eval] manifest: ${summary.title} (${summary.manifestVersion})`,
    `[harness-eval] workspace: ${summary.workspaceRoot}`,
    `[harness-eval] suites: ${summary.totals.suiteCount}`,
    `[harness-eval] cases : ${summary.totals.caseCount}`,
    `[harness-eval] ready : ${summary.totals.readyCount}`,
    `[harness-eval] invalid: ${summary.totals.invalidCount}`,
    `[harness-eval] pending-request cases: ${summary.totals.pendingRequestCaseCount}`,
    `[harness-eval] needs-review cases : ${summary.totals.needsHumanReviewCount}`,
  ];

  const topFailureModes = summary.breakdowns.failureModes.slice(0, 5);
  if (topFailureModes.length > 0) {
    lines.push("[harness-eval] top failure modes:");
    for (const entry of topFailureModes) {
      lines.push(
        `  - ${entry.name}: case=${entry.caseCount}, invalid=${entry.invalidCount}, pending=${entry.pendingRequestCaseCount}`,
      );
    }
  }

  const topSuiteTags = summary.breakdowns.suiteTags.slice(0, 5);
  if (topSuiteTags.length > 0) {
    lines.push("[harness-eval] top suite tags:");
    for (const entry of topSuiteTags) {
      lines.push(
        `  - ${entry.name}: case=${entry.caseCount}, ready=${entry.readyCount}, invalid=${entry.invalidCount}`,
      );
    }
  }

  for (const suite of summary.suites) {
    lines.push(
      `[harness-eval] suite ${suite.id}: ready ${suite.stats.readyCount} / ${suite.stats.caseCount}`,
    );
    for (const entry of suite.cases) {
      lines.push(
        `  - ${entry.caseId} [${entry.status}] (${entry.source}) ${entry.relativeCaseDir}`,
      );
      if (entry.tags.length > 0) {
        lines.push(`    tags: ${entry.tags.join(", ")}`);
      }
      if (entry.failureModes.length > 0) {
        lines.push(`    failure_modes: ${entry.failureModes.join(", ")}`);
      }
      for (const issue of entry.issues) {
        lines.push(`    * ${issue}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderMarkdown(summary) {
  const lines = [
    "# Lime Harness Eval Summary",
    "",
    `- 生成时间：${summary.generatedAt}`,
    `- manifest：${summary.title} (${summary.manifestVersion})`,
    `- 工作区：\`${summary.workspaceRoot}\``,
    `- suite 数：${summary.totals.suiteCount}`,
    `- case 数：${summary.totals.caseCount}`,
    `- ready：${summary.totals.readyCount}`,
    `- invalid：${summary.totals.invalidCount}`,
    `- pending request case：${summary.totals.pendingRequestCaseCount}`,
    `- needs review case：${summary.totals.needsHumanReviewCount}`,
    "",
  ];

  if (summary.breakdowns.failureModes.length > 0) {
    lines.push("## Failure Mode 分布");
    lines.push("");
    lines.push(
      "| Failure Mode | case | invalid | pending_request | needs_review |",
    );
    lines.push("| --- | --- | --- | --- | --- |");
    for (const entry of summary.breakdowns.failureModes) {
      lines.push(
        `| ${entry.name} | ${entry.caseCount} | ${entry.invalidCount} | ${entry.pendingRequestCaseCount} | ${entry.needsHumanReviewCount} |`,
      );
    }
    lines.push("");
  }

  if (summary.breakdowns.suiteTags.length > 0) {
    lines.push("## Suite Tag 分布");
    lines.push("");
    lines.push("| Suite Tag | case | ready | invalid |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of summary.breakdowns.suiteTags) {
      lines.push(
        `| ${entry.name} | ${entry.caseCount} | ${entry.readyCount} | ${entry.invalidCount} |`,
      );
    }
    lines.push("");
  }

  for (const suite of summary.suites) {
    lines.push(`## ${suite.title}`);
    lines.push("");
    if (suite.description) {
      lines.push(suite.description);
      lines.push("");
    }
    lines.push(`- ` + `suite_id：\`${suite.id}\``);
    if (suite.priority) {
      lines.push(`- 优先级：${suite.priority}`);
    }
    if (suite.roadmap) {
      lines.push(`- 路线图：${suite.roadmap}`);
    }
    lines.push(
      `- ready / total：${suite.stats.readyCount} / ${suite.stats.caseCount}`,
    );
    lines.push("");
    lines.push("| Case | 状态 | 来源 | 分类 | 目录 | 问题 |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const entry of suite.cases) {
      const issueText =
        entry.issues.length === 0 ? "无" : entry.issues.join("<br>");
      const classificationText = [];
      if (entry.tags.length > 0) {
        classificationText.push(`tags: ${entry.tags.join(", ")}`);
      }
      if (entry.failureModes.length > 0) {
        classificationText.push(`failure: ${entry.failureModes.join(", ")}`);
      }
      if (entry.primaryBlockingKind) {
        classificationText.push(`blocking: ${entry.primaryBlockingKind}`);
      }
      lines.push(
        `| ${entry.caseId} | ${entry.status} | ${entry.source} | ${classificationText.join("<br>") || "无"} | \`${entry.relativeCaseDir || "."}\` | ${issueText} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function determineExitCode(summary, options) {
  if (!options.strict) {
    return 0;
  }
  return summary.totals.invalidCount > 0 ? 1 : 0;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  const manifestPath = resolvePath(repoRoot, options.manifest);
  const manifest = readJsonFile(manifestPath);
  const defaults = manifest.defaults ?? {};
  const suiteConfigs = Array.isArray(manifest.suites) ? manifest.suites : [];
  const suites = suiteConfigs.map((suiteConfig) =>
    expandSuiteCases(
      suiteConfig,
      defaults,
      repoRoot,
      path.resolve(options.workspaceRoot),
    ),
  );

  const summary = buildSummary(manifest, suites, options);
  const jsonOutput = `${JSON.stringify(summary, null, 2)}\n`;
  const markdownOutput = renderMarkdown(summary);
  const textOutput = renderText(summary);

  if (options.outputJson) {
    const outputPath = resolvePath(repoRoot, options.outputJson);
    ensureParentDirectory(outputPath);
    fs.writeFileSync(outputPath, jsonOutput, "utf8");
  }

  if (options.outputMarkdown) {
    const outputPath = resolvePath(repoRoot, options.outputMarkdown);
    ensureParentDirectory(outputPath);
    fs.writeFileSync(outputPath, markdownOutput, "utf8");
  }

  if (options.format === "json") {
    process.stdout.write(jsonOutput);
  } else if (options.format === "markdown") {
    process.stdout.write(markdownOutput);
  } else {
    process.stdout.write(textOutput);
  }

  const exitCode = determineExitCode(summary, options);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main();
