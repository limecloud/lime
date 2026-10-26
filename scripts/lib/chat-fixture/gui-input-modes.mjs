import { assert, sanitizeJson } from "./utils.mjs";

export async function selectComposerSkillFromGui(
  page,
  { editor, skillIdentity, timeoutMs },
) {
  await editor.focus();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText(` $${skillIdentity.name}`);
  const list = page.locator('[data-testid="composer-context-suggestions"]');
  await list.waitFor({ state: "visible", timeout: timeoutMs });
  const option = list.locator(
    `[data-suggestion-key=${JSON.stringify(`skill:${skillIdentity.key}`)}]`,
  );
  await option.waitFor({ state: "visible", timeout: timeoutMs });
  const target = await option.elementHandle();
  assert(target, "技能建议缺少真实 option");
  await target.evaluate((node) => {
    node.addEventListener(
      "pointerdown",
      (event) => {
        node.dataset.fixtureTrustedSkillPointer = String(event.isTrusted);
      },
      { once: true },
    );
  });
  await option.click();
  const selection = await target.evaluate((node) => ({
    key: node.dataset.suggestionKey,
    text: node.textContent,
    trustedPointer: node.dataset.fixtureTrustedSkillPointer === "true",
  }));
  await target.dispose();
  const editorFocused = await editor.evaluate(
    (node) => document.activeElement === node,
  );
  assert(
    selection.trustedPointer && editorFocused,
    "真实技能建议选择未恢复同一 editor 焦点",
  );
  return sanitizeJson({ ...selection, editorFocused });
}
