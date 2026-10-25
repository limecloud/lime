import electronPath from "electron";
import { spawn } from "node:child_process";
import { resolveElectronLaunchPath } from "../lib/electron-launcher.mjs";
import {
  buildLocalAppServerAsync,
  resolveDevAppServerBackendEnv,
  resolveDevAppServerBinary,
  watchAppServerSources,
} from "../lib/electron-dev-sidecar.mjs";

const appServerBin = resolveDevAppServerBinary({ forceBuild: true });
const electronLaunchPath = resolveElectronLaunchPath({ electronPath });
const rendererDevServerUrl = "http://127.0.0.1:1420";

const existingRenderer = await isHttpHealthy(rendererDevServerUrl);
let vite = null;
let electron = null;
let shuttingDown = false;
let restartingElectron = false;
let appServerBuildInProgress = false;
let appServerBuildQueued = false;

if (existingRenderer) {
  console.log(
    `[electron-dev] reusing existing renderer dev server at ${rendererDevServerUrl}`,
  );
} else {
  vite = spawn("npm", ["run", "dev:renderer", "--", "--force"], {
    env: {
      ...process.env,
      LIME_ELECTRON_RENDERER: "1",
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  vite.once("error", (error) => {
    if (shuttingDown) {
      return;
    }
    console.error(
      `[electron-dev] failed to start renderer dev server: ${error.message}`,
    );
    process.exit(1);
  });

  vite.once("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const detail = signal ? `signal=${signal}` : `code=${code ?? "unknown"}`;
    console.error(`[electron-dev] renderer dev server exited (${detail})`);
    electron?.kill();
    process.exit(typeof code === "number" && code !== 0 ? code : 1);
  });
}

await startElectron("initial");

const watcher =
  process.env.LIME_ELECTRON_APP_SERVER_WATCH === "0"
    ? null
    : watchAppServerSources({
        onChange: (event) => {
          queueAppServerBuild(event);
        },
      });

async function startElectron(reason) {
  await waitForHttp(rendererDevServerUrl, 60_000);
  console.log(`[electron-dev] starting Electron (${reason})`);
  const electronArgs = ["."];
  const remoteDebuggingPort = normalizeRemoteDebuggingPort(
    process.env.LIME_ELECTRON_REMOTE_DEBUGGING_PORT,
  );
  if (remoteDebuggingPort) {
    electronArgs.push(`--remote-debugging-port=${remoteDebuggingPort}`);
  }
  electron = spawn(electronLaunchPath, electronArgs, {
    env: {
      ...process.env,
      ...(appServerBin ? { APP_SERVER_BIN: appServerBin } : {}),
      ...resolveDevAppServerBackendEnv({
        env: process.env,
      }),
      ...resolveElectronDevLaunchEnv(process.env),
      VITE_DEV_SERVER_URL: rendererDevServerUrl,
    },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  const child = electron;
  child.once("error", (error) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[electron-dev] Electron failed: ${error.message}`);
    shutdown(1);
  });

  child.once("exit", (code, signal) => {
    if (electron === child) {
      electron = null;
    }
    if (shuttingDown || restartingElectron) {
      return;
    }
    const detail = signal ? `signal=${signal}` : `code=${code ?? "unknown"}`;
    console.error(`[electron-dev] Electron exited (${detail})`);
    shutdown(typeof code === "number" ? code : 1);
  });
}

function normalizeRemoteDebuggingPort(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(
      "LIME_ELECTRON_REMOTE_DEBUGGING_PORT must be a numeric TCP port.",
    );
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      "LIME_ELECTRON_REMOTE_DEBUGGING_PORT must be between 1 and 65535.",
    );
  }
  return String(port);
}

function resolveElectronDevLaunchEnv(env) {
  if (!env.ELECTRON_E2E_USER_DATA_DIR?.trim()) {
    return {};
  }

  return {
    LIME_ELECTRON_E2E: "1",
    ...(env.LIME_ELECTRON_DEV_HTTP_BRIDGE?.trim()
      ? {}
      : { LIME_ELECTRON_DEV_HTTP_BRIDGE: "0" }),
  };
}

function queueAppServerBuild(event) {
  if (shuttingDown) {
    return;
  }
  if (appServerBuildInProgress) {
    appServerBuildQueued = true;
    return;
  }
  void rebuildAppServer(event);
}

async function rebuildAppServer(event) {
  appServerBuildInProgress = true;
  const source = event.filename || event.sourcePath || "unknown";
  console.log(`[electron-dev] app-server source changed: ${source}`);
  try {
    await buildLocalAppServerAsync();
    resolveDevAppServerBinary();
    console.log("[electron-dev] app-server rebuilt; restarting Electron");
    await restartElectron("app-server rebuilt");
  } catch (error) {
    console.error(
      `[electron-dev] app-server rebuild failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    appServerBuildInProgress = false;
    if (appServerBuildQueued) {
      appServerBuildQueued = false;
      queueAppServerBuild({ sourcePath: "queued changes", filename: "" });
    }
  }
}

async function restartElectron(reason) {
  if (shuttingDown) {
    return;
  }
  const child = electron;
  if (!child) {
    await startElectron(reason);
    return;
  }

  restartingElectron = true;
  child.kill();
  await waitForExit(child, 5_000);
  restartingElectron = false;
  await startElectron(reason);
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function shutdown(code = 0) {
  shuttingDown = true;
  watcher?.close();
  electron?.kill();
  vite?.kill();
  process.exit(code);
}

process.once("SIGINT", () => {
  shutdown(0);
});

process.once("SIGTERM", () => {
  shutdown(0);
});

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHttpHealthy(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  vite?.kill();
  throw new Error(`Timed out waiting for ${url}`);
}

async function isHttpHealthy(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}
