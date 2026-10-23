import assert from "node:assert/strict";
import path from "node:path";
import { openSettings } from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../agent-runtime/claw-chat-current-fixture-rpc.mjs";

export async function runSettingsUnsavedNavigationScenario({
  page,
  options,
  evidenceDir,
  stage,
  waitForSession,
}) {
  const read = async () =>
    (await invokeAppServerFromPage(page, "instructions/read", {})).result;
  const original = await read();
  const input = page.locator(
    '[data-testid="settings-instructions-editor"] textarea',
  );
  const dialog = page.getByTestId("settings-unsaved-changes-dialog");
  const keep = dialog.getByRole("button", { name: "继续编辑", exact: true });
  const discard = dialog.getByRole("button", { name: "放弃更改", exact: true });
  const observations = [];
  for (const target of ["section", "back"]) {
    stage(`unsaved-instructions-${target}`);
    await openSettings(page, options);
    await page.getByTestId("settings-sidebar-tab-memory").click();
    await page.getByTestId("settings-instructions-open").click();
    await input.waitFor({ state: "visible" });
    assert.equal(await input.inputValue(), original.contents);
    await input.fill("unsaved instruction fixture");
    const trigger =
      target === "section"
        ? page.getByTestId("settings-sidebar-tab-about")
        : page.getByTestId("settings-back-button");
    await trigger.click();
    await dialog.waitFor({ state: "visible" });
    await keep.focus();
    assert.equal(
      await keep.evaluate((node) => document.activeElement === node),
      true,
    );
    if (target === "section")
      await page.screenshot({
        path: path.join(evidenceDir, "instructions-unsaved-dialog.png"),
      });
    if (target === "back") await page.keyboard.press("Escape");
    else await keep.click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(await input.inputValue(), "unsaved instruction fixture");
    assert.equal((await read()).contents, original.contents);
    await trigger.click();
    await discard.click();
    await dialog.waitFor({ state: "detached" });
    if (target === "section")
      await page.getByTestId("settings-back-button").click();
    await waitForSession();
    assert.equal((await read()).contents, original.contents);
    observations.push({
      target,
      keptInput: true,
      discardedWithoutSave: true,
      sameSessionReturn: true,
    });
  }
  return {
    observations,
    instructionDraftProtected: true,
    originalFilePreserved: true,
    limitations:
      "Save/conflict/pending completion are covered by personalization fixtures and component tests.",
  };
}
