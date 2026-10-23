import fs from "node:fs";
import path from "node:path";
import {
  ensureElectronFixtureBuild,
  inspectElectronFixtureBuildFreshness,
} from "../../lib/electron-fixture-build.mjs";
import {
  electronAppServerBinaryDestination,
  resolveElectronAppServerRuntimeEnv,
} from "../../lib/electron-app-server-assets.mjs";
import {
  launchElectronFixture,
  closeElectronFixture,
  createTempRuntimeEnv,
  openSettings,
  readConfigFromPage,
  updateConfigFromPage,
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
    prefix: "settings-sounds",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
if (options.help) {
  console.log(
    "node scripts/electron/lib/settings-sounds-fixture.mjs --evidence-dir <path>",
  );
  process.exit(0);
}
const directory = options.evidenceDir;
fs.mkdirSync(directory, { recursive: true });
const summary = {
  scenario: "dictation-sounds-config-and-audio-output",
  result: "fail",
  startedAt: new Date().toISOString(),
  evidenceLayer:
    "real Electron/preload/App Server/config, native MediaRecorder and Web Audio; controlled synthetic MediaStream input",
  physicalMicrophone: false,
  physicalSpeaker: false,
  liveProvider: false,
  assertions: {},
  measurements: {},
  launches: [],
  audio: [],
  instructionConfig: [],
};
let handle, runtime;
let instructionSnapshot;
const consoleErrors = [],
  pageErrors = [],
  traces = [],
  invokeErrors = [];
function check(name, passed) {
  summary.assertions[name] = Boolean(passed);
  if (!passed) throw new Error(name);
}
const soundSwitch = (page) =>
  page.getByRole("switch", { name: "切换听写提示音", exact: true });
async function openVoice(page) {
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await soundSwitch(page).waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector("#voice-microphone button[aria-haspopup=menu]")
        ?.disabled === false,
  );
}
async function waitSound(page, enabled) {
  await page.waitForFunction(
    (value) =>
      document
        .querySelector("#voice-sounds [role=switch]")
        ?.getAttribute("aria-checked") === String(value),
    enabled,
  );
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    if (
      (await readConfigFromPage(page)).config.experimental.voice_input
        .sound_enabled === enabled
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  throw new Error("sound_enabled did not reach canonical config");
}
async function checkInstructionConfig(page, phase) {
  const voice = (await readConfigFromPage(page)).config.experimental
    .voice_input;
  const snapshot = {
    instructions: voice.instructions,
    defaultId: voice.processor.default_instruction_id,
    translationId: voice.translate_instruction_id,
    cleanupEnabled: voice.processor.polish_enabled,
  };
  const preserved = JSON.stringify(snapshot) === instructionSnapshot;
  summary.instructionConfig.push({ phase, preserved });
  check(`${phase}PreservesInstructionConfig`, preserved);
  check(
    `${phase}HasNoInstructionSelectors`,
    (await page.locator('[data-testid="settings-content"] select').count()) ===
      0,
  );
  check(
    `${phase}HasOnlyDictationSoundsSwitch`,
    await soundSwitch(page).evaluate(
      (toggle) =>
        toggle.closest("section").querySelectorAll('[role="switch"]').length ===
        1,
    ),
  );
}
async function capture(name) {
  await handle.page.mouse.move(0, 0);
  await handle.page.screenshot({
    path: path.join(directory, `${name}.png`),
    animations: "disabled",
  });
}
async function measure(page) {
  return page.evaluate(() => {
    const row = document.getElementById("voice-sounds");
    const toggle = row.querySelector("[role=switch]");
    const content = document.querySelector("[data-testid=settings-content]");
    return {
      label: getComputedStyle(document.getElementById("voice-sounds-label"))
        .fontSize,
      description: getComputedStyle(
        document.getElementById("voice-sounds-description"),
      ).fontSize,
      radius: getComputedStyle(row.parentElement).borderRadius,
      switchWidth: toggle.getBoundingClientRect().width,
      switchHeight: toggle.getBoundingClientRect().height,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
    };
  });
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
  await installMediaObservation(handle.page);
  return handle.page;
}
async function installMediaObservation(page) {
  // Only media input is synthetic. Cue oscillators, output graph and MediaRecorder remain native.
  await page.evaluate(() => {
    const NativeAudioContext = window.AudioContext;
    const state = { cues: [], streamsCreated: 0, streamsReleased: 0 };
    class ObservedAudioContext extends NativeAudioContext {
      createOscillator() {
        const oscillator = super.createOscillator();
        const marker = { started: false, ended: false, closed: false, peak: 0 };
        state.cues.push(marker);
        const start = oscillator.start;
        oscillator.start = function (...args) {
          marker.started = true;
          return Reflect.apply(start, this, args);
        };
        oscillator.addEventListener("ended", () => {
          marker.ended = true;
        });
        const close = this.close.bind(this);
        this.close = () => {
          const result = close();
          void result.then(
            () => {
              marker.closed = this.state === "closed";
            },
            () => undefined,
          );
          return result;
        };
        return oscillator;
      }
      createGain() {
        const gain = super.createGain();
        const analyser = super.createAnalyser();
        analyser.fftSize = 512;
        const mute = super.createGain();
        mute.gain.value = 0;
        gain.connect(analyser);
        analyser.connect(mute);
        mute.connect(this.destination);
        const context = this;
        const sample = () => {
          if (context.state === "closed") return;
          const data = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(data);
          const marker = state.cues.at(-1);
          if (marker)
            marker.peak = Math.max(marker.peak, ...data.map(Math.abs));
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        return gain;
      }
    }
    window.AudioContext = ObservedAudioContext;
    const media = new EventTarget();
    media.enumerateDevices = async () => [];
    media.getUserMedia = async () => {
      const context = new NativeAudioContext();
      const oscillator = context.createOscillator();
      const mute = context.createGain();
      mute.gain.value = 0;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(mute);
      mute.connect(destination);
      oscillator.start();
      await context.resume();
      state.streamsCreated += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        state.streamsReleased += 1;
        oscillator.stop();
        oscillator.disconnect();
        mute.disconnect();
        void context.close();
      };
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop;
        track.stop = function () {
          Reflect.apply(stop, this, []);
          release();
        };
      }
      return destination.stream;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: media,
    });
    window.__dictationSoundFixture = state;
  });
}
async function recordAndCancel(page, enabled) {
  await page.getByTestId("app-sidebar-rail-home").click();
  const toggle = page.getByTestId("inputbar-dictation-toggle");
  const before = await page.evaluate(
    () => window.__dictationSoundFixture.cues.length,
  );
  await toggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector("[data-testid=inputbar-dictation-toggle]")
        ?.getAttribute("aria-pressed") === "true",
  );
  if (enabled)
    await page.waitForFunction((previous) => {
      const cue = window.__dictationSoundFixture.cues[previous];
      return cue?.started && cue.ended && cue.closed && cue.peak > 0.001;
    }, before);
  await page.getByTestId("inputbar-dictation-cancel").click();
  await page
    .getByTestId("inputbar-dictation-cancel")
    .waitFor({ state: "hidden" });
  if (enabled)
    await page.waitForFunction((previous) => {
      const cue = window.__dictationSoundFixture.cues[previous + 1];
      return cue?.started && cue.ended && cue.closed && cue.peak > 0.001;
    }, before);
  const observation = await page.evaluate(() => window.__dictationSoundFixture);
  summary.audio.push(observation);
  check(
    enabled
      ? "enabledProducesTwoNativeOutputSignals"
      : "disabledProducesNoCueContext",
    observation.cues.length === before + (enabled ? 2 : 0),
  );
  check(
    enabled
      ? "enabledRecordingReleasesInput"
      : "disabledRecordingReleasesInput",
    observation.streamsCreated === observation.streamsReleased,
  );
}
async function finishLaunch() {
  const buffers = await handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
  traces.push(buffers.trace);
  invokeErrors.push(buffers.errors);
  await closeElectronFixture(handle);
  handle = null;
}
try {
  ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-sounds-fixture",
  });
  runtime = createTempRuntimeEnv();
  runtime.appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: {
      ...runtime.env,
      APP_SERVER_BIN: electronAppServerBinaryDestination({
        outputRoot: path.resolve("dist-electron"),
      }),
    },
    repoRoot: process.cwd(),
  });
  let page = await launch();
  const seeded = await updateConfigFromPage(page, (config) => ({
    ...config,
    experimental: {
      ...config.experimental,
      voice_input: {
        ...config.experimental.voice_input,
        processor: {
          ...config.experimental.voice_input.processor,
          default_instruction_id: "missing-default",
          polish_enabled: false,
        },
        translate_instruction_id: "missing-translation",
      },
    },
  }));
  const seededVoice = seeded.config.experimental.voice_input;
  instructionSnapshot = JSON.stringify({
    instructions: seededVoice.instructions,
    defaultId: seededVoice.processor.default_instruction_id,
    translationId: seededVoice.translate_instruction_id,
    cleanupEnabled: seededVoice.processor.polish_enabled,
  });
  // Clear the renderer config cache after the test-only canonical write.
  await page.reload();
  await installMediaObservation(page);
  await openVoice(page);
  await checkInstructionConfig(page, "initialLoad");
  check(
    "soundDefaultEnabled",
    (await readConfigFromPage(page)).config.experimental.voice_input
      .sound_enabled === true,
  );
  check(
    "oldInstructionEditorAbsent",
    (await page.locator("[data-testid=settings-content] textarea").count()) ===
      0,
  );
  const search = page.getByTestId("settings-sidebar-search");
  await search.fill("听写提示音");
  await page.getByRole("option").filter({ hasText: "听写提示音" }).click();
  await page.waitForFunction(
    () => document.activeElement === document.getElementById("voice-sounds"),
  );
  check("searchFocusesSounds", true);
  await search.fill("");
  await page.setViewportSize({ width: 1200, height: 1040 });
  await soundSwitch(page).scrollIntoViewIfNeeded();
  await page.getByTestId("settings-content").evaluate((content) => {
    content.scrollTop = 0;
  });
  summary.measurements.light = await measure(page);
  await capture("sounds-light");
  await soundSwitch(page).press("Space");
  await waitSound(page, false);
  check("keyboardTogglePersistsDisabled", true);
  await checkInstructionConfig(page, "disableSave");
  await finishLaunch();

  page = await launch();
  await openVoice(page);
  await waitSound(page, false);
  check("coldRestartRestoresDisabled", true);
  await checkInstructionConfig(page, "disabledColdRestart");
  await recordAndCancel(page, false);
  await openVoice(page);
  await soundSwitch(page).click();
  await waitSound(page, true);
  check("reenablePersistsThroughCanonicalOwner", true);
  await checkInstructionConfig(page, "enableSave");
  await recordAndCancel(page, true);
  await openVoice(page);
  await page.getByTestId("settings-sidebar-tab-appearance").click();
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await soundSwitch(page).scrollIntoViewIfNeeded();
  summary.measurements.dark = await measure(page);
  await capture("sounds-dark");
  await page.setViewportSize({ width: 900, height: 760 });
  await soundSwitch(page).scrollIntoViewIfNeeded();
  summary.measurements.narrow = await measure(page);
  await capture("sounds-narrow");
  await finishLaunch();

  page = await launch();
  await openVoice(page);
  await waitSound(page, true);
  check("secondColdRestartRestoresEnabled", true);
  await checkInstructionConfig(page, "enabledColdRestart");
  await finishLaunch();
  check(
    "threeRealElectronLaunches",
    summary.launches.length === 3 &&
      summary.launches.every(
        (launch) =>
          launch.electron && launch.hasInvokeBridge && launch.supportsAppServer,
      ),
  );
  check(
    "typographyAndSwitchGeometry",
    Object.values(summary.measurements).every(
      (m) =>
        m.label === "13px" &&
        m.description === "12px" &&
        m.radius === "16px" &&
        m.switchWidth === 32 &&
        m.switchHeight === 20,
    ),
  );
  check(
    "noHorizontalOverflow",
    Object.values(summary.measurements).every((m) => !m.horizontalOverflow),
  );
  check(
    "audioContextsClosed",
    summary.audio.every((a) => a.cues.every((cue) => cue.closed)),
  );
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "realConfigReadWrite",
    summary.trace.appServerIpcHitCount > 0 &&
      summary.trace.missingConfigMethods.length === 0,
  );
  check("noProductionMockFallback", summary.trace.mockFallbackHitCount === 0);
  check("noLegacyCommands", summary.trace.legacyCommands.length === 0);
  check(
    "noInvokeErrors",
    invokeErrors.flatMap(parseInvokeTraceRaw).length === 0,
  );
  check("noConsoleErrors", consoleErrors.length === 0);
  check("noPageErrors", pageErrors.length === 0);
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("finalBuildFreshness", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
  if (handle) await capture("sounds-failure").catch(() => undefined);
} finally {
  if (handle) await closeElectronFixture(handle);
  summary.completedAt = new Date().toISOString();
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  summary.assertionCounts = {
    total: Object.keys(summary.assertions).length,
    passed: Object.values(summary.assertions).filter(Boolean).length,
  };
  fs.writeFileSync(
    path.join(directory, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
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
