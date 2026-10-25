import path from "node:path";
import { clickNativeMenuItem } from "./browser-runtime-gate-a.mjs";
import { assert, sleep } from "./claw-chat-current-fixture-utils.mjs";

/** Real settings UI -> preload/IPC -> persistent rules -> original native page. */
export async function runBrowserSiteSettingsControls({
  app,
  page,
  options,
  guiBeforeTurn,
  header,
  messages,
}) {
  const assertions = {};
  const check = (name, value) => {
    assertions[name] = Boolean(value);
    assert(value, name);
  };
  const waitFor = async (read, predicate, label) => {
    const deadline = Date.now() + Math.min(options.timeoutMs, 20000);
    let last;
    do {
      last = await read();
      if (predicate(last)) return last;
      await sleep(50);
    } while (Date.now() < deadline);
    throw new Error(`${label}: ${JSON.stringify(last)}`);
  };
  const native = () =>
    app.evaluate(async ({ webContents, session }, id) => {
      const wc = webContents.fromId(id);
      return {
        id: wc.id,
        url: wc.getURL(),
        muted: wc.isAudioMuted(),
        sameSession:
          wc.session === session.fromPartition("persist:embedded-browser"),
        // Query permission status only. Never read or modify the user's clipboard.
        clipboard: await wc.executeJavaScript(
          "navigator.permissions.query({name:'clipboard-read'}).then(s=>s.state)",
        ),
      };
    }, guiBeforeTurn.webContentsId);
  const invoke = (command, args) =>
    page.evaluate(
      ({ command, args }) => window.electronAPI.invoke(command, args),
      { command, args },
    );
  const snapshot = () => invoke("browser_site_settings_list", {});
  const current = await native();
  const origin = new URL(current.url).origin;
  const control = (permission) =>
    page.locator(`#browser-site-default-${permission} select`);
  // Origin IDs contain URL punctuation, so locate site controls by their row ID.
  const siteControl = (permission) =>
    page.locator(
      `[id="browser-site-${encodeURIComponent(origin)}-${permission}"] select`,
    );
  const save = async (permission, setting, site = false) => {
    const select = site ? siteControl(permission) : control(permission);
    await select.selectOption(setting);
    await waitFor(
      snapshot,
      (value) =>
        site
          ? value.sites.find((entry) => entry.origin === origin)?.[
              permission
            ] === (setting === "default" ? null : setting)
          : value.defaults[permission] === setting,
      `saved ${permission}/${setting}`,
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="browser-site-settings-page"]')
          ?.getAttribute("aria-busy") === "false",
    );
  };
  await page.getByTestId("browser-workspace-options").click();
  await clickNativeMenuItem(app, "history");
  await header.waitFor({ state: "visible" });
  await header.locator("nav button").nth(1).click();
  await page.locator("#browser-site-settings button").click();
  await page
    .getByTestId("browser-site-settings-page")
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="browser-site-settings-page"]')
        ?.getAttribute("aria-busy") === "false",
  );
  await control("sound")
    .locator("xpath=self::select[not(@disabled)]")
    .waitFor({ state: "visible" });
  check(
    "site-settings-eight-native-setting-controls",
    (await page
      .locator('[aria-labelledby="browser-site-settings-defaults"] select')
      .count()) === 8,
  );
  check(
    "sound-has-no-ineffective-ask-choice",
    JSON.stringify(
      await control("sound")
        .locator("option")
        .evaluateAll((options) => options.map((option) => option.value)),
    ) === JSON.stringify(["allow", "block"]),
  );
  await save("sound", "block");
  check(
    "sound-default-block-mutes-original-native-page",
    (await native()).muted,
  );
  await save("sound", "allow");
  check(
    "sound-default-allow-unmutes-original-native-page",
    !(await native()).muted,
  );
  check(
    "protected-content-unavailable-control-disabled",
    await control("protectedContent").isDisabled(),
  );
  for (const permission of ["automaticDownloads"]) {
    await save(permission, "block");
    check(
      `${permission}-default-rule-persists-through-current-ipc`,
      (await snapshot()).defaults[permission] === "block",
    );
    await save(permission, "ask");
  }
  await invoke("browser_tab_set_audio_muted", {
    tabId: guiBeforeTurn.tabId,
    muted: true,
  });
  await save("sound", "block");
  await save("sound", "allow");
  check("sound-policy-preserves-manual-tab-mute", (await native()).muted);
  await invoke("browser_tab_set_audio_muted", {
    tabId: guiBeforeTurn.tabId,
    muted: false,
  });
  check("manual-unmute-respects-current-sound-rule", !(await native()).muted);
  await save("clipboard", "allow");
  check(
    "clipboard-default-allow-reaches-native-permission-check",
    (await native()).clipboard === "granted",
  );
  await save("clipboard", "block");
  check(
    "clipboard-default-block-revokes-native-permission-check",
    (await native()).clipboard !== "granted",
  );
  await page.locator('input[type="url"]').fill(origin);
  await page
    .getByTestId("browser-site-settings-page")
    .locator('form button[type="submit"]')
    .click();
  await siteControl("sound").waitFor({ state: "visible" });
  await save("sound", "block");
  await app.evaluate(async ({ webContents }, id) => {
    const wc = webContents.fromId(id);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Native sound reload timed out")),
        10000,
      );
      wc.once("did-finish-load", () => {
        clearTimeout(timeout);
        resolve();
      });
      wc.reload();
    });
  }, guiBeforeTurn.webContentsId);
  check("sound-block-survives-real-native-reload", (await native()).muted);
  await save("sound", "allow", true);
  check("site-sound-allow-overrides-blocked-default", !(await native()).muted);
  await save("clipboard", "allow", true);
  check(
    "site-clipboard-allow-overrides-blocked-default",
    (await native()).clipboard === "granted",
  );
  const screenshot = path.join(
    path.dirname(options.output),
    `${options.locale}-clipboard-sound-settings.png`,
  );
  await page.screenshot({ path: screenshot });
  await save("sound", "default", true);
  check(
    "site-sound-inheritance-restores-blocked-default",
    (await native()).muted,
  );
  await save("clipboard", "default", true);
  check(
    "site-clipboard-inheritance-restores-blocked-default",
    (await native()).clipboard !== "granted",
  );
  const persisted = await snapshot();
  check(
    "site-settings-current-snapshot-has-eight-independent-keys",
    Object.keys(persisted.defaults).length === 8 &&
      persisted.sites[0].sound === null &&
      persisted.sites[0].clipboard === null,
  );
  // Return the isolated profile to its original defaults through the same UI.
  await page
    .getByRole("button", {
      name: messages["browserSiteSettings.remove"],
      exact: true,
    })
    .click();
  await waitFor(snapshot, (value) => value.sites.length === 0, "removed site");
  await save("sound", "allow");
  await save("clipboard", "ask");
  await header.locator("nav button").nth(1).click();
  await page.locator("#browser-site-settings button").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="browser-site-settings-page"]')
        ?.getAttribute("aria-busy") === "false",
  );
  await control("sound")
    .locator("xpath=self::select[not(@disabled)]")
    .waitFor({ state: "visible" });
  check(
    "site-settings-reopen-reads-persisted-values",
    (await control("sound").inputValue()) === "allow" &&
      (await control("clipboard").inputValue()) === "ask",
  );
  const final = await native();
  check(
    "site-settings-keeps-original-native-session-and-page",
    final.id === current.id && final.url === current.url && final.sameSession,
  );
  await page.getByTestId("settings-back-button").click();
  await page
    .getByTestId("browser-workspace-options")
    .waitFor({ state: "visible" });
  return {
    assertions,
    screenshots: [screenshot],
    claimBoundary:
      "Real settings/preload/IPC/Store and native Session permission/audio enforcement. Clipboard permission status only; no clipboard content read or write, no audio emitted, no Agent turn or packaged-platform claim.",
  };
}
