import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";
import {
  composerEditorSelector,
  withComposerEditorDom,
} from "../composer-editor-dom.mjs";
import { appServerCallFromPage } from "../../electron/mcp-config-fixture-smoke.mjs";
import {
  isObservedPreloadAppServerResponse,
  parseJsonRpcRequestsFromInvokeTrace,
} from "../../electron/lib/mcp-config-fixture-evidence.mjs";
import { assert } from "./utils.mjs";
import { verifyComposerMarksCodePicker } from "./composer-code-picker.mjs";

const INPUT_METHODS = new Set([
  "turn/start",
  "turn/steer",
  "thread/queue/add",
  "thread/queue/update",
  "thread/queue/start",
]);

const LINK = {
  label: "中😀",
  href: "https://example.invalid/marks",
  title: "标题",
  role: "link",
  disabled: false,
  isAutolink: false,
  isGeneratedAutolink: false,
};

const CODE = "  const value = '中😀';\n````";

const TAIL = "尾中😀";

function expectedMarks(body) {
  return {
    links: [{ ...LINK }],
    codeBlocks: [
      {
        language: "typescript",
        body,
        validStructure: true,
        hardBreakCount: 0,
        keywordTokens: ["const"],
      },
    ],
    blockTags: ["P", "P", "DIV", "P"],
  };
}

// Literal fixture expectations never consume DOM, wire, canonical content or
// the product serializer. Four body backticks require the fixed five-tick fence.
export function composerMarksFixture({ prompt, skillIdentity, pasteText }) {
  assert(typeof prompt === "string" && prompt.length > 0, "marks prompt 缺失");
  assert(
    /^[a-zA-Z0-9_-]+$/.test(skillIdentity?.name ?? "") &&
      typeof skillIdentity?.key === "string" &&
      skillIdentity.key.length > 0 &&
      typeof skillIdentity.path === "string" &&
      skillIdentity.path.length > 0,
    "marks Skill identity 缺失",
  );
  assert(
    typeof pasteText === "string" && pasteText.length > 1_000,
    "marks large paste 缺失",
  );
  const body = `${CODE}\n\n`;
  const pasteLabel = `[Pasted text 1: ${pasteText.length} characters]`;
  const skillLabel = `$${skillIdentity.name}`;
  const skillPath = skillIdentity.path
    .replaceAll("\\", "\\\\")
    .replaceAll(")", "\\)");
  const skillLink = `[${skillLabel}](${skillPath})`;
  const displayPrefix = `${prompt}\n${LINK.label}\n${body}\n${TAIL} `;
  const markdownPrefix = `${prompt}\n[中😀](https://example.invalid/marks "标题")\n\`\`\`\`\`typescript\n${body}\n\`\`\`\`\`\n${TAIL} `;
  const pasteStart = Buffer.byteLength(markdownPrefix, "utf8");
  const pasteEnd = pasteStart + Buffer.byteLength(pasteText, "utf8");
  return {
    text: `${markdownPrefix}${pasteText} ${skillLink}`,
    displayText: `${displayPrefix}${pasteLabel} ${skillLabel}`,
    // The canonical submission keeps the Skill as a resource Markdown link,
    // while the rendered user bubble exposes the Skill display name. Collapse
    // geometry must use the visible tail when checking the rendered body.
    renderedTailText: skillIdentity.displayName || skillLabel,
    renderedTextParts: [
      prompt,
      LINK.label,
      body,
      `${TAIL} ${pasteText} ${skillIdentity.displayName || skillLabel}`,
    ],
    textElements: [
      {
        byteRange: { start: pasteStart, end: pasteEnd },
        placeholder: pasteLabel,
      },
    ],
    marks: expectedMarks(body),
  };
}

// Fixed whitelist of rendered semantics only. Literal-source/private PM attrs
// and hidden paste source are deliberately outside this DOM evidence boundary.
export function readComposerMarksDom(editor) {
  const flag = (node, name) =>
    node.hasAttribute(name) && node.getAttribute(name) !== "false";
  return {
    links: Array.from(editor.querySelectorAll("[text-link-href], a[href]")).map(
      (node) => ({
        label: node.textContent,
        href: node.getAttribute("text-link-href") ?? node.getAttribute("href"),
        title:
          node.getAttribute("text-link-title") ?? node.getAttribute("title"),
        role: node.getAttribute("role"),
        disabled: node.getAttribute("aria-disabled") === "true",
        isAutolink:
          flag(node, "data-breakable-url") ||
          flag(node, "data-rich-text-autolink"),
        isGeneratedAutolink: flag(node, "data-rich-text-generated-autolink"),
      }),
    ),
    codeBlocks: Array.from(
      editor.querySelectorAll('div[data-composer-code-block="true"]'),
    ).map((block) => {
      const toolbar = block.children[0];
      const pre = block.children[1];
      const code = pre?.querySelector(":scope > code");
      const languages = Array.from(code?.classList ?? []).filter((name) =>
        name.startsWith("language-"),
      );
      const validCodeNode = (node) =>
        node.nodeType === 3 ||
        (node instanceof HTMLElement &&
          (node.matches("br.ProseMirror-trailingBreak") ||
            (node.tagName === "SPAN" &&
              node.classList.length > 0 &&
              Array.from(node.classList).every((name) =>
                name.startsWith("hljs-"),
              ) &&
              Array.from(node.childNodes).every(validCodeNode))));
      return {
        language:
          languages.length === 1
            ? languages[0].slice("language-".length)
            : null,
        body: code?.textContent ?? null,
        validStructure:
          block.children.length === 2 &&
          toolbar?.tagName === "DIV" &&
          toolbar.getAttribute("data-composer-code-block-toolbar") === "true" &&
          toolbar.getAttribute("contenteditable") === "false" &&
          pre?.tagName === "PRE" &&
          pre.getAttribute("dir") === "ltr" &&
          pre.childNodes.length === 1 &&
          !!code &&
          code.classList.contains("hljs") &&
          !code.hasAttribute("data-language") &&
          Array.from(code.childNodes).every(validCodeNode),
        hardBreakCount: code
          ? code.querySelectorAll("br:not(.ProseMirror-trailingBreak)").length
          : null,
        keywordTokens: code
          ? Array.from(code.querySelectorAll("span.hljs-keyword")).map(
              (node) => node.textContent,
            )
          : [],
      };
    }),
    blockTags: Array.from(editor.children).map((node) => node.tagName),
  };
}

export function withComposerMarksDom(pageFunction) {
  return new Function(
    "arg",
    `${readComposerMarksDom.toString()}\nreturn (${withComposerEditorDom(pageFunction).toString()})(arg);`,
  );
}

export function readComposerMarksSnapshotDom({ sessionId }) {
  const editors = findVisibleComposerEditorsDom(sessionId);
  const editor = editors.length === 1 ? editors[0] : null;
  return {
    electron: window.__LIME_ELECTRON__ === true,
    preload: typeof window.electronAPI?.invoke === "function",
    editorCount: editors.length,
    sessionId: editor?.dataset.sessionId ?? null,
    disabled:
      !editor ||
      editor.getAttribute("contenteditable") !== "true" ||
      editor.getAttribute("aria-disabled") === "true",
    text: editor ? readComposerEditorTextDom(editor) : null,
    marks: editor ? readComposerMarksDom(editor) : null,
    traceRaw: localStorage.getItem("lime_invoke_trace_buffer_v1"),
  };
}

export async function readComposerMarksSnapshot(page, sessionId) {
  return page.evaluate(withComposerMarksDom(readComposerMarksSnapshotDom), {
    sessionId,
  });
}

export function composerMarksMatch(snapshot, expected, sessionId) {
  return (
    !!expected &&
    snapshot?.electron === true &&
    snapshot.preload === true &&
    snapshot.editorCount === 1 &&
    snapshot.sessionId === sessionId &&
    snapshot.disabled === false &&
    isDeepStrictEqual(snapshot.marks, expected)
  );
}

export function installComposerCodeKeyboardObserverDom(node) {
  const events = [];
  const handler = (event) => {
    if (event.key !== "Enter") return;
    const anchor = window.getSelection()?.anchorNode;
    const element = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
    events.push({
      key: event.key,
      shiftKey: event.shiftKey,
      trusted: event.isTrusted,
      focused: document.activeElement === node,
      sessionId: node.dataset.sessionId,
      defaultPrevented: event.defaultPrevented,
      insideCode:
        !!element?.closest(
          'div[data-composer-code-block="true"] > pre > code',
        ) && node.contains(anchor),
    });
  };
  // Observe after EditorView's handler, before a later ancestor could consume it.
  node.addEventListener("keydown", handler);
  window.__composerCodeKeyboardObserver = { node, handler, events };
}

export function takeComposerCodeKeyboardEventsDom() {
  const observer = window.__composerCodeKeyboardObserver;
  observer.node.removeEventListener("keydown", observer.handler);
  delete window.__composerCodeKeyboardObserver;
  return observer.events;
}

function observedEmptyRead(read, threadId) {
  return (
    isObservedPreloadAppServerResponse(read?.ipcObservation, "thread/read") &&
    read.ipcObservation.params?.threadId === threadId &&
    read.result?.thread?.id === threadId &&
    Array.isArray(read.result.thread.turns) &&
    read.result.thread.turns.length === 0
  );
}

export function summarizeComposerCodeBoundary({
  snapshots,
  beforeRead,
  afterRead,
  events,
  sessionId,
  threadId,
}) {
  const liveCodeObserved =
    Array.isArray(snapshots) &&
    snapshots.length === 3 &&
    snapshots.every((snapshot, index) =>
      composerMarksMatch(
        snapshot,
        expectedMarks(CODE + "\n".repeat(index)),
        sessionId,
      ),
    );
  const trustedKeysObserved =
    Array.isArray(events) &&
    events.length === 2 &&
    events.every(
      (event, index) =>
        event.key === "Enter" &&
        event.shiftKey === (index === 1) &&
        event.trusted === true &&
        event.focused === true &&
        event.defaultPrevented === true &&
        event.insideCode === true &&
        event.sessionId === sessionId,
    );
  let noInputRequest = false;
  try {
    noInputRequest =
      liveCodeObserved &&
      snapshots.every(
        (snapshot) =>
          Array.isArray(JSON.parse(snapshot.traceRaw)) &&
          parseJsonRpcRequestsFromInvokeTrace(snapshot.traceRaw).filter(
            (request) =>
              request.params.threadId === threadId &&
              INPUT_METHODS.has(request.method),
          ).length === 0,
      );
  } catch {
    // Missing trace evidence cannot establish a negative input claim.
  }
  const noCanonicalTurn =
    observedEmptyRead(beforeRead, threadId) &&
    observedEmptyRead(afterRead, threadId);
  const checks = {
    liveCodeObserved,
    trustedKeysObserved,
    noInputRequest,
    noCanonicalTurn,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    ...checks,
    threadId,
    sessionId,
    events,
    keyboardSource:
      "Electron/CDP locator.press; passive same-node keydown observation",
    selectionSource:
      "programmatic DOM Selection into actual code; no PM/Controller injection",
  };
}

export function placeComposerCodeCaretAtEndDom(node) {
  const code = node.querySelector(
    'div[data-composer-code-block="true"] > pre > code',
  );
  if (!code) throw new Error("code selection 缺少现代 NodeView contentDOM");
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let text = null;
  while (walker.nextNode()) text = walker.currentNode;
  if (!text) throw new Error("code selection 缺少实际 text leaf");
  node.focus();
  const range = document.createRange();
  range.setStart(text, text.nodeValue.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Synthetic clipboard transport into the real EditorView; no model or Controller injection. */
export async function pasteComposerMarksDraft({
  page,
  sessionId,
  prompt,
  body = CODE,
}) {
  const editor = page.locator(`${composerEditorSelector(sessionId)}:visible`);
  await editor.fill("");
  const pasteObservation = await editor.evaluate(
    (node, { prompt, body }) => {
      const data = new DataTransfer();
      const paragraph = document.createElement("p");
      paragraph.textContent = prompt;
      const code = document.createElement("pre");
      const content = document.createElement("code");
      content.className = "language-typescript";
      content.textContent = body;
      code.append(content);
      data.setData(
        "text/html",
        `${paragraph.outerHTML}<p><a href="https://example.invalid/marks" title="标题">中😀</a></p>${code.outerHTML}<p>尾中😀</p>`,
      );
      data.setData("text/plain", "PLAIN FALLBACK MUST NOT WIN");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      node.dispatchEvent(event);
      return {
        trusted: event.isTrusted,
        defaultPrevented: event.defaultPrevented,
        formats: Array.from(data.types),
        source:
          "synthetic DataTransfer/ClipboardEvent in real Electron; OS clipboard not covered",
      };
    },
    { prompt, body },
  );
  return pasteObservation;
}

export async function prepareComposerMarksDraft({
  page,
  options,
  sessionId,
  threadId,
  prompt,
}) {
  const beforeRead = await appServerCallFromPage(page, "thread/read", {
    threadId,
    includeTurns: true,
  });
  const editor = page.locator(`${composerEditorSelector(sessionId)}:visible`);
  const pasteObservation = await pasteComposerMarksDraft({
    page,
    sessionId,
    prompt,
  });
  const pickerBoundary = await verifyComposerMarksCodePicker({
    page,
    options,
    sessionId,
    threadId,
    body: CODE,
    expectedText: `${prompt}\n中😀\n${CODE}\n尾中😀`,
  });
  const initial = await readComposerMarksSnapshot(page, sessionId);
  const preparation = {
    ok:
      composerMarksMatch(initial, expectedMarks(CODE), sessionId) &&
      initial.text === `${prompt}\n中😀\n${CODE}\n尾中😀` &&
      pasteObservation.trusted === false &&
      pasteObservation.defaultPrevented === true &&
      isDeepStrictEqual(pasteObservation.formats, ["text/html", "text/plain"]),
    pasteObservation,
    initial,
  };
  assert(
    preparation.ok,
    `Composer HTML marks preparation 失败: ${JSON.stringify(preparation)}`,
  );
  await editor.evaluate(placeComposerCodeCaretAtEndDom);
  await page.waitForFunction(
    ({ selector }) => {
      const editor = document.querySelector(selector);
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const code = anchor?.parentElement?.closest(
        'div[data-composer-code-block="true"] > pre > code',
      );
      return (
        !!code &&
        editor?.contains(code) &&
        document.activeElement === editor &&
        selection.isCollapsed &&
        anchor.nodeType === 3 &&
        selection.anchorOffset === anchor.nodeValue.length
      );
    },
    { selector: composerEditorSelector(sessionId) },
    { timeout: Math.min(options.timeoutMs, 10_000) },
  );
  await editor.evaluate(installComposerCodeKeyboardObserverDom);
  const snapshots = [initial];
  let events;
  try {
    for (const [index, key] of ["Enter", "Shift+Enter"].entries()) {
      await editor.press(key);
      await page.waitForFunction(
        withComposerMarksDom(({ sessionId, body }) => {
          const editors = findVisibleComposerEditorsDom(sessionId);
          const code =
            editors.length === 1
              ? readComposerMarksDom(editors[0]).codeBlocks
              : [];
          return (
            code.length === 1 &&
            code[0].body === body &&
            code[0].validStructure &&
            code[0].hardBreakCount === 0
          );
        }),
        { sessionId, body: CODE + "\n".repeat(index + 1) },
        { timeout: Math.min(options.timeoutMs, 10_000) },
      );
      snapshots.push(await readComposerMarksSnapshot(page, sessionId));
    }
  } finally {
    events = await page.evaluate(takeComposerCodeKeyboardEventsDom);
  }
  const afterRead = await appServerCallFromPage(page, "thread/read", {
    threadId,
    includeTurns: true,
  });
  const codeBoundary = summarizeComposerCodeBoundary({
    snapshots,
    beforeRead,
    afterRead,
    events,
    sessionId,
    threadId,
  });
  assert(
    codeBoundary.ok,
    `Composer code Enter 编辑边界失败: ${JSON.stringify(codeBoundary)}`,
  );
  await editor.locator("p").last().click();
  await page.waitForFunction(
    ({ selector }) => {
      const editor = document.querySelector(selector);
      const anchor = window.getSelection()?.anchorNode;
      const tail = editor?.lastElementChild;
      return (
        tail?.tagName === "P" &&
        (anchor === tail || tail.contains(anchor)) &&
        document.activeElement === editor
      );
    },
    { selector: composerEditorSelector(sessionId) },
    { timeout: Math.min(options.timeoutMs, 10_000) },
  );
  return { preparation, pickerBoundary, codeBoundary };
}
