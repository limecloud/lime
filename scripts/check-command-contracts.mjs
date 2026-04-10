#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

const sourceRoots = ["src"];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ignoredDirectories = new Set([
  ".git",
  ".idea",
  ".vscode",
  "coverage",
  "dist",
  "docs",
  "node_modules",
  "target",
]);

const frontendCommandPatterns = [
  /\bsafeInvoke(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\binvoke(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
  /\binvokeAgentRuntimeBridge(?:<[^>]+>)?\s*\(\s*["'`]([^"'`]+)["'`]/g,
];

const knownDeferredRegistrationReasons = new Map();

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function isRuntimeSource(relativePath) {
  const normalizedPath = normalizePath(relativePath);
  const extension = path.extname(normalizedPath);
  if (!sourceExtensions.has(extension)) {
    return false;
  }
  if (normalizedPath.endsWith(".d.ts")) {
    return false;
  }
  if (
    normalizedPath.includes("/__tests__/") ||
    normalizedPath.includes("/__mocks__/") ||
    /\.test\.[^.]+$/.test(normalizedPath) ||
    /\.spec\.[^.]+$/.test(normalizedPath)
  ) {
    return false;
  }
  return true;
}

function walkDirectory(rootDirectory) {
  const results = [];
  if (!fs.existsSync(rootDirectory)) {
    return results;
  }

  const entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDirectory(absolutePath));
      continue;
    }

    const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
    if (isRuntimeSource(relativePath)) {
      results.push(relativePath);
    }
  }

  return results;
}

function addUsage(map, command, relativePath) {
  if (!map.has(command)) {
    map.set(command, new Set());
  }
  map.get(command).add(relativePath);
}

function isFrameworkPluginCommand(command) {
  return command.startsWith("plugin:");
}

function extractCommandsFromSource(sourceCode) {
  const commands = new Set();
  for (const pattern of frontendCommandPatterns) {
    for (const match of sourceCode.matchAll(pattern)) {
      const command = match[1];
      if (isFrameworkPluginCommand(command)) {
        continue;
      }
      commands.add(command);
    }
  }
  return commands;
}

function collectFrontendCommandUsage() {
  const commandUsage = new Map();
  for (const root of sourceRoots) {
    const absoluteRoot = path.join(repoRoot, root);
    for (const relativePath of walkDirectory(absoluteRoot)) {
      const absolutePath = path.join(repoRoot, relativePath);
      const sourceCode = fs.readFileSync(absolutePath, "utf8");
      for (const command of extractCommandsFromSource(sourceCode)) {
        addUsage(commandUsage, command, relativePath);
      }
    }
  }
  return commandUsage;
}

function collectAgentRuntimeSchemaUsage() {
  const commandUsage = new Map();
  const schemaPath = path.join(
    repoRoot,
    "src/lib/governance/agentRuntimeCommandSchema.json",
  );
  if (!fs.existsSync(schemaPath)) {
    return commandUsage;
  }

  const relativePath = normalizePath(path.relative(repoRoot, schemaPath));
  const parsed = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const schemaCommands = Array.isArray(parsed?.commands) ? parsed.commands : [];

  for (const entry of schemaCommands) {
    const command = String(entry?.command ?? "").trim();
    if (!command) {
      continue;
    }
    addUsage(commandUsage, command, relativePath);
  }

  return commandUsage;
}

function extractBalancedBlock(sourceCode, startIndex, openChar, closeChar) {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let index = startIndex; index < sourceCode.length; index += 1) {
    const currentChar = sourceCode[index];
    const nextChar = sourceCode[index + 1];

    if (inLineComment) {
      if (currentChar === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (currentChar === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (!escaped && currentChar === "'") {
        inSingleQuote = false;
      }
      escaped = !escaped && currentChar === "\\";
      continue;
    }

    if (inDoubleQuote) {
      if (!escaped && currentChar === '"') {
        inDoubleQuote = false;
      }
      escaped = !escaped && currentChar === "\\";
      continue;
    }

    if (inTemplateString) {
      if (!escaped && currentChar === "`") {
        inTemplateString = false;
      }
      escaped = !escaped && currentChar === "\\";
      continue;
    }

    if (currentChar === "/" && nextChar === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (currentChar === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (currentChar === "'") {
      inSingleQuote = true;
      escaped = false;
      continue;
    }

    if (currentChar === '"') {
      inDoubleQuote = true;
      escaped = false;
      continue;
    }

    if (currentChar === "`") {
      inTemplateString = true;
      escaped = false;
      continue;
    }

    if (currentChar === openChar) {
      depth += 1;
      continue;
    }

    if (currentChar === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return sourceCode.slice(startIndex + 1, index);
      }
    }
  }

  throw new Error(`无法提取 ${openChar}${closeChar} 平衡块`);
}

function collectRegisteredCommands() {
  const runnerPath = path.join(repoRoot, "src-tauri/src/app/runner.rs");
  const sourceCode = fs.readFileSync(runnerPath, "utf8");
  const marker = "tauri::generate_handler![";
  const markerIndex = sourceCode.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("未找到 tauri::generate_handler! 注册块");
  }

  const bracketStart = markerIndex + marker.length - 1;
  const handlerBody = extractBalancedBlock(sourceCode, bracketStart, "[", "]");
  const registeredCommands = new Set();
  const withoutBlockComments = handlerBody.replace(/\/\*[\s\S]*?\*\//g, "");

  for (const line of withoutBlockComments.split("\n")) {
    const trimmedLine = line.replace(/\/\/.*$/, "").trim();
    if (!trimmedLine) {
      continue;
    }

    const match = trimmedLine.match(/^([A-Za-z0-9_:]+)\s*,?$/);
    if (!match) {
      continue;
    }

    const fullPath = match[1];
    const command = fullPath.split("::").pop();
    if (command) {
      registeredCommands.add(command);
    }
  }

  return registeredCommands;
}

function collectMockPriorityCommands() {
  const filePath = path.join(
    repoRoot,
    "src/lib/dev-bridge/mockPriorityCommands.ts",
  );
  const sourceCode = fs.readFileSync(filePath, "utf8");
  const match = sourceCode.match(
    /const mockPriorityCommands = new Set<string>\(\[([\s\S]*?)\]\);/,
  );
  if (!match) {
    throw new Error("未找到 mockPriorityCommands 定义");
  }

  const commands = new Set();
  for (const stringMatch of match[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
    commands.add(stringMatch[1]);
  }
  return commands;
}

function collectDefaultMockCommands() {
  const filePath = path.join(repoRoot, "src/lib/tauri-mock/core.ts");
  const sourceCode = fs.readFileSync(filePath, "utf8");
  const marker = "const defaultMocks: Record<string, any> = {";
  const markerIndex = sourceCode.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("未找到 tauri-mock defaultMocks 定义");
  }

  const braceStart = markerIndex + marker.length - 1;
  const objectBody = extractBalancedBlock(sourceCode, braceStart, "{", "}");
  const mockCommands = new Set();

  for (const match of objectBody.matchAll(/^  ([A-Za-z0-9_]+)\s*:/gm)) {
    mockCommands.add(match[1]);
  }

  return mockCommands;
}

function readAgentCommandCatalog() {
  const catalogPath = path.join(
    repoRoot,
    "src/lib/governance/agentCommandCatalog.json",
  );
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

function sortCommands(commands) {
  return [...commands].sort((left, right) => left.localeCompare(right));
}

function printCommandGroup(title, commands, usageMap) {
  console.error(`\n## ${title}`);
  for (const command of sortCommands(commands)) {
    console.error(`- ${command}`);
    if (usageMap?.has(command)) {
      const files = sortCommands(usageMap.get(command));
      for (const file of files) {
        console.error(`  - ${file}`);
      }
    }
  }
}

function main() {
  const frontendUsage = collectFrontendCommandUsage();
  const agentRuntimeSchemaUsage = collectAgentRuntimeSchemaUsage();
  for (const [command, files] of agentRuntimeSchemaUsage.entries()) {
    for (const file of files) {
      addUsage(frontendUsage, command, file);
    }
  }
  const frontendCommands = new Set(frontendUsage.keys());
  const registeredCommands = collectRegisteredCommands();
  const mockPriorityCommands = collectMockPriorityCommands();
  const defaultMockCommands = collectDefaultMockCommands();
  const agentCommandCatalog = readAgentCommandCatalog();

  const deprecatedCommands = new Set(
    Object.keys(agentCommandCatalog.deprecatedCommandReplacements ?? {}),
  );
  const runtimeGatewayCommands = new Set(
    agentCommandCatalog.runtimeGatewayCommands ?? [],
  );

  const deferredCommands = new Set(knownDeferredRegistrationReasons.keys());

  const missingRegistrations = new Set(
    [...frontendCommands].filter(
      (command) =>
        !registeredCommands.has(command) && !deferredCommands.has(command),
    ),
  );
  const deprecatedCommandsStillUsed = new Set(
    [...frontendCommands].filter((command) => deprecatedCommands.has(command)),
  );
  const mockPriorityMissingMocks = new Set(
    [...mockPriorityCommands].filter(
      (command) => !defaultMockCommands.has(command),
    ),
  );
  const mockPriorityMissingRegistrations = new Set(
    [...mockPriorityCommands].filter(
      (command) =>
        !registeredCommands.has(command) && !deferredCommands.has(command),
    ),
  );
  const runtimeGatewayMissingRegistrations = new Set(
    [...runtimeGatewayCommands].filter(
      (command) =>
        !registeredCommands.has(command) && !deferredCommands.has(command),
    ),
  );

  console.log("[command-contracts] frontend commands:", frontendCommands.size);
  console.log(
    "[command-contracts] rust registered commands:",
    registeredCommands.size,
  );
  console.log(
    "[command-contracts] mock priority commands:",
    mockPriorityCommands.size,
  );
  console.log(
    "[command-contracts] default mock commands:",
    defaultMockCommands.size,
  );

  if (knownDeferredRegistrationReasons.size > 0) {
    console.log("\n[command-contracts] 已登记的延期命令：");
    for (const command of sortCommands(
      knownDeferredRegistrationReasons.keys(),
    )) {
      console.log(`- ${command}`);
      console.log(`  ${knownDeferredRegistrationReasons.get(command)}`);
    }
  }

  let hasError = false;

  if (missingRegistrations.size > 0) {
    hasError = true;
    printCommandGroup(
      "前端调用但未注册的命令",
      missingRegistrations,
      frontendUsage,
    );
  }

  if (deprecatedCommandsStillUsed.size > 0) {
    hasError = true;
    printCommandGroup(
      "前端仍在调用的废弃命令",
      deprecatedCommandsStillUsed,
      frontendUsage,
    );
  }

  if (mockPriorityMissingMocks.size > 0) {
    hasError = true;
    printCommandGroup("mock 优先命令缺少 mock 实现", mockPriorityMissingMocks);
  }

  if (mockPriorityMissingRegistrations.size > 0) {
    hasError = true;
    printCommandGroup(
      "mock 优先命令缺少 Rust 注册",
      mockPriorityMissingRegistrations,
    );
  }

  if (runtimeGatewayMissingRegistrations.size > 0) {
    hasError = true;
    printCommandGroup(
      "runtime gateway 命令缺少 Rust 注册",
      runtimeGatewayMissingRegistrations,
    );
  }

  if (hasError) {
    process.exitCode = 1;
    return;
  }

  console.log("\n[command-contracts] 所有命令契约检查通过。");
}

main();
