#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_MANIFEST_PATH = "docs/test/harness-evals.manifest.json";
const DEFAULT_FIXTURES_ROOT = "docs/test/harness-fixtures/replay";
const DEFAULT_SUITE_ID = "repo-promoted-replays";
const DEFAULT_SANITIZED_WORKSPACE_ROOT = "/workspace/lime";
const REVIEW_DECISION_JSON_FILE_NAME = "review-decision.json";
const REVIEW_DECISION_MARKDOWN_FILE_NAME = "review-decision.md";
const REQUIRED_ARTIFACTS = [
  "input.json",
  "expected.json",
  "grader.md",
  "evidence-links.json",
];
const REVIEW_DECISION_STATUS_SET = new Set([
  "accepted",
  "deferred",
  "rejected",
  "needs_more_evidence",
  "pending_review",
]);
const REVIEW_DECISION_RISK_LEVEL_SET = new Set([
  "low",
  "medium",
  "high",
  "unknown",
]);

function parseArgs(argv) {
  const result = {
    caseId: "",
    dryRun: false,
    fixturesRoot: DEFAULT_FIXTURES_ROOT,
    format: "text",
    help: false,
    manifest: DEFAULT_MANIFEST_PATH,
    replace: false,
    replayDir: "",
    sanitizedWorkspaceRoot: DEFAULT_SANITIZED_WORKSPACE_ROOT,
    sessionId: "",
    slug: "",
    suiteId: DEFAULT_SUITE_ID,
    title: "",
    workspaceRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--session-id" && argv[index + 1]) {
      result.sessionId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--replay-dir" && argv[index + 1]) {
      result.replayDir = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--workspace-root" && argv[index + 1]) {
      result.workspaceRoot = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--manifest" && argv[index + 1]) {
      result.manifest = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--fixtures-root" && argv[index + 1]) {
      result.fixturesRoot = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--suite-id" && argv[index + 1]) {
      result.suiteId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--slug" && argv[index + 1]) {
      result.slug = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--case-id" && argv[index + 1]) {
      result.caseId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--title" && argv[index + 1]) {
      result.title = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--sanitized-workspace-root" && argv[index + 1]) {
      result.sanitizedWorkspaceRoot = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--format" && argv[index + 1]) {
      result.format = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

    if (arg === "--replace") {
      result.replace = true;
      continue;
    }

    if (arg === "--dry-run") {
      result.dryRun = true;
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
Lime Harness Replay Promote

用法:
  node scripts/harness-replay-promote.mjs --session-id "session-123" --slug "pending-request-runtime"
  node scripts/harness-replay-promote.mjs --replay-dir ".lime/harness/sessions/session-123/replay" --slug "pending-request-runtime"

选项:
  --session-id ID                  从 <workspace>/.lime/harness/sessions/<id>/replay 提升
  --replay-dir PATH                直接指定 replay 目录；与 --session-id 二选一
  --workspace-root PATH            工作区根目录，默认当前目录
  --manifest PATH                  manifest 路径，默认 docs/test/harness-evals.manifest.json
  --fixtures-root PATH             目标 fixture 根目录，默认 docs/test/harness-fixtures/replay
  --suite-id ID                    目标 suite，默认 repo-promoted-replays
  --slug NAME                      目标目录名；未提供时会从 sessionId 推导
  --case-id ID                     manifest 中的 case id；默认 repo-promoted-<slug>
  --title TEXT                     manifest 中的 case 标题；默认用 goal summary 推导
  --sanitized-workspace-root PATH  写入仓库样本时替换绝对工作区路径，默认 /workspace/lime
  --replace                        已存在同名 case / 目录时覆盖
  --dry-run                        只预览，不写文件
  --format FMT                     标准输出格式：text | json
  -h, --help                       显示帮助
`);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolvePath(baseDir, targetPath) {
  return path.resolve(baseDir, targetPath);
}

function toPortablePath(value) {
  return String(value).replaceAll("\\", "/");
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

function normalizeEnumString(value, allowedValues, fallback = "") {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (allowedValues.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "";
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function deriveReplayDirectory(options, workspaceRoot) {
  if (options.replayDir) {
    return resolvePath(process.cwd(), options.replayDir);
  }

  if (!options.sessionId) {
    throw new Error("必须提供 --session-id 或 --replay-dir。");
  }

  return path.join(
    workspaceRoot,
    ".lime",
    "harness",
    "sessions",
    options.sessionId,
    "replay",
  );
}

function validateReplayDirectory(replayDir) {
  if (!fs.existsSync(replayDir) || !fs.statSync(replayDir).isDirectory()) {
    throw new Error(`replay 目录不存在: ${replayDir}`);
  }

  const missing = REQUIRED_ARTIFACTS.filter(
    (artifact) => !fs.existsSync(path.join(replayDir, artifact)),
  );
  if (missing.length > 0) {
    throw new Error(`replay 目录缺少文件: ${missing.join(", ")}`);
  }
}

function deriveSlug(options, inputPayload, fallbackSessionId) {
  if (options.slug) {
    return slugify(options.slug);
  }

  const derivedFromGoal = slugify(
    inputPayload?.task?.goalSummary ??
      inputPayload?.classification?.primaryBlockingKind ??
      "",
  );
  if (derivedFromGoal) {
    return derivedFromGoal;
  }

  const derivedFromSession = slugify(fallbackSessionId);
  if (derivedFromSession) {
    return derivedFromSession;
  }

  return "promoted-replay-case";
}

function deriveCaseId(options, slug) {
  return options.caseId || `repo-promoted-${slug}`;
}

function deriveTitle(options, inputPayload, expectedPayload, sessionId) {
  if (options.title) {
    return options.title;
  }

  const goalSummary =
    inputPayload?.task?.goalSummary ?? expectedPayload?.goalSummary ?? "";
  if (typeof goalSummary === "string" && goalSummary.trim().length > 0) {
    return goalSummary.trim();
  }

  return `工作区 Replay 沉淀 / ${sessionId}`;
}

function replaceWorkspaceRootInString(value, workspaceRoot, placeholder) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }

  let nextValue = value;
  const rawRoot = String(workspaceRoot);
  const portableRoot = toPortablePath(rawRoot);

  if (rawRoot) {
    nextValue = nextValue.replaceAll(rawRoot, placeholder);
  }
  if (portableRoot && portableRoot !== rawRoot) {
    nextValue = nextValue.replaceAll(portableRoot, placeholder);
  }

  if (nextValue.includes(placeholder) && nextValue.includes("\\")) {
    nextValue = nextValue.replaceAll("\\", "/");
  }

  return nextValue;
}

function sanitizePayload(value, workspaceRoot, placeholder) {
  if (typeof value === "string") {
    return replaceWorkspaceRootInString(value, workspaceRoot, placeholder);
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      sanitizePayload(entry, workspaceRoot, placeholder),
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        sanitizePayload(entryValue, workspaceRoot, placeholder),
      ]),
    );
  }

  return value;
}

function getRelativeIfInside(rootPath, absolutePath) {
  const relativePath = path.relative(rootPath, absolutePath);
  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath) ||
    relativePath === ""
  ) {
    return relativePath === "" ? "." : null;
  }
  return toPortablePath(relativePath);
}

function buildPromotionMetadata({
  promotedAt,
  replayDir,
  reviewDecision,
  sessionId,
  workspaceRoot,
  sanitizedWorkspaceRoot,
}) {
  const replayRelativeDir = getRelativeIfInside(workspaceRoot, replayDir);
  const metadata = {
    promotedAt,
    promotedBy: "scripts/harness-replay-promote.mjs",
    sanitizedWorkspaceRoot,
    sourceSessionId: sessionId,
  };

  if (replayRelativeDir && replayRelativeDir !== ".") {
    metadata.sourceReplayDir = replayRelativeDir;
  }

  if (reviewDecision) {
    metadata.reviewDecision = reviewDecision;
  }

  return metadata;
}

function appendPromotionSection(graderMarkdown, promotionMetadata) {
  if (graderMarkdown.includes("## 仓库沉淀说明")) {
    return graderMarkdown;
  }

  const lines = [
    graderMarkdown.trimEnd(),
    "",
    "## 仓库沉淀说明",
    "",
    `- 提升时间：${promotionMetadata.promotedAt}`,
    `- 来源会话：\`${promotionMetadata.sourceSessionId}\``,
    `- 脱敏工作区根：\`${promotionMetadata.sanitizedWorkspaceRoot}\``,
  ];

  if (promotionMetadata.sourceReplayDir) {
    lines.push(`- 来源 replay 目录：\`${promotionMetadata.sourceReplayDir}\``);
  }

  return `${lines.join("\n")}\n`;
}

function loadSuite(manifestPayload, suiteId) {
  const suites = Array.isArray(manifestPayload.suites) ? manifestPayload.suites : [];
  const suiteIndex = suites.findIndex(
    (suite) => String(suite.id ?? "").trim() === suiteId,
  );
  if (suiteIndex === -1) {
    throw new Error(`manifest 中未找到目标 suite: ${suiteId}`);
  }
  return {
    suite: suites[suiteIndex],
    suiteIndex,
    suites,
  };
}

function buildManifestCaseEntry({
  caseId,
  caseTitle,
  inputPayload,
  reviewDecision,
  targetCaseDirValue,
}) {
  const entry = {
    id: caseId,
    title: caseTitle,
    source: "repo_fixture",
    caseDir: targetCaseDirValue,
    tags: mergeUniqueStrings(
      ["repo-promoted"],
      inputPayload?.classification?.suiteTags,
    ),
  };

  if (reviewDecision) {
    entry.reviewDecision = reviewDecision;
  }

  return entry;
}

function updateManifestCase({
  manifestPath,
  suiteId,
  caseEntry,
  replace,
  targetCaseDirValue,
}) {
  const manifestPayload = readJsonFile(manifestPath);
  const { suite } = loadSuite(manifestPayload, suiteId);
  const cases = Array.isArray(suite.cases) ? [...suite.cases] : [];
  const normalizedTargetDir = toPortablePath(targetCaseDirValue);

  const existingIndex = cases.findIndex((entry) => {
    const caseId = String(entry.id ?? "").trim();
    const caseDir = toPortablePath(String(entry.caseDir ?? "").trim());
    return caseId === caseEntry.id || caseDir === normalizedTargetDir;
  });

  if (existingIndex >= 0 && !replace) {
    throw new Error(
      `manifest 已存在同名 case 或同目录 case，请使用 --replace 覆盖: ${caseEntry.id}`,
    );
  }

  if (existingIndex >= 0) {
    const existing = cases[existingIndex];
    cases[existingIndex] = {
      ...existing,
      ...caseEntry,
      tags: mergeUniqueStrings(existing.tags, caseEntry.tags),
    };
  } else {
    cases.push(caseEntry);
  }

  cases.sort((left, right) =>
    String(left.id ?? "").localeCompare(String(right.id ?? "")),
  );
  suite.cases = cases;
  writeJsonFile(manifestPath, manifestPayload);

  return {
    manifestPayload,
    replaced: existingIndex >= 0,
  };
}

function writePromotedArtifacts({
  evidencePayload,
  expectedPayload,
  graderMarkdown,
  inputPayload,
  reviewDecisionJson,
  reviewDecisionMarkdown,
  targetDir,
}) {
  ensureDirectory(targetDir);
  writeJsonFile(path.join(targetDir, "input.json"), inputPayload);
  writeJsonFile(path.join(targetDir, "expected.json"), expectedPayload);
  writeJsonFile(path.join(targetDir, "evidence-links.json"), evidencePayload);
  fs.writeFileSync(path.join(targetDir, "grader.md"), graderMarkdown, "utf8");
  if (reviewDecisionJson) {
    writeJsonFile(
      path.join(targetDir, REVIEW_DECISION_JSON_FILE_NAME),
      reviewDecisionJson,
    );
  }
  if (reviewDecisionMarkdown) {
    fs.writeFileSync(
      path.join(targetDir, REVIEW_DECISION_MARKDOWN_FILE_NAME),
      reviewDecisionMarkdown,
      "utf8",
    );
  }
}

function toManifestCaseDirValue(repoRoot, targetDir) {
  const relativeToRepo = path.relative(repoRoot, targetDir);
  if (
    relativeToRepo &&
    !relativeToRepo.startsWith("..") &&
    !path.isAbsolute(relativeToRepo)
  ) {
    return toPortablePath(relativeToRepo);
  }
  return toPortablePath(targetDir);
}

function renderText(result) {
  const lines = [
    `[harness-replay-promote] suite: ${result.suiteId}`,
    `[harness-replay-promote] case : ${result.caseId}`,
    `[harness-replay-promote] title: ${result.title}`,
    `[harness-replay-promote] replay: ${result.sourceReplayDir}`,
    `[harness-replay-promote] target: ${result.targetCaseDir}`,
    `[harness-replay-promote] manifest target: ${result.manifestCaseDir}`,
    `[harness-replay-promote] dry-run: ${result.dryRun ? "yes" : "no"}`,
    `[harness-replay-promote] replaced: ${result.replaced ? "yes" : "no"}`,
  ];

  if (result.tags.length > 0) {
    lines.push(`[harness-replay-promote] tags: ${result.tags.join(", ")}`);
  }

  if (result.reviewDecisionStatus) {
    lines.push(
      `[harness-replay-promote] review decision: ${result.reviewDecisionStatus} / risk=${result.reviewRiskLevel || "unknown"}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function resolveSiblingReviewArtifactPath(replayDir, fileName) {
  return path.resolve(replayDir, "..", "review", fileName);
}

function normalizeReviewDecisionMetadata(reviewDecisionPayload) {
  const decision =
    reviewDecisionPayload &&
    typeof reviewDecisionPayload === "object" &&
    reviewDecisionPayload.decision &&
    typeof reviewDecisionPayload.decision === "object"
      ? reviewDecisionPayload.decision
      : {};
  const decisionStatus = normalizeEnumString(
    decision.decisionStatus ?? decision.decision_status,
    REVIEW_DECISION_STATUS_SET,
    "pending_review",
  );
  const riskLevel = normalizeEnumString(
    decision.riskLevel ?? decision.risk_level,
    REVIEW_DECISION_RISK_LEVEL_SET,
    "unknown",
  );
  const humanReviewer = normalizeOptionalString(
    decision.humanReviewer ?? decision.human_reviewer,
  );
  const reviewedAt = normalizeOptionalString(
    decision.reviewedAt ?? decision.reviewed_at,
  );

  return {
    decisionStatus,
    riskLevel,
    humanReviewer,
    reviewedAt,
  };
}

function loadOptionalReviewDecisionArtifacts({
  replayDir,
  sanitizedWorkspaceRoot,
  workspaceRoot,
}) {
  const reviewDecisionJsonPath = resolveSiblingReviewArtifactPath(
    replayDir,
    REVIEW_DECISION_JSON_FILE_NAME,
  );
  const reviewDecisionMarkdownPath = resolveSiblingReviewArtifactPath(
    replayDir,
    REVIEW_DECISION_MARKDOWN_FILE_NAME,
  );
  const hasJson = fs.existsSync(reviewDecisionJsonPath);
  const hasMarkdown = fs.existsSync(reviewDecisionMarkdownPath);

  if (!hasJson && !hasMarkdown) {
    return {
      metadata: null,
      reviewDecisionJson: null,
      reviewDecisionMarkdown: "",
    };
  }

  const reviewDecisionJson = hasJson
    ? sanitizePayload(
        readJsonFile(reviewDecisionJsonPath),
        workspaceRoot,
        sanitizedWorkspaceRoot,
      )
    : null;
  const reviewDecisionMarkdown = hasMarkdown
    ? replaceWorkspaceRootInString(
        readTextFile(reviewDecisionMarkdownPath),
        workspaceRoot,
        sanitizedWorkspaceRoot,
      )
    : "";

  return {
    metadata: reviewDecisionJson
      ? normalizeReviewDecisionMetadata(reviewDecisionJson)
      : null,
    reviewDecisionJson,
    reviewDecisionMarkdown,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const repoRoot = process.cwd();
  const workspaceRoot = resolvePath(repoRoot, options.workspaceRoot);
  const replayDir = deriveReplayDirectory(options, workspaceRoot);
  validateReplayDirectory(replayDir);

  const inputPath = path.join(replayDir, "input.json");
  const expectedPath = path.join(replayDir, "expected.json");
  const graderPath = path.join(replayDir, "grader.md");
  const evidencePath = path.join(replayDir, "evidence-links.json");

  const originalInputPayload = readJsonFile(inputPath);
  const originalExpectedPayload = readJsonFile(expectedPath);
  const originalEvidencePayload = readJsonFile(evidencePath);
  const originalGraderMarkdown = fs.readFileSync(graderPath, "utf8");

  const sessionId =
    String(
      originalInputPayload?.session?.sessionId ??
        path.basename(path.dirname(replayDir)),
    ).trim() || "unknown-session";
  const slug = deriveSlug(options, originalInputPayload, sessionId);
  if (!slug) {
    throw new Error("无法推导目标 slug，请显式提供 --slug。");
  }

  const caseId = deriveCaseId(options, slug);
  const title = deriveTitle(
    options,
    originalInputPayload,
    originalExpectedPayload,
    sessionId,
  );
  const promotedAt = new Date().toISOString();
  const promotionMetadata = buildPromotionMetadata({
    promotedAt,
    replayDir,
    reviewDecision: undefined,
    sanitizedWorkspaceRoot: options.sanitizedWorkspaceRoot,
    sessionId,
    workspaceRoot,
  });

  const inputPayload = sanitizePayload(
    originalInputPayload,
    workspaceRoot,
    options.sanitizedWorkspaceRoot,
  );
  inputPayload.source = "lime.repo_promoted.replay_case";
  inputPayload.classification = {
    ...(inputPayload.classification ?? {}),
    sourceKind: "repo_promoted_fixture",
  };
  inputPayload.promotion = promotionMetadata;

  const expectedPayload = sanitizePayload(
    originalExpectedPayload,
    workspaceRoot,
    options.sanitizedWorkspaceRoot,
  );
  expectedPayload.promotion = promotionMetadata;

  const evidencePayload = sanitizePayload(
    originalEvidencePayload,
    workspaceRoot,
    options.sanitizedWorkspaceRoot,
  );
  evidencePayload.promotion = promotionMetadata;

  const graderMarkdown = appendPromotionSection(
    replaceWorkspaceRootInString(
      originalGraderMarkdown,
      workspaceRoot,
      options.sanitizedWorkspaceRoot,
    ),
    promotionMetadata,
  );
  const {
    metadata: reviewDecisionMetadata,
    reviewDecisionJson,
    reviewDecisionMarkdown,
  } = loadOptionalReviewDecisionArtifacts({
    replayDir,
    sanitizedWorkspaceRoot: options.sanitizedWorkspaceRoot,
    workspaceRoot,
  });
  if (reviewDecisionMetadata) {
    promotionMetadata.reviewDecision = reviewDecisionMetadata;
  }

  const fixturesRoot = resolvePath(repoRoot, options.fixturesRoot);
  const targetDir = path.join(fixturesRoot, slug);
  const targetExists = fs.existsSync(targetDir);
  if (targetExists && !options.replace) {
    throw new Error(`目标目录已存在，请使用 --replace 覆盖: ${targetDir}`);
  }

  const manifestPath = resolvePath(repoRoot, options.manifest);
  const manifestCaseDir = toManifestCaseDirValue(repoRoot, targetDir);
  const caseEntry = buildManifestCaseEntry({
    caseId,
    caseTitle: title,
    inputPayload,
    reviewDecision: reviewDecisionMetadata,
    targetCaseDirValue: manifestCaseDir,
  });

  let replaced = false;
  if (!options.dryRun) {
    if (targetExists) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    writePromotedArtifacts({
      evidencePayload,
      expectedPayload,
      graderMarkdown,
      inputPayload,
      reviewDecisionJson,
      reviewDecisionMarkdown,
      targetDir,
    });
    const manifestUpdate = updateManifestCase({
      caseEntry,
      manifestPath,
      replace: options.replace,
      suiteId: options.suiteId,
      targetCaseDirValue: manifestCaseDir,
    });
    replaced = manifestUpdate.replaced;
  }

  const result = {
    caseId,
    dryRun: options.dryRun,
    manifestCaseDir,
    manifestPath,
    replaced,
    sanitizedWorkspaceRoot: options.sanitizedWorkspaceRoot,
    slug,
    sourceReplayDir: toPortablePath(replayDir),
    suiteId: options.suiteId,
    tags: caseEntry.tags,
    targetCaseDir: toPortablePath(targetDir),
    title,
  };
  if (reviewDecisionMetadata) {
    result.reviewDecisionStatus = reviewDecisionMetadata.decisionStatus;
    result.reviewRiskLevel = reviewDecisionMetadata.riskLevel;
  }

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderText(result));
}

main();
