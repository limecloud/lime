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

const INVOKE_TIMEOUT_CEILING_MS = 180_000;
const INVOKE_RETRY_COUNT = 10;
const INVOKE_RETRY_DELAY_MS = 1_000;
const DEFAULT_ACTION_TIMEOUT_MS = 45_000;
const POST_HEALTH_SETTLE_MS = 1_000;
const ONBOARDING_VERSION = "1.1.0";

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

const AGENT_RESULT_MESSAGE = {
  id: "smoke-agent-result-knowledge",
  title: "对话结果资料",
  content: [
    "# 对话结果资料",
    "",
    "- 事实：该结果来自当前 Agent 对话，用于验证生成结果可以沉淀成项目资料。",
    "- 适用场景：用户拿到一段可复用结论后，可以一键保存，随后在项目资料管理页检查确认。",
    "- 风险提示：沉淀后仍需人工确认，避免把临时分析当成长期事实。",
  ].join("\n"),
};

function printHelp() {
  console.log(`
Lime Knowledge GUI Smoke

用途:
  通过真实 Lime 页面验证项目资料管理页、全部资料列表、
  用于生成视图与补充导入入口。

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

async function waitForPageText(page, label, needles, timeoutMs) {
  try {
    await page.waitForFunction(
      (expectedNeedles) => {
        const text = document.body?.innerText || "";
        const fieldText = Array.from(
          document.querySelectorAll("textarea, input"),
        )
          .map((element) =>
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLInputElement
              ? element.value
              : "",
          )
          .join("\n");
        const searchableText = `${text}\n${fieldText}`;
        return expectedNeedles.every((needle) => searchableText.includes(needle));
      },
      needles,
      { timeout: timeoutMs },
    );
  } catch (error) {
    const text = await page.locator("body").innerText().catch(() => "");
    const fieldText = await page
      .locator("textarea, input")
      .evaluateAll((elements) =>
        elements
          .map((element) =>
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLInputElement
              ? element.value
              : "",
          )
          .filter(Boolean)
          .join("\n"),
      )
      .catch(() => "");
    const searchableText = `${text}\n${fieldText}`;
    const missing = needles.filter((needle) => !searchableText.includes(needle));
    throw new Error(
      `[smoke:knowledge-gui] ${label} 等待失败，缺少 ${JSON.stringify(
        missing,
      )}，页面文本预览: ${searchableText.slice(0, 2_000)}`,
      { cause: error },
    );
  }
}

async function clickPageControl(page, { text, ariaLabel, index = 0 }) {
  const locator = ariaLabel
    ? page.getByRole("button", { name: ariaLabel }).nth(index)
    : page
        .locator("button, [role='button'], a")
        .filter({ hasText: text })
        .nth(index);

  try {
    await locator.click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
  } catch (error) {
    const buttons = await page
      .locator("button, [role='button'], a")
      .evaluateAll((items) =>
        items.slice(0, 80).map((item) => ({
          text: (item.textContent || "").trim().replace(/\s+/g, " "),
          aria: item.getAttribute("aria-label"),
          title: item.getAttribute("title"),
          disabled:
            item instanceof HTMLButtonElement ? item.disabled : undefined,
        })),
      )
      .catch(() => []);
    throw new Error(
      `[smoke:knowledge-gui] 点击控件失败 ${JSON.stringify({
        text,
        ariaLabel,
        index,
        buttons,
      })}`,
      { cause: error },
    );
  }
}

async function seedAgentResultForKnowledgeCapture(page, options) {
  await page.evaluate(
    ({ projectId, message }) => {
      const now = new Date().toISOString();
      sessionStorage.setItem(
        `aster_messages_${projectId}`,
        JSON.stringify([
          {
            id: message.id,
            role: "assistant",
            content: message.content,
            timestamp: now,
          },
        ]),
      );
      sessionStorage.removeItem(`aster_curr_sessionId_${projectId}`);
      sessionStorage.removeItem(`aster_last_sessionId_${projectId}`);
      sessionStorage.removeItem(`aster_thread_turns_${projectId}`);
      sessionStorage.removeItem(`aster_thread_items_${projectId}`);
      sessionStorage.removeItem(`aster_curr_turnId_${projectId}`);
    },
    {
      projectId: options.projectId,
      message: AGENT_RESULT_MESSAGE,
    },
  );
}

async function createSmokeProject(options) {
  const projectName = `Knowledge GUI Smoke ${process.pid}`;
  const project = await invoke(options, "workspace_create", {
    request: {
      name: projectName,
      rootPath: options.workingDir,
      workspaceType: "temporary",
    },
  });
  const projectId = String(project?.id || "").trim();
  if (!projectId) {
    throw new Error("[smoke:knowledge-gui] workspace_create 未返回项目 ID");
  }
  options.projectId = projectId;
  options.projectName = String(project?.name || projectName);
  const projectRootPath = String(
    project?.rootPath || project?.root_path || "",
  ).trim();
  if (projectRootPath) {
    options.workingDir = projectRootPath;
    fs.mkdirSync(options.workingDir, { recursive: true });
  }
}

async function cleanupSmokeProject(options) {
  if (!options.projectId) {
    return;
  }

  try {
    await invoke(options, "workspace_delete", {
      id: options.projectId,
      deleteDirectory: false,
    });
  } catch (error) {
    console.warn(
      `[smoke:knowledge-gui] 清理临时项目失败: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function runPlaywrightGuiFlow(options) {
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `lime-knowledge-gui-playwright-${process.pid}-`),
  );
  const launchOptions = {
    headless: true,
    viewport: { width: 1440, height: 960 },
  };
  let context = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      channel: "chrome",
    });
  } catch (chromeError) {
    console.warn(
      `[smoke:knowledge-gui] Chrome channel 启动失败，尝试 Playwright 自带 Chromium: ${
        chromeError instanceof Error ? chromeError.message : String(chromeError)
      }`,
    );
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  }

  const page = context.pages()[0] ?? (await context.newPage());
  const consoleErrors = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.stack || error.message);
  });

  try {
    logStage("open-playwright-page");
    await page.goto(options.appUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ({ workingDir, onboardingVersion, projectId }) => {
        localStorage.setItem("lime_onboarding_complete", "true");
        localStorage.setItem("lime_onboarding_version", onboardingVersion);
        localStorage.setItem("lime_user_profile", "developer");
        localStorage.setItem("lime.knowledge.working-dir", workingDir);
        localStorage.setItem("agent_last_project_id", JSON.stringify(projectId));
      },
      {
        workingDir: options.workingDir,
        onboardingVersion: ONBOARDING_VERSION,
        projectId: options.projectId,
      },
    );
    await page.reload({ waitUntil: "domcontentloaded" });

    logStage("wait-home");
    await waitForPageText(page, "首页加载", ["青柠一下，灵感即来"], options.timeoutMs);

    logStage("open-knowledge-page");
    await clickPageControl(page, { ariaLabel: "项目资料" });

    logStage("wait-knowledge-overview");
    await waitForPageText(
      page,
      "知识库总览加载",
      [
        "项目资料",
        "日常使用入口",
        "回到 Agent",
        "全部资料",
        "全部项目资料",
        "已添加资料",
        "已整理草稿",
        "已确认可用",
        DEFAULT_PACK.title,
        SECONDARY_PACK.title,
        options.projectName,
      ],
      options.timeoutMs,
    );

    logStage("open-agent-with-knowledge");
    await clickPageControl(page, { text: "用于生成" });

    logStage("wait-agent");
    try {
      await waitForPageText(
        page,
        "Agent 页面加载",
        [
          `正在使用：${DEFAULT_PACK.title}`,
          "请基于当前项目资料生成内容",
        ],
        options.timeoutMs,
      );
    } catch (error) {
      if (consoleErrors.length > 0) {
        throw new Error(
          `${
            error instanceof Error ? error.message : String(error)
          }；console error: ${JSON.stringify(consoleErrors.slice(0, 5))}`,
        );
      }
      throw error;
    }

    logStage("return-knowledge-before-agent-result");
    await clickPageControl(page, { ariaLabel: "项目资料" });

    logStage("prepare-agent-result");
    await seedAgentResultForKnowledgeCapture(page, options);
    await clickPageControl(page, { text: "用于生成" });

    logStage("wait-agent-result");
    await waitForPageText(
      page,
      "Agent 结果样本加载",
      [
        `正在使用：${DEFAULT_PACK.title}`,
        "沉淀为项目资料",
        "事实：该结果来自当前 Agent 对话",
      ],
      options.timeoutMs,
    );

    logStage("capture-agent-result");
    await clickPageControl(page, { ariaLabel: "沉淀为项目资料" });

    logStage("wait-agent-result-captured");
    await waitForPageText(
      page,
      "Agent 结果沉淀完成",
      ["项目资料已整理", AGENT_RESULT_MESSAGE.title],
      options.timeoutMs,
    );

    logStage("return-knowledge-page");
    await clickPageControl(page, { ariaLabel: "项目资料" });

    logStage("wait-captured-agent-result");
    await waitForPageText(
      page,
      "沉淀资料进入管理页",
      [
        "项目资料",
        "全部资料",
        AGENT_RESULT_MESSAGE.title,
        "继续确认",
      ],
      options.timeoutMs,
    );

    logStage("open-import-view");
    await clickPageControl(page, { text: "补充导入" });

    logStage("wait-organize-entry");
    await waitForPageText(
      page,
      "资料整理入口加载",
      ["自动整理", "整理资料", "引用摘要", "人工确认"],
      options.timeoutMs,
    );

    if (consoleErrors.length > 0) {
      throw new Error(
        `[smoke:knowledge-gui] 页面存在 ${consoleErrors.length} 条 console error: ${JSON.stringify(
          consoleErrors.slice(0, 5),
        )}`,
      );
    }
  } finally {
    await context.close().catch(() => undefined);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
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

  try {
    logStage("wait-health");
    await waitForHealth(options);
    await sleep(POST_HEALTH_SETTLE_MS);

    logStage("create-smoke-project");
    await createSmokeProject(options);

    logStage("seed-knowledge-packs");
    await seedKnowledgePacks(options);

    await runPlaywrightGuiFlow(options);
    console.log("[smoke:knowledge-gui] 通过");
  } finally {
    await cleanupSmokeProject(options);
    fs.rmSync(options.workingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
