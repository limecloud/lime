import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
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
  updateConfigFromPage,
  appServerCallFromPage,
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
    prefix: "settings-history",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
const directory = options.evidenceDir;
fs.mkdirSync(directory, { recursive: true });
const summary = {
  scenario: "dictation-history-record-recover-restart",
  result: "fail",
  startedAt: new Date().toISOString(),
  evidenceLayer:
    "real Electron/preload/JSON-RPC/voice history file store; native MediaRecorder/WebAudio, synthetic input and local HTTP ASR fixture",
  physicalMicrophone: false,
  liveProvider: false,
  assertions: {},
  launches: [],
  calls: [],
  providerMarkers: [],
  measurements: {},
};
const consoleErrors = [],
  pageErrors = [],
  traces = [],
  invokeErrors = [];
let handle, runtime;
const text = "Recovered dictation fixture.";
const check = (name, passed) => {
  summary.assertions[name] = Boolean(passed);
  if (!passed) throw new Error(name);
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const provider = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  summary.providerMarkers.push({
    path: request.url,
    multipart: String(request.headers["content-type"]).startsWith(
      "multipart/form-data",
    ),
    wav:
      body.includes(Buffer.from("RIFF")) && body.includes(Buffer.from("WAVE")),
    bytes: body.length,
  });
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ text }));
});

async function call(method, params = {}) {
  const response = await appServerCallFromPage(handle.page, method, params);
  summary.calls.push({
    method,
    transport: response.ipcObservation.transport,
    requestId: response.ipcObservation.requestId,
    responseId: response.ipcObservation.responseId,
    electron: response.ipcObservation.electron,
  });
  return response.result;
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
  return handle.page;
}
async function finish() {
  const buffers = await handle.page.evaluate(() => ({
    trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
    errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
  }));
  traces.push(buffers.trace);
  invokeErrors.push(buffers.errors);
  await closeElectronFixture(handle);
  handle = null;
}
async function openVoice(page) {
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await page.locator('[data-settings-search-target="voice-history"]').waitFor();
  await page
    .getByRole("button", { name: "录音操作", exact: true })
    .first()
    .waitFor();
}
async function waitHistory(predicate) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const list = await call("dictationHistory/list");
    if (predicate(list.recordings)) return list.recordings;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  throw new Error("canonical recording history did not reach expected state");
}
async function capture(name) {
  await handle.page.mouse.move(0, 0);
  await handle.page.screenshot({
    path: path.join(directory, `${name}.png`),
    animations: "disabled",
  });
  summary.measurements[name] = await handle.page.evaluate(() => {
    const history = document.querySelector(
      '[data-settings-search-target="voice-history"]',
    );
    const content = document.querySelector('[data-testid="settings-content"]');
    return {
      label: getComputedStyle(history.querySelector(".settings-row-label"))
        .fontSize,
      description: getComputedStyle(
        history.querySelector(".settings-row-description"),
      ).fontSize,
      radius: getComputedStyle(history.parentElement).borderRadius,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
    };
  });
}

try {
  ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-history-fixture",
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
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
  await updateConfigFromPage(page, (config) => ({
    ...config,
    experimental: {
      ...config.experimental,
      voice_input: {
        ...config.experimental.voice_input,
        sound_enabled: false,
        processor: {
          ...config.experimental.voice_input.processor,
          polish_enabled: false,
        },
      },
    },
  }));
  await call("voiceAsrCredential/create", {
    provider: "openai",
    name: "Local ASR fixture",
    is_default: true,
    openai_config: {
      api_key: "fixture-only",
      base_url: `http://127.0.0.1:${provider.address().port}`,
    },
  });
  await page.reload();
  // Only input is replaced; encoding, decoding, recording and the product bridge remain native.
  await page.evaluate(() => {
    const media = new EventTarget();
    const state = { created: 0, released: 0, startedAt: 0, context: null };
    media.enumerateDevices = async () => [];
    media.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = 0.05;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      await context.resume();
      state.created++;
      state.context = context;
      state.startedAt = context.currentTime;
      let released = false;
      for (const track of destination.stream.getTracks()) {
        const stop = track.stop.bind(track);
        track.stop = () => {
          stop();
          if (!released) {
            released = true;
            state.released++;
            oscillator.stop();
            oscillator.disconnect();
            gain.disconnect();
            void context.close();
          }
        };
      }
      return destination.stream;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: media,
    });
    window.__historyFixture = state;
  });
  await page.getByTestId("app-sidebar-rail-home").click();
  await page.getByTestId("inputbar-dictation-toggle").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="inputbar-dictation-toggle"]')
        ?.getAttribute("aria-pressed") === "true",
  );
  await page.waitForFunction(
    () =>
      window.__historyFixture.context.currentTime -
        window.__historyFixture.startedAt >=
      0.6,
  );
  const active = await waitHistory(
    (items) => items.length === 1 && items[0].status === "recording",
  );
  const id = active[0].id;
  await page.getByTestId("inputbar-dictation-cancel").click();
  const cancelled = await waitHistory(
    (items) =>
      items.length === 1 &&
      items[0].status === "cancelled" &&
      items[0].sizeBytes > 0,
  );
  summary.recording = { id, originalSizeBytes: cancelled[0].sizeBytes };
  check("oneRecordingIdentity", cancelled[0].id === id);
  check(
    "cancelPreservesFinalAudio",
    cancelled[0].sizeBytes > 0 && !cancelled[0].text,
  );
  check(
    "inputReleased",
    await page.evaluate(
      () =>
        window.__historyFixture.created === window.__historyFixture.released,
    ),
  );
  await openVoice(page);
  await page.getByText("录音已取消", { exact: true }).waitFor();
  await page.getByRole("button", { name: "重试转写", exact: true }).click();
  await page.getByText(text, { exact: true }).waitFor();
  const recovered = await waitHistory((items) => items[0]?.text === text);
  check(
    "retryKeepsOriginalIdentityAndAudio",
    recovered.length === 1 &&
      recovered[0].id === id &&
      recovered[0].sizeBytes === cancelled[0].sizeBytes,
  );
  check(
    "nativeDecodeAndRealAsrRequest",
    summary.providerMarkers.length > 0 &&
      summary.providerMarkers.every(
        (marker) =>
          marker.multipart &&
          marker.wav &&
          marker.path === "/v1/audio/transcriptions",
      ),
  );
  await page.getByRole("button", { name: "复制听写内容", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "已复制" })
    .waitFor({ state: "attached" });
  check(
    "copyUsesNativeClipboard",
    (await handle.app.evaluate(({ clipboard }) => clipboard.readText())) ===
      text,
  );
  await page
    .locator('[data-settings-search-target="voice-history"]')
    .scrollIntoViewIfNeeded();
  await capture("history-light");
  await finish();

  page = await launch();
  await openVoice(page);
  await page.getByText(text, { exact: true }).waitFor();
  const cold = await call("dictationHistory/list");
  check(
    "coldRestartRestoresTranscriptAndIdentity",
    cold.recordings.length === 1 &&
      cold.recordings[0].id === id &&
      cold.recordings[0].text === text,
  );
  await page.evaluate((recordingId) => {
    const url = new URL(location.href);
    url.searchParams.set("recording", recordingId);
    history.replaceState(history.state, "", url);
  }, id);
  await page.reload();
  await openVoice(page);
  await page
    .getByRole("button", { name: "显示所有录音", exact: true })
    .waitFor();
  check(
    "selectedRecoveryExpanded",
    (await page
      .locator(
        '[data-settings-search-target="voice-history"] .whitespace-pre-wrap',
      )
      .count()) === 1,
  );
  const downloadPath = path.join(runtime.tempRoot, "downloaded-recording.webm");
  await handle.app.evaluate(({ session }, filename) => {
    session.defaultSession.once("will-download", (_event, item) => {
      item.setSavePath(filename);
      item.once("done", (_done, state) => {
        globalThis.__historyDownload = { filename, state };
      });
    });
  }, downloadPath);
  await page.getByRole("button", { name: "下载音频", exact: true }).click();
  const deadline = Date.now() + options.timeoutMs;
  let download;
  while (Date.now() < deadline) {
    download = await handle.app.evaluate(() => globalThis.__historyDownload);
    if (download) break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  const audio = await call("dictationHistory/readAudio", { id });
  check(
    "downloadOriginalAudio",
    download?.state === "completed" &&
      fs.existsSync(downloadPath) &&
      hash(fs.readFileSync(downloadPath)) ===
        hash(Buffer.from(audio.audioBase64, "base64")),
  );
  summary.download = {
    sizeBytes: fs.statSync(downloadPath).size,
    sha256: hash(fs.readFileSync(downloadPath)),
  };
  await page.getByTestId("settings-sidebar-tab-appearance").click();
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await page
    .locator('[data-settings-search-target="voice-history"]')
    .scrollIntoViewIfNeeded();
  await capture("history-dark");
  await page.setViewportSize({ width: 900, height: 760 });
  await page
    .locator('[data-settings-search-target="voice-history"]')
    .scrollIntoViewIfNeeded();
  await capture("history-narrow");
  await page.getByRole("button", { name: "显示所有录音", exact: true }).click();
  check(
    "showAllClearsSelectedQuery",
    !new URL(page.url()).searchParams.has("recording"),
  );
  const menu = page.getByRole("button", { name: "录音操作", exact: true });
  await menu.focus();
  await menu.press("ArrowDown");
  const deleteAction = page.getByRole("menuitem", {
    name: "删除录音",
    exact: true,
  });
  await deleteAction.waitFor();
  await page.keyboard.press("End");
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("role") === "menuitem" &&
      document.activeElement.textContent?.trim() === "删除录音",
  );
  check(
    "keyboardMenuFocusesDelete",
    await deleteAction.evaluate(
      (element) => document.activeElement === element,
    ),
  );
  await deleteAction.press("Enter");
  await waitHistory((items) => items.length === 0);
  check("keyboardMenuDeletesRecording", true);
  await finish();

  page = await launch();
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await page.locator('[data-settings-search-target="voice-history"]').waitFor();
  check(
    "deletionSurvivesColdRestart",
    (await call("dictationHistory/list")).recordings.length === 0,
  );
  check(
    "deletedRecordingHasNoActions",
    (await page
      .getByRole("button", { name: "录音操作", exact: true })
      .count()) === 0,
  );
  await finish();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "realIpcRequestResponseIdentity",
    summary.calls.every(
      (call) => call.electron && call.requestId === call.responseId,
    ),
  );
  check(
    "historyActionsUseCurrentGateway",
    [
      "start",
      "appendAudio",
      "finish",
      "setTranscript",
      "delete",
      "readAudio",
      "list",
    ].every((action) =>
      traces.some((raw) => String(raw).includes(`dictationHistory/${action}`)),
    ),
  );
  check(
    "noAudioOrTranscriptInDiagnosticParams",
    traces.every(
      (raw) =>
        !String(raw).includes("audioBase64") &&
        !String(raw).includes("audio_base64") &&
        !String(raw).includes(text),
    ),
  );
  check("noProductionMockFallback", summary.trace.mockFallbackHitCount === 0);
  check("noLegacyCommands", summary.trace.legacyCommands.length === 0);
  check(
    "noInvokeErrors",
    invokeErrors.flatMap(parseInvokeTraceRaw).length === 0,
  );
  check("noConsoleErrors", consoleErrors.length === 0);
  check("noPageErrors", pageErrors.length === 0);
  check(
    "typographyAndGeometry",
    Object.values(summary.measurements).every(
      (m) =>
        m.label === "13px" &&
        m.description === "12px" &&
        m.radius === "16px" &&
        !m.horizontalOverflow,
    ),
  );
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("finalBuildFreshness", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
  if (handle)
    await handle.page
      .screenshot({ path: path.join(directory, "history-failure.png") })
      .catch(() => undefined);
} finally {
  if (handle) await closeElectronFixture(handle);
  await new Promise((resolve) => provider.close(resolve));
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  summary.completedAt = new Date().toISOString();
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
