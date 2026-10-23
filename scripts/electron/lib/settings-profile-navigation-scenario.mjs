import assert from "node:assert/strict";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  openSettings,
  waitForPageCondition,
} from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";
import { seedProfileFixture } from "./settings-profile-fixture-driver.mjs";

export async function runSettingsProfileNavigationScenario({
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
  await seedProfileFixture(page);
  const initial = await read();
  const profile = page.getByTestId("settings-profile-page");
  const nickname = page.locator("#profile-field-displayName");
  const bio = page.locator("#profile-field-bio");
  const dialog = page.getByTestId("settings-unsaved-changes-dialog");
  const keep = dialog.getByRole("button", { name: "继续编辑", exact: true });
  const discard = dialog.getByRole("button", { name: "放弃更改", exact: true });
  const about = () =>
    waitForPageCondition(
      page,
      options,
      () =>
        document
          .querySelector('[data-testid="settings-sidebar-tab-about"]')
          ?.getAttribute("aria-current") === "page" &&
        !document.querySelector('[data-testid="settings-page-loading"]'),
      "About committed",
    );
  let localEntryVisits = 0;
  const open = async () => {
    await page.evaluate(() => {
      window.__LIME_OEM_CLOUD__ = { enabled: false };
    });
    await openSettings(page, options);
    await page.getByTestId("settings-sidebar-tab-profile").click();
    await profile.waitFor({ state: "visible" });
    await page
      .getByRole("button", { name: "编辑显示名称", exact: true })
      .waitFor({ state: "visible" });
    assert.equal(
      await page
        .getByRole("heading", { name: "个人资料", exact: true })
        .count(),
      1,
      "local Profile has one heading",
    );
    assert.equal(
      await page
        .getByRole("heading", { name: "账户资料", exact: true })
        .count(),
      0,
      "unavailable account card is not mounted in local Profile",
    );
    assert.equal(
      await page.getByTestId("oem-cloud-session-panel").count(),
      0,
      "local Profile does not render a managed account session",
    );
    assert.equal(
      await page.getByTestId("oem-cloud-login-panel").count(),
      0,
      "local Profile does not render account sign-in",
    );
    assert.equal(await page.getByTestId("oem-cloud-google-login").count(), 0);
    localEntryVisits += 1;
  };
  const observations = [];
  for (const kind of ["displayName", "bio"]) {
    for (const target of ["section", "back"]) {
      stage(`unsaved-profile-${kind}-${target}`);
      await open();
      await page
        .getByRole("button", {
          name: kind === "displayName" ? "编辑显示名称" : "编辑个人简介",
          exact: true,
        })
        .click();
      const field = kind === "displayName" ? nickname : bio;
      await field.fill("fixture profile draft");
      const trigger = {
        section: page.getByTestId("settings-sidebar-tab-about"),
        back: page.getByTestId("settings-back-button"),
      }[target];
      await trigger.click();
      await dialog.waitFor({ state: "visible" });
      assert.equal(
        await keep.evaluate((node) => document.activeElement === node),
        true,
      );
      await keep.click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(await field.inputValue(), "fixture profile draft");
      assert.equal(
        await page
          .getByTestId("settings-sidebar-tab-profile")
          .getAttribute("aria-current"),
        "page",
      );
      await trigger.click();
      await dialog.waitFor({ state: "visible" });
      if (kind === "bio" && target === "section")
        await page.screenshot({
          path: path.join(evidenceDir, "profile-unsaved-dialog.png"),
        });
      await discard.click();
      await dialog.waitFor({ state: "detached" });
      if (target === "section") {
        await about();
        await page.getByTestId("settings-back-button").click();
      }
      await waitForSession();
      assert.equal(
        isDeepStrictEqual(await read(), initial),
        true,
        "discard does not write config",
      );
      observations.push({
        kind,
        target,
        keptInput: true,
        discardedWithoutSave: true,
        sameSessionReturn: true,
      });
    }
  }
  stage("profile-save-and-reopen");
  await open();
  const submittedNickname = "fixture profile saved nickname";
  const submittedBio = "fixture profile saved bio";
  await page.getByRole("button", { name: "编辑显示名称", exact: true }).click();
  await nickname.fill(submittedNickname);
  await page.getByRole("button", { name: "保存显示名称", exact: true }).click();
  await nickname.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "编辑个人简介", exact: true }).click();
  await bio.fill(submittedBio);
  await page.getByRole("button", { name: "保存个人简介", exact: true }).click();
  await bio.waitFor({ state: "detached" });
  const expected = structuredClone(initial);
  expected.user_profile = {
    ...expected.user_profile,
    nickname: submittedNickname,
    bio: submittedBio,
  };
  assert.equal(
    isDeepStrictEqual(await read(), expected),
    true,
    "only submitted profile fields change",
  );
  await page.getByTestId("settings-sidebar-tab-about").click();
  await about();
  assert.equal(await dialog.count(), 0);
  await page.getByTestId("settings-sidebar-tab-profile").click();
  await profile.waitFor({ state: "visible" });
  await page.getByRole("button", { name: "编辑显示名称", exact: true }).click();
  assert.equal(await nickname.inputValue(), submittedNickname);
  await page
    .getByRole("button", { name: "取消编辑显示名称", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑个人简介", exact: true }).click();
  assert.equal(await bio.inputValue(), submittedBio);
  await page
    .getByRole("button", { name: "取消编辑个人简介", exact: true })
    .click();
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
    await page.getByTestId("settings-sidebar-tab-profile").click();
    await profile.waitFor({ state: "visible" });
  };
  const themes = [];
  for (const [mode, system] of [
    ["light", null],
    ["dark", null],
    ["system", "light"],
    ["system", "dark"],
  ]) {
    stage(`profile-theme-${mode}-${system || "explicit"}`);
    await page.emulateMedia({ colorScheme: system });
    await chooseTheme(mode);
    await page
      .getByRole("button", { name: "编辑显示名称", exact: true })
      .click();
    const observation = await profile.evaluate((node) => ({
      effective: document.documentElement.classList.contains("dark")
        ? "dark"
        : "light",
      foreground: getComputedStyle(node).color,
      background: getComputedStyle(node.querySelector("input")).backgroundColor,
      width: node.getBoundingClientRect().width,
      nestedScrollOwners: [...node.querySelectorAll("*")].filter((child) =>
        /auto|scroll/.test(getComputedStyle(child).overflowY),
      ).length,
      viewportOverflow:
        document.documentElement.scrollWidth > window.innerWidth,
      controlsOverflow: [...node.querySelectorAll("input, textarea")].some(
        (input) =>
          input.getBoundingClientRect().right >
          node.getBoundingClientRect().right + 1,
      ),
    }));
    assert.equal(observation.effective, system || mode);
    assert.equal(observation.viewportOverflow, false);
    assert.equal(observation.controlsOverflow, false);
    assert.ok(observation.width <= 733);
    assert.equal(observation.nestedScrollOwners, 0);
    assert.equal(await nickname.getAttribute("maxlength"), "64");
    await nickname.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(
        evidenceDir,
        `profile-theme-${mode}${system ? "-" + system : ""}.png`,
      ),
    });
    await page
      .getByRole("button", { name: "取消编辑显示名称", exact: true })
      .click();
    themes.push({ mode, ...observation });
  }
  await page.emulateMedia({ colorScheme: null });
  await chooseTheme(originalTheme);
  stage("profile-restore");
  await page.getByRole("button", { name: "编辑个人简介", exact: true }).click();
  assert.equal(await bio.getAttribute("maxlength"), "140");
  await bio.fill(initial.user_profile.bio);
  await page.getByRole("button", { name: "保存个人简介", exact: true }).click();
  await bio.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "编辑显示名称", exact: true }).click();
  await nickname.fill(initial.user_profile?.nickname ?? "");
  await page.getByRole("button", { name: "保存显示名称", exact: true }).click();
  await nickname.waitFor({ state: "detached" });
  assert.equal(
    isDeepStrictEqual(await read(), initial),
    true,
    "original config restored exactly",
  );
  await page.getByTestId("settings-back-button").click();
  await waitForSession();
  return {
    localEntry: {
      checkedVisits: localEntryVisits,
      onlyLocalProfile: true,
      profileHeadingCount: 1,
      unavailableAccountHeadingCount: 0,
      managedAccountPanelCount: 0,
      accountLoginPanelCount: 0,
      googleLoginCount: 0,
      oemAuthentication: "component evidence only; no real sign-in",
    },
    isolatedProfileSeed:
      "public config/batchWrite; non-null nickname/bio baseline",
    observations,
    savedAndReopened: true,
    untouchedConfigurationPreserved: true,
    originalConfigRestored: true,
    themes,
    componentOnlyNavigation: {
      target: "new",
      reason:
        "Settings has no native New entry; canonical New navigation is component-tested.",
    },
    limitations:
      "Non-OEM test override; external backend. Current skin/1440x1000 and media-emulated system theme only. Remote Profile/eligibility and reference runtime, auth, live provider, Windows and packaged behavior remain unverified.",
  };
}
