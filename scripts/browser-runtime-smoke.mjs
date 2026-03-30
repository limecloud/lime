#!/usr/bin/env node

import process from "node:process";

const DEFAULTS = {
  healthUrl: "http://127.0.0.1:3030/health",
  invokeUrl: "http://127.0.0.1:3030/invoke",
  timeoutMs: 90_000,
  intervalMs: 1_000,
  launchUrl: "about:blank",
  openWindow: false,
  headless: false,
  streamMode: "both",
};

function printHelp() {
  console.log(`
Lime Browser Runtime Smoke

用途:
  验证 browser runtime 最短主链可用：启动会话、读取状态、执行最小动作，并确认审计日志带出 session / target 关联键。

用法:
  node scripts/browser-runtime-smoke.mjs [选项]

选项:
  --health-url <url>       DevBridge 健康检查地址，默认 http://127.0.0.1:3030/health
  --invoke-url <url>       DevBridge invoke 地址，默认 http://127.0.0.1:3030/invoke
  --timeout-ms <ms>        等待健康检查超时，默认 90000
  --interval-ms <ms>       健康检查轮询间隔，默认 1000
  --launch-url <url>       启动浏览器会话的 URL，默认 about:blank
  --open-window            显式打开浏览器窗口
  --headless               以无界面浏览器会话执行 smoke，避免弹出空白 Chrome
  --stream-mode <mode>     events | frames | both，默认 both
  -h, --help               显示帮助
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--health-url" && argv[index + 1]) {
      options.healthUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg === "--invoke-url" && argv[index + 1]) {
      options.invokeUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms" && argv[index + 1]) {
      options.timeoutMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--interval-ms" && argv[index + 1]) {
      options.intervalMs = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--launch-url" && argv[index + 1]) {
      options.launchUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg === "--stream-mode" && argv[index + 1]) {
      options.streamMode = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg === "--open-window") {
      options.openWindow = true;
      continue;
    }
    if (arg === "--headless") {
      options.headless = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1_000) {
    throw new Error("--timeout-ms 必须是 >= 1000 的数字");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms 必须是 >= 100 的数字");
  }
  if (!["events", "frames", "both"].includes(options.streamMode)) {
    throw new Error("--stream-mode 只支持 events / frames / both");
  }
  if (!options.launchUrl) {
    throw new Error("--launch-url 不能为空");
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function invoke(invokeUrl, cmd, args) {
  const response = await fetch(invokeUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ cmd, args }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new Error(String(payload.error));
  }

  return payload?.result;
}

async function waitForHealth(options) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const response = await fetch(options.healthUrl, { method: "GET" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      console.log(
        `[smoke:browser-runtime] DevBridge 已就绪 (${Date.now() - startedAt}ms)${
          payload?.status ? ` status=${payload.status}` : ""
        }`,
      );
      return;
    } catch (error) {
      lastError = error;
      await sleep(options.intervalMs);
    }
  }

  const detail =
    lastError instanceof Error
      ? lastError.message
      : String(lastError || "unknown error");
  throw new Error(
    `[smoke:browser-runtime] DevBridge 未就绪，请先启动 npm run tauri:dev:headless。最后错误: ${detail}`,
  );
}

function findLatestAudit(logs, matcher) {
  return (logs || []).find((item) => matcher(item));
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  await waitForHealth(options);

  const profileKey = `smoke-browser-runtime-${Date.now()}`;
  let sessionId = null;

  try {
    const launchResponse = await invoke(options.invokeUrl, "launch_browser_session", {
      request: {
        profile_key: profileKey,
        url: options.launchUrl,
        open_window: options.openWindow,
        headless: options.headless,
        stream_mode: options.streamMode,
      },
    });

    sessionId = launchResponse?.session?.session_id ?? null;
    assert(
      typeof sessionId === "string" && sessionId.trim(),
      "launch_browser_session 未返回 session.session_id",
    );
    assert(
      launchResponse?.session?.profile_key === profileKey,
      "launch_browser_session 返回的 profile_key 与请求不一致",
    );

    const sessionState = await invoke(
      options.invokeUrl,
      "get_browser_session_state",
      {
        request: {
          session_id: sessionId,
        },
      },
    );
    assert(
      sessionState?.session_id === sessionId,
      "get_browser_session_state 返回的 session_id 不一致",
    );
    assert(
      sessionState?.profile_key === profileKey,
      "get_browser_session_state 返回的 profile_key 不一致",
    );
    assert(
      typeof sessionState?.target_id === "string" && sessionState.target_id.trim(),
      "get_browser_session_state 未返回 target_id",
    );

    const actionResult = await invoke(options.invokeUrl, "browser_execute_action", {
      request: {
        profile_key: profileKey,
        action: "read_page",
        timeout_ms: 20_000,
      },
    });
    assert(actionResult?.success === true, "browser_execute_action(read_page) 未成功");
    assert(
      actionResult?.session_id === sessionId,
      "browser_execute_action 未返回对应的 session_id",
    );
    assert(
      actionResult?.target_id === sessionState.target_id,
      "browser_execute_action 未返回对应的 target_id",
    );

    const auditLogs = await invoke(options.invokeUrl, "get_browser_action_audit_logs", {
      limit: 10,
    });
    const launchAudit = findLatestAudit(
      auditLogs,
      (item) =>
        item?.kind === "launch" &&
        item?.profile_key === profileKey &&
        item?.session_id === sessionId,
    );
    assert(launchAudit, "未找到对应的 launch audit 记录");
    assert(
      launchAudit?.target_id === sessionState.target_id,
      "launch audit 缺少 target_id 关联键",
    );

    const actionAudit = findLatestAudit(
      auditLogs,
      (item) =>
        item?.kind === "action" &&
        item?.action === "read_page" &&
        item?.profile_key === profileKey,
    );
    assert(actionAudit, "未找到对应的 action audit 记录");
    assert(
      actionAudit?.session_id === sessionId,
      `action audit 缺少 session_id 关联键，record=${actionAudit?.id ?? "unknown"}`,
    );
    assert(
      actionAudit?.target_id === sessionState.target_id,
      `action audit 缺少 target_id 关联键，record=${actionAudit?.id ?? "unknown"}`,
    );

    console.log(
      `[smoke:browser-runtime] 通过 session=${sessionId} target=${sessionState.target_id} profile=${profileKey}`,
    );
  } finally {
    if (sessionId) {
      try {
        await invoke(options.invokeUrl, "close_cdp_session", {
          request: {
            session_id: sessionId,
          },
        });
      } catch (error) {
        console.warn(
          `[smoke:browser-runtime] 清理会话失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
