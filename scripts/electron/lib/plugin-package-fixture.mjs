import fs from "node:fs";
import path from "node:path";
import {
  appServerCallFromPage,
  assert,
  parseJsonRpcRequestsFromInvokeTrace,
  sleep,
} from "../mcp-config-fixture-smoke.mjs";

export const PLUGIN_PACKAGE_NAME = "mcp-elicitation-plugin";
export const PLUGIN_PACKAGE_ID = `${PLUGIN_PACKAGE_NAME}@local`;
export const PLUGIN_PACKAGE_CONFIG_NAME = PLUGIN_PACKAGE_ID;
export const PLUGIN_PACKAGE_SERVER_ID = "demo";
export const PLUGIN_PACKAGE_SKILL_ID = "release-check";
export const PLUGIN_PACKAGE_SKILL_BODY_MARKER =
  "Use the package MCP release check tool when the user asks for a release check.";
export const PLUGIN_PACKAGE_DISPLAY_NAME = PLUGIN_PACKAGE_NAME;
const PLUGIN_PACKAGE_BUNDLED_ID = "browser@openai-bundled";
const PLUGIN_PACKAGE_BUNDLED_MARKETPLACE_ID = "openai-bundled";
const PLUGIN_PACKAGE_BUNDLED_VERSION = "1.0.0";

export function pluginPackageServerName() {
  return PLUGIN_PACKAGE_SERVER_ID;
}

export function preparePluginPackage(fixture, runtimeEnv) {
  const skillDir = path.join(fixture.root, "skills", PLUGIN_PACKAGE_SKILL_ID);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${PLUGIN_PACKAGE_SKILL_ID}\ndescription: Use the package release check workflow.\n---\n\n# Release check\n\n${PLUGIN_PACKAGE_SKILL_BODY_MARKER}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(fixture.root, "plugin.json"),
    `${JSON.stringify(
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
        name: PLUGIN_PACKAGE_NAME,
        version: "1.0.0",
        description: "Agent Plugins standard package Gate B fixture",
      },
      null,
      2,
    )}\n`,
  );
  fs.writeFileSync(
    path.join(fixture.root, "mcp.json"),
    `${JSON.stringify(
      {
        $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        mcpServers: {
          [PLUGIN_PACKAGE_SERVER_ID]: {
            type: "stdio",
            command: "node",
            args: [path.basename(fixture.serverPath), fixture.ledgerPath],
            cwd: "${PLUGIN_ROOT}",
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const sourceRoot = path.join(runtimeEnv.home, "plugin-fixtures", PLUGIN_PACKAGE_NAME);
  fs.cpSync(fixture.root, sourceRoot, { recursive: true });
  const marketplacePath = path.join(runtimeEnv.home, ".agents/plugins/marketplace.json");
  fs.mkdirSync(path.dirname(marketplacePath), { recursive: true });
  fs.writeFileSync(marketplacePath, JSON.stringify({
    name: "local",
    plugins: [{ name: PLUGIN_PACKAGE_NAME, source: {
      source: "local", path: "./plugin-fixtures/" + PLUGIN_PACKAGE_NAME,
    } }],
  }));
  return {
    id: PLUGIN_PACKAGE_ID,
    root: sourceRoot,
    marketplacePath,
    runtimeServerName: pluginPackageServerName(),
    serverId: PLUGIN_PACKAGE_SERVER_ID,
    skillId: `${PLUGIN_PACKAGE_NAME}:${PLUGIN_PACKAGE_SKILL_ID}`,
    version: "1.0.0",
  };
}

export async function cleanupPluginPackage(page, plugin) {
  if (!page || !plugin?.id) return;
  await appServerCallFromPage(page, "plugin/uninstall", {
    pluginId: plugin.id,
  }).catch(() => undefined);
}

export async function observeAppServerMethodFromTrace(
  page,
  method,
  options,
  observedMethods,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < Math.min(options.timeoutMs, 45_000)) {
    const traceRaw =
      (await page.evaluate(() =>
        window.localStorage.getItem("lime_invoke_trace_buffer_v1"),
      )) || "";
    if (
      parseJsonRpcRequestsFromInvokeTrace(traceRaw).some(
        (request) => request?.method === method,
      )
    ) {
      observedMethods.add(method);
      return traceRaw;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(`Renderer 未通过 App Server bridge 调用 ${method}`);
}

export async function waitForPluginInstalledState(
  page,
  pluginId,
  expectedEnabled,
  options,
  observedMethods,
) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < Math.min(options.timeoutMs, 45_000)) {
    latest = await appServerCallFromPage(page, "plugin/installed", {});
    observedMethods.add(latest.method);
    const plugin = latest.result?.marketplaces?.flatMap((market) => market.plugins).find(
      (candidate) => candidate?.id === pluginId,
    );
    if (plugin && plugin.enabled === expectedEnabled) {
      return { plugin, response: latest };
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `plugin/installed 状态未收敛: plugin=${pluginId} enabled=${expectedEnabled} latest=${JSON.stringify(latest?.result)}`,
  );
}

export async function openPluginPackageAppCenter(
  page,
  options,
  observedMethods,
  screenshotPath,
) {
  const sidebarPlugins = page.locator(
    '[data-testid="app-sidebar-nav-plugins"]',
  );
  const refresh = page.locator('[data-testid="plugin-catalog-refresh"]');
  const loading = page.locator('[data-testid="plugin-catalog-loading"]');
  const bundledCard = page.locator(
    `[data-testid="plugin-catalog-card-${PLUGIN_PACKAGE_BUNDLED_ID}"]`,
  );
  const navigationTimeoutMs = Math.min(options.timeoutMs, 30_000);
  let lastError = null;
  let lastRoute = null;

  // Windows packaged startup can emit a late home navigation while the shell
  // is settling. Require the target page and its catalog card to converge
  // together, then retry the real sidebar click a bounded number of times.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await sidebarPlugins.click();
      await refresh.waitFor({
        state: "visible",
        timeout: navigationTimeoutMs,
      });
      await loading.waitFor({
        state: "hidden",
        timeout: navigationTimeoutMs,
      });

      const catalog = await appServerCallFromPage(page, "plugin/list", {});
      observedMethods.add(catalog.method);
      const bundled = catalog.result?.marketplaces?.flatMap((market) => market.plugins).find(
        (candidate) => candidate?.id === PLUGIN_PACKAGE_BUNDLED_ID,
      );
      assert(bundled, "plugin/list 未返回 bundled Browser Plugin");
      assert(
        bundled.id.endsWith("@" + PLUGIN_PACKAGE_BUNDLED_MARKETPLACE_ID) &&
          bundled.source?.type === "local" &&
          bundled.version === PLUGIN_PACKAGE_BUNDLED_VERSION,
        `bundled Plugin identity/version 不一致: ${JSON.stringify(bundled)}`,
      );
      await bundledCard.waitFor({
        state: "visible",
        timeout: navigationTimeoutMs,
      });
      assert(
        (await bundledCard.textContent())?.includes(
          PLUGIN_PACKAGE_BUNDLED_VERSION,
        ),
        "App Center bundled 卡片未显示 manifest version",
      );
      await page.screenshot({ path: screenshotPath, fullPage: true });
      return { bundled, catalog };
    } catch (error) {
      lastError = error;
      lastRoute = await page
        .evaluate(() => ({
          href: window.location.href,
          activeSidebarPages: Array.from(
            document.querySelectorAll(
              '[data-testid^="app-sidebar-nav-"][aria-current="page"]',
            ),
          ).map((element) => element.getAttribute("data-testid")),
          visibleTestIds: Array.from(document.querySelectorAll("[data-testid]"))
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            })
            .map((element) => element.getAttribute("data-testid"))
            .filter(Boolean)
            .slice(-80),
          mainText:
            document.querySelector("main")?.textContent?.slice(0, 240) ?? "",
        }))
        .catch(() => null);
      if (attempt === 3) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `插件中心导航未收敛: attempts=${attempt} lastRoute=${JSON.stringify(lastRoute)} cause=${message}`,
        );
      }
      await sleep(Math.max(options.intervalMs, 500));
    }
  }

  throw new Error(
    `插件中心导航未收敛: lastRoute=${JSON.stringify(lastRoute)} cause=${String(lastError)}`,
  );
}

export async function installPluginPackageFromAppCenter({
  page,
  plugin,
  options,
  observedMethods,
  screenshotPath,
}) {
  const installButton = page.locator(
    '[data-testid="plugin-catalog-install-' + plugin.id + '"]',
  );
  const actionsButton = page.locator(
    `[data-testid="plugin-catalog-actions-${plugin.id}"]`,
  );
  if ((await actionsButton.count()) > 0) {
    await actionsButton.click();
  }
  await installButton.click();
  const review = page.locator('[data-testid="plugin-catalog-install-review"]');
  await review.waitFor({ state: "visible", timeout: options.timeoutMs });
  assert((await review.textContent())?.includes(PLUGIN_PACKAGE_NAME),
    "App Center 安装 review 未显示 Plugin identity");
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.locator('[data-testid="plugin-catalog-confirm-install"]').click();
  await review.waitFor({ state: "hidden", timeout: options.timeoutMs });
  await observeAppServerMethodFromTrace(
    page,
    "plugin/install",
    options,
    observedMethods,
  );
  await page
    .locator(`[data-testid="plugin-catalog-actions-${plugin.id}"]`)
    .waitFor({ state: "visible", timeout: options.timeoutMs });

  const installed = await waitForPluginInstalledState(
    page,
    plugin.id,
    true,
    options,
    observedMethods,
  );
  const read = await appServerCallFromPage(page, "plugin/read", {
    marketplacePath: plugin.marketplacePath,
    pluginName: PLUGIN_PACKAGE_NAME,
  });
  observedMethods.add(read.method);
  const summary = read.result?.plugin?.summary;
  assert(summary?.id === plugin.id, "plugin/read identity 不一致");
  assert(read.result?.plugin?.marketplaceName === "local",
    "plugin/read 未保留市场身份");
  assert(read.result?.plugin?.mcpServers?.includes(plugin.serverId),
    "plugin/read 未投影标准 mcp.json server");
  assert(read.result?.plugin?.mcpServers?.length === 1,
    "plugin/read MCP 数量异常");
  assert(read.result?.plugin?.skills?.some((skill) => skill?.name === plugin.skillId),
    "plugin/read 未投影标准 skills/<name>/SKILL.md");
  assert(read.result?.plugin?.skills?.length === 1,
    "plugin/read Skill 数量异常");
  return {
    installed,
    pluginSkillProjected: true,
    read,
    standardManifestSeen:
      summary?.id === plugin.id && summary?.version === plugin.version,
    standardMcpConfigSeen: true,
  };
}

export async function setPluginPackageEnabledFromAppCenter(
  page,
  pluginId,
  enabled,
  options,
  observedMethods,
) {
  await page.locator('[data-testid="app-sidebar-nav-plugins"]').click();
  await page.locator('[data-testid="plugin-catalog-refresh"]').waitFor({
    state: "visible",
    timeout: options.timeoutMs,
  });
  await page.locator('[data-testid="plugin-catalog-loading"]').waitFor({
    state: "hidden",
    timeout: options.timeoutMs,
  });
  await page
    .locator(`[data-testid="plugin-catalog-actions-${pluginId}"]`)
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  await page
    .locator(`[data-testid="plugin-catalog-actions-${pluginId}"]`)
    .click();
  await page
    .locator(`[data-testid="plugin-catalog-toggle-${pluginId}"]`)
    .click();
  await observeAppServerMethodFromTrace(
    page,
    "config/batchWrite",
    options,
    observedMethods,
  );
  return waitForPluginInstalledState(
    page,
    pluginId,
    enabled,
    options,
    observedMethods,
  );
}

async function waitForPluginUninstalled(
  page,
  pluginId,
  options,
  observedMethods,
) {
  const startedAt = Date.now();
  let latest = null;
  while (Date.now() - startedAt < Math.min(options.timeoutMs, 45_000)) {
    latest = await appServerCallFromPage(page, "plugin/installed", {});
    observedMethods.add(latest.method);
    if (
      !latest.result?.marketplaces?.flatMap((market) => market.plugins).some((candidate) => candidate?.id === pluginId)
    ) {
      return latest;
    }
    await sleep(options.intervalMs);
  }
  throw new Error(
    `plugin/installed 卸载状态未收敛: plugin=${pluginId} latest=${JSON.stringify(latest?.result)}`,
  );
}

export async function uninstallPluginPackageFromAppCenter({
  page,
  pluginId,
  options,
  observedMethods,
  screenshotPath,
}) {
  await page.locator('[data-testid="app-sidebar-nav-plugins"]').click();
  await page.locator('[data-testid="plugin-catalog-refresh"]').waitFor({
    state: "visible",
    timeout: options.timeoutMs,
  });
  await page.locator('[data-testid="plugin-catalog-loading"]').waitFor({
    state: "hidden",
    timeout: options.timeoutMs,
  });
  const actions = page.locator(
    `[data-testid="plugin-catalog-actions-${pluginId}"]`,
  );
  await actions.waitFor({ state: "visible", timeout: options.timeoutMs });
  await actions.click();
  await page
    .locator(`[data-testid="plugin-catalog-uninstall-${pluginId}"]`)
    .click();
  const confirmation = page.locator(
    '[data-testid="plugin-catalog-uninstall-confirm"]',
  );
  await confirmation.waitFor({ state: "visible", timeout: options.timeoutMs });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await confirmation.locator("button").last().click();
  await confirmation.waitFor({ state: "hidden", timeout: options.timeoutMs });
  await observeAppServerMethodFromTrace(
    page,
    "plugin/uninstall",
    options,
    observedMethods,
  );
  await waitForPluginUninstalled(page, pluginId, options, observedMethods);
}
