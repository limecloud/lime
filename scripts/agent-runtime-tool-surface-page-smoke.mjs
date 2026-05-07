#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const DEFAULTS = {
  appUrl: "http://127.0.0.1:1420/",
  healthUrl: "http://127.0.0.1:3030/health",
  invokeUrl: "http://127.0.0.1:3030/invoke",
  timeoutMs: 180_000,
  intervalMs: 1_000,
};

const POST_HEALTH_SETTLE_MS = 1_500;
const ONBOARDING_VERSION = "1.1.0";
const PROMPT_TEXT = "请回复一句：smoke harness";
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

async function launchPlaywrightContext(userDataDir) {
  const launchOptions = {
    headless: true,
    viewport: { width: 1440, height: 960 },
  };

  try {
    return await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: "chrome",
    });
  } catch (chromeError) {
    console.warn(
      `[smoke:agent-runtime-tool-surface-page] Chrome channel 启动失败，尝试 Playwright 自带 Chromium: ${
        chromeError instanceof Error ? chromeError.message : String(chromeError)
      }`,
    );
    return chromium.launchPersistentContext(userDataDir, launchOptions);
  }
}

async function evaluateScript(page, expression) {
  return page.evaluate(expression);
}

async function readPageText(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || "";
    const fieldText = Array.from(document.querySelectorAll("textarea, input"))
      .map((element) =>
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLInputElement
          ? element.value
          : "",
      )
      .join("\n");
    return `${text}\n${fieldText}`;
  });
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  logStage("wait-health");
  await waitForHealth(options);
  await sleep(POST_HEALTH_SETTLE_MS);
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `lime-runtime-tool-surface-page-${process.pid}-`),
  );
  let context = null;

  try {
    logStage("launch-playwright-page");
    context = await launchPlaywrightContext(userDataDir);
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(options.appUrl, { waitUntil: "domcontentloaded" });

    logStage("wait-page-storage-ready");
    await waitForCheck(options, "Lime 首页 origin 可访问", async () => {
      const value = await evaluateScript(
        page,
        buildPageStorageReadyScript(options.appUrl),
      );
      return {
        ok: value?.ok === true,
        value,
      };
    });

    logStage("bootstrap-harness-storage");
    await evaluateScript(page, buildHarnessBootstrapScript());
    logStage("refresh-page");
    await page.reload({ waitUntil: "domcontentloaded" });

    logStage("wait-empty-state");
    await waitForCheck(options, "首页空态加载", async () => {
      const text = await evaluateScript(
        page,
        'document.body ? document.body.innerText : ""',
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
      const value = await evaluateScript(page, buildComposerReadyScript());
      return {
        ok: value?.ok === true,
        value,
      };
    });

    const filled = await waitForCheck(
      options,
      "首页输入框可写入",
      async () => {
        const value = await evaluateScript(
          page,
          buildFillPromptScript(PROMPT_TEXT),
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
      const value = await evaluateScript(page, buildSendReadyScript());
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
    const submitted = await evaluateScript(page, buildClickSendScript());
    assert(
      submitted?.ok === true,
      `提交输入失败: ${JSON.stringify(submitted ?? null)}`,
    );

    logStage("wait-harness-button");
    await waitForCheck(options, "Harness 按钮出现", async () => {
      const value = await evaluateScript(
        page,
        buildWorkbenchButtonCheckScript(),
      );
      return {
        ok: value?.hasButton === true,
        value,
      };
    });

    logStage("open-harness");
    const openWorkbench = await evaluateScript(page, buildOpenWorkbenchScript());
    assert(
      openWorkbench?.ok === true,
      `打开 Harness 失败: ${JSON.stringify(openWorkbench ?? null)}`,
    );

    logStage("wait-runtime-summary");
    const summaryFlags = await waitForCheck(
      options,
      "Runtime 能力摘要出现",
      async () => {
        const value = await evaluateScript(
          page,
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

    logStage("read-page-text");
    const pageText = await readPageText(page);
    for (const warning of FORBIDDEN_PAGE_WARNINGS) {
      assert(
        !pageText.includes(warning),
        `真实页面仍出现不应存在的页级告警: ${warning}`,
      );
    }

    console.log("[smoke:agent-runtime-tool-surface-page] 通过");
    console.log(
      `[smoke:agent-runtime-tool-surface-page] summary=${JSON.stringify(summaryFlags)}`,
    );
  } finally {
    await context?.close().catch(() => undefined);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
