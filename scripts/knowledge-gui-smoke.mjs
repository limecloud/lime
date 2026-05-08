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

const BUILDER_ACCEPTANCE_PACK = {
  title: "content-ops-acceptance",
  sourceText: [
    "# 内容运营验收资料",
    "",
    "- 栏目：每周二发布选题复盘，每周五发布案例拆解。",
    "- SOP：选题必须包含目标人群、表达角度、引用素材和风险边界。",
    "- 边界：没有来源的增长数据必须标记待确认，不能编造成事实。",
  ].join("\n"),
};

const PERSONA_PACK = {
  name: "smoke-persona",
  title: "Smoke 人设资料",
  type: "personal-ip",
  sourceFileName: "persona-source.md",
  sourceText: [
    "# Smoke 人设资料",
    "",
    "- 语气：清晰、克制、只说已确认事实。",
    "- 边界：不得把 smoke 数据当作真实用户资料。",
    "- 适用：验证 KnowledgePage chooser 的 persona + data 协同。",
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

const FILE_MANAGER_SOURCE_TITLE = "default-source";
const USER_FACING_FORBIDDEN_TEXT = [
  ".lime/knowledge",
  "KNOWLEDGE.md",
  "knowledge_builder",
  "compiled/brief.md",
  "sources/source.md",
  "frontmatter",
  "<knowledge_pack",
  "working_dir",
  "user-confirmed",
  "runtimeMode",
  "primaryDocument",
  "runtimeBinding",
  "Request failed",
  "Bad request",
];

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
  const invokeTimeoutMs = Math.min(
    options.timeoutMs,
    INVOKE_TIMEOUT_CEILING_MS,
  );

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
        return expectedNeedles.every((needle) =>
          searchableText.includes(needle),
        );
      },
      needles,
      { timeout: timeoutMs },
    );
  } catch (error) {
    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");
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
    const missing = needles.filter(
      (needle) => !searchableText.includes(needle),
    );
    throw new Error(
      `[smoke:knowledge-gui] ${label} 等待失败，缺少 ${JSON.stringify(
        missing,
      )}，页面文本预览: ${searchableText.slice(0, 2_000)}`,
      { cause: error },
    );
  }
}

async function assertVisibleText(page, label, needles) {
  const text = await page.locator("body").innerText();
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length > 0) {
    throw new Error(
      `[smoke:knowledge-gui] ${label} 验收失败，缺少 ${JSON.stringify(
        missing,
      )}，页面文本预览: ${text.slice(0, 2_000)}`,
    );
  }
}

async function assertNoUserFacingInternalText(page, label) {
  const pageMain = page.locator("main").nth(1);
  const text =
    (await pageMain.innerText().catch(() => "")) ||
    (await page.locator("body").innerText());
  const leaked = USER_FACING_FORBIDDEN_TEXT.filter((needle) =>
    text.includes(needle),
  );
  if (leaked.length > 0) {
    const firstLeak = leaked[0];
    const index = text.indexOf(firstLeak);
    const preview =
      index >= 0 ? text.slice(Math.max(0, index - 180), index + 260) : "";
    throw new Error(
      `[smoke:knowledge-gui] ${label} 暴露内部实现文本: ${JSON.stringify(
        leaked,
      )}，附近文本: ${preview}`,
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
    const pageText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
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

async function waitForExactButton(page, label, name, timeoutMs) {
  try {
    await page
      .getByRole("button", { name, exact: true })
      .waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    const pageText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
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
      `[smoke:knowledge-gui] ${label} 等待按钮失败 ${JSON.stringify({
        name,
        buttons,
      })}，页面文本预览: ${pageText.slice(0, 2_000)}`,
      { cause: error },
    );
  }
}

async function openPackDetail(page, title) {
  await page
    .locator("article")
    .filter({ hasText: title })
    .getByRole("button", { name: "查看详情" })
    .click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
}

async function clickScopedButton(page, { scope, text, ariaLabel, index = 0 }) {
  const scoped = page.locator(scope);
  const locator = ariaLabel
    ? scoped.getByRole("button", { name: ariaLabel, exact: true }).nth(index)
    : scoped.locator("button, a").filter({ hasText: text }).nth(index);

  try {
    await locator.click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
  } catch (error) {
    const buttons = await scoped
      .locator("button, a")
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
      `[smoke:knowledge-gui] 点击区域控件失败 ${JSON.stringify({
        scope,
        text,
        ariaLabel,
        index,
        buttons,
      })}`,
      { cause: error },
    );
  }
}

async function confirmKnowledgeComposer(
  page,
  options,
  { selectSecondaryData = false, selectPersona = false } = {},
) {
  await waitForPageText(
    page,
    "Knowledge chooser 打开",
    ["选择本轮 Knowledge 上下文", "Persona（最多 1 个）", "Data（可多选）"],
    options.timeoutMs,
  );

  if (selectPersona) {
    await page
      .locator(`[data-testid="knowledge-composer-persona-${PERSONA_PACK.name}"]`)
      .click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
  }

  if (selectSecondaryData) {
    await page
      .locator(`[data-testid="knowledge-composer-data-${SECONDARY_PACK.name}"]`)
      .click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
    await waitForPageText(
      page,
      "Knowledge chooser 多 data 选择",
      ["已选 2"],
      options.timeoutMs,
    );
  }

  if (selectPersona && selectSecondaryData) {
    await waitForPageText(
      page,
      "Knowledge chooser persona + 多 data 选择",
      ["当前选择 3 份资料"],
      options.timeoutMs,
    );
  }

  await clickPageControl(page, { text: "确认启用" });
}

async function verifyDetailTabs(page, options, packTitle) {
  await openPackDetail(page, packTitle);
  await waitForPageText(
    page,
    "资料详情头部加载",
    [
      packTitle,
      "概览",
      "内容",
      "原始资料",
      "引用摘要",
      "缺口与风险",
      "整理记录",
    ],
    options.timeoutMs,
  );
  await assertNoUserFacingInternalText(page, "资料详情头部");

  const tabExpectations = [
    { tab: "概览", needles: ["适用场景", "当前引用摘要"] },
    { tab: "内容", needles: ["资料说明", "整理内容"] },
    { tab: "原始资料", needles: ["原始资料"] },
    { tab: "引用摘要", needles: ["引用摘要"] },
    { tab: "缺口与风险", needles: ["缺口与风险", "安全边界"] },
    { tab: "整理记录", needles: ["整理记录"] },
  ];

  for (const item of tabExpectations) {
    await clickPageControl(page, { text: item.tab });
    await waitForPageText(
      page,
      `资料详情 Tab ${item.tab}`,
      item.needles,
      options.timeoutMs,
    );
    await assertNoUserFacingInternalText(page, `资料详情 Tab ${item.tab}`);
  }
}

async function verifyBuilderImportAndReview(page, options) {
  await clickPageControl(page, { text: "Builder 整理" });
  await waitForPageText(
    page,
    "Builder 整理台加载",
    [
      "Builder Skills 整理台",
      "1 选择 Builder Skill",
      "2 导入原始材料",
      "3 交给 Builder Skill",
      "4 审阅与入上下文",
    ],
    options.timeoutMs,
  );

  await page
    .getByRole("button", {
      name: "内容运营 选题日历、栏目节奏、素材复用和发布复盘。",
    })
    .click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
  await page.getByLabel("Pack 显示名").fill(BUILDER_ACCEPTANCE_PACK.title);
  await page
    .getByLabel("原始材料正文")
    .fill(BUILDER_ACCEPTANCE_PACK.sourceText);
  await waitForPageText(
    page,
    "Builder 表单填充",
    [
      BUILDER_ACCEPTANCE_PACK.title,
      "栏目：每周二发布选题复盘",
      "边界：没有来源的增长数据必须标记待确认",
    ],
    options.timeoutMs,
  );
  await page
    .getByRole("button", { name: "导入并生成 Pack", exact: true })
    .click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });

  await waitForExactButton(page, "Builder 产物详情加载", "人工确认", options.timeoutMs);
  await waitForPageText(
    page,
    "Builder 产物详情加载",
    [
      BUILDER_ACCEPTANCE_PACK.title,
      "重新整理",
      "待人工确认",
      "引用摘要",
      "人工确认",
    ],
    options.timeoutMs,
  );
  await assertNoUserFacingInternalText(page, "Builder 产物详情");

  await page
    .getByRole("button", { name: "人工确认", exact: true })
    .click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
  await waitForPageText(
    page,
    "Builder 产物人工确认",
    ["资料已人工确认", BUILDER_ACCEPTANCE_PACK.title],
    options.timeoutMs,
  );

  await waitForExactButton(page, "Builder 产物设为默认入口", "设为默认", options.timeoutMs);
  await page
    .getByRole("button", { name: "设为默认", exact: true })
    .click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
  await waitForPageText(
    page,
    "Builder 产物设为默认",
    ["已设为当前项目默认资料", "默认资料"],
    options.timeoutMs,
  );
}

async function openKnowledgePageFromMainNav(page) {
  await clickScopedButton(page, {
    scope: '[data-testid="app-sidebar-main-nav"]',
    ariaLabel: "项目资料",
  });
}

async function waitForKnowledgePack(options, label, matcher) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < options.timeoutMs) {
    try {
      const result = await invoke(options, "knowledge_list_packs", {
        request: {
          workingDir: options.workingDir,
          includeArchived: true,
        },
      });
      const packs = Array.isArray(result?.packs) ? result.packs : [];
      const found = packs.find((pack) => {
        const metadata = pack?.metadata || {};
        return matcher({
          name: String(metadata.name || ""),
          description: String(metadata.description || ""),
          status: String(metadata.status || ""),
        });
      });
      if (found) {
        return found;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(options.intervalMs);
  }

  const detail =
    lastError instanceof Error
      ? lastError.message
      : String(lastError || "未找到匹配资料");
  throw new Error(`[smoke:knowledge-gui] 等待资料失败: ${label}。${detail}`);
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
    context = await chromium.launchPersistentContext(
      userDataDir,
      launchOptions,
    );
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
        localStorage.setItem(
          "agent_last_project_id",
          JSON.stringify(projectId),
        );
      },
      {
        workingDir: options.workingDir,
        onboardingVersion: ONBOARDING_VERSION,
        projectId: options.projectId,
      },
    );
    await page.reload({ waitUntil: "domcontentloaded" });

    logStage("wait-home");
    await waitForPageText(
      page,
      "首页加载",
      ["青柠一下，灵感即来"],
      options.timeoutMs,
    );

    logStage("open-home-knowledge-hub");
    await clickPageControl(page, { text: "添加资料" });

    logStage("wait-home-knowledge-hub");
    await waitForPageText(
      page,
      "首页资料入口加载",
      ["添加新资料", "检查资料", "使用这份资料"],
      options.timeoutMs,
    );
    await page.keyboard.press("Escape");

    logStage("open-file-manager");
    await clickPageControl(page, { ariaLabel: "打开左侧文件管理器" });

    logStage("wait-file-manager");
    await waitForPageText(
      page,
      "文件管理器加载",
      ["default-source.md", "加入对话", "设为资料", "本地位置"],
      options.timeoutMs,
    );

    logStage("import-file-manager-source");
    await clickScopedButton(page, {
      scope: '[data-testid="file-manager-sidebar"]',
      ariaLabel: "设为项目资料 default-source.md",
    });

    logStage("wait-file-manager-source-imported");
    await waitForKnowledgePack(
      options,
      "文件管理器资料导入完成",
      (pack) =>
        pack.description === FILE_MANAGER_SOURCE_TITLE ||
        pack.name === FILE_MANAGER_SOURCE_TITLE,
    );

    await clickPageControl(page, { ariaLabel: "关闭文件管理器" });

    logStage("open-knowledge-page");
    await openKnowledgePageFromMainNav(page);

    logStage("wait-knowledge-overview");
    await waitForPageText(
      page,
      "知识库总览加载",
      [
        "Agent Knowledge 工作台",
        "Knowledge v2 · Skills-first",
        "Skills 生产线",
        "回到 Agent 整理",
        "上下文总览",
        "Knowledge Pack 清单",
        "资料进入 Pack",
        "Builder 已整理",
        "可入上下文",
        PERSONA_PACK.title,
        DEFAULT_PACK.title,
        SECONDARY_PACK.title,
        FILE_MANAGER_SOURCE_TITLE,
        options.projectName,
      ],
      options.timeoutMs,
    );
    await assertVisibleText(page, "Knowledge v2 总览细节", [
      "Knowledge v2 上下文组合",
      "Persona 人设层",
      "Data 运营资料层",
      "审阅闸门：等你确认的资料",
      "v2 闭环概览",
      "运营类资料覆盖",
    ]);
    await assertNoUserFacingInternalText(page, "Knowledge v2 总览");

    logStage("verify-detail-tabs");
    await verifyDetailTabs(page, options, DEFAULT_PACK.title);
    await clickPageControl(page, { text: "上下文总览" });

    logStage("open-agent-with-knowledge");
    await clickPageControl(page, { text: "选择用于生成" });
    await confirmKnowledgeComposer(page, options, {
      selectSecondaryData: true,
      selectPersona: true,
    });

    logStage("wait-agent");
    try {
      await waitForPageText(
        page,
        "Agent 页面加载",
        [`资料：${DEFAULT_PACK.title}`, "+2", "请基于当前项目资料生成内容"],
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
    await openKnowledgePageFromMainNav(page);

    logStage("prepare-agent-result");
    await seedAgentResultForKnowledgeCapture(page, options);
    await clickPageControl(page, { text: "选择用于生成" });
    await confirmKnowledgeComposer(page, options);

    logStage("wait-agent-result");
    await waitForPageText(
      page,
      "Agent 结果样本加载",
      [
        `资料：${DEFAULT_PACK.title}`,
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
    await openKnowledgePageFromMainNav(page);

    logStage("wait-captured-agent-result");
    await waitForPageText(
      page,
      "沉淀资料进入管理页",
      [
        "Agent Knowledge 工作台",
        "Knowledge Pack 清单",
        AGENT_RESULT_MESSAGE.title,
        "继续确认",
      ],
      options.timeoutMs,
    );

    logStage("verify-builder-import-review");
    await verifyBuilderImportAndReview(page, options);

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
  fs.writeFileSync(
    path.join(options.workingDir, DEFAULT_PACK.sourceFileName),
    DEFAULT_PACK.sourceText,
  );
  await seedPack(options, PERSONA_PACK);
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
