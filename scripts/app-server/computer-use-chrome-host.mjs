import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { terminalGateRuntimeEnvironment } from "./terminal-gate-binaries.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function startProcess(command, args, env) {
  const child = spawn(command, args, {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (bytes) => {
    stdout += bytes;
  });
  child.stderr.on("data", (bytes) => {
    stderr += bytes;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
  void done.catch(() => {});
  return {
    child,
    done,
    get stderr() {
      return stderr;
    },
  };
}

async function boundedProcess(process, timeout = 90000) {
  const timer = setTimeout(() => process.child.kill("SIGTERM"), timeout);
  try {
    return await process.done;
  } finally {
    clearTimeout(timer);
  }
}

export async function startChromeHost({
  host,
  root,
  binaries,
  receipt,
  evidenceDir,
}) {
  assert(["app-server", "desktop", "cli", "tui"].includes(host));
  const env = {
    ...terminalGateRuntimeEnvironment({
      appServerBinaryPath: binaries.appServerBinaryPath,
    }),
    LIME_CONFIG_PATH: path.join(root, "config.yaml"),
    LIME_AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
  };
  const serverArgs = [
    "--backend",
    "runtime",
    "--data-dir",
    path.join(root, "data"),
    "--app-data-dir",
    path.join(root, "app"),
  ];
  const connection = [
    "--app-server",
    binaries.appServerBinaryPath,
    ...serverArgs.map((arg) => `--app-server-arg=${arg}`),
    "--cd",
    root,
  ];
  let desktop,
    server,
    lines,
    seq = 0,
    terminal;
  const pending = new Map();
  let request;
  if (host === "desktop") {
    const { startComputerUseDesktop } =
      await import("./computer-use-desktop.mjs");
    desktop = await startComputerUseDesktop({
      root,
      binaries,
      receipt,
      features: { computer_use: false, chrome_use: true, office_use: false },
      finalText: "CHROME_HANDOFF_RESUMED",
      artifactPrefix: "chrome",
    });
    request = desktop.invoke;
    receipt.hostProcess = { host, electronPid: desktop.pid };
  } else {
    server = startProcess(binaries.appServerBinaryPath, serverArgs, env);
    request = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out: ${server.stderr}`));
        }, 70000);
        pending.set(id, {
          resolve(value) {
            clearTimeout(timer);
            resolve(value);
          },
          reject(error) {
            clearTimeout(timer);
            reject(error);
          },
        });
        server.child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
    const failPending = (error) => {
      for (const call of pending.values()) call.reject(error);
      pending.clear();
    };
    void server.done.then(
      (exit) =>
        failPending(
          new Error(`App Server exited ${exit.code}: ${exit.stderr}`),
        ),
      failPending,
    );
    lines = readline.createInterface({ input: server.child.stdout });
    lines.on("line", (line) => {
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        return;
      }
      const call = pending.get(value.id);
      if (!call) return;
      pending.delete(value.id);
      value.error
        ? call.reject(new Error(JSON.stringify(value.error)))
        : call.resolve(value.result);
    });
    receipt.initialize = await request("initialize", {
      clientInfo: { name: "chrome-native-fixture", version: "1" },
    });
    server.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`,
    );
    receipt.hostProcess = { host, controlAppServerPid: server.child.pid };
  }
  receipt.hostTurns = [];
  const terminalHost = ["cli", "tui"].includes(host);
  if (terminalHost)
    receipt.cliBinary = {
      path: binaries.cliBinaryPath,
      sha256: digest(await fs.readFile(binaries.cliBinaryPath)),
    };
  return {
    request,
    workspaceRoot: desktop?.workspaceRoot ?? root,
    get stderr() {
      return server?.stderr ?? "";
    },
    prepareThread: (thread, provider) =>
      desktop?.prepareThread(thread, provider),
    async startTurn({
      thread,
      provider,
      target,
      prompt,
      finalText,
      approveConsent,
    }) {
      if (host === "app-server")
        return request("turn/start", {
          threadId: thread.id,
          input: [{ type: "text", text: prompt }],
          approvalPolicy: "never",
        });
      const before = (
        await request("thread/read", {
          threadId: thread.id,
          includeTurns: true,
        })
      ).thread.turns.map((t) => t.id);
      if (desktop) await desktop.send(thread, prompt);
      else {
        const targetArgs = ["--computer-use-target", JSON.stringify(target)];
        const common = [
          "--provider",
          provider.providerPreference,
          "--model",
          provider.modelPreference,
          ...connection,
          ...targetArgs,
        ];
        const transcript = path.join(
          evidenceDir,
          `chrome-tui-${receipt.hostTurns.length + 1}.log`,
        );
        terminal = startProcess(
          host === "tui" ? "python3" : binaries.cliBinaryPath,
          host === "tui"
            ? [
                "lime-rs/crates/tool-runtime/tests/fixtures/computer_use_tui.py",
                JSON.stringify([
                  binaries.cliBinaryPath,
                  "resume",
                  thread.id,
                  "--locale",
                  "en-US",
                  ...common,
                ]),
                prompt,
                finalText,
                transcript,
              ]
            : [
                "exec",
                "resume",
                thread.id,
                prompt,
                "--json",
                "--ask-for-approval",
                "never",
                ...common,
              ],
          env,
        );
        terminal.result = boundedProcess(
          terminal,
          host === "tui" ? 110000 : 90000,
        );
        void terminal.result.catch(() => {});
        terminal.approval = approveConsent();
        void terminal.approval.catch((error) => {
          terminal.approvalError = error;
        });
        terminal.transcript = transcript;
        receipt.lastHostProcess = { pid: terminal.child.pid, host };
        // An independent App Server must not load/recover a turn while the
        // terminal's own App Server is executing it. Read only after host exit.
        const exit = await terminal.result;
        receipt.lastHostProcess = { ...receipt.lastHostProcess, ...exit };
        assert.equal(exit.code, 0, JSON.stringify(exit));
        await terminal.approval;
        const read = await request("thread/read", {
          threadId: thread.id,
          includeTurns: true,
        });
        const turn = read.thread.turns.find((t) => !before.includes(t.id));
        assert(turn, "terminal persisted a canonical turn");
        return { turn };
      }
      const deadline = Date.now() + 70000;
      while (Date.now() < deadline) {
        if (terminal?.approvalError) throw terminal.approvalError;
        if (terminal?.child.exitCode != null && terminal.child.exitCode !== 0)
          throw new Error(
            `terminal host exited: ${JSON.stringify(await terminal.done)}`,
          );
        const read = await request("thread/read", {
          threadId: thread.id,
          includeTurns: true,
        });
        const turn = read.thread.turns.find((t) => !before.includes(t.id));
        if (turn) return { turn };
        await delay(50);
      }
      throw new Error(
        `No canonical turn from real ${host}: ${terminal?.stderr ?? ""}`,
      );
    },
    async finishTurn(thread, canonical, finalText) {
      const record = {
        host,
        threadId: thread.id,
        turnId: canonical.id,
        toolItems: canonical.items
          .filter((i) => i.type === "dynamicToolCall")
          .map(({ id, status }) => ({ id, status })),
      };
      if (terminalHost) {
        const exit = await terminal.result;
        receipt.lastHostProcess = { ...receipt.lastHostProcess, ...exit };
        assert.equal(exit.code, 0, JSON.stringify(exit));
        await terminal.approval;
        record.cliPid = terminal.child.pid;
        record.exitCode = exit.code;
        if (host === "cli") {
          const events = exit.stdout
            .trim()
            .split(/\r?\n/u)
            .map((line) => JSON.parse(line));
          assert.equal(events[0].type, "thread.started");
          assert.equal(events[0].thread_id, thread.id);
          assert.equal(events.at(-1).type, "turn.completed");
          assert(exit.stdout.includes(finalText));
          record.events = events.map((e) => e.type);
        } else {
          record.terminal = JSON.parse(exit.stdout);
          record.transcript = path.basename(terminal.transcript);
          assert.equal(
            digest(await fs.readFile(terminal.transcript)),
            record.terminal.transcriptSha256,
          );
          for (const key of [
            "submitted",
            "visibleFinal",
            "alternateScreenEntered",
            "alternateScreenRestored",
            "terminalModeRestored",
          ])
            assert.equal(record.terminal[key], true, key);
        }
        const cold = await boundedProcess(
          startProcess(
            binaries.cliBinaryPath,
            ["thread", "show", thread.id, "--include-turns", ...connection],
            env,
          ),
        );
        assert.equal(cold.code, 0, cold.stderr);
        const coldTurn = JSON.parse(cold.stdout).thread.turns.find(
          (t) => t.id === canonical.id,
        );
        assert.deepEqual(
          coldTurn,
          canonical,
          "CLI cold read matches canonical Thread/Turn/Item",
        );
        record.coldReadMatched = true;
        terminal = null;
      }
      receipt.hostTurns.push(record);
    },
    verifyVisible: (thread) => desktop?.verifyVisible(thread, evidenceDir),
    captureFailure: async () => desktop?.captureFailure(evidenceDir),
    async close() {
      if (terminal?.child.exitCode === null) {
        terminal.child.kill("SIGTERM");
        await terminal.done.catch(() => {});
      }
      await desktop?.close();
      lines?.close();
      if (server?.child.exitCode === null) {
        server.child.stdin.end();
        await boundedProcess(server, 3000);
      }
    },
  };
}
