import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
import { preparePendingQueueBackend } from "./pending-queue-fixture.mjs";

// Real Electron + current App Server on loopback. The external test backend admits
// a Thread, but must never execute a Turn. command/exec runs a real local command.
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
const remoteRoot = path.join(runtimeEnv.tempRoot, "remote-server");
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
const backendStarted = preparePendingQueueBackend({
  tempRoot: remoteRoot,
  env: remoteEnv,
});
const args = [
  "--listen",
  endpoint,
  "--backend",
  "external",
  "--backend-command",
  remoteEnv.APP_SERVER_BACKEND_COMMAND,
  ...JSON.parse(remoteEnv.APP_SERVER_BACKEND_ARGS).flatMap((value) => [
    "--backend-arg",
    value,
  ]),
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
const options = { timeoutMs: 120000, intervalMs: 250 };
let server;
let handle;
let observer;
let serverStderr = "";
const startServer = () => {
  serverStderr = "";
  const child = spawn(binary, args, {
    env: remoteEnv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (bytes) => {
    serverStderr = (
      serverStderr + bytes.toString().replaceAll(token, "<token>")
    ).slice(-3000);
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
  handle = await launchElectronFixture({
    options,
    runtimeEnv,
    appServerEnv,
    consoleErrors: [],
    pageErrors: [],
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
  checks.push("real safeStorage connection save returns metadata only");
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
    model: "fixture-model",
    modelProvider: "fixture-provider",
  });
  const threadId = started.result.thread.id;
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
  assert.equal(
    (
      await appServerCallFromPage(cloud, "thread/read", {
        threadId,
        includeTurns: true,
      })
    ).result.thread.id,
    threadId,
  );
  checks.push(
    "explicit reconnect and renderer reload recover the same server-owned Thread and isolated UI storage",
  );
  await closeElectronFixture(handle);
  handle = undefined;
  observer = await connectRemoteAppServer(
    { websocketUrl: endpoint, authToken: token },
    { clientInfo: { name: "cloud-after-desktop-exit", version: "1" } },
  );
  const readback = await observer.connection.request(
    observer.client.request("thread/read", { threadId, includeTurns: true }),
  );
  assert.equal(readback.result.thread.id, threadId);
  checks.push(
    "server-owned Thread remains readable after Electron fully exits",
  );
  const summary = {
    result: "passed",
    binarySha256: createHash("sha256")
      .update(await readFile(binary))
      .digest("hex"),
    checks,
    boundary:
      "Real Electron/preload/IPC and current Rust App Server on loopback. External test backend admits the Thread without any Turn execution. Real command/exec and durable Thread readback; no model task, cloud VM, Linux helper or cloud-provider acceptance.",
  };
  await assert.rejects(
    () => access(backendStarted),
    (error) => error.code === "ENOENT",
  );
  await writeFile(
    path.join(evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(JSON.stringify(summary));
} finally {
  await observer?.transport.close();
  await closeElectronFixture(handle);
  await stopServer();
  await rm(runtimeEnv.tempRoot, { recursive: true, force: true });
}
