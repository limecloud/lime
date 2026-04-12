#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

const DEV_URL = process.env.LIME_WEB_BRIDGE_URL?.trim() || 'http://127.0.0.1:1420/';
const DEV_URL_TIMEOUT_MS = 1_500;
const REUSE_ONLY_TIMEOUT_MS = 10_000;
const REUSE_ONLY_INTERVAL_MS = 500;
const ROOT_MARKERS = ['<title>Lime</title>', '<div id="root"></div>'];
const REUSE_EXISTING_ONLY =
  process.env.LIME_WEB_BRIDGE_REUSE_EXISTING_ONLY?.trim() === '1';

const env = { ...process.env };
delete env.TAURI_ENV_PLATFORM;

env.LIME_BROWSER_BRIDGE = '1';

function isLimeDevShell(html) {
  return ROOT_MARKERS.some((marker) => html.includes(marker));
}

async function probeExistingDevServer(url) {
  if (typeof fetch !== 'function') {
    return { reachable: false };
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(DEV_URL_TIMEOUT_MS),
    });
    const html = await response.text();

    return {
      reachable: true,
      status: response.status,
      statusText: response.statusText,
      isLimeDevShell: response.ok && isLimeDevShell(html),
    };
  } catch {
    return { reachable: false };
  }
}

async function waitForExistingDevServer(url) {
  const startedAt = Date.now();
  let lastProbe = { reachable: false };

  while (Date.now() - startedAt < REUSE_ONLY_TIMEOUT_MS) {
    lastProbe = await probeExistingDevServer(url);

    if (lastProbe.reachable && lastProbe.isLimeDevShell) {
      return lastProbe;
    }

    if (lastProbe.reachable && !lastProbe.isLimeDevShell) {
      const statusLabel = `${lastProbe.status} ${lastProbe.statusText}`.trim();
      throw new Error(
        `[dev:web-bridge] ${DEV_URL} 已被其他服务占用，且返回内容不是 Lime dev shell（${statusLabel}）。请先关闭占用进程后重试。`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, REUSE_ONLY_INTERVAL_MS));
  }

  throw new Error(
    `[dev:web-bridge] 要求复用已有 Lime dev server，但 ${url} 在 ${REUSE_ONLY_TIMEOUT_MS}ms 内未就绪。`,
  );
}

async function waitForExitSignal() {
  await new Promise((resolve) => {
    const handleExit = () => resolve();
    process.once('SIGINT', handleExit);
    process.once('SIGTERM', handleExit);
  });
}

function startVite() {
  const child = spawn('npx', ['vite'], {
    stdio: 'inherit',
    shell: true,
    env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

async function main() {
  if (REUSE_EXISTING_ONLY) {
    await waitForExistingDevServer(DEV_URL);
    console.log(`[dev:web-bridge] 复用已存在的 Lime dev server: ${DEV_URL}`);
    await waitForExitSignal();
    return;
  }

  const existingServer = await probeExistingDevServer(DEV_URL);

  if (existingServer.reachable) {
    if (!existingServer.isLimeDevShell) {
      const statusLabel = `${existingServer.status} ${existingServer.statusText}`.trim();
      throw new Error(
        `[dev:web-bridge] ${DEV_URL} 已被其他服务占用，且返回内容不是 Lime dev shell（${statusLabel}）。请先关闭占用进程后重试。`,
      );
    }

    console.log(`[dev:web-bridge] 复用已存在的 Lime dev server: ${DEV_URL}`);
    await waitForExitSignal();
    return;
  }

  startVite();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
