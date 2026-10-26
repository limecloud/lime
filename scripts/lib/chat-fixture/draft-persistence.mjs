import { selectComposerSkillFromGui } from "./gui-input-modes.mjs";
import { isDeepStrictEqual } from "node:util";
import { Buffer } from "node:buffer";
import {
  atomKey,
  assertRestoredDom,
  assertRestoredDraft,
  assertRichDraft,
  assertWorkspaceIndex,
  requireDraftProof,
  savedDraft,
  sha256,
  summarizeDraft,
} from "../../electron/lib/composer-draft-fixture-evidence.mjs";

export const markers = ["GUI工作区一号", "GUI工作区二号", "GUI工作区三号"];

export const nextEdit = "Accepted 后的新编辑，旧回合不得清除。";

export async function until(context, read, ready, phase) {
  const started = Date.now();
  while (Date.now() - started < context.options.timeoutMs) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) =>
      setTimeout(resolve, context.options.intervalMs),
    );
  }
  throw new Error(`Composer draft GUI fixture timed out: ${phase}`);
}

export function editor(context, record) {
  return context.page.locator(
    `${context.modules.dom.composerEditorSelector(record.sessionId)}:visible`,
  );
}

export async function readScope(context, scope) {
  const observed = await context.modules.atom.observePersistedAtomCommand(
    context.page,
    context.protocol,
    "persisted_atom_read",
    { key: atomKey, query: { kind: "scope", scope } },
    { timeoutMs: context.options.timeoutMs },
  );
  return observed.result;
}

export async function waitSaved(context, record) {
  await context.page
    .locator(
      '[data-testid="composer-draft-status"][data-state="saved"]:visible',
    )
    .waitFor({ timeout: context.options.timeoutMs });
  return until(
    context,
    () => readScope(context, record.scope),
    (result) => {
      try {
        savedDraft(result, record.scope);
        return true;
      } catch {
        return false;
      }
    },
    "native savedRevision and GUI saved status",
  );
}

async function readThread(context, record) {
  const read = await context.modules.rpc.invokeAppServerFromPage(
    context.page,
    "thread/read",
    { threadId: record.threadId, includeTurns: true },
  );
  requireDraftProof(
    read.result?.thread?.id === record.threadId &&
      read.result.thread.sessionId === record.sessionId &&
      Array.isArray(read.result.thread.turns),
    "canonical Thread/session read model identity",
  );
  return read.result.thread;
}

/** Preferences assist navigation only; no Controller, draft or fake workspace state. */
async function selectWorkspacePreferences(context, record) {
  await context.page.evaluate(
    ({ workspaceId, sessionId, provider, model }) => {
      const storage = window.localStorage;
      const projects = JSON.parse(
        storage.getItem("agent_opened_project_ids") || "[]",
      );
      const opened = [...new Set([...projects, workspaceId])];
      storage.setItem("agent_last_project_id", JSON.stringify(workspaceId));
      storage.setItem("agent_opened_project_ids", JSON.stringify(opened));
      for (const suffix of [workspaceId, "global"]) {
        storage.setItem(
          `agent_pref_provider_${suffix}`,
          JSON.stringify(provider),
        );
        storage.setItem(`agent_pref_model_${suffix}`, JSON.stringify(model));
        storage.setItem(`agent_pref_migrated_${suffix}`, "true");
        storage.setItem(
          `agent_topic_model_pref_${suffix}_${sessionId}`,
          JSON.stringify({ providerType: provider, model }),
        );
      }
      storage.setItem(
        `agent_session_workspace_${sessionId}`,
        JSON.stringify(workspaceId),
      );
      storage.setItem(
        `agent_execution_strategy_${workspaceId}`,
        JSON.stringify("react"),
      );
      storage.setItem(
        `agent_access_mode_${workspaceId}`,
        JSON.stringify("full-access"),
      );
      window.dispatchEvent(
        new CustomEvent("agent-persisted-project-id-changed", {
          detail: { projectId: workspaceId, key: "agent_last_project_id" },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("agent-opened-project-ids-changed", {
          detail: { projectIds: opened },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("lime:agent-runtime-sessions-changed", {
          detail: { reason: "external", sessionId, workspaceId },
        }),
      );
      window.dispatchEvent(new Event("focus"));
    },
    {
      ...record,
      provider: context.modules.constants.FIXTURE_PROVIDER,
      model: context.modules.constants.FIXTURE_MODEL,
    },
  );
}

export async function openRecord(context, record) {
  await selectWorkspacePreferences(context, record);
  await until(
    context,
    () =>
      context.page.evaluate(({ sessionId, workspaceName }) => {
        const headers = Array.from(
          document.querySelectorAll(
            '[data-testid="app-sidebar-project-conversation-group"] button[aria-expanded]',
          ),
        );
        const header = headers.find(
          (button) => button.getAttribute("title") === workspaceName,
        );
        if (header?.getAttribute("aria-expanded") === "false") header.click();
        return Array.from(
          document.querySelectorAll(
            '[data-testid="app-sidebar-conversation-open"]',
          ),
        ).some(
          (button) => button.getAttribute("data-session-id") === sessionId,
        );
      }, record),
    (visible) => visible === true,
    "exact real sidebar conversation row; project header is not a conversation",
  );
  await context.modules.sessions.openSessionFromSidebar(
    context.page,
    context.options,
    undefined,
    record,
  );
  requireDraftProof(
    (await editor(context, record).count()) === 1,
    "real sidebar committed one same-session visible Composer",
  );
  await until(
    context,
    () =>
      context.modules.history.readComposerHistorySnapshot(
        context.page,
        record.sessionId,
      ),
    (snapshot) =>
      snapshot.editorCount === 1 &&
      snapshot.sessionId === record.sessionId &&
      !snapshot.disabled,
    "same-session Composer is editable after committed draft hydration",
  );
  return readThread(context, record);
}

export async function createRecord(context, { rootPath, title, marker }) {
  const workspaceName = `Draft workspace ${marker}`;
  const workspace = await context.modules.rpc.invokeAppServerFromPage(
    context.page,
    "workspace/ensure",
    { name: workspaceName, rootPath },
  );
  const item = workspace.result?.workspace;
  requireDraftProof(
    typeof item?.id === "string" && item.id.length > 0,
    "workspace/ensure current directory owner returns real identity",
  );
  const start = await context.modules.rpc.invokeAppServerFromPage(
    context.page,
    "thread/start",
    {
      cwd: rootPath,
      runtimeWorkspaceRoots: [rootPath],
      historyMode: "paginated",
      serviceName: title,
      threadSource: "appServer",
      model: context.modules.constants.FIXTURE_MODEL,
      modelProvider: context.modules.constants.FIXTURE_PROVIDER,
    },
  );
  const thread = start.result?.thread;
  requireDraftProof(
    typeof thread?.id === "string" &&
      thread.id.length > 0 &&
      typeof thread.sessionId === "string" &&
      thread.sessionId.length > 0,
    "thread/start current canonical identity",
  );
  return {
    title,
    workspaceName,
    marker,
    rootPath,
    workspaceId: item.id,
    sessionId: thread.sessionId,
    threadId: thread.id,
    scope: { workspaceId: item.id, kind: "local", id: thread.sessionId },
  };
}

async function selectMarker(context, record) {
  const locator = editor(context, record);
  await until(
    context,
    () =>
      context.modules.history.readComposerHistorySnapshot(
        context.page,
        record.sessionId,
      ),
    (snapshot) =>
      snapshot.editorCount === 1 &&
      snapshot.sessionId === record.sessionId &&
      !snapshot.disabled,
    "same-session Composer is editable before trusted selection keys",
  );
  await locator.focus();
  await locator.press("ControlOrMeta+End");
  for (let index = 0; index < 3; index += 1)
    await locator.press("Shift+ArrowLeft");
  const selection = await locator.evaluate((node) => {
    const current = window.getSelection();
    return {
      text: current?.toString(),
      inside:
        node.contains(current?.anchorNode) && node.contains(current?.focusNode),
    };
  });
  requireDraftProof(
    selection.inside && selection.text === record.marker.slice(-3),
    "trusted keyboard creates noncollapsed same-editor selection",
  );
}

export async function prepareRecord(context, record) {
  context.setPhase?.("open-existing-local-session");
  await openRecord(context, record);
  const original = await prepareVisibleDraft(context, record, async () => {
    await context.modules.marks.prepareComposerMarksDraft({
      page: context.page,
      options: context.options,
      sessionId: record.sessionId,
      threadId: record.threadId,
      prompt: context.expected(record).prompt,
    });
  });
  const thread = await readThread(context, record);
  requireDraftProof(
    thread.turns.length === 0,
    "editing creates no canonical turn",
  );
  return original;
}

async function prepareVisibleMarks(context, record) {
  const codeBody = "  const value = '中😀';\n````";
  const paste = await context.modules.marks.pasteComposerMarksDraft({
    page: context.page,
    sessionId: record.sessionId,
    prompt: context.expected(record).prompt,
  });
  requireDraftProof(
    paste.trusted === false &&
      paste.defaultPrevented === true &&
      JSON.stringify(paste.formats) ===
        JSON.stringify(["text/html", "text/plain"]),
    "real HTML paste ingress, no OS clipboard claim",
  );
  const locator = editor(context, record);
  await locator.locator(".composer-code-language-trigger").click();
  const menu = context.page.locator(".composer-code-language-menu:visible");
  await menu.getByRole("combobox").fill("TypeScript");
  await menu.locator('[data-code-language="typescript"]').click();
  // Public DOM Selection plus trusted keys; no EditorState or transaction injection.
  await locator.evaluate(context.modules.marks.placeComposerCodeCaretAtEndDom);
  for (const [index, key] of ["Enter", "Shift+Enter"].entries()) {
    await locator.press(key);
    await until(
      context,
      () =>
        context.modules.history.readComposerHistorySnapshot(
          context.page,
          record.sessionId,
        ),
      (snapshot) =>
        snapshot.editorCount === 1 &&
        snapshot.sessionId === record.sessionId &&
        snapshot.marks?.codeBlocks?.length === 1 &&
        snapshot.marks.codeBlocks[0].validStructure &&
        snapshot.marks.codeBlocks[0].language === "typescript" &&
        snapshot.marks.codeBlocks[0].body === codeBody + "\n".repeat(index + 1),
      "trusted code editing retains same-identity rich document",
    );
  }
  await locator.locator("p").last().click();
}

/** Caller verifies public surface identity; this helper touches only visible GUI ingress. */
export async function prepareVisibleDraft(
  context,
  record,
  prepareMarks = null,
) {
  requireDraftProof(
    (await editor(context, record).count()) === 1,
    "one identity-verified visible Composer before rich editing",
  );
  const expected = context.expected(record);
  context.setPhase?.("prepare-rich-code-and-marks");
  await (prepareMarks ? prepareMarks() : prepareVisibleMarks(context, record));
  await context.modules.history.prepareHistoryPaste(
    context.page,
    record.sessionId,
    expected.pasteText,
  );
  context.setPhase?.("select-installed-skill");
  const skillSelection = await selectComposerSkillFromGui(context.page, {
    editor: editor(context, record),
    skillIdentity: { name: "capability-report", key: "user:capability-report" },
    timeoutMs: context.options.timeoutMs,
  });
  requireDraftProof(
    skillSelection.trustedPointer,
    "real installed-skill suggestion selection",
  );
  context.setPhase?.("attach-image-through-native-dialog-fixture");
  await context.modules.image.attachComposerImage(context.page, {
    app: context.app,
    sessionId: record.sessionId,
    addFilesName: "添加照片和文件",
    timeoutMs: context.options.timeoutMs,
    image: {
      name: "composer-persistence.png",
      mimeType: "image/png",
      buffer: Buffer.from(expected.imageBase64, "base64"),
    },
  });
  context.setPhase?.("drop-temporary-workspace-file");
  const dropped = await editor(context, record).evaluate(
    (node, reference) => {
      const target = node.closest('[data-testid="inputbar-core-container"]');
      if (!(target instanceof HTMLElement)) return false;
      const dataTransfer = new DataTransfer();
      dataTransfer.setData(
        "application/x-lime-path-reference",
        JSON.stringify([reference]),
      );
      dataTransfer.setData("text/plain", reference.path);
      target.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
      const event = new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
    {
      id: `file:${record.path}`,
      path: record.path,
      name: record.pathName,
      isDir: false,
      size: 128,
      mimeType: "text/markdown",
    },
  );
  requireDraftProof(
    dropped === true,
    "temporary real file enters through production path drop",
  );
  await until(
    context,
    () =>
      context.modules.history.readComposerHistorySnapshot(
        context.page,
        record.sessionId,
      ),
    (snapshot) =>
      snapshot.editorCount === 1 &&
      snapshot.sessionId === record.sessionId &&
      snapshot.images.length === 1 &&
      snapshot.images[0].decoded &&
      snapshot.paths.length === 1 &&
      snapshot.paths[0].path === record.path &&
      snapshot.tokens.some((token) => token.id === "user:capability-report"),
    "rich GUI resources and installed-skill token visible",
  );
  await editor(context, record).focus();
  await editor(context, record).press("ControlOrMeta+End");
  await context.page.keyboard.insertText(` ${record.marker}`);
  context.setPhase?.("save-complete-rich-draft-and-selection");
  await selectMarker(context, record);
  const result = await waitSaved(context, record);
  const entry = savedDraft(result, record.scope);
  assertRichDraft(entry, context.expected(record));
  const dom = await context.modules.history.readComposerHistorySnapshot(
    context.page,
    record.sessionId,
  );
  assertRestoredDom(dom, dom, record.sessionId);
  return { entry, dom, revision: result.storeRevision };
}

export async function verifyRecord(context, record, original) {
  await openRecord(context, record);
  return verifyVisibleDraft(context, record, original);
}

export async function verifyVisibleDraft(context, record, original) {
  requireDraftProof(
    (await editor(context, record).count()) === 1,
    "one identity-verified visible Composer before restore observation",
  );
  const result = await waitSaved(context, record);
  const json = assertRestoredDraft(result, record.scope, original.entry);
  // Focusing an already restored PM selection preserves the selection; no state write.
  await editor(context, record).focus();
  const selected = await editor(context, record).evaluate(() =>
    window.getSelection()?.toString(),
  );
  const expectedSelection = original.entry.draft.document;
  requireDraftProof(
    selected ===
      expectedSelection.text.slice(
        expectedSelection.selectionStart,
        expectedSelection.selectionEnd,
      ),
    "DOM selection restored from durable JSON",
  );
  const dom = await context.modules.history.readComposerHistorySnapshot(
    context.page,
    record.sessionId,
  );
  const rendered = assertRestoredDom(dom, original.dom, record.sessionId);
  return { json, rendered, revision: result.storeRevision };
}

export async function readIndex(context, record, entry) {
  const observed = await context.modules.atom.observePersistedAtomCommand(
    context.page,
    context.protocol,
    "persisted_atom_read",
    {
      key: atomKey,
      query: { kind: "workspace-index", workspaceId: record.workspaceId },
    },
  );
  return assertWorkspaceIndex(
    observed.result,
    record.workspaceId,
    record.scope,
    entry,
  );
}

async function paste(context, record, text) {
  await editor(context, record).focus();
  await editor(context, record).press("ControlOrMeta+End");
  await editor(context, record).evaluate((node, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    node.dispatchEvent(event);
    if (!event.defaultPrevented)
      throw new Error("real EditorView paste was not handled");
  }, text);
}

export async function verifyRejectedSubmission(context, record, recordStage) {
  const baseline = savedDraft(await waitSaved(context, record), record.scope);
  assertRichDraft(baseline, context.expected(record));
  const input = "x".repeat((1 << 20) + 1);
  await paste(context, record, input);
  const before = savedDraft(await waitSaved(context, record), record.scope);
  requireDraftProof(
    before.draft.document.pendingPastes.some((paste) => paste.text === input),
    "oversize input is a real saved hidden paste",
  );
  await editor(context, record)
    .locator('xpath=ancestor::*[@data-testid="inputbar-core-container"][1]')
    .locator('[data-testid="send-btn"]')
    .click();
  await until(
    context,
    () => context.page.evaluate(() => document.body.innerText),
    (text) =>
      /Input exceeds|maximum length|输入.{0,20}(最大|长度|限制)|輸入.{0,20}(最大|長度|限制)/u.test(
        text,
      ),
    "user-visible oversized input rejection",
  );
  const thread = await readThread(context, record);
  requireDraftProof(
    thread.turns.length === 0,
    "rejected GUI input creates no canonical Turn",
  );
  const after = savedDraft(await waitSaved(context, record), record.scope);
  requireDraftProof(
    isDeepStrictEqual(after, before),
    "failure preserves exact rich draft and all resources",
  );
  recordStage?.("rejection-exact-preservation-before-undo", {
    noCanonicalTurn: true,
    fullRichDraftPreserved: true,
    before: summarizeDraft(before),
    after: summarizeDraft(after),
  });
  await editor(context, record).press("ControlOrMeta+z");
  await until(
    context,
    () => readScope(context, record.scope),
    (result) =>
      result.data?.view?.entry?.state === "draft" &&
      !result.data.view.entry.draft.document.pendingPastes.some(
        (paste) => paste.text === input,
      ),
    "trusted Undo removes only the oversized source",
  );
  const undoDom = await context.modules.history.readComposerHistorySnapshot(
    context.page,
    record.sessionId,
  );
  recordStage?.("rejection-after-trusted-undo", {
    nativeDraft: summarizeDraft(
      savedDraft(await waitSaved(context, record), record.scope),
    ),
    dom: {
      editorCount: undoDom.editorCount,
      sameSession: undoDom.sessionId === record.sessionId,
      disabled: undoDom.disabled,
      textLength: undoDom.text?.length ?? null,
      codeBlocks: undoDom.marks?.codeBlocks?.length ?? 0,
      links: undoDom.marks?.links?.length ?? 0,
      tokenKinds: undoDom.tokens?.map((token) => token.type),
      images: undoDom.images?.length ?? 0,
      paths: undoDom.paths?.length ?? 0,
    },
  });
  const clean = savedDraft(await waitSaved(context, record), record.scope);
  requireDraftProof(
    isDeepStrictEqual(clean.draft, baseline.draft),
    "trusted Undo restores the exact original rich draft and selection",
  );
  assertRichDraft(clean, context.expected(record));
  const dom = await context.modules.history.readComposerHistorySnapshot(
    context.page,
    record.sessionId,
  );
  return {
    evidence: {
      noCanonicalTurn: true,
      fullRichDraftPreserved: true,
      failedDraftSha256: sha256(before.draft),
      inputCharacters: input.length,
      rejectionLayer:
        "GUI send with canonical no-Turn proof; RPC admission requires trace review",
      undoUsesTrustedKeyboard: true,
    },
    original: { entry: clean, dom },
  };
}

export async function verifyAcceptedNewEdit(context, records, originals) {
  const [first, second] = records;
  await openRecord(context, first);
  await editor(context, first)
    .locator('xpath=ancestor::*[@data-testid="inputbar-core-container"][1]')
    .locator('[data-testid="send-btn"]')
    .click();
  const thread = await until(
    context,
    () => readThread(context, first),
    (thread) => thread.turns.length === 1,
    "canonical accepted Turn",
  );
  const turn = thread.turns[0];
  requireDraftProof(
    typeof turn.id === "string" &&
      turn.id.length > 0 &&
      ["inProgress", "in_progress"].includes(turn.status),
    "active canonical accepted receipt",
  );
  const users = (turn.items ?? []).filter(
    (item) => item.type === "userMessage",
  );
  requireDraftProof(
    users.length === 1 &&
      typeof users[0].id === "string" &&
      users[0].id.length > 0 &&
      Array.isArray(users[0].content),
    "accepted Thread/Turn has exactly one canonical user Item",
  );
  const text = users[0].content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  const expected = context.expected(first);
  requireDraftProof(
    text.includes(expected.prompt) &&
      text.includes(expected.pasteText) &&
      text.includes(first.marker) &&
      text.includes("const value = '中😀';"),
    "canonical user Item preserves literal rich input and expanded hidden paste",
  );
  await until(
    context,
    () => readScope(context, first.scope),
    (result) =>
      result.outcome === "ready" &&
      result.data?.queryKind === "scope" &&
      result.data.view.entry === null &&
      result.persistence?.state === "saved" &&
      result.persistence.savedRevision >= result.storeRevision,
    "accepted receipt consumes only submitted persistent identity",
  );
  const consumedIdentity = {
    draftId: originals[0].entry.draftId,
    scopeVersion: originals[0].entry.scopeVersion,
  };
  const consumption = await context.readConsumedDraft(consumedIdentity);
  await editor(context, first).fill(nextEdit);
  const newResult = await waitSaved(context, first);
  const newEntry = savedDraft(newResult, first.scope);
  requireDraftProof(
    newEntry.draft.document.text === nextEdit &&
      (newEntry.draftId !== originals[0].entry.draftId ||
        newEntry.scopeVersion !== originals[0].entry.scopeVersion),
    "new edit owns a newer saved identity after accepted consume",
  );
  const newDom = await context.modules.history.readComposerHistorySnapshot(
    context.page,
    first.sessionId,
  );
  await verifyRecord(context, second, originals[1]);
  // Public canonical interrupt while another workspace is visible. It must not
  // restore the old submitted body over either current workspace's newer draft.
  await context.modules.rpc.invokeAppServerFromPage(
    context.page,
    "turn/interrupt",
    {
      threadId: first.threadId,
      turnId: turn.id,
    },
  );
  const terminal = await until(
    context,
    () => readThread(context, first),
    (value) =>
      ["interrupted", "canceled", "cancelled"].includes(value.turns[0]?.status),
    "canonical interrupted Turn under foreign GUI scope",
  );
  await verifyRecord(context, second, originals[1]);
  const firstRead = await readScope(context, first.scope);
  assertRestoredDraft(firstRead, first.scope, newEntry);
  await verifyRecord(context, first, { entry: newEntry, dom: newDom });
  originals[0] = { entry: newEntry, dom: newDom };
  return {
    threadId: first.threadId,
    sessionId: first.sessionId,
    turnId: turn.id,
    terminalStatus: terminal.turns[0].status,
    newDraft: summarizeDraft(newEntry),
    consumption,
    userItemId: users[0].id,
    canonicalUserItemSha256: sha256(users[0]),
    newerEditPreserved: true,
    foreignWorkspacePreserved: true,
    exactPendingTokenRace: false,
    interruptSurface: "preload -> App Server turn/interrupt",
    canonicalTurnSha256: sha256(terminal.turns[0]),
  };
}
