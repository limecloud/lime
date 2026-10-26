import { composerEditorSelector } from "../composer-editor-dom.mjs";
import { assert } from "./utils.mjs";
import { withComposerMarksDom } from "./composer-marks.mjs";

// Reconstruct only the rendered document. Paste source text remains private;
// its initial wire expansion and Controller recovery tests are separate proof.
function readHistorySnapshotDom({ sessionId }) {
  const editors = findVisibleComposerEditorsDom(sessionId);
  const editor = editors.length === 1 ? editors[0] : null;
  const container = editor?.closest('[data-testid="inputbar-core-container"]');
  const readNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE)
      return { type: "text", text: node.nodeValue };
    if (!(node instanceof HTMLElement)) return null;
    if (node.getAttribute("data-composer-code-block-toolbar") === "true")
      return null;
    if (node.matches('div[data-composer-code-block="true"]')) {
      const code = node.querySelector(":scope > pre > code.hljs");
      const languages = Array.from(code?.classList ?? []).filter((name) =>
        name.startsWith("language-"),
      );
      return {
        type: "code_block",
        language:
          languages.length === 1
            ? languages[0].slice("language-".length)
            : null,
        content: [{ type: "text", text: code?.textContent ?? null }],
      };
    }
    if (node.matches("br.ProseMirror-trailingBreak")) return null;
    if (node.tagName === "BR") return { type: "hard_break" };
    const kind = node.getAttribute("data-composer-token");
    if (kind) {
      return {
        type: kind,
        id: node.getAttribute("data-composer-id"),
        name: node.getAttribute("data-composer-name"),
        path: node.getAttribute("data-composer-path"),
        label: ["file", "skill", "plugin"].includes(kind)
          ? node.getAttribute("data-composer-label")
          : node.textContent,
        displayName: node.getAttribute("data-composer-display-name"),
        renderedText: node.textContent,
        editable: node.getAttribute("contenteditable"),
      };
    }
    return {
      type: node.tagName.toLowerCase(),
      content: Array.from(node.childNodes).map(readNode).filter(Boolean),
    };
  };
  const documentProjection = editor
    ? Array.from(editor.childNodes).map(readNode).filter(Boolean)
    : null;
  const tokens = editor
    ? Array.from(editor.querySelectorAll("[data-composer-token]")).map(readNode)
    : [];
  const images = Array.from(container?.querySelectorAll("img") ?? [])
    .filter((node) => node.getAttribute("src")?.startsWith("data:image/"))
    .map((node) => ({
      src: node.getAttribute("src"),
      decoded: node.complete && node.naturalWidth > 0 && node.naturalHeight > 0,
    }));
  const paths = Array.from(
    container?.querySelectorAll(
      '[data-testid="inputbar-path-reference-chip"]',
    ) ?? [],
  ).map((node) => ({
    id: node.getAttribute("data-reference-id"),
    path: node.getAttribute("data-reference-path"),
    isDir: node.getAttribute("data-reference-is-dir"),
    name: node.getAttribute("title"),
  }));
  return {
    electron: window.__LIME_ELECTRON__ === true,
    preload: typeof window.electronAPI?.invoke === "function",
    editorCount: editors.length,
    sessionId: editor?.dataset.sessionId ?? null,
    disabled:
      !editor ||
      editor.getAttribute("aria-disabled") === "true" ||
      editor.getAttribute("contenteditable") !== "true",
    text: editor ? readComposerEditorTextDom(editor) : null,
    documentProjection,
    marks: editor ? readComposerMarksDom(editor) : null,
    tokens,
    images,
    paths,
    traceRaw: localStorage.getItem("lime_invoke_trace_buffer_v1"),
  };
}

export async function readComposerHistorySnapshot(page, sessionId) {
  return page.evaluate(withComposerMarksDom(readHistorySnapshotDom), {
    sessionId,
  });
}

export async function prepareHistoryPaste(page, sessionId, text) {
  const editor = page.locator(`${composerEditorSelector(sessionId)}:visible`);
  await editor.focus();
  await editor.press("ControlOrMeta+End");
  await page.keyboard.insertText(" ");
  await editor.evaluate((node, text) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", text);
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      }),
    );
  }, text);
  const snapshot = await readComposerHistorySnapshot(page, sessionId);
  const pastes = snapshot.tokens.filter((token) => token.type === "paste");
  assert(
    isLiveSnapshot(snapshot, sessionId) &&
      pastes.length === 1 &&
      pastes[0].id &&
      pastes[0].editable === "false",
    "large paste 未通过真实 EditorView paste 入口形成唯一 atom",
  );
  return pastes[0];
}

function isLiveSnapshot(snapshot, sessionId) {
  return (
    snapshot?.electron === true &&
    snapshot.preload === true &&
    snapshot.editorCount === 1 &&
    snapshot.sessionId === sessionId &&
    snapshot.disabled === false
  );
}
