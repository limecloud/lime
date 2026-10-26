import assert from "node:assert/strict";
import { openSettings } from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";
export async function runSettingsNoteNavigationScenario({
  page,
  options,
  stage,
  waitForSession,
}) {
  stage("instructions-save-and-reopen");
  const read = async () =>
    (await invokeAppServerFromPage(page, "instructions/read", {})).result;
  const original = await read();
  await openSettings(page, options);
  await page.getByTestId("settings-sidebar-tab-memory").click();
  await page.getByTestId("settings-instructions-open").click();
  const input = page.locator(
    '[data-testid="settings-instructions-editor"] textarea',
  );
  await input.waitFor({ state: "visible" });
  await input.fill(`${original.contents}\nFixture instruction.`);
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+s" : "Control+s",
  );
  await page
    .getByRole("status")
    .filter({ hasText: "已保存" })
    .waitFor({ state: "visible" });
  const saved = await read();
  assert.match(saved.contents, /Fixture instruction/);
  await page.getByTestId("settings-instructions-back").click();
  await page.getByTestId("settings-instructions-open").click();
  assert.equal(await input.inputValue(), saved.contents);
  const restored = await invokeAppServerFromPage(page, "instructions/write", {
    contents: original.contents,
    expectedRevision: saved.revision,
  });
  assert.equal(restored.result.contents, original.contents);
  await page.getByTestId("settings-instructions-back").click();
  await page.getByTestId("settings-back-button").click();
  await waitForSession();
  return {
    savedAndReopened: true,
    originalFileRestored: true,
    owner: "instructions/read+write",
  };
}
