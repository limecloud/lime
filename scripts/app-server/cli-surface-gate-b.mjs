#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { localAppServerBinaryPath } from "../lib/electron-dev-sidecar.mjs";
import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const cliName = process.platform === "win32" ? "lime.exe" : "lime";
const cliPath = path.join(rootDir, "lime-rs", "target", "debug", cliName);
const appServerPath = path.resolve(
  process.env.APP_SERVER_BIN || localAppServerBinaryPath({ repoRoot: rootDir }),
);

async function main() {
  await Promise.all([
    assertFile(cliPath, "lime"),
    assertFile(appServerPath, "app-server"),
  ]);
  const tempDir = await mkdtemp(path.join(tmpdir(), "cli-surface-gate-b-"));
  try {
    await Promise.all(
      ["home", "xdg-config", "xdg-data", "app-data", "local-app-data"].map(
        (name) => mkdir(path.join(tempDir, name), { recursive: true }),
      ),
    );
    const connection = [
      "--app-server",
      appServerPath,
      "--app-server-arg=--data-dir",
      `--app-server-arg=${path.join(tempDir, "data")}`,
      "--app-server-arg=--app-data-dir",
      `--app-server-arg=${path.join(tempDir, "app-data")}`,
    ];

    const sandbox = await runCliResult(
      [
        "sandbox",
        "--permission-profile",
        ":workspace",
        "--cd",
        tempDir,
        "--",
        process.platform === "win32" ? "powershell.exe" : "/bin/sh",
        ...(process.platform === "win32"
          ? [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "Write-Output sandbox-stdout; [Console]::Error.WriteLine((Get-Location).Path); exit 7",
            ]
          : ["-c", "printf sandbox-stdout; pwd >&2; exit 7"]),
      ],
      tempDir,
      { LIME_APP_SERVER_BIN: appServerPath },
    );
    if (sandbox.code !== 7 || sandbox.stdout !== "sandbox-stdout") {
      throw new Error(
        `sandbox did not preserve stdout/exit code: ${JSON.stringify(sandbox)}`,
      );
    }
    if (!sandbox.stderr.includes(tempDir)) {
      throw new Error(
        `sandbox did not use the requested cwd: ${sandbox.stderr}`,
      );
    }

    const readOnly = await runCliResult(
      [
        "sandbox",
        "--permission-profile",
        ":read-only",
        "--",
        process.platform === "win32" ? "powershell.exe" : "/bin/sh",
        ...(process.platform === "win32"
          ? [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "Set-Content -Path command-exec-must-not-exist -Value denied",
            ]
          : ["-c", "touch command-exec-must-not-exist"]),
      ],
      tempDir,
      { LIME_APP_SERVER_BIN: appServerPath },
    );
    if (
      readOnly.code === 0 ||
      !readOnly.stderr.includes("read_only_sandbox_blocks_shell_command")
    ) {
      throw new Error(
        `read-only sandbox must fail closed before execution: ${JSON.stringify(readOnly)}`,
      );
    }

    const mcpFixture = path.join(tempDir, "mcp-fixture.mjs");
    await writeFile(
      mcpFixture,
      [
        "import readline from 'node:readline';",
        "const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');",
        "readline.createInterface({ input: process.stdin }).on('line', (line) => {",
        "  let message; try { message = JSON.parse(line); } catch { return; }",
        "  if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'cli-surface-mcp', version: '1.0.0' } } });",
        "  else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [] } });",
        "  else if (message.id != null) send({ jsonrpc: '2.0', id: message.id, result: {} });",
        "});",
      ].join("\n"),
      "utf8",
    );

    const list = await runCli(
      ["mcp", "list", "--json", ...connection],
      tempDir,
    );
    const mcp = JSON.parse(list.stdout);
    assertArray(mcp.servers, "mcp list servers");

    const mcpName = "cli-surface-fixture";
    await runCli(
      [
        "mcp",
        "add",
        mcpName,
        ...connection,
        "--",
        process.execPath,
        mcpFixture,
      ],
      tempDir,
    );
    const mcpGet = await runCli(
      ["mcp", "get", mcpName, "--json", ...connection],
      tempDir,
    );
    const mcpServer = JSON.parse(mcpGet.stdout);
    if (mcpServer.name !== mcpName) {
      throw new Error(`mcp get returned the wrong server: ${mcpGet.stdout}`);
    }
    await runCli(["mcp", "start", mcpName, ...connection], tempDir);
    await runCli(["mcp", "stop", mcpName, ...connection], tempDir);
    const stdioLogout = await runCliResult(
      ["mcp", "logout", mcpName, ...connection],
      tempDir,
    );
    if (
      stdioLogout.code !== 1 ||
      !stdioLogout.stderr.includes(
        "OAuth logout is only supported for streamable_http transports.",
      )
    ) {
      throw new Error(
        `mcp logout stdio must fail closed: ${JSON.stringify(stdioLogout)}`,
      );
    }
    const mcpRemove = await runCli(
      ["mcp", "remove", mcpName, ...connection],
      tempDir,
    );
    if (!mcpRemove.stdout.includes(`Removed MCP server \`${mcpName}\``)) {
      throw new Error(`mcp remove output mismatch: ${mcpRemove.stdout}`);
    }

    const features = await runCli(
      ["features", "list", "--json", ...connection],
      tempDir,
    );
    const featurePayload = JSON.parse(features.stdout);
    assertArray(featurePayload.data, "features list data");
    await runCli(["features", "enable", "webmcp", ...connection], tempDir);
    await runCli(["features", "disable", "webmcp", ...connection], tempDir);

    const pluginRoot = path.join(tempDir, "plugin-source");
    await mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    await writeFile(
      path.join(pluginRoot, "plugin.json"),
      JSON.stringify({
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: "cli-surface-plugin",
        version: "1.0.0",
        description: "CLI surface plugin fixture",
      }),
      "utf8",
    );
    await writeFile(
      path.join(pluginRoot, ".codex-plugin/plugin.json"),
      JSON.stringify({ interface: { displayName: "CLI Surface Plugin" } }),
      "utf8",
    );
    const marketplaceRoot = path.join(tempDir, ".agents", "plugins");
    await mkdir(marketplaceRoot, { recursive: true });
    await writeFile(
      path.join(marketplaceRoot, "marketplace.json"),
      JSON.stringify({
        name: "cli-surface-marketplace",
        plugins: [
          {
            name: "cli-surface-plugin",
            source: { path: "plugin-source" },
          },
        ],
      }),
      "utf8",
    );
    const availableBeforeInstall = await runCli(
      [
        "plugin",
        "list",
        "--available",
        "--json",
        "--plugin-cwd",
        tempDir,
        ...connection,
      ],
      tempDir,
    );
    const availablePayload = JSON.parse(availableBeforeInstall.stdout);
    assertArray(availablePayload.plugins, "available plugin list plugins");
    const availablePlugin = availablePayload.plugins.find(
      (candidate) => candidate?.id === "cli-surface-plugin",
    );
    if (!availablePlugin || availablePlugin.installed !== false) {
      throw new Error(
        `plugin list --available did not expose an uninstalled candidate: ${availableBeforeInstall.stdout}`,
      );
    }
    await runCli(
      ["plugin", "add", pluginRoot, "--source", "repo", ...connection],
      tempDir,
    );

    const plugins = await runCli(
      ["plugin", "list", "--json", ...connection],
      tempDir,
    );
    const pluginPayload = JSON.parse(plugins.stdout);
    assertArray(pluginPayload.plugins, "plugin list plugins");
    const plugin = pluginPayload.plugins.find(
      (candidate) => candidate.id === "cli-surface-plugin",
    );
    if (!plugin)
      throw new Error("plugin add did not expose the installed plugin");
    const repoPlugins = await runCli(
      [
        "plugin",
        "list",
        "--available",
        "--json",
        "--plugin-cwd",
        tempDir,
        ...connection,
      ],
      tempDir,
    );
    const repoPluginPayload = JSON.parse(repoPlugins.stdout);
    assertArray(repoPluginPayload.plugins, "repo-local plugin list plugins");
    if (
      !repoPluginPayload.plugins.some(
        (candidate) => candidate?.id === "cli-surface-plugin",
      )
    ) {
      throw new Error(
        `repo-local plugin list did not return the fixture: ${repoPlugins.stdout}`,
      );
    }
    const pluginRead = await runCli(
      ["plugin", "read", "cli-surface-plugin", "--json", ...connection],
      tempDir,
    );
    if (
      JSON.parse(pluginRead.stdout).plugin?.summary?.id !== "cli-surface-plugin"
    ) {
      throw new Error(
        `plugin read returned an unexpected payload: ${pluginRead.stdout}`,
      );
    }
    const pluginSearch = await runCli(
      [
        "plugin",
        "search",
        "cli-surface",
        "--plugin-cwd",
        tempDir,
        ...connection,
      ],
      tempDir,
    );
    const pluginSearchPayload = JSON.parse(pluginSearch.stdout);
    assertArray(pluginSearchPayload.data, "plugin search data");
    if (
      !pluginSearchPayload.data.some(
        (entry) => entry.plugin?.id === "cli-surface-plugin",
      )
    ) {
      throw new Error(
        `plugin search did not return the fixture: ${pluginSearch.stdout}`,
      );
    }
    await runCli(
      ["plugin", "disable", "cli-surface-plugin", ...connection],
      tempDir,
    );
    await runCli(
      ["plugin", "enable", "cli-surface-plugin", ...connection],
      tempDir,
    );
    await runCli(
      ["plugin", "remove", "cli-surface-plugin", ...connection],
      tempDir,
    );

    const memory = await runCli(
      ["debug", "clear-memories", ...connection],
      tempDir,
    );
    if (!memory.stdout.includes("Cleared memory state")) {
      throw new Error(`debug clear-memories output mismatch: ${memory.stdout}`);
    }
    const models = await runCli(
      ["debug", "models", "--bundled", ...connection],
      tempDir,
    );
    assertArray(JSON.parse(models.stdout).models, "debug models catalog");

    const execpolicyPath = path.join(tempDir, "policy.rules");
    await writeFile(
      execpolicyPath,
      'prefix_rule(pattern=["git", "push"], decision="forbidden", justification="pushing is blocked in this repo")\n',
      "utf8",
    );
    const execpolicy = await runCli(
      [
        "execpolicy",
        "check",
        "--rules",
        execpolicyPath,
        "--pretty",
        "git",
        "push",
        "origin",
        "main",
      ],
      tempDir,
    );
    const execpolicyPayload = JSON.parse(execpolicy.stdout);
    if (
      execpolicyPayload.decision !== "forbidden" ||
      execpolicyPayload.matchedRules?.[0]?.prefixRuleMatch?.justification !==
        "pushing is blocked in this repo"
    ) {
      throw new Error(`execpolicy check output mismatch: ${execpolicy.stdout}`);
    }

    const invalidLogout = await runCliResult(
      ["mcp", "logout", "docs", ...connection],
      tempDir,
    );
    if (
      invalidLogout.code !== 1 ||
      !invalidLogout.stderr.includes("No MCP server named 'docs' found.")
    ) {
      throw new Error(
        `mcp logout unknown server must fail closed: ${JSON.stringify(invalidLogout)}`,
      );
    }

    const oauthServerName = "cli-oauth-logout-fixture";
    await runCli(
      [
        "mcp",
        "add",
        oauthServerName,
        "--url",
        "http://127.0.0.1:1/mcp",
        ...connection,
      ],
      tempDir,
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const logout = await runCli(
        ["mcp", "logout", oauthServerName, ...connection],
        tempDir,
      );
      if (
        logout.stdout.trim() !==
        `No OAuth credentials stored for \`${oauthServerName}\`.`
      ) {
        throw new Error(
          `mcp logout without credentials must be idempotent attempt=${attempt}: ${JSON.stringify(logout)}`,
        );
      }
    }
    await runCli(["mcp", "remove", oauthServerName, ...connection], tempDir);

    const backendPath = path.join(tempDir, "queue-backend.mjs");
    const ledgerPath = path.join(tempDir, "queue-backend.jsonl");
    await writeTerminalExternalBackend(backendPath, {
      completedText: "queue fixture completed",
      command: "printf queue-fixture",
    });
    const runtimeConnection = [
      "--app-server-arg=--backend",
      "--app-server-arg=external",
      "--app-server-arg=--backend-command",
      `--app-server-arg=${process.execPath}`,
      "--app-server-arg=--backend-arg",
      `--app-server-arg=${backendPath}`,
      "--app-server-arg=--backend-arg",
      `--app-server-arg=${ledgerPath}`,
      "--app-server-arg=--backend-timeout-ms",
      "--app-server-arg=5000",
      ...connection,
    ];
    const exec = await runCli(
      [
        "exec",
        "queue seed",
        "--json",
        "--cd",
        tempDir,
        "--model",
        "fixture-model",
        "--provider",
        "fixture-provider",
        ...runtimeConnection,
      ],
      tempDir,
    );
    const threadId = exec.stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((event) => event.type === "thread.started")?.thread_id;
    if (typeof threadId !== "string" || !threadId) {
      throw new Error(
        `queue seed did not return a canonical thread id: ${exec.stdout}`,
      );
    }
    const queued = await runCli(
      [
        "queue",
        "--thread",
        threadId,
        "--message",
        "queued follow-up",
        ...runtimeConnection,
      ],
      tempDir,
    );
    if (!queued.stdout.includes("Queued message for thread")) {
      throw new Error(`queue add output mismatch: ${queued.stdout}`);
    }
    const queueList = await runCli(
      ["queue", "list", "--thread", threadId, "--json", ...connection],
      tempDir,
    );
    assertArray(JSON.parse(queueList.stdout).data, "queue list data");
    const unavailableQueue = await runCliResult(
      ["queue", "list", "--thread", "missing-thread", "--json", ...connection],
      tempDir,
    );
    if (unavailableQueue.code === 0) {
      throw new Error("queue list must fail closed for an unavailable Thread");
    }

    console.log(
      [
        "[smoke:cli-surface-gate-b] ok",
        "mcp=list",
        "mcp=create|get|delete",
        "mcp=start|stop",
        "features=list",
        "features=enable|disable",
        "plugin=add|list|read|search|enable|disable|remove",
        "debug=models|clear-memories",
        "execpolicy=check|prefix-rule|justification",
        "queue=add|list|unavailable-fail-closed",
        "sandbox=stdout|stderr|cwd|exit-code|read-only-fail-closed",
        "oauth-logout=unknown-server|stdio-fail-closed|idempotent",
      ].join(" "),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runCli(args, tempDir) {
  const result = await runCliResult(args, tempDir);
  if (result.code !== 0) {
    throw new Error(
      `lime exited with code ${result.code} for ${args.join(" ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  return result;
}

async function runCliResult(args, tempDir, extraEnvironment = {}) {
  const environment = {
    ...process.env,
    HOME: path.join(tempDir, "home"),
    XDG_CONFIG_HOME: path.join(tempDir, "xdg-config"),
    XDG_DATA_HOME: path.join(tempDir, "xdg-data"),
    APPDATA: path.join(tempDir, "app-data"),
    LOCALAPPDATA: path.join(tempDir, "local-app-data"),
    ...extraEnvironment,
  };
  if (process.platform === "darwin") {
    const libraryDirs = [path.join(rootDir, "lime-rs", "target", "debug")];
    const prebuiltRoot = path.join(
      rootDir,
      "lime-rs",
      "target",
      "sherpa-onnx-prebuilt",
    );
    const entries = await readdir(prebuiltRoot, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const libDir = path.join(prebuiltRoot, entry.name, "lib");
      try {
        await access(libDir);
        libraryDirs.push(libDir);
      } catch {
        // Optional prebuilt variants are absent on most developer machines.
      }
    }
    if (process.env.DYLD_LIBRARY_PATH) {
      libraryDirs.push(process.env.DYLD_LIBRARY_PATH);
    }
    environment.DYLD_LIBRARY_PATH = libraryDirs.join(path.delimiter);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      cwd: rootDir,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({ code: code ?? 1, signal, stdout, stderr }),
    );
  });
}

async function assertFile(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label} binary not found: ${filePath}`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

main().catch((error) => {
  console.error(`[smoke:cli-surface-gate-b] failed: ${error.message}`);
  process.exitCode = 1;
});
