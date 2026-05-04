#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const DEFAULT_ACTION_TIMEOUT_MS = 45_000;
const POST_HEALTH_SETTLE_MS = 1_000;
const POST_LAUNCH_SETTLE_MS = 1_500;
const ONBOARDING_VERSION = "1.1.0";
const SMOKE_PROFILE_KEY = "smoke-knowledge-gui";

const DEFAULT_PACK = {
  name: "smoke-default",
  title: "Smoke 默认项目资料",
  type: "custom",
  sourceFileName: "default-source.md",
  sourceText: [
    "# Smoke 默认项目资料",
    "",
    "- 事实：该资料用于 GUI smoke 验证默认资料、目录和聊天使用入口。",
    "- 边界：只能用于本地 smoke，不得作为用户真实知识资产。",
    "- 待确认：无。",
  ].join("\n"),
};

const SECONDARY_PACK = {
  name: "smoke-secondary",
  title: "Smoke 备用项目资料",
  type: "custom",
  sourceFileName: "secondary-source.md",
  sourceText: [
    "# Smoke 备用项目资料",
    "",
    "- 事实：该资料用于验证同一项目下存在多份资料时目录仍可读。",
    "- 边界：只能用于本地 smoke，不参与默认生成。",
    "- 待确认：无。",
  ].join("\n"),
};

function printHelp() {
  console.log(`
Lime Knowledge GUI Smoke

用途:
  通过真实 Lime 页面验证项目资料管理页、全部资料列表、
  用于生成视图与手动导入入口。

用法:
  npm run smoke:knowledge-gui

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
  if (!options.appUrl || !options.healthUrl || !options.invokeUrl) {
    throw new Error("--app-url、--health-url、--invoke-url 均不能为空");
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
  console.log(`[smoke:knowledge-gui] stage=${label}`);
}

function isTransientInvokeError(error) {
  return (
    error?.name === "TimeoutError" ||
    (error instanceof TypeError && error.message === "fetch failed")
  );
}

async function invoke(options, cmd, args) {
  const invokeTimeoutMs = Math.min(options.timeoutMs, INVOKE_TIMEOUT_CEILING_MS);

  for (let attempt = 1; attempt <= INVOKE_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(options.invokeUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ cmd, args }),
        signal: AbortSignal.timeout(invokeTimeoutMs),
      });

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
            `[smoke:knowledge-gui] ${cmd} 超时，${invokeTimeoutMs}ms 内未收到 DevBridge 响应`,
          );
        }
        throw new Error(`[smoke:knowledge-gui] ${cmd} 请求失败: ${detail}`);
      }
      console.warn(
        `[smoke:knowledge-gui] ${cmd} 第 ${attempt} 次请求失败，${INVOKE_RETRY_DELAY_MS}ms 后重试: ${detail}`,
      );
      await sleep(INVOKE_RETRY_DELAY_MS);
    }
  }

  throw new Error(`[smoke:knowledge-gui] ${cmd} 请求失败: unknown error`);
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
        `[smoke:knowledge-gui] DevBridge 已就绪 (${Date.now() - startedAt}ms)${
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
    `[smoke:knowledge-gui] DevBridge 未就绪，请先启动 npm run tauri:dev:headless。最后错误: ${detail}`,
  );
}

async function closeSmokeProfileSession(options, profileKey, label) {
  try {
    await invoke(options, "close_chrome_profile_session", {
      profile_key: profileKey,
    });
  } catch (error) {
    console.warn(
      `[smoke:knowledge-gui] ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isRetryableBrowserActionFailure(detail) {
  return (
    typeof detail === "string" &&
    (detail.includes("CDP 调试端口不可用") ||
      detail.includes("没有可用的 Chrome 会话"))
  );
}

async function runBrowserAction(options, profileKey, action, args = {}, label = action) {
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
      console.warn(
        `[smoke:knowledge-gui] browser_execute_action(${label}) 第 ${attempt} 次失败，${BROWSER_ACTION_RETRY_DELAY_MS}ms 后重试: ${detail}`,
      );
      await sleep(BROWSER_ACTION_RETRY_DELAY_MS);
      continue;
    }

    throw new Error(
      `[smoke:knowledge-gui] browser_execute_action(${label}) 失败: ${detail}`,
    );
  }

  throw new Error(
    `[smoke:knowledge-gui] browser_execute_action(${label}) 失败: unknown error`,
  );
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

async function runJavascript(options, profileKey, expression, label = "javascript") {
  const result = await runBrowserAction(
    options,
    profileKey,
    "javascript",
    {
      expression,
      return_by_value: true,
    },
    `javascript:${label}`,
  );
  return extractJavascriptValue(result);
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
    `[smoke:knowledge-gui] 等待 ${label} 超时，最后结果: ${JSON.stringify(
      lastValue?.value ?? null,
    )}`,
  );
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

function buildBootstrapStorageScript(workingDir) {
  return `(() => {
    localStorage.setItem("lime_onboarding_complete", "true");
    localStorage.setItem("lime_onboarding_version", ${JSON.stringify(ONBOARDING_VERSION)});
    localStorage.setItem("lime_user_profile", "developer");
    localStorage.setItem("lime.knowledge.working-dir", ${JSON.stringify(workingDir)});
    return true;
  })()`;
}

function buildTextCheckScript(needles) {
  return `(() => {
    const text = document.body ? document.body.innerText : "";
    const needles = ${JSON.stringify(needles)};
    return {
      ok: needles.every((needle) => text.includes(needle)),
      missing: needles.filter((needle) => !text.includes(needle)),
      text,
    };
  })()`;
}

function buildClickButtonScript({ text, ariaLabel, index = 0 }) {
  return `(() => {
    const candidates = Array.from(document.querySelectorAll("button, [role='button'], a"));
    const matches = candidates.filter((element) => {
      const label = (element.getAttribute("aria-label") || "").trim();
      const title = (element.getAttribute("title") || "").trim();
      const content = (element.textContent || "").trim().replace(/\\s+/g, " ");
      const textMatched = ${JSON.stringify(text ?? "")}
        ? content === ${JSON.stringify(text ?? "")} || content.includes(${JSON.stringify(text ?? "")})
        : false;
      const ariaMatched = ${JSON.stringify(ariaLabel ?? "")}
        ? label === ${JSON.stringify(ariaLabel ?? "")} || title === ${JSON.stringify(ariaLabel ?? "")}
        : false;
      return textMatched || ariaMatched;
    });
    const target = matches[${Number(index)}] || null;
    if (!target) {
      return {
        ok: false,
        reason: "missing-button",
        buttons: candidates.slice(0, 80).map((button) => ({
          text: (button.textContent || "").trim().replace(/\\s+/g, " "),
          aria: button.getAttribute("aria-label"),
          title: button.getAttribute("title"),
        })),
      };
    }
    if (target instanceof HTMLButtonElement && target.disabled) {
      return {
        ok: false,
        reason: "button-disabled",
        text: target.textContent,
        aria: target.getAttribute("aria-label"),
      };
    }
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return {
      ok: true,
      text: (target.textContent || "").trim(),
      aria: target.getAttribute("aria-label"),
    };
  })()`;
}

async function seedPack(options, pack) {
  await invoke(options, "knowledge_import_source", {
    request: {
      workingDir: options.workingDir,
      packName: pack.name,
      description: pack.title,
      packType: pack.type,
      sourceFileName: pack.sourceFileName,
      sourceText: pack.sourceText,
    },
  });
  await invoke(options, "knowledge_compile_pack", {
    request: {
      workingDir: options.workingDir,
      name: pack.name,
    },
  });
  await invoke(options, "knowledge_update_pack_status", {
    request: {
      workingDir: options.workingDir,
      name: pack.name,
      status: "ready",
    },
  });
}

async function seedKnowledgePacks(options) {
  fs.mkdirSync(options.workingDir, { recursive: true });
  await seedPack(options, DEFAULT_PACK);
  await seedPack(options, SECONDARY_PACK);
  await invoke(options, "knowledge_set_default_pack", {
    request: {
      workingDir: options.workingDir,
      name: DEFAULT_PACK.name,
    },
  });
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  options.workingDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `lime-knowledge-gui-smoke-${process.pid}-`),
  );

  logStage("wait-health");
  await waitForHealth(options);
  await sleep(POST_HEALTH_SETTLE_MS);

  logStage("seed-knowledge-packs");
  await seedKnowledgePacks(options);

  const profileKey = SMOKE_PROFILE_KEY;
  let sessionId = null;

  try {
    logStage("cleanup-old-profile");
    await closeSmokeProfileSession(
      options,
      profileKey,
      "预清理旧 smoke profile 失败",
    );

    logStage("launch-browser-session");
    const launchResponse = await invoke(options, "launch_browser_session", {
      request: {
        profile_key: profileKey,
        url: options.appUrl,
        headless: true,
        open_window: false,
        stream_mode: "events",
      },
    });

    sessionId = launchResponse?.session?.session_id ?? null;
    assert(
      typeof sessionId === "string" && sessionId.trim(),
      "launch_browser_session 未返回 session.session_id",
    );
    await sleep(POST_LAUNCH_SETTLE_MS);

    logStage("wait-page-storage-ready");
    await waitForCheck(options, "Lime 首页 origin 可访问", async () => {
      const value = await runJavascript(
        options,
        profileKey,
        buildPageStorageReadyScript(options.appUrl),
        "wait-page-storage-ready",
      );
      return {
        ok: value?.ok === true,
        value,
      };
    });

    logStage("bootstrap-storage");
    await runJavascript(
      options,
      profileKey,
      buildBootstrapStorageScript(options.workingDir),
      "bootstrap-storage",
    );

    logStage("refresh-page");
    await runBrowserAction(options, profileKey, "refresh_page");

    logStage("wait-home");
    await waitForCheck(options, "首页加载", async () => {
      const value = await runJavascript(
        options,
        profileKey,
        buildTextCheckScript(["青柠一下，灵感即来"]),
        "wait-home",
      );
      return {
        ok: value?.ok === true,
        value,
      };
    });

    logStage("open-knowledge-page");
    const navigation = await runJavascript(
      options,
      profileKey,
      buildClickButtonScript({ ariaLabel: "知识库" }),
      "open-knowledge-page",
    );
    assert(
      navigation?.ok === true,
      `打开知识库入口失败: ${JSON.stringify(navigation ?? null)}`,
    );

    logStage("wait-knowledge-overview");
    await waitForCheck(options, "知识库总览加载", async () => {
      const value = await runJavascript(
        options,
        profileKey,
        buildTextCheckScript([
          "项目资料管理",
          "日常使用入口",
          "回到 Agent",
          "全部资料",
          "全部项目资料",
          "等你确认的资料",
          DEFAULT_PACK.title,
          SECONDARY_PACK.title,
        ]),
        "wait-knowledge-overview",
      );
      return {
        ok: value?.ok === true,
        value,
      };
    });

    logStage("open-agent-with-knowledge");
    const usePack = await runJavascript(
      options,
      profileKey,
      buildClickButtonScript({ text: "用于生成" }),
      "open-agent-with-knowledge",
    );
    assert(
      usePack?.ok === true,
      `使用资料回到 Agent 失败: ${JSON.stringify(usePack ?? null)}`,
    );

    logStage("wait-agent");
    await waitForCheck(options, "Agent 页面加载", async () => {
      const value = await runJavascript(
        options,
        profileKey,
        buildTextCheckScript([
          "青柠一下，灵感即来",
          "请基于当前项目资料生成内容",
        ]),
        "wait-agent",
      );
      return {
        ok: value?.ok === true,
        value,
      };
    });

    logStage("return-knowledge-page");
    const backToKnowledge = await runJavascript(
      options,
      profileKey,
      buildClickButtonScript({ ariaLabel: "知识库" }),
      "return-knowledge-page",
    );
    assert(
      backToKnowledge?.ok === true,
      `返回资料管理页失败: ${JSON.stringify(backToKnowledge ?? null)}`,
    );

    logStage("open-import-view");
    const importView = await runJavascript(
      options,
      profileKey,
      buildClickButtonScript({ text: "导入资料" }),
      "open-import-view",
    );
    assert(
      importView?.ok === true,
      `打开资料导入视图失败: ${JSON.stringify(importView ?? null)}`,
    );

    logStage("wait-organize-entry");
    await waitForCheck(options, "资料整理入口加载", async () => {
      const value = await runJavascript(
        options,
        profileKey,
        buildTextCheckScript([
          "自动整理",
          "整理资料",
          "预览摘要",
          "人工确认",
        ]),
        "wait-organize-entry",
      );
      return {
        ok: value?.ok === true,
        value,
      };
    });

    console.log(
      `[smoke:knowledge-gui] 通过 session=${sessionId} profile=${profileKey} workingDir=${options.workingDir}`,
    );
  } finally {
    if (sessionId) {
      logStage("close-cdp-session");
      try {
        await invoke(options, "close_cdp_session", {
          request: {
            session_id: sessionId,
          },
        });
      } catch (error) {
        console.warn(
          `[smoke:knowledge-gui] 清理浏览器会话失败: ${
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
