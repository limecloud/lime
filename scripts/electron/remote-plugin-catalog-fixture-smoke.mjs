import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { exercisePluginSkillPreview } from "./lib/plugin-skill-preview-scenario.mjs";
import { createRemotePluginIssuer } from "./lib/remote-plugin-catalog-issuer.mjs";
import { exerciseRemotePluginPreferences } from "./lib/remote-plugin-preference-scenario.mjs";
import { exerciseRemotePluginSkillPreferences } from "./lib/remote-plugin-skill-preference-scenario.mjs";
import {
  ensureElectronFixtureBuild,
  inspectElectronFixtureBuildFreshness,
} from "../lib/electron-fixture-build.mjs";
import { acquireGuiSmokeRunLock } from "../lib/gui-smoke-run-lock.mjs";
import {
  electronAppServerBinaryDestination,
  resolveElectronAppServerRuntimeEnv,
} from "../lib/electron-app-server-assets.mjs";
import {
  appServerCallFromPage,
  assert,
  closeElectronFixture,
  createTempRuntimeEnv,
  launchElectronFixture,
  parseJsonRpcRequestsFromInvokeTrace,
} from "./mcp-config-fixture-smoke.mjs";

const evidenceDir = path.resolve(
  process.env.REMOTE_PLUGIN_EVIDENCE_DIR ||
    ".lime/qc/plugin-reconstruction/remote-catalog/electron",
);
fs.mkdirSync(evidenceDir, { recursive: true });
const remoteScope = process.env.REMOTE_PLUGIN_SCOPE || "WORKSPACE";
assert(
  ["WORKSPACE", "GLOBAL"].includes(remoteScope),
  "unsupported remote scope",
);
const marketplace =
  remoteScope === "GLOBAL" ? "openai-curated-remote" : "workspace-directory";

ensureElectronFixtureBuild({
  rootDir: process.cwd(),
  logPrefix: "remote-plugins",
});
const lock = await acquireGuiSmokeRunLock({
  lockDir: path.resolve(".lime/electron-fixture-build.lock"),
  waitTimeoutMs: 600_000,
  log: console.log,
});
const runtimeEnv = createTempRuntimeEnv();
const options = { timeoutMs: 120_000, intervalMs: 100 };
const tenant = "plugin-fixture";
const tokens = [
  "remote-plugin-fixture-private-one",
  "remote-plugin-fixture-private-two",
];
const observations = [];
const bundleRequests = [];
const rendererRequests = [];
const consoleErrors = [];
const pageErrors = [];
const issuerErrors = [];
const methods = new Set();
const pluginRpcObservations = [];
const checks = {};
const summary = {
  ok: false,
  proofLevel: "Desktop Gate B + real stdio",
  dependency: "controlled Core-shaped issuer",
  backendMode: "unavailable",
  remoteScope,
  modelTurn: false,
  checks,
  observations,
  bundleRequests,
  pluginRpcObservations,
  rendererRequests,
  consoleErrors,
  pageErrors,
  issuerErrors,
};
let handle;
let peer;
let baseUrl;
const profile = (index) => ({
  tenant: { id: tenant, name: "Fixture", slug: tenant },
  user: {
    id: `user-${index}`,
    email: `plugin-${index}@example.test`,
    displayName: `Plugin Account ${index}`,
    passwordConfigured: true,
    roles: [],
  },
  session: {
    id: `session-${index}`,
    tenantId: tenant,
    userId: `user-${index}`,
    provider: "password",
    roles: [],
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  },
});
const plugin = (index) => ({
  id: `opaque~${index}`,
  name: `research-${index}`,
  scope: remoteScope,
  discoverability: "LISTED",
  installation_policy: "AVAILABLE",
  installation_policy_source:
    remoteScope === "GLOBAL" ? null : "WORKSPACE_SETTING",
  authentication_policy: "ON_USE",
  status: "AVAILABLE",
  release: {
    version: "1.0.0",
    display_name: `Remote Research ${index}`,
    description: `Remote description ${index}`,
    keywords: ["research"],
    bundle_download_url: `${baseUrl}/signed-bundle/${index}?signature=must-not-reach-renderer`,
    interface: {
      short_description: `Research account ${index}`,
      capabilities: ["research"],
      screenshot_urls: [],
    },
    ...(remoteScope === "GLOBAL"
      ? {
          app_ids: [`fixture-app-${index}`],
          app_manifest: {
            apps: {
              Research: {
                id: `fixture-app-${index}`,
                category: "Research",
                future: { nested: [1, true] },
              },
            },
            future: { preserve: "complete document" },
          },
        }
      : {}),
    skills: [{ name: "research-skill", description: "Research skill" }],
    mcp_servers: [{ key: "research-server" }],
  },
});
const installedAccounts = new Set();
const skillPreview = { requests: 0, mode: "ready" };
const preferences = { fail: false, writes: [] };
const issuer = createRemotePluginIssuer({
  rootDir: process.cwd(),
  evidenceDir,
  tokens,
  tenant,
  remoteScope,
  getBaseUrl: () => baseUrl,
  profile,
  plugin,
  installedAccounts,
  skillPreview,
  observations,
  bundleRequests,
  issuerErrors,
  preferences,
});

function artifactDigest() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile())
        files.push([
          file,
          createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        ]);
    }
  };
  for (const dir of ["dist", "dist-electron"]) walk(dir);
  return {
    count: files.length,
    sha256: createHash("sha256")
      .update(JSON.stringify(files.sort()))
      .digest("hex"),
  };
}

async function launch(appServerEnv) {
  console.log("[remote-plugins] launching fixed Electron artifacts");
  handle = await launchElectronFixture({
    options,
    runtimeEnv,
    appServerEnv,
    consoleErrors,
    pageErrors,
  });
  handle.page.on("request", (request) => {
    if (request.url().startsWith(`${baseUrl}/api/`))
      rendererRequests.push({
        path: new URL(request.url()).pathname,
        authenticated: Boolean(request.headers().authorization),
      });
  });
}

async function visible(index, stage, installed = false) {
  const { page } = handle;
  await page.getByTestId("app-sidebar-nav-plugins").click();
  await page
    .locator(
      `[data-testid="plugin-catalog-card-research-${index}@${marketplace}"]`,
    )
    .waitFor();
  await page
    .locator(
      `[data-testid="plugin-catalog-select-research-${index}@${marketplace}"]`,
    )
    .click();
  await page
    .getByText(`Remote description ${index}`, { exact: true })
    .waitFor();
  await page.getByText("research-skill", { exact: true }).waitFor();
  await page.getByText("research-server", { exact: true }).waitFor();
  assert(
    (await page
      .locator(
        `[data-testid="plugin-catalog-install-research-${index}@${marketplace}"]`,
      )
      .count()) === (installed ? 0 : 1),
    "GUI installation state must match the shared store",
  );
  assert(
    (await page
      .locator(
        `[data-testid="plugin-catalog-actions-research-${index}@${marketplace}"]`,
      )
      .count()) === (installed ? 1 : 0),
    "installed actions must follow the real installation",
  );
  for (const account of [0, 1]) {
    await page
      .locator('[data-testid="app-sidebar-installed-plugin"]')
      .filter({
        hasText: new RegExp(
          `research-${account}|Remote Research ${account}`,
          "i",
        ),
      })
      .waitFor({
        state: installed && account === index ? "visible" : "detached",
      });
  }
  assert(
    (await page
      .locator(
        `[data-testid="plugin-catalog-card-research-${1 - index}@${marketplace}"]`,
      )
      .count()) === 0,
    "another account's catalog remained visible",
  );
  const state = await page.evaluate(
    (secrets) => ({
      realBridge:
        window.__LIME_ELECTRON__ === true &&
        typeof window.electronAPI?.invoke === "function" &&
        window.electronAPI.devBridgeFallback === false,
      leaked: secrets.some((secret) =>
        JSON.stringify([
          ...Object.entries(localStorage),
          ...Object.entries(sessionStorage),
        ]).includes(secret),
      ),
      trace: localStorage.getItem("lime_invoke_trace_buffer_v1"),
      errors: localStorage.getItem("lime_invoke_error_buffer_v1"),
    }),
    [...tokens, "must-not-reach-renderer"],
  );
  assert(
    state.realBridge && !state.leaked,
    "real credential-free renderer bridge required",
  );
  for (const request of parseJsonRpcRequestsFromInvokeTrace(state.trace)) {
    if (request.status !== "success") continue;
    if (request.method.startsWith("plugin/")) {
      assert(
        request.transport === "electron-ipc",
        "plugin requests must use real Electron IPC",
      );
      pluginRpcObservations.push({
        stage,
        method: request.method,
        command: request.command,
        transport: request.transport,
        status: request.status,
      });
    }
    methods.add(request.method);
  }
  assert(
    !state.errors || JSON.parse(state.errors).length === 0,
    "unexpected invoke errors",
  );
  checks[stage] = {
    realBridge: state.realBridge,
    credentialFree: !state.leaked,
    installed,
    sidebarMatchesInstallation: true,
  };
  await page.bringToFront();
  await page.screenshot({ path: path.join(evidenceDir, `${stage}.png`) });
  console.log(`[remote-plugins] ${stage} verified`);
}

try {
  assert(
    inspectElectronFixtureBuildFreshness({ rootDir: process.cwd() }).ready,
    "fixture source changed before lock acquisition",
  );
  summary.artifactsBefore = artifactDigest();
  await new Promise((resolve) => issuer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${issuer.address().port}`;
  const binary = electronAppServerBinaryDestination();
  summary.appServerSha256 = createHash("sha256")
    .update(fs.readFileSync(binary))
    .digest("hex");
  const manifest = JSON.parse(
    fs.readFileSync("dist-electron/desktop-resources.manifest.json", "utf8"),
  );
  assert(
    manifest.resources.find((resource) => resource.id === "app-server")
      ?.sha256 === summary.appServerSha256,
    "fixed App Server does not match the desktop manifest",
  );
  const appServerEnv = resolveElectronAppServerRuntimeEnv({
    env: { ...runtimeEnv.env, APP_SERVER_BIN: binary },
  });
  appServerEnv.VITE_DEV_SERVER_URL = baseUrl;
  appServerEnv.APP_SERVER_APP_DATA_DIR = runtimeEnv.electronUserDataDir;
  await launch(appServerEnv);
  // Auth setup uses the public account RPC; the previous account fixture owns the GUI login journey.
  await appServerCallFromPage(handle.page, "account/login/start", {
    type: "cloudAuthTokens",
    baseUrl,
    tenantId: tenant,
    accessToken: tokens[0],
  });
  console.log("[remote-plugins] shared account imported");
  await handle.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await visible(0, "directory-detail");
  await exercisePluginSkillPreview({
    page: handle.page,
    state: skillPreview,
    checks,
    evidenceDir,
  });
  await handle.page
    .locator(`[data-testid="plugin-catalog-install-research-0@${marketplace}"]`)
    .click();
  await handle.page
    .locator('[data-testid="plugin-catalog-install-review"]')
    .waitFor();
  await handle.page.screenshot({
    path: path.join(evidenceDir, "install-review.png"),
  });
  await handle.page
    .locator('[data-testid="plugin-catalog-confirm-install"]')
    .click();
  await handle.page
    .locator('[data-testid="plugin-catalog-install-review"]')
    .waitFor({ state: "detached" });
  await visible(0, "installed", true);
  await exercisePluginSkillPreview({
    page: handle.page,
    state: skillPreview,
    checks,
    evidenceDir,
    installed: true,
  });
  await handle.page
    .getByTestId("plugin-catalog-select-browser@openai-bundled")
    .click();
  await exercisePluginSkillPreview({
    page: handle.page,
    state: skillPreview,
    checks,
    evidenceDir,
    local: true,
  });
  const { connectAppServerSidecar, stdioSidecar } =
    await import("../../packages/app-server-client/dist/index.js");
  peer = await connectAppServerSidecar(
    {
      ...stdioSidecar(binary, undefined, runtimeEnv.appServerDataDir),
      backendMode: "unavailable",
    },
    { clientInfo: { name: "remote-plugin-fixture", version: "1" } },
    { env: appServerEnv, initializeTimeoutMs: 30_000 },
  );
  const list = (
    await peer.connection.request(
      peer.client.listPlugins(
        remoteScope === "GLOBAL" ? {} : { marketplaceKinds: [marketplace] },
      ),
    )
  ).result;
  assert(
    list.marketplaces[0]?.plugins[0]?.remotePluginId === "opaque~0",
    "stdio must use the same shared account and catalog",
  );
  checks.sharedStdio = true;
  const skill = (
    await peer.connection.request(
      peer.client.readPluginSkill({
        remoteMarketplaceName: marketplace,
        remotePluginId: "opaque~0",
        skillName: "research-skill",
      }),
    )
  ).result;
  assert(
    skill.contents?.includes("Verified skill body"),
    "stdio must read the same authorized skill",
  );
  checks.sharedSkillStdio = true;
  const installed = (
    await peer.connection.request(peer.client.listInstalledPlugins({}))
  ).result;
  const shared = installed.marketplaces
    .flatMap((marketplace) => marketplace.plugins)
    .find((entry) => entry.remotePluginId === "opaque~0");
  assert(
    shared?.id === `research-0@${marketplace}` &&
      shared.installed &&
      shared.enabled &&
      shared.localVersion === "1.0.0",
    "stdio must observe the GUI-installed package and version",
  );
  checks.sharedInstallation = true;
  await exerciseRemotePluginPreferences({
    page: handle.page,
    peer,
    preferences,
    marketplace,
    evidenceDir,
    checks,
  });
  await exerciseRemotePluginSkillPreferences({
    page: handle.page,
    peer,
    preferences,
    marketplace,
    evidenceDir,
    checks,
    remoteScope,
  });
  const detail = (
    await peer.connection.request(
      peer.client.readPlugin({
        remoteMarketplaceName: "caller-label-is-not-authoritative",
        pluginName: "opaque~0",
      }),
    )
  ).result.plugin;
  assert(
    detail.marketplaceName === marketplace &&
      detail.summary.installed &&
      detail.summary.enabled &&
      detail.summary.installedAt === 1792281600 &&
      detail.summary.localVersion === "1.0.0" &&
      detail.skills[0]?.name === "research-skill" &&
      detail.skills[0]?.path === null &&
      detail.skills[0]?.enabled === false &&
      isDeepStrictEqual(detail.mcpServers, ["research-server"]) &&
      detail.hooks.length === 0,
    "stdio detail must project fresh remote preferences, raw names and Unix seconds",
  );
  const localSkills = (
    await peer.connection.request(
      peer.client.listSkills({
        cwds: [runtimeEnv.appServerDataDir],
        forceReload: true,
      }),
    )
  ).result.data.flatMap((entry) => entry.skills);
  assert(
    localSkills.some(
      (skill) => skill.name === "research-0:research-skill" && skill.enabled,
    ),
    "remote disabled_skill_names must not disable materialized runtime skills",
  );
  checks.remoteDetailPreferencesAndIndependentRuntime = true;
  const listParams =
    remoteScope === "GLOBAL" ? {} : { marketplaceKinds: [marketplace] };
  const remoteSummary = (response) =>
    response.marketplaces
      .flatMap((entry) => entry.plugins)
      .find((entry) => entry.remotePluginId === "opaque~0");
  installedAccounts.delete(0);
  const revokedCatalog = await appServerCallFromPage(
    handle.page,
    "plugin/list",
    listParams,
  );
  const revoked = remoteSummary(revokedCatalog.result);
  assert(
    revoked?.installed === false &&
      revoked.enabled === false &&
      revoked.localVersion === null &&
      revoked.installedAt === null,
    "Electron catalog must project remote revocation before local reconciliation",
  );
  const localAfterRead = (
    await peer.connection.request(peer.client.listInstalledPlugins({}))
  ).result;
  assert(
    isDeepStrictEqual(localAfterRead, installed),
    "catalog reads must not change the materialized installation snapshot",
  );
  installedAccounts.add(0);
  const restoredCatalog = (
    await peer.connection.request(peer.client.listPlugins(listParams))
  ).result;
  const restored = remoteSummary(restoredCatalog);
  assert(
    restored?.installed === true &&
      restored.enabled === true &&
      restored.localVersion === "1.0.0" &&
      restored.installedAt === 1792281600,
    "shared stdio catalog must project the restored fresh installation",
  );
  checks.freshCatalogRevocationAndIndependentLocalInstallation = true;
  if (remoteScope === "GLOBAL") {
    const packageRoot = path.join(
      runtimeEnv.appServerDataDir,
      "plugins",
      "cache",
      marketplace,
      "research-0",
      "1.0.0",
    );
    const native = JSON.parse(
      fs.readFileSync(
        path.join(packageRoot, ".lime-plugin/plugin.json"),
        "utf8",
      ),
    );
    const apps = JSON.parse(
      fs.readFileSync(path.join(packageRoot, ".app.json"), "utf8"),
    );
    assert(
      native.version === "1.0.0",
      "GLOBAL manifest must use release version",
    );
    assert(
      isDeepStrictEqual(apps, plugin(0).release.app_manifest),
      "GLOBAL Apps raw document changed",
    );
    const appList = (await peer.connection.request(peer.client.listApps({})))
      .result;
    assert(
      appList.data.some((app) => app.id === "fixture-app-0"),
      "stdio did not consume GLOBAL default Apps",
    );
    checks.globalMetadata = true;
  }

  await peer.connection.request(
    peer.client.loginAccount({
      type: "cloudAuthTokens",
      baseUrl,
      tenantId: tenant,
      accessToken: tokens[1],
    }),
  );
  await handle.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await visible(1, "peer-switch");
  const otherAccount = (
    await peer.connection.request(peer.client.listInstalledPlugins({}))
  ).result;
  assert(
    !otherAccount.marketplaces.some((marketplace) =>
      marketplace.plugins.some((entry) => entry.remotePluginId === "opaque~0"),
    ),
    "another account must not read the installed package",
  );
  checks.accountIsolation = true;
  await handle.page.reload();
  await visible(1, "reload");
  await peer.sidecar.close();
  peer = null;
  await closeElectronFixture(handle);
  handle = null;
  await launch(appServerEnv);
  await visible(1, "cold-start");
  peer = await connectAppServerSidecar(
    {
      ...stdioSidecar(binary, undefined, runtimeEnv.appServerDataDir),
      backendMode: "unavailable",
    },
    { clientInfo: { name: "remote-plugin-fixture-cold", version: "1" } },
    { env: appServerEnv, initializeTimeoutMs: 30_000 },
  );
  await peer.connection.request(
    peer.client.loginAccount({
      type: "cloudAuthTokens",
      baseUrl,
      tenantId: tenant,
      accessToken: tokens[0],
    }),
  );
  await handle.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await visible(0, "cold-installed-return", true);
  assert(
    bundleRequests.length === 1,
    "cold return must reuse the persisted installation without downloading again",
  );
  await handle.page
    .locator(`[data-testid="plugin-catalog-actions-research-0@${marketplace}"]`)
    .click();
  await handle.page
    .locator(
      `[data-testid="plugin-catalog-uninstall-research-0@${marketplace}"]`,
    )
    .click();
  const confirmation = handle.page.locator(
    '[data-testid="plugin-catalog-uninstall-confirm"]',
  );
  await confirmation.getByRole("button").last().click();
  await confirmation.waitFor({ state: "detached" });
  await visible(0, "uninstalled");
  const afterRemoval = (
    await peer.connection.request(peer.client.listInstalledPlugins({}))
  ).result;
  assert(
    !afterRemoval.marketplaces.some((marketplace) =>
      marketplace.plugins.some((entry) => entry.remotePluginId === "opaque~0"),
    ),
    "GUI uninstall must remove the shared stdio installation",
  );
  checks.sharedUninstall = true;
  if (remoteScope === "GLOBAL") {
    const appList = (await peer.connection.request(peer.client.listApps({})))
      .result;
    assert(
      !appList.data.some((app) => app.id === "fixture-app-0"),
      "uninstalled GLOBAL Apps remained visible",
    );
    checks.globalAppsRemoved = true;
  }

  await peer.connection.request(peer.client.logoutAccount());
  await handle.page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await handle.page
    .locator(`[data-testid="plugin-catalog-card-research-0@${marketplace}"]`)
    .waitFor({ state: "detached" });
  checks.logoutCleared = true;
  const pluginRequests = observations.filter((entry) =>
    entry.path.includes("/ps/plugins/"),
  );
  assert(
    pluginRequests.length >= 8 &&
      pluginRequests.every((entry) => entry.authenticated && !entry.renderer),
    "authenticated plugin HTTP must originate in the shared backend",
  );
  assert(
    ["install", "uninstall"].every((operation) =>
      pluginRequests.some((entry) =>
        entry.path.endsWith(`/opaque~0/${operation}`),
      ),
    ),
    "remote install and uninstall must reach the authenticated issuer",
  );
  assert(
    rendererRequests.every((entry) => !entry.authenticated),
    "renderer sent an account credential",
  );
  assert(
    [
      "plugin/list",
      "plugin/read",
      "plugin/skill/read",
      "plugin/install",
      "plugin/uninstall",
    ].every((method) => methods.has(method)),
    "real plugin RPC evidence missing",
  );
  assert(
    bundleRequests.length === 1 &&
      bundleRequests.every(
        (request) => !request.accountHeaders && !request.renderer,
      ),
    "bundle download must stay in the backend without account credentials",
  );
  assert(
    consoleErrors.length === 0 && pageErrors.length === 0,
    "Electron errors",
  );
  assert(issuerErrors.length === 0, "controlled issuer rejected a request");
  summary.artifactsAfter = artifactDigest();
  assert(
    JSON.stringify(summary.artifactsBefore) ===
      JSON.stringify(summary.artifactsAfter),
    "fixture artifacts drifted during validation",
  );
  summary.methods = [...methods].sort();
  summary.ok = true;
} catch (error) {
  summary.failure = error instanceof Error ? error.message : String(error);
  if (handle) {
    summary.failureDiagnostics = {};
    for (const [name, method, params] of [
      ["account", "account/read", {}],
      [
        "catalog",
        "plugin/list",
        remoteScope === "GLOBAL" ? {} : { marketplaceKinds: [marketplace] },
      ],
    ]) {
      summary.failureDiagnostics[name] = await appServerCallFromPage(
        handle.page,
        method,
        params,
      ).catch((cause) => ({
        error: cause instanceof Error ? cause.message : String(cause),
      }));
    }
    await handle.page
      .screenshot({ path: path.join(evidenceDir, "failure.png") })
      .catch(() => undefined);
    summary.testIds = await handle.page
      .locator("[data-testid]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-testid")),
      )
      .catch(() => []);
  }
  process.exitCode = 1;
} finally {
  if (peer) await peer.sidecar.close().catch(() => undefined);
  if (handle) await closeElectronFixture(handle).catch(() => undefined);
  issuer.closeAllConnections();
  await new Promise((resolve) => issuer.close(resolve));
  fs.writeFileSync(
    path.join(evidenceDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  lock.release();
  console.log(
    JSON.stringify({ ok: summary.ok, evidenceDir, failure: summary.failure }),
  );
}
