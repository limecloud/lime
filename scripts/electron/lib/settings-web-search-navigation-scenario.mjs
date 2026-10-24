import assert from "node:assert/strict";
import path from "node:path";
import { openSettings } from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";

export const WEB_SEARCH_MODES = ["disabled", "cached", "indexed", "live"];
export async function readSearchConfig(page) {
  const response = await invokeAppServerFromPage(page, "config/read", {
    includeLayers: true,
  });
  assert.ok(response.result?.config);
  return response.result.config;
}
export async function openSearchConfiguration(page, options) {
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-configuration").click();
  await page
    .locator("#configuration-web_search button[aria-haspopup]")
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document.querySelector("#configuration-web_search button[aria-haspopup]")
        ?.disabled === false,
  );
}
export async function selectSearchMode(page, mode) {
  const index = WEB_SEARCH_MODES.indexOf(mode);
  assert.ok(index >= 0);
  await page.locator("#configuration-web_search button[aria-haspopup]").click();
  assert.equal(await page.getByRole("menuitemradio").count(), 4);
  await page.getByRole("menuitemradio").nth(index).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  await page.waitForFunction(() => {
    const row = document.getElementById("configuration-web_search");
    return (
      row?.getAttribute("aria-busy") !== "true" &&
      !row?.querySelector('[role="alert"]')
    );
  });
}
export async function inspectSearchMode(page) {
  await page.locator("#configuration-web_search button[aria-haspopup]").click();
  const items = page.getByRole("menuitemradio");
  assert.equal(await items.count(), 4);
  const checked = await items.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.getAttribute("aria-checked") === "true"),
  );
  const menu = page.getByRole("menu");
  await menu.press("Escape");
  await menu.waitFor({ state: "hidden" });
  const config = await readSearchConfig(page);
  const effective =
    config.web_search ??
    (config.sandbox_mode === "danger-full-access" ? "live" : "cached");
  assert.equal(
    WEB_SEARCH_MODES[checked],
    effective,
    "visible mode matches current persisted configuration",
  );
  return { mode: effective, config };
}
export async function restoreSearchMode(page, initial) {
  await selectSearchMode(page, initial.mode);
  if (initial.config.web_search == null) {
    const response = await invokeAppServerFromPage(page, "config/value/write", {
      keyPath: "web_search",
      value: null,
      mergeStrategy: "replace",
    });
    assert.equal(response.result?.status, "ok");
  }
}
export async function runSettingsWebSearchNavigationScenario({
  page,
  options,
  evidenceDir,
  stage,
  waitForSession,
}) {
  await openSearchConfiguration(page, options);
  const initial = await inspectSearchMode(page);
  stage("web-search-four-immediate-modes");
  const saved = [];
  for (const mode of WEB_SEARCH_MODES) {
    await selectSearchMode(page, mode);
    assert.equal((await inspectSearchMode(page)).mode, mode);
    saved.push(mode);
  }
  await restoreSearchMode(page, initial);
  await page.screenshot({
    path: path.join(evidenceDir, "configuration-web-search.png"),
  });
  await page.getByTestId("settings-sidebar-tab-about").click();
  assert.equal(
    await page.getByTestId("settings-unsaved-changes-dialog").count(),
    0,
  );
  assert.equal(
    (await readSearchConfig(page)).web_search,
    initial.config.web_search,
  );
  await page.getByTestId("settings-back-button").click();
  await waitForSession();
  return {
    saved,
    immediatePersistence: true,
    noManualSave: true,
    noUnsavedPrompt: true,
    originalModeRestored: true,
  };
}
