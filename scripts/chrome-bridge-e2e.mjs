// Real Chrome MV3 -> Native Messaging -> shared App Server -> canonical tool loop.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { prepareLocalAppServerBinary } from "./lib/electron-dev-sidecar.mjs";
import { snapshotTerminalGateBinaries } from "./app-server/terminal-gate-binaries.mjs";
import { startChromeHost } from "./app-server/computer-use-chrome-host.mjs";
import { startOpenAiCompatibleFixtureServer } from "./lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionThreadStartParams,
  provisionToolExecutionFixtureProvider,
} from "./agent-runtime/tool-execution-current-contract.mjs";

let source = path.resolve(
  process.env.APP_SERVER_BIN ||
    `lime-rs/target/debug/app-server${process.platform === "win32" ? ".exe" : ""}`,
);
const evidence = path.resolve(
  process.env.LIME_CHROME_EVIDENCE ||
    ".lime/qc/computer-use-integrations-20261025/chrome.json",
);
const host = process.env.LIME_COMPUTER_USE_HOST || "app-server";
assert(["app-server", "desktop", "cli", "tui"].includes(host));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "lime-chrome-native-"));
const chromeLog = path.join(root, "chrome.log");
const receipt = {
  startedAt: new Date().toISOString(),
  claimBoundary: `Real ${host} Host, installed Google Chrome, MV3, Native Messaging and canonical model tool loop; loopback provider fixture, no live model, signed package, other Host or Windows Gate B claim`,
  host,
  checks: [],
};
const nativeManifest =
  process.platform === "darwin"
    ? path.join(
        os.homedir(),
        "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.limecloud.lime.computer_use.json",
      )
    : process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA,
          "LimeCloud/lime/computer-use/com.limecloud.lime.computer_use.json",
        )
      : path.join(
          os.homedir(),
          ".config/google-chrome/NativeMessagingHosts/com.limecloud.lime.computer_use.json",
        );
let originalManifest, productHost, context, providerFixture;
const fixture = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(
    '<!doctype html><title>Lime Chrome fixture</title><style>body{padding:40px}input{height:36px;width:400px}</style><label>Result<input id="result" aria-label="Result"></label><div id="readback"></div><a href="/?child=1" target="_blank">Open child</a><script>document.querySelector("input").addEventListener("input",e=>document.querySelector("#readback").textContent=e.target.value)</script>',
  );
});
const waitUntil = async (fn, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Condition timed out during ${receipt.stage || "initialization"}`,
  );
};
function request(method, params = {}) {
  return productHost.request(method, params);
}
try {
  receipt.stage = "register-native-host";
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  const binaries = await snapshotTerminalGateBinaries({
    appServerBinaryPath: source,
    cliBinaryPath: ["cli", "tui"].includes(host)
      ? path.resolve(
          process.env.LIME_CLI_BIN ||
            `lime-rs/target/debug/lime${process.platform === "win32" ? ".exe" : ""}`,
        )
      : undefined,
    directory: path.join(root, "bin"),
  });
  source = binaries.appServerBinaryPath;
  prepareLocalAppServerBinary({ binaryPath: source });
  const binaryDigest = createHash("sha256");
  for await (const bytes of createReadStream(source))
    binaryDigest.update(bytes);
  receipt.appServerBinary = {
    path: source,
    sha256: binaryDigest.digest("hex"),
    platform: process.platform,
    arch: process.arch,
  };
  originalManifest = await fs.readFile(nativeManifest).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  await fs.writeFile(
    path.join(root, "config.yaml"),
    "server:\n  api_key: fixture-only\nfeatures:\n  computer_use: false\n  chrome_use: true\n  office_use: false\n",
  );
  productHost = await startChromeHost({
    host,
    root,
    binaries,
    receipt,
    evidenceDir: path.dirname(evidence),
  });
  const installed = await request("computerUse/setup", {
    adapter: "chrome",
    grantScope: "session",
  });
  assert.equal(installed.accepted, true);
  const registeredHost = JSON.parse(await fs.readFile(nativeManifest, "utf8"));
  assert.equal(registeredHost.path, source);
  assert.deepEqual(registeredHost.allowed_origins, [
    "chrome-extension://okipgpdaiijkenehohfgochhhlbifcbc/",
  ]);
  receipt.checks.push(
    process.env.LIME_CHROME_EXTENSION_DIR
      ? "real setup registered the per-user Native Messaging host; extension loaded directly from explicit source directory"
      : "real setup exported the new extension and registered the per-user Native Messaging host",
  );
  receipt.extensionSource =
    process.env.LIME_CHROME_EXTENSION_DIR || "compiled installer assets";
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  const chromeProfile = path.join(root, "chrome-profile");
  if (process.platform === "darwin" || process.platform === "linux") {
    // Chromium resolves per-user native manifests under its actual user-data
    // directory. Register the same installed host in this isolated test profile.
    const hosts = path.join(chromeProfile, "NativeMessagingHosts");
    await fs.mkdir(hosts, { recursive: true });
    await fs.copyFile(
      nativeManifest,
      path.join(hosts, path.basename(nativeManifest)),
    );
  }
  context = await chromium.launchPersistentContext(chromeProfile, {
    channel: "chrome",
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      "--enable-unsafe-extension-debugging",
      "--no-first-run",
      "--no-default-browser-check",
      "--enable-logging",
      `--log-file=${chromeLog}`,
    ],
  });
  receipt.browserLogs = [];
  context.on("console", (message) => {
    if (receipt.browserLogs.length < 30)
      receipt.browserLogs.push(message.text().slice(0, 500));
  });
  const page = await context.newPage();
  const browserSession = await context.browser().newBrowserCDPSession();
  const extensionDirectory =
    process.env.LIME_CHROME_EXTENSION_DIR ||
    (process.platform === "darwin"
      ? path.join(
          os.homedir(),
          "Library/Application Support/lime/computer-use/chrome",
        )
      : process.platform === "win32"
        ? path.join(
            process.env.LOCALAPPDATA,
            "LimeCloud/lime/computer-use/chrome",
          )
        : path.join(
            process.env.XDG_DATA_HOME ||
              path.join(os.homedir(), ".local/share"),
            "lime/computer-use/chrome",
          ));
  if (!process.env.LIME_CHROME_EXTENSION_DIR) {
    const installer = await fs.readFile(
      "lime-rs/crates/tool-runtime/src/computer_use/installation.rs",
      "utf8",
    );
    receipt.installedAssets = [];
    for (const [, name] of installer.matchAll(/asset!\("([^"]+)"\)/g)) {
      const bytes = await fs.readFile(path.join(extensionDirectory, name));
      assert.deepEqual(
        bytes,
        await fs.readFile(path.join("extensions/lime-chrome", name)),
        `stale compiled extension resource: ${name}`,
      );
      receipt.installedAssets.push({
        name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  const extension = await browserSession.send("Extensions.loadUnpacked", {
    path: extensionDirectory,
  });
  assert.equal(extension.id, "okipgpdaiijkenehohfgochhhlbifcbc");
  receipt.stage = "popup-native-tab-group";
  await page.goto(url);
  const worker = await waitUntil(() => context.serviceWorkers()[0]);
  const userGroup = await worker.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    const id = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(id, {
      title: "User existing group",
      color: "grey",
    });
    return { id, tabId: tab.id };
  }, url);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extension.id}/computer-use.html`);
  await popup.locator("#session-name").fill("🧪 测试环境发布验收");
  await popup.locator("#session-url").fill(`${url}?task=group`);
  await popup.locator("#task-tabs button[type=submit]").click();
  const taskPage = await waitUntil(() =>
    context.pages().find((p) => p.url() === `${url}?task=group`),
  );
  const taskGroup = await waitUntil(() =>
    worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ url });
      if (!tab || tab.groupId < 0) return null;
      const group = await chrome.tabGroups.get(tab.groupId);
      return group.title === "🧪 测试环境发布验收"
        ? { tabId: tab.id, ...group }
        : null;
    }, `${url}?task=group`),
  );
  assert.equal(taskGroup.title, "🧪 测试环境发布验收");
  assert(
    [
      "grey",
      "blue",
      "red",
      "yellow",
      "green",
      "pink",
      "purple",
      "cyan",
      "orange",
    ].includes(taskGroup.color),
  );
  await taskPage.getByRole("link", { name: "Open child" }).click();
  const childPage = await waitUntil(() =>
    context.pages().find((p) => p.url() === `${url}?child=1`),
  );
  await waitUntil(() =>
    worker.evaluate(
      async ({ url, groupId }) => {
        const [tab] = await chrome.tabs.query({ url });
        return tab?.groupId === groupId;
      },
      { url: `${url}?child=1`, groupId: taskGroup.id },
    ),
  );
  const stored = await worker.evaluate(() =>
    chrome.storage.session.get("TASK_TABS"),
  );
  assert.equal(Object.values(stored.TASK_TABS)[0].tabs.length, 2);
  await popup.screenshot({
    path: path.join(path.dirname(evidence), "chrome-task-group-popup.png"),
  });
  receipt.groups = {
    title: taskGroup.title,
    color: taskGroup.color,
    childJoined: true,
  };
  receipt.checks.push(
    "popup created a named native Chrome tab group; child tab joined without granting control",
  );
  await childPage.close();
  await taskPage.close();
  await popup.close();
  receipt.stage = "native-messaging-target-discovery";
  const target = await waitUntil(async () => {
    const status = await request("computerUse/status", { adapter: "chrome" });
    receipt.lastDiscovery = status.adapters[0];
    return status.adapters[0].targets?.find((t) => t.url === url);
  });
  receipt.checks.push(
    "isolated real Chrome loaded MV3 and discovered the exact profile/tab through native messaging",
  );
  const approveConsent = async (getFailure = () => null) => {
    const approval = await waitUntil(() => {
      const failure = getFailure();
      if (failure) throw failure;
      return context
        .pages()
        .find((p) => p.url().includes("computer-use.html?request="));
    });
    await approval
      .getByRole("button", {
        name: /Allow this tab|允许此标签页|允許此分頁|このタブを許可|이 탭 허용/,
      })
      .click();
  };
  const approveTarget = async () => {
    receipt.stage = "wait-for-native-target-snapshot";
    // Wait for popup/temporary-tab removals to reach Native Messaging before
    // opening consent. A stale generation must fail rather than be auto-approved.
    await waitUntil(async () => {
      const actual = await worker.evaluate(async () =>
        (await chrome.tabs.query({}))
          .filter((tab) => /^https?:\/\//.test(tab.url || ""))
          .map((tab) => ({ tabId: String(tab.id), url: tab.url })),
      );
      const status = await request("computerUse/status", { adapter: "chrome" });
      const targets = status.adapters[0].targets ?? [];
      return (
        targets.length === actual.length &&
        actual.every((tab) =>
          targets.some(
            (candidate) =>
              candidate.tabId === tab.tabId && candidate.url === tab.url,
          ),
        )
      );
    });
    receipt.stage = "native-target-consent";
    const setup = request("computerUse/setup", {
      adapter: "chrome",
      target,
      grantScope: "session",
    });
    let failure;
    void setup.catch((error) => {
      failure = error;
    });
    await approveConsent(() => failure);
    return setup;
  };
  let grant = await approveTarget();
  assert(grant.grant?.id);
  assert.equal(
    await worker.evaluate(
      async ({ tabId }) => (await chrome.tabs.get(tabId)).groupId,
      userGroup,
    ),
    userGroup.id,
  );
  receipt.checks.push(
    "approving an existing user tab preserved its original group",
  );
  receipt.checks.push(
    "explicit extension approval produced a connection-bound session grant",
  );
  receipt.stage = "canonical-model-tool-loop";
  const box = await page.locator("#result").boundingBox();
  const marker = "Lime Chrome 原生连接 🟢";
  const operation = (id, operation) => ({
    type: "tool_call",
    id,
    name: "computer_use",
    arguments: { target, operation },
  });
  const runtimeTabs = (receipt.runtimeGroups = {});
  const readTaskTabs = () =>
    worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return Promise.all(
        tabs
          .filter((tab) => tab.url?.startsWith(`${url}?runtime=`))
          .map(async (tab) => ({
            id: tab.id,
            url: tab.url,
            groupId: tab.groupId,
            group:
              tab.groupId >= 0 ? await chrome.tabGroups.get(tab.groupId) : null,
          })),
      );
    }, url);
  providerFixture = await startOpenAiCompatibleFixtureServer({
    modelToolMode: "direct",
    scriptedResponses: [
      operation("chrome-click", {
        action: "click",
        x: box.x + 20,
        y: box.y + 15,
        button: "left",
        count: 1,
      }),
      operation("chrome-type", { action: "type", text: marker }),
      operation("chrome-observe", {
        action: "observe",
        max_depth: 5,
        max_nodes: 64,
      }),
      operation("chrome-screenshot", { action: "screenshot" }),
      operation("chrome-name", {
        action: "name_session",
        name: "🧪 模型浏览器任务",
      }),
      operation("chrome-create-temporary", {
        action: "create_tab",
        url: `${url}?runtime=temporary`,
      }),
      operation("chrome-create-deliverable", {
        action: "create_tab",
        url: `${url}?runtime=deliverable`,
      }),
      async ({ body }) => {
        assert(
          JSON.stringify(body.messages.at(-1)).includes("approvalRequired"),
        );
        const tabs = await readTaskTabs();
        runtimeTabs.temporary = tabs.find((tab) =>
          tab.url.endsWith("=temporary"),
        ).id;
        runtimeTabs.deliverable = tabs.find((tab) =>
          tab.url.endsWith("=deliverable"),
        ).id;
        const unapproved = await waitUntil(async () => {
          const status = await request("computerUse/status", {
            adapter: "chrome",
          });
          return status.adapters[0].targets.find(
            (t) => t.tabId === String(runtimeTabs.deliverable),
          );
        });
        return {
          type: "tool_call",
          id: "chrome-unapproved-observe",
          name: "computer_use",
          arguments: {
            target: unapproved,
            operation: { action: "observe", max_depth: 1, max_nodes: 8 },
          },
        };
      },
      async ({ body }) => {
        const denied = body.messages.find(
          (message) =>
            message.role === "tool" &&
            message.tool_call_id === "chrome-unapproved-observe",
        );
        assert(
          denied && /grant|approv|授权/i.test(JSON.stringify(denied.content)),
          JSON.stringify(denied),
        );
        receipt.unapprovedPageProbe = {
          modelToolCallId: denied.tool_call_id,
          rejection: denied.content,
        };
        return operation("chrome-mark-deliverable", {
          action: "mark_tab",
          tab_id: runtimeTabs.deliverable,
          mark: "deliverable",
        });
      },
      operation("chrome-create-handoff", {
        action: "create_tab",
        url: `${url}?runtime=handoff`,
      }),
      async () => {
        const tabs = await readTaskTabs();
        runtimeTabs.handoff = tabs.find((tab) =>
          tab.url.endsWith("=handoff"),
        ).id;
        runtimeTabs.groupId = tabs[0].groupId;
        assert(
          tabs.length === 3 &&
            tabs.every(
              (tab) =>
                tab.groupId === runtimeTabs.groupId &&
                tab.group.title === "🧪 模型浏览器任务",
            ),
        );
        return operation("chrome-mark-handoff", {
          action: "mark_tab",
          tab_id: runtimeTabs.handoff,
          mark: "handoff",
        });
      },
      { type: "text", content: "CHROME_NATIVE_READBACK_OK" },
      operation("chrome-resume-name", {
        action: "name_session",
        name: "🟢 接续浏览任务",
      }),
      async () => {
        const tabs = await readTaskTabs();
        assert.equal(
          tabs.find((tab) => tab.id === runtimeTabs.handoff).group.title,
          "🟢 接续浏览任务",
        );
        return { type: "text", content: "CHROME_HANDOFF_RESUMED" };
      },
    ],
  });
  const provider = await provisionToolExecutionFixtureProvider({
    fixture: providerFixture,
    invoke: (_, method, params) => request(method, params),
  });
  await request("modelProvider/fetchModels", {
    providerId: provider.providerPreference,
  });
  const { thread } = await request(
    "thread/start",
    buildToolExecutionThreadStartParams({
      provider,
      title: "Chrome native fixture",
      workspaceRoot: productHost.workspaceRoot,
    }),
  );
  await productHost.prepareThread(thread, provider);
  const { turn } = await productHost.startTurn({
    thread,
    provider,
    target,
    approveConsent,
    finalText: "CHROME_NATIVE_READBACK_OK",
    prompt:
      "Write the fixture marker in the approved tab, observe it, and capture a screenshot.",
  });
  const canonical = await waitUntil(async () => {
    const { thread: read } = await request("thread/read", {
      threadId: thread.id,
      includeTurns: true,
    });
    const found = read.turns.find((t) => t.id === turn.id);
    return found?.status !== "inProgress" ? found : null;
  }, 60000);
  receipt.canonicalTurn = {
    id: canonical.id,
    status: canonical.status,
    error: canonical.error,
    providerRequests: providerFixture.requests.length,
    items: canonical.items.map(
      ({ id, type, tool, status, success, contentItems }) => ({
        id,
        type,
        tool,
        status,
        success,
        contentItems: contentItems?.map((content) =>
          typeof content.text === "string"
            ? { type: content.type, text: content.text.slice(0, 4096) }
            : { type: content.type },
        ),
      }),
    ),
  };
  assert.equal(
    canonical.status,
    "completed",
    JSON.stringify(receipt.canonicalTurn),
  );
  const tools = canonical.items.filter(
    (item) => item.type === "dynamicToolCall" && item.tool === "computer_use",
  );
  assert.equal(tools.length, 11);
  assert(
    tools.every(
      (tool) =>
        tool.status ===
        (tool.id === "item_chrome-unapproved-observe" ? "failed" : "completed"),
    ),
    JSON.stringify(
      tools.map(({ id, status, result, error }) => ({
        id,
        status,
        result,
        error,
      })),
    ),
  );
  await productHost.finishTurn(thread, canonical, "CHROME_NATIVE_READBACK_OK");
  assert.equal(await page.locator("#result").inputValue(), marker);
  assert.equal(await page.locator("#readback").textContent(), marker);
  const readback = providerFixture.requests
    .at(-1)
    .body.messages.filter((message) => message.role === "tool");
  assert(
    readback.some(
      (message) =>
        message.tool_call_id === "chrome-observe" &&
        JSON.stringify(message.content).includes(marker),
    ),
  );
  receipt.turn = {
    threadId: thread.id,
    turnId: turn.id,
    toolItems: tools.map(({ id, status }) => ({ id, status })),
    providerRequests: providerFixture.requests.length,
    liveModelUsed: false,
  };
  receipt.checks.push(
    "canonical click/type/DOM observe/screenshot completed and marker reached actual page and provider readback",
  );
  receipt.stage = "first-turn-browser-cleanup";
  await waitUntil(async () => {
    const tabs = await readTaskTabs();
    receipt.lastTaskTabs = tabs;
    return (
      !tabs.some((tab) => tab.id === runtimeTabs.temporary) &&
      tabs.some(
        (tab) => tab.id === runtimeTabs.deliverable && tab.groupId === -1,
      ) &&
      tabs.some(
        (tab) =>
          tab.id === runtimeTabs.handoff && tab.groupId === runtimeTabs.groupId,
      )
    );
  });
  assert.equal(
    await worker.evaluate(
      async ({ tabId }) => (await chrome.tabs.get(tabId)).groupId,
      userGroup,
    ),
    userGroup.id,
  );
  receipt.runtimeGroups = {
    ...runtimeTabs,
    temporaryClosed: true,
    deliverableReleased: true,
    handoffGrouped: true,
    newTabInheritedGrant: false,
  };
  receipt.checks.push(
    "canonical model actions created and named native groups; new tabs did not inherit source consent; terminal closed only temporary tabs",
  );
  // Closing temporary pages invalidates document authority, so request fresh consent.
  await request("computerUse/status", { adapter: "chrome" });
  grant = await approveTarget();
  const resumed = await productHost.startTurn({
    thread,
    provider,
    target,
    approveConsent,
    finalText: "CHROME_HANDOFF_RESUMED",
    prompt:
      "Resume the handoff task, rename it and finish without preserving it again.",
  });
  receipt.stage = "resumed-canonical-model-turn";
  const resumedCanonical = await waitUntil(async () => {
    const { thread: read } = await request("thread/read", {
      threadId: thread.id,
      includeTurns: true,
    });
    const found = read.turns.find((t) => t.id === resumed.turn.id);
    return found?.status !== "inProgress" ? found : null;
  }, 60000);
  assert.equal(resumedCanonical.status, "completed");
  const resumedTool = resumedCanonical.items.find(
    (item) => item.type === "dynamicToolCall" && item.tool === "computer_use",
  );
  assert.equal(
    resumedTool?.status,
    "completed",
    JSON.stringify(resumedCanonical),
  );
  await productHost.finishTurn(
    thread,
    resumedCanonical,
    "CHROME_HANDOFF_RESUMED",
  );
  await productHost.verifyVisible(thread);
  receipt.stage = "resumed-turn-browser-cleanup";
  await waitUntil(
    async () =>
      !(await readTaskTabs()).some((tab) => tab.id === runtimeTabs.handoff),
  );
  assert(
    (await readTaskTabs()).some((tab) => tab.id === runtimeTabs.deliverable),
  );
  receipt.runtimeGroups.resumedTurnId = resumed.turn.id;
  receipt.runtimeGroups.unmarkedHandoffClosed = true;
  receipt.checks.push(
    "a second canonical turn resumed and renamed the handoff group; its old mark did not survive, while the deliverable and user tabs stayed open",
  );
  const revoked = await request("computerUse/revoke", {
    grantId: grant.grant.id,
  });
  assert.equal(revoked.revoked, true);
  const remaining = await request("computerUse/status", { adapter: "chrome" });
  assert(!remaining.grants?.some((g) => g.id === grant.grant.id));
  receipt.checks.push(
    "session grant revocation removed further control authority",
  );
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  await page.screenshot({
    path: path.join(path.dirname(evidence), "chrome-readback.png"),
  });
  await context.close();
  context = null;
  receipt.stage = "chrome-disconnect";
  await waitUntil(async () => {
    const state = await request("computerUse/status", { adapter: "chrome" });
    return state.adapters[0].readiness !== "ready";
  });
  receipt.checks.push("Chrome exit invalidated connected target readiness");
  receipt.stage = "complete";
  receipt.result = "pass";
} catch (error) {
  receipt.result = "fail";
  receipt.error = error.stack || String(error);
  receipt.providerErrors = providerFixture?.requests
    .filter((entry) => entry.responseError)
    .map(({ responseError }) => ({ responseError }));
  receipt.stderr = productHost?.stderr;
  await productHost?.captureFailure().catch((error) => {
    receipt.desktopCaptureError = String(error);
  });
  receipt.extensionState = await context
    ?.serviceWorkers()[0]
    ?.evaluate(() => chrome.storage.session.get(["connected", "error"]))
    .catch(() => null);
  receipt.extensionLocal = await context
    ?.serviceWorkers()[0]
    ?.evaluate(() => chrome.storage.local.get(["profileId", "TAB_GROUPS"]))
    .catch(() => null);
  receipt.extensionTasks = await context
    ?.serviceWorkers()[0]
    ?.evaluate(() => chrome.storage.session.get(["TASK_TABS", "ENDED_TURNS"]))
    .catch(() => null);
  // Probe a separate framing connection only after failure. This distinguishes
  // host launch/loader errors from a stalled extension connection without
  // creating a grant or manufacturing a runtime tool result.
  receipt.nativeHostProbe = await context
    ?.serviceWorkers()[0]
    ?.evaluate(
      () =>
        new Promise((resolve) => {
          const probe = chrome.runtime.connectNative(
            "com.limecloud.lime.computer_use",
          );
          let finished = false;
          const finish = (result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve(result);
            probe.disconnect();
          };
          const timer = setTimeout(
            () => finish({ error: "Native host probe timed out" }),
            5000,
          );
          probe.onDisconnect.addListener(() =>
            finish({
              error:
                chrome.runtime.lastError?.message || "Native host disconnected",
            }),
          );
          probe.onMessage.addListener((message) =>
            finish({ protocol: message.protocol }),
          );
          probe.postMessage({
            snapshot: {
              generation: 1,
              readiness: "ready",
              targets: [],
              reason: null,
              setupSteps: [],
            },
            responses: [],
          });
        }),
    )
    .catch((error) => ({ error: String(error) }));
} finally {
  await context?.close().catch(() => {});
  receipt.chromeLog = (
    await fs.readFile(chromeLog, "utf8").catch(() => "")
  ).slice(-12000);
  await providerFixture?.close?.();
  await new Promise((resolve) => fixture.close(resolve));
  await productHost?.close();
  if (originalManifest)
    await fs.writeFile(nativeManifest, originalManifest, { mode: 0o600 });
  else if (originalManifest === null)
    await fs.rm(nativeManifest, { force: true });
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  receipt.completedAt = new Date().toISOString();
  await fs.writeFile(evidence, JSON.stringify(receipt, null, 2) + "\n");
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  console.log(JSON.stringify(receipt, null, 2));
}
process.exitCode = receipt.result === "pass" ? 0 : 1;
