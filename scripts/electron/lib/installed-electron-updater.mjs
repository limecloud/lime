import { spawn } from "node:child_process";

function withTimeout(promise, label, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function launchInstalledElectron({
  executablePath,
  env,
  args = ["--use-mock-keychain"],
  timeoutMs = 60_000,
}) {
  // Packaged N-1 cannot use Playwright Electron launch reliably on Windows.
  // Own the process directly; use its published Chromium and Node endpoints.
  const child = spawn(
    executablePath,
    ["--inspect=127.0.0.1:0", "--remote-debugging-port=0", ...args],
    { env, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  let browser;
  let inspectorUrl;
  let chromiumUrl;
  const endpoints = new Promise((resolve, reject) => {
    let output = "";
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      reject(
        new Error(
          `installed Electron exited before debug endpoints: code=${code}, signal=${signal}`,
        ),
      ),
    );
    child.stderr.on("data", (data) => {
      output = (output + data.toString()).slice(-16_384);
      inspectorUrl ||= /^Debugger listening on (ws:\/\/[^\r\n]+)/m.exec(
        output,
      )?.[1];
      chromiumUrl ||= /^DevTools listening on (ws:\/\/[^\r\n]+)/m.exec(
        output,
      )?.[1];
      if (inspectorUrl && chromiumUrl) resolve();
    });
  });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    if (browser)
      await withTimeout(
        browser.close(),
        "installed Electron CDP close",
        5_000,
      ).catch((error) => console.error(error.message));
  };
  try {
    await withTimeout(
      endpoints,
      "installed Electron debug endpoints",
      timeoutMs,
    );
    const { chromium } = await import("playwright");
    browser = await chromium.connectOverCDP(chromiumUrl, {
      timeout: timeoutMs,
    });
    return {
      child,
      pages: () => browser.contexts().flatMap((context) => context.pages()),
      evaluate: (callback) =>
        evaluateInstalledMain(inspectorUrl, callback, timeoutMs),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function evaluateInstalledMain(
  inspectorUrl,
  callback,
  timeoutMs = 10_000,
) {
  const socket = new WebSocket(inspectorUrl);
  try {
    return await withTimeout(
      new Promise((resolve, reject) => {
        socket.addEventListener("error", () =>
          reject(new Error("installed Electron inspector connection failed")),
        );
        socket.addEventListener("close", () =>
          reject(
            new Error(
              "installed Electron inspector closed before menu response",
            ),
          ),
        );
        socket.addEventListener("open", () =>
          socket.send(
            JSON.stringify({
              id: 1,
              method: "Runtime.evaluate",
              params: {
                expression: `(${callback.toString()})(require('electron'))`,
                includeCommandLineAPI: true,
                awaitPromise: true,
                returnByValue: true,
              },
            }),
          ),
        );
        socket.addEventListener("message", ({ data }) => {
          const response = JSON.parse(String(data));
          if (response.id !== 1) return;
          if (response.error || response.result?.exceptionDetails) {
            const detail =
              response.error?.message ||
              response.result.exceptionDetails.exception?.description ||
              response.result.exceptionDetails.text;
            reject(
              new Error(
                `installed Electron application menu failed: ${detail}`,
              ),
            );
          } else {
            resolve(response.result?.result?.value);
          }
        });
      }),
      "installed Electron application menu response",
      timeoutMs,
    );
  } finally {
    socket.close();
  }
}
