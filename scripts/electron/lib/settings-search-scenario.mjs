import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  openSettings,
  waitForPageCondition,
} from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";

const messages = JSON.parse(
  fs.readFileSync(
    new URL("../../../src/i18n/resources/zh-CN/settings.json", import.meta.url),
    "utf8",
  ),
);
const targets = [
  ["general-language", "settings.desktop.language"],
  ["profile-displayName", "settings.profile.field.displayName.label"],
  ["profile-bio", "settings.profile.field.bio.label"],
  ["environment-shell-enable", "settings.environment.shellImport.enable.label"],
  [
    "environment-shell-timeout",
    "settings.environment.shellImport.timeout.label",
  ],
  ["environment-overrides", "settings.environment.overrides.title"],
  ...["workspace", "plan", "shell", "network"].map((field) => [
    `execution-policy-${field}`,
    `settings.executionPolicy.${field}.title`,
  ]),
  ...[
    ["search", "engine", "searchChain.engine"],
    ["search", "provider", "searchChain.provider"],
    ["search", "provider-priority", "searchChain.providerPriority"],
    ["providers", "tavily-key", "providers.tavily"],
    ["providers", "bing-key", "providers.bing"],
    ["providers", "google-key", "providers.googleApi"],
    ["providers", "google-engine-id", "providers.googleEngine"],
    ["mse", "mse-priority", "mse.priority"],
    ["mse", "mse-max-per-engine", "mse.maxPerEngine"],
    ["mse", "mse-max-total", "mse.maxTotal"],
    ["mse", "mse-timeout", "mse.timeout"],
    ["mse", "mse-custom-engine-name", "mse.customName"],
    ["mse", "mse-custom-engine-template", "mse.customTemplate"],
    ["images", "pexels-key", "images.pexels"],
    ["images", "pixabay-key", "images.pixabay"],
  ].map(([tab, field, message]) => [
    `web-search-${field}`,
    `settings.webSearch.${message}.label`,
    tab,
  ]),
  ...["enabled", "tools", "delete", "instructions"].map((field) => [
    `memory-${field}`,
    `settings.personalization.${field}`,
  ]),
  ...[
    ["theme", "theme"],
    ["skin", "colorScheme"],
  ].map(([field, message]) => [
    `appearance-${field}`,
    `settings.appearance.${message}.title`,
  ]),
];

export async function runSettingsSearchScenario({
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
  const searchShortcut = process.platform === "darwin" ? "Meta+f" : "Control+f";
  await openSettings(page, options);
  const desktop = page.getByTestId("settings-sidebar-search");
  const dialog = page.getByTestId("settings-unsaved-changes-dialog");
  const keep = dialog.getByRole("button", { name: "继续编辑", exact: true });
  const discard = dialog.getByRole("button", { name: "放弃更改", exact: true });
  const locate = async (id) => {
    await waitForPageCondition(
      page,
      options,
      ({ id }) => {
        const target = [
          ...document.querySelectorAll("main [data-settings-search-target]"),
        ].find((node) => node.dataset.settingsSearchTarget === id);
        return (
          target?.dataset.settingsSearchActive === "true" &&
          document.activeElement === target
        );
      },
      `search target ${id} focused`,
      { id },
    );
    const observation = await page
      .locator(`[data-settings-search-target="${id}"]`)
      .evaluate((node) => {
        const main = node.closest("main");
        const box = node.getBoundingClientRect();
        const owner = main.getBoundingClientRect();
        return {
          targetId: node.dataset.settingsSearchTarget,
          focused: document.activeElement === node,
          top: box.top,
          ownerTop: owner.top,
          ownerBottom: owner.bottom,
          scrollTop: main.scrollTop,
          outlineColor: getComputedStyle(node).outlineColor,
          outlineWidth: getComputedStyle(node).outlineWidth,
          viewportOverflow:
            document.documentElement.scrollWidth > window.innerWidth,
        };
      });
    assert.ok(
      observation.top >= observation.ownerTop - 1 &&
        observation.top < observation.ownerBottom,
    );
    assert.equal(observation.outlineWidth, "2px");
    assert.equal(observation.viewportOverflow, false);
    return observation;
  };
  const search = async (id, query, input = desktop) => {
    await input.fill(query);
    const label = messages[targets.find(([targetId]) => targetId === id)[1]];
    await page
      .getByRole("option")
      .filter({ hasText: label })
      .first()
      .waitFor({ state: "visible" });
    await input.press("ArrowDown");
    await input.press("ArrowUp");
    await input.press("Enter");
    return locate(id);
  };
  const observations = [];
  for (const [id, key, tab, queryKey] of targets) {
    stage(`settings-search-${id}`);
    observations.push(await search(id, messages[queryKey || key]));
    if (tab && id.startsWith("web-search-")) {
      assert.equal(
        await page
          .getByTestId(`web-search-tab-${tab}`)
          .getAttribute("aria-selected"),
        "true",
      );
      if (id.endsWith("-key"))
        assert.equal(
          await page.locator(`#${id}`).getAttribute("type"),
          "password",
        );
    }
  }
  stage("settings-search-repeat-and-description");
  const description = messages["settings.environment.overrides.description"];
  await search("environment-overrides", description);
  await search(
    "environment-overrides",
    messages["settings.environment.overrides.title"],
  );
  stage("settings-search-dirty-keep-and-discard");
  await search("profile-bio", messages["settings.profile.field.bio.label"]);
  await page.getByRole("button", { name: "编辑显示名称", exact: true }).click();
  const name = page.locator("#profile-field-displayName");
  await name.fill("search fixture unsaved draft");
  const beforeRequest = await page.evaluate(() =>
    sessionStorage.getItem("lime.appNavigation.restore.v1"),
  );
  await desktop.fill(
    messages["settings.environment.shellImport.timeout.label"],
  );
  await desktop.press("Enter");
  await dialog.waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() =>
      sessionStorage.getItem("lime.appNavigation.restore.v1"),
    ),
    beforeRequest,
  );
  await page.screenshot({
    path: path.join(evidenceDir, "search-unsaved-dialog.png"),
  });
  await keep.click();
  await dialog.waitFor({ state: "detached" });
  await waitForPageCondition(
    page,
    options,
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "settings-sidebar-search",
    "keep restores search focus",
  );
  assert.equal(await name.inputValue(), "search fixture unsaved draft");
  await desktop.fill(messages["settings.profile.field.bio.label"]);
  await desktop.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await discard.click();
  await locate("profile-bio");
  assert.equal(await name.count(), 0);
  assert.equal(
    isDeepStrictEqual(await read(), initial),
    true,
    "search/discard never writes configuration",
  );

  stage("settings-search-hidden-web-search-tab-dirty");
  await search(
    "web-search-tavily-key",
    messages["settings.webSearch.providers.tavily.hint"],
  );
  const credential = page.locator("#web-search-tavily-key");
  const originalCredential = await credential.inputValue();
  await credential.fill("search fixture private unsaved credential");
  const webParams = await page.evaluate(() =>
    sessionStorage.getItem("lime.appNavigation.restore.v1"),
  );
  await desktop.fill(messages["settings.webSearch.mse.timeout.label"]);
  await desktop.press("Enter");
  await dialog.waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() =>
      sessionStorage.getItem("lime.appNavigation.restore.v1"),
    ),
    webParams,
  );
  assert.equal(
    await page
      .getByTestId("web-search-tab-providers")
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator("#web-search-mse-timeout").count(), 0);
  await keep.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await credential.inputValue(),
    "search fixture private unsaved credential",
  );
  await waitForPageCondition(
    page,
    options,
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "settings-sidebar-search",
    "hidden tab keep restores desktop search focus",
  );
  assert.equal(await credential.getAttribute("type"), "password");
  await desktop.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await discard.click();
  await locate("web-search-mse-timeout");
  await page.screenshot({
    path: path.join(evidenceDir, "search-web-search-mse.png"),
  });
  await page.getByTestId("web-search-tab-images").click();
  assert.equal(await page.locator("#web-search-mse-timeout").count(), 0);
  await search(
    "web-search-mse-timeout",
    messages["settings.webSearch.mse.timeout.label"],
  );
  await search(
    "web-search-tavily-key",
    messages["settings.webSearch.providers.tavily.label"],
  );
  assert.equal(await credential.inputValue(), originalCredential);
  assert.equal(
    isDeepStrictEqual(await read(), initial),
    true,
    "hidden tab search/discard never persists credentials",
  );

  stage("settings-search-instructions-draft");
  await search(
    "memory-instructions",
    messages["settings.personalization.instructions"],
  );
  await page.getByTestId("settings-instructions-open").click();
  const imported = page.locator(
    '[data-testid="settings-instructions-editor"] textarea',
  );
  await imported.fill("search fixture private instruction draft");
  const memoryParams = await page.evaluate(() =>
    sessionStorage.getItem("lime.appNavigation.restore.v1"),
  );
  await desktop.fill(messages["settings.personalization.tools"]);
  await desktop.press("Enter");
  await dialog.waitFor({ state: "visible" });
  assert.equal(
    await page.evaluate(() =>
      sessionStorage.getItem("lime.appNavigation.restore.v1"),
    ),
    memoryParams,
  );
  await keep.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await imported.inputValue(),
    "search fixture private instruction draft",
  );
  await desktop.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await discard.click();
  const memoryInstructions = await locate("memory-tools");
  await page.screenshot({
    path: path.join(evidenceDir, "search-memory-tools.png"),
  });
  await search(
    "memory-instructions",
    messages["settings.personalization.instructions"],
  );
  await search("appearance-theme", messages["settings.appearance.theme.title"]);
  const appearance = await locate("appearance-theme");
  await page.screenshot({
    path: path.join(evidenceDir, "search-appearance.png"),
  });
  assert.equal(
    isDeepStrictEqual(await read(), initial),
    true,
    "instruction search/discard never writes config",
  );

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
  };
  const themes = [];
  for (const [mode, system] of [
    ["light", null],
    ["dark", null],
    ["system", "light"],
    ["system", "dark"],
  ]) {
    stage(`settings-search-theme-${mode}-${system || "explicit"}`);
    await page.emulateMedia({ colorScheme: system });
    await chooseTheme(mode);
    await desktop.fill(messages["settings.profile.field.bio.label"]);
    if (mode === "light")
      await page.screenshot({
        path: path.join(evidenceDir, "search-results-light.png"),
      });
    await desktop.press("Enter");
    const observation = await locate("profile-bio");
    await search(
      "web-search-pexels-key",
      messages["settings.webSearch.images.pexels.label"],
    );
    const webSearch = await locate("web-search-pexels-key");
    await search(
      "memory-instructions",
      messages["settings.personalization.instructions"],
    );
    const memory = await locate("memory-instructions");
    await search("general-language", messages["settings.desktop.language"]);
    const appearance = await locate("general-language");
    const effective = await page.evaluate(() =>
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    );
    assert.equal(effective, system || mode);
    await page.screenshot({
      path: path.join(
        evidenceDir,
        `search-theme-${mode}${system ? "-" + system : ""}.png`,
      ),
    });
    themes.push({
      mode,
      system,
      effective,
      ...observation,
      webSearch,
      memory,
      appearance,
    });
  }
  await page.emulateMedia({ colorScheme: null });
  await chooseTheme(originalTheme);

  stage("settings-search-narrow-dirty-navigation");
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await page.setViewportSize({ width: 600, height: 900 });
  await page.keyboard.press(searchShortcut);
  const narrowSearch = page.getByTestId("settings-sidebar-search");
  await narrowSearch.waitFor({ state: "visible" });
  assert.equal(
    await narrowSearch.evaluate((node) => node === document.activeElement),
    true,
  );
  await search(
    "profile-bio",
    messages["settings.profile.field.bio.label"],
    narrowSearch,
  );
  await page.getByRole("button", { name: "编辑个人简介", exact: true }).click();
  const bio = page.locator("#profile-field-bio");
  await bio.fill("narrow search unsaved draft");
  await page.keyboard.press(searchShortcut);
  await narrowSearch.fill(messages["settings.environment.overrides.title"]);
  await page.screenshot({
    path: path.join(evidenceDir, "search-narrow-results.png"),
  });
  await narrowSearch.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await keep.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await bio.inputValue(), "narrow search unsaved draft");
  await waitForPageCondition(
    page,
    options,
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "settings-sidebar-search",
    "narrow keep restores search focus",
  );
  await narrowSearch.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await discard.click();
  const narrow = await locate("environment-overrides");
  await page.screenshot({
    path: path.join(evidenceDir, "search-narrow-target.png"),
  });
  await page.keyboard.press(searchShortcut);
  await narrowSearch.waitFor({ state: "visible" });
  await search(
    "web-search-mse-timeout",
    messages["settings.webSearch.mse.timeout.label"],
    narrowSearch,
  );
  const timeout = page.locator("#web-search-mse-timeout");
  await timeout.fill("27182");
  await page.keyboard.press(searchShortcut);
  await narrowSearch.fill(messages["settings.webSearch.images.pixabay.label"]);
  await narrowSearch.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await keep.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await timeout.inputValue(), "27182");
  await waitForPageCondition(
    page,
    options,
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "settings-sidebar-search",
    "hidden tab keep restores narrow search focus",
  );
  await narrowSearch.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await discard.click();
  const narrowWebSearch = await locate("web-search-pixabay-key");
  assert.equal(
    await page
      .getByTestId("web-search-tab-images")
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(
    await page.locator("#web-search-pixabay-key").getAttribute("type"),
    "password",
  );
  await page.screenshot({
    path: path.join(evidenceDir, "search-web-search-narrow.png"),
  });
  await page.keyboard.press(searchShortcut);
  await narrowSearch.waitFor({ state: "visible" });
  await search(
    "memory-instructions",
    messages["settings.personalization.instructions"],
    narrowSearch,
  );
  await page.getByTestId("settings-instructions-open").click();
  await imported.fill("narrow search fixture private instruction draft");
  await page.keyboard.press(searchShortcut);
  await narrowSearch.fill(messages["settings.desktop.language"]);
  await narrowSearch.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await keep.click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(
    await imported.inputValue(),
    "narrow search fixture private instruction draft",
  );
  await waitForPageCondition(
    page,
    options,
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "settings-sidebar-search",
    "memory keep restores narrow search focus",
  );
  await narrowSearch.press("Enter");
  await dialog.waitFor({ state: "visible" });
  await discard.click();
  const narrowAppearance = await locate("general-language");
  await page.screenshot({
    path: path.join(evidenceDir, "search-memory-appearance-narrow.png"),
  });
  await page.setViewportSize(viewport);
  assert.equal(
    isDeepStrictEqual(await read(), initial),
    true,
    "themes restored and search did not mutate config",
  );
  await page.getByTestId("settings-back-button").click();
  await waitForSession();
  return {
    targets: observations,
    descriptionAndRepeat: true,
    webSearch: {
      targets: 15,
      tabs: 4,
      hiddenTabKeepAndDiscard: true,
      repeatReopensTab: true,
      maskedCredentials: true,
      noConfigWrite: true,
    },
    memoryAppearance: {
      targets: 7,
      memoryTargets: 4,
      appearanceTargets: 3,
      pendingSearchRetainsInstructionDraft: true,
      discardRemountsWithoutWrite: true,
      repeatFocusesRow: true,
      memoryInstructions,
      appearance,
      narrowAppearance,
    },
    desktopDirty: {
      keptDraft: true,
      canonicalUnchangedUntilDiscard: true,
      sameSectionDiscard: true,
      noConfigWrite: true,
    },
    narrow: {
      viewport: { width: 600, height: 900 },
      ...narrow,
      webSearch: narrowWebSearch,
      shortcutFocused: true,
      keptDraftAndSearch: true,
      panelClosedAfterCommit: true,
    },
    themes,
    originalConfigRestored: true,
    limitations:
      "36 content targets (9 initial + 15 Web Search + 7 Memory + 5 Appearance) and current section titles only; non-OEM fixture/external backend. Current skin, media-emulated system theme and emulated narrow viewport. No reference runtime, production RuntimeBackend/provider, live auth/search, Windows or packaged claim.",
  };
}
