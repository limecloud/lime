#!/usr/bin/env node

import process from "node:process";

const DEFAULTS = {
  appUrl: "http://127.0.0.1:1420/",
  healthUrl: "http://127.0.0.1:3030/health",
  invokeUrl: "http://127.0.0.1:3030/invoke",
  timeoutMs: 180_000,
  intervalMs: 1_000,
};

const INVOKE_TIMEOUT_CEILING_MS = 180_000;
const INVOKE_RETRY_COUNT = 10;
const INVOKE_RETRY_DELAY_MS = 1_000;
const POST_HEALTH_SETTLE_MS = 1_500;
const POST_CONFIG_SETTLE_MS = 1_000;
const POST_LAUNCH_SETTLE_MS = 1_500;
const DEFAULT_ACTION_TIMEOUT_MS = 15_000;
const ONBOARDING_VERSION = "1.1.0";
const PROMPT_TEXT = "请回复一句：smoke harness";
const RUNTIME_TOOL_AVAILABILITY_OVERRIDE = {
  known: true,
  agentInitialized: true,
  source: "runtime_tools",
  availableToolCount: 2,
  webSearch: false,
  subagentCore: false,
  subagentTeamTools: false,
  subagentRuntime: false,
  taskRuntime: false,
  missingSubagentCoreTools: ["Agent", "SendMessage"],
  missingSubagentTeamTools: ["TeamCreate", "TeamDelete", "ListPeers"],
  missingTaskTools: ["TaskCreate"],
};
const REQUIRED_RUNTIME_SUMMARY_FLAGS = [
  "hasWorkbench",
  "hasRuntimeSummary",
  "hasWebSearchGap",
  "hasSubagentGap",
  "hasTeamGap",
  "hasTaskGap",
  "hasGapBanner",
];
const FORBIDDEN_PAGE_WARNINGS = [
  "当前 runtime tool surface 还没有暴露 WebSearch，联网搜索偏好本轮可能不会生效。",
  "当前 runtime tool surface 缺少 Agent / SendMessage / Team* current tools，任务拆分偏好本轮可能不会完全生效。",
];

function printHelp() {
  console.log(`
Lime Runtime Tool Surface Page Smoke

用途:
  通过真实 Lime 页面验证 runtime inventory -> 工作台 Harness -> Runtime 能力摘要的主链，
  同时确认首页空态不再弹出 runtime tool surface 黄提示。

用法:
  node scripts/agent-runtime-tool-surface-page-smoke.mjs [选项]

选项:
  --app-url <url>          前端地址，默认 http://127.0.0.1:1420/
  --health-url <url>       DevBridge 健康检查地址，默认 http://127.0.0.1:3030/health
  --invoke-url <url>       DevBridge invoke 地址，默认 http://127.0.0.1:3030/invoke
  --timeout-ms <ms>        总超时，默认 180000
  --interval-ms <ms>       轮询间隔，默认 1000
  -h, --help               显示帮助
`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--app-url" && argv[index + 1]) {
      options.appUrl = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }

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

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 30_000) {
    throw new Error("--timeout-ms 必须是 >= 30000 的数字");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 100) {
    throw new Error("--interval-ms 必须是 >= 100 的数字");
  }
  if (!options.appUrl) {
    throw new Error("--app-url 不能为空");
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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isTransientInvokeError(error) {
  return (
    error?.name === "TimeoutError" ||
    (error instanceof TypeError && error.message === "fetch failed")
  );
}

async function invoke(options, cmd, args) {
  const invokeTimeoutMs = Math.min(options.timeoutMs, INVOKE_TIMEOUT_CEILING_MS);
  const requestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ cmd, args }),
    signal: AbortSignal.timeout(invokeTimeoutMs),
  };

  for (let attempt = 1; attempt <= INVOKE_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(options.invokeUrl, requestInit);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const payload = await response.json();
      if (payload?.error) {
        throw new Error(String(payload.error));
      }

      return payload?.result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!isTransientInvokeError(error) || attempt >= INVOKE_RETRY_COUNT) {
        if (error?.name === "TimeoutError") {
          throw new Error(
            `[smoke:agent-runtime-tool-surface-page] ${cmd} 超时，${invokeTimeoutMs}ms 内未收到 DevBridge 响应`,
          );
        }
        throw new Error(
          `[smoke:agent-runtime-tool-surface-page] ${cmd} 请求失败: ${detail}`,
        );
      }
      console.warn(
        `[smoke:agent-runtime-tool-surface-page] ${cmd} 第 ${attempt} 次请求失败，${INVOKE_RETRY_DELAY_MS}ms 后重试: ${detail}`,
      );
      await sleep(INVOKE_RETRY_DELAY_MS);
    }
  }

  throw new Error(
    `[smoke:agent-runtime-tool-surface-page] ${cmd} 请求失败: unknown error`,
  );
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
        `[smoke:agent-runtime-tool-surface-page] DevBridge 已就绪 (${Date.now() - startedAt}ms)${
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
    `[smoke:agent-runtime-tool-surface-page] DevBridge 未就绪，请先启动 npm run tauri:dev:headless。最后错误: ${detail}`,
  );
}

function buildHarnessBootstrapScript() {
  return `(() => {
    localStorage.setItem("lime_onboarding_complete", "true");
    localStorage.setItem("lime_onboarding_version", ${JSON.stringify(ONBOARDING_VERSION)});
    localStorage.setItem("lime_user_profile", "developer");
    localStorage.setItem("lime.chat.harness-panel.visible.v1", "true");
    localStorage.setItem(
      "lime:debug:runtime-tool-availability:v1",
      ${JSON.stringify(JSON.stringify(RUNTIME_TOOL_AVAILABILITY_OVERRIDE))}
    );
    return true;
  })()`;
}

function buildFillPromptAndSendScript(prompt) {
  return `(() => {
    const textarea = document.querySelector('textarea[placeholder="有什么我可以帮你的？"]');
    const send = document.querySelector('button[aria-label="发送"]');
    if (!textarea || !send) {
      return { ok: false, reason: "missing-input-or-send" };
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) {
      return { ok: false, reason: "missing-native-textarea-setter" };
    }
    setter.call(textarea, ${JSON.stringify(prompt)});
    textarea.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: ${JSON.stringify(prompt)},
      inputType: "insertText",
    }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      ok: true,
      value: textarea.value,
      sendDisabled: Boolean(send.disabled),
    };
  })()`;
}

function buildClickSendScript() {
  return `(() => {
    const send = document.querySelector('button[aria-label="发送"]');
    if (!send) {
      return { ok: false, reason: "missing-send-button" };
    }
    send.click();
    return {
      ok: true,
      disabled: Boolean(send.disabled),
      ariaExpanded: send.getAttribute("aria-expanded"),
    };
  })()`;
}

function buildOpenWorkbenchScript() {
  return `(() => {
    const target = Array.from(document.querySelectorAll("button")).find(
      (button) => (button.textContent || "").trim() === "工作台",
    );
    if (!target) {
      return {
        ok: false,
        buttons: Array.from(document.querySelectorAll("button")).map((button) => ({
          text: (button.textContent || "").trim(),
          aria: button.getAttribute("aria-label"),
        })),
      };
    }
    target.click();
    return {
      ok: true,
      ariaExpanded: target.getAttribute("aria-expanded"),
    };
  })()`;
}

function buildRuntimeSummaryCheckScript() {
  return `(() => {
    const text = document.body ? document.body.innerText : "";
    return {
      hasWorkbench: text.includes("处理工作台"),
      hasRuntimeSummary: text.includes("Runtime 能力摘要"),
      hasWebSearchGap: text.includes("WebSearch 未接通"),
      hasSubagentGap: text.includes("子任务核心 tools 缺 2 项"),
      hasTeamGap: text.includes("Team current tools 缺 3 项"),
      hasTaskGap: text.includes("Task current tools 缺 1 项"),
      hasGapBanner: text.includes("当前 runtime current surface 仍有缺口"),
      hasLegacyWebSearchWarning: text.includes(${JSON.stringify(FORBIDDEN_PAGE_WARNINGS[0])}),
      hasLegacySubagentWarning: text.includes(${JSON.stringify(FORBIDDEN_PAGE_WARNINGS[1])}),
    };
  })()`;
}

function extractJavascriptValue(actionResult) {
  return (
    actionResult?.data?.result?.result?.value ??
    actionResult?.data?.result?.value ??
    actionResult?.data?.result ??
    null
  );
}

async function runBrowserAction(options, profileKey, action, args = {}) {
  return invoke(options, "browser_execute_action", {
    request: {
      profile_key: profileKey,
      backend: "cdp_direct",
      action,
      args,
      timeout_ms: DEFAULT_ACTION_TIMEOUT_MS,
    },
  });
}

async function runJavascript(options, profileKey, expression) {
  const result = await runBrowserAction(options, profileKey, "javascript", {
    expression,
    return_by_value: true,
  });
  return extractJavascriptValue(result);
}

async function readPageMarkdown(options, profileKey) {
  const result = await runBrowserAction(options, profileKey, "read_page");
  return String(result?.data?.markdown || "");
}

async function waitForCheck(options, label, check) {
  const startedAt = Date.now();
  let lastValue = null;

  while (Date.now() - startedAt < options.timeoutMs) {
    lastValue = await check();
    if (lastValue?.ok) {
      return lastValue.value;
    }
    await sleep(options.intervalMs);
  }

  throw new Error(
    `[smoke:agent-runtime-tool-surface-page] 等待 ${label} 超时，最后结果: ${JSON.stringify(
      lastValue?.value ?? null,
    )}`,
  );
}

async function ensureHarnessEnabled(options) {
  const originalConfig = await invoke(options, "get_config");
  const enabled =
    originalConfig?.developer?.workspace_harness_enabled === true;
  if (enabled) {
    return {
      originalConfig,
      changed: false,
    };
  }

  const nextConfig = deepClone(originalConfig);
  nextConfig.developer = {
    ...(nextConfig.developer || {}),
    workspace_harness_enabled: true,
  };
  await invoke(options, "save_config", nextConfig);
  await sleep(POST_CONFIG_SETTLE_MS);
  return {
    originalConfig,
    changed: true,
  };
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  await waitForHealth(options);
  await sleep(POST_HEALTH_SETTLE_MS);

  const { originalConfig, changed } = await ensureHarnessEnabled(options);
  const profileKey = `smoke-agent-runtime-tool-surface-page-${Date.now()}`;
  let sessionId = null;

  try {
    const launchResponse = await invoke(options, "launch_browser_session", {
      request: {
        profile_key: profileKey,
        url: options.appUrl,
        headless: true,
        open_window: false,
        stream_mode: "both",
      },
    });

    sessionId = launchResponse?.session?.session_id ?? null;
    assert(
      typeof sessionId === "string" && sessionId.trim(),
      "launch_browser_session 未返回 session.session_id",
    );
    await sleep(POST_LAUNCH_SETTLE_MS);

    await runJavascript(options, profileKey, buildHarnessBootstrapScript());
    await runBrowserAction(options, profileKey, "refresh_page");

    await waitForCheck(options, "首页空态加载", async () => {
      const text = await runJavascript(
        options,
        profileKey,
        'document.body ? document.body.innerText : ""',
      );
      return {
        ok:
          typeof text === "string" &&
          (text.includes("青柠一下，灵感即来") ||
            text.includes("有什么我可以帮你的？")),
        value: text,
      };
    });

    const prepared = await runJavascript(
      options,
      profileKey,
      buildFillPromptAndSendScript(PROMPT_TEXT),
    );
    assert(
      prepared?.ok === true,
      `准备输入失败: ${JSON.stringify(prepared ?? null)}`,
    );
    assert(prepared?.sendDisabled === false, "发送按钮仍处于禁用状态");

    const sendResult = await runJavascript(
      options,
      profileKey,
      buildClickSendScript(),
    );
    assert(
      sendResult?.ok === true,
      `发送最小请求失败: ${JSON.stringify(sendResult ?? null)}`,
    );

    await waitForCheck(options, "运行态工作台按钮出现", async () => {
      const text = await runJavascript(
        options,
        profileKey,
        'document.body ? document.body.innerText : ""',
      );
      return {
        ok: typeof text === "string" && text.includes("工作台"),
        value: text,
      };
    });

    const openWorkbench = await runJavascript(
      options,
      profileKey,
      buildOpenWorkbenchScript(),
    );
    assert(
      openWorkbench?.ok === true,
      `打开工作台失败: ${JSON.stringify(openWorkbench ?? null)}`,
    );

    const summaryFlags = await waitForCheck(
      options,
      "Runtime 能力摘要出现",
      async () => {
        const value = await runJavascript(
          options,
          profileKey,
          buildRuntimeSummaryCheckScript(),
        );
        const hasAllRequired = REQUIRED_RUNTIME_SUMMARY_FLAGS.every(
          (key) => value?.[key] === true,
        );
        const hasForbiddenWarning =
          value?.hasLegacyWebSearchWarning || value?.hasLegacySubagentWarning;
        return {
          ok: hasAllRequired && !hasForbiddenWarning,
          value,
        };
      },
    );

    const pageMarkdown = await readPageMarkdown(options, profileKey);
    for (const warning of FORBIDDEN_PAGE_WARNINGS) {
      assert(
        !pageMarkdown.includes(warning),
        `真实页面仍出现不应存在的页级告警: ${warning}`,
      );
    }

    console.log(
      `[smoke:agent-runtime-tool-surface-page] 通过 session=${sessionId} profile=${profileKey}`,
    );
    console.log(
      `[smoke:agent-runtime-tool-surface-page] summary=${JSON.stringify(summaryFlags)}`,
    );
  } finally {
    if (sessionId) {
      try {
        await invoke(options, "close_cdp_session", {
          request: {
            session_id: sessionId,
          },
        });
      } catch (error) {
        console.warn(
          `[smoke:agent-runtime-tool-surface-page] 清理浏览器会话失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (changed) {
      try {
        await invoke(options, "save_config", originalConfig);
      } catch (error) {
        console.warn(
          `[smoke:agent-runtime-tool-surface-page] 恢复 developer.workspace_harness_enabled 失败: ${
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
