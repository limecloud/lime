import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { connectRemoteAppServer } from "../../../packages/app-server-client/dist/index.js";
import { ensureElectronFixtureBuild } from "../../lib/electron-fixture-build.mjs";
import {
  electronAppServerBinaryDestination,
  resolveElectronAppServerRuntimeEnv,
} from "../../lib/electron-app-server-assets.mjs";
import {
  appServerCallFromPage,
  closeElectronFixture,
  createTempRuntimeEnv,
  launchElectronFixture,
} from "../mcp-config-fixture-smoke.mjs";
import { startOpenAiCompatibleFixtureServer } from "../../lib/openai-compatible-fixture-server.mjs";

// Real Electron and CLI share a durable runtime over authenticated loopback.
// Only the model's HTTP responses are scripted; tools and projections are real.
const rootDir = process.cwd();
const evidenceDir = path.resolve(
  process.argv[2] || ".lime/qc/cloud-desktop-connection",
);
ensureElectronFixtureBuild({
  rootDir,
  logPrefix: "[cloud-desktop-connection]",
});
await mkdir(evidenceDir, { recursive: true });
const runtimeEnv = createTempRuntimeEnv();
const appServerEnv = resolveElectronAppServerRuntimeEnv();
const binary =
  appServerEnv.APP_SERVER_BIN || electronAppServerBinaryDestination();
assert.ok(binary, "current App Server binary is required");
const cliBinary = path.resolve(
  process.env.LIME_CLI_BIN ||
    path.join(
      "lime-rs",
      "target",
      "debug",
      process.platform === "win32" ? "lime.exe" : "lime",
    ),
);
await access(cliBinary);
runtimeEnv.env.LIME_CONFIG_PATH = path.join(
  runtimeEnv.tempRoot,
  "desktop-config.yaml",
);
const remoteRoot = path.join(
  await realpath(runtimeEnv.tempRoot),
  "remote-server",
);
const workspace = path.join(remoteRoot, "workspace");
await mkdir(workspace, { recursive: true });
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const endpoint = `ws://127.0.0.1:${port}`;
const token = randomBytes(32).toString("base64url");
const tokenDigest = createHash("sha256").update(token).digest("hex");
const remoteEnv = {
  ...runtimeEnv.env,
  LIME_HOME: path.join(remoteRoot, "home"),
  LIME_CONFIG_PATH: path.join(remoteRoot, "config.yaml"),
  OTEL_SDK_DISABLED: "true",
};
const model = "cloud-runtime-fixture";
const desktopMarker = "lime-cloud-desktop-tool-ok";
const cliMarker = "lime-cloud-cli-tool-ok";
const provider = await startOpenAiCompatibleFixtureServer({
  model,
  apiKey: "synthetic-cloud-runtime-key",
  scriptedResponses: [
    ({ body }) => {
      const tools = body.tools ?? [];
      if (
        !tools.some(
          (tool) => (tool.function?.name ?? tool.name) === "exec_command",
        )
      )
        return { type: "text", content: "Cloud runtime fixture" };
      const messages = body.messages ?? [];
      const current = messages.findLastIndex(
        (message) => message.role === "user",
      );
      const cli = JSON.stringify(messages).includes("LIME_CLOUD_CLI_STEP");
      const marker = cli ? cliMarker : desktopMarker;
      if (
        messages.slice(current + 1).some((message) => message.role === "tool")
      )
        return { type: "text", content: `${marker}: completed` };
      return {
        type: "tool_call",
        id: cli ? "cloud-cli-command" : "cloud-desktop-command",
        name: "exec_command",
        arguments: {
          cmd: cli
            ? `test "$(cat desktop-task.txt)" = '${desktopMarker}' && printf '%s' '${cliMarker}' | tee cli-task.txt`
            : `printf '%s' '${desktopMarker}' | tee desktop-task.txt`,
          yield_time_ms: 1000,
        },
      };
    },
  ],
});
const args = [
  "--listen",
  endpoint,
  "--backend",
  "runtime",
  "--data-dir",
  path.join(remoteRoot, "data"),
  "--app-data-dir",
  path.join(remoteRoot, "app"),
  "--ws-auth",
  "capability-token",
  "--ws-token-sha256",
  tokenDigest,
];
const resource = {
  provider: "wuying",
  profile: "loopback-gate",
  regionId: "local-test",
  resourceId: "ecd-loopback-gate",
};
const checks = [];
const notifications = [];
const pageErrors = [];
const consoleErrors = [];
const options = { timeoutMs: 120000, intervalMs: 250 };
let server;
let handle;
let observer;
let serverStderr = "";
const json = (name, value) =>
  writeFile(
    path.join(evidenceDir, name),
    JSON.stringify(value, null, 2) + "\n",
  );
async function connectObserver() {
  return await connectRemoteAppServer(
    { websocketUrl: endpoint, authToken: token },
    { clientInfo: { name: "cloud-runtime-observer", version: "1" } },
  );
}
async function request(method, params) {
  const response = await observer.connection.request(
    observer.client.request(method, params),
  );
  assert.ok(!response.error, `${method}: ${JSON.stringify(response.error)}`);
  return response.result;
}
async function waitForTurn(threadId, turnId) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const event = await observer.connection.nextNotification(
      deadline - Date.now(),
    );
    notifications.push(event);
    if (
      event.method === "turn/completed" &&
      event.params?.threadId === threadId &&
      event.params.turn?.id === turnId
    ) {
      assert.equal(
        event.params.turn.status,
        "completed",
        JSON.stringify(event),
      );
      return;
    }
  }
  throw new Error(`No public turn/completed for ${threadId}/${turnId}`);
}
function assertTurn(turn, marker) {
  assert.equal(turn.status, "completed", JSON.stringify(turn));
  const command = turn.items.find((item) => item.type === "commandExecution");
  assert.ok(
    command,
    `Missing canonical commandExecution: ${JSON.stringify(turn)}`,
  );
  assert.equal(command.status, "completed");
  assert.equal(command.exitCode, 0);
  assert.ok(command.aggregatedOutput.includes(marker));
  assert.ok(
    turn.items.some(
      (item) =>
        item.type === "agentMessage" && item.text === `${marker}: completed`,
    ),
  );
  assert.equal(
    new Set(turn.items.map((item) => item.id)).size,
    turn.items.length,
  );
  const completed = notifications.filter(
    (event) =>
      event.method === "item/completed" && event.params?.turnId === turn.id,
  );
  assert.ok(
    completed.some((event) => event.params.item.id === command.id),
    "Public tool completion keeps canonical Item identity",
  );
  return command;
}
async function showThread(page, sessionId, marker) {
  await page.evaluate(
    (sessionId) =>
      sessionStorage.setItem(
        "lime.appNavigation.restore.v1",
        JSON.stringify({
          page: "agent",
          params: { initialSessionId: sessionId },
        }),
      ),
    sessionId,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page
    .locator(`[data-testid="composer-editor"][data-session-id="${sessionId}"]`)
    .waitFor({ state: "visible" });
  await page
    .getByText(`${marker}: completed`, { exact: true })
    .first()
    .waitFor({ state: "visible" });
}
const startServer = () => {
  serverStderr = "";
  const child = spawn(binary, args, {
    env: remoteEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (bytes) => {
    serverStderr = (
      serverStderr + bytes.toString().replaceAll(token, "<token>")
    ).slice(-20000);
  });
  child.on("error", () => undefined);
  return child;
};
async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error(
        `loopback App Server exited before readiness: ${serverStderr}`,
      );
    try {
      const connected = await connectRemoteAppServer(
        { websocketUrl: endpoint, authToken: token, connectTimeoutMs: 1000 },
        { clientInfo: { name: "cloud-connection-gate", version: "1" } },
        { initializeTimeoutMs: 1000 },
      );
      await connected.transport.close();
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error("loopback App Server did not become ready");
}
async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(3000),
  ]);
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGKILL");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}
try {
  server = startServer();
  await waitForServer();
  observer = await connectObserver();
  const created = await request("modelProvider/create", {
    name: "Cloud runtime gate",
    providerType: "openai",
    apiHost: provider.baseUrl,
  });
  const providerId = created.provider.id;
  await request("modelProvider/update", {
    providerId,
    enabled: true,
    sortOrder: 1,
    models: [
      {
        id: model,
        capability: {
          taskFamilies: ["chat"],
          inputModalities: ["text"],
          outputModalities: ["text"],
          runtimeFeatures: ["streaming", "tool_calling"],
          capabilities: {
            vision: false,
            tools: true,
            streaming: true,
            jsonMode: true,
            functionCalling: true,
            reasoning: false,
          },
        },
      },
    ],
  });
  await request("modelProviderKey/create", {
    providerId,
    apiKey: "synthetic-cloud-runtime-key",
    alias: "cloud-runtime-gate",
    replaceExisting: true,
  });
  handle = await launchElectronFixture({
    options,
    runtimeEnv,
    appServerEnv,
    consoleErrors,
    pageErrors,
  });
  const local = handle.page;
  const saved = await local.evaluate(
    ({ resource, endpoint, token }) =>
      window.electronAPI.invoke("cloud_desktop_connection", {
        request: { action: "save", resource, endpoint, token },
      }),
    { resource, endpoint, token },
  );
  assert.equal(saved.exists, true);
  assert.equal(saved.available, true);
  assert.equal("token" in saved, false);
  checks.push("real encrypted connection save returns metadata only");
  const [cloud] = await Promise.all([
    handle.app.waitForEvent("window"),
    local.evaluate(
      (resource) =>
        window.electronAPI.invoke("cloud_desktop_connection", {
          request: { action: "open", resource },
        }),
      resource,
    ),
  ]);
  cloud.setDefaultTimeout(options.timeoutMs);
  cloud.on("pageerror", (error) => pageErrors.push(error.message));
  await cloud.waitForFunction(
    () =>
      window.electronAPI?.cloudDesktop &&
      document.querySelector('[data-testid="app-sidebar"]'),
  );
  assert.equal(
    await cloud.evaluate(() => window.electronAPI.agentRoot),
    undefined,
  );
  checks.push(
    "cloud window loads the existing application without local agentRoot",
  );
  const started = await appServerCallFromPage(cloud, "thread/start", {
    cwd: workspace,
    ephemeral: false,
    model,
    modelProvider: providerId,
    runtimeWorkspaceRoots: [workspace],
  });
  const threadId = started.result.thread.id;
  const sessionId = started.result.thread.sessionId;
  assert.ok(threadId && sessionId, "thread/start returns canonical identity");
  assert.equal(started.result.cwd, workspace);
  const marker = "lime-cloud-loopback-execution";
  const executed = await appServerCallFromPage(cloud, "command/exec", {
    command: [
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync('probe.txt','lime-cloud-loopback-execution');process.stdout.write('lime-cloud-loopback-execution')",
    ],
    cwd: workspace,
    permissionProfile: ":danger-full-access",
    timeoutMs: 15000,
  });
  assert.equal(executed.result.exitCode, 0);
  assert.equal(executed.result.stdout, marker);
  assert.equal(
    await readFile(path.join(workspace, "probe.txt"), "utf8"),
    marker,
  );
  checks.push(
    "cloud window sends thread/start and real command/exec through authenticated WebSocket",
  );
  await request("thread/resume", { threadId });
  const turn = await appServerCallFromPage(cloud, "turn/start", {
    threadId,
    input: [
      {
        type: "text",
        text: "LIME_CLOUD_DESKTOP_STEP: write the desktop task file using exec_command.",
      },
    ],
    model,
    cwd: workspace,
    runtimeWorkspaceRoots: [workspace],
    approvalPolicy: "never",
    sandboxPolicy: "danger-full-access",
  });
  const desktopTurnId = turn.result.turn.id;
  await waitForTurn(threadId, desktopTurnId);
  const desktopThread = (
    await request("thread/read", { threadId, includeTurns: true })
  ).thread;
  assert.equal(desktopThread.turns.length, 1);
  assert.equal(desktopThread.turns[0].id, desktopTurnId);
  assertTurn(desktopThread.turns[0], desktopMarker);
  assert.equal(
    await readFile(path.join(workspace, "desktop-task.txt"), "utf8"),
    desktopMarker,
  );
  await showThread(cloud, sessionId, desktopMarker);
  await json("desktop-thread.json", desktopThread);
  checks.push(
    "real runtime consumes model HTTP response, executes a tool and projects completed canonical Turn/Items in the Cloud GUI",
  );
  await assert.rejects(
    () =>
      appServerCallFromPage(cloud, "cloud/desktop", {
        action: "listResources",
      }),
    /local App Server transport/,
  );
  const denied = await cloud.evaluate(async () => {
    const results = [];
    for (const operation of [
      () => window.electronAPI.invoke("cloud_session_credential_status"),
      () => window.electronAPI.dialog.open(),
      () => window.electronAPI.shell.open("/tmp/lime-cloud-forbidden"),
    ]) {
      try {
        await operation();
        results.push(false);
      } catch {
        results.push(true);
      }
    }
    return results;
  });
  assert.deepEqual(denied, [true, true, true]);
  checks.push(
    "preload and actual dialog/shell IPC reject local capabilities; remote cloud management is denied",
  );
  await local.evaluate(() => {
    localStorage.setItem("cloud-isolation-probe", "local");
    window.electronAPI.listen("cloud-isolation-event", () =>
      localStorage.setItem("cloud-event-leak", "yes"),
    );
  });
  assert.equal(
    await cloud.evaluate(() => localStorage.getItem("cloud-isolation-probe")),
    null,
  );
  await cloud.evaluate(async () => {
    localStorage.setItem("cloud-isolation-probe", "cloud");
    await window.electronAPI.emit("cloud-isolation-event");
  });
  await delay(200);
  assert.equal(
    await local.evaluate(() => localStorage.getItem("cloud-isolation-probe")),
    "local",
  );
  assert.equal(
    await local.evaluate(() => localStorage.getItem("cloud-event-leak")),
    null,
  );
  const sessions = await handle.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      cloud: window.webContents
        .getLastWebPreferences()
        .additionalArguments?.some((value) =>
          value.startsWith("--lime-cloud-desktop="),
        ),
      storage: window.webContents.session.storagePath,
    })),
  );
  assert.notEqual(
    sessions.find((session) => session.cloud)?.storage,
    sessions.find((session) => !session.cloud)?.storage,
  );
  checks.push(
    "real Chromium session storage and renderer events stay isolated from the local window",
  );
  await cloud.screenshot({
    path: path.join(evidenceDir, "cloud-connected.png"),
  });
  await observer.transport.close();
  observer = undefined;
  await stopServer();
  await cloud.waitForFunction(
    async () =>
      !(await window.electronAPI.invoke("cloud_desktop_window_status"))
        .connected,
  );
  await cloud.waitForFunction(
    () => !document.querySelector('[data-testid="app-sidebar"]'),
  );
  await cloud.screenshot({
    path: path.join(evidenceDir, "cloud-disconnected.png"),
  });
  assert.equal(
    (
      await appServerCallFromPage(local, "cloud/desktop", {
        action: "listResources",
      })
    ).result.data.resources.length,
    0,
  );
  checks.push(
    "remote disconnect removes stale task UI while local App Server management remains available",
  );
  server = startServer();
  await waitForServer();
  const reconnected = await cloud.evaluate(() =>
    window.electronAPI.invoke("cloud_desktop_window_reconnect"),
  );
  assert.equal(reconnected.connected, true);
  assert.equal(reconnected.generation, 2);
  await cloud.reload();
  await cloud.waitForFunction(() =>
    document.querySelector('[data-testid="app-sidebar"]'),
  );
  assert.equal(
    await cloud.evaluate(() => localStorage.getItem("cloud-isolation-probe")),
    "cloud",
  );
  const recovered = (
    await appServerCallFromPage(cloud, "thread/read", {
      threadId,
      includeTurns: true,
    })
  ).result.thread;
  assert.equal(recovered.id, threadId);
  assert.deepEqual(recovered.turns, desktopThread.turns);
  await showThread(cloud, sessionId, desktopMarker);
  checks.push(
    "explicit reconnect and renderer reload recover the same server-owned Thread/Turn/Items and isolated UI storage",
  );
  const electronProcess = handle.app.process();
  await closeElectronFixture(handle);
  assert.equal(
    electronProcess.exitCode,
    0,
    "Electron has fully exited before CLI starts",
  );
  assert.equal(electronProcess.signalCode, null);
  handle = undefined;
  observer = await connectObserver();
  await request("thread/resume", { threadId });
  const cli = await promisify(execFile)(
    cliBinary,
    [
      "exec",
      "resume",
      threadId,
      "LIME_CLOUD_CLI_STEP: verify the desktop file and write the CLI task file using exec_command.",
      "--remote",
      endpoint,
      "--remote-auth-token-env",
      "LIME_CLOUD_GATE_TOKEN",
      "--model",
      model,
      "--provider",
      providerId,
      "--cd",
      workspace,
      "--sandbox",
      "danger-full-access",
      "--ask-for-approval",
      "never",
      "--json",
    ],
    {
      cwd: rootDir,
      env: {
        ...runtimeEnv.env,
        LIME_CLOUD_GATE_TOKEN: token,
        OTEL_SDK_DISABLED: "true",
      },
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
    },
  );
  await writeFile(path.join(evidenceDir, "cli-events.jsonl"), cli.stdout);
  await writeFile(
    path.join(evidenceDir, "cli-stderr.log"),
    cli.stderr.replaceAll(token, "<token>"),
  );
  const events = cli.stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(events[0].type, "thread.started");
  assert.equal(events[0].thread_id, threadId);
  assert.equal(events.at(-1).type, "turn.completed");
  const readback = (
    await request("thread/read", { threadId, includeTurns: true })
  ).thread;
  assert.equal(readback.id, threadId);
  assert.equal(readback.sessionId, sessionId);
  assert.equal(readback.turns.length, 2);
  assert.deepEqual(readback.turns[0], desktopThread.turns[0]);
  const cliTurn = readback.turns[1];
  assert.notEqual(cliTurn.id, desktopTurnId);
  await waitForTurn(threadId, cliTurn.id);
  const cliCommand = assertTurn(cliTurn, cliMarker);
  const cliItem = events.find(
    (event) =>
      event.type === "item.completed" &&
      event.item?.type === "command_execution",
  );
  // Codex exec JSONL assigns surface-local item_N IDs; thread show returns the canonical IDs.
  assert.ok(cliItem);
  assert.ok(
    events.some(
      (event) =>
        event.type === "item.started" && event.item?.id === cliItem.item.id,
    ),
  );
  assert.equal(cliItem.item.exit_code, cliCommand.exitCode);
  assert.equal(cliItem.item.aggregated_output, cliCommand.aggregatedOutput);
  assert.ok(
    events.some(
      (event) =>
        event.type === "item.completed" &&
        event.item?.type === "agent_message" &&
        event.item.text === `${cliMarker}: completed`,
    ),
  );
  assert.equal(
    await readFile(path.join(workspace, "cli-task.txt"), "utf8"),
    cliMarker,
  );
  await json("cli-thread.json", readback);
  const shown = await promisify(execFile)(
    cliBinary,
    [
      "thread",
      "show",
      threadId,
      "--include-turns",
      "--remote",
      endpoint,
      "--remote-auth-token-env",
      "LIME_CLOUD_GATE_TOKEN",
    ],
    {
      cwd: rootDir,
      env: {
        ...runtimeEnv.env,
        LIME_CLOUD_GATE_TOKEN: token,
        OTEL_SDK_DISABLED: "true",
      },
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024,
    },
  );
  const cliCanonical = JSON.parse(shown.stdout).thread;
  assert.equal(cliCanonical.id, threadId);
  assert.deepEqual(cliCanonical.turns, readback.turns);
  await json("cli-canonical-thread.json", cliCanonical);
  checks.push(
    "after Electron fully exits, real lime exec resume runs a second tool Turn in the same Thread; CLI thread show matches the server's canonical Turn/Items",
  );
  assert.equal(pageErrors.length, 0, JSON.stringify(pageErrors));
  const toolRequests = provider.requests.filter(
    (request) => request.responseKind === "tool_call",
  );
  assert.equal(toolRequests.length, 2);
  assert.ok(
    provider.requests.every(
      (request) =>
        request.authorization === "Bearer synthetic-cloud-runtime-key",
    ),
  );
  assert.ok(
    provider.requests.some(
      (request) =>
        JSON.stringify(request.body).includes(desktopMarker) &&
        request.responseKind === "text",
    ),
  );
  assert.ok(
    provider.requests.some(
      (request) =>
        JSON.stringify(request.body).includes(cliMarker) &&
        request.responseKind === "text",
    ),
  );
  const summary = {
    result: "passed",
    binarySha256: createHash("sha256")
      .update(await readFile(binary))
      .digest("hex"),
    cliSha256: createHash("sha256")
      .update(await readFile(cliBinary))
      .digest("hex"),
    backend: "runtime",
    threadId,
    sessionId,
    turnIds: [desktopTurnId, cliTurn.id],
    pageErrors,
    consoleErrors,
    electronExit: {
      code: electronProcess.exitCode,
      signal: electronProcess.signalCode,
    },
    checks,
    boundary:
      "Real macOS Electron/preload/IPC, authenticated loopback App Server runtime, HTTP model fixture, tool execution, server restart and real remote CLI after Electron exit. Generic Electron launcher uses its existing mock-keychain flag; no vault conclusion is drawn here. No live model, cloud VM, Linux helper or user object store.",
  };
  await json("summary.json", summary);
  console.log(JSON.stringify(summary));
} catch (error) {
  await json("failure.json", {
    result: "failed",
    checks,
    pageErrors,
    consoleErrors,
    serverStderr,
    error: String(error.stack ?? error).replaceAll(token, "<token>"),
  });
  throw error;
} finally {
  await json("provider-requests.json", provider.requests);
  await json("notifications.json", notifications);
  await observer?.transport.close();
  await closeElectronFixture(handle);
  await stopServer();
  await provider.close();
  await rm(runtimeEnv.tempRoot, { recursive: true, force: true });
}
