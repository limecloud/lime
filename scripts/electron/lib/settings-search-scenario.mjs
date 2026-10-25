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
  ["local-environments-projects", "settings.localEnvironments.projects"],
  ...["plan", "shell", "network"].map((field) => [
    `execution-policy-${field}`,
    `settings.executionPolicy.${field}.title`,
  ]),
  [
    "configuration-web_search",
    "settings.configuration.fields.web_search.label",
  ],
  ...["enabled", "tools", "delete", "instructions"].map((field) => [
    `memory-${field}`,
    `settings.personalization.${field}`,
  ]),
  ["appearance-theme", "settings.appearance.theme.title"],
];
for (const [id, key] of targets)
  assert.equal(
    typeof messages[key],
    "string",
    `Missing search label for ${id}`,
  );

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
    const results = page.getByRole("option");
    await results
      .filter({ hasText: label })
      .first()
      .waitFor({ state: "visible" });
    const matches = await results.evaluateAll(
      (nodes, label) =>
        nodes.flatMap((node, index) => {
          const text = [...node.childNodes]
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent)
            .join("")
            .trim();
          return text === label ? [index] : [];
        }),
      label,
    );
    assert.equal(matches.length, 1, `Expected one exact result for ${id}`);
    await input.press("ArrowDown");
    await input.press("ArrowUp");
    for (let index = 0; index < matches[0]; index += 1)
      await input.press("ArrowDown");
    await input.press("Enter");
    return locate(id);
  };
  const observations = [];
  for (const [id, key] of targets) {
    stage(`settings-search-${id}`);
    observations.push(await search(id, messages[key]));
  }
  stage("settings-search-repeat-and-description");
  const description = messages["settings.localEnvironments.description"];
  await search("local-environments-projects", description);
  await search(
    "local-environments-projects",
    messages["settings.localEnvironments.projects"],
  );
  stage("settings-search-web-search-mode");
  await search(
    "configuration-web_search",
    messages["settings.configuration.fields.web_search.description"],
  );
  await search(
    "configuration-web_search",
    messages["settings.configuration.fields.web_search.label"],
  );
  assert.equal(
    await page.getByTestId("settings-unsaved-changes-dialog").count(),
    0,
  );

  stage("settings-search-instructions-draft");
  await search(
    "memory-instructions",
    messages["settings.personalization.instructions"],
  );
  await page
    .getByTestId("settings-instructions-open")
    .click({ position: { x: 12, y: 12 } });
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
    await desktop.fill(messages["settings.personalization.instructions"]);
    if (mode === "light")
      await page.screenshot({
        path: path.join(evidenceDir, "search-results-light.png"),
      });
    await desktop.press("Enter");
    const observation = await locate("memory-instructions");
    await search(
      "configuration-web_search",
      messages["settings.configuration.fields.web_search.label"],
    );
    const webSearch = await locate("configuration-web_search");
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

  stage("settings-search-narrow-navigation");
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
  const narrow = await search(
    "local-environments-projects",
    messages["settings.localEnvironments.projects"],
    narrowSearch,
  );
  await page.screenshot({
    path: path.join(evidenceDir, "search-narrow-target.png"),
  });
  await page.keyboard.press(searchShortcut);
  await narrowSearch.waitFor({ state: "visible" });
  const narrowWebSearch = await search(
    "configuration-web_search",
    messages["settings.configuration.fields.web_search.label"],
    narrowSearch,
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
  await page
    .getByTestId("settings-instructions-open")
    .click({ position: { x: 12, y: 12 } });
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
      targets: 1,
      canonicalConfigurationTarget: true,
      repeatFocusesRow: true,
      noConfigWrite: true,
    },
    memoryAppearance: {
      targets: 7,
      memoryTargets: 4,
      appearanceTargets: 1,
      pendingSearchRetainsInstructionDraft: true,
      discardRemountsWithoutWrite: true,
      repeatFocusesRow: true,
      memoryInstructions,
      appearance,
      narrowAppearance,
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
      "Current registered content targets and section titles only; non-OEM fixture/external backend. Fixed neutral colors, media-emulated system theme and emulated narrow viewport. No reference runtime, production RuntimeBackend/provider, live auth/search, Windows or packaged claim.",
  };
}
