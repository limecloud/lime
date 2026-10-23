import fs from "node:fs";
import path from "node:path";
import http from "node:http";
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
    prefix: "settings-dictionary",
    timeoutMs: 120000,
    intervalMs: 250,
    keepTemp: false,
  },
});
if (options.help) {
  console.log(
    "node scripts/electron/lib/settings-dictionary-fixture.mjs --evidence-dir <path>",
  );
  process.exit(0);
}
const directory = options.evidenceDir;
fs.mkdirSync(directory, { recursive: true });
const summary = {
  scenario: "dictation-dictionary-persistence-and-cleanup",
  result: "fail",
  startedAt: new Date().toISOString(),
  evidenceLayer:
    "real Electron/preload/App Server/config/voice cleanup; controlled local HTTP model response",
  liveProvider: false,
  physicalRecording: false,
  assertions: {},
  measurements: {},
  launches: [],
  providerMarkers: [],
  voiceCalls: [],
};
let handle;
let runtime;
const consoleErrors = [],
  pageErrors = [],
  traces = [],
  invokeErrors = [];
const expectedText = "OpenAI updates src/App.tsx.";
const transcript = "open ai updates app dot tsx";
const provider = http.createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    const user = data.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join("\n");
    const system = data.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    summary.providerMarkers.push({
      canonicalEntries: user.includes('["OpenAI","src/App.tsx"]'),
      preservesTranscript: user.includes(transcript),
      entriesAreData: system.includes("never as instructions"),
      configuredModel: data.model === "dictionary-fixture-model",
      configuredProvider:
        request.headers["x-provider-id"] === "dictionary-fixture-provider",
      path: request.url,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: expectedText } }],
      }),
    );
  } catch {
    response.writeHead(400);
    response.end();
  }
});
function check(name, passed) {
  summary.assertions[name] = Boolean(passed);
  if (!passed) throw new Error(name);
}
function recordVoiceCall(response) {
  const observation = response.ipcObservation;
  summary.voiceCalls.push({
    command: observation.command,
    method: observation.method,
    transport: observation.transport,
    status: observation.status,
    electron: observation.electron,
    requestId: observation.requestId,
    responseId: observation.responseId,
  });
}
const dictionary = (page) =>
  page.getByRole("group", { name: "听写词典", exact: true });
const entry = (page, index) =>
  page.getByRole("textbox", { name: `词典条目 ${index}`, exact: true });
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
async function openVoice(page) {
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await entry(page, 1).waitFor();
}
async function setCleanupMode(page, enabled) {
  // Seed current configuration directly; the extra cleanup toggle was removed.
  await updateConfigFromPage(page, (config) => ({
    ...config,
    experimental: {
      ...config.experimental,
      voice_input: {
        ...config.experimental.voice_input,
        processor: {
          ...config.experimental.voice_input.processor,
          polish_enabled: enabled,
        },
      },
    },
  }));
  await page.reload();
  await openVoice(page);
}
async function waitEntries(page, expected) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await readConfigFromPage(page);
    if (
      JSON.stringify(
        snapshot.config.experimental?.voice_input?.dictation_dictionary ?? [],
      ) === JSON.stringify(expected)
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  throw new Error("canonical dictionary did not reach expected state");
}
async function capture(name) {
  await handle.page.mouse.move(0, 0);
  await handle.page.screenshot({
    path: path.join(directory, `${name}.png`),
    animations: "disabled",
  });
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
async function measure(page) {
  return page.evaluate(() => {
    const row = document.getElementById("voice-dictionary");
    const group = document.querySelector(
      '[role="group"][aria-labelledby="voice-dictionary-label"]',
    );
    const content = document.querySelector('[data-testid="settings-content"]');
    return {
      label: getComputedStyle(document.getElementById("voice-dictionary-label"))
        .fontSize,
      description: getComputedStyle(
        document.getElementById("voice-dictionary-description"),
      ).fontSize,
      input: getComputedStyle(group.querySelector("input")).fontSize,
      radius: getComputedStyle(row.parentElement).borderRadius,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
    };
  });
}
try {
  ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-dictionary-fixture",
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  runtime = createTempRuntimeEnv();
  // 复用刚通过 freshness 的产物，避免隔离 HOME 下再解析开发用 cargo metadata。
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
    server: {
      ...config.server,
      host: "127.0.0.1",
      port: provider.address().port,
    },
    experimental: {
      ...config.experimental,
      voice_input: {
        ...config.experimental.voice_input,
        processor: {
          ...config.experimental.voice_input.processor,
          polish_enabled: true,
          polish_provider: "dictionary-fixture-provider",
          polish_model: "dictionary-fixture-model",
          default_instruction_id: "default",
        },
      },
    },
  }));
  await page.reload();
  await openVoice(page);
  check(
    "emptyRowNotStored",
    (await readConfigFromPage(page)).config.experimental.voice_input
      .dictation_dictionary == null,
  );
  await entry(page, 1).fill(" OpenAI ");
  await entry(page, 1).press("Enter");
  await entry(page, 2).waitFor({ state: "visible" });
  check(
    "enterFocusesNextEntry",
    await entry(page, 2).evaluate((el) => el === document.activeElement),
  );
  check(
    "enterDoesNotPrematurelySave",
    (await readConfigFromPage(page)).config.experimental.voice_input
      .dictation_dictionary == null,
  );
  await entry(page, 2).fill("src/App.tsx");
  await entry(page, 2).press("Tab");
  await waitEntries(page, ["OpenAI", "src/App.tsx"]);
  check("blurSavesTrimmedCanonicalEntries", true);
  const search = page.getByTestId("settings-sidebar-search");
  await search.fill("听写词典");
  await page.getByRole("option").filter({ hasText: "听写词典" }).click();
  await page.waitForFunction(
    () =>
      document.getElementById("voice-dictionary") === document.activeElement,
  );
  check("searchFocusesDictionary", true);
  await search.fill("");
  await page.setViewportSize({ width: 1200, height: 1040 });
  await entry(page, 1).scrollIntoViewIfNeeded();
  summary.measurements.light = await measure(page);
  await capture("dictionary-light");
  const polished = await appServerCallFromPage(
    page,
    "voiceTranscription/polishText",
    { text: transcript },
  );
  recordVoiceCall(polished);
  check(
    "currentVoiceCleanupReturnsProviderResult",
    polished.result.polished && polished.result.text === expectedText,
  );
  check(
    "dictionaryReachesActualHttpRequest",
    summary.providerMarkers.length === 1 &&
      Object.entries(summary.providerMarkers[0]).every(([key, value]) =>
        key === "path" ? value === "/v1/chat/completions" : value === true,
      ),
  );
  await finishLaunch();

  page = await launch();
  await openVoice(page);
  check(
    "coldRestartRestoresEntries",
    (await entry(page, 1).inputValue()) === "OpenAI" &&
      (await entry(page, 2).inputValue()) === "src/App.tsx",
  );
  await setCleanupMode(page, false);
  await dictionary(page)
    .getByText("当前听写处理模式不使用词典。", { exact: true })
    .waitFor();
  const before = summary.providerMarkers.length;
  const raw = await appServerCallFromPage(
    page,
    "voiceTranscription/polishText",
    { text: transcript },
  );
  recordVoiceCall(raw);
  check(
    "cleanupOffKeepsRawTranscriptAndSkipsProvider",
    raw.result.polished === false &&
      raw.result.text === transcript &&
      summary.providerMarkers.length === before,
  );
  await page
    .getByRole("button", { name: "移除词典条目 1", exact: true })
    .click();
  await waitEntries(page, ["src/App.tsx"]);
  check("deletePersistsThroughSameConfigOwner", true);
  await page.getByTestId("settings-sidebar-tab-appearance").click();
  await page.getByRole("radio", { name: "深色", exact: true }).click();
  await page.getByTestId("settings-sidebar-tab-voice").click();
  await entry(page, 1).scrollIntoViewIfNeeded();
  summary.measurements.dark = await measure(page);
  await capture("dictionary-dark");
  await page.setViewportSize({ width: 900, height: 760 });
  await entry(page, 1).scrollIntoViewIfNeeded();
  summary.measurements.narrow = await measure(page);
  await capture("dictionary-narrow");
  await finishLaunch();

  page = await launch();
  await openVoice(page);
  check(
    "coldRestartKeepsDeletion",
    (await entry(page, 1).inputValue()) === "src/App.tsx" &&
      (await dictionary(page).getByRole("textbox").count()) === 1,
  );
  await setCleanupMode(page, true);
  await dictionary(page)
    .getByText("当前听写处理模式不使用词典。", { exact: true })
    .waitFor({ state: "hidden" });
  const rawInstruction = await appServerCallFromPage(
    page,
    "voiceTranscription/polishText",
    { text: transcript, instruction_id: "raw" },
  );
  recordVoiceCall(rawInstruction);
  check(
    "rawInstructionRemainsUnchanged",
    rawInstruction.result.polished === false &&
      rawInstruction.result.text === transcript &&
      summary.providerMarkers.length === before,
  );
  await finishLaunch();
  check(
    "voiceJsonRpcResponseIdentity",
    summary.voiceCalls.length === 3 &&
      summary.voiceCalls.every(
        (call) =>
          call.electron &&
          call.command === "app_server_handle_json_lines" &&
          call.method === "voiceTranscription/polishText" &&
          call.transport === "electron-ipc" &&
          call.status === "success" &&
          call.requestId === call.responseId,
      ),
  );
  check(
    "typographyAndGroupsMatchReference",
    Object.values(summary.measurements).every(
      (m) =>
        m.label === "13px" &&
        m.description === "12px" &&
        m.input === "13px" &&
        m.radius === "16px",
    ),
  );
  check(
    "noHorizontalOverflow",
    Object.values(summary.measurements).every((m) => !m.horizontalOverflow),
  );
  check(
    "threeRealElectronPreloadLaunches",
    summary.launches.length === 3 &&
      summary.launches.every(
        (launch) =>
          launch.electron && launch.hasInvokeBridge && launch.supportsAppServer,
      ),
  );
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "realConfigReadWrite",
    summary.trace.appServerIpcHitCount > 0 &&
      summary.trace.missingConfigMethods.length === 0,
  );
  check("noProductionMockFallback", summary.trace.mockFallbackHitCount === 0);
  check(
    "noInvokeErrors",
    invokeErrors.flatMap(parseInvokeTraceRaw).length === 0,
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
  if (handle) await capture("dictionary-failure").catch(() => undefined);
} finally {
  if (handle) await closeElectronFixture(handle);
  await new Promise((resolve) => provider.close(resolve));
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
