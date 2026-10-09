#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { localAppServerBinaryPath } from "../lib/electron-dev-sidecar.mjs";
import { buildTerminalGateBinaries } from "./terminal-gate-binaries.mjs";
import { writeTerminalExternalBackend } from "./terminal-gate-fixture.mjs";
import { runExecReasoningGateB } from "./cli-reasoning-gate-b.mjs";
import { runExecSessionGateB } from "./cli-exec-gate-b.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const cliBinaryName = process.platform === "win32" ? "lime.exe" : "lime";
const defaultCliBinaryPath = path.join(
  rootDir,
  "lime-rs",
  "target",
  "debug",
  cliBinaryName,
);
const prompt = "cli gate b prompt";
const completedText = "cli gate b completed";

async function main() {
  await buildTerminalGateBinaries({ env: process.env, repoRoot: rootDir });
  const cliBinaryPath = path.resolve(
    process.env.LIME_CLI_BIN || defaultCliBinaryPath,
  );
  const appServerBinaryPath = path.resolve(
    process.env.APP_SERVER_BIN ||
      localAppServerBinaryPath({ repoRoot: rootDir }),
  );
  await Promise.all([
    assertBinaryExists(cliBinaryPath, "lime"),
    assertBinaryExists(appServerBinaryPath, "app-server"),
  ]);

  const tempDir = await mkdtemp(path.join(tmpdir(), "cli-gate-b-"));
  try {
    const backendPath = path.join(tempDir, "cli-backend.mjs");
    const ledgerPath = path.join(tempDir, "cli-backend.jsonl");
    const dataDir = path.join(tempDir, "data");
    const appDataDir = path.join(tempDir, "app-data");
    await Promise.all(
      [
        "home",
        "xdg-config",
        "xdg-data",
        "roaming-app-data",
        "local-app-data",
      ].map((directory) =>
        mkdir(path.join(tempDir, directory), { recursive: true }),
      ),
    );
    await writeTerminalExternalBackend(backendPath, {
      completedText,
      command: "printf cli-gate-b",
      commandItems: true,
      scenario: "exec-json-stream",
      taskProgress: true,
      tokenUsage: true,
    });

    const args = [
      "exec",
      prompt,
      "--json",
      "--approve-for-me",
      "--cd",
      tempDir,
      "--model",
      "fixture-model",
      "--provider",
      "fixture-provider",
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
      "--app-server-arg=--data-dir",
      `--app-server-arg=${dataDir}`,
      "--app-server-arg=--app-data-dir",
      `--app-server-arg=${appDataDir}`,
    ];
    if (process.env.LIME_CLI_GATE_B_USE_SIBLING_APP_SERVER !== "1") {
      const appServerArgIndex = args.indexOf("--app-server-arg=--backend");
      args.splice(appServerArgIndex, 0, "--app-server", appServerBinaryPath);
    }
    let buffered = "";
    let streamReleased = false;
    const { stdout, stderr } = await runCli(cliBinaryPath, args, tempDir, {
      async onStdout(chunk) {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/u);
        buffered = lines.pop();
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (
            event.type === "item.started" &&
            event.item.type === "command_execution"
          ) {
            if (streamReleased)
              throw new Error("duplicate streamed command start");
            streamReleased = true;
            await writeFile(
              `${ledgerPath}.continue`,
              "observed item.started\n",
            );
          }
        }
      },
    });
    assertEqual(streamReleased, true, "JSONL flushed before turn completion");
    if (stderr.trim()) {
      throw new Error(`lime wrote unexpected stderr: ${stderr.trim()}`);
    }

    const events = parseEvents(stdout);
    assertEqual(events[0]?.type, "thread.started", "first JSONL event");
    const threadId = events[0].thread_id;
    assertNonEmptyString(threadId, "thread id");
    assertEqual(events[1]?.type, "turn.started", "turn start event");
    assertEqual(events.at(-1)?.type, "turn.completed", "turn terminal event");
    assertEqual(finalAnswer(events), completedText, "CLI output");
    const commands = events.filter(
      (event) => event.item?.type === "command_execution",
    );
    assertEqual(commands.length, 2, "command lifecycle event count");
    assertEqual(commands[0].type, "item.started", "command started");
    assertEqual(commands[1].type, "item.completed", "command completed");
    assertEqual(
      commands[0].item.id,
      commands[1].item.id,
      "stable display item id",
    );
    assertEqual(commands[1].item.status, "completed", "command status");
    assertEqual(
      commands[1].item.aggregated_output,
      "terminal-gate-b",
      "command output",
    );
    assertEqual(events.at(-1).usage.input_tokens, 155000, "latest total usage");
    assertEqual(
      events.at(-1).usage.cache_write_input_tokens,
      500,
      "cache write usage",
    );

    const ledger = await readJsonLines(ledgerPath);
    const turnStart = ledger.find((entry) => entry?.kind === "turnStart");
    if (!turnStart) {
      throw new Error("external backend did not record turnStart");
    }
    assertEqual(turnStart.inputText, prompt, "backend input");
    assertEqual(turnStart.threadId, threadId, "canonical thread identity");
    const cold = await runCli(
      cliBinaryPath,
      [
        "thread",
        "show",
        threadId,
        "--include-turns",
        ...args.slice(2).filter((arg) => arg !== "--json"),
      ],
      tempDir,
    );
    const canonicalTurn = JSON.parse(cold.stdout).thread.turns.find(
      (turn) => turn.id === turnStart.turnId,
    );
    assertNonEmptyString(canonicalTurn?.id, "canonical turn identity");
    assertEqual(canonicalTurn.status, "completed", "cold canonical status");
    const canonicalCommand = canonicalTurn.items.find(
      (item) => item.type === "commandExecution",
    );
    assertEqual(
      canonicalCommand?.id,
      `item_terminal-command-${turnStart.turnId}`,
      "canonical command identity",
    );
    assertEqual(
      canonicalCommand.command,
      commands[1].item.command,
      "canonical command projection",
    );
    const runtimeRequest = turnStart.runtimeOptions?.runtimeRequest;
    assertEqual(
      runtimeRequest?.approvalPolicy,
      "on-request",
      "canonical approval policy",
    );
    assertEqual(
      runtimeRequest?.metadata?.approvalsReviewer,
      "auto_review",
      "canonical approvals reviewer",
    );
    assertEqual(
      runtimeRequest?.sandboxPolicy,
      "workspace-write",
      "canonical sandbox policy",
    );
    assertEqual(
      turnStart.eventTypes.join(","),
      "turn.started,turn.plan.updated,provider.usage,item.started",
      "runtime event sequence",
    );

    console.log(
      `CLI_EXEC_JSON_STREAM_OK thread=${threadId} turn=${turnStart.turnId} realtime=ok stable-id=ok cold=ok usage=total`,
    );
    const removedFlag = await runCliResult(
      cliBinaryPath,
      ["exec", prompt, "--jsonl"],
      tempDir,
    );
    assertEqual(removedFlag.code, 2, "removed jsonl flag exit");

    const stdinArgs = ["exec", ...args.slice(2)];
    const stdin = await runCli(cliBinaryPath, stdinArgs, tempDir, {
      input: `${prompt}\n`,
    });
    assertEqual(
      finalAnswer(parseEvents(stdin.stdout)),
      completedText,
      "stdin output",
    );

    const invalid = await runCliResult(
      cliBinaryPath,
      ["exec", "", "--json"],
      tempDir,
    );
    assertEqual(invalid.code, 1, "empty prompt exit code");
    assertEqual(
      parseEvents(invalid.stdout).length,
      1,
      "single preflight error",
    );
    assertEqual(
      parseEvents(invalid.stdout)[0].type,
      "error",
      "preflight error event",
    );
    assertEqual(invalid.stderr.trim(), "", "error event stderr");

    const completion = await runCli(
      cliBinaryPath,
      ["completion", "zsh"],
      tempDir,
    );
    if (
      !completion.stdout.includes("_lime") ||
      !completion.stdout.includes("completion")
    ) {
      throw new Error(
        "zsh completion did not describe the canonical lime command tree",
      );
    }

    await runExecReasoningGateB({
      cliBinaryPath,
      appServerBinaryPath,
      args,
      tempDir,
      backendPath,
      ledgerPath,
      runCliResult,
      terminalEnvironment: await isolatedEnvironment(tempDir),
    });
    await runExecSessionGateB({
      repoRoot: rootDir,
      cliBinaryPath,
      appServerBinaryPath,
      args,
      tempDir,
      backendPath,
      ledgerPath,
      runCliResult,
      terminalEnvironment: await isolatedEnvironment(tempDir),
    });

    console.log(
      [
        "[smoke:cli-gate-b] ok",
        `cli=${cliBinaryPath}`,
        `appServer=${appServerBinaryPath}`,
        `thread=${threadId}`,
        `turn=${turnStart.turnId}`,
        `status=${canonicalTurn.status}`,
        `events=${turnStart.eventTypes.join(",")}`,
        "json=event-jsonl",
        "stdin=ok",
        "error-exit=1",
        "completion=zsh",
      ].join(" "),
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runCli(cliBinaryPath, args, tempDir, options = {}) {
  const result = await runCliResult(cliBinaryPath, args, tempDir, options);
  if (result.code !== 0) {
    throw new Error(
      [
        `lime exited with code ${result.code}`,
        result.stdout ? `stdout: ${result.stdout.trim()}` : "stdout: <empty>",
        result.stderr ? `stderr: ${result.stderr.trim()}` : "stderr: <empty>",
      ].join("\n"),
    );
  }
  return result;
}

async function runCliResult(cliBinaryPath, args, tempDir, options = {}) {
  const environment = await isolatedEnvironment(tempDir);
  return new Promise((resolve, reject) => {
    const child = spawn(cliBinaryPath, args, {
      cwd: rootDir,
      env: { ...environment, ...options.env },
      windowsHide: true,
      stdio: [options.inheritStdin ? "inherit" : "pipe", "pipe", "pipe"],
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    let stdout = "";
    let stderr = "";
    const callbacks = [];
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (options.onStdout) {
        const callback = Promise.resolve().then(() => options.onStdout(chunk));
        callbacks.push(callback);
        callback.catch((error) => {
          child.kill();
          reject(error);
        });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) =>
      reject(
        new Error(
          `${args.join(" ")}: ${error.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
          { cause: error },
        ),
      ),
    );
    child.once("close", async (code, signal) => {
      try {
        await Promise.all(callbacks);
      } catch (error) {
        reject(error);
        return;
      }
      resolve({
        code: typeof code === "number" ? code : 1,
        signal,
        stdout,
        stderr,
      });
    });
    if (child.stdin) {
      child.stdin.end(options.input ?? undefined);
    }
  });
}

async function isolatedEnvironment(tempDir) {
  const home = path.join(tempDir, "home");
  const appData = path.join(tempDir, "roaming-app-data");
  const localAppData = path.join(tempDir, "local-app-data");
  const environment = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: path.join(tempDir, "xdg-config"),
    XDG_DATA_HOME: path.join(tempDir, "xdg-data"),
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
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
  return environment;
}

async function assertBinaryExists(targetPath, label) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(
      `${label} binary not found: ${targetPath}\n` +
        '先构建：cargo build --manifest-path "lime-rs/Cargo.toml" -p cli -p app-server',
    );
  }
}

async function readJsonLines(filePath) {
  const content = await readFile(filePath, "utf8");
  return content
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `unexpected ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function parseEvents(stdout) {
  return stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function finalAnswer(events) {
  return events.findLast(
    (event) =>
      event.type === "item.completed" && event.item?.type === "agent_message",
  )?.item.text;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`missing ${label}: ${JSON.stringify(value)}`);
  }
}

main().catch((error) => {
  console.error(
    `[smoke:cli-gate-b] failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
