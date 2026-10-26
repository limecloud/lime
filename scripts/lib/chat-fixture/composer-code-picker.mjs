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

const INPUT_METHODS = new Set([
  "turn/start",
  "turn/steer",
  "thread/queue/add",
  "thread/queue/update",
  "thread/queue/start",
]);

const CHOICES = ["auto", "plaintext", "typescript"];

// Check expresses the current language choice; aria-selected is cmdk keyboard focus.
export function readComposerCodePickerDom({ sessionId }) {
  const editors = findVisibleComposerEditorsDom(sessionId);
  const editor = editors.length === 1 ? editors[0] : null;
  const blocks = editor?.querySelectorAll(
    'div[data-composer-code-block="true"]',
  );
  const block = blocks?.length === 1 ? blocks[0] : null;
  const trigger = block?.querySelector(
    '[data-composer-code-block-toolbar="true"] .composer-code-language-trigger',
  );
  const code = block?.querySelector(":scope > pre > code.hljs");
  const menus = Array.from(
    document.querySelectorAll(".composer-code-language-menu"),
  ).filter(
    (node) =>
      node.isConnected &&
      node.getClientRects().length > 0 &&
      window.getComputedStyle(node).visibility !== "hidden" &&
      window.getComputedStyle(node).display !== "none",
  );
  const menu = menus.length === 1 ? menus[0] : null;
  const searches = menu?.querySelectorAll('input[role="combobox"]') ?? [];
  const search = searches.length === 1 ? searches[0] : null;
  const languages = Array.from(code?.classList ?? []).filter((value) =>
    value.startsWith("language-"),
  );
  return {
    electron: window.__LIME_ELECTRON__ === true,
    preload: typeof window.electronAPI?.invoke === "function",
    editorCount: editors.length,
    sessionId: editor?.dataset.sessionId ?? null,
    disabled:
      !editor ||
      editor.getAttribute("contenteditable") !== "true" ||
      editor.getAttribute("aria-disabled") === "true",
    editorFocused: document.activeElement === editor,
    text: editor ? readComposerEditorTextDom(editor) : null,
    blockCount: blocks?.length ?? 0,
    language:
      languages.length === 1 ? languages[0].slice("language-".length) : null,
    body: code?.textContent ?? null,
    keywordTokens: code
      ? Array.from(code.querySelectorAll("span.hljs-keyword")).map(
          (node) => node.textContent,
        )
      : [],
    triggerLabel: trigger?.textContent?.trim() ?? null,
    triggerAriaLabel: trigger?.getAttribute("aria-label") ?? null,
    expanded: trigger?.getAttribute("aria-expanded") === "true",
    menuCount: menus.length,
    menuOwned:
      !!menu && !!menu.id && trigger?.getAttribute("aria-controls") === menu.id,
    searchCount: searches.length,
    searchQuery: search?.value ?? null,
    searchFocused: !!search && document.activeElement === search,
    choices: menu
      ? Array.from(menu.querySelectorAll("[data-code-language]")).map(
          (item) => ({
            value: item.getAttribute("data-code-language"),
            label: item.textContent?.trim() ?? null,
            checked: !!item.querySelector("svg:not(.invisible)"),
            highlighted: item.getAttribute("aria-selected") === "true",
          }),
        )
      : [],
    traceRaw: localStorage.getItem("lime_invoke_trace_buffer_v1"),
  };
}

export function withComposerCodePickerDom(callback) {
  return withComposerEditorDom(
    new Function(
      "arg",
      `${readComposerCodePickerDom.toString()}\nreturn (${callback.toString()})(arg);`,
    ),
  );
}

export function installComposerCodePickerObserverDom(editor) {
  const events = [];
  const handler = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = editor.querySelector(".composer-code-language-trigger");
    if (
      event.type === "click" &&
      target?.closest(".composer-code-language-trigger") === trigger
    ) {
      events.push({
        kind: "open",
        trusted: event.isTrusted,
        sessionId: editor.dataset.sessionId,
      });
      return;
    }
    const menu = target?.closest(".composer-code-language-menu");
    if (!menu?.id || menu.id !== trigger?.getAttribute("aria-controls")) return;
    if (event.type === "click") {
      const choice = target.closest("[data-code-language]");
      if (choice)
        events.push({
          kind: "select",
          language: choice.getAttribute("data-code-language"),
          trusted: event.isTrusted,
          sessionId: editor.dataset.sessionId,
        });
    } else if (
      event.type === "input" &&
      target.matches('input[role="combobox"]')
    ) {
      events.push({
        kind: "search",
        query: target.value,
        trusted: event.isTrusted,
        sessionId: editor.dataset.sessionId,
      });
    } else if (event.key === "Escape") {
      events.push({
        kind: "close",
        key: "Escape",
        trusted: event.isTrusted,
        sessionId: editor.dataset.sessionId,
      });
    }
  };
  for (const type of ["click", "keydown", "input"])
    document.addEventListener(type, handler, true);
  window.__composerCodePickerObserver = { handler, events };
}

export function takeComposerCodePickerEventsDom() {
  const observer = window.__composerCodePickerObserver;
  for (const type of ["click", "keydown", "input"])
    document.removeEventListener(type, observer.handler, true);
  delete window.__composerCodePickerObserver;
  return observer.events;
}

export function summarizeComposerCodePickerBoundary({
  stages,
  events,
  beforeRead,
  afterRead,
  sessionId,
  threadId,
  body,
  expectedText,
}) {
  const live = (snapshot) =>
    snapshot?.electron === true &&
    snapshot.preload === true &&
    snapshot.editorCount === 1 &&
    snapshot.sessionId === sessionId &&
    snapshot.disabled === false &&
    snapshot.blockCount === 1 &&
    snapshot.body === body &&
    snapshot.text === expectedText;
  const liveStages =
    Array.isArray(stages) &&
    stages.length === 3 &&
    stages.every(
      (stage, index) =>
        stage.selection === CHOICES[index] &&
        [stage.searched, stage.selected, stage.inspected, stage.closed].every(
          live,
        ),
    );
  const searchObserved =
    liveStages &&
    stages.every(
      (stage) =>
        stage.searched.menuCount === 1 &&
        stage.searched.menuOwned === true &&
        stage.searched.expanded === true &&
        stage.searched.searchCount === 1 &&
        stage.searched.searchFocused === true &&
        stage.searched.searchQuery === stage.selection &&
        isDeepStrictEqual(
          stage.searched.choices.map((item) => item.value),
          [stage.selection],
        ) &&
        stage.inspected.searchQuery === "",
    );
  const choicesObserved =
    liveStages &&
    stages.every((stage) => {
      const inspected = stage.inspected;
      const checked = inspected.choices.filter((item) => item.checked);
      return (
        inspected.menuCount === 1 &&
        inspected.menuOwned === true &&
        inspected.expanded === true &&
        checked.length === 1 &&
        checked[0].value === stage.selection &&
        !!inspected.triggerAriaLabel &&
        (stage.selection === "auto"
          ? /^(自动|自動|Auto|자동)/i.test(inspected.triggerLabel) &&
            inspected.triggerLabel.includes("JavaScript")
          : inspected.triggerLabel === checked[0].label)
      );
    });
  const languageAndHighlight =
    liveStages &&
    stages.every((stage) =>
      [stage.selected, stage.inspected, stage.closed].every(
        (snapshot) =>
          snapshot.language ===
            (stage.selection === "auto" ? "javascript" : stage.selection) &&
          isDeepStrictEqual(
            snapshot.keywordTokens,
            stage.selection === "plaintext" ? [] : ["const"],
          ),
      ),
    );
  const closeFocusObserved =
    liveStages &&
    stages.every((stage) =>
      [stage.selected, stage.closed].every(
        (snapshot) =>
          snapshot.menuCount === 0 &&
          snapshot.expanded === false &&
          snapshot.editorFocused === true,
      ),
    );
  const expectedEvents = CHOICES.flatMap((language) => [
    { kind: "open", trusted: true, sessionId },
    { kind: "search", query: language, trusted: true, sessionId },
    { kind: "select", language, trusted: true, sessionId },
    { kind: "open", trusted: true, sessionId },
    { kind: "close", key: "Escape", trusted: true, sessionId },
  ]);
  const trustedActionsObserved = isDeepStrictEqual(events, expectedEvents);
  let noInputRequest = false;
  try {
    noInputRequest =
      liveStages &&
      stages
        .flatMap((stage) => [
          stage.searched,
          stage.selected,
          stage.inspected,
          stage.closed,
        ])
        .every(
          (snapshot) =>
            Array.isArray(JSON.parse(snapshot.traceRaw)) &&
            parseJsonRpcRequestsFromInvokeTrace(snapshot.traceRaw).filter(
              (request) =>
                request.params.threadId === threadId &&
                INPUT_METHODS.has(request.method),
            ).length === 0,
        );
  } catch {
    // Missing trace evidence cannot establish the negative input claim.
  }
  const noCanonicalTurn = [beforeRead, afterRead].every(
    (read) =>
      isObservedPreloadAppServerResponse(read?.ipcObservation, "thread/read") &&
      read.ipcObservation.params?.threadId === threadId &&
      read.result?.thread?.id === threadId &&
      Array.isArray(read.result.thread.turns) &&
      read.result.thread.turns.length === 0,
  );
  const checks = {
    liveStages,
    searchObserved,
    choicesObserved,
    languageAndHighlight,
    closeFocusObserved,
    trustedActionsObserved,
    noInputRequest,
    noCanonicalTurn,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    ...checks,
    sessionId,
    threadId,
    stages,
    events,
    actionSource:
      "Electron/CDP locator.click, search.fill and menu.press(Escape); passive document observations",
    attributeBoundary:
      "visible Check choice + canonical code class; private PM attrs are not read",
  };
}

export async function verifyComposerMarksCodePicker({
  page,
  options,
  sessionId,
  threadId,
  body,
  expectedText,
}) {
  const beforeRead = await appServerCallFromPage(page, "thread/read", {
    threadId,
    includeTurns: true,
  });
  const editor = page.locator(`${composerEditorSelector(sessionId)}:visible`);
  const trigger = editor.locator(
    '[data-composer-code-block-toolbar="true"] .composer-code-language-trigger',
  );
  const read = () =>
    page.evaluate(withComposerCodePickerDom(readComposerCodePickerDom), {
      sessionId,
    });
  const stages = [];
  await editor.evaluate(installComposerCodePickerObserverDom);
  let events;
  try {
    for (const selection of CHOICES) {
      await trigger.click();
      const menu = page.locator(".composer-code-language-menu:visible");
      await menu.locator('input[role="combobox"]').fill(selection);
      await page.waitForFunction(
        withComposerCodePickerDom(({ sessionId, selection }) => {
          const snapshot = readComposerCodePickerDom({ sessionId });
          return (
            snapshot.menuOwned &&
            snapshot.searchFocused &&
            snapshot.searchQuery === selection &&
            snapshot.choices.length === 1 &&
            snapshot.choices[0].value === selection
          );
        }),
        { sessionId, selection },
        { timeout: Math.min(options.timeoutMs, 10_000) },
      );
      const searched = await read();
      await menu.locator(`[data-code-language="${selection}"]`).click();
      await page.waitForFunction(
        withComposerCodePickerDom(({ sessionId, language, body }) => {
          const snapshot = readComposerCodePickerDom({ sessionId });
          return (
            snapshot.menuCount === 0 &&
            snapshot.editorFocused &&
            snapshot.language === language &&
            snapshot.body === body &&
            (language === "plaintext"
              ? snapshot.keywordTokens.length === 0
              : snapshot.keywordTokens.join("\u0000") === "const")
          );
        }),
        {
          sessionId,
          language: selection === "auto" ? "javascript" : selection,
          body,
        },
        { timeout: Math.min(options.timeoutMs, 10_000) },
      );
      const selected = await read();
      await trigger.click();
      await page.waitForFunction(
        withComposerCodePickerDom(({ sessionId }) => {
          const snapshot = readComposerCodePickerDom({ sessionId });
          return (
            snapshot.menuCount === 1 &&
            snapshot.menuOwned &&
            snapshot.expanded &&
            snapshot.searchQuery === ""
          );
        }),
        { sessionId },
        { timeout: Math.min(options.timeoutMs, 10_000) },
      );
      const inspected = await read();
      await menu.press("Escape");
      await page.waitForFunction(
        withComposerCodePickerDom(({ sessionId }) => {
          const snapshot = readComposerCodePickerDom({ sessionId });
          return snapshot.menuCount === 0 && snapshot.editorFocused;
        }),
        { sessionId },
        { timeout: Math.min(options.timeoutMs, 10_000) },
      );
      stages.push({
        selection,
        searched,
        selected,
        inspected,
        closed: await read(),
      });
    }
  } finally {
    events = await page.evaluate(takeComposerCodePickerEventsDom);
  }
  const afterRead = await appServerCallFromPage(page, "thread/read", {
    threadId,
    includeTurns: true,
  });
  const summary = summarizeComposerCodePickerBoundary({
    stages,
    events,
    beforeRead,
    afterRead,
    sessionId,
    threadId,
    body,
    expectedText,
  });
  assert(
    summary.ok,
    `Composer language Picker 编辑边界失败: ${JSON.stringify(summary)}`,
  );
  return summary;
}
