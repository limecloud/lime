import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  appServerCallFromPage,
  createTempRuntimeEnv,
  launchElectronFixture,
} from "../mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../../agent-runtime/claw-chat-current-fixture-teardown.mjs";
import { bindGuiWorkspaceAndModelPreferences } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";
import { sendPromptFromGui } from "../../agent-runtime/claw-chat-current-fixture-gui-actions.mjs";
import { parseSettingsAppearanceFixtureArgs } from "./settings-appearance-fixture-evidence.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../../lib/electron-app-server-assets.mjs";
import { inspectElectronFixtureBuildFreshness } from "../../lib/electron-fixture-build.mjs";
import { withComposerEditorDom } from "../../lib/composer-editor-dom.mjs";

const options = parseSettingsAppearanceFixtureArgs(process.argv.slice(2), {
  defaults: {
    prefix: "settings-new-thread-effort",
    timeoutMs: 60000,
    intervalMs: 100,
    keepTemp: true,
  },
});
fs.mkdirSync(options.evidenceDir, { recursive: true });
const model = "settings-reasoning-fixture";
const key = "settings-local-provider-test-only";
const done = "Reasoning default fixture completed.";
const levels = ["low", "medium", "high", "xhigh", "max", "ultra", "persistent"];
const summary = {
  result: "fail",
  startedAt: new Date().toISOString(),
  boundary:
    "Real Electron/preload/IPC, canonical Thread/Turn, production runtime/provider HTTP lowering to a local deterministic SSE server. Isolated test provider/key/user data; no renderer mock, external backend, live provider, reference runtime, Windows or packaged proof.",
  assertions: {},
  sends: [],
  calls: [],
  teardowns: [],
};
const requests = [],
  errors = [],
  pageErrors = [];
let handle, mainExit, runtime, appServerEnv;
function check(name, condition) {
  summary.assertions[name] = Boolean(condition);
  console.log(`[new-thread-effort] ${name}: ${Boolean(condition)}`);
  if (!condition) throw Error(name);
}
async function waitUntil(predicate) {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
  throw Error("condition timeout");
}
const server = http.createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (request.headers.authorization !== `Bearer ${key}`) {
    response.writeHead(401).end();
    return;
  }
  if (request.method === "GET" && request.url.endsWith("/models")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: [{ id: model, object: "model" }] }));
    return;
  }
  if (request.method !== "POST" || !request.url.endsWith("/chat/completions")) {
    response.writeHead(404).end();
    return;
  }
  const parsed = JSON.parse(body);
  requests.push({ model: parsed.model, effort: parsed.reasoning_effort });
  const chunk = (delta, finish_reason) => ({
    id: `chatcmpl-settings-${requests.length}`,
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "close",
  });
  response.end(
    `data: ${JSON.stringify(chunk({ role: "assistant", content: done }, null))}\n\n` +
      `data: ${JSON.stringify(chunk({}, "stop"))}\n\ndata: [DONE]\n\n`,
  );
});
async function call(method, params = {}) {
  const { result, ipcObservation: observed } = await appServerCallFromPage(
    handle.page,
    method,
    params,
  );
  summary.calls.push({
    method,
    requestId: observed.requestId,
    responseId: observed.responseId,
    transport: observed.transport,
    electron: observed.electron,
    fallback: observed.fallback,
  });
  check(
    "currentIpcIdentity",
    observed.electron &&
      observed.requestId === observed.responseId &&
      observed.transport === "electron-ipc" &&
      !observed.fallback,
  );
  return result;
}
async function launch() {
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv,
    consoleErrors: errors,
    pageErrors,
    backendMode: "runtime",
  });
  mainExit = captureMainProcessExit(handle.app.process());
  check(
    "realElectronAndPreload",
    handle.rendererSnapshot.electron && handle.rendererSnapshot.hasInvokeBridge,
  );
}
async function close() {
  const result = await settleFixtureResources({ app: handle.app, mainExit });
  summary.teardowns.push(result);
  handle = null;
  check("normalMainExit", result.ok && result.forcedCleanup === null);
}
async function traceRequests() {
  return await handle.page.evaluate(() => {
    const entries = JSON.parse(
      localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]",
    );
    return entries.flatMap((entry) =>
      (entry.args_preview?.request?.lines || []).map((line) =>
        JSON.parse(line),
      ),
    );
  });
}
async function newDraft(projectName) {
  const group = handle.page
    .getByTestId("app-sidebar-project-conversation-group")
    .filter({ has: handle.page.getByTitle(projectName, { exact: true }) });
  await group.locator("button[aria-expanded]").hover();
  await group.getByTestId("app-sidebar-project-new-conversation").click();
  await waitUntil(() =>
    handle.page.evaluate(
      withComposerEditorDom(() => {
        const editors = findVisibleComposerEditorsDom();
        return (
          editors.length === 1 &&
          !editors[0].dataset.sessionId &&
          editors[0].getAttribute("contenteditable") === "true"
        );
      }),
    ),
  );
  await handle.page.getByTestId("model-selector").waitFor();
}
async function preview(label, imageName) {
  await handle.page.getByTestId("model-selector").click();
  const panel = handle.page.getByTestId("model-selector-reasoning-effort");
  await panel.waitFor();
  await waitUntil(
    async () =>
      (await panel
        .getByRole("button", { name: `选择推理强度 ${label}`, exact: true })
        .getAttribute("aria-pressed")) === "true",
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, imageName),
  });
  return panel;
}
async function visibleEffort(label) {
  const effort = handle.page.getByTestId("model-selector-effort");
  await effort.waitFor();
  return effort.evaluate((element, expected) => {
    const text = document.createRange();
    text.selectNodeContents(element);
    const bounds = text.getBoundingClientRect();
    const trigger = element
      .closest('[data-testid="model-selector"]')
      .getBoundingClientRect();
    return (
      element.textContent.includes(expected) &&
      bounds.width > 0 &&
      bounds.left >= trigger.left &&
      bounds.right <= trigger.right &&
      bounds.top >= trigger.top &&
      bounds.bottom <= trigger.bottom
    );
  }, `思考 ${label}`);
}
async function send(name, effort, explicit = false) {
  const before = requests.length;
  const traceBefore = new Set(
    (await traceRequests()).map((message) => JSON.stringify(message)),
  );
  await sendPromptFromGui(handle.page, options, `Settings effort ${name}`, {
    allowTaskCenterHomeInput: true,
  });
  await waitUntil(() => requests.length > before);
  await handle.page
    .locator('[data-message-role="assistant"]')
    .filter({ hasText: done })
    .waitFor();
  const messages = (await traceRequests()).filter(
    (message) => !traceBefore.has(JSON.stringify(message)),
  );
  summary.calls.push({
    scenario: name,
    observedMethods: messages.map((message) => message.method),
  });
  const start = messages.find((message) => message.method === "turn/start");
  const threadStart = messages.find(
    (message) => message.method === "thread/start",
  );
  const threadId = start?.params.threadId;
  check(
    `${name}CanonicalThread`,
    typeof threadId === "string" && threadId.length > 0,
  );
  await waitUntil(async () => {
    const read = await call("thread/read", { threadId, includeTurns: true });
    return read.thread.turns.some((turn) => turn.status === "completed");
  });
  const read = await call("thread/read", { threadId, includeTurns: false });
  summary.sends.push({
    name,
    effort,
    explicit,
    threadId,
    request: requests[before],
    turnParams: start.params,
    selector: await handle.page.getByTestId("model-selector").textContent(),
  });
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${name}-after-send.png`),
  });
  check(
    `${name}ActualProviderEffort`,
    requests[before].model === model &&
      requests[before].effort === (effort === "ultra" ? "max" : effort),
  );
  check(`${name}CanonicalEffort`, read.thread.extra.reasoningEffort === effort);
  check(
    `${name}Override`,
    explicit
      ? start.params.effort === effort
      : (start.params.effort === undefined || start.params.effort === effort) &&
          threadStart?.params.config?.model_reasoning_effort === undefined &&
          messages.some(
            (message) =>
              message.method === "thread/read" &&
              message.params.threadId === threadId,
          ),
  );
  const label = { high: "高", ultra: "超高", low: "低" }[effort];
  await waitUntil(() => visibleEffort(label));
  check(`${name}VisibleCanonicalEffort`, await visibleEffort(label));
  return threadId;
}
try {
  check(
    "freshBuild",
    inspectElectronFixtureBuildFreshness({ rootDir: process.cwd() }).ready,
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  runtime = createTempRuntimeEnv();
  appServerEnv = resolveElectronAppServerRuntimeEnv({ env: runtime.env });
  await launch();
  const { provider } = await call("modelProvider/create", {
    name: "New Thread reasoning fixture",
    providerType: "openai",
    apiHost: `http://127.0.0.1:${server.address().port}/v1`,
  });
  await call("modelProvider/update", {
    providerId: provider.id,
    enabled: true,
    sortOrder: -1,
    models: [
      {
        id: model,
        capability: {
          taskFamilies: ["chat", "reasoning"],
          inputModalities: ["text"],
          outputModalities: ["text"],
          runtimeFeatures: ["streaming", "reasoning"],
          capabilities: {
            vision: false,
            tools: true,
            streaming: true,
            jsonMode: false,
            functionCalling: true,
            reasoning: true,
            reasoningEffort: {
              supported: true,
              levels,
              default: "medium",
              source: "api",
              options: [],
            },
          },
        },
      },
    ],
  });
  await call("modelProviderKey/create", {
    providerId: provider.id,
    apiKey: key,
    alias: "fixture",
    replaceExisting: true,
  });
  const { workspace } = await call("workspace/default/ensure");
  const rootPath = fs.realpathSync(workspace.rootPath ?? workspace.root_path);
  check(
    "isolatedWorkspace",
    rootPath.startsWith(fs.realpathSync(runtime.tempRoot) + path.sep),
  );
  await call("config/batchWrite", {
    edits: [
      {
        keyPath: "model_reasoning_effort",
        value: "high",
        mergeStrategy: "upsert",
      },
    ],
  });
  await bindGuiWorkspaceAndModelPreferences(handle.page, workspace.id, {
    provider: provider.id,
    model,
  });
  await handle.page.reload();
  await handle.page.getByTestId("app-sidebar").waitFor();
  await preview("高", "user-default-preview.png");
  await handle.page.keyboard.press("Escape");
  const firstId = await send("userDefault", "high");
  const projectRoot = path.join(runtime.tempRoot, "configured-project");
  fs.mkdirSync(path.join(projectRoot, ".lime"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, ".lime/config.toml"),
    'model_reasoning_effort = "ultra"\n',
  );
  const projectName = "Effort project";
  const { workspace: project } = await call("workspace/ensure", {
    name: projectName,
    rootPath: projectRoot,
  });
  await call("config/batchWrite", {
    edits: [
      {
        keyPath: `projects.${JSON.stringify(projectRoot)}.trust_level`,
        value: "trusted",
        mergeStrategy: "upsert",
      },
    ],
  });
  const effective = await call("config/read", {
    cwd: projectRoot,
    includeLayers: true,
  });
  check(
    "effectiveProjectDefault",
    effective.config.model_reasoning_effort === "ultra",
  );
  await bindGuiWorkspaceAndModelPreferences(handle.page, project.id, {
    provider: provider.id,
    model,
  });
  await handle.page.reload();
  await handle.page.getByTestId("app-sidebar").waitFor();
  await newDraft(projectName);
  await preview("超高", "project-default-preview.png");
  await handle.page.keyboard.press("Escape");
  await send("projectDefault", "ultra");
  await newDraft(projectName);
  const panel = await preview("超高", "before-explicit-selection.png");
  await panel
    .getByRole("button", { name: "选择推理强度 低", exact: true })
    .click();
  await waitUntil(
    async () =>
      (await panel
        .getByRole("button", { name: "选择推理强度 低", exact: true })
        .getAttribute("aria-pressed")) === "true",
  );
  await handle.page.keyboard.press("Escape");
  check("explicitChoiceSelectedBeforeSend", await visibleEffort("低"));
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "explicit-choice-before-send.png"),
  });
  await send("explicitChoice", "low", true);
  const old = await call("thread/read", {
    threadId: firstId,
    includeTurns: false,
  });
  check(
    "oldThreadRetainsUserDefault",
    old.thread.extra.reasoningEffort === "high",
  );
  const firstSessionId = old.thread.sessionId;
  check(
    "oldThreadHasCanonicalSessionIdentity",
    typeof firstSessionId === "string",
  );
  await call("config/batchWrite", {
    edits: [
      {
        keyPath: "model_reasoning_effort",
        value: "xhigh",
        mergeStrategy: "upsert",
      },
    ],
  });
  await close();
  await launch();
  await handle.page.getByTestId("app-sidebar-home-button").click();
  await handle.page
    .getByTestId("app-sidebar")
    .locator(
      `[data-testid="app-sidebar-conversation-open"][data-session-id="${firstSessionId}"]`,
    )
    .click();
  await handle.page
    .locator('[data-message-role="user"]')
    .filter({ hasText: "Settings effort userDefault" })
    .waitFor();
  await handle.page
    .locator('[data-message-role="assistant"]')
    .filter({ hasText: done })
    .waitFor();
  await waitUntil(() =>
    handle.page.evaluate(
      withComposerEditorDom((expectedSessionId) => {
        const editors = findVisibleComposerEditorsDom(expectedSessionId);
        return (
          editors.length === 1 &&
          editors[0].getAttribute("contenteditable") === "true"
        );
      }),
      firstSessionId,
    ),
  );
  check("coldOldThreadMessagesRestored", true);
  await waitUntil(async () =>
    (await handle.page.getByTestId("model-selector").textContent()).includes(
      "思考 高",
    ),
  );
  check("coldOldThreadVisibleCanonicalEffort", await visibleEffort("高"));
  check("coldResumeDidNotSendAnotherTurn", requests.length === 3);
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "cold-old-thread.png"),
  });
  check(
    "noConsoleOrPageErrors",
    errors.length === 0 && pageErrors.length === 0,
  );
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  if (handle)
    await handle.page
      .screenshot({ path: path.join(options.evidenceDir, "failure.png") })
      .catch(() => {});
} finally {
  summary.requests = requests;
  summary.consoleErrors = errors;
  summary.pageErrors = pageErrors;
  if (handle) {
    await close().catch((error) => {
      summary.result = "fail";
      summary.teardownFailure = String(error);
    });
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  summary.completedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(options.evidenceDir, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        result: summary.result,
        assertions: summary.assertions,
        failure: summary.failure,
      },
      null,
      2,
    ),
  );
  if (summary.result !== "pass") process.exitCode = 1;
}
