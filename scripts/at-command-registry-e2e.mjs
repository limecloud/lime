#!/usr/bin/env node
import { withComposerEditorDom } from "./lib/composer-editor-dom.mjs";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";
import { liveProviderSmokeAllowed } from "./lib/live-provider-smoke-gate.mjs";

const DEFAULT_APP_URL = "http://127.0.0.1:1420/";
const DEFAULT_HEALTH_URL = "http://127.0.0.1:3030/health";
const DEFAULT_INVOKE_URL = "http://127.0.0.1:3030/invoke";
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_PREFIX = "at-command-registry-e2e";
const MENTION_USAGE_STORAGE_KEY = "lime:mention-entry-usage:v1";
const ONBOARDING_VERSION = "1.1.0";
const RECENT_REPLAY_TEXT = "E2E 最近搜索输入";
const IMAGE_COMMAND_PREFIX = "@配图";
const IMAGE_COMMAND_LABEL = "配图";
const IMAGE_PROMPT = "E2E 图片命令路由测试，请生成一张青柠插画";
const CHAT_PROVIDER_PREFERENCE = "deepseek";
const CHAT_MODEL_PREFERENCE = "deepseek-v4-flash";
const CONTEXT_CLOSE_TIMEOUT_MS = 5_000;
const APP_SERVER_HANDLE_JSON_LINES_COMMAND = "app_server_handle_json_lines";
const APP_SERVER_METHOD_TURN_START = "turn/start";
const APP_SERVER_METHOD_TURN_INTERRUPT = "turn/interrupt";
const APP_SERVER_METHOD_THREAD_READ = "thread/read";
const TERMINAL_THREAD_STATUSES = new Set([
  "completed",
  "failed",
  "aborted",
  "idle",
  "cancelled",
]);

function parseArgs(argv) {
  const options = {
    appUrl: DEFAULT_APP_URL,
    healthUrl: DEFAULT_HEALTH_URL,
    invokeUrl: DEFAULT_INVOKE_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    prefix: DEFAULT_PREFIX,
    evidenceDir: path.join(process.cwd(), ".lime", "e2e", DEFAULT_PREFIX),
    headless: true,
    allowLiveProvider: liveProviderSmokeAllowed(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      return argv[index];
    };

    switch (arg) {
      case "--app-url":
        options.appUrl = next();
        break;
      case "--health-url":
        options.healthUrl = next();
        break;
      case "--invoke-url":
        options.invokeUrl = next();
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(next());
        break;
      case "--interval-ms":
        options.intervalMs = Number(next());
        break;
      case "--prefix":
        options.prefix = next();
        break;
      case "--evidence-dir":
        options.evidenceDir = next();
        break;
      case "--headed":
        options.headless = false;
        break;
      case "--headless":
        options.headless = true;
        break;
      case "--allow-live-provider":
        options.allowLiveProvider = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms 必须是正数");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error("--interval-ms 必须是正数");
  }

  return options;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConsoleText(consoleMessages) {
  return consoleMessages.map((item) => String(item?.text || "")).join("\n");
}

function timeoutAfter(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

async function waitForCondition(label, probe, timeoutMs, intervalMs) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await probe();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  const suffix = lastError
    ? `，最后错误: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    : "";
  throw new Error(`${label} 超时${suffix}`);
}

async function waitForAnyVisibleText(
  page,
  label,
  texts,
  timeoutMs,
  intervalMs,
) {
  return waitForCondition(
    label,
    async () => {
      for (const text of texts) {
        const locator = page.getByText(text, { exact: false }).first();
        const visible = await locator
          .waitFor({ state: "visible", timeout: Math.max(500, intervalMs) })
          .then(() => true)
          .catch(() => false);
        if (visible) {
          return text;
        }
      }
      return null;
    },
    timeoutMs,
    intervalMs,
  );
}

async function isTextVisible(page, text, timeoutMs) {
  return page
    .getByText(text, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

async function waitForHealth(options) {
  return waitForCondition(
    "等待 DevBridge health",
    async () => {
      const response = await fetch(options.healthUrl).catch(() => null);
      if (!response?.ok) {
        return null;
      }
      const payload = await response.json().catch(() => null);
      return payload?.status === "ok" ? payload : null;
    },
    options.timeoutMs,
    options.intervalMs,
  );
}

async function launchContext(options) {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `${options.prefix}-${process.pid}-`),
  );
  const launchOptions = {
    headless: options.headless,
    viewport: { width: 1440, height: 960 },
  };

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: "chrome",
    });
    return { context, userDataDir };
  } catch (chromeError) {
    console.warn(
      `[${options.prefix}] Chrome channel 启动失败，尝试 Playwright Chromium: ${
        chromeError instanceof Error ? chromeError.message : String(chromeError)
      }`,
    );
    const context = await chromium.launchPersistentContext(
      userDataDir,
      launchOptions,
    );
    return { context, userDataDir };
  }
}

async function closeContextWithTimeout(context, options) {
  const closeResult = await Promise.race([
    context.close().then(
      () => ({ status: "closed" }),
      (error) => ({ status: "failed", error }),
    ),
    timeoutAfter(CONTEXT_CLOSE_TIMEOUT_MS).then(() => ({ status: "timeout" })),
  ]);

  if (closeResult.status === "failed") {
    console.warn(
      `[${options.prefix}] Playwright context 关闭失败: ${
        closeResult.error instanceof Error
          ? closeResult.error.message
          : String(closeResult.error)
      }`,
    );
  } else if (closeResult.status === "timeout") {
    console.warn(
      `[${options.prefix}] Playwright context 关闭超过 ${CONTEXT_CLOSE_TIMEOUT_MS}ms，继续退出以避免 smoke 清理阶段挂起`,
    );
  }
}

function removeUserDataDir(userDataDir, options) {
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[${options.prefix}] 删除临时浏览器 profile 失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function logStage(options, stage) {
  console.log(`[${options.prefix}] stage=${stage}`);
}

function commandItemByText(page, text) {
  return page.locator("[cmdk-item]").filter({ hasText: text });
}

async function waitForComposerEditorText(page, expectedValue, timeoutMs) {
  await page.waitForFunction(
    withComposerEditorDom(({ selector, value }) => {
      const inputs = Array.from(document.querySelectorAll(selector));
      const input = inputs.at(-1);
      return (
        input instanceof HTMLElement &&
        readComposerEditorTextDom(input) === value
      );
    }),
    {
      selector: '[data-testid="composer-editor"][role="textbox"]',
      value: expectedValue,
    },
    { timeout: timeoutMs },
  );
}

async function isComposerReady(page) {
  return page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll(
        '[data-testid="composer-editor"][role="textbox"]',
      ),
    );
    const input = inputs.at(-1);
    return Boolean(
      input &&
      input.offsetParent !== null &&
      input.getAttribute("aria-disabled") !== "true" &&
      input.getAttribute("contenteditable") === "true",
    );
  });
}

function readNestedObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

function readImageCommandIntent(metadata) {
  const harness = readNestedObject(metadata, ["harness"]) || metadata;
  const launch = readNestedObject(harness, [
    "image_command_intent",
    "imageCommandIntent",
  ]);
  const requestContext = readNestedObject(launch, [
    "request_context",
    "requestContext",
  ]);
  const imageTask =
    readNestedObject(launch, ["image_task", "imageTask"]) ||
    readNestedObject(requestContext, ["image_task", "imageTask"]);

  return { launch, imageTask };
}

function isLegacyImageRuntimeSubmit(invoke) {
  return invoke?.cmd === "agent_runtime_submit_turn";
}

function parseAppServerJsonRpcMessages(args) {
  const lines = args?.request?.lines;
  const rawLines = Array.isArray(lines)
    ? lines
    : typeof lines === "string"
      ? lines.split("\n")
      : [];
  return rawLines
    .flatMap((line) => String(line || "").split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getAppServerRequests(invoke) {
  if (invoke?.cmd !== APP_SERVER_HANDLE_JSON_LINES_COMMAND) {
    return [];
  }
  return parseAppServerJsonRpcMessages(invoke.args).filter(
    (message) => typeof message?.method === "string",
  );
}

function getAppServerMethodRequest(invoke, method) {
  return getAppServerRequests(invoke).find(
    (message) => message.method === method,
  );
}

function isCurrentImageRuntimeSubmit(invoke) {
  return Boolean(
    getAppServerMethodRequest(invoke, APP_SERVER_METHOD_TURN_START),
  );
}

function parseInvokeRequest(request, invokeUrl) {
  const requestUrl = request.url();
  const normalizedInvokeUrl = invokeUrl.replace(/\/$/, "");
  if (
    request.method() !== "POST" ||
    (requestUrl !== invokeUrl &&
      !requestUrl.startsWith(`${normalizedInvokeUrl}/`) &&
      !requestUrl.endsWith("/invoke"))
  ) {
    return null;
  }

  const postData = request.postData();
  if (!postData) {
    return null;
  }

  try {
    return JSON.parse(postData);
  } catch {
    return null;
  }
}

async function invokeBridgeCommand(options, cmd, args, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(options.invokeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd, args }),
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

let appServerRequestId = 1;

async function invokeAppServerMethod(
  options,
  method,
  params,
  timeoutMs = 30_000,
) {
  const id = `at-command-registry-e2e-${appServerRequestId++}`;
  const request =
    params === undefined ? { id, method } : { id, method, params };
  const result = await invokeBridgeCommand(
    options,
    APP_SERVER_HANDLE_JSON_LINES_COMMAND,
    { request: { lines: [`${JSON.stringify(request)}\n`] } },
    timeoutMs,
  );
  const responseLines = result?.result?.lines ?? result?.lines;
  const messages = parseAppServerJsonRpcMessages({
    request: { lines: responseLines },
  });
  const error = messages.find((message) => message.id === id && message.error);
  if (error) {
    throw new Error(
      `${method} error: ${error.error?.message || "App Server JSON-RPC error"}`,
    );
  }
  const response = messages.find(
    (message) => message.id === id && Object.hasOwn(message, "result"),
  );
  if (!response) {
    throw new Error(`${method} missing App Server response`);
  }
  return response.result;
}

async function cleanupSubmittedCurrentTurn(options, turnParams) {
  const sessionId = String(turnParams?.sessionId || "").trim();
  const turnId = String(turnParams?.turnId || "").trim();
  if (!sessionId) {
    return { attempted: false, reason: "missing-session-id" };
  }
  if (!turnId) {
    return { attempted: false, reason: "missing-turn-id", sessionId };
  }

  try {
    await invokeAppServerMethod(
      options,
      APP_SERVER_METHOD_TURN_INTERRUPT,
      { sessionId, turnId },
      20_000,
    );
  } catch (error) {
    return {
      attempted: true,
      status: "failed",
      sessionId,
      turnId: turnId || null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const drained = await waitForCondition(
    "等待 @配图 smoke 提交任务清理",
    async () => {
      const sessionRead = await invokeAppServerMethod(
        options,
        APP_SERVER_METHOD_THREAD_READ,
        { sessionId },
        20_000,
      ).catch(() => null);
      if (!sessionRead) {
        return null;
      }
      const threadRead =
        sessionRead.detail?.thread_read || sessionRead.detail?.threadRead;
      const status = String(
        threadRead?.status || sessionRead.session?.status || "",
      ).toLowerCase();
      const queuedTurns = Array.isArray(threadRead?.queued_turns)
        ? threadRead.queued_turns.length
        : 0;
      const activeTurnId =
        threadRead?.active_turn_id || threadRead?.activeTurnId || null;
      return !activeTurnId &&
        queuedTurns === 0 &&
        TERMINAL_THREAD_STATUSES.has(status)
        ? { status: status || null, queuedTurns }
        : null;
    },
    30_000,
    options.intervalMs,
  ).catch((error) => ({
    status: "unknown",
    error: error instanceof Error ? error.message : String(error),
  }));

  return {
    attempted: true,
    status: "sent",
    sessionId,
    turnId: turnId || null,
    drained,
  };
}

async function main() {
  if (typeof fetch !== "function") {
    throw new Error("当前 Node 运行时不支持 fetch，请使用 Node 18+");
  }

  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.evidenceDir, { recursive: true });

  logStage(options, "wait-health");
  const health = await waitForHealth(options);

  logStage(options, "launch-browser");
  const { context, userDataDir } = await launchContext(options);
  const summary = {
    scenarioId: options.prefix,
    appUrl: options.appUrl,
    bridge: health,
    chatPreferenceFixture: {
      provider: CHAT_PROVIDER_PREFERENCE,
      model: CHAT_MODEL_PREFERENCE,
    },
    assertions: {},
    consoleErrors: [],
    consoleWarnings: [],
    failedRequests: [],
    invokeCommands: [],
  };

  try {
    await context.addInitScript(
      ({
        usageKey,
        replayText,
        onboardingVersion,
        chatProviderPreference,
        chatModelPreference,
      }) => {
        window.localStorage.setItem("lime_onboarding_complete", "true");
        window.localStorage.setItem(
          "lime_onboarding_version",
          onboardingVersion,
        );
        window.localStorage.setItem(
          "agent_pref_provider",
          JSON.stringify(chatProviderPreference),
        );
        window.localStorage.setItem(
          "agent_pref_model",
          JSON.stringify(chatModelPreference),
        );
        window.localStorage.setItem(
          "agent_pref_provider_global",
          JSON.stringify(chatProviderPreference),
        );
        window.localStorage.setItem(
          "agent_pref_model_global",
          JSON.stringify(chatModelPreference),
        );
        window.localStorage.setItem(
          usageKey,
          JSON.stringify([
            {
              kind: "builtin_command",
              entryId: "research",
              usedAt: Date.now(),
              replayText,
            },
          ]),
        );
      },
      {
        usageKey: MENTION_USAGE_STORAGE_KEY,
        replayText: RECENT_REPLAY_TEXT,
        onboardingVersion: ONBOARDING_VERSION,
        chatProviderPreference: CHAT_PROVIDER_PREFERENCE,
        chatModelPreference: CHAT_MODEL_PREFERENCE,
      },
    );

    const page = await context.newPage();
    const invokes = [];
    const consoleMessages = [];

    page.on("console", (message) => {
      const entry = {
        type: message.type(),
        text: message.text(),
      };
      consoleMessages.push(entry);
      if (message.type() === "error") {
        summary.consoleErrors.push(entry);
      } else if (message.type() === "warning") {
        summary.consoleWarnings.push(entry);
      }
    });
    page.on("request", (request) => {
      const parsed = parseInvokeRequest(request, options.invokeUrl);
      if (!parsed) {
        return;
      }
      invokes.push({
        cmd: parsed.cmd,
        args: parsed.args,
      });
      summary.invokeCommands.push(parsed.cmd);
    });
    page.on("requestfailed", (request) => {
      summary.failedRequests.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText || "unknown",
      });
    });

    logStage(options, "open-app");
    await page.goto(options.appUrl, { waitUntil: "domcontentloaded" });
    await page
      .waitForLoadState("networkidle", { timeout: 30_000 })
      .catch(() => undefined);
    await page
      .getByRole("button", { name: "新建任务" })
      .click({ timeout: 20_000 })
      .catch(() => undefined);

    logStage(options, "wait-composer");
    const editor = page
      .locator('[data-testid="composer-editor"][role="textbox"]')
      .last();
    await editor.waitFor({ state: "visible", timeout: options.timeoutMs });
    await page.waitForFunction(
      async () => {
        const inputs = Array.from(
          document.querySelectorAll(
            '[data-testid="composer-editor"][role="textbox"]',
          ),
        );
        const input = inputs.at(-1);
        return Boolean(
          input &&
          input.getAttribute("aria-disabled") !== "true" &&
          input.getAttribute("contenteditable") === "true",
        );
      },
      null,
      { timeout: options.timeoutMs },
    );

    logStage(options, "wait-workspace-ready");
    const workspaceReadySignal = await waitForCondition(
      "等待默认工作区完成加载",
      async () => {
        const consoleText = readConsoleText(consoleMessages);
        if (
          consoleText.includes("LocalConversationPage.loadData.projectOnlyComplete")
        ) {
          return "LocalConversationPage.loadData.projectOnlyComplete";
        }
        if (consoleText.includes("LocalConversationPage.loadData.projectLoaded")) {
          return "LocalConversationPage.loadData.projectLoaded";
        }
        if (consoleText.includes("LocalConversationPage.workspaceCheck.success")) {
          return "LocalConversationPage.workspaceCheck.success";
        }
        if (invokes.some((item) => item.cmd === "workspace_ensure_ready")) {
          return "invoke:workspace_ensure_ready";
        }
        if (await isComposerReady(page)) {
          return "composer-ready";
        }
        return null;
      },
      options.timeoutMs,
      options.intervalMs,
    );
    summary.workspaceReadySignal = workspaceReadySignal;

    logStage(options, "open-at-panel");
    await editor.click();
    await editor.fill("@");
    await page
      .getByText("统一调用注册表", { exact: false })
      .waitFor({ state: "visible", timeout: options.timeoutMs });
    const imageCommandItem = commandItemByText(page, "@配图").first();
    await imageCommandItem.waitFor({
      state: "attached",
      timeout: options.timeoutMs,
    });

    const atPanelText = await page.locator("body").innerText();
    const commandIndex = atPanelText.indexOf("搜索 / 读取");
    const recentIndex = atPanelText.indexOf("最近调用");
    const imageCommandVisible = atPanelText.includes("@配图");
    const searchCommandItems = await commandItemByText(page, "@搜索").count();

    assert(commandIndex >= 0, "@ 面板缺少“搜索 / 读取”命令分组");
    assert(recentIndex >= 0, "@ 面板缺少“最近调用”分组");
    assert(
      commandIndex < recentIndex,
      "@ 面板应先展示命令注册表，再展示最近调用",
    );
    assert(imageCommandVisible, "@ 面板缺少 @配图 命令");
    assert(
      searchCommandItems >= 2,
      "最近调用存在时，@搜索 应同时保留命令入口和续跑入口",
    );
    summary.assertions.registryBeforeRecent = true;
    summary.assertions.imageCommandVisible = true;
    summary.assertions.recentDoesNotHideCommand = true;

    await page.screenshot({
      path: path.join(options.evidenceDir, `${options.prefix}-01-at-panel.png`),
      fullPage: true,
    });

    logStage(options, "select-image-command");
    await editor.fill(IMAGE_COMMAND_PREFIX);
    const filteredImageCommandItem = commandItemByText(
      page,
      IMAGE_COMMAND_PREFIX,
    ).first();
    await filteredImageCommandItem.waitFor({
      state: "visible",
      timeout: options.timeoutMs,
    });
    await filteredImageCommandItem.scrollIntoViewIfNeeded();
    await filteredImageCommandItem.click();
    await page
      .getByTestId("inputbar-builtin-command-badge")
      .filter({ hasText: IMAGE_COMMAND_LABEL })
      .first()
      .waitFor({ state: "visible", timeout: options.timeoutMs });
    await editor.fill(IMAGE_PROMPT);
    await waitForComposerEditorText(page, IMAGE_PROMPT, options.timeoutMs);
    summary.assertions.imageCommandSelected = true;
    summary.assertions.imagePromptFilled = true;

    if (!options.allowLiveProvider) {
      summary.assertions.imageCommandSelectionVerified = true;
      summary.submitRequest = {
        routeMode: "not_submitted",
        reason: "live-provider-smoke-disabled",
      };
      summary.cleanup = {
        attempted: false,
        reason: "not-submitted",
      };
      await page.screenshot({
        path: path.join(
          options.evidenceDir,
          `${options.prefix}-02-selected-no-submit.png`,
        ),
        fullPage: true,
      });

      const summaryPath = path.join(
        options.evidenceDir,
        `${options.prefix}-summary.json`,
      );
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
      console.log(`[${options.prefix}] summary=${summaryPath}`);
      console.log(
        `[${options.prefix}] 通过；默认未提交 @配图 请求，避免触发真实模型或图片生成 Provider。需要提交验证时请显式传入 --allow-live-provider。`,
      );
      return;
    }

    logStage(options, "submit-image-command");
    const submitStart = invokes.length;
    await page.getByRole("button", { name: "发送" }).last().click({
      timeout: options.timeoutMs,
    });

    const submitInvoke = await waitForCondition(
      "等待 @配图 提交 current Agent Runtime turn",
      () =>
        invokes
          .slice(submitStart)
          .find((item) => isCurrentImageRuntimeSubmit(item)) || null,
      options.timeoutMs,
      options.intervalMs,
    );
    const retiredImageSkillInvoke =
      invokes
        .slice(submitStart)
        .find((item) => item?.cmd === "execute_skill") || null;
    const legacyRuntimeSubmitInvoke =
      invokes
        .slice(submitStart)
        .find((item) => isLegacyImageRuntimeSubmit(item)) || null;
    assert(
      !retiredImageSkillInvoke,
      "@配图 不应再通过 execute_skill 提交，必须走 turn/start current 主链",
    );
    assert(
      !legacyRuntimeSubmitInvoke,
      "@配图 不应再通过 agent_runtime_submit_turn 提交，必须走 turn/start current 主链",
    );

    const request = getAppServerMethodRequest(
      submitInvoke,
      APP_SERVER_METHOD_TURN_START,
    );
    assert(request, "@配图 current 提交缺少 turn/start");
    const params = request.params || {};
    const runtimeOptions = params.runtimeOptions || {};
    const runtimeRequest = runtimeOptions.runtimeRequest || {};
    const metadata = runtimeRequest.metadata || {};
    const harness = readNestedObject(metadata, ["harness"]) || metadata;
    const { launch, imageTask } = readImageCommandIntent(metadata);
    const runtimeContract = readNestedObject(imageTask, [
      "runtime_contract",
      "runtimeContract",
    ]);
    const contractKey =
      imageTask?.modality_contract_key ||
      imageTask?.modalityContractKey ||
      runtimeContract?.contract_key ||
      runtimeContract?.contractKey;

    assert(launch, "@配图 提交缺少 harness.image_command_intent");
    assert(
      !readNestedObject(harness, ["image_skill_launch", "imageSkillLaunch"]),
      "@配图 不应继续提交旧 harness.image_skill_launch",
    );
    assert(imageTask, "@配图 提交缺少 image_task");
    assert(
      String(imageTask.prompt || "").includes(IMAGE_PROMPT),
      "@配图 image_task.prompt 未保留用户输入",
    );
    assert(
      contractKey === "image_generation",
      `@配图 image_task 合同应为 image_generation，实际为 ${String(contractKey)}`,
    );
    assert(
      runtimeRequest.providerPreference == null,
      "@配图 不应把当前聊天 provider 提交为 request provider_preference",
    );
    assert(
      runtimeRequest.modelPreference == null,
      "@配图 不应把当前聊天 model 提交为 request model_preference",
    );

    summary.assertions.imageCommandIntentSubmitted = true;
    summary.assertions.legacyImageSkillLaunchNotSubmitted = true;
    summary.assertions.imageGenerationContractPreserved = true;
    summary.assertions.chatModelPreferenceSuppressed = true;
    summary.submitRequest = {
      routeMode: "turn/start",
      message: params.input?.text || null,
      sessionId: params.sessionId || null,
      turnId: params.turnId || null,
      providerPreference: runtimeRequest.providerPreference ?? null,
      modelPreference: runtimeRequest.modelPreference ?? null,
      contractKey,
      imagePrompt: imageTask.prompt,
    };

    await page.screenshot({
      path: path.join(
        options.evidenceDir,
        `${options.prefix}-02-submitted.png`,
      ),
      fullPage: true,
    });

    if (summary.submitRequest?.routeMode === "turn/start") {
      summary.cleanup = await cleanupSubmittedCurrentTurn(
        options,
        summary.submitRequest,
      );
    } else {
      summary.cleanup = {
        attempted: false,
        reason: "skill-execution-route",
      };
    }

    const summaryPath = path.join(
      options.evidenceDir,
      `${options.prefix}-summary.json`,
    );
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[${options.prefix}] summary=${summaryPath}`);
    console.log(`[${options.prefix}] 通过`);
  } finally {
    await closeContextWithTimeout(context, options);
    removeUserDataDir(userDataDir, options);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
