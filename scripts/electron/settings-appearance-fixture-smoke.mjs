#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { writeJsonFile } from "../mcp/lib/current-smoke-transport.mjs";
import {
  closeElectronFixture,
  createTempRuntimeEnv,
  launchElectronFixture,
  openSettings,
  parseInvokeTraceRaw,
  sanitizeText,
  waitForPageCondition,
} from "./mcp-config-fixture-smoke.mjs";
import {
  applyFailedSettingsAppearanceEvidence,
  applyPassingSettingsAppearanceEvidence,
  createSettingsAppearanceEvidence,
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./lib/settings-appearance-fixture-evidence.mjs";

const DEFAULTS = {
  runId: process.env.LIME_GATE_RUN_ID?.trim() || null,
  evidenceDir: null,
  prefix: "settings-appearance-fixture",
  timeoutMs: 120_000,
  intervalMs: 250,
  keepTemp: false,
};
const THEME_LABELS = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};
const BEHAVIOR_ARIA = "插件";

function printHelp() {
  console.log(`
Settings Appearance Electron Fixture

Usage:
  node scripts/electron/settings-appearance-fixture-smoke.mjs --run-id <id>

Options:
  --run-id <id> --evidence-dir <path> --prefix <name>
  --timeout-ms <ms> --interval-ms <ms> --keep-temp -h|--help
`);
}

async function openAppearanceSettings(page, options) {
  await openSettings(page, options);
  await page.evaluate(() => {
    window.localStorage.setItem(
      "lime.app-config.changed-at",
      `settings-appearance-fixture-${Date.now()}`,
    );
  });
  await page.locator('[data-testid="settings-sidebar-tab-appearance"]').click();
}

async function openGeneralSettings(page) {
  await page.locator('[data-testid="settings-sidebar-tab-general"]').click();
}

async function readAppearanceState(
  page,
  options,
  { expectedTheme = null, expectedBehavior = null, requireSave = false } = {},
) {
  await openGeneralSettings(page);
  const general = await waitForPageCondition(
    page,
    options,
    ({ behaviorAria, expectedBehavior }) => {
      const toggle = document.querySelector(
        `[role="switch"][aria-label="${behaviorAria}"]`,
      );
      if (!(toggle instanceof HTMLButtonElement) || toggle.disabled)
        return null;
      const behavior = toggle.getAttribute("aria-checked") === "true";
      if (
        typeof expectedBehavior === "boolean" &&
        behavior !== expectedBehavior
      )
        return null;
      return { behavior };
    },
    "General settings plugin preference did not reach the expected persisted state",
    { behaviorAria: BEHAVIOR_ARIA, expectedBehavior },
  );
  await page.locator('[data-testid="settings-sidebar-tab-appearance"]').click();
  return await waitForPageCondition(
    page,
    options,
    ({ expectedTheme, requireSave, behavior }) => {
      const active =
        document
          .querySelector('[data-testid="settings-sidebar-tab-appearance"]')
          ?.getAttribute("data-active") === "true";
      const theme =
        window.localStorage.getItem("theme") ||
        document.documentElement.dataset.limeTheme ||
        "system";
      const ready =
        document.querySelectorAll('[role="radiogroup"] [role="radio"]')
          .length === 3;
      const loadingVisible =
        document.querySelectorAll(".animate-pulse").length > 0;
      const errorVisible =
        document.querySelector(
          '[data-testid="settings-content"] [role="alert"]',
        ) !== null;
      const traceRaw = window.localStorage.getItem(
        "lime_invoke_trace_buffer_v1",
      );
      let methods = [];
      try {
        methods = JSON.parse(traceRaw || "[]")
          .filter(
            (entry) =>
              entry?.command === "app_server_handle_json_lines" &&
              entry.transport === "electron-ipc",
          )
          .flatMap((entry) =>
            (entry.args_preview?.request?.lines || []).flatMap((line) => {
              try {
                const request = JSON.parse(line);
                return typeof request.method === "string"
                  ? [request.method]
                  : [];
              } catch {
                return [];
              }
            }),
          );
      } catch {
        return null;
      }
      if (
        !active ||
        !ready ||
        loadingVisible ||
        errorVisible ||
        !methods.includes("config/read") ||
        (requireSave && !methods.includes("config/batchWrite")) ||
        (expectedTheme && theme !== expectedTheme)
      )
        return null;
      return {
        appearanceTabActive: true,
        themeControlReady: true,
        behaviorControlReady: true,
        theme,
        behavior,
        loadingVisible,
        errorVisible,
        traceRaw,
        errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
      };
    },
    "Appearance theme and General plugin preference did not reach the required state",
    { expectedTheme, requireSave, behavior: general.behavior },
  );
}

async function selectTheme(page, theme) {
  await page
    .getByRole("radio", { name: THEME_LABELS[theme], exact: true })
    .click();
}

async function toggleBehavior(page) {
  await openGeneralSettings(page);
  await page.getByRole("switch", { name: BEHAVIOR_ARIA, exact: true }).click();
}

async function run() {
  const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
    defaults: DEFAULTS,
  });
  if (options.help) {
    printHelp();
    return;
  }
  fs.mkdirSync(options.evidenceDir, { recursive: true });
  const file = (suffix) =>
    path.join(options.evidenceDir, `${options.prefix}${suffix}`);
  const summaryPath = file("-summary.json");
  const rawEvidencePath = file("-raw.json");
  const savedScreenshotPath = file("-saved.png");
  const behaviorScreenshotPath = file("-behavior.png");
  const restartScreenshotPath = file("-restart.png");
  const restoredScreenshotPath = file("-restored.png");
  const failureScreenshotPath = file("-failure.png");
  const runtimeEnv = createTempRuntimeEnv();
  const appServerBinary = resolveDevAppServerBinary({
    env: runtimeEnv.env,
    repoRoot: process.cwd(),
    forceBuild: false,
  });
  const appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtimeEnv.env, APP_SERVER_BIN: appServerBinary },
  });
  const summary = createSettingsAppearanceEvidence({
    candidateRunId: options.runId,
    startedAt: new Date().toISOString(),
    prefix: options.prefix,
  });
  let handle = null;
  let page = null;
  const consoleErrors = [];
  const pageErrors = [];
  const traceRaws = [];
  const errorRaws = [];
  const rendererSnapshots = [];
  let visualMeasurements = null;
  const capture = async (screenshotPath) => {
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      animations: "disabled",
    });
  };
  try {
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openAppearanceSettings(page, options);
    const initialState = await readAppearanceState(page, options);
    const originalTheme = initialState.theme;
    const originalBehavior = initialState.behavior;
    const changedTheme = originalTheme === "light" ? "dark" : "light";
    const changedBehavior = !originalBehavior;
    await selectTheme(page, changedTheme);
    await toggleBehavior(page);
    const savedState = await readAppearanceState(page, options, {
      expectedTheme: changedTheme,
      expectedBehavior: changedBehavior,
      requireSave: true,
    });
    traceRaws.push(savedState.traceRaw);
    errorRaws.push(savedState.errorRaw);
    await openGeneralSettings(page);
    await capture(behaviorScreenshotPath);
    await page
      .locator('[data-testid="settings-sidebar-tab-appearance"]')
      .click();
    await page
      .getByRole("radiogroup", { name: "主题模式", exact: true })
      .scrollIntoViewIfNeeded();
    await capture(savedScreenshotPath);
    await closeElectronFixture(handle);
    handle = null;
    page = null;

    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openAppearanceSettings(page, options);
    const restartState = await readAppearanceState(page, options, {
      expectedTheme: changedTheme,
      expectedBehavior: changedBehavior,
    });
    await capture(restartScreenshotPath);
    await selectTheme(page, originalTheme);
    await toggleBehavior(page);
    const restoredSaveState = await readAppearanceState(page, options, {
      expectedTheme: originalTheme,
      expectedBehavior: originalBehavior,
      requireSave: true,
    });
    traceRaws.push(restartState.traceRaw, restoredSaveState.traceRaw);
    errorRaws.push(restartState.errorRaw, restoredSaveState.errorRaw);
    await closeElectronFixture(handle);
    handle = null;
    page = null;

    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    rendererSnapshots.push(handle.rendererSnapshot);
    page = handle.page;
    await openAppearanceSettings(page, options);
    const finalState = await readAppearanceState(page, options, {
      expectedTheme: originalTheme,
      expectedBehavior: originalBehavior,
    });
    traceRaws.push(finalState.traceRaw);
    errorRaws.push(finalState.errorRaw);
    await capture(restoredScreenshotPath);
    const measure = () =>
      page.evaluate(() => {
        const box = (selector) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            fontWeight: style.fontWeight,
            color: style.color,
            background: style.backgroundColor,
            disabled: "disabled" in node ? node.disabled : undefined,
          };
        };
        return {
          viewport: { width: innerWidth, height: innerHeight },
          navigation: box('[data-testid="settings-navigation"]'),
          rail: box('[data-testid="app-sidebar-rail"]'),
          heading: box('[data-testid="settings-content"] h1'),
          label: box('[data-testid="settings-content"] .settings-row-label'),
          description: box(
            '[data-testid="settings-content"] .settings-row-description',
          ),
          switch: box('[data-testid="settings-content"] [role="switch"]'),
          fileTarget: box(
            '[data-settings-search-target="general-file-target"] select',
          ),
          themeRow: box('[data-settings-search-target="appearance-theme"]'),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          activeNavigationCount: document.querySelectorAll(
            '[data-testid="settings-sidebar"] [aria-current="page"]',
          ).length,
        };
      });
    visualMeasurements = {};
    for (const mode of ["light", "dark"]) {
      await selectTheme(page, mode);
      await capture(file(`-appearance-${mode}.png`));
      visualMeasurements[`appearance-${mode}`] = await measure();
      await openGeneralSettings(page);
      await page
        .getByRole("switch", { name: BEHAVIOR_ARIA, exact: true })
        .waitFor({ state: "visible" });
      await waitForPageCondition(
        page,
        options,
        () => {
          const select = document.querySelector(
            '[data-settings-search-target="general-file-target"] select',
          );
          return select instanceof HTMLSelectElement && !select.disabled;
        },
        "General file target discovery did not expose a usable shell target",
      );
      await capture(file(`-general-${mode}.png`));
      visualMeasurements[`general-${mode}`] = await measure();
      await page
        .locator('[data-testid="settings-sidebar-tab-appearance"]')
        .click();
      await page
        .getByRole("radio", { name: THEME_LABELS[mode], exact: true })
        .waitFor({ state: "visible" });
    }
    await page.setViewportSize({ width: 900, height: 1000 });
    await capture(file("-appearance-narrow.png"));
    visualMeasurements.narrow = await measure();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await selectTheme(page, originalTheme);
    const keyboardMenuChecks = {
      keyboardMenuFourOptions: false,
      keyboardMenuSingleSelection: false,
      keyboardMenuEscapeCloses: false,
      keyboardMenuRestoresFocus: false,
    };
    for (const tab of [
      "archived-conversations",
      "keyboard-shortcuts",
      "memory",
    ]) {
      await page.getByTestId(`settings-sidebar-tab-${tab}`).click();
      await page
        .locator('[data-testid="settings-content"] h1')
        .waitFor({ state: "visible" });
      await capture(file(`-${tab}.png`));
      visualMeasurements[tab] = await measure();
      if (tab === "keyboard-shortcuts") {
        const trigger = page.locator("#keyboard-external-browser-link button");
        await trigger.press("ArrowDown");
        const menuItems = page.getByRole("menuitemradio");
        await menuItems.first().waitFor({ state: "visible" });
        keyboardMenuChecks.keyboardMenuFourOptions =
          (await menuItems.count()) === 4;
        keyboardMenuChecks.keyboardMenuSingleSelection =
          (await page.getByRole("menuitemradio", { checked: true }).count()) ===
          1;
        await capture(file("-keyboard-shortcuts-menu.png"));
        await page.keyboard.press("Escape");
        await page.getByRole("menu").waitFor({ state: "hidden" });
        keyboardMenuChecks.keyboardMenuEscapeCloses = true;
        keyboardMenuChecks.keyboardMenuRestoresFocus =
          await waitForPageCondition(
            page,
            options,
            () =>
              document.activeElement ===
              document.querySelector("#keyboard-external-browser-link button"),
            "Keyboard preference menu did not restore focus after Escape",
          );
      }
    }
    await page.getByTestId("settings-sidebar-tab-appearance").click();
    await readAppearanceState(page, options, {
      expectedTheme: originalTheme,
      expectedBehavior: originalBehavior,
    });
    const generalVisual = visualMeasurements["general-light"];
    const visualChecks = {
      globalRail52px: generalVisual.rail?.width === 52,
      contextualPanelShares290px:
        generalVisual.rail?.width + generalVisual.navigation?.width === 290,
      title28px: generalVisual.heading?.fontSize === "28px",
      fileTargetReady: generalVisual.fileTarget?.disabled === false,
      label13px: generalVisual.label?.fontSize === "13px",
      description12px: generalVisual.description?.fontSize === "12px",
      switch32x20px:
        generalVisual.switch?.width === 32 &&
        generalVisual.switch?.height === 20,
      titleBelowWindowHeader: generalVisual.heading?.y >= 124,
      noHorizontalOverflow: Object.values(visualMeasurements).every(
        (measurement) => measurement.horizontalOverflow === false,
      ),
      singleActiveNavigation: Object.values(visualMeasurements).every(
        (measurement) => measurement.activeNavigationCount === 1,
      ),
      ...keyboardMenuChecks,
    };
    if (!Object.values(visualChecks).every(Boolean))
      throw new Error(
        `Settings visual measurements failed: ${Object.entries(visualChecks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name)
          .join(", ")}`,
      );
    const trace = summarizeSettingsAppearanceTrace(traceRaws);
    applyPassingSettingsAppearanceEvidence(summary, {
      completedAt: new Date().toISOString(),
      electronLaunchCount: rendererSnapshots.filter(
        (snapshot) => snapshot.electron,
      ).length,
      preloadLaunchCount: rendererSnapshots.filter(
        (snapshot) => snapshot.hasInvokeBridge,
      ).length,
      isolatedUserData: runtimeEnv.electronUserDataDir.startsWith(
        runtimeEnv.tempRoot,
      ),
      appearanceTabActive: finalState.appearanceTabActive,
      themeControlReady: finalState.themeControlReady,
      behaviorControlReady: finalState.behaviorControlReady,
      themeChanged: changedTheme !== originalTheme,
      behaviorChanged: changedBehavior !== originalBehavior,
      restartThemeReadback: restartState.theme === changedTheme,
      restartBehaviorReadback: restartState.behavior === changedBehavior,
      restorationSaved:
        restoredSaveState.theme === originalTheme &&
        restoredSaveState.behavior === originalBehavior,
      restorationThemeReadback: finalState.theme === originalTheme,
      restorationBehaviorReadback: finalState.behavior === originalBehavior,
      loadingVisible: finalState.loadingVisible,
      errorVisible: finalState.errorVisible,
      trace,
      consoleErrors,
      pageErrors,
      invokeErrorCount: errorRaws.reduce(
        (count, raw) => count + parseInvokeTraceRaw(raw).length,
        0,
      ),
      savedScreenshotWritten: fs.existsSync(savedScreenshotPath),
      behaviorScreenshotWritten: fs.existsSync(behaviorScreenshotPath),
      restartScreenshotWritten: fs.existsSync(restartScreenshotPath),
      restoredScreenshotWritten: fs.existsSync(restoredScreenshotPath),
    });
    writeJsonFile(rawEvidencePath, {
      behaviorPreference: "plugins._default.enabled",
      lifecycle: {
        isolatedUserData: true,
        themeChanged: true,
        behaviorChanged: true,
        restartThemeReadback: true,
        restartBehaviorReadback: true,
        restorationSaved: true,
        restorationThemeReadback: true,
        restorationBehaviorReadback: true,
      },
      appServerMethods: trace.methods,
      hostCommands: trace.hostCommands,
    });
    summary.behaviorPreference = "plugins._default.enabled";
    summary.visualMeasurements = visualMeasurements;
    summary.visualAssertions = visualChecks;
    summary.assertions.total += Object.keys(visualChecks).length;
    summary.assertions.passed += Object.keys(visualChecks).length;
    writeJsonFile(summaryPath, summary);
    console.log(`[smoke:settings-appearance-fixture] summary=${summaryPath}`);
  } catch (error) {
    applyFailedSettingsAppearanceEvidence(summary, error);
    summary.consoleErrors = consoleErrors.map(sanitizeText);
    summary.pageErrors = pageErrors.map(sanitizeText);
    summary.failureTrace = summarizeSettingsAppearanceTrace(traceRaws);
    writeJsonFile(summaryPath, summary);
    if (page) {
      await page
        .screenshot({ path: failureScreenshotPath, fullPage: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (handle) await closeElectronFixture(handle);
    if (!options.keepTemp) {
      fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  console.error(
    `[smoke:settings-appearance-fixture] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
