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
  appServerCallFromPage,
  createTempRuntimeEnv,
  launchElectronFixture,
  openSettings,
} from "../mcp-config-fixture-smoke.mjs";
import { captureMainProcessExit } from "./persisted-atom-fixture-driver.mjs";
import { settleFixtureResources } from "../../lib/chat-fixture/teardown.mjs";
import {
  parseSettingsAppearanceFixtureArgs,
  summarizeSettingsAppearanceTrace,
} from "./settings-appearance-fixture-evidence.mjs";

const installDependencies = process.argv.includes("--install-dependencies");
const options = parseSettingsAppearanceFixtureArgs(
  process.argv.slice(2).filter((arg) => arg !== "--install-dependencies"),
  {
    defaults: {
      runId: null,
      evidenceDir: null,
      prefix: "settings-configuration",
      timeoutMs: 120000,
      intervalMs: 250,
      keepTemp: false,
    },
  },
);
if (options.help) {
  console.log(
    "node scripts/electron/lib/settings-configuration-fixture.mjs --run-id <id> --evidence-dir <path> [--install-dependencies]",
  );
  process.exit(0);
}
fs.mkdirSync(options.evidenceDir, { recursive: true });
const summary = {
  scenario: "configuration-controls-and-immediate-persistence",
  proofLevel: "Desktop Gate B controlled fixture",
  claimBoundary:
    "Real Configuration UI -> Electron/preload/IPC -> config/value/write -> persisted user config and canonical new Thread defaults, with cold restart. configRequirements/read proves the absent system policy returns null over the same real IPC; native config/read has one raw User layer, no MDM origins, and the scope menu has no fabricated Admin option. Explicit unavailable backend, no Agent turns or live provider. Filesystem write-denial probe applies only to an isolated fixture directory on POSIX. Project/managed scopes, web-search modes, model features are outside this slice. Dependency reads, UI disable/diagnose and cold persistence use the same real bridge. --install-dependencies additionally downloads the compiled official platform assets, validates versions and exercises command/exec with the installed child PATH in the isolated fixture root.",
  dependencyInstall: {
    requested: installDependencies,
    mode: "official assets, isolated fixture storage",
  },
  startedAt: new Date().toISOString(),
  result: "fail",
  assertions: {},
  calls: [],
  launches: [],
  teardowns: [],
  measurements: {},
  quitObservations: [],
};
let runtime, handle, mainExit, permissionRestore;
const consoleErrors = [],
  pageErrors = [],
  traces = [];
const check = (name, value) => {
  summary.assertions[name] = Boolean(value);
  if (!value) throw Error(name);
};
async function call(method, params = {}) {
  const response = await appServerCallFromPage(handle.page, method, params);
  const { requestId, responseId, transport, electron, fallback, status } =
    response.ipcObservation;
  summary.calls.push({
    method,
    requestId,
    responseId,
    transport,
    electron,
    fallback,
    status,
  });
  check(
    "directPublicIpcIdentity",
    requestId === responseId &&
      electron &&
      transport === "electron-ipc" &&
      !fallback,
  );
  return response.result;
}
async function openConfiguration() {
  await handle.page.getByTestId("settings-sidebar-tab-configuration").click();
  await handle.page.getByTestId("configuration-settings").waitFor();
  await handle.page.waitForFunction(
    () =>
      !document.querySelector(
        "#configuration-approval_policy button[aria-haspopup]",
      )?.disabled,
  );
}
async function launch() {
  handle = await launchElectronFixture({
    options,
    runtimeEnv: runtime,
    appServerEnv: runtime.appServerEnv,
    consoleErrors,
    pageErrors,
    backendMode: "unavailable",
  });
  mainExit = captureMainProcessExit(handle.app.process());
  let stdout = "";
  const launchNumber = summary.launches.length + 1;
  handle.app.process().stdout.on("data", (chunk) => {
    stdout = `${stdout}${chunk}`.slice(-16_384);
    const lines = stdout.split("\n");
    stdout = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("[configuration-fixture-quit] ")) continue;
      try {
        summary.quitObservations.push({
          launch: launchNumber,
          ...JSON.parse(line.slice("[configuration-fixture-quit] ".length)),
        });
      } catch {
        // Only fixture-produced lifecycle metadata enters evidence.
      }
    }
  });
  await handle.app.evaluate(({ app }) => {
    for (const event of ["before-quit", "will-quit", "quit"])
      app.on(event, () => {
        process.stdout.write(
          `[configuration-fixture-quit] ${JSON.stringify({ event, resources: process.getActiveResourcesInfo() })}\n`,
        );
      });
  });
  summary.launches.push(handle.rendererSnapshot);
  await openSettings(handle.page, options);
  await openConfiguration();
}
async function close() {
  traces.push(
    await handle.page.evaluate(() =>
      localStorage.getItem("lime_invoke_trace_buffer_v1"),
    ),
  );
  const teardown = await settleFixtureResources({ app: handle.app, mainExit });
  summary.teardowns.push(teardown);
  handle = null;
  check(
    "normalMainExit",
    teardown.ok &&
      teardown.forcedCleanup === null &&
      teardown.normalMainExit?.exitCode === 0 &&
      teardown.normalMainExit?.signal === null,
  );
}
const row = (field) => handle.page.locator(`#configuration-${field}`);
const control = (field) => row(field).locator("button[aria-haspopup=menu]");
async function choose(field, label, failed = false) {
  await control(field).click();
  await handle.page
    .getByRole("menuitemradio", { name: new RegExp(`^${label}`) })
    .click();
  if (failed) await row(field).getByRole("alert").waitFor();
  else
    await handle.page.waitForFunction(
      ({ field, label }) => {
        const element = document.getElementById(`configuration-${field}`);
        return (
          element?.getAttribute("aria-busy") !== "true" &&
          element
            ?.querySelector("button[aria-haspopup]")
            ?.textContent?.includes(label)
        );
      },
      { field, label },
    );
}
async function screenshot(name) {
  await handle.page.getByTestId("settings-content").evaluate((element) => {
    element.scrollTop = 0;
  });
  const measured = await handle.page.evaluate(() => {
    const content = document.querySelector('[data-testid="settings-content"]');
    const row = document.getElementById("configuration-model_verbosity");
    return {
      title: getComputedStyle(
        document.querySelector('[data-testid="configuration-settings"] h1'),
      ).fontSize,
      label: getComputedStyle(row.querySelector(".settings-row-label"))
        .fontSize,
      description: getComputedStyle(
        row.querySelector(".settings-row-description"),
      ).fontSize,
      horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
      dark: document.documentElement.classList.contains("dark"),
    };
  });
  summary.measurements[name] = measured;
  check(
    `${name}TypographyAndOverflow`,
    measured.title === "28px" &&
      measured.label === "13px" &&
      measured.description === "12px" &&
      !measured.horizontalOverflow,
  );
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, `${name}.png`),
    animations: "disabled",
  });
}
const dependencies = () => handle.page.getByTestId("workspace-dependencies");
const dependencySwitch = () => dependencies().getByRole("switch");
async function dependencyUiReady(checked) {
  await handle.page.waitForFunction((checked) => {
    const control = document.querySelector(
      '[data-testid="workspace-dependencies"] button[role="switch"]',
    );
    return (
      control &&
      !control.disabled &&
      control.getAttribute("aria-checked") === String(checked)
    );
  }, checked);
}
async function verifyDependencies() {
  await dependencyUiReady(true);
  const initial = await call("primaryRuntime/diagnoseDependencies");
  check(
    "passiveDependenciesUninstalled",
    initial.supported &&
      initial.enabled &&
      !initial.installed &&
      initial.update === null,
  );
  const runtimeRoot = path.join(runtime.electronUserDataDir, "runtimes");
  check("passiveDependenciesNoStorage", !fs.existsSync(runtimeRoot));
  await dependencySwitch().click();
  await dependencyUiReady(false);
  check(
    "dependencyDisablePersisted",
    (await call("config/read")).config.features.workspace_dependencies ===
      false,
  );
  await dependencies()
    .getByRole("button", { name: "诊断", exact: true })
    .click();
  await dependencies()
    .getByText("依赖项可能需要修复，请重新安装后重试。", { exact: true })
    .waitFor();
  check("explicitMissingDependencyDiagnostic", true);
  check(
    "disabledDependencyInstallUnavailable",
    await dependencies()
      .getByRole("button", { name: "重新安装", exact: true })
      .isDisabled(),
  );
  if (!installDependencies) return;

  await dependencySwitch().click();
  await dependencyUiReady(true);
  const deadline = Date.now() + options.timeoutMs;
  let result;
  do {
    result = await call("primaryRuntime/diagnoseDependencies");
    summary.dependencyInstall.lastObserved = result;
    if (["ready", "error", "canceled"].includes(result.update?.phase)) break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  } while (Date.now() < deadline);
  check(
    "officialDependencyInstallReady",
    result?.update?.phase === "ready" &&
      result.installed &&
      result.bundleVersion === result.expectedVersion,
  );
  await dependencies()
    .getByRole("button", { name: "诊断", exact: true })
    .click();
  await dependencies().getByText("依赖项状态正常", { exact: true }).waitFor();
  const probe = await call("primaryRuntime/diagnoseDependencies", {
    probeExecutables: true,
  });
  check(
    "officialDependencyExecutableProbe",
    probe.installed && probe.problems.length === 0,
  );
  const release = JSON.parse(
    fs.readFileSync(
      "lime-rs/crates/tool-runtime/src/primary_runtime/release.json",
      "utf8",
    ),
  );
  const platform = release.platforms.find(
    (entry) =>
      entry.os ===
        { darwin: "macos", win32: "windows", linux: "linux" }[
          process.platform
        ] && entry.arch === { arm64: "aarch64", x64: "x86_64" }[process.arch],
  );
  for (const artifact of platform.artifacts) {
    const command =
      artifact.name === "node"
        ? [
            "node",
            "-e",
            "console.log(process.version);console.log(process.execPath)",
          ]
        : [
            process.platform === "win32" ? "python" : "python3",
            "-c",
            "import sys; print(sys.version.split()[0]); print(sys.executable)",
          ];
    const output = await call("command/exec", {
      command,
      cwd: runtime.tempRoot,
      timeoutMs: 15000,
    });
    summary.dependencyInstall[artifact.name] = output;
    check(
      `${artifact.name}InstalledChildPath`,
      output.exitCode === 0 &&
        output.stdout.includes(artifact.version) &&
        output.stdout.includes(runtimeRoot),
    );
  }
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "dependencies-installed.png"),
    animations: "disabled",
  });
}

function restorePermissions() {
  if (permissionRestore) {
    fs.chmodSync(permissionRestore.directory, permissionRestore.mode);
    permissionRestore = null;
  }
}

try {
  await ensureElectronFixtureBuild({
    rootDir: process.cwd(),
    logPrefix: "settings-configuration",
  });
  runtime = createTempRuntimeEnv();
  runtime.appServerEnv = resolveElectronAppServerRuntimeEnv({
    repoRoot: process.cwd(),
    env: {
      ...runtime.env,
      APP_SERVER_BIN: electronAppServerBinaryDestination({
        outputRoot: path.resolve("dist-electron"),
      }),
    },
  });
  await launch();
  const lastSettingsItem = handle.page
    .locator('[data-testid^="settings-sidebar-tab-"]')
    .last();
  check(
    "aboutIsLastSettingsItem",
    (await lastSettingsItem.getAttribute("data-testid")) ===
      "settings-sidebar-tab-about",
  );
  await lastSettingsItem.scrollIntoViewIfNeeded();
  await handle.page.screenshot({
    path: path.join(options.evidenceDir, "about-menu.png"),
    animations: "disabled",
  });
  check(
    "absentSystemRequirements",
    (await call("configRequirements/read")).requirements === null,
  );
  check(
    "realElectronAndPreload",
    summary.launches.every((entry) => entry.electron && entry.hasInvokeBridge),
  );
  check(
    "configurationNavigation",
    (await handle.page
      .locator(
        '[data-testid="settings-sidebar-tab-configuration"][aria-current="page"]',
      )
      .count()) === 1,
  );
  check(
    "noManualSave",
    (await handle.page.getByTestId("execution-policy-save").count()) === 0,
  );
  check(
    "networkHiddenForReadOnly",
    (await row("sandbox_workspace_write-network_access").count()) === 0,
  );
  const nativeLayers = await call("config/read", { includeLayers: true });
  check(
    "nativeUnmanagedLayerIdentity",
    nativeLayers.layers.filter((layer) => layer.name.type === "user").length ===
      1 &&
      nativeLayers.layers.every((layer) => layer.name.type !== "mdm") &&
      Object.values(nativeLayers.origins).every(
        (origin) => origin.name.type !== "mdm",
      ),
  );
  const scope = handle.page.locator("#configuration-scope-value").locator("..");
  await scope.press("ArrowDown");
  await handle.page.getByRole("menu").waitFor();
  check(
    "noFabricatedAdminScope",
    (await handle.page
      .getByRole("menuitemradio", { name: "管理员", exact: true })
      .count()) === 0,
  );
  await handle.page.getByRole("menu").press("Escape");
  await handle.page.getByRole("menu").waitFor({ state: "hidden" });
  await screenshot("initial");
  await verifyDependencies();
  await choose("approval_policy", "从不询问");
  await choose("sandbox_mode", "工作区写入");
  const network = row("sandbox_workspace_write-network_access").getByRole(
    "switch",
  );
  await network.click();
  await handle.page.waitForFunction(
    () =>
      document
        .querySelector(
          "#configuration-sandbox_workspace_write-network_access button",
        )
        ?.getAttribute("aria-checked") === "true",
  );
  await choose("model_verbosity", "高");
  await choose("model_reasoning_summary", "详细");
  const saved = await call("config/read", { includeLayers: true });
  check(
    "uiValuesPersisted",
    saved.config.approval_policy === "never" &&
      saved.config.sandbox_mode === "workspace-write" &&
      saved.config.sandbox_workspace_write.network_access === true &&
      saved.config.model_verbosity === "high" &&
      saved.config.model_reasoning_summary === "detailed",
  );
  const thread = (
    await call("thread/start", {
      cwd: runtime.tempRoot,
      model: "fixture-model",
      modelProvider: "fixture-provider",
    })
  ).thread;
  check(
    "newThreadConsumesUiDefaults",
    thread.extra.approvalPolicy === "never" &&
      thread.extra.sandboxPolicy === "workspace-write" &&
      thread.extra.sandboxNetworkAccess === true &&
      thread.extra.modelVerbosity === "high" &&
      thread.extra.reasoningSummary === "detailed",
  );
  if (process.platform !== "win32") {
    const configFile = saved.layers[0].name.file;
    const directory = path.dirname(configFile);
    check(
      "writeDenialIsIsolated",
      directory.startsWith(`${runtime.tempRoot}${path.sep}`),
    );
    permissionRestore = {
      directory,
      mode: fs.statSync(directory).mode & 0o777,
    };
    fs.chmodSync(directory, 0o555);
    try {
      await choose("model_verbosity", "低", true);
      check(
        "failedSaveKeepsConfirmedValue",
        (await control("model_verbosity").textContent()).includes("高"),
      );
      let ioCauseVerified = false;
      try {
        await call("config/value/write", {
          keyPath: "model_verbosity",
          value: "low",
          mergeStrategy: "upsert",
          filePath: configFile,
          expectedVersion: saved.layers[0].version,
        });
      } catch (error) {
        ioCauseVerified = /EACCES|Permission denied|os error 13/i.test(
          String(error),
        );
      }
      check("realWriteIoError", ioCauseVerified);
      await handle.page.screenshot({
        path: path.join(options.evidenceDir, "write-error.png"),
        animations: "disabled",
      });
    } finally {
      restorePermissions();
    }
    await row("model_verbosity")
      .getByRole("button", { name: "重试", exact: true })
      .click();
    await handle.page.waitForFunction(() =>
      document
        .querySelector("#configuration-model_verbosity button[aria-haspopup]")
        ?.textContent?.includes("低"),
    );
    check(
      "rowRetrySavedRequestedValue",
      (await call("config/read", { includeLayers: true })).config
        .model_verbosity === "low",
    );
    await choose("model_verbosity", "高");
  } else
    summary.writeDenialNotRun =
      "POSIX permission-denial fixture; Windows needs its own filesystem test";
  await control("model_reasoning_summary").focus();
  await control("model_reasoning_summary").press("ArrowDown");
  await handle.page.getByRole("menu").waitFor();
  await handle.page.keyboard.press("Escape");
  await handle.page.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector(
        "#configuration-model_reasoning_summary button[aria-haspopup]",
      ),
  );
  check("keyboardFocusRestored", true);
  await screenshot("configured");
  await handle.page.getByTestId("settings-sidebar-tab-appearance").click();
  await handle.page.getByRole("radio", { name: "深色", exact: true }).click();
  await openConfiguration();
  await handle.page.waitForFunction(() =>
    document.documentElement.classList.contains("dark"),
  );
  await screenshot("dark");
  await handle.page.setViewportSize({ width: 900, height: 760 });
  await screenshot("narrow");
  await close();
  await launch();
  check(
    "coldAbsentSystemRequirements",
    (await call("configRequirements/read")).requirements === null,
  );
  await dependencyUiReady(installDependencies);
  const coldDependencies = await call("primaryRuntime/diagnoseDependencies", {
    probeExecutables: true,
  });
  check(
    "coldDependencies",
    coldDependencies.enabled === installDependencies &&
      coldDependencies.installed === installDependencies &&
      coldDependencies.update === null,
  );
  const cold = await call("config/read", { includeLayers: true });
  check(
    "coldConfigValues",
    cold.config.model_verbosity === "high" &&
      cold.config.approval_policy === "never" &&
      cold.config.sandbox_workspace_write.network_access === true,
  );
  check(
    "coldUiValues",
    (await control("model_verbosity").textContent()).includes("高") &&
      (await control("approval_policy").textContent()).includes("从不询问") &&
      (await row("sandbox_workspace_write-network_access")
        .getByRole("switch")
        .getAttribute("aria-checked")) === "true",
  );
  await choose("model_verbosity", "模型默认");
  check(
    "nullModelDefaultPersisted",
    !Object.hasOwn(
      (await call("config/read", { includeLayers: true })).config,
      "model_verbosity",
    ),
  );
  const modelDefaultThread = (
    await call("thread/start", {
      cwd: runtime.tempRoot,
      model: "fixture-model",
      modelProvider: "fixture-provider",
    })
  ).thread;
  check(
    "newThreadConsumesModelDefault",
    modelDefaultThread.extra.modelVerbosity === null &&
      modelDefaultThread.extra.reasoningSummary === "detailed",
  );
  const resumed = (await call("thread/resume", { threadId: thread.id })).thread;
  check(
    "existingThreadSnapshotStable",
    resumed.extra.modelVerbosity === "high" &&
      resumed.extra.reasoningSummary === "detailed" &&
      resumed.extra.sandboxNetworkAccess === true,
  );
  await close();
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  check(
    "currentConfigWriteObserved",
    summary.trace.methods.includes("config/value/write"),
  );
  check(
    "currentRequirementsReadObserved",
    summary.trace.methods.includes("configRequirements/read"),
  );
  check(
    "noMockOrLegacy",
    summary.trace.mockFallbackHitCount === 0 &&
      summary.trace.legacyCommands.length === 0,
  );
  check(
    "noConsoleOrPageErrors",
    consoleErrors.length === 0 && pageErrors.length === 0,
  );
  check(
    "twoNormalRestarts",
    summary.launches.length === 2 && summary.teardowns.length === 2,
  );
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  check("freshCandidateBuild", summary.freshness.ready);
  summary.result = "pass";
} catch (error) {
  summary.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  restorePermissions();
  if (handle) {
    try {
      await close();
    } catch (error) {
      summary.teardownFailure = String(error);
      process.exitCode = 1;
    }
  }
  summary.consoleErrors = consoleErrors;
  summary.pageErrors = pageErrors;
  summary.trace = summarizeSettingsAppearanceTrace(traces);
  summary.freshness = inspectElectronFixtureBuildFreshness({
    rootDir: process.cwd(),
  });
  summary.completedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(options.evidenceDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        result: summary.result,
        assertions: summary.assertions,
        failure: summary.failure,
        evidenceDir: options.evidenceDir,
      },
      null,
      2,
    ),
  );
}
