import fs from "node:fs";
import path from "node:path";
import {
  ensureElectronFixtureBuild,
  inspectElectronFixtureBuildFreshness,
} from "../../lib/electron-fixture-build.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../../lib/electron-app-server-assets.mjs";
import {
  launchElectronFixture,
  closeElectronFixture,
  createTempRuntimeEnv,
  openSettings,
  readConfigFromPage,
  parseInvokeTraceRaw,
} from "../mcp-config-fixture-smoke.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    runId: null,
    evidenceDir: null,
    prefix: "settings-voice",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
if (options.help) {
  console.log(
    "node scripts/electron/lib/settings-voice-fixture.mjs --evidence-dir <path> [--keep-temp]",
  );
  process.exit(0);
}
const directory = options.evidenceDir;
fs.mkdirSync(directory, { recursive: true });
const summary = {
  scenario: "voice-microphone-persistence",
  result: "fail",
  startedAt: new Date().toISOString(),
  evidenceLayer:
    "Desktop settings with real Electron, preload IPC and App Server config owner; controlled MediaDevices only",
  physicalMicrophone: false,
  liveProvider: false,
  assertions: {},
  measurements: {},
  launches: [],
};
let handle;
let runtime;
const consoleErrors = [];
const pageErrors = [];
const traces = [];
const invokeErrors = [];
function check(name, passed) {
  summary.assertions[name] = Boolean(passed);
  if (!passed) throw new Error(name);
}
async function launch() {
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv: runtime.appServerEnv,
    consoleErrors,
    pageErrors,
  });
  summary.launches.push(handle.rendererSnapshot);
  const page = handle.page;
  // 可控设备仅用于本机媒体 UI；配置读写仍经过真实 preload / App Server。
  await page.evaluate(() => {
    const state = {
      entries: [
        {
          kind: "audioinput",
          deviceId: "fixture-usb",
          label: "USB microphone",
        },
      ],
      permissions: 0,
      stopped: 0,
    };
    const media = new EventTarget();
    media.enumerateDevices = async () => state.entries;
    media.getUserMedia = async () => {
      state.permissions += 1;
      return {
        getTracks: () =>
          [1, 2].map(() => ({
            stop() {
              state.stopped += 1;
            },
          })),
      };
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: media,
    });
    window.__voiceFixture = state;
  });
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await page
    .locator("#voice-microphone button[aria-haspopup=menu]:enabled")
    .waitFor();
  return page;
}
async function capture(name) {
  await handle.page.mouse.move(0, 0);
  await handle.page.screenshot({
    path: path.join(directory, `${name}.png`),
    animations: "disabled",
    fullPage: true,
  });
}
async function finishLaunch() {
  const state = await handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
  traces.push(state.trace);
  invokeErrors.push(state.errors);
  await closeElectronFixture(handle);
  handle = null;
}
async function selectMicrophone(page, name) {
  await page
    .locator("#voice-microphone button[aria-haspopup=menu]")
    .press("ArrowDown");
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await page
    .locator("#voice-microphone button[aria-haspopup=menu]:enabled", {
      hasText: name,
    })
    .waitFor();
}
async function readDevice(page) {
  const snapshot = await readConfigFromPage(page);
  return snapshot.config.experimental?.voice_input?.selected_device_id ?? null;
}
async function measure(page) {
  return await page.evaluate(() => {
    const content = document.querySelector('[data-testid="settings-content"]');
    const style = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        fontSize: s.fontSize,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      };
    };
    return {
      title: style('[data-testid="settings-content"] h1'),
      label: style("#voice-microphone-label"),
      description: style("#voice-microphone-description"),
      toggle: style('[data-testid="settings-content"] [role="switch"]'),
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
      groupRadius: getComputedStyle(
        document.querySelector("#voice-microphone").parentElement,
      ).borderRadius,
    };
  });
}
try {
  ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-voice-fixture",
  });
  runtime = createTempRuntimeEnv();
  runtime.appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: runtime.env,
    repoRoot: process.cwd(),
  });
  let page = await launch();
  check(
    "passiveEnumerationDoesNotRequestPermission",
    await page.evaluate(() => window.__voiceFixture.permissions === 0),
  );
  check(
    "isolatedConfigStartsAtSystemDefault",
    (await readDevice(page)) === null,
  );
  const search = page.getByTestId("settings-sidebar-search");
  await search.fill("麦克风");
  await page.getByRole("option").filter({ hasText: "麦克风" }).click();
  await page.waitForFunction(() => {
    const row = document.getElementById("voice-microphone");
    return (
      row === document.activeElement || row?.contains(document.activeElement)
    );
  });
  check("microphoneSearchFocusesCurrentField", true);
  await search.fill("");
  await page
    .locator('[data-testid="settings-content"]')
    .evaluate((el) => el.scrollTo({ top: 0, behavior: "instant" }));
  summary.measurements.light = await measure(page);
  await capture("voice-light");
  const refresh = page.getByRole("button", {
    name: "允许麦克风访问并刷新设备",
    exact: true,
  });
  await refresh.click();
  await refresh.and(page.locator(":enabled")).waitFor();
  check(
    "explicitRefreshStopsAllTracks",
    await page.evaluate(
      () =>
        window.__voiceFixture.permissions === 1 &&
        window.__voiceFixture.stopped === 2,
    ),
  );
  await page
    .locator("#voice-microphone button[aria-haspopup=menu]")
    .press("ArrowDown");
  await page.getByRole("menuitemradio").first().waitFor();
  check(
    "menuSingleSelection",
    (await page.getByRole("menuitemradio", { checked: true }).count()) === 1,
  );
  await capture("voice-microphone-menu");
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden" });
  check(
    "escapeRestoresFocus",
    await page
      .locator("#voice-microphone button[aria-haspopup=menu]")
      .evaluate((el) => el === document.activeElement),
  );
  await selectMicrophone(page, "USB microphone");
  check("deviceSavedThroughConfig", (await readDevice(page)) === "fixture-usb");
  await finishLaunch();

  page = await launch();
  check("coldRestartReadback", (await readDevice(page)) === "fixture-usb");
  check(
    "coldRestartControlReadback",
    (
      await page
        .locator("#voice-microphone button[aria-haspopup=menu]")
        .innerText()
    ).includes("USB microphone"),
  );
  await page.evaluate(() => {
    window.__voiceFixture.entries = [
      { kind: "audioinput", deviceId: "other", label: "Other microphone" },
    ];
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await page
    .locator("#voice-microphone button[aria-haspopup=menu]:enabled", {
      hasText: "麦克风不可用",
    })
    .waitFor();
  check(
    "disconnectedDeviceRemainsSelected",
    (await readDevice(page)) === "fixture-usb",
  );
  await capture("voice-unavailable");
  await selectMicrophone(page, "系统默认");
  check("systemDefaultClearsDeviceOverride", (await readDevice(page)) === null);
  await page.getByTestId("settings-sidebar-tab-appearance").click();
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await page
    .locator("#voice-microphone button[aria-haspopup=menu]:enabled")
    .waitFor();
  summary.measurements.dark = await measure(page);
  await capture("voice-dark");
  await page.setViewportSize({ width: 900, height: 760 });
  summary.measurements.narrow = await measure(page);
  await capture("voice-narrow");
  await finishLaunch();

  page = await launch();
  check("coldRestartRestoredDefault", (await readDevice(page)) === null);
  await finishLaunch();
  const m = summary.measurements.light;
  check("title28px", m.title.fontSize === "28px");
  check("label13px", m.label.fontSize === "13px");
  check("description12px", m.description.fontSize === "12px");
  check("switch32x20px", m.toggle.width === 32 && m.toggle.height === 20);
  check("groups16px", m.groupRadius === "16px");
  check(
    "noHorizontalOverflow",
    Object.values(summary.measurements).every((m) => !m.horizontalOverflow),
  );
  check(
    "threeRealElectronPreloadLaunches",
    summary.launches.length === 3 &&
      summary.launches.every(
        (l) => l.electron && l.hasInvokeBridge && l.supportsAppServer,
      ),
  );
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "realConfigReadAndWrite",
    summary.trace.appServerIpcHitCount > 0 &&
      summary.trace.missingConfigMethods.length === 0,
  );
  check("noProductionMockFallback", summary.trace.mockFallbackHitCount === 0);
  const commands = traces
    .flatMap((raw) => parseInvokeTraceRaw(raw))
    .map((e) => e.command);
  check(
    "noRetiredRecordingCommands",
    !commands.some((c) =>
      /^(start_recording|stop_recording|cancel_recording|register_voice_shortcut|update_voice_shortcut)$/.test(
        c,
      ),
    ),
  );
  check(
    "noInvokeErrors",
    invokeErrors.flatMap((raw) => parseInvokeTraceRaw(raw)).length === 0,
  );
  check("noPageErrors", pageErrors.length === 0);
  check("noConsoleErrors", consoleErrors.length === 0);
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("finalBuildFreshness", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
  if (handle) await capture("voice-failure").catch(() => undefined);
} finally {
  if (handle) await closeElectronFixture(handle);
  summary.completedAt = new Date().toISOString();
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  summary.assertionCounts = {
    total: Object.keys(summary.assertions).length,
    passed: Object.values(summary.assertions).filter(Boolean).length,
  };
  summary.runtimePath = runtime?.tempRoot;
  fs.writeFileSync(
    path.join(directory, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  // 保留隔离目录供失败诊断；不触碰用户配置或清理他人构建产物。
  console.log(
    JSON.stringify(
      {
        result: summary.result,
        assertions: summary.assertionCounts,
        evidence: directory,
        failure: summary.failure,
      },
      null,
      2,
    ),
  );
}
