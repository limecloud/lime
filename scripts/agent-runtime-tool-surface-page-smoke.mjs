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
const BROWSER_ACTION_RETRY_COUNT = 6;
const BROWSER_ACTION_RETRY_DELAY_MS = 1_000;
const BROWSER_SESSION_RECOVERY_LIMIT = 2;
const POST_HEALTH_SETTLE_MS = 1_500;
const POST_LAUNCH_SETTLE_MS = 1_500;
const DEFAULT_ACTION_TIMEOUT_MS = 45_000;
const ONBOARDING_VERSION = "1.1.0";
const PROMPT_TEXT = "请回复一句：smoke harness";
const SMOKE_PROFILE_KEY = "smoke-agent-runtime-tool-surface-page";
const WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY =
  "lime:debug:workspace-harness-enabled:v1";
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
  通过真实 Lime 页面验证 runtime inventory -> Harness -> Runtime 能力摘要的主链，
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

function logStage(label) {
  console.log(`[smoke:agent-runtime-tool-surface-page] stage=${label}`);
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

async function closeSmokeProfileSession(options, profileKey, label) {
  try {
    await invoke(options, "close_chrome_profile_session", {
      profile_key: profileKey,
    });
  } catch (error) {
    console.warn(
      `[smoke:agent-runtime-tool-surface-page] ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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
    localStorage.setItem(
      ${JSON.stringify(WORKSPACE_HARNESS_DEBUG_OVERRIDE_KEY)},
      "true"
    );
    localStorage.setItem("lime.chat.harness-panel.visible.v1", "true");
    localStorage.setItem(
      "lime:debug:runtime-tool-availability:v1",
      JSON.stringify(${JSON.stringify(RUNTIME_TOOL_AVAILABILITY_OVERRIDE)})
    );
    return true;
  })()`;
}

function buildPageStorageReadyScript(appUrl) {
  return `(() => {
    try {
      const href = window.location.href;
      const readyState = document.readyState;
      void window.localStorage;
      return {
        ok: href.startsWith(${JSON.stringify(appUrl)}) && readyState !== "loading",
        href,
        readyState,
        title: document.title,
      };
    } catch (error) {
      return {
        ok: false,
        href: window.location.href,
        readyState: document.readyState,
        title: document.title,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })()`;
}

function buildComposerReadyScript() {
  return `(() => {
    const collectButtons = () =>
      Array.from(document.querySelectorAll("button")).map((button) => ({
        text: (button.textContent || "").trim(),
        aria: button.getAttribute("aria-label"),
        title: button.getAttribute("title"),
        disabled: Boolean(button.disabled),
      }));
    const textarea = Array.from(
      document.querySelectorAll(
        '[data-testid="inputbar-core-container"] textarea, textarea',
      ),
    ).find(
      (candidate) =>
        candidate instanceof HTMLTextAreaElement && !candidate.disabled,
    );
    const send = document.querySelector(
      'button[aria-label="发送"], button[title="发送"]',
    );
    return {
      ok: Boolean(textarea) && Boolean(send),
      buttons: collectButtons(),
      textareas: Array.from(document.querySelectorAll("textarea")).map(
        (candidate) => ({
          disabled: Boolean(candidate.disabled),
          placeholder: candidate.getAttribute("placeholder"),
          value: candidate.value,
        }),
      ),
    };
  })()`;
}

function buildFillPromptScript(prompt) {
  return `(() => {
    const collectButtons = () =>
      Array.from(document.querySelectorAll("button")).map((button) => ({
        text: (button.textContent || "").trim(),
        aria: button.getAttribute("aria-label"),
        disabled: Boolean(button.disabled),
      }));
    const resolveTextarea = () => {
      const candidates = Array.from(
        document.querySelectorAll(
          '[data-testid="inputbar-core-container"] textarea, textarea',
        ),
      );
      return (
        candidates.find(
          (candidate) =>
            candidate instanceof HTMLTextAreaElement && !candidate.disabled,
        ) || null
      );
    };
    const textarea = resolveTextarea();
    const initialSend = document.querySelector(
      'button[aria-label="发送"], button[title="发送"]',
    );
    if (!textarea || !initialSend) {
      return {
        ok: false,
        reason: "missing-input-or-send",
        buttons: collectButtons(),
      };
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) {
      return { ok: false, reason: "missing-native-textarea-setter" };
    }

    textarea.focus();
    setter.call(textarea, ${JSON.stringify(prompt)});
    textarea.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      data: ${JSON.stringify(prompt)},
      inputType: "insertText",
    }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    const currentTextarea = resolveTextarea() || textarea;
    const currentSend = document.querySelector(
      'button[aria-label="发送"], button[title="发送"]',
    );
    return {
      ok: true,
      value: currentTextarea?.value ?? "",
      sendDisabled: Boolean(currentSend?.disabled),
      buttons: collectButtons(),
    };
  })()`;
}

function buildSendReadyScript() {
  return `(() => {
    const textarea =
      Array.from(
        document.querySelectorAll(
          '[data-testid="inputbar-core-container"] textarea, textarea',
        ),
      ).find(
        (candidate) =>
          candidate instanceof HTMLTextAreaElement && !candidate.disabled,
      ) || null;
    const send = document.querySelector(
      'button[aria-label="发送"], button[title="发送"]',
    );
    return {
      ok:
        Boolean(textarea) &&
        typeof textarea?.value === "string" &&
        textarea.value.trim().length > 0 &&
        Boolean(send) &&
        send.disabled === false,
      value: textarea?.value ?? "",
      sendDisabled: Boolean(send?.disabled),
    };
  })()`;
}

function buildClickSendScript() {
  return `(() => {
    const send = document.querySelector(
      'button[aria-label="发送"], button[title="发送"]',
    );
    if (!send) {
      return {
        ok: false,
        reason: "missing-send-button",
      };
    }
    if (send.disabled) {
      return {
        ok: false,
        reason: "send-disabled",
      };
    }

    send.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    send.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));
    send.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    }));

    return {
      ok: true,
      submitted: true,
    };
  })()`;
}

function buildOpenWorkbenchScript() {
  return `(() => {
    const target = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        ((button.textContent || "").trim() === "Harness" ||
          (button.getAttribute("aria-label") || "").includes("Harness") ||
          (button.getAttribute("title") || "").includes("Harness")) &&
        button instanceof HTMLButtonElement,
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

    const dialogOpen = Boolean(
      document.querySelector('[role="dialog"] [data-harness-drag-handle="true"]'),
    );
    const alreadyOpen =
      dialogOpen ||
      target.getAttribute("aria-expanded") === "true" ||
      (target.getAttribute("aria-label") || "").includes("关闭Harness");

    if (alreadyOpen) {
      return {
        ok: true,
        alreadyOpen: true,
        dialogOpen,
        ariaExpanded: target.getAttribute("aria-expanded"),
        ariaLabel: target.getAttribute("aria-label"),
      };
    }

    target.click();
    return {
      ok: true,
      alreadyOpen: false,
      dialogOpen: Boolean(
        document.querySelector('[role="dialog"] [data-harness-drag-handle="true"]'),
      ),
      ariaExpanded: target.getAttribute("aria-expanded"),
      ariaLabel: target.getAttribute("aria-label"),
    };
  })()`;
}

function buildWorkbenchButtonCheckScript() {
  return `(() => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) =>
        ((candidate.textContent || "").trim() === "Harness" ||
          (candidate.getAttribute("aria-label") || "").includes("Harness") ||
          (candidate.getAttribute("title") || "").includes("Harness")) &&
        candidate instanceof HTMLButtonElement,
    );

    return {
      hasButton: Boolean(button),
      text: document.body ? document.body.innerText : "",
      ariaLabel: button?.getAttribute("aria-label") || null,
      title: button?.getAttribute("title") || null,
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
    actionResult?.data?.result ??
    actionResult?.data?.value ??
    actionResult?.data?.result?.result ??
    actionResult?.data?.result?.value ??
    actionResult?.data?.result ??
    null
  );
}

function isRetryableBrowserActionFailure(detail) {
  return (
    typeof detail === "string" &&
    (detail.includes("CDP 调试端口不可用") ||
      detail.includes("没有可用的 Chrome 会话") ||
      detail.includes("未找到 profile_key="))
  );
}

async function launchSmokeBrowserSession(options, profileKey) {
  const launchResponse = await invoke(options, "launch_browser_session", {
    request: {
      profile_key: profileKey,
      url: options.appUrl,
      headless: true,
      open_window: false,
      // 真实 Lime 页面在 cdp_direct + frames/both 下会持续产出 frame 流，
      // 这里会把后续 Runtime.evaluate 挤到超时；页面 smoke 只需要事件流即可。
      stream_mode: "events",
    },
  });
  const sessionId = launchResponse?.session?.session_id ?? null;
  assert(
    typeof sessionId === "string" && sessionId.trim(),
    "launch_browser_session 未返回 session.session_id",
  );
  await sleep(POST_LAUNCH_SETTLE_MS);
  return sessionId;
}

async function runBrowserAction(
  options,
  profileKey,
  action,
  args = {},
  label = action,
  recovery,
) {
  for (let attempt = 1; attempt <= BROWSER_ACTION_RETRY_COUNT; attempt += 1) {
    const result = await invoke(options, "browser_execute_action", {
      request: {
        profile_key: profileKey,
        backend: "cdp_direct",
        action,
        args,
        timeout_ms: DEFAULT_ACTION_TIMEOUT_MS,
      },
    });

    if (result?.success === true) {
      return result;
    }

    const detail = String(result?.error || JSON.stringify(result ?? null));
    if (
      isRetryableBrowserActionFailure(detail) &&
      attempt < BROWSER_ACTION_RETRY_COUNT
    ) {
      if (recovery && recovery.count < BROWSER_SESSION_RECOVERY_LIMIT) {
        recovery.count += 1;
        console.warn(
          `[smoke:agent-runtime-tool-surface-page] browser_execute_action(${label}) 丢失托管 Chrome 会话，尝试第 ${recovery.count} 次重启: ${detail}`,
        );
        recovery.sessionId = await launchSmokeBrowserSession(
          options,
          profileKey,
        );
        continue;
      }
      console.warn(
        `[smoke:agent-runtime-tool-surface-page] browser_execute_action(${label}) 第 ${attempt} 次失败，${BROWSER_ACTION_RETRY_DELAY_MS}ms 后重试: ${detail}`,
      );
      await sleep(BROWSER_ACTION_RETRY_DELAY_MS);
      continue;
    }

    throw new Error(
      `[smoke:agent-runtime-tool-surface-page] browser_execute_action(${label}) 失败: ${detail}`,
    );
  }

  throw new Error(
    `[smoke:agent-runtime-tool-surface-page] browser_execute_action(${label}) 失败: unknown error`,
  );
}

async function runJavascript(
  options,
  profileKey,
  expression,
  label = "javascript",
  recovery,
) {
  const result = await runBrowserAction(
    options,
    profileKey,
    "javascript",
    {
      expression,
      return_by_value: true,
    },
    `javascript:${label}`,
    recovery,
  );
  return extractJavascriptValue(result);
}

async function readPageMarkdown(options, profileKey, recovery) {
  const result = await runBrowserAction(
    options,
    profileKey,
    "read_page",
    {},
    "read_page",
    recovery,
  );
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

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  logStage("wait-health");
  await waitForHealth(options);
  await sleep(POST_HEALTH_SETTLE_MS);
  const profileKey = SMOKE_PROFILE_KEY;
  const browserRecovery = {
    count: 0,
    sessionId: null,
  };

  try {
    logStage("cleanup-old-profile");
    await closeSmokeProfileSession(
      options,
      profileKey,
      "预清理旧 smoke profile 失败",
    );

    logStage("launch-browser-session");
    browserRecovery.sessionId = await launchSmokeBrowserSession(
      options,
      profileKey,
    );

    logStage("wait-page-storage-ready");
    await waitForCheck(options, "Lime 首页 origin 可访问", async () => {
      const value = await runJavascript(
        options,
        profileKey,
        buildPageStorageReadyScript(options.appUrl),
        "wait-page-storage-ready",
        browserRecovery,
      );
      return {
        ok: value?.ok === true,
        value,
      };
    });

    logStage("bootstrap-harness-storage");
    await runJavascript(
      options,
      profileKey,
      buildHarnessBootstrapScript(),
      "bootstrap-harness-storage",
      browserRecovery,
    );
    logStage("refresh-page");
    await runBrowserAction(
      options,
      profileKey,
      "refresh_page",
      {},
      "refresh_page",
      browserRecovery,
    );

    logStage("wait-empty-state");
    await waitForCheck(options, "首页空态加载", async () => {
      const text = await runJavascript(
        options,
        profileKey,
        'document.body ? document.body.innerText : ""',
        "wait-empty-state-text",
        browserRecovery,
      );
      return {
        ok:
          typeof text === "string" &&
          (text.includes("青柠一下，灵感即来") ||
            text.includes("先说这轮要做什么")),
        value: text,
      };
    });

    logStage("fill-prompt");
    await waitForCheck(options, "首页输入框出现", async () => {
      const value = await runJavascript(
          options,
          profileKey,
          buildComposerReadyScript(),
          "wait-composer-ready",
          browserRecovery,
        );
      return {
        ok: value?.ok === true,
        value,
      };
    });

    const filled = await waitForCheck(
      options,
      "首页输入框可写入",
      async () => {
        const value = await runJavascript(
          options,
          profileKey,
          buildFillPromptScript(PROMPT_TEXT),
          "fill-prompt",
          browserRecovery,
        );
        return {
          ok: value?.ok === true,
          value,
        };
      },
    );
    assert(
      filled?.ok === true,
      `准备输入失败: ${JSON.stringify(filled ?? null)}`,
    );

    logStage("wait-send-ready");
    const sendReady = await waitForCheck(options, "发送按钮可用", async () => {
      const value = await runJavascript(
        options,
        profileKey,
        buildSendReadyScript(),
        "wait-send-ready",
        browserRecovery,
      );
      return {
        ok: value?.ok === true,
        value,
      };
    });
    assert(
      sendReady?.ok === true,
      `发送按钮未就绪: ${JSON.stringify(sendReady ?? null)}`,
    );

    logStage("click-send");
    const submitted = await runJavascript(
      options,
      profileKey,
      buildClickSendScript(),
      "click-send",
      browserRecovery,
    );
    assert(
      submitted?.ok === true,
      `提交输入失败: ${JSON.stringify(submitted ?? null)}`,
    );

    logStage("wait-harness-button");
    await waitForCheck(options, "Harness 按钮出现", async () => {
      const value = await runJavascript(
        options,
        profileKey,
        buildWorkbenchButtonCheckScript(),
        "wait-harness-button",
        browserRecovery,
      );
      return {
        ok: value?.hasButton === true,
        value,
      };
    });

    logStage("open-harness");
    const openWorkbench = await runJavascript(
      options,
      profileKey,
      buildOpenWorkbenchScript(),
      "open-harness",
      browserRecovery,
    );
    assert(
      openWorkbench?.ok === true,
      `打开 Harness 失败: ${JSON.stringify(openWorkbench ?? null)}`,
    );

    logStage("wait-runtime-summary");
    const summaryFlags = await waitForCheck(
      options,
      "Runtime 能力摘要出现",
      async () => {
        const value = await runJavascript(
          options,
          profileKey,
          buildRuntimeSummaryCheckScript(),
          "check-runtime-summary",
          browserRecovery,
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

    logStage("read-page-markdown");
    const pageMarkdown = await readPageMarkdown(
      options,
      profileKey,
      browserRecovery,
    );
    for (const warning of FORBIDDEN_PAGE_WARNINGS) {
      assert(
        !pageMarkdown.includes(warning),
        `真实页面仍出现不应存在的页级告警: ${warning}`,
      );
    }

    console.log(
      `[smoke:agent-runtime-tool-surface-page] 通过 session=${browserRecovery.sessionId} profile=${profileKey}`,
    );
    console.log(
      `[smoke:agent-runtime-tool-surface-page] summary=${JSON.stringify(summaryFlags)}`,
    );
  } finally {
    if (browserRecovery.sessionId) {
      logStage("close-cdp-session");
      try {
        await invoke(options, "close_cdp_session", {
          request: {
            session_id: browserRecovery.sessionId,
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

    logStage("close-profile-session");
    await closeSmokeProfileSession(
      options,
      profileKey,
      "关闭 smoke profile 失败",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
