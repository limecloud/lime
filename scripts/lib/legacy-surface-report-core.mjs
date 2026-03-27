import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import legacySurfaceCatalog from "../../src/lib/governance/legacySurfaceCatalog.json" with { type: "json" };
import {
  buildLegacySurfaceSummary,
  getCommandStatus,
  getImportStatus,
  getTextCountStatus,
  getTextStatus,
  serializeMapEntries,
} from "./legacy-surface-report-summary.mjs";

const repoRoot = path.resolve(process.cwd());
const sourceRoots = ["src"];
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const rustSourceRoots = ["src-tauri/src", "src-tauri/crates"];
const rustSourceExtensions = new Set([".rs"]);
const ignoredDirs = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  ".git",
  ".turbo",
  ".next",
]);

const {
  imports: importSurfaceMonitors,
  commands: commandSurfaceMonitors,
  frontendText: frontendTextSurfaceMonitors,
  rustText: rustTextSurfaceMonitors,
  rustTextCounts: rustTextCountMonitors,
} = legacySurfaceCatalog;

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function resolveExistingSourcePath(absolutePath) {
  if (fs.existsSync(absolutePath)) {
    const stats = fs.statSync(absolutePath);
    if (stats.isFile()) {
      return absolutePath;
    }
  }

  if (!path.extname(absolutePath)) {
    for (const extension of sourceExtensions) {
      const fileCandidate = `${absolutePath}${extension}`;
      if (fs.existsSync(fileCandidate) && fs.statSync(fileCandidate).isFile()) {
        return fileCandidate;
      }
    }
  }

  for (const extension of sourceExtensions) {
    const indexCandidate = path.join(absolutePath, `index${extension}`);
    if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
      return indexCandidate;
    }
  }

  return null;
}

function resolveImportPath(importerRelativePath, specifier) {
  let absoluteCandidate = null;

  if (specifier.startsWith("@/")) {
    absoluteCandidate = path.join(repoRoot, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    absoluteCandidate = path.resolve(
      path.dirname(path.join(repoRoot, importerRelativePath)),
      specifier,
    );
  }

  if (!absoluteCandidate) {
    return null;
  }

  const resolvedPath = resolveExistingSourcePath(absoluteCandidate);
  if (!resolvedPath) {
    return null;
  }

  return normalizePath(path.relative(repoRoot, resolvedPath));
}

function isTestFile(relativePath) {
  return (
    /(^|\/)tests(\/|$)/.test(relativePath) ||
    /(^|\/)(__tests__|__mocks__)(\/|$)/.test(relativePath) ||
    /\.(test|spec)\.[^/.]+$/.test(relativePath)
  );
}

function walkDirectory(directoryPath, extensions) {
  const files = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDirectory(fullPath, extensions));
      continue;
    }

    if (!extensions.has(path.extname(entry.name))) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function extractImportSpecifiers(sourceCode) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bexport\s+(?:type\s+)?[\s\S]*?\s+from\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\b(?:vi|jest)\.mock\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of sourceCode.matchAll(pattern)) {
      specifiers.add(match[1]);
    }
  }

  return specifiers;
}

function extractInvokeCommands(sourceCode) {
  const commands = new Set();
  const patterns = [
    /\bsafeInvoke(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\binvoke(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
  ];

  for (const pattern of patterns) {
    for (const match of sourceCode.matchAll(pattern)) {
      commands.add(match[1]);
    }
  }

  return commands;
}

function stripRustTestModules(sourceCode) {
  return sourceCode.replace(
    /(?:^|\n)\s*#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]\s*(?:pub\s+)?mod\s+\w+\s*(?:\{[\s\S]*$|;)/m,
    "\n",
  );
}

function collectSources() {
  const runtimeSources = [];
  const testSources = [];

  for (const root of sourceRoots) {
    const absoluteRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    for (const filePath of walkDirectory(absoluteRoot, sourceExtensions)) {
      const relativePath = normalizePath(path.relative(repoRoot, filePath));
      const sourceCode = fs.readFileSync(filePath, "utf8");
      const imports = extractImportSpecifiers(sourceCode);
      const collectedSource = {
        relativePath,
        imports,
        resolvedImports: new Set(
          [...imports]
            .map((specifier) => resolveImportPath(relativePath, specifier))
            .filter(Boolean),
        ),
        commands: extractInvokeCommands(sourceCode),
      };

      if (isTestFile(relativePath)) {
        testSources.push(collectedSource);
        continue;
      }

      runtimeSources.push(collectedSource);
    }
  }

  return {
    runtimeSources,
    testSources,
  };
}

function collectTextSources(roots, extensions) {
  const runtimeSources = [];
  const testSources = [];

  for (const root of roots) {
    const absoluteRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    for (const filePath of walkDirectory(absoluteRoot, extensions)) {
      const relativePath = normalizePath(path.relative(repoRoot, filePath));
      const sourceCode = fs.readFileSync(filePath, "utf8");
      const collectedSource = {
        relativePath,
        sourceCode:
          path.extname(relativePath) === ".rs"
            ? stripRustTestModules(sourceCode)
            : sourceCode,
        rawSourceCode: sourceCode,
      };

      if (isTestFile(relativePath)) {
        testSources.push(collectedSource);
        continue;
      }

      runtimeSources.push(collectedSource);
    }
  }

  return {
    runtimeSources,
    testSources,
  };
}

function formatPaths(paths) {
  if (paths.length === 0) {
    return "无";
  }

  return paths.map((item) => `    - ${item}`).join("\n");
}

function evaluateImportMonitor(monitor, runtimeSources, testSources) {
  const existingTargets = monitor.targets.filter((target) =>
    fs.existsSync(path.join(repoRoot, target)),
  );
  const missingTargets = monitor.targets.filter(
    (target) => !fs.existsSync(path.join(repoRoot, target)),
  );
  const references = runtimeSources
    .filter((file) =>
      [...file.resolvedImports].some((resolvedPath) =>
        monitor.targets.includes(resolvedPath),
      ),
    )
    .map((file) => file.relativePath)
    .sort();
  const testReferences = testSources
    .filter((file) =>
      [...file.resolvedImports].some((resolvedPath) =>
        monitor.targets.includes(resolvedPath),
      ),
    )
    .map((file) => file.relativePath)
    .sort();

  const violations = references.filter(
    (relativePath) => !monitor.allowedPaths.includes(relativePath),
  );

  return {
    ...monitor,
    existingTargets,
    missingTargets,
    references,
    testReferences,
    violations,
  };
}

function evaluateCommandMonitor(monitor, runtimeSources, testSources) {
  const referencesByCommand = new Map();
  const testReferencesByCommand = new Map();

  for (const command of monitor.commands) {
    referencesByCommand.set(
      command,
      runtimeSources
        .filter((file) => file.commands.has(command))
        .map((file) => file.relativePath)
        .sort(),
    );
    testReferencesByCommand.set(
      command,
      testSources
        .filter((file) => file.commands.has(command))
        .map((file) => file.relativePath)
        .sort(),
    );
  }

  const violations = [];
  for (const [command, references] of referencesByCommand.entries()) {
    for (const relativePath of references) {
      if (!monitor.allowedPaths.includes(relativePath)) {
        violations.push(`${command} -> ${relativePath}`);
      }
    }
  }

  return {
    ...monitor,
    referencesByCommand,
    testReferencesByCommand,
    violations,
  };
}

function evaluateTextMonitor(monitor, runtimeSources, testSources) {
  const filteredRuntimeSources = monitor.includePathPrefixes
    ? runtimeSources.filter((file) =>
        monitor.includePathPrefixes.some((prefix) =>
          file.relativePath.startsWith(prefix),
        ),
      )
    : runtimeSources;
  const filteredTestSources = monitor.includePathPrefixes
    ? testSources.filter((file) =>
        monitor.includePathPrefixes.some((prefix) =>
          file.relativePath.startsWith(prefix),
        ),
      )
    : testSources;
  const matchesPattern = (sourceCode) =>
    monitor.patterns.some((pattern) => sourceCode.includes(pattern)) ||
    (monitor.regexPatterns ?? []).some((pattern) =>
      new RegExp(pattern, "m").test(sourceCode),
    );

  const references = filteredRuntimeSources
    .filter((file) => matchesPattern(file.sourceCode))
    .map((file) => file.relativePath)
    .sort();
  const testReferences = filteredTestSources
    .filter((file) => matchesPattern(file.rawSourceCode ?? file.sourceCode))
    .map((file) => file.relativePath)
    .sort();
  const violations = references.filter(
    (relativePath) => !monitor.allowedPaths.includes(relativePath),
  );

  return {
    ...monitor,
    references,
    testReferences,
    violations,
  };
}

function countOccurrences(sourceCode, pattern) {
  if (!pattern) {
    return 0;
  }

  let count = 0;
  let startIndex = 0;

  while (true) {
    const matchIndex = sourceCode.indexOf(pattern, startIndex);
    if (matchIndex === -1) {
      return count;
    }
    count += 1;
    startIndex = matchIndex + pattern.length;
  }
}

function evaluateTextCountMonitor(monitor, runtimeSources, testSources) {
  const filteredRuntimeSources = monitor.includePathPrefixes
    ? runtimeSources.filter((file) =>
        monitor.includePathPrefixes.some((prefix) =>
          file.relativePath.startsWith(prefix),
        ),
      )
    : runtimeSources;
  const filteredTestSources = monitor.includePathPrefixes
    ? testSources.filter((file) =>
        monitor.includePathPrefixes.some((prefix) =>
          file.relativePath.startsWith(prefix),
        ),
      )
    : testSources;
  const runtimeMatches = [];
  const testMatches = [];
  const violations = [];

  for (const file of filteredRuntimeSources) {
    const counts = monitor.occurrences
      .map((rule) => ({
        ...rule,
        count: countOccurrences(file.sourceCode, rule.pattern),
      }))
      .filter((rule) => rule.count > 0);

    if (counts.length === 0) {
      continue;
    }

    runtimeMatches.push({
      relativePath: file.relativePath,
      counts,
    });

    for (const rule of counts) {
      if (rule.count > rule.maxCount) {
        violations.push(
          `${file.relativePath} -> ${rule.pattern} (${rule.count} > ${rule.maxCount})`,
        );
      }
    }
  }

  for (const file of filteredTestSources) {
    const counts = monitor.occurrences
      .map((rule) => ({
        ...rule,
        count: countOccurrences(
          file.rawSourceCode ?? file.sourceCode,
          rule.pattern,
        ),
      }))
      .filter((rule) => rule.count > 0);

    if (counts.length === 0) {
      continue;
    }

    testMatches.push({
      relativePath: file.relativePath,
      counts,
    });
  }

  return {
    ...monitor,
    runtimeMatches,
    testMatches,
    violations,
  };
}

function printImportReport(result) {
  const status = getImportStatus(result);

  console.log(
    `- [${status}] ${result.id} (${result.classification})：${result.description}`,
  );
  console.log(`  目标文件：${result.targets.join(", ")}`);
  console.log(`  允许引用：${result.allowedPaths.join(", ") || "无"}`);
  if (result.missingTargets.length > 0) {
    console.log(`  已删除目标：\n${formatPaths(result.missingTargets)}`);
  }
  console.log(`  实际引用：\n${formatPaths(result.references)}`);
  console.log(`  测试引用：\n${formatPaths(result.testReferences)}`);

  if (result.violations.length > 0) {
    console.log(`  违规引用：\n${formatPaths(result.violations)}`);
  }
}

function printCommandReport(result) {
  const status = getCommandStatus(result);

  console.log(
    `- [${status}] ${result.id} (${result.classification})：${result.description}`,
  );
  console.log(`  命令：${result.commands.join(", ")}`);
  console.log(`  允许引用：${result.allowedPaths.join(", ") || "无"}`);

  for (const command of result.commands) {
    const references = result.referencesByCommand.get(command) ?? [];
    const testReferences = result.testReferencesByCommand.get(command) ?? [];
    console.log(`  ${command}：\n${formatPaths(references)}`);
    console.log(`  ${command}（测试）：\n${formatPaths(testReferences)}`);
  }

  if (result.violations.length > 0) {
    console.log(`  违规引用：\n${formatPaths(result.violations)}`);
  }
}

function printTextReport(result) {
  const status = getTextStatus(result);

  console.log(
    `- [${status}] ${result.id} (${result.classification})：${result.description}`,
  );
  const keywords = [
    ...result.patterns,
    ...(result.regexPatterns ?? []).map((pattern) => `regex:${pattern}`),
  ];
  console.log(`  关键字：${keywords.join(", ")}`);
  console.log(`  允许引用：${result.allowedPaths.join(", ") || "无"}`);
  console.log(`  实际引用：\n${formatPaths(result.references)}`);
  console.log(`  测试引用：\n${formatPaths(result.testReferences)}`);

  if (result.violations.length > 0) {
    console.log(`  违规引用：\n${formatPaths(result.violations)}`);
  }
}

function printTextCountReport(result) {
  const status = getTextCountStatus(result);

  console.log(
    `- [${status}] ${result.id} (${result.classification})：${result.description}`,
  );
  console.log(
    `  次数规则：${result.occurrences
      .map((rule) => `${rule.pattern} <= ${rule.maxCount}`)
      .join("；")}`,
  );
  console.log(
    `  实际命中：\n${formatPaths(
      result.runtimeMatches.map(
        (item) =>
          `${item.relativePath} -> ${item.counts
            .map((rule) => `${rule.pattern} (${rule.count})`)
            .join("；")}`,
      ),
    )}`,
  );
  console.log(
    `  测试命中：\n${formatPaths(
      result.testMatches.map(
        (item) =>
          `${item.relativePath} -> ${item.counts
            .map((rule) => `${rule.pattern} (${rule.count})`)
            .join("；")}`,
      ),
    )}`,
  );

  if (result.violations.length > 0) {
    console.log(`  违规引用：\n${formatPaths(result.violations)}`);
  }
}

export function buildLegacySurfaceReport() {
  const { runtimeSources, testSources } = collectSources();
  const {
    runtimeSources: frontendRuntimeTextSources,
    testSources: frontendTestTextSources,
  } = collectTextSources(sourceRoots, sourceExtensions);
  const { runtimeSources: rustRuntimeSources, testSources: rustTestSources } =
    collectTextSources(rustSourceRoots, rustSourceExtensions);
  const importResults = importSurfaceMonitors.map((monitor) =>
    evaluateImportMonitor(monitor, runtimeSources, testSources),
  );
  const commandResults = commandSurfaceMonitors.map((monitor) =>
    evaluateCommandMonitor(monitor, runtimeSources, testSources),
  );
  const frontendTextResults = frontendTextSurfaceMonitors.map((monitor) =>
    evaluateTextMonitor(
      monitor,
      frontendRuntimeTextSources,
      frontendTestTextSources,
    ),
  );
  const rustTextResults = rustTextSurfaceMonitors.map((monitor) =>
    evaluateTextMonitor(monitor, rustRuntimeSources, rustTestSources),
  );
  const rustTextCountResults = rustTextCountMonitors.map((monitor) =>
    evaluateTextCountMonitor(monitor, rustRuntimeSources, rustTestSources),
  );
  const summary = buildLegacySurfaceSummary({
    importResults,
    commandResults,
    frontendTextResults,
    rustTextResults,
    rustTextCountResults,
  });

  return {
    repoRoot,
    runtimeSources,
    testSources,
    rustRuntimeSources,
    rustTestSources,
    importResults,
    commandResults,
    frontendTextResults,
    rustTextResults,
    rustTextCountResults,
    ...summary,
  };
}

export function toSerializableLegacySurfaceReport(report) {
  return {
    repoRoot: report.repoRoot,
    summary: {
      runtimeSourceCount: report.runtimeSources.length,
      testSourceCount: report.testSources.length,
      rustRuntimeSourceCount: report.rustRuntimeSources.length,
      rustTestSourceCount: report.rustTestSources.length,
      zeroReferenceCandidates: report.zeroReferenceCandidates,
      classificationDriftCandidates: report.classificationDriftCandidates,
      violations: report.violations,
    },
    importResults: report.importResults,
    commandResults: report.commandResults.map((result) => ({
      ...result,
      referencesByCommand: serializeMapEntries(result.referencesByCommand),
      testReferencesByCommand: serializeMapEntries(
        result.testReferencesByCommand,
      ),
    })),
    frontendTextResults: report.frontendTextResults,
    rustTextResults: report.rustTextResults,
    rustTextCountResults: report.rustTextCountResults,
  };
}

export function printLegacySurfaceReport(report) {
  console.log("[lime] legacy surface report");
  console.log("");
  console.log("## 入口引用");
  for (const result of report.importResults) {
    printImportReport(result);
  }

  console.log("");
  console.log("## 命令边界");
  for (const result of report.commandResults) {
    printCommandReport(result);
  }

  console.log("");
  console.log("## 前端护栏");
  for (const result of report.frontendTextResults) {
    printTextReport(result);
  }

  console.log("");
  console.log("## Rust 护栏");
  for (const result of report.rustTextResults) {
    printTextReport(result);
  }
  for (const result of report.rustTextCountResults) {
    printTextCountReport(result);
  }

  console.log("");
  console.log("## 摘要");
  console.log(`- 扫描文件数：${report.runtimeSources.length}`);
  console.log(`- 测试文件数：${report.testSources.length}`);
  console.log(`- Rust 扫描文件数：${report.rustRuntimeSources.length}`);
  console.log(`- Rust 测试文件数：${report.rustTestSources.length}`);
  console.log(`- 零引用候选：${report.zeroReferenceCandidates.length}`);
  for (const candidate of report.zeroReferenceCandidates) {
    console.log(`  - ${candidate}`);
  }
  console.log(`- 分类漂移候选：${report.classificationDriftCandidates.length}`);
  for (const candidate of report.classificationDriftCandidates) {
    console.log(`  - ${candidate}`);
  }
  console.log(`- 边界违规：${report.violations.length}`);
  for (const violation of report.violations) {
    console.log(`  - ${violation}`);
  }
}
