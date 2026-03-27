#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_SANITIZED_WORKSPACE_ROOT = "/workspace/lime";
const REQUIRED_REPLAY_ARTIFACTS = [
  "input.json",
  "expected.json",
  "grader.md",
  "evidence-links.json",
];
const HANDOFF_ARTIFACTS = [
  "plan.md",
  "progress.json",
  "handoff.md",
  "review-summary.md",
];
const EVIDENCE_ARTIFACTS = [
  "summary.md",
  "runtime.json",
  "timeline.json",
  "artifacts.json",
];
const ANALYSIS_BRIEF_FILE_NAME = "analysis-brief.md";
const ANALYSIS_CONTEXT_FILE_NAME = "analysis-context.json";

function parseArgs(argv) {
  const result = {
    dryRun: false,
    format: "text",
    help: false,
    outputDir: "",
    replayDir: "",
    sanitizedWorkspaceRoot: DEFAULT_SANITIZED_WORKSPACE_ROOT,
    sessionId: "",
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

    if (arg === "--output-dir" && argv[index + 1]) {
      result.outputDir = String(argv[index + 1]).trim();
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
Lime Harness Analysis Brief Export

用法:
  node scripts/harness-analysis-brief.mjs --session-id "session-123"
  node scripts/harness-analysis-brief.mjs --replay-dir ".lime/harness/sessions/session-123/replay"

选项:
  --session-id ID                  从 <workspace>/.lime/harness/sessions/<id>/replay 生成分析交接包
  --replay-dir PATH                直接指定 replay 目录；与 --session-id 二选一
  --workspace-root PATH            工作区根目录，默认当前目录
  --output-dir PATH                输出目录；默认 <session>/analysis
  --title TEXT                     分析包标题；默认从 goal summary 推导
  --sanitized-workspace-root PATH  导出到外部 AI 时使用的工作区占位路径，默认 /workspace/lime
  --dry-run                        只预览，不写文件
  --format FMT                     标准输出格式：text | json
  -h, --help                       显示帮助
`);
}

function resolvePath(baseDir, targetPath) {
  return path.resolve(baseDir, targetPath);
}

function toPortablePath(value) {
  return String(value).replaceAll("\\", "/");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function truncateText(value, maxLength = 800) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}…`;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
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

function sanitizeValue(value, workspaceRoot, placeholder) {
  if (typeof value === "string") {
    return replaceWorkspaceRootInString(value, workspaceRoot, placeholder);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, workspaceRoot, placeholder));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        sanitizeValue(entryValue, workspaceRoot, placeholder),
      ]),
    );
  }
  return value;
}

function resolveReplayDirectory(options, workspaceRoot) {
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

  const missing = REQUIRED_REPLAY_ARTIFACTS.filter(
    (artifact) => !fs.existsSync(path.join(replayDir, artifact)),
  );
  if (missing.length > 0) {
    throw new Error(`replay 目录缺少文件: ${missing.join(", ")}`);
  }
}

function deriveSessionRootFromReplayDirectory(replayDir) {
  if (path.basename(replayDir) === "replay") {
    return path.dirname(replayDir);
  }
  return replayDir;
}

function safeReadFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return fs.readFileSync(filePath, "utf8");
}

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJsonFile(filePath);
}

function sanitizeAbsolutePathForExternalUse(absolutePath, workspaceRoot, placeholder) {
  const relativePath = path.relative(workspaceRoot, absolutePath);
  if (
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath) &&
    relativePath !== ""
  ) {
    return toPortablePath(path.join(placeholder, relativePath));
  }
  return "";
}

function listExistingArtifacts(rootPath, artifactNames, workspaceRoot, placeholder) {
  return artifactNames.map((fileName) => {
    const absolutePath = path.join(rootPath, fileName);
    const exists = fs.existsSync(absolutePath);
    return {
      fileName,
      exists,
      absolutePath: exists
        ? sanitizeAbsolutePathForExternalUse(
            absolutePath,
            workspaceRoot,
            placeholder,
          )
        : "",
      relativePath: exists ? toPortablePath(path.relative(rootPath, absolutePath)) : "",
    };
  });
}

function deriveTitle(options, inputPayload, replayDir) {
  if (options.title) {
    return options.title;
  }

  const goalSummary = inputPayload?.task?.goalSummary;
  if (typeof goalSummary === "string" && goalSummary.trim().length > 0) {
    return goalSummary.trim();
  }

  const sessionId =
    inputPayload?.session?.sessionId ?? path.basename(path.dirname(replayDir));
  return `外部分析交接 / ${sessionId}`;
}

function buildReadingOrder(handoffArtifacts, evidenceArtifacts) {
  const order = ["先读 replay/input.json 与 replay/expected.json，确认任务目标与判定标准。"]; 

  if (handoffArtifacts.some((entry) => entry.fileName === "handoff.md" && entry.exists)) {
    order.push("再读 handoff/handoff.md 与 handoff/progress.json，确认当前状态、待继续事项与恢复顺序。");
  }

  if (evidenceArtifacts.some((entry) => entry.fileName === "summary.md" && entry.exists)) {
    order.push("再读 evidence/summary.md 与 evidence/runtime.json，确认当前阻塞、pending request 与 diagnostics。");
  }

  if (evidenceArtifacts.some((entry) => entry.fileName === "timeline.json" && entry.exists)) {
    order.push("如需复盘过程，再读 evidence/timeline.json。");
  }

  order.push("最后回看 replay/grader.md，按约定输出根因、修复建议、回归建议与风险项。");
  return order;
}

function buildExternalAnalysisPromptContract() {
  return {
    audience: "Claude Code / Codex",
    task: "基于 Lime 导出的结构化证据做问题分析与修复建议，不直接代替团队做最终决策。",
    requiredSections: [
      "结论",
      "根因判断",
      "关键证据",
      "修复建议",
      "回归建议",
      "风险与未知项",
    ],
    rules: [
      "优先引用现有证据文件，不要求重建完整会话。",
      "如果证据不足，显式列出缺口，不要假装已经确认。",
      "只给分析与建议，不直接替团队批准或拒绝修复方案。",
      "如果怀疑路径、凭证或外部系统状态影响结论，先标注为待人工复核。",
    ],
  };
}

function buildHumanReviewChecklist(inputPayload, expectedPayload) {
  const checklist = [
    "确认外部 AI 是否引用了现有证据，而不是凭空推断。",
    "确认修复建议是否直接服务当前失败模式，而不是顺手扩大范围。",
    "确认回归建议是否能沉淀为 replay / eval / smoke，而不是停留在口头建议。",
  ];

  if (expectedPayload?.graderSuggestion?.requiresHumanReview === true) {
    checklist.unshift("当前样本本来就要求人工复核，不应把外部 AI 结论当成最终裁决。");
  }

  if (
    normalizeStringList(inputPayload?.classification?.failureModes).includes(
      "pending_request",
    )
  ) {
    checklist.push("确认外部 AI 没有把 pending request 误判成已完成。");
  }

  return checklist;
}

function buildAnalysisContext({
  evidenceArtifacts,
  evidenceJson,
  evidenceRoot,
  expectedPayload,
  handoffArtifacts,
  handoffJson,
  inputPayload,
  options,
  replayDir,
  replayRootArtifacts,
  sessionRoot,
  title,
  workspaceRoot,
}) {
  const sanitizedInput = sanitizeValue(
    {
      session: inputPayload?.session ?? {},
      task: inputPayload?.task ?? {},
      classification: inputPayload?.classification ?? {},
      runtimeContext: {
        pendingRequests: inputPayload?.runtimeContext?.pendingRequests ?? [],
        queuedTurns: inputPayload?.runtimeContext?.queuedTurns ?? [],
        todoItems: inputPayload?.runtimeContext?.todoItems ?? [],
        activeSubagents: inputPayload?.runtimeContext?.activeSubagents ?? [],
      },
      linkedArtifacts: inputPayload?.linkedArtifacts ?? {},
    },
    workspaceRoot,
    options.sanitizedWorkspaceRoot,
  );

  const sanitizedExpected = sanitizeValue(
    {
      goalSummary: expectedPayload?.goalSummary ?? "",
      successCriteria: expectedPayload?.successCriteria ?? [],
      blockingChecks: expectedPayload?.blockingChecks ?? [],
      artifactChecks: expectedPayload?.artifactChecks ?? [],
      graderSuggestion: expectedPayload?.graderSuggestion ?? {},
      nonGoals: expectedPayload?.nonGoals ?? [],
    },
    workspaceRoot,
    options.sanitizedWorkspaceRoot,
  );

  return {
    schemaVersion: "v1",
    source: {
      contractShape: "lime_external_analysis_handoff",
      derivedFrom: [
        "lime_workspace_handoff_bundle",
        "lime_workspace_evidence_pack",
        "lime_runtime_export_replay_case",
      ],
    },
    title,
    exportedAt: new Date().toISOString(),
    sanitizedWorkspaceRoot: options.sanitizedWorkspaceRoot,
    replayRoot:
      sanitizeAbsolutePathForExternalUse(
        replayDir,
        workspaceRoot,
        options.sanitizedWorkspaceRoot,
      ) || "",
    summary: {
      sessionId: sanitizedInput.session.sessionId ?? "",
      threadId: sanitizedInput.session.threadId ?? "",
      executionStrategy: sanitizedInput.session.executionStrategy ?? "",
      model: sanitizedInput.session.model ?? "",
      goalSummary: sanitizedInput.task.goalSummary ?? "",
      latestTurnStatus:
        sanitizedInput.task.latestTurnStatus ??
        handoffJson?.status?.latestTurnStatus ??
        evidenceJson?.thread?.latestTurnStatus ??
        "",
      threadStatus:
        sanitizedInput.task.threadStatus ??
        handoffJson?.status?.threadStatus ??
        evidenceJson?.thread?.status ??
        "",
      primaryBlockingKind:
        sanitizedInput.classification.primaryBlockingKind ??
        handoffJson?.diagnostics?.primaryBlockingKind ??
        evidenceJson?.thread?.diagnostics?.primaryBlockingKind ??
        "",
      primaryBlockingSummary:
        sanitizedInput.task.primaryBlockingSummary ??
        handoffJson?.diagnostics?.primaryBlockingSummary ??
        evidenceJson?.thread?.diagnostics?.primaryBlockingSummary ??
        "",
      failureModes: sanitizedInput.classification.failureModes ?? [],
      suiteTags: sanitizedInput.classification.suiteTags ?? [],
      pendingRequestCount:
        Array.isArray(sanitizedInput.runtimeContext.pendingRequests)
          ? sanitizedInput.runtimeContext.pendingRequests.length
          : handoffJson?.status?.pendingRequestCount ??
            evidenceJson?.thread?.pendingRequestCount ??
            0,
      queuedTurnCount:
        Array.isArray(sanitizedInput.runtimeContext.queuedTurns)
          ? sanitizedInput.runtimeContext.queuedTurns.length
          : handoffJson?.status?.queuedTurnCount ??
            evidenceJson?.thread?.queuedTurnCount ??
            0,
    },
    replay: {
      artifacts: replayRootArtifacts,
      graderExcerpt: truncateText(
        sanitizeValue(
          safeReadFile(path.join(replayDir, "grader.md")) ?? "",
          workspaceRoot,
          options.sanitizedWorkspaceRoot,
        ),
      ),
      input: sanitizedInput,
      expected: sanitizedExpected,
    },
    handoff: {
      artifacts: handoffArtifacts,
      progress: sanitizeValue(handoffJson ?? {}, workspaceRoot, options.sanitizedWorkspaceRoot),
      handoffExcerpt: truncateText(
        sanitizeValue(
          safeReadFile(path.join(sessionRoot, "handoff.md")) ?? "",
          workspaceRoot,
          options.sanitizedWorkspaceRoot,
        ),
      ),
      reviewSummaryExcerpt: truncateText(
        sanitizeValue(
          safeReadFile(path.join(sessionRoot, "review-summary.md")) ?? "",
          workspaceRoot,
          options.sanitizedWorkspaceRoot,
        ),
      ),
    },
    evidence: {
      artifacts: evidenceArtifacts,
      runtime: sanitizeValue(evidenceJson ?? {}, workspaceRoot, options.sanitizedWorkspaceRoot),
      summaryExcerpt: truncateText(
        sanitizeValue(
          safeReadFile(path.join(evidenceRoot, "summary.md")) ?? "",
          workspaceRoot,
          options.sanitizedWorkspaceRoot,
        ),
      ),
    },
    readingOrder: buildReadingOrder(handoffArtifacts, evidenceArtifacts),
    externalAnalysisContract: buildExternalAnalysisPromptContract(),
    humanReviewChecklist: buildHumanReviewChecklist(inputPayload, expectedPayload),
  };
}

function renderArtifactList(artifacts, labelPrefix) {
  const available = artifacts.filter((entry) => entry.exists);
  if (available.length === 0) {
    return ["- 当前未检测到可用文件。"];
  }

  return available.map(
    (entry) =>
      `- \`${labelPrefix}${entry.relativePath}\`${
        entry.absolutePath ? `  (${entry.absolutePath})` : ""
      }`,
  );
}

function buildAnalysisBrief(context) {
  const lines = [
    "# 外部分析交接简报",
    "",
    `- 标题：${context.title}`,
    `- 生成时间：${context.exportedAt}`,
    `- 会话：\`${context.summary.sessionId || "unknown"}\``,
    `- 线程：\`${context.summary.threadId || "unknown"}\``,
    `- 执行策略：${context.summary.executionStrategy || "unknown"}`,
    `- 模型：${context.summary.model || "unknown"}`,
    "",
    "## 当前问题",
    "",
    `- 目标摘要：${context.summary.goalSummary || "未知"}`,
    `- 线程状态：${context.summary.threadStatus || "未知"}`,
    `- 最新 turn 状态：${context.summary.latestTurnStatus || "未知"}`,
    `- 主要阻塞：${context.summary.primaryBlockingKind || "未知"}${context.summary.primaryBlockingSummary ? ` · ${context.summary.primaryBlockingSummary}` : ""}`,
    `- failure modes：${
      context.summary.failureModes.length > 0
        ? context.summary.failureModes.join(", ")
        : "无"
    }`,
    `- suite tags：${
      context.summary.suiteTags.length > 0
        ? context.summary.suiteTags.join(", ")
        : "无"
    }`,
    `- pending request：${context.summary.pendingRequestCount}`,
    `- queued turn：${context.summary.queuedTurnCount}`,
    "",
    "## 推荐读取顺序",
    "",
    ...context.readingOrder.map((entry, index) => `${index + 1}. ${entry}`),
    "",
    "## Replay 文件",
    "",
    ...renderArtifactList(context.replay.artifacts, "replay/"),
    "",
    "## Handoff 文件",
    "",
    ...renderArtifactList(context.handoff.artifacts, ""),
    "",
    "## Evidence 文件",
    "",
    ...renderArtifactList(context.evidence.artifacts, "evidence/"),
    "",
    "## 可直接给外部 AI 的任务说明",
    "",
    "```text",
    "你将收到一个由 Lime 导出的分析包。你的职责是做问题分析和修复建议，不直接替团队做最终决策。",
    "",
    "请优先读取 analysis-context.json 与 analysis-brief.md 中提到的 replay / handoff / evidence 文件。",
    "",
    "输出必须包含以下部分：",
    "- 结论",
    "- 根因判断",
    "- 关键证据",
    "- 修复建议",
    "- 回归建议",
    "- 风险与未知项",
    "",
    "约束：",
    "- 优先引用现有证据，不要假装看到不存在的信息。",
    "- 如果证据不足，明确写出缺口和需要人工确认的地方。",
    "- 不直接代表团队批准、拒绝或自动应用修复方案。",
    "```",
    "",
    "## 人工审核检查清单",
    "",
    ...context.humanReviewChecklist.map((entry) => `- ${entry}`),
    "",
    "## 关键摘录",
    "",
    "### Replay Grader 摘录",
    "",
    context.replay.graderExcerpt || "当前无可用摘录。",
    "",
    "### Handoff 摘录",
    "",
    context.handoff.handoffExcerpt || "当前无可用摘录。",
    "",
    "### Evidence 摘录",
    "",
    context.evidence.summaryExcerpt || "当前无可用摘录。",
    "",
    "## 注意",
    "",
    `- 所有路径默认已按 \`${context.sanitizedWorkspaceRoot}\` 占位规则输出，便于外部 AI 消费。`,
    "- 这份简报只负责分析交接，不负责自动修复或自动回写 Lime。",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function renderText(result) {
  return [
    `[harness-analysis] title : ${result.title}`,
    `[harness-analysis] replay: ${result.replayDir}`,
    `[harness-analysis] output: ${result.outputDir}`,
    `[harness-analysis] brief : ${result.briefPath}`,
    `[harness-analysis] json  : ${result.contextPath}`,
    `[harness-analysis] dry-run: ${result.dryRun ? "yes" : "no"}`,
  ].join("\n").concat("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const workspaceRoot = resolvePath(process.cwd(), options.workspaceRoot);
  const replayDir = resolveReplayDirectory(options, workspaceRoot);
  validateReplayDirectory(replayDir);

  const inputPayload = readJsonFile(path.join(replayDir, "input.json"));
  const expectedPayload = readJsonFile(path.join(replayDir, "expected.json"));
  const sessionRoot = deriveSessionRootFromReplayDirectory(replayDir);
  const evidenceRoot = path.join(sessionRoot, "evidence");
  const outputDir = options.outputDir
    ? resolvePath(process.cwd(), options.outputDir)
    : path.join(sessionRoot, "analysis");

  const workspaceRootFromInput =
    inputPayload?.session?.workspaceRoot && typeof inputPayload.session.workspaceRoot === "string"
      ? path.resolve(inputPayload.session.workspaceRoot)
      : workspaceRoot;

  const replayRootArtifacts = listExistingArtifacts(
    replayDir,
    REQUIRED_REPLAY_ARTIFACTS,
    workspaceRootFromInput,
    options.sanitizedWorkspaceRoot,
  );
  const handoffArtifacts = listExistingArtifacts(
    sessionRoot,
    HANDOFF_ARTIFACTS,
    workspaceRootFromInput,
    options.sanitizedWorkspaceRoot,
  );
  const evidenceArtifacts = listExistingArtifacts(
    evidenceRoot,
    EVIDENCE_ARTIFACTS,
    workspaceRootFromInput,
    options.sanitizedWorkspaceRoot,
  );

  const handoffJson = safeReadJson(path.join(sessionRoot, "progress.json"));
  const evidenceJson = safeReadJson(path.join(evidenceRoot, "runtime.json"));

  const title = deriveTitle(options, inputPayload, replayDir);
  const analysisContext = buildAnalysisContext({
    evidenceArtifacts,
    evidenceJson,
    evidenceRoot,
    expectedPayload,
    handoffArtifacts,
    handoffJson,
    inputPayload,
    options,
    replayDir,
    replayRootArtifacts,
    sessionRoot,
    title,
    workspaceRoot: workspaceRootFromInput,
  });
  const analysisBrief = buildAnalysisBrief(analysisContext);

  const briefPath = path.join(outputDir, ANALYSIS_BRIEF_FILE_NAME);
  const contextPath = path.join(outputDir, ANALYSIS_CONTEXT_FILE_NAME);

  if (!options.dryRun) {
    ensureDirectory(outputDir);
    fs.writeFileSync(briefPath, analysisBrief, "utf8");
    writeJsonFile(contextPath, analysisContext);
  }

  const result = {
    briefPath: toPortablePath(briefPath),
    contextPath: toPortablePath(contextPath),
    dryRun: options.dryRun,
    outputDir: toPortablePath(outputDir),
    replayDir: toPortablePath(replayDir),
    title,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderText(result));
}

main();
