#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createTempRuntimeEnv,
  launchElectronFixture,
  parseJsonRpcRequestsFromInvokeTrace,
  waitForPageCondition,
} from "./mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../lib/chat-fixture/teardown.mjs";
import { inspectElectronFixtureBuildFreshness } from "../lib/electron-fixture-build.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import {
  assertSidebarBridge,
  assertSidebarLayout,
  assertSidebarMenu,
  collectSidebarLayoutDom,
  fingerprintArtifacts,
  fingerprintSources,
  sha256,
} from "./lib/sidebar-layout-fixture-evidence.mjs";

const OPTIONS = { timeoutMs: 120_000, intervalMs: 100 };
const PREFIX = "[sidebar-layout-fixture]";
const PINNED_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318";
const widths = [960, 1280, 1440];

export function parseSidebarLayoutArgs(argv) {
  const options = {
    runId: `sidebar-layout-${new Date().toISOString().replace(/[-:.]/g, "")}`,
    evidenceDir: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (["--help", "-h"].includes(argument)) options.help = true;
    else if (["--run-id", "--evidence-dir"].includes(argument)) {
      const value = argv[++index];
      assert.ok(value && !value.startsWith("--"), `${argument} requires value`);
      if (argument === "--run-id") options.runId = value;
      else options.evidenceDir = path.resolve(value);
    } else throw new Error(`unknown argument ${argument}`);
  }
  assert.match(options.runId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
  options.evidenceDir ??= path.resolve(
    ".lime/qc/gui-evidence/sidebar-layout",
    options.runId,
  );
  return options;
}

async function typedRpc(page, request, receipts) {
  const response = await page.evaluate(async (request) => {
    const command = "app_server_handle_json_lines";
    if (
      window.__LIME_ELECTRON__ !== true ||
      typeof window.electronAPI?.invoke !== "function" ||
      window.electronAPI.devBridgeFallback !== false
    )
      throw new Error("real Electron preload is required");
    const reply = await window.electronAPI.invoke(command, {
      request: { lines: [JSON.stringify(request)] },
    });
    const messages = (reply?.lines ?? []).map((line) => JSON.parse(line));
    const message = messages.find((entry) => entry.id === request.id);
    if (!message || !Object.hasOwn(message, "result") || message.error)
      throw new Error(`current RPC failed: ${request.method}`);
    return {
      result: message.result,
      receipt: {
        command,
        transport: "electron-ipc",
        status: "success",
        method: request.method,
        requestId: request.id,
        responseId: message.id,
        electron: window.__LIME_ELECTRON__ === true,
        fallback: window.electronAPI.devBridgeFallback,
      },
    };
  }, request);
  receipts.push(response.receipt);
  return response.result;
}

export async function seedSidebar({ page, client, runtimeEnv, rpcReceipts }) {
  const call = (request) => typedRpc(page, request, rpcReceipts);
  const projects = [];
  for (let index = 1; index <= 7; index++) {
    const rootPath = path.join(runtimeEnv.tempRoot, `sidebar-project-${index}`);
    fs.mkdirSync(rootPath);
    const response = await call(
      client.ensureWorkspace({ name: `Sidebar Project ${index}`, rootPath }),
    );
    assert.ok(response.workspace?.id, "workspace/ensure identity");
    projects.push({ id: response.workspace.id, rootPath });
  }
  const recentRoot = path.join(runtimeEnv.tempRoot, "standalone-threads");
  fs.mkdirSync(recentRoot);
  const create = async (name, cwd) => {
    const response = await call(
      client.startSession({
        model: "sidebar-fixture-model",
        modelProvider: "sidebar-fixture-provider",
        cwd,
        projectId: null,
        serviceName: name,
        threadSource: "fixture",
        historyMode: "legacy",
      }),
    );
    const thread = response.thread;
    assert.ok(thread?.id && thread?.sessionId, "canonical thread identity");
    await call(client.setThreadName({ threadId: thread.id, name }));
    return { threadId: thread.id, sessionId: thread.sessionId };
  };
  const projectThreads = [];
  for (const [index, project] of projects.entries())
    projectThreads.push(
      await create(`Sidebar Project Thread ${index + 1}`, project.rootPath),
    );
  const pinned = await create("Sidebar Pinned Thread", recentRoot);
  await call(
    client.moveThreadToSection({
      threadId: pinned.threadId,
      sectionId: PINNED_ID,
    }),
  );
  const section = (
    await call(client.createThreadSection({ name: "Sidebar Section" }))
  ).section;
  assert.ok(section?.id, "canonical custom section identity");
  const custom = await create("Sidebar Custom Thread", recentRoot);
  await call(
    client.moveThreadToSection({
      threadId: custom.threadId,
      sectionId: section.id,
    }),
  );
  const recents = [];
  for (let index = 1; index <= 14; index++)
    recents.push(await create(`Sidebar Recent ${index}`, recentRoot));
  const listed = await call(client.listThreads({ limit: 100 }));
  const expected = [...projectThreads, pinned, custom, ...recents];
  assert.ok(
    expected.every((thread) =>
      listed.data.some((item) => item.id === thread.threadId),
    ),
    "thread/list contains each seeded canonical identity",
  );
  const sections = await call(client.listThreadSections({ limit: 100 }));
  assert.ok(sections.data.some((item) => item.id === section.id));
  assert.ok(sections.data.some((item) => item.id === PINNED_ID));
  for (const [thread, sectionId] of [
    [pinned, PINNED_ID],
    [custom, section.id],
  ]) {
    const read = await call(
      client.readThread({ threadId: thread.threadId, includeTurns: true }),
    );
    assert.equal(read.thread.id, thread.threadId);
    assert.equal(read.thread.section?.id, sectionId);
    assert.equal(read.thread.turns.length, 0, "fixture starts no model Turn");
  }
  await page.evaluate(
    (projectIds) => {
      window.localStorage.setItem(
        "agent_opened_project_ids",
        JSON.stringify(projectIds),
      );
      window.localStorage.removeItem("agent_last_project_id");
      window.localStorage.setItem("lime.app-sidebar.collapsed", "false");
      // An old smaller display preference must clamp to the current minimum.
      window.localStorage.setItem("sidebar-width", "240");
      window.localStorage.setItem("theme", "light");
      window.localStorage.removeItem("sidebar-section-preferences");
    },
    projects.map((project) => project.id),
  );
  return {
    projects: projects.map(({ id }) => ({ id })),
    projectThreads,
    recents,
    pinned,
    custom,
    sectionId: section.id,
  };
}

async function reloadSidebar(page, recentCount = 10) {
  await page.reload({ waitUntil: "domcontentloaded" });
  // Infinite pagination requires the sentinel to enter the scroll viewport.
  // A fixed-height window must not be expected to load offscreen pages unaided.
  if (recentCount > 10) {
    await page
      .getByTestId("app-sidebar-recent-conversations")
      .waitFor({ state: "visible" });
    const count = await page
      .getByTestId("app-sidebar-recent-conversations")
      .getByTestId("app-sidebar-conversation-open")
      .count();
    if (count < recentCount) {
      await page.getByTestId("app-sidebar-menu-scroll").evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
    }
  }
  await waitForPageCondition(
    page,
    OPTIONS,
    (recentCount) =>
      window.__LIME_ELECTRON__ === true &&
      document.querySelectorAll(
        '[data-testid="app-sidebar-project-conversation-group"]',
      ).length === 5 &&
      document.querySelectorAll(
        '[data-testid="app-sidebar-recent-conversations"] [data-testid="app-sidebar-conversation-open"]',
      ).length === recentCount,
    "canonical sidebar budget did not become visible",
    recentCount,
  ).catch(async (error) => {
    const observed = await page.evaluate(collectSidebarLayoutDom);
    throw new Error(
      `${error.message}: projects=${observed.projectCount}/5 recents=${observed.recentCount}/${recentCount} electron=${observed.electron}`,
      { cause: error },
    );
  });
  await page.getByTestId("app-sidebar-menu-scroll").evaluate((node) => {
    node.scrollTop = 0;
  });
}

async function waitWidth(page, width) {
  await waitForPageCondition(
    page,
    OPTIONS,
    (width) =>
      document
        .querySelector('[data-testid="app-sidebar"]')
        ?.getBoundingClientRect().width === width,
    "sidebar width did not settle",
    width,
  );
}

async function resizeOwnedWindow(handle, width, height) {
  const window = await handle.app.browserWindow(handle.page);
  const nativeSize = await window.evaluate(
    (window, size) => {
      const minimumSizeBefore = window.getMinimumSize();
      window.setContentSize(size.width, size.height);
      const [width, height] = window.getContentSize();
      return {
        contentSize: { width, height },
        minimumSizeBefore,
        minimumSizeDuring: window.getMinimumSize(),
      };
    },
    { width, height },
  );
  assert.deepEqual(
    nativeSize.minimumSizeBefore,
    [480, 600],
    "production primary window must use the reference minimum size",
  );
  assert.deepEqual(
    nativeSize.contentSize,
    { width, height },
    "native fixture content size",
  );
  await handle.page.setViewportSize({ width, height });
  return nativeSize;
}

async function verifySectionPreferences(page) {
  const section = page.locator('[data-sidebar-section="threads"]');
  const toggle = section.locator("button[aria-controls]").first();
  await toggle.click();
  assert.equal(
    await section
      .locator('[data-testid="app-sidebar-project-conversation-group"]')
      .count(),
    0,
  );
  await toggle.focus();
  await toggle.press("Alt+ArrowDown");
  const expected = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("sidebar-section-preferences")),
  );
  assert.ok(expected.collapsed.includes("threads"));
  assert.notEqual(expected.order[0], "threads");
  await page.reload({ waitUntil: "domcontentloaded" });
  await section.waitFor({ state: "visible" });
  await waitForPageCondition(
    page,
    OPTIONS,
    (expected) => {
      const sections = [...document.querySelectorAll("[data-sidebar-section]")];
      const order = sections.map((node) =>
        node.getAttribute("data-sidebar-section"),
      );
      const projects = document.querySelector(
        '[data-sidebar-section="threads"]',
      );
      return (
        JSON.stringify(order) === JSON.stringify(expected.order) &&
        projects
          ?.querySelector("button[aria-controls]")
          ?.getAttribute("aria-expanded") === "false"
      );
    },
    "section display preferences did not recover",
    expected,
  );
  await toggle.click();
  await waitForPageCondition(
    page,
    OPTIONS,
    () =>
      document.querySelectorAll(
        '[data-testid="app-sidebar-project-conversation-group"]',
      ).length === 5,
    "project membership did not recover after section expansion",
  );
  await toggle.focus();
  await toggle.press("Alt+ArrowUp");
  await page.getByTestId("app-sidebar-rail-home").focus();
  return {
    keyboardReorder: true,
    collapsedReload: true,
    canonicalMembershipRecovered: true,
  };
}

async function verifyHoverActions(page) {
  const readOpacity = () =>
    page.evaluate(() => {
      const actions = document.querySelector(
        '[data-testid="app-sidebar-new-conversation-button"]',
      )?.parentElement;
      return actions ? window.getComputedStyle(actions).opacity : null;
    });
  await page.mouse.move(800, 100);
  assert.equal(await readOpacity(), "0", "section actions hidden at rest");
  await page
    .locator('[data-sidebar-section="chats"] button[aria-controls]')
    .first()
    .hover();
  assert.equal(await readOpacity(), "1", "section actions visible on hover");
  await page.mouse.move(800, 100);
  assert.equal(await readOpacity(), "0", "section actions hide after hover");
  await page.getByTestId("app-sidebar-menu-scroll").evaluate((node) => {
    node.scrollTop = 0;
  });
  return { hiddenAtRest: true, visibleOnHover: true, hiddenAfterHover: true };
}

async function verifyProfileHelp(page, evidenceDir, theme, screenshots) {
  const step = (value) =>
    console.log(`${PREFIX} profile=${theme} step=${value}`);
  const account = page.getByTestId("app-sidebar-account-button");
  const menu = page.getByTestId("app-sidebar-account-menu");
  const help = menu.getByRole("menuitem", { name: "帮助", exact: true });
  await help.focus();
  await help.press("ArrowRight");
  const shortcuts = page.getByRole("menuitem", {
    name: "键盘快捷键",
    exact: true,
  });
  await shortcuts.waitFor({ state: "visible" });
  await waitForPageCondition(
    page,
    OPTIONS,
    () => {
      const parent = document.querySelector(
        '[data-testid="app-sidebar-account-menu"]',
      );
      const submenu = [...document.querySelectorAll('[role="menu"]')].find(
        (node) => node !== parent && node.textContent.includes("键盘快捷键"),
      );
      return (
        parent &&
        submenu &&
        Math.abs(
          parent.getBoundingClientRect().bottom -
            submenu.getBoundingClientRect().bottom,
        ) <= 2
      );
    },
    "Help submenu did not align to parent menu bottom",
  );
  const filename = `${theme}-1440-profile-help.png`;
  await page.screenshot({ path: path.join(evidenceDir, filename) });
  screenshots.push(filename);
  await shortcuts.click();
  step("menu-dialog-open");
  const dialog = page.getByRole("dialog", { name: "键盘快捷键" });
  await dialog.waitFor({ state: "visible" });
  const search = dialog.getByRole("textbox", { name: "搜索快捷键" });
  assert.equal(
    await search.evaluate((node) => node === document.activeElement),
    true,
  );
  assert.equal(
    await dialog.locator('[data-command-id="searchThreads"]').count(),
    1,
    "dialog lists the real sidebar search command",
  );
  await search.fill("searchThreads");
  assert.equal(await dialog.locator("[data-command-id]").count(), 1);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await waitForPageCondition(
    page,
    OPTIONS,
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "app-sidebar-account-button",
    "shortcut dialog did not restore account focus",
  );
  await account.press(process.platform === "darwin" ? "Meta+/" : "Control+/");
  await dialog.waitFor({ state: "visible" });
  await waitForPageCondition(
    page,
    OPTIONS,
    () =>
      document.activeElement?.matches("[data-keyboard-shortcuts-dialog] input"),
    "reopened shortcuts dialog did not focus its search input",
  );
  step("keyboard-dialog-focused");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  step("keyboard-dialog-closed");
  await account.click();
  await menu.waitFor({ state: "visible" });
  return {
    parentBottomAlignment: true,
    realRegisteredCommand: "searchThreads",
    menuAndKeyboardShareDialog: true,
    searchAndFocusRestore: true,
  };
}

export async function runSidebarLayout(argv = process.argv.slice(2)) {
  const options = parseSidebarLayoutArgs(argv);
  if (options.help) {
    console.log(
      "node scripts/electron/sidebar-layout-fixture-smoke.mjs [--run-id id] [--evidence-dir path]\nRequires current prebuilt artifacts; never builds or attaches to a user window.",
    );
    return;
  }
  assert.equal(
    fs.existsSync(options.evidenceDir),
    false,
    "fresh evidence directory required",
  );
  fs.mkdirSync(options.evidenceDir, { recursive: true });
  const rootDir = process.cwd();
  const runtimeEnv = createTempRuntimeEnv();
  const consoleErrors = [];
  const pageErrors = [];
  const summary = {
    schemaVersion: 1,
    runId: options.runId,
    result: "fail",
    ok: false,
    proofLevel: "Desktop Gate B controlled read-model fixture",
    backendMode: "unavailable",
    modelTurnStarted: false,
    claimBoundary:
      "Isolated macOS/source-build Electron sidebar, real preload IPC and canonical thread/list/read/section. No provider execution, reference runtime, Windows, packaged release, or full GUI parity claim.",
    startedAt: new Date().toISOString(),
    rpcReceipts: [],
    rendererMethods: [],
    screenshots: [],
    layouts: [],
  };
  const summaryPath = path.join(options.evidenceDir, "summary.json");
  let handle;
  let mainExit;
  let failure;
  const stage = (value) => {
    summary.stage = value;
    console.log(`${PREFIX} stage=${value}`);
  };
  const requireFresh = () => {
    const freshness = inspectElectronFixtureBuildFreshness({ rootDir });
    assert.equal(
      freshness.ready,
      true,
      `fresh artifacts required: ${freshness.reason} ${freshness.staleSegments.join(",")}`,
    );
    return { ready: true, reason: freshness.reason };
  };
  try {
    stage("verify-prebuilt-artifacts");
    summary.buildBefore = requireFresh();
    summary.sourceSha256 = fingerprintSources(rootDir);
    summary.artifactsBefore = fingerprintArtifacts(rootDir);
    const { AppServerClient } =
      await import("../../packages/app-server-client/dist/request-client.js");
    const client = new AppServerClient({ initialRequestId: 710_000 });
    const binary = resolveDevAppServerBinary({
      env: runtimeEnv.env,
      repoRoot: rootDir,
      forceBuild: false,
    });
    summary.appServerExecutableSha256 = sha256(fs.readFileSync(binary));
    const appServerEnv = resolveElectronAppServerRuntimeEnv({
      env: { ...runtimeEnv.env, APP_SERVER_BIN: binary },
    });
    stage("launch-isolated-electron");
    handle = await launchElectronFixture({
      options: OPTIONS,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    mainExit = captureMainProcessExit(handle.app.process());
    await handle.app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false);
        window.showInactive();
      }
    });
    const page = handle.page;
    await page.addInitScript(() => {
      window.__sidebarKeyboardEvents = [];
      document.addEventListener(
        "keydown",
        (event) => {
          if (!["Escape", "/"].includes(event.key)) return;
          const entry = {
            key: event.key,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            targetTag: event.target?.tagName,
            targetTestId: event.target?.getAttribute?.("data-testid"),
            insideDialog: Boolean(
              event.target?.closest?.("[data-keyboard-shortcuts-dialog]"),
            ),
            dialogVisible: Boolean(
              document.querySelector("[data-keyboard-shortcuts-dialog]"),
            ),
          };
          window.__sidebarKeyboardEvents.push(entry);
          queueMicrotask(() => {
            entry.defaultPrevented = event.defaultPrevented;
          });
        },
        true,
      );
    });
    stage("seed-through-current-typed-rpc");
    summary.identities = await seedSidebar({
      page,
      client,
      runtimeEnv,
      rpcReceipts: summary.rpcReceipts,
    });
    await reloadSidebar(page, summary.identities.recents.length);
    await waitWidth(page, 290);
    const infinite = await page.evaluate(collectSidebarLayoutDom);
    assertSidebarLayout(infinite, {
      recentCount: summary.identities.recents.length,
    });
    summary.layouts.push(infinite);
    const recentToggle = page
      .locator('[data-sidebar-section="chats"] button[aria-controls]')
      .first();
    await recentToggle.focus();
    await recentToggle.press("Alt+ArrowUp");
    await reloadSidebar(page);
    await page.getByTestId("app-sidebar-load-more").click();
    await waitForPageCondition(
      page,
      OPTIONS,
      () =>
        document.querySelectorAll(
          '[data-testid="app-sidebar-recent-conversations"] [data-testid="app-sidebar-conversation-open"]',
        ).length === 14,
      "button pagination did not expand canonical Recents",
    );
    await reloadSidebar(page);
    summary.pagination = {
      lastSectionInfiniteScroll: true,
      middleSectionButton: true,
      initialButtonBudget: 10,
      explicitExpansionCount: 14,
    };
    const initial = await page.evaluate(collectSidebarLayoutDom);
    assertSidebarLayout(initial);
    const recentIds = new Set(
      summary.identities.recents.map((thread) => thread.sessionId),
    );
    assert.ok(
      initial.recentSessionIds.every((id) => recentIds.has(id)),
      "Recents consists only of standalone canonical threads",
    );
    for (const thread of [summary.identities.pinned, summary.identities.custom])
      assert.equal(
        await page
          .locator(
            `[data-testid="app-sidebar-conversation-open"][data-session-id="${thread.sessionId}"]`,
          )
          .count(),
        1,
        "section canonical identity visible outside Recents budget",
      );
    summary.preferences = await verifySectionPreferences(page);
    summary.hoverActions = await verifyHoverActions(page);
    stage("responsive-light-dark-screenshots");
    for (const theme of ["light", "dark"]) {
      await page.getByTestId("app-sidebar-appearance").click();
      await page
        .getByTestId("app-sidebar-appearance-popover")
        .locator("button")
        .filter({ hasText: theme === "light" ? "浅色" : "深色" })
        .first()
        .click();
      await page.getByTestId("app-sidebar-appearance").click();
      await waitForPageCondition(
        page,
        OPTIONS,
        (theme) =>
          document.documentElement.dataset.limeThemeEffective === theme,
        "theme selection did not apply",
        theme,
      );
      for (const width of widths) {
        const nativeContentSize = await resizeOwnedWindow(handle, width, 720);
        await waitWidth(page, 290);
        const layout = await page.evaluate(collectSidebarLayoutDom);
        assertSidebarLayout(layout);
        assert.equal(layout.theme, theme);
        summary.layouts.push({ ...layout, nativeContentSize });
        const filename = `${theme}-${width}-expanded.png`;
        await page.screenshot({
          path: path.join(options.evidenceDir, filename),
        });
        summary.screenshots.push(filename);
      }
      stage(`${theme}-rail-and-profile-menu`);
      await page.getByTestId("app-sidebar-collapse").click();
      await waitWidth(page, 52);
      const collapsed = await page.evaluate(collectSidebarLayoutDom);
      assertSidebarLayout(collapsed, { collapsed: true });
      summary.layouts.push(collapsed);
      await page.getByTestId("app-sidebar-account-button").click();
      await page
        .getByTestId("app-sidebar-account-menu")
        .waitFor({ state: "visible" });
      const menu = await page.evaluate(collectSidebarLayoutDom);
      assertSidebarMenu(menu);
      summary.layouts.push(menu);
      const filename = `${theme}-1440-rail-profile-menu.png`;
      await page.screenshot({ path: path.join(options.evidenceDir, filename) });
      summary.screenshots.push(filename);
      summary.profileHelp ??= {};
      summary.profileHelp[theme] = await verifyProfileHelp(
        page,
        options.evidenceDir,
        theme,
        summary.screenshots,
      );
      await page
        .getByTestId("app-sidebar-account-menu")
        .getByRole("menuitem")
        .filter({ hasText: /设置|Settings/ })
        .click();
      await page
        .getByTestId("settings-navigation")
        .waitFor({ state: "visible" });
      summary.profileSettingsNavigation = true;
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+/" : "Control+/",
      );
      const settingsShortcuts = page.getByRole("dialog", {
        name: "键盘快捷键",
      });
      await settingsShortcuts.waitFor({ state: "visible" });
      assert.equal(
        await settingsShortcuts
          .locator('[data-command-id="showKeyboardShortcuts"]')
          .count(),
        1,
        "AppShell keeps the shortcuts command registered in Settings",
      );
      await page.keyboard.press("Escape");
      await settingsShortcuts.waitFor({ state: "hidden" });
      summary.profileHelp[theme].availableInSettings = true;
      await page.getByTestId("settings-back-button").click();
      await page.getByTestId("app-sidebar-rail-home").click();
      await waitWidth(page, 290);
    }
    stage("verify-canonical-readback-and-ipc");
    const reread = await typedRpc(
      page,
      client.listThreads({ limit: 100 }),
      summary.rpcReceipts,
    );
    const seededThreads = [
      ...summary.identities.projectThreads,
      ...summary.identities.recents,
      summary.identities.pinned,
      summary.identities.custom,
    ];
    assert.ok(
      seededThreads.every((thread) =>
        reread.data.some((item) => item.id === thread.threadId),
      ),
      "display preferences must preserve canonical membership",
    );
    summary.canonicalReadback = {
      seededCount: seededThreads.length,
      listedCount: reread.data.length,
      allSeededIdentitiesPreserved: true,
    };
    const trace = await page.evaluate(() =>
      window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
    );
    const rendererRequests = parseJsonRpcRequestsFromInvokeTrace(trace);
    summary.rendererMethods = [
      ...new Set(
        rendererRequests
          .filter(
            (entry) =>
              entry.transport === "electron-ipc" && entry.status === "success",
          )
          .map((entry) => entry.method),
      ),
    ];
    const errors = await page.evaluate(() => {
      const parse = (key) =>
        JSON.parse(window.localStorage.getItem(key) || "[]");
      const trace = parse("lime_invoke_trace_buffer_v1");
      return {
        invokeErrors: parse("lime_invoke_error_buffer_v1").length,
        failedTraceEntries: trace.filter((entry) => entry.status === "error")
          .length,
        mockFallbackHitCount: trace.filter(
          (entry) => entry.transport !== "electron-ipc",
        ).length,
      };
    });
    summary.errors = {
      ...errors,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
    };
    assertSidebarBridge(summary);
    assert.deepEqual(summary.errors, {
      invokeErrors: 0,
      failedTraceEntries: 0,
      mockFallbackHitCount: 0,
      consoleErrorCount: 0,
      pageErrorCount: 0,
    });
    summary.buildAfter = requireFresh();
    assert.deepEqual(
      fingerprintSources(rootDir),
      summary.sourceSha256,
      "source changed during fixture",
    );
    assert.deepEqual(
      fingerprintArtifacts(rootDir),
      summary.artifactsBefore,
      "artifacts changed during fixture",
    );
    summary.sourceAndArtifactIdentityStable = true;
  } catch (error) {
    failure = error;
    summary.failure = {
      stage: summary.stage,
      name: error.name,
      messageSha256: sha256(String(error.message)),
    };
    if (handle?.page) {
      summary.failureLayout = await handle.page
        .evaluate(collectSidebarLayoutDom)
        .catch(() => null);
      await handle.page
        .screenshot({
          path: path.join(options.evidenceDir, "failure.png"),
          timeout: 5_000,
        })
        .then(() => summary.screenshots.push("failure.png"))
        .catch(() => undefined);
    }
    console.error(
      `${PREFIX} failed stage=${summary.stage}: ${String(error.message).replace(/\/(?:Users|private|tmp)\/[^\s:]+/g, "[local-path]")}`,
    );
  } finally {
    summary.keyboardEvents = await handle?.page
      ?.evaluate(() => window.__sidebarKeyboardEvents ?? [])
      .catch(() => []);
    const teardown = await settleFixtureResources({
      app: handle?.app,
      mainExit,
      timeoutMs: 15_000,
      cleanupTemp: () =>
        fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true }),
    });
    summary.teardown = teardown;
    summary.normalMainExit = teardown.normalMainExit;
    summary.consoleErrorHashes = consoleErrors.map(sha256);
    summary.pageErrorHashes = pageErrors.map(sha256);
    summary.completedAt = new Date().toISOString();
    summary.ok =
      !failure &&
      teardown.ok &&
      teardown.normalMainExit?.exitCode === 0 &&
      teardown.normalMainExit?.signal === null;
    summary.result = summary.ok ? "pass" : "fail";
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`${PREFIX} summary=${summaryPath} result=${summary.result}`);
  }
  if (!summary.ok)
    throw failure ?? new Error("sidebar fixture normal shutdown failed");
  return summary;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href)
  runSidebarLayout().catch(() => {
    process.exitCode = 1;
  });
