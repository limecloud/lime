import assert from "node:assert/strict";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  openSettings,
  waitForPageCondition,
} from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";

export async function runSettingsEnvironmentNavigationScenario({
  page,
  options,
  evidenceDir,
  stage,
  waitForSession,
}) {
  const read = async () => {
    const response = await invokeAppServerFromPage(page, "config/read", {
      includeLayers: true,
    });
    assert.ok(response.result?.config);
    return response.result.config;
  };
  const initial = await read();
  const timeout = String(initial.environment?.shell_import?.timeout_ms ?? 1500);
  const changedTimeout = timeout === "2400" ? "2600" : "2400";
  const field = page.locator("#environment-shell-import-timeout");
  const save = page.getByTestId("environment-save");
  const dialog = page.getByTestId("settings-unsaved-changes-dialog");
  const keep = dialog.getByRole("button", { name: "继续编辑", exact: true });
  const discard = dialog.getByRole("button", { name: "放弃更改", exact: true });
  const clean = () =>
    waitForPageCondition(
      page,
      options,
      () => {
        const save = document.querySelector('[data-testid="environment-save"]');
        return (
          save?.disabled === true && save.textContent.trim() === "保存并应用"
        );
      },
      "Environment save acknowledgement and clean draft",
    );
  const open = async () => {
    await openSettings(page, options);
    await page.getByTestId("settings-sidebar-tab-environment").click();
    await field.waitFor({ state: "visible" });
    await clean();
    assert.equal(await field.inputValue(), timeout);
  };
  const about = () =>
    waitForPageCondition(
      page,
      options,
      () =>
        document
          .querySelector('[data-testid="settings-sidebar-tab-about"]')
          ?.getAttribute("aria-current") === "page" &&
        !document.querySelector('[data-testid="settings-page-loading"]'),
      "Environment committed About",
    );
  const sameConfig = async (expected, message) => {
    // Never write environment values or credential-bearing Config to evidence.
    assert.equal(isDeepStrictEqual(await read(), expected), true, message);
  };
  const observations = [];
  for (const target of ["section", "back"]) {
    stage("unsaved-environment-" + target);
    await open();
    await field.fill(changedTimeout);
    const trigger = {
      section: page.getByTestId("settings-sidebar-tab-about"),
      back: page.getByTestId("settings-back-button"),
    }[target];
    await trigger.click();
    await dialog.waitFor({ state: "visible" });
    await keep.click();
    assert.equal(await field.inputValue(), changedTimeout);
    await sameConfig(initial, "confirmation never persists Environment");
    await trigger.click();
    await dialog.waitFor({ state: "visible" });
    if (target === "section")
      await page.screenshot({
        path: path.join(evidenceDir, "environment-unsaved-dialog.png"),
      });
    await discard.click();
    await dialog.waitFor({ state: "detached" });
    if (target === "section") {
      await about();
      await page.getByTestId("settings-back-button").click();
    }
    await waitForSession();
    await sameConfig(initial, "discard never persists Environment");
    observations.push({
      target,
      keptInput: true,
      discardedWithoutSave: true,
      sameSessionReturn: true,
    });
  }
  stage("environment-save-read-and-reopen");
  await open();
  await field.fill(changedTimeout);
  await save.click();
  await clean();
  const saved = await read();
  assert.equal(
    String(saved.environment?.shell_import?.timeout_ms),
    changedTimeout,
  );
  const stableFields = (config) => {
    const value = structuredClone(config);
    // Rust omits the entire default EnvironmentConfig from config/read.
    const environment = value.environment ?? {};
    value.environment = {
      ...environment,
      shell_import: {
        ...environment.shell_import,
        enabled: environment.shell_import?.enabled ?? false,
      },
      variables: environment.variables ?? [],
    };
    delete value.environment?.shell_import?.timeout_ms;
    return value;
  };
  assert.equal(
    isDeepStrictEqual(stableFields(saved), stableFields(initial)),
    true,
    "unmodified configuration preserved",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "environment-saved.png"),
  });
  await page.getByTestId("settings-sidebar-tab-about").click();
  await about();
  assert.equal(await dialog.count(), 0);
  await page.getByTestId("settings-sidebar-tab-environment").click();
  await field.waitFor({ state: "visible" });
  await clean();
  assert.equal(await field.inputValue(), changedTimeout);
  await field.fill(timeout);
  await save.click();
  await clean();
  await sameConfig(initial, "original Environment configuration restored");
  stage("environment-theme-projection");
  const originalTheme = await page.evaluate(
    () => document.documentElement.dataset.limeTheme || "system",
  );
  const chooseTheme = async (mode) => {
    await page.getByTestId("settings-sidebar-tab-appearance").click();
    await page
      .getByRole("radio", {
        name: { light: "浅色", dark: "深色", system: "跟随系统" }[mode],
        exact: true,
      })
      .click();
    await page.getByTestId("settings-sidebar-tab-environment").click();
    await field.waitFor({ state: "visible" });
    await clean();
  };
  const themes = [];
  for (const [mode, simulatedSystem] of [
    ["light", null],
    ["dark", null],
    ["system", "light"],
    ["system", "dark"],
  ]) {
    await page.emulateMedia({ colorScheme: simulatedSystem });
    await chooseTheme(mode);
    const projection = await waitForPageCondition(
      page,
      options,
      ({ mode, effective }) => {
        const root = document.documentElement;
        if (
          root.dataset.limeTheme !== mode ||
          root.dataset.limeThemeEffective !== effective
        )
          return null;
        const input = document.querySelector(
          "#environment-shell-import-timeout",
        );
        if (!(input instanceof HTMLInputElement)) return null;
        const style = getComputedStyle(input);
        return {
          mode,
          effective,
          foreground: style.color,
          background: style.backgroundColor,
          viewportOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      "Environment theme projection " + mode + "/" + simulatedSystem,
      { mode, effective: mode === "system" ? simulatedSystem : mode },
    );
    assert.notEqual(
      projection.foreground,
      projection.background,
      "environment input remains legible",
    );
    assert.equal(
      projection.viewportOverflow,
      false,
      "environment has no document horizontal overflow",
    );
    themes.push(projection);
    await page.screenshot({
      path: path.join(
        evidenceDir,
        "environment-theme-" +
          mode +
          (simulatedSystem ? "-" + simulatedSystem : "") +
          ".png",
      ),
    });
  }
  await page.emulateMedia({ colorScheme: null });
  await chooseTheme(originalTheme);
  await sameConfig(initial, "theme projection does not alter configuration");
  await page.getByTestId("settings-back-button").click();
  await waitForSession();
  return {
    themes,
    observations,
    savedAndReopened: true,
    originalConfigRestored: true,
    untouchedConfigurationPreserved: true,
    canonicalEnvironmentShape: {
      initialPresent: Object.hasOwn(initial, "environment"),
      savedPresent: Object.hasOwn(saved, "environment"),
      defaultOmissionNormalizedForUntouchedFields: true,
    },
    componentOnlyNavigation: {
      target: "new",
      reason:
        "Settings unmounts AppSidebar, including its New button and search shortcut. The canonical New navigation guard is covered by component integration; no native settings entry is available.",
    },
    limitations:
      "Real isolated configuration and Electron/preload/App Server; controlled external backend bypasses production RuntimeBackend/provider. Failure, duplicate, in-flight, late completion, raw input and five-language cases use component evidence. System color-scheme uses Playwright media emulation, current skin only; no OS theme dispatch, live Shell import, Windows or reference runtime parity claim.",
  };
}
