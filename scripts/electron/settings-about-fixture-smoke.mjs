#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import {
  ensureElectronFixtureBuild,
  inspectElectronFixtureBuildFreshness,
} from "../lib/electron-fixture-build.mjs";
import { artifactFingerprints } from "./lib/settings-navigation-fixture-identity.mjs";
import { captureMainProcessExit } from "./lib/persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../agent-runtime/claw-chat-current-fixture-teardown.mjs";

import {
  electronAppServerBinaryDestination,
  resolveElectronAppServerRuntimeEnv,
} from "../lib/electron-app-server-assets.mjs";
import { writeJsonFile } from "../mcp/lib/current-smoke-transport.mjs";
import {
  createTempRuntimeEnv,
  launchElectronFixture,
  openSettings,
  parseInvokeTraceRaw,
  sanitizeText,
  waitForPageCondition,
} from "./mcp-config-fixture-smoke.mjs";
import {
  applyFailedSettingsAboutEvidence,
  applyFailedSettingsHomeEvidence,
  applyPassingSettingsAboutEvidence,
  applyPassingSettingsHomeEvidence,
  createSettingsAboutEvidence,
  createSettingsHomeEvidence,
  isLocalizedAboutVersionLine,
  parseSettingsAboutFixtureArgs,
  summarizeSettingsAboutTrace,
} from "./lib/settings-about-fixture-evidence.mjs";

const sourceFiles = [
  "src/components/settings-v2/system/about/index.tsx",
  "src/components/settings-v2/SettingsPrimitives.tsx",
  "src/components/settings-v2/sections.tsx",
  "src/lib/api/appUpdate.ts",
  "scripts/electron/settings-about-fixture-smoke.mjs",
];
const fingerprints = () =>
  sourceFiles.map((file) => ({
    path: file,
    sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  }));

async function verifyAboutAppearance(page, options) {
  const measurements = {};
  for (const mode of ["light", "dark"]) {
    await page.getByTestId("settings-sidebar-tab-appearance").click();
    await page.locator(`[role="radio"]:has([data-mode="${mode}"])`).click();
    await waitForPageCondition(
      page,
      options,
      ({ mode }) =>
        document.documentElement.classList.contains("dark") ===
        (mode === "dark"),
      "Appearance theme was not applied",
      { mode },
    );
    await page.getByTestId("settings-sidebar-tab-about").click();
    await page.getByTestId("settings-about-page").waitFor({ state: "visible" });
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 900 });
      const measurement = await page
        .getByTestId("settings-about-page")
        .evaluate((body) => {
          const heading = body.querySelector("h1");
          const version = body.querySelector(
            '[data-testid="settings-about-version"]',
          );
          const button = body.querySelector("button");
          const group =
            body.querySelector(".settings-row-copy")?.parentElement
              ?.parentElement;
          const tabs = Array.from(
            document.querySelectorAll('[data-testid^="settings-sidebar-tab-"]'),
          );
          const viewportWidth = document.documentElement.clientWidth;
          return {
            titleSize: getComputedStyle(heading).fontSize,
            titleWeight: getComputedStyle(heading).fontWeight,
            bodySize: getComputedStyle(body).fontSize,
            versionSize: getComputedStyle(version).fontSize,
            actionSize: getComputedStyle(button).fontSize,
            groupBackground: getComputedStyle(group).backgroundColor,
            textColor: getComputedStyle(heading).color,
            aboutLast:
              tabs.at(-1)?.getAttribute("data-testid") ===
              "settings-sidebar-tab-about",
            noHorizontalOverflow:
              document.documentElement.scrollWidth <= viewportWidth &&
              body.scrollWidth <= body.clientWidth + 1 &&
              Array.from(body.querySelectorAll("button, a")).every(
                (control) => {
                  const rect = control.getBoundingClientRect();
                  return rect.left >= 0 && rect.right <= viewportWidth + 1;
                },
              ),
          };
        });
      measurements[`${mode}-${width}`] = measurement;
      if (
        measurement.titleSize !== "28px" ||
        measurement.titleWeight !== "500" ||
        measurement.bodySize !== "13px" ||
        measurement.versionSize !== "13px" ||
        measurement.actionSize !== "13px" ||
        !measurement.aboutLast ||
        !measurement.noHorizontalOverflow
      )
        throw new Error(`About appearance failed: ${mode}-${width}`);
      await page.screenshot({
        path: path.join(
          options.evidenceDir,
          `${options.prefix}-${mode}-${width}.png`,
        ),
        animations: "disabled",
      });
    }
  }
  if (
    measurements["light-1440"].groupBackground ===
      measurements["dark-1440"].groupBackground ||
    measurements["light-1440"].textColor === measurements["dark-1440"].textColor
  )
    throw new Error("About page did not follow the selected theme");
  return measurements;
}

const DEFAULTS = {
  runId: process.env.LIME_GATE_RUN_ID?.trim() || null,
  evidenceDir: null,
  prefix: "settings-about-fixture",
  timeoutMs: 120_000,
  intervalMs: 250,
  keepTemp: false,
};

function printHelp() {
  console.log(`
Settings About Electron Fixture

Usage:
  node scripts/electron/settings-about-fixture-smoke.mjs --run-id <id>

Options:
  --run-id <id> --evidence-dir <path> --prefix <name>
  --timeout-ms <ms> --interval-ms <ms> --keep-temp -h|--help
`);
}

async function readAboutState(page, options, expectedVersion) {
  return await waitForPageCondition(
    page,
    options,
    ({ expectedVersion: version }) => {
      const bodyText = document.body?.innerText ?? "";
      const aboutTab = document.querySelector(
        '[data-testid="settings-sidebar-tab-about"]',
      );
      const loadingVisible = Boolean(
        document.querySelector('[data-testid="settings-page-loading"]'),
      );
      const internalDiagnosticVisible =
        /electron-host-diagnostic|Desktop Host current|get_skill_package_file_association_status|尚未接入真实/i.test(
          bodyText,
        );
      const traceRaw = window.localStorage.getItem(
        "lime_invoke_trace_buffer_v1",
      );
      let traceEntries = [];
      try {
        const parsed = JSON.parse(traceRaw || "[]");
        traceEntries = Array.isArray(parsed) ? parsed : [];
      } catch {
        traceEntries = [];
      }
      const appServerIpcSeen = traceEntries.some(
        (entry) =>
          entry?.command === "app_server_handle_json_lines" &&
          entry?.transport === "electron-ipc",
      );
      const hostCommands = new Set(
        traceEntries
          .filter((entry) => entry?.transport === "electron-ipc")
          .map((entry) => entry?.command),
      );
      const hostReadsSeen =
        hostCommands.has("check_for_updates") &&
        hostCommands.has("get_update_install_session");
      if (
        aboutTab?.getAttribute("data-active") !== "true" ||
        loadingVisible ||
        !bodyText.includes(version) ||
        !appServerIpcSeen ||
        !hostReadsSeen
      ) {
        return null;
      }
      const versionLine = bodyText
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.includes(version));
      return {
        url: window.location.href,
        locale: document.documentElement.lang || navigator.language,
        visibleVersion: version,
        versionLine: versionLine ?? null,
        aboutActive: true,
        loadingVisible,
        internalDiagnosticVisible,
        traceRaw,
        errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
      };
    },
    "About page did not reach a terminal version state",
    { expectedVersion },
  );
}

async function readHomeState(page, options) {
  return await waitForPageCondition(
    page,
    options,
    () => {
      const homeStartVisible = Boolean(
        document.querySelector('[data-testid="home-composer-page"]'),
      );
      const accountButtonVisible = Boolean(
        document.querySelector('[data-testid="app-sidebar-account-button"]'),
      );
      const settingsHeaderVisible = Boolean(
        document.querySelector('[data-testid="settings-navigation"]'),
      );
      if (!homeStartVisible || !accountButtonVisible || settingsHeaderVisible) {
        return null;
      }
      return {
        url: window.location.href,
        homeStartVisible,
        accountButtonVisible,
        settingsHeaderVisible,
        traceRaw: window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
        errorRaw: window.localStorage.getItem("lime_invoke_error_buffer_v1"),
      };
    },
    "Settings back-home action did not reach the current home surface",
  );
}

async function run() {
  const options = parseSettingsAboutFixtureArgs(process.argv.slice(2), {
    defaults: DEFAULTS,
  });
  if (options.help) {
    printHelp();
    return;
  }
  fs.mkdirSync(options.evidenceDir, { recursive: true });

  const summaryPath = path.join(
    options.evidenceDir,
    `${options.prefix}-summary.json`,
  );
  const rawEvidencePath = path.join(
    options.evidenceDir,
    `${options.prefix}-raw.json`,
  );
  const screenshotPath = path.join(
    options.evidenceDir,
    `${options.prefix}.png`,
  );
  const failureScreenshotPath = path.join(
    options.evidenceDir,
    `${options.prefix}-failure.png`,
  );
  const homeSummaryPath = path.join(
    options.evidenceDir,
    `${options.prefix}-home-summary.json`,
  );
  const homeScreenshotPath = path.join(
    options.evidenceDir,
    `${options.prefix}-home.png`,
  );
  const packageVersion = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
  ).version;
  const sourceBefore = fingerprints();
  ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-about-fixture",
  });
  const freshnessBefore = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  if (!freshnessBefore.ready) throw new Error("About fixture build is stale");
  const artifactsBefore = artifactFingerprints();
  if (JSON.stringify(sourceBefore) !== JSON.stringify(fingerprints()))
    throw new Error("About sources changed during build");
  const runtimeEnv = createTempRuntimeEnv();
  const appServerBinary = electronAppServerBinaryDestination({
    outputRoot: path.resolve("dist-electron"),
  });
  const appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtimeEnv.env, APP_SERVER_BIN: appServerBinary },
  });
  const summary = {
    ...createSettingsAboutEvidence({
      candidateRunId: options.runId,
      startedAt: new Date().toISOString(),
      prefix: options.prefix,
    }),
    backendMode: "unavailable",
    packageVersion,
    freshnessBefore,
    sourceBefore,
  };
  const homeSummary = createSettingsHomeEvidence({
    candidateRunId: options.runId,
    startedAt: summary.startedAt,
    prefix: options.prefix,
  });

  let handle = null;
  let mainExit = null;
  let page = null;
  const consoleErrors = [];
  const pageErrors = [];
  const rawEvidence = {};
  try {
    handle = await launchElectronFixture({
      options,
      runtimeEnv,
      appServerEnv,
      consoleErrors,
      pageErrors,
    });
    mainExit = captureMainProcessExit(handle.app.process());
    page = handle.page;
    await openSettings(page, options);
    await page.locator('[data-testid="settings-sidebar-tab-about"]').click();
    const aboutState = await readAboutState(page, options, packageVersion);
    const trace = summarizeSettingsAboutTrace(aboutState.traceRaw);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    summary.visualMeasurements = await verifyAboutAppearance(page, options);
    summary.freshnessAfter = inspectElectronFixtureBuildFreshness({
      rootDir: process.cwd(),
    });
    summary.sourceAfter = fingerprints();
    summary.identity = {
      sourceStable:
        JSON.stringify(sourceBefore) === JSON.stringify(summary.sourceAfter),
      artifactsStable:
        JSON.stringify(artifactsBefore) ===
        JSON.stringify(artifactFingerprints()),
    };
    if (
      !summary.freshnessAfter.ready ||
      !summary.identity.sourceStable ||
      !summary.identity.artifactsStable
    )
      throw new Error(
        "About sources or build artifacts changed during verification",
      );

    applyPassingSettingsAboutEvidence(summary, {
      completedAt: new Date().toISOString(),
      electronRenderer: handle.rendererSnapshot.electron,
      preloadInvoke: handle.rendererSnapshot.hasInvokeBridge,
      packageVersion,
      visibleVersion: aboutState.visibleVersion,
      versionLabelLocalized: isLocalizedAboutVersionLine(
        aboutState.locale,
        aboutState.versionLine,
      ),
      aboutActive: aboutState.aboutActive,
      loadingVisible: aboutState.loadingVisible,
      internalDiagnosticVisible: aboutState.internalDiagnosticVisible,
      trace,
      consoleErrors,
      pageErrors,
      invokeErrorCount: parseInvokeTraceRaw(aboutState.errorRaw).length,
      screenshotWritten: fs.existsSync(screenshotPath),
    });
    rawEvidence.about = {
      url: aboutState.url,
      locale: aboutState.locale,
      versionLine: aboutState.versionLine,
      appServerMethods: trace.appServerMethods,
      hostCommands: trace.hostCommands,
    };
    writeJsonFile(summaryPath, summary);

    await page.getByTestId("app-sidebar-rail-home").click();
    const homeState = await readHomeState(page, options);
    const homeTrace = summarizeSettingsAboutTrace(homeState.traceRaw);
    await page.screenshot({ path: homeScreenshotPath, fullPage: true });
    applyPassingSettingsHomeEvidence(homeSummary, {
      completedAt: new Date().toISOString(),
      electronRenderer: handle.rendererSnapshot.electron,
      preloadInvoke: handle.rendererSnapshot.hasInvokeBridge,
      homeStartVisible: homeState.homeStartVisible,
      settingsHeaderVisible: homeState.settingsHeaderVisible,
      accountButtonVisible: homeState.accountButtonVisible,
      trace: homeTrace,
      consoleErrors,
      pageErrors,
      invokeErrorCount: parseInvokeTraceRaw(homeState.errorRaw).length,
      screenshotWritten: fs.existsSync(homeScreenshotPath),
    });
    rawEvidence.home = {
      url: homeState.url,
      appServerMethods: homeTrace.appServerMethods,
    };
    writeJsonFile(rawEvidencePath, rawEvidence);
    writeJsonFile(homeSummaryPath, homeSummary);
    console.log(`[smoke:settings-about-fixture] summary=${summaryPath}`);
    console.log(`[smoke:settings-about-fixture] home=${homeSummaryPath}`);
  } catch (error) {
    if (!summary.settingsScenarioProof.complete) {
      applyFailedSettingsAboutEvidence(summary, error);
    }
    if (!homeSummary.settingsScenarioProof.complete) {
      applyFailedSettingsHomeEvidence(homeSummary, error);
    }
    summary.consoleErrors = consoleErrors.map(sanitizeText);
    summary.pageErrors = pageErrors.map(sanitizeText);
    writeJsonFile(summaryPath, summary);
    writeJsonFile(homeSummaryPath, homeSummary);
    if (page) {
      try {
        await page.screenshot({ path: failureScreenshotPath, fullPage: true });
      } catch {
        // Preserve the original failure.
      }
    }
    throw error;
  } finally {
    if (handle) {
      summary.teardown = await settleFixtureResources({
        app: handle.app,
        mainExit,
      });
      writeJsonFile(summaryPath, summary);
      if (
        !summary.teardown.ok ||
        summary.teardown.forcedCleanup !== null ||
        summary.teardown.normalMainExit?.exitCode !== 0 ||
        summary.teardown.normalMainExit?.signal !== null
      ) {
        const error = new Error("About fixture did not exit normally");
        applyFailedSettingsAboutEvidence(summary, error);
        writeJsonFile(summaryPath, summary);
        throw error;
      }
    }
    if (!options.keepTemp) {
      fs.rmSync(runtimeEnv.tempRoot, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  console.error(
    `[smoke:settings-about-fixture] ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
