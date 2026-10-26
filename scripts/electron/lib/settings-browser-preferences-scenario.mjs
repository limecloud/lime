import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse } from "yaml";
import {
  openSettings,
  readConfigFromPage,
  waitForPageCondition,
} from "../mcp-config-fixture-smoke.mjs";
import { reloadRendererDocument } from "../../lib/chat-fixture/rpc.mjs";
import {
  captureInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
  withInvokeTraceCollector,
} from "../../lib/invoke-trace-collector.mjs";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "./mcp-config-fixture-evidence.mjs";

const web = "open-link-in-target-preference";
const local = "open-local-url-in-target-preference";
const shortcut = "external-browser-link-shortcut";
const browserSection = "browser-use";
const keys = [web, local, shortcut];
const values = (desktop) =>
  Object.fromEntries(
    keys.map((key) => [
      key,
      desktop?.[key] ?? (key === shortcut ? "primary" : undefined),
    ]),
  );
const withoutDesktop = (config) =>
  Object.fromEntries(
    Object.entries(config).filter(([key]) => key !== "desktop"),
  );

/** 比较时只输出布尔结果，不把其它配置中的凭证放入断言或证据。 */
export function assertBrowserPreferenceReadback({
  snapshot,
  disk,
  expected,
  initial,
  configPath,
}) {
  assert.equal(
    isObservedPreloadAppServerResponse(
      snapshot?.response?.ipcObservation,
      "config/read",
    ),
    true,
    "browser preferences require current preload IPC response identity",
  );
  assert.equal(
    typeof snapshot.filePath === "string" &&
      path.resolve(snapshot.filePath) === path.resolve(configPath),
    true,
    "browser preferences read the isolated user layer",
  );
  assert.equal(
    isDeepStrictEqual(values(snapshot.config.desktop), values(expected)),
    true,
    "public readback contains all three exact preference values",
  );
  assert.equal(
    isDeepStrictEqual(values(disk.desktop), values(expected)),
    true,
    "isolated YAML contains all three exact preference values",
  );
  assert.equal(
    isDeepStrictEqual(withoutDesktop(snapshot.config), withoutDesktop(initial)),
    true,
    "preference writes preserve unrelated configuration",
  );
  return {
    currentPreload: true,
    publicValues: true,
    diskValues: true,
    unrelatedConfig: true,
  };
}

/** 真正操作三项控件；每次重载分开取trace，不跨document伪造连续观察。 */
export async function runBrowserPreferencesScenario({
  page,
  options,
  evidenceDir,
  configPath,
  stage,
}) {
  const messages = JSON.parse(
    fs.readFileSync("src/i18n/resources/zh-CN/settings.json", "utf8"),
  );
  let initial;
  let expected;
  let originalEffective;
  const readbacks = [];
  const segments = [];
  const reloads = [];
  const choices = [
    {
      id: "browser-web-target",
      key: web,
      section: browserSection,
      search: "settings.browser.web",
    },
    {
      id: "browser-local-target",
      key: local,
      section: browserSection,
      search: "settings.browser.local",
    },
    {
      id: "keyboard-external-browser-link",
      key: shortcut,
      section: "keyboard-shortcuts",
      search: "settings.keyboardShortcuts.externalLink",
    },
  ];
  const mac = await page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform),
  );
  const click = messages["settings.keyboardShortcuts.click"];
  const targets = {
    "in-app-browser": messages["settings.browser.inApp"],
    "external-browser": messages["settings.browser.external"],
  };
  const modifiers = {
    unassigned: messages["settings.keyboardShortcuts.unassigned"],
    primary: `${mac ? "⌘" : "Ctrl"}+${click}`,
    alt: `${mac ? "⌥" : "Alt"}+${click}`,
    "primary-shift": `${mac ? "⇧⌘" : "Ctrl+Shift"}+${click}`,
  };
  const labels = (key) => (key === shortcut ? modifiers : targets);
  const verify = async () => {
    const snapshot = await readConfigFromPage(page);
    readbacks.push(
      assertBrowserPreferenceReadback({
        snapshot,
        disk: parse(fs.readFileSync(configPath, "utf8")),
        expected,
        initial,
        configPath,
      }),
    );
    return snapshot;
  };
  const navigate = async (section) => {
    await page.getByTestId(`settings-sidebar-tab-${section}`).click();
    await waitForPageCondition(
      page,
      options,
      ({ section }) =>
        document
          .querySelector(`[data-testid="settings-sidebar-tab-${section}"]`)
          ?.getAttribute("aria-current") === "page" &&
        !document.querySelector('[data-testid="settings-page-loading"]'),
      `browser preference section ${section} ready`,
      { section },
    );
  };
  const assertVisible = async ({ id, key }) => {
    const label = labels(key)[expected[key] ?? originalEffective[key]];
    await waitForPageCondition(
      page,
      options,
      ({ id, label }) => {
        const button = document.querySelector(`#${id} button`);
        return (
          button && !button.disabled && button.textContent.trim() === label
        );
      },
      `browser preference ${id} saved and enabled`,
      { id, label },
    );
  };
  const choose = async (choice, value) => {
    const { id, key } = choice;
    await assertVisible(choice);
    const before = await verify();
    const oldValue = expected[key] ?? originalEffective[key];
    await page.locator(`#${id} button`).press("ArrowDown");
    const menu = page.getByRole("menu");
    await menu.waitFor({ state: "visible" });
    assert.deepEqual(
      await menu.getByRole("menuitemradio").allTextContents(),
      Object.values(labels(key)),
    );
    assert.equal(
      await menu
        .getByRole("menuitemradio", {
          name: labels(key)[oldValue],
          exact: true,
        })
        .getAttribute("aria-checked"),
      "true",
    );
    await menu
      .getByRole("menuitemradio", { name: labels(key)[value], exact: true })
      .click();
    expected[key] = value;
    await assertVisible(choice);
    const after = await verify();
    assert.equal(
      after.version === before.version,
      oldValue === value,
      "only changing a preference advances the authoritative version",
    );
  };
  const back = async () => {
    await page.getByTestId("settings-back-button").click();
    await page
      .getByTestId("settings-navigation")
      .waitFor({ state: "detached" });
  };
  const segment = async (name, action) => {
    stage(`browser-preferences-${name}`);
    const proof = await withInvokeTraceCollector(
      page,
      async (handle) => {
        await action();
        const captured = await captureInvokeTraceCollector(page, handle);
        const trace = validateInvokeTraceCollectorCapture(captured, handle);
        assert.equal(
          trace.complete,
          true,
          "browser preference native trace complete",
        );
        assert.equal(
          trace.ledgerEntries.some(
            (entry) =>
              entry.status === "error" || entry.transport !== "electron-ipc",
          ),
          false,
        );
        const requests = parseJsonRpcRequestsFromInvokeTrace(
          JSON.stringify(trace.ledgerEntries),
        );
        assert.equal(
          requests.some((request) => request.method === "turn/start"),
          false,
        );
        return {
          name,
          provenance: trace.provenance,
          methods: [...new Set(requests.map((request) => request.method))],
          desktopWrites: requests.filter(
            (request) =>
              request.method === "config/batchWrite" &&
              request.params?.edits?.some((edit) => edit.keyPath === "desktop"),
          ).length,
          complete: true,
        };
      },
      (stopped) => assert.equal(stopped.nativeRestored, true),
    );
    segments.push(proof);
  };

  await segment("change-and-switch", async () => {
    const first = await readConfigFromPage(page);
    assert.equal(
      typeof first.filePath === "string" &&
        fs.realpathSync(first.filePath) === fs.realpathSync(configPath),
      true,
      "App Server user layer is the isolated Desktop Host config file",
    );
    configPath = first.filePath;
    initial = first.config;
    expected = { [shortcut]: "primary", ...initial.desktop };
    originalEffective = {
      [web]: "external-browser",
      [local]: "in-app-browser",
      ...expected,
    };
    await verify();
    await openSettings(page, options);
    await navigate(browserSection);
    const changed = {
      [web]:
        originalEffective[web] === "in-app-browser"
          ? "external-browser"
          : "in-app-browser",
      [local]:
        originalEffective[local] === "in-app-browser"
          ? "external-browser"
          : "in-app-browser",
      [shortcut]:
        originalEffective[shortcut] === "alt" ? "primary-shift" : "alt",
    };
    for (const choice of choices) {
      await navigate(choice.section);
      await choose(choice, changed[choice.key]);
    }
    await choose(choices[2], changed[shortcut]);
    await page.screenshot({
      path: path.join(evidenceDir, "browser-shortcut-changed.png"),
    });
    await navigate("about");
    await navigate(browserSection);
    await assertVisible(choices[0]);
    await assertVisible(choices[1]);
    await page.screenshot({
      path: path.join(evidenceDir, "browser-preferences-changed.png"),
    });
    await back();
  });

  reloads.push(await reloadRendererDocument(page, options));
  await segment("reload-and-restore", async () => {
    await verify();
    await openSettings(page, options);
    await navigate(browserSection);
    await assertVisible(choices[0]);
    await assertVisible(choices[1]);
    await page.screenshot({
      path: path.join(evidenceDir, "browser-preferences-reloaded.png"),
    });
    for (const choice of choices) {
      await navigate(choice.section);
      await choose(choice, originalEffective[choice.key]);
    }
    await back();
  });

  reloads.push(await reloadRendererDocument(page, options));
  await segment("restored-search", async () => {
    await verify();
    await openSettings(page, options);
    for (const choice of choices) {
      const search = page.getByTestId("settings-sidebar-search");
      await search.fill(messages[choice.search]);
      await page
        .getByRole("option")
        .filter({ hasText: messages[choice.search] })
        .first()
        .click();
      await waitForPageCondition(
        page,
        options,
        ({ id }) => {
          const target = document.querySelector(
            `[data-settings-search-target="${id}"]`,
          );
          return (
            target?.dataset.settingsSearchActive === "true" &&
            document.activeElement === target
          );
        },
        `browser preference search focus ${choice.id}`,
        { id: choice.id },
      );
      await assertVisible(choice);
    }
    await verify();
    await page.screenshot({
      path: path.join(evidenceDir, "browser-preferences-restored.png"),
    });
    await back();
  });
  assert.deepEqual(
    segments.map((segment) => segment.desktopWrites),
    [3, 3, 0],
  );
  return {
    changedAndReloaded: true,
    originalEffectiveValuesRestored: true,
    selectedValueDoesNotWrite: true,
    independentWebAndLocal: true,
    searchTargets: choices.map((choice) => choice.id),
    readbacks,
    segments,
    reloads,
    limitations:
      "macOS isolated configuration and renderer reload only; selecting an unconfigured default makes it explicit. No App Server/process cold restart, failure injection, OS browser launch, prompt gates or complete Settings claim.",
  };
}
