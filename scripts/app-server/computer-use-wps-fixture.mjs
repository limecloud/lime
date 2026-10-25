// Real WPS and canonical runtime tools; only the model is a loopback fixture.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import {
  assertWpsCell,
  wpsWriteCellOperations,
} from "./computer-use-wps-workbook.mjs";
import { prepareLocalAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { prepareLocalComputerUseResources } from "../lib/electron-desktop-resources.mjs";
import {
  snapshotTerminalGateBinaries,
  terminalGateRuntimeEnvironment,
} from "./terminal-gate-binaries.mjs";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionThreadStartParams,
  provisionToolExecutionFixtureProvider,
} from "../agent-runtime/tool-execution-current-contract.mjs";

assert.equal(
  process.platform,
  "darwin",
  "this fixture requires installed macOS WPS",
);
const source = path.resolve(
  process.env.APP_SERVER_BIN || "lime-rs/target/debug/app-server",
);
const host = process.env.LIME_COMPUTER_USE_HOST || "app-server";
assert(
  ["app-server", "cli", "tui", "desktop"].includes(host),
  "supported WPS fixture host",
);
const cliSource = path.resolve(
  process.env.LIME_CLI_BIN || "lime-rs/target/debug/lime",
);
const terminalHost = ["cli", "tui"].includes(host);
const workbook = path.resolve(
  process.argv[2] ||
    ".lime/qc/computer-use-integrations-20261025/wps-live.xlsx",
);
assert.equal(
  path.basename(workbook),
  "wps-live.xlsx",
  "use only the isolated fixture workbook",
);
const evidence = path.join(
  path.dirname(workbook),
  host === "app-server" ? "wps.json" : `wps-${host}.json`,
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "lime-wps-live-"));
const receipt = {
  startedAt: new Date().toISOString(),
  claimBoundary: `Real ${host} host -> App Server runtime -> shared ComputerUseService -> manifested native helper -> real WPS macOS; canonical tools and HTTP model fixture; no live model, other-host, signed release or Windows Gate B claim`,
  host,
  checks: [],
  turns: [],
};
let child, lines, fixture, consent, desktop;
let stderr = "";
let seq = 0;
const pending = new Map();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = (method, params = {}) =>
  desktop
    ? desktop.invoke(method, params)
    : new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out: ${stderr}`));
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
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      });
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8" });
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout;
};
const runChild = (command, args, env) =>
  new Promise((resolve, reject) => {
    const process = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timer = setTimeout(() => process.kill("SIGTERM"), 90000);
    process.stdout.on("data", (bytes) => {
      stdout += bytes;
    });
    process.stderr.on("data", (bytes) => {
      stderr += bytes;
    });
    process.once("error", reject);
    process.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, pid: process.pid });
    });
    return process;
  });
try {
  console.log("[wps-live] prepare resources and isolated runtime");
  await fs.access(workbook);
  const packaged = process.env.LIME_WPS_USE_PACKAGED_RESOURCES === "1";
  if (!packaged) prepareLocalAppServerBinary({ binaryPath: source });
  const resources = packaged
    ? {
        manifestPath: path.join(
          path.dirname(source),
          "desktop-resources.manifest.json",
        ),
      }
    : prepareLocalComputerUseResources({ binaryPath: source });
  const manifest = JSON.parse(
    await fs.readFile(resources.manifestPath, "utf8"),
  );
  if (packaged)
    receipt.packagedManifestSha256 = createHash("sha256")
      .update(await fs.readFile(resources.manifestPath))
      .digest("hex");
  const helperSource = path.resolve(
    path.dirname(resources.manifestPath),
    manifest.resources.find((entry) => entry.id === "macos-native-host").path,
  );
  // Freeze the current product closure so concurrent dev rebuilds cannot change
  // the executable underneath an already issued resource manifest or grant.
  const product = path.join(root, "product");
  const binaries = await snapshotTerminalGateBinaries({
    // This fixture launches only App Server; skip the helper's optional CLI copy.
    env: {
      ...process.env,
      APP_SERVER_BIN: packaged ? process.env.APP_SERVER_BIN : "",
      LIME_CLI_BIN: terminalHost
        ? packaged
          ? process.env.LIME_CLI_BIN
          : ""
        : "not-used-by-app-server-fixture",
    },
    cliBinaryPath: cliSource,
    appServerBinaryPath: source,
    directory: path.join(product, "bin"),
  });
  const helperEntry = manifest.resources.find(
    (entry) => entry.id === "macos-native-host",
  );
  const helper = path.join(product, helperEntry.path);
  await fs.cp(
    path.resolve(helperSource, "../../.."),
    path.resolve(helper, "../../.."),
    { recursive: true },
  );
  const digest = async (file) =>
    createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  manifest.resources = [
    {
      id: "app-server",
      path: "bin/app-server",
      sha256: await digest(binaries.appServerBinaryPath),
    },
    { ...helperEntry, sha256: await digest(helper) },
  ];
  await fs.writeFile(
    path.join(product, "desktop-resources.manifest.json"),
    JSON.stringify(manifest),
  );
  receipt.manifest = manifest;
  if (terminalHost) receipt.cliSha256 = await digest(binaries.cliBinaryPath);
  run("/usr/bin/open", ["-a", "/Applications/wpsoffice.app", workbook]);
  await fs.writeFile(
    path.join(root, "config.yaml"),
    "server:\n  api_key: fixture-only\nfeatures:\n  computer_use: false\n  chrome_use: false\n  office_use: true\n",
  );
  if (host === "desktop") {
    const { startWpsDesktop } = await import("./computer-use-wps-desktop.mjs");
    desktop = await startWpsDesktop({ root, binaries, receipt });
  } else {
    child = spawn(
      binaries.appServerBinaryPath,
      [
        "--backend",
        "runtime",
        "--data-dir",
        path.join(root, "data"),
        "--app-data-dir",
        path.join(root, "app"),
      ],
      {
        env: {
          ...terminalGateRuntimeEnvironment({
            appServerBinaryPath: binaries.appServerBinaryPath,
          }),
          LIME_CONFIG_PATH: path.join(root, "config.yaml"),
          LIME_AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    child.stderr.on("data", (bytes) => {
      stderr = (stderr + bytes).slice(-6000);
    });
    child.on("error", (error) => {
      for (const call of pending.values()) call.reject(error);
      pending.clear();
    });
    child.on("exit", (code) => {
      for (const call of pending.values())
        call.reject(new Error(`App Server exited ${code}: ${stderr}`));
      pending.clear();
    });
    lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const value = JSON.parse(line);
        const call = pending.get(value.id);
        if (!call) return;
        pending.delete(value.id);
        value.error
          ? call.reject(new Error(JSON.stringify(value.error)))
          : call.resolve(value.result);
      } catch {}
    });
    console.log("[wps-live] initialize App Server");
    await request("initialize", {
      clientInfo: { name: "wps-live-fixture", version: "1" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`,
    );
  }
  console.log("[wps-live] discover real WPS window");
  let target;
  for (let attempt = 0; attempt < 80; attempt++) {
    const status = await request("computerUse/status", { adapter: "office" });
    receipt.officeStatus = status.adapters[0];
    assert.notEqual(
      status.adapters[0].reason,
      "desktop_locked",
      "unlock the desktop before WPS live verification",
    );
    target = status.adapters[0].targets?.find(
      (entry) =>
        entry.host === "WPS" && entry.workbookName === path.basename(workbook),
    );
    if (target) break;
    await delay(100);
  }
  assert(target, "real WPS fixture window must be discovered");
  receipt.target = target;
  assert.equal(
    (await request("computerUse/status", { adapter: "native" })).adapters[0]
      .readiness,
    "disabled",
  );
  receipt.checks.push(
    "WPS target discovered while native switch is off; independent office switch is on",
  );
  run("swiftc", [
    "-O",
    "-framework",
    "AppKit",
    "lime-rs/crates/tool-runtime/tests/fixtures/computer_use_consent.swift",
    "-o",
    path.join(root, "consent"),
  ]);
  const startConsent = (parent) => {
    consent = spawn(
      path.join(root, "consent"),
      [String(parent), path.basename(workbook)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const consentExit = new Promise((resolve, reject) => {
      consent.on("error", reject);
      consent.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`fixture consent driver exited ${code}`)),
      );
    });
    // Observe the promise immediately so a setup failure cannot leave an unhandled rejection.
    consentExit.catch(() => {});
    return consentExit;
  };
  let grant;
  if (!terminalHost) {
    const consentExit = startConsent(desktop?.pid ?? child.pid);
    console.log("[wps-live] approve exact fixture consent UI");
    grant = await request("computerUse/setup", {
      adapter: "office",
      target,
      grantScope: "session",
    });
    await consentExit;
    assert.equal(grant.accepted, true);
    assert(
      grant.grant?.id,
      "actual helper consent must yield a connection-bound grant",
    );
    receipt.checks.push(
      "exact fixture window approved through real native consent UI",
    );
  }
  let queue = [];
  let operationError;
  let finalText = "WPS_FIXTURE_TURN_COMPLETE";
  fixture = await startOpenAiCompatibleFixtureServer({
    modelToolMode: "direct",
    scriptedResponses: [
      async ({ body }) => {
        await delay(120);
        const next = queue.shift();
        if (typeof next?.arguments?.operation === "function") {
          try {
            next.arguments.operation = next.arguments.operation(body);
          } catch (error) {
            operationError = String(error);
            queue = [];
          }
        }
        if (operationError)
          return {
            type: "text",
            content: `WPS_FIXTURE_ABORTED: ${operationError}`,
          };
        return (
          next || {
            type: "text",
            content: finalText,
          }
        );
      },
    ],
  });
  const provider = await provisionToolExecutionFixtureProvider({
    fixture,
    invoke: (_, method, params) => request(method, params),
  });
  await request("modelProvider/fetchModels", {
    providerId: provider.providerPreference,
  });
  const { thread } = await request(
    "thread/start",
    buildToolExecutionThreadStartParams({
      provider,
      title: "Real WPS computer use fixture",
      workspaceRoot: desktop?.workspaceRoot ?? root,
    }),
  );
  await desktop?.prepareThread(thread, provider);
  let call = 0;
  const cliEnv = {
    ...terminalGateRuntimeEnvironment({
      appServerBinaryPath: binaries.appServerBinaryPath,
    }),
    LIME_CONFIG_PATH: path.join(root, "config.yaml"),
    LIME_AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
  };
  if (packaged) delete cliEnv.LIME_APP_SERVER_BIN;
  const cliConnection = [
    ...(packaged ? [] : ["--app-server", binaries.appServerBinaryPath]),
    ...[
      "--backend",
      "runtime",
      "--data-dir",
      path.join(root, "data"),
      "--app-data-dir",
      path.join(root, "app"),
    ].map((arg) => `--app-server-arg=${arg}`),
    "--cd",
    root,
  ];
  const runOperations = async (operations, expectedFailure = false) => {
    queue = operations.map((operation) => ({
      type: "tool_call",
      id: `wps-${++call}`,
      name: "computer_use",
      arguments: { target, operation },
    }));
    const ids = queue.map((entry) => entry.id);
    finalText =
      host === "tui"
        ? `WPS_FIXTURE_TURN_COMPLETE_${call}`
        : "WPS_FIXTURE_TURN_COMPLETE";
    if (terminalHost) {
      const targetArgs = expectedFailure
        ? []
        : ["--computer-use-target", JSON.stringify(target)];
      const prompt =
        "Operate only the approved WPS fixture workbook and report observed results.";
      const tuiTranscript = path.join(
        path.dirname(workbook),
        `wps-tui-terminal-${call}.log`,
      );
      const tuiArgs = [
        binaries.cliBinaryPath,
        "resume",
        thread.id,
        "--provider",
        provider.providerPreference,
        "--model",
        provider.modelPreference,
        "--locale",
        "en-US",
        ...cliConnection,
        ...targetArgs,
      ];
      const cli = spawn(
        host === "tui" ? "python3" : binaries.cliBinaryPath,
        host === "tui"
          ? [
              "lime-rs/crates/tool-runtime/tests/fixtures/computer_use_tui.py",
              JSON.stringify(tuiArgs),
              prompt,
              finalText,
              tuiTranscript,
            ]
          : [
              "exec",
              "resume",
              thread.id,
              prompt,
              "--json",
              "--provider",
              provider.providerPreference,
              "--model",
              provider.modelPreference,
              "--ask-for-approval",
              "never",
              ...cliConnection,
              ...targetArgs,
            ],
        { env: cliEnv, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "",
        stderr = "";
      const done = new Promise((resolve, reject) => {
        cli.once("error", reject);
        cli.once("exit", (code, signal) => resolve({ code, signal }));
      });
      cli.stdout.on("data", (bytes) => {
        stdout += bytes;
      });
      cli.stderr.on("data", (bytes) => {
        stderr += bytes;
      });
      const timer = setTimeout(
        () => cli.kill("SIGTERM"),
        host === "tui" ? 110000 : 90000,
      );
      const consentDone = expectedFailure
        ? Promise.resolve()
        : startConsent(cli.pid);
      const exit = await done;
      clearTimeout(timer);
      receipt.lastTurnDiagnostics = { exit, stdout, stderr };
      if (exit.code !== 0) consent?.kill();
      assert.equal(exit.code, 0, `real lime exec exit: ${stderr}\n${stdout}`);
      await consentDone;
      const terminal = host === "tui" ? JSON.parse(stdout) : null;
      const events =
        host === "tui"
          ? []
          : stdout
              .trim()
              .split(/\r?\n/u)
              .map((line) => JSON.parse(line));
      if (host === "cli") {
        assert.equal(events[0].type, "thread.started");
        assert.equal(events[0].thread_id, thread.id);
        assert.equal(events.at(-1).type, "turn.completed");
      }
      const cold = await runChild(
        binaries.cliBinaryPath,
        ["thread", "show", thread.id, "--include-turns", ...cliConnection],
        cliEnv,
      );
      assert.equal(cold.code, 0, cold.stderr);
      const canonical = JSON.parse(cold.stdout).thread.turns.at(-1);
      const tools = canonical.items.filter(
        (item) =>
          item.type === "dynamicToolCall" && item.tool === "computer_use",
      );
      receipt.lastTurnDiagnostics = { canonical, stdout, stderr };
      assert(!operationError, operationError);
      assert.equal(canonical.status, "completed");
      assert.equal(tools.length, operations.length);
      assert(
        tools.every(
          (item) => item.status === (expectedFailure ? "failed" : "completed"),
        ),
        JSON.stringify(tools),
      );
      receipt.turns.push({
        threadId: thread.id,
        turnId: canonical.id,
        host: host === "tui" ? "lime resume via real PTY" : "lime exec resume",
        cliPid: cli.pid,
        exitCode: exit.code,
        events: events.map((e) => e.type),
        ...(terminal
          ? { terminal, transcript: path.basename(tuiTranscript) }
          : {}),
        toolItems: tools.map(({ id, status }) => ({ id, status })),
      });
      return fixture.requests
        .at(-1)
        .body.messages.filter(
          (message) =>
            message.role === "tool" && ids.includes(message.tool_call_id),
        );
    }
    const before = desktop
      ? (
          await request("thread/read", {
            threadId: thread.id,
            includeTurns: true,
          })
        ).thread.turns.map((t) => t.id)
      : [];
    const { turn } = desktop
      ? (await desktop.send(
          thread,
          `WPS fixture step ${call}: operate only the approved test workbook.`,
        ),
        { turn: null })
      : await request("turn/start", {
          threadId: thread.id,
          input: [
            {
              type: "text",
              text: "Operate only the approved WPS fixture workbook and report observed results.",
            },
          ],
          approvalPolicy: "never",
        });
    let canonical;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const read = await request("thread/read", {
        threadId: thread.id,
        includeTurns: true,
      });
      canonical = desktop
        ? read.thread.turns.find((entry) => !before.includes(entry.id))
        : read.thread.turns.find((entry) => entry.id === turn.id);
      if (canonical && canonical.status !== "inProgress") break;
      await delay(30);
    }
    assert.equal(canonical?.status, "completed");
    const tools = canonical.items.filter(
      (item) => item.type === "dynamicToolCall" && item.tool === "computer_use",
    );
    receipt.lastTurnDiagnostics = {
      canonical,
      remainingOperations: queue.length,
      providerRequests: fixture.requests.map(
        ({ path, body, responseKind, responseToolName }) => ({
          path,
          model: body.model,
          responseKind,
          responseToolName,
          toolNames: body.tools?.map(
            (tool) => tool.function?.name || tool.name,
          ),
        }),
      ),
    };
    assert(!operationError, operationError);
    assert.equal(tools.length, operations.length);
    assert(
      tools.every(
        (item) => item.status === (expectedFailure ? "failed" : "completed"),
      ),
      JSON.stringify(tools),
    );
    receipt.turns.push({
      threadId: thread.id,
      turnId: canonical.id,
      toolItems: tools.map(({ id, status }) => ({ id, status })),
    });
    return fixture.requests
      .at(-1)
      .body.messages.filter(
        (message) =>
          message.role === "tool" && ids.includes(message.tool_call_id),
      );
  };
  const key = (key, modifiers = []) => ({ action: "key", key, modifiers });
  const observe = { action: "observe", max_depth: 8, max_nodes: 256 };
  const writeCell = async (address, text) => {
    const result = await runOperations(
      wpsWriteCellOperations(address, text, (selection) => {
        (receipt.selectedCells ??= []).push(selection);
      }),
    );
    assertWpsCell(fixture.requests.at(-1).body, address, text);
    return result;
  };
  // Fresh values prevent an earlier successful workbook from masking broken input.
  const marker = `Lime WPS 原生 🟢 ${randomUUID().slice(0, 8)}`;
  const operand = randomInt(1000, 100000);
  const formula = `=B1+${operand}`;
  receipt.expected = { marker, operand, formula, result: operand * 2 };
  console.log("[wps-live] write and read back Unicode and formulas");
  const markerResult = await writeCell("A1", marker);
  assert(
    JSON.stringify(markerResult.at(-1).content).includes(marker),
    "real WPS AX marker reaches provider readback",
  );
  await writeCell("B1", String(operand));
  const formulaResult = await writeCell("C1", formula);
  assert(
    JSON.stringify(formulaResult.at(-1).content).includes(formula),
    "real formula bar reaches provider readback",
  );
  receipt.checks.push(
    "canonical native click/key/Unicode type wrote A1 and B1; formula bar readback verified C1 formula",
  );
  await runOperations([key("s", ["command"]), { action: "screenshot" }]);
  const images = [];
  const collectImages = (value) => {
    if (typeof value === "string" && value.startsWith("data:image/png;base64,"))
      images.push(value);
    else if (Array.isArray(value)) value.forEach(collectImages);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collectImages);
  };
  collectImages(fixture.requests.at(-1).body);
  assert(images.length, "the real WPS screenshot must reach the provider");
  const screenshot = path.join(
    path.dirname(workbook),
    host === "app-server" ? "wps-readback.png" : `wps-${host}-readback.png`,
  );
  await fs.writeFile(
    screenshot,
    Buffer.from(images.at(-1).split(",")[1], "base64"),
  );
  receipt.screenshot = screenshot;
  let saved;
  for (let attempt = 0; attempt < 40; attempt++) {
    saved = JSON.parse(
      run("python3", [
        "-c",
        'import json,sys,zipfile,xml.etree.ElementTree as E\nz=zipfile.ZipFile(sys.argv[1]);n={"s":"http://schemas.openxmlformats.org/spreadsheetml/2006/main"};strings=[]\nif "xl/sharedStrings.xml" in z.namelist():\n strings=["".join(e.itertext()) for e in E.fromstring(z.read("xl/sharedStrings.xml")).findall("s:si",n)]\nout={}\nfor c in E.fromstring(z.read("xl/worksheets/sheet1.xml")).findall(".//s:c",n):\n v=c.findtext("s:v",default="",namespaces=n);v=strings[int(v)] if c.get("t")=="s" else c.findtext("s:is/s:t",default=v,namespaces=n);out[c.get("r")]={"value":v,"formula":c.findtext("s:f",namespaces=n)}\nprint(json.dumps(out,ensure_ascii=False))',
        workbook,
      ]),
    );
    if (saved.A1?.value === marker && saved.C1?.value === String(operand * 2))
      break;
    await delay(100);
  }
  assert.equal(saved.A1?.value, marker);
  assert.equal(saved.B1?.value, String(operand));
  assert.equal(saved.C1?.formula, formula.slice(1));
  assert.equal(saved.C1?.value, String(operand * 2));
  receipt.readback = saved;
  receipt.checks.push(
    "WPS saved the real workbook; independent readback confirms fresh Unicode, numeric value and recalculated formula result; real screenshot reached the provider",
  );
  if (!terminalHost)
    assert.equal(
      (await request("computerUse/revoke", { grantId: grant.grant.id }))
        .revoked,
      true,
    );
  const denied = await runOperations([observe], true);
  assert.match(JSON.stringify(denied), /existing target grant/);
  receipt.checks.push(
    terminalHost
      ? "each real CLI connection obtained exact native consent; disconnected grant cannot authorize a later lime exec turn"
      : "revocation prevents further canonical WPS observation",
  );
  receipt.liveModelUsed = false;
  await desktop?.verifyVisible(thread, path.dirname(workbook));
  delete receipt.lastTurnDiagnostics;
  receipt.result = "pass";
} catch (error) {
  receipt.result = "fail";
  receipt.error = String(error);
  receipt.stderr = stderr;
} finally {
  consent?.kill();
  await desktop?.close().catch((error) => {
    receipt.result = "fail";
    receipt.teardownError = String(error);
  });
  lines?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.stdin.end();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(2000),
    ]);
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await fixture?.close();
  receipt.completedAt = new Date().toISOString();
  await fs.writeFile(evidence, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  await fs.rm(root, { recursive: true, force: true });
}
if (receipt.result !== "pass") process.exitCode = 1;
