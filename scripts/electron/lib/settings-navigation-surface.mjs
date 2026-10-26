import assert from "node:assert/strict";
import { waitForPageCondition } from "../mcp-config-fixture-smoke.mjs";
import { invokeAppServerFromPage } from "../../lib/chat-fixture/rpc.mjs";
import { GREETING_SUMMARY_TEXT } from "../../lib/chat-fixture/constants.mjs";

/** 工作区由同一canonical线程核验；不恢复已删除的页头目录副本。 */
export async function readSettingsNavigationSurface(page, options, sessionId) {
  const visible = await waitForPageCondition(
    page,
    options,
    ({ sessionId: expected, answerText }) => {
      const editors = [
        ...document.querySelectorAll(
          '[data-testid="composer-editor"][role="textbox"]',
        ),
      ].filter(
        (node) =>
          node instanceof HTMLElement && node.getClientRects().length > 0,
      );
      const editor = editors.length === 1 ? editors[0] : null;
      const actual = editor?.dataset.sessionId || null;
      if (
        !editor ||
        actual !== expected ||
        editor.getAttribute("contenteditable") !== "true"
      )
        return null;
      const answerVisible = document.body.innerText.includes(answerText);
      const home = Boolean(
        document.querySelector('[data-testid="home-composer-page"]'),
      );
      if (expected ? !answerVisible : !home) return null;
      return {
        electron: window.__LIME_ELECTRON__ === true,
        preload:
          typeof window.electronAPI?.invoke === "function" &&
          window.electronAPI.devBridgeFallback === false,
        sessionId: actual,
        workspaceRoot:
          document
            .querySelector(
              '[data-testid="home-composer-page"] [data-testid="composer-utility-bar"]',
            )
            ?.getAttribute("data-workspace-root") || null,
        home,
        settings: Boolean(
          document.querySelector('[data-testid="settings-navigation"]'),
        ),
        answerVisible,
        restore: JSON.parse(
          sessionStorage.getItem("lime.appNavigation.restore.v1") || "null",
        ),
      };
    },
    `expected visible editable session ${sessionId}`,
    { sessionId, answerText: GREETING_SUMMARY_TEXT },
  );
  if (!sessionId)
    return { ...visible, workspaceIdentitySource: "home composer" };
  const list = await invokeAppServerFromPage(page, "thread/list", {
    archived: false,
    limit: 100,
  });
  const thread = list.result?.data.find(
    (entry) => entry.sessionId === sessionId,
  );
  assert.ok(thread, "visible editor belongs to a canonical Thread");
  const read = await invokeAppServerFromPage(page, "thread/read", {
    threadId: thread.id,
    includeTurns: true,
  });
  assert.equal(read.result?.thread?.id, thread.id);
  const workspaceRoot = read.result.thread.cwd;
  assert.equal(
    typeof workspaceRoot === "string" && workspaceRoot.length > 0,
    true,
  );
  return {
    ...visible,
    threadId: thread.id,
    workspaceRoot,
    workspaceIdentitySource: "thread/read cwd for visible editor session",
  };
}
