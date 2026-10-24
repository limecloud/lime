import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright";
import { parse } from "yaml";
import { ensureElectronFixtureBuild } from "../lib/electron-fixture-build.mjs";
import { resolveDevAppServerBinary } from "../lib/electron-dev-sidecar.mjs";
import { resolveElectronAppServerRuntimeEnv } from "../lib/electron-app-server-assets.mjs";
import { createTempRuntimeEnv } from "../agent-runtime/claw-chat-current-fixture-backend-file.mjs";
import {
  initializeAppServer,
  waitForRendererReady,
} from "../agent-runtime/claw-chat-current-fixture-rpc.mjs";
import {
  readConfigFromPage,
  writeConfigEditsFromPage,
} from "./mcp-config-fixture-smoke.mjs";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "./lib/mcp-config-fixture-evidence.mjs";

/** Real settings/config only. DOM input is synthetic; no provider or Agent turn is claimed. */
export async function runBrowserSettingsConflict({ locale, output }) {
  assert.ok(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"].includes(locale));
  ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "[browser-settings]",
  });
  await fs.mkdir(output, { recursive: true });
  const runtime = createTempRuntimeEnv();
  runtime.writeFixtureConfig({ language: locale });
  const binary = resolveDevAppServerBinary({
    env: runtime.env,
    repoRoot: process.cwd(),
  });
  const runtimeEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtime.env, APP_SERVER_BIN: binary },
  });
  const labels = JSON.parse(
    await fs.readFile(`src/i18n/resources/${locale}/settings.json`, "utf8"),
  );
  const label = (key) => labels[`settings.browser.${key}`];
  const evidence = {
    scenario: "browser-settings-conflict",
    locale,
    result: "fail",
    proofLevel: "Desktop settings/config slice",
    syntheticDomInput: true,
    physicalInput: false,
    providerTurn: false,
    bridgeReplacement: false,
    checks: [],
    screenshots: [],
    captureFrames: [],
    diagnostics: { pageErrors: [], consoleErrors: [] },
  };
  const check = (name, condition) => {
    assert.ok(condition, name);
    evidence.checks.push(name);
  };
  let app;
  let stage;
  const click = (locator) => locator.evaluate((node) => node.click());
  const launch = async () => {
    app = await electron.launch({
      executablePath: electronPath,
      args: [
        "--use-mock-keychain",
        path.resolve("scripts/electron/lib/browser-settings-host.mjs"),
      ],
      cwd: process.cwd(),
      env: {
        ...runtime.env,
        ...runtimeEnv,
        APP_SERVER_BACKEND_MODE: "runtime",
        ELECTRON_E2E_USER_DATA_DIR: runtime.electronUserDataDir,
        LIME_ELECTRON_E2E: "1",
        LIME_ELECTRON_BRAND_DEV_APP: "0",
        LIME_ELECTRON_DEV_HTTP_BRIDGE: "0",
        LIME_BROWSER_SETTINGS_ROOT: process.cwd(),
      },
      timeout: 90000,
    });
    const page = await app.firstWindow({ timeout: 90000 });
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) =>
      evidence.diagnostics.pageErrors.push(String(error)),
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        evidence.diagnostics.consoleErrors.push(message.text());
    });
    await (
      await app.browserWindow(page)
    ).evaluate((window) => window.setContentSize(1200, 1100));
    await waitForRendererReady(
      page,
      { timeoutMs: 90000, intervalMs: 250 },
      () => undefined,
    );
    await initializeAppServer(page, []);
    check(
      `real-preload-${evidence.checks.length}`,
      await page.evaluate(
        () =>
          window.__LIME_ELECTRON__ === true &&
          window.electronAPI?.devBridgeFallback === false,
      ),
    );
    if ((await page.evaluate(() => document.documentElement.lang)) !== locale) {
      await click(page.getByTestId("app-sidebar-nav-settings"));
      await click(page.getByTestId("settings-sidebar-tab-general"));
      await page
        .locator("#general-language select")
        .evaluate((select, value) => {
          select.value = value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }, locale);
      await page.waitForFunction(
        (expected) => document.documentElement.lang === expected,
        locale,
      );
      await click(page.getByTestId("settings-back-button"));
    }
    check(
      `locale-${evidence.checks.length}`,
      await page.evaluate(
        (expected) => document.documentElement.lang === expected,
        locale,
      ),
    );
    return page;
  };
  const open = async (page) => {
    await click(page.getByTestId("app-sidebar-nav-settings"));
    await click(page.getByTestId("settings-sidebar-tab-browser-use"));
    await page.waitForFunction(() => {
      const select = document.querySelector(
        "#browser-agent-permissions select",
      );
      return select && !select.disabled;
    });
  };
  const screenshot = async (page, name, target) => {
    const nativeWindow = await app.browserWindow(page);
    const native = await nativeWindow.evaluate((window) => {
      const contents = window.webContents;
      const throttling = contents.getBackgroundThrottling();
      // 仅在隐藏夹具截图期间等待实际渲染帧，随后恢复原设置。
      contents.setBackgroundThrottling(false);
      return { webContentsId: contents.id, throttling };
    });
    try {
      const geometry = await target.evaluate(async (node) => {
        node.scrollIntoView({
          block: "center",
          behavior: "instant",
          container: "nearest",
        });
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Settings capture frame timeout")),
            5000,
          );
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(timeout);
              resolve();
            }),
          );
        });
        const { x, y, width, height } = node.getBoundingClientRect();
        return {
          x,
          y,
          width,
          height,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          shellScrollX: scrollX,
          shellScrollY: scrollY,
        };
      });
      assert.ok(
        geometry.width > 0 &&
          geometry.height > 0 &&
          geometry.x >= 0 &&
          geometry.y >= 0 &&
          geometry.shellScrollX === 0 &&
          geometry.shellScrollY === 0 &&
          geometry.x + geometry.width <= geometry.viewportWidth &&
          geometry.y + geometry.height <= geometry.viewportHeight,
        `${name} capture target must fit inside the viewport`,
      );
      const png = await app.evaluate(async ({ webContents }, id) => {
        const capture = await webContents
          .fromId(id)
          .capturePage(undefined, { stayHidden: true });
        if (capture.isEmpty()) throw new Error("Empty settings capture");
        return capture.toPNG().toString("base64");
      }, native.webContentsId);
      const file = `${locale}-${name}.png`;
      await fs.writeFile(path.join(output, file), Buffer.from(png, "base64"));
      evidence.screenshots.push(file);
      evidence.captureFrames.push({
        file,
        geometry,
        temporaryUnthrottling: true,
      });
    } finally {
      await nativeWindow.evaluate((window, throttling) => {
        window.webContents.setBackgroundThrottling(throttling);
      }, native.throttling);
    }
  };
  try {
    stage = "open";
    let page = await launch();
    const original = await readConfigFromPage(page);
    const browser = structuredClone(original.config.browser ?? {});
    browser.approvalMode = "alwaysAsk";
    for (const key of [
      "allowedOrigins",
      "deniedOrigins",
      "allowedDownloadOrigins",
      "deniedDownloadOrigins",
      "allowedUploadOrigins",
      "deniedUploadOrigins",
      "allowedFullCdpOrigins",
      "deniedFullCdpOrigins",
      "allowedWebMcpOrigins",
      "deniedWebMcpOrigins",
    ])
      browser[key] = [];
    // Config owner 省略全默认 BrowserConfig；固定一项非默认值以观察完整持久对象。
    browser.show_full_url = true;
    await writeConfigEditsFromPage(page, {
      expectedVersion: original.version,
      edits: [
        { keyPath: "browser", value: browser, mergeStrategy: "replace" },
        { keyPath: "browser_use", value: {}, mergeStrategy: "replace" },
      ],
    });
    await open(page);
    stage = "edit";
    await click(
      page
        .locator("#browser-agent-permissions")
        .getByRole("button", { name: label("add"), exact: true }),
    );
    await page.locator("#browser-site-pattern").evaluate((input) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, "https://example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = await readConfigFromPage(page);
    const changed = {
      ...before.config.browser_use,
      default_origin_policy: {
        ...before.config.browser_use?.default_origin_policy,
        access: "deny",
      },
    };
    await writeConfigEditsFromPage(page, {
      expectedVersion: before.version,
      edits: [
        { keyPath: "browser_use", value: changed, mergeStrategy: "replace" },
      ],
    });
    const submit = () =>
      page
        .locator("#browser-agent-permissions form")
        .evaluate((form) => form.requestSubmit());
    stage = "conflict";
    await submit();
    await page
      .getByRole("alert")
      .filter({ hasText: label("error.conflict") })
      .waitFor();
    check(
      "draft-preserved",
      (await page.locator("#browser-site-pattern").inputValue()) ===
        "https://example.com",
    );
    check(
      "matrix-restored",
      (await page
        .locator("#browser-agent-permissions select")
        .first()
        .inputValue()) === "deny",
    );
    const rejected = await readConfigFromPage(page);
    check(
      "no-rule-created-on-conflict",
      Object.keys(rejected.config.browser_use?.origins ?? {}).length === 0,
    );
    check(
      "remote-denial-retained",
      rejected.config.browser_use?.default_origin_policy?.access === "deny",
    );
    await screenshot(
      page,
      "conflict",
      page.getByRole("alert").filter({ hasText: label("error.conflict") }),
    );
    await screenshot(
      page,
      "conflict-matrix",
      page.locator("#browser-agent-permissions"),
    );
    stage = "retry";
    await submit();
    await page.locator("#browser-site-pattern").waitFor({ state: "detached" });
    const saved = await readConfigFromPage(page);
    check(
      "matched-config-response",
      isObservedPreloadAppServerResponse(
        saved.response.ipcObservation,
        "config/read",
      ),
    );
    const rule = saved.config.browser_use?.origins?.["https://example.com"];
    check(
      "explicit-retry-inherits-current-denial",
      rule != null &&
        saved.config.browser_use?.default_origin_policy?.access === "deny",
    );
    check(
      "unrelated-config-preserved",
      JSON.stringify(
        Object.fromEntries(
          Object.entries(saved.config).filter(
            ([key]) => key !== "browser" && key !== "browser_use",
          ),
        ),
      ) ===
        JSON.stringify(
          Object.fromEntries(
            Object.entries(original.config).filter(
              ([key]) => key !== "browser" && key !== "browser_use",
            ),
          ),
        ),
    );
    check(
      "disk-same-profile",
      Boolean(
        saved.filePath &&
        path
          .resolve(saved.filePath)
          .startsWith(path.resolve(runtime.tempRoot) + path.sep),
      ),
    );
    stage = "site-override";
    const siteSelector =
      '[data-browser-permission-action="browse"][data-browser-permission-pattern="https://example.com"]';
    const selectSite = async (page, value) => {
      await page.locator(siteSelector).evaluate((select, value) => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
      await page.waitForFunction(
        ({ selector, value }) => {
          const select = document.querySelector(selector);
          return select?.value === value && !select.disabled;
        },
        { selector: siteSelector, value },
      );
      return readConfigFromPage(page);
    };
    const granted = await selectSite(page, "allow");
    check(
      "site-policy-and-native-grant-saved",
      granted.config.browser_use?.origins?.["https://example.com"]?.access ===
        "allow" &&
        granted.config.browser?.allowedOrigins?.includes("https://example.com"),
    );
    const disk = parse(await fs.readFile(granted.filePath, "utf8"));
    check(
      "actual-file-persisted",
      disk.browser_use?.origins?.["https://example.com"]?.access === "allow" &&
        disk.browser?.allowedOrigins?.includes("https://example.com") &&
        disk.browser_use?.default_origin_policy?.access === "deny",
    );
    const trace = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("lime_invoke_trace_buffer_v1") || "[]"),
    );
    const requests = parseJsonRpcRequestsFromInvokeTrace(JSON.stringify(trace));
    const gatewayWrites = requests.filter(
      (request) =>
        request.method === "config/batchWrite" &&
        request.params.edits?.some(
          (edit) =>
            edit.keyPath === "browser" || edit.keyPath === "browser_use",
        ) &&
        !String(request.id).startsWith("mcp-config-fixture-"),
    );
    evidence.guiWrites = gatewayWrites.map((request) => ({
      id: request.id,
      expectedVersion: request.params.expectedVersion,
    }));
    check(
      "gui-used-stale-then-current-cas",
      gatewayWrites.length === 3 &&
        typeof gatewayWrites[0].params.expectedVersion === "string" &&
        gatewayWrites[0].params.expectedVersion !== rejected.version &&
        gatewayWrites[1].params.expectedVersion === rejected.version &&
        gatewayWrites[2].params.expectedVersion === saved.version,
    );
    check(
      "site-policy-and-native-grant-in-one-cas",
      ["browser", "browser_use"].every((key) =>
        gatewayWrites[2].params.edits.some((edit) => edit.keyPath === key),
      ),
    );
    evidence.ipc = {
      entries: trace.length,
      currentTransport: trace.filter(
        (entry) =>
          entry.command === "app_server_handle_json_lines" &&
          entry.transport === "electron-ipc",
      ).length,
      methods: [...new Set(requests.map((request) => request.method))],
    };
    check("real-ipc", evidence.ipc.currentTransport > 0);
    check(
      "current-methods",
      evidence.ipc.methods.includes("config/read") &&
        evidence.ipc.methods.includes("config/batchWrite"),
    );
    check(
      "no-production-fallback",
      trace.every((entry) => !/mock|legacy/.test(entry.transport || "")),
    );
    const native = await app.evaluate(
      () => globalThis.__browserSettingsHostEvidence,
    );
    check(
      "native-preload-clean",
      native.preloadErrors.length === 0 && native.unexpectedShowEvents === 0,
    );
    await app.close();
    app = null;
    stage = "restart";
    page = await launch();
    await open(page);
    check(
      "restart-rule-visible",
      (await page
        .getByRole("rowheader", { name: "https://example.com", exact: true })
        .count()) === 1,
    );
    check(
      "restart-denial-visible",
      (await page
        .locator("#browser-agent-permissions select")
        .first()
        .inputValue()) === "deny",
    );
    check(
      "restart-site-grant-visible",
      (await page.locator(siteSelector).inputValue()) === "allow",
    );
    const restarted = await readConfigFromPage(page);
    check(
      "restart-site-policy-and-native-grant-retained",
      restarted.config.browser_use?.origins?.["https://example.com"]?.access ===
        "allow" &&
        restarted.config.browser?.allowedOrigins?.includes(
          "https://example.com",
        ),
    );
    const inheritedSelectLayout = await page
      .locator(
        '[data-browser-permission-action="download"][data-browser-permission-pattern="https://example.com"]',
      )
      .evaluate((select) => {
        const style = getComputedStyle(select);
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Select text measurement is unavailable");
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const textWidth = context.measureText(
          select.selectedOptions[0].textContent,
        ).width;
        const paddingRight = parseFloat(style.paddingRight);
        const available =
          select.clientWidth - parseFloat(style.paddingLeft) - paddingRight;
        return { textWidth, available, paddingRight };
      });
    check(
      "inherited-value-text-clears-native-arrow",
      inheritedSelectLayout.textWidth <=
        inheritedSelectLayout.available + 0.5 &&
        inheritedSelectLayout.paddingRight >= 24,
    );
    evidence.inheritedSelectLayout = inheritedSelectLayout;
    await screenshot(
      page,
      "restarted",
      page.locator("#browser-agent-permissions"),
    );
    stage = "restore-default";
    const inherited = await selectSite(page, "default");
    check(
      "default-clears-site-policy-and-native-grant",
      inherited.config.browser_use?.origins?.["https://example.com"]?.access ==
        null &&
        !inherited.config.browser?.allowedOrigins?.includes(
          "https://example.com",
        ) &&
        !inherited.config.browser?.deniedOrigins?.includes(
          "https://example.com",
        ) &&
        inherited.config.browser_use?.default_origin_policy?.access === "deny",
    );
    await page.waitForFunction((selector) => {
      const select = document.querySelector(selector);
      return (
        select?.value === "default" &&
        select.dataset.browserPermissionEffective === "deny" &&
        !select.disabled
      );
    }, siteSelector);
    check(
      "inherited-denial-has-accessible-description",
      await page.locator(siteSelector).evaluate((node) => {
        const description = document.getElementById(
          node.getAttribute("aria-describedby"),
        );
        return (
          Boolean(description?.textContent.trim()) &&
          !description.textContent.includes("settings.")
        );
      }),
    );
    stage = "inherited-rule-restriction";
    await writeConfigEditsFromPage(page, {
      expectedVersion: inherited.version,
      edits: [
        {
          keyPath: "browser_use",
          mergeStrategy: "replace",
          value: {
            ...inherited.config.browser_use,
            origins: {
              ...inherited.config.browser_use?.origins,
              "example.com": { access: "deny" },
              "https://example.com": { access: "allow" },
            },
          },
        },
        {
          keyPath: "browser",
          mergeStrategy: "replace",
          value: {
            ...inherited.config.browser,
            allowedOrigins: ["https://example.com"],
          },
        },
      ],
    });
    await click(page.getByTestId("settings-back-button"));
    await open(page);
    await page.waitForFunction((selector) => {
      const select = document.querySelector(selector);
      return (
        select?.value === "allow" &&
        select.dataset.browserPermissionEffective === "deny" &&
        !select.disabled
      );
    }, siteSelector);
    check(
      "saved-allow-remains-visible-under-covering-denial",
      (await page.locator(siteSelector).inputValue()) === "allow",
    );
    check(
      "covering-denial-shows-actual-blocking-pattern",
      await page.locator(siteSelector).evaluate((node) => {
        const description = document.getElementById(
          node.getAttribute("aria-describedby"),
        );
        return (
          description?.textContent.includes("example.com") &&
          !description.textContent.includes("settings.")
        );
      }),
    );
    const blocked = await readConfigFromPage(page);
    check(
      "restriction-projection-does-not-rewrite-saved-grant",
      blocked.config.browser_use?.origins?.["https://example.com"]?.access ===
        "allow" &&
        blocked.config.browser_use?.origins?.["example.com"]?.access ===
          "deny" &&
        blocked.config.browser?.allowedOrigins?.includes("https://example.com"),
    );
    await screenshot(
      page,
      "inherited-restriction",
      page.locator("#browser-agent-permissions"),
    );
    check(
      "renderer-clean",
      evidence.diagnostics.pageErrors.length === 0 &&
        evidence.diagnostics.consoleErrors.length === 0,
    );
    evidence.result = "pass";
  } catch (error) {
    evidence.failure = { stage, message: String(error) };
    throw error;
  } finally {
    if (app) await app.close();
    await fs.writeFile(
      path.join(output, `${locale}-summary.json`),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    // 留存隔离 profile 供失败排查，不触及用户资料或未知进程。
  }
  return evidence;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const [locale, output] = process.argv.slice(2);
  assert.ok(
    output && path.isAbsolute(output),
    "Supply locale and an absolute evidence directory",
  );
  const result = await runBrowserSettingsConflict({ locale, output });
  console.log(
    `[browser-settings] ${locale}: ${result.checks.length} checks passed`,
  );
}
