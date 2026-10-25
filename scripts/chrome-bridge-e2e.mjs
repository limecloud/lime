// Real Chrome MV3 -> Native Messaging -> shared App Server -> canonical tool loop.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { prepareLocalAppServerBinary } from "./lib/electron-dev-sidecar.mjs";
import { terminalGateRuntimeEnvironment } from "./app-server/terminal-gate-binaries.mjs";
import { startOpenAiCompatibleFixtureServer } from "./lib/openai-compatible-fixture-server.mjs";
import {
  buildToolExecutionThreadStartParams,
  provisionToolExecutionFixtureProvider,
} from "./agent-runtime/tool-execution-current-contract.mjs";

const source = path.resolve(
  process.env.APP_SERVER_BIN ||
    `lime-rs/target/debug/app-server${process.platform === "win32" ? ".exe" : ""}`,
);
const evidence = path.resolve(
  process.env.LIME_CHROME_EVIDENCE ||
    ".lime/qc/computer-use-integrations-20261025/chrome.json",
);
const root = await fs.mkdtemp(path.join(os.tmpdir(), "lime-chrome-native-"));
const receipt = {
  startedAt: new Date().toISOString(),
  claimBoundary:
    "Real installed Google Chrome, MV3, Native Messaging, runtime stdio App Server and canonical model tool loop; loopback provider fixture, no live model or Desktop/CLI-host Gate B claim",
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
let originalManifest,
  child,
  lines,
  context,
  providerFixture,
  stderr = "";
const pending = new Map();
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
  throw new Error("Condition timed out");
};
let seq = 0;
function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 70000);
    pending.set(id, {
      resolve(value) {
        clearTimeout(timer);
        resolve(value);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
  });
}
try {
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  prepareLocalAppServerBinary({ binaryPath: source });
  originalManifest = await fs.readFile(nativeManifest).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  await fs.writeFile(
    path.join(root, "config.yaml"),
    "server:\n  api_key: fixture-only\nfeatures:\n  computer_use: false\n  chrome_use: true\n  office_use: false\n",
  );
  child = spawn(
    source,
    [
      "--backend",
      "runtime",
      "--data-dir",
      path.join(root, "data"),
      "--app-data-dir",
      path.join(root, "app"),
    ],
    {
      env: {
        ...terminalGateRuntimeEnvironment({ appServerBinaryPath: source }),
        LIME_CONFIG_PATH: path.join(root, "config.yaml"),
        LIME_AGENT_RUNTIME_ROOT: path.join(root, "runtime"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stderr.on("data", (bytes) => {
    stderr = (stderr + bytes).slice(-6000);
  });
  child.on("exit", (code) => {
    for (const call of pending.values())
      call.reject(new Error(`App Server exited ${code}: ${stderr}`));
    pending.clear();
  });
  lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const value = JSON.parse(line);
      const call = pending.get(value.id);
      if (!call) return;
      pending.delete(value.id);
      value.error
        ? call.reject(new Error(JSON.stringify(value.error)))
        : call.resolve(value.result);
    } catch {}
  });
  await request("initialize", {
    clientInfo: { name: "chrome-native-fixture", version: "1" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n",
  );
  const installed = await request("computerUse/setup", {
    adapter: "chrome",
    grantScope: "session",
  });
  assert.equal(installed.accepted, true);
  const host = JSON.parse(await fs.readFile(nativeManifest, "utf8"));
  assert.equal(host.path, source);
  assert.deepEqual(host.allowed_origins, [
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
  const target = await waitUntil(async () => {
    const status = await request("computerUse/status", { adapter: "chrome" });
    receipt.lastDiscovery = status.adapters[0];
    return status.adapters[0].targets?.find((t) => t.url === url);
  });
  receipt.checks.push(
    "isolated real Chrome loaded MV3 and discovered the exact profile/tab through native messaging",
  );
  const approveTarget = async () => {
    const setup = request("computerUse/setup", {
      adapter: "chrome",
      target,
      grantScope: "session",
    });
    void setup.catch(() => {});
    const approval = await waitUntil(() =>
      context
        .pages()
        .find((p) => p.url().includes("computer-use.html?request=")),
    );
    await approval
      .getByRole("button", {
        name: /Allow this tab|允许此标签页|允許此分頁|このタブを許可|이 탭 허용/,
      })
      .click();
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
  const box = await page.locator("#result").boundingBox();
  const marker = "Lime Chrome 原生连接 🟢";
  const operation = (id, operation) => ({
    type: "tool_call",
    id,
    name: "computer_use",
    arguments: { target, operation },
  });
  const runtimeTabs = {};
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
        const status = await request("computerUse/status", {
          adapter: "chrome",
        });
        const unapproved = status.adapters[0].targets.find(
          (t) => t.tabId === String(runtimeTabs.deliverable),
        );
        await assert.rejects(
          request("computerUse/lease/acquire", {
            adapter: "chrome",
            target: unapproved,
            threadId: thread.id,
            turnId: turn.id,
            capability: "observe",
            grantId: grant.grant.id,
          }),
          /Grant does not cover/,
        );
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
      workspaceRoot: root,
    }),
  );
  const { turn } = await request("turn/start", {
    threadId: thread.id,
    input: [
      {
        type: "text",
        text: "Write the fixture marker in the approved tab, observe it, and capture a screenshot.",
      },
    ],
    approvalPolicy: "never",
  });
  const canonical = await waitUntil(async () => {
    const { thread: read } = await request("thread/read", {
      threadId: thread.id,
      includeTurns: true,
    });
    const found = read.turns.find((t) => t.id === turn.id);
    return found?.status !== "inProgress" ? found : null;
  }, 60000);
  assert.equal(canonical.status, "completed");
  const tools = canonical.items.filter(
    (item) => item.type === "dynamicToolCall" && item.tool === "computer_use",
  );
  assert.equal(tools.length, 10);
  assert(
    tools.every((tool) => tool.status === "completed"),
    JSON.stringify(
      tools.map(({ id, status, result, error }) => ({
        id,
        status,
        result,
        error,
      })),
    ),
  );
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
  await waitUntil(async () => {
    const tabs = await readTaskTabs();
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
  const resumed = await request("turn/start", {
    threadId: thread.id,
    input: [
      {
        type: "text",
        text: "Resume the handoff task, rename it and finish without preserving it again.",
      },
    ],
    approvalPolicy: "never",
  });
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
  await waitUntil(async () => {
    const state = await request("computerUse/status", { adapter: "chrome" });
    return state.adapters[0].readiness !== "ready";
  });
  receipt.checks.push("Chrome exit invalidated connected target readiness");
  receipt.result = "pass";
} catch (error) {
  receipt.result = "fail";
  receipt.error = String(error);
  receipt.stderr = stderr;
  receipt.extensionState = await context
    ?.serviceWorkers()[0]
    ?.evaluate(() => chrome.storage.session.get(["connected", "error"]))
    .catch(() => null);
  receipt.extensionLocal = await context
    ?.serviceWorkers()[0]
    ?.evaluate(() => chrome.storage.local.get(["profileId", "TAB_GROUPS"]))
    .catch(() => null);
} finally {
  await context?.close().catch(() => {});
  await providerFixture?.close?.();
  await new Promise((resolve) => fixture.close(resolve));
  lines?.close();
  if (child && child.exitCode === null) {
    child.stdin.end();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) =>
        setTimeout(() => {
          child.kill();
          resolve();
        }, 3000),
      ),
    ]);
  }
  if (originalManifest)
    await fs.writeFile(nativeManifest, originalManifest, { mode: 0o600 });
  else await fs.rm(nativeManifest, { force: true });
  await fs.mkdir(path.dirname(evidence), { recursive: true });
  receipt.completedAt = new Date().toISOString();
  await fs.writeFile(evidence, JSON.stringify(receipt, null, 2) + "\n");
  await fs.rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(receipt, null, 2));
}
process.exitCode = receipt.result === "pass" ? 0 : 1;
