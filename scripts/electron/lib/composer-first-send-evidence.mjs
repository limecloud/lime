import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { isDeepStrictEqual } from "node:util";

const atomKey = "composer-drafts-v1";
export const firstSendRoutes = Object.freeze([
  "home",
  "search-new",
  "project-new",
]);
/** Three public entries share one Home scope contract and create independent receipts. */
export function assertFirstSendRouteCoverage(proofs) {
  requireFirstSend(
    proofs.length === 3 &&
      firstSendRoutes.every((route, index) => proofs[index]?.route === route),
    "all three public first-send entries are verified once",
  );
  requireFirstSend(
    proofs.every((proof) => {
      const scope = proof.source?.sourceScope;
      return (
        scope?.kind === "home" &&
        scope.id === "new-conversation" &&
        (proof.route === "project-new"
          ? nonempty(scope.workspaceId)
          : scope.workspaceId === null) &&
        scope.workspaceId === proof.workspaceId
      );
    }),
    "public entries prove the exact stable Home and explicit workspace scopes",
  );
  for (const key of ["sessionId", "threadId"])
    requireFirstSend(
      new Set(proofs.map((proof) => proof.receipt?.[key])).size === 3 &&
        proofs.every((proof) => nonempty(proof.receipt?.[key])),
      "each public entry creates an independent canonical " + key,
    );
  return true;
}

export const newEditText = "首发接受后的新编辑，中😀；旧发送不得清除。";

export function requireFirstSend(condition, phase) {
  if (!condition)
    throw new Error("Composer first-send fixture failed: " + phase);
}

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const hashBytes = (value) => createHash("sha256").update(value).digest("hex");

function strictBase64(value) {
  requireFirstSend(nonempty(value), "image source bytes exist");
  const bytes = Buffer.from(value, "base64");
  requireFirstSend(
    bytes.length > 0 && bytes.toString("base64") === value,
    "image source is complete canonical base64",
  );
  return bytes;
}

/** Retain resource identity/digests only; source body and image data stay local. */
export function captureFirstSendResources(entry, expected) {
  capturedIdentity(entry);
  const doc = entry.draft?.document;
  const bytes = strictBase64(expected.imageBase64);
  const image = doc?.attachments?.[0];
  const reference = doc?.pathReferences?.[0];
  const binding = doc?.mentionBindings?.[0];
  const skill = expected.skillIdentity;
  const submission = expected.expectedSubmission;
  requireFirstSend(
    doc?.attachments?.length === 1 &&
      image.mediaType === "image/png" &&
      strictBase64(image.data).equals(bytes) &&
      doc.pathReferences?.length === 1 &&
      reference.path === expected.path &&
      reference.name === expected.pathName &&
      reference.id === "file:" + expected.path &&
      reference.isDir === false &&
      doc.mentionBindings?.length === 1 &&
      binding.kind === "skill" &&
      binding.id === skill?.key &&
      binding.name === skill.name &&
      binding.path === skill.path &&
      binding.label === `$${skill.name}` &&
      nonempty(skill.path) &&
      doc.inputCapabilityRoute == null &&
      /^[a-f0-9]{64}$/.test(expected.skillFileSha256 ?? "") &&
      Object.values(doc.pendingPastes ?? {}).length === 1 &&
      Object.values(doc.pendingPastes)[0].text === expected.pasteText &&
      Object.values(doc.pendingPastes)[0].placeholder ===
        submission?.textElements?.[0]?.placeholder &&
      nonempty(expected.pasteText) &&
      nonempty(submission?.text) &&
      doc.text === submission.displayText &&
      submission.text.includes(expected.prompt) &&
      submission.text.includes(expected.marker) &&
      submission.text.includes(expected.pasteText) &&
      Array.isArray(submission.textElements) &&
      submission.textElements.length === 1 &&
      submission.marks?.codeBlocks?.length === 1 &&
      submission.marks?.links?.length === 1,
    "captured native image, file and installed Skill match independent fixture resources",
  );
  const imageSha256 = hashBytes(bytes);
  return {
    image: {
      mimeType: image.mediaType,
      bytes: bytes.length,
      sha256: imageSha256,
      canonicalUrl: "sidecar://media/input-" + imageSha256 + ".png",
    },
    path: { path: reference.path, name: reference.name, isDir: false },
    skill: {
      name: skill.name,
      path: skill.path,
      key: skill.key,
      fileSha256: expected.skillFileSha256,
    },
    expandedText: {
      length: Buffer.byteLength(submission.text, "utf8"),
      sha256: hashBytes(submission.text),
      textElementsSha256: digest(submission.textElements),
    },
    hiddenPaste: {
      bytes: Buffer.byteLength(expected.pasteText, "utf8"),
      sha256: hashBytes(expected.pasteText),
    },
    code: {
      language: submission.marks.codeBlocks[0].language,
      bodySha256: hashBytes(submission.marks.codeBlocks[0].body),
    },
    link: {
      href: submission.marks.links[0].href,
      title: submission.marks.links[0].title,
      labelSha256: hashBytes(submission.marks.links[0].label),
    },
  };
}

/** Reuse the current full-input oracle, then bind real media bytes to source. */
export function assertFirstSendResourceReceipt(
  source,
  receipt,
  { richInput, mediaRead, expectedSubmission },
) {
  const resources = source.resources;
  const media = mediaRead?.result;
  requireFirstSend(
    resources &&
      receipt.canonicalAccepted === true &&
      richInput?.ok === true &&
      richInput.threadId === receipt.threadId &&
      richInput.itemId === receipt.userItemId &&
      richInput.imageUrl === resources.image.canonicalUrl &&
      richInput.canonicalFullInputPreserved === true &&
      richInput.canonicalSkillPreserved === true &&
      richInput.pathIdentityPreserved === true &&
      richInput.pasteExpanded === true &&
      richInput.textElementsPreserved === true &&
      richInput.canonicalImageBytesPreserved === true &&
      hashBytes(expectedSubmission.text) === resources.expandedText.sha256 &&
      digest(expectedSubmission.textElements) ===
        resources.expandedText.textElementsSha256 &&
      media?.threadId === receipt.threadId &&
      media.uri === resources.image.canonicalUrl &&
      media.mimeType === resources.image.mimeType &&
      media.offset === 0 &&
      media.bytes === resources.image.bytes &&
      media.totalBytes === resources.image.bytes &&
      media.length === resources.image.bytes &&
      media.hasMore === false &&
      media.sha256 === "sha256:" + resources.image.sha256 &&
      hashBytes(strictBase64(media.contentBase64)) === resources.image.sha256,
    "complete canonical input and actual thread-scoped media bytes match the captured rich source",
  );
  return {
    completeCanonicalInputVerified: true,
    sourceResourcesSha256: digest(resources),
    imageSha256: resources.image.sha256,
    mediaReadSha256: media.sha256,
    ...richInput,
  };
}

export function capturedIdentity(entry) {
  requireFirstSend(
    entry?.state === "draft" &&
      nonempty(entry.draftId) &&
      nonempty(entry.scopeVersion),
    "captured native identity uses opaque nonempty strings",
  );
  return { draftId: entry.draftId, scopeVersion: entry.scopeVersion };
}

/** Public metadata and an exact saved payload bind the sole visible Composer. */
export function assertFirstSendScopeObservation(route, proof) {
  const { workspaceId, workspaceIndex, scopeRead, dom, expectedMarker } = proof;
  const kind = "home";
  requireFirstSend(firstSendRoutes.includes(route), "known first-send route");
  requireFirstSend(
    (workspaceId === null || nonempty(workspaceId)) &&
      workspaceIndex?.key === atomKey &&
      workspaceIndex.outcome === "ready" &&
      workspaceIndex.data?.queryKind === "workspace-index" &&
      workspaceIndex.data.workspaceId === workspaceId &&
      Array.isArray(workspaceIndex.data.items) &&
      workspaceIndex.data.items.every(
        (item) => item.scope?.workspaceId === workspaceId,
      ),
    "same atom public workspace index contains no foreign workspace",
  );
  const matches = workspaceIndex.data.items.filter(
    (item) => item.scope?.kind === kind,
  );
  requireFirstSend(
    matches.length === 1 &&
      nonempty(matches[0].scope.id) &&
      !matches[0].sessionId &&
      !matches[0].threadId &&
      matches[0].scope.id === "new-conversation",
    "exactly one actual unpromoted source scope; no fallback identity",
  );
  const item = matches[0];
  requireFirstSend(
    scopeRead?.key === atomKey &&
      scopeRead.outcome === "ready" &&
      scopeRead.data?.queryKind === "scope" &&
      isDeepStrictEqual(scopeRead.data.view?.scope, item.scope) &&
      [workspaceIndex, scopeRead].every(
        (result) =>
          Number.isSafeInteger(result.storeRevision) &&
          result.persistence?.state === "saved" &&
          result.persistence.savedRevision === result.storeRevision,
      ) &&
      scopeRead.storeRevision === workspaceIndex.storeRevision,
    "public index and exact scope read acknowledge the same saved revision",
  );
  const entry = scopeRead.data.view.entry;
  const identity = capturedIdentity(entry);
  requireFirstSend(
    isDeepStrictEqual(item.identity, identity) &&
      !entry.sessionId &&
      !entry.threadId &&
      entry.originScopeKey ===
        JSON.stringify([workspaceId, kind, item.scope.id]) &&
      dom?.electron === true &&
      dom.preload === true &&
      dom.editorCount === 1 &&
      dom.disabled === false &&
      dom.sessionId === null &&
      nonempty(expectedMarker) &&
      dom.text?.includes(expectedMarker) &&
      entry.draft?.document?.text?.includes(expectedMarker),
    "one native null-session Composer and saved payload share the unique input marker",
  );
  return {
    scope: item.scope,
    identity,
    storeRevision: scopeRead.storeRevision,
    workspaceIndexSha256: digest(workspaceIndex.data.items),
    payloadSha256: digest(entry.draft),
    markerSha256: digest(expectedMarker),
    logicalDraftScopeOnly: true,
    visibleTabIdentityVerified: false,
  };
}

/** The actual saved logical scope is captured before a real Send button click. */
export function assertFirstSendSource(route, proof) {
  const { scope, entry, dom, beforeThreads, preparedThreads } = proof;
  const observation = assertFirstSendScopeObservation(route, proof);
  requireFirstSend(
    isDeepStrictEqual(scope, observation.scope) &&
      isDeepStrictEqual(entry, proof.scopeRead.data.view.entry) &&
      (route !== "home" || dom.emptyState === true),
    "captured source is the exact current native payload and logical scope",
  );
  const identity = capturedIdentity(entry);
  requireFirstSend(
    !entry.sessionId &&
      nonempty(entry.originScopeKey) &&
      Array.isArray(beforeThreads) &&
      Array.isArray(preparedThreads) &&
      [...beforeThreads, ...preparedThreads].every(
        (thread) => nonempty(thread.id) && nonempty(thread.sessionId),
      ),
    "source remains unpromoted and canonical pre-send inventory exists",
  );
  const priorIds = new Set(beforeThreads.map((thread) => thread.id));
  const created = preparedThreads.filter((thread) => !priorIds.has(thread.id));
  requireFirstSend(
    new Set(beforeThreads.map((thread) => thread.id)).size ===
      beforeThreads.length &&
      new Set(preparedThreads.map((thread) => thread.id)).size ===
        preparedThreads.length,
    "canonical inventory has unique thread identities",
  );
  requireFirstSend(
    created.length === 0,
    "editor input creates no extra canonical thread before Send",
  );
  return {
    route,
    sourceScope: scope,
    identity,
    originScopeKey: entry.originScopeKey,
    preexistingThreadIds: [...priorIds],
    preexistingSessionIds: beforeThreads.map((thread) => thread.sessionId),
    sourceDocumentSha256: digest(entry.draft),
    actualNullSessionComposer: true,
    nativeScopeObservation: observation,
  };
}

/** Receipt identity and text fragments; the resource oracle proves full input. */
export function assertFirstSendReceipt(thread, source, expectedFragments) {
  requireFirstSend(
    nonempty(thread?.id) &&
      nonempty(thread.sessionId) &&
      Array.isArray(thread.turns) &&
      thread.turns.length === 1 &&
      !source.preexistingThreadIds.includes(thread.id) &&
      !source.preexistingSessionIds.includes(thread.sessionId),
    "accepted canonical thread matches this first-send route",
  );
  const turn = thread.turns[0];
  requireFirstSend(
    nonempty(turn.id) && ["inProgress", "in_progress"].includes(turn.status),
    "canonical receipt is an active accepted Turn",
  );
  const users = (turn.items ?? []).filter(
    (item) => item.type === "userMessage",
  );
  requireFirstSend(
    users.length === 1 &&
      nonempty(users[0].id) &&
      Array.isArray(users[0].content),
    "one canonical user Item for the submitted draft",
  );
  const text = users[0].content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
  requireFirstSend(
    expectedFragments.length > 0 &&
      expectedFragments.every(
        (fragment) => nonempty(fragment) && text.includes(fragment),
      ),
    "canonical user text contains independent body fragments",
  );
  return {
    sessionId: thread.sessionId,
    threadId: thread.id,
    turnId: turn.id,
    userItemId: users[0].id,
    userItemSha256: digest(users[0]),
    canonicalAccepted: true,
    bodyFragmentsVerified: true,
  };
}

export function assertUnboundScope(result, scope) {
  requireFirstSend(
    result?.key === atomKey &&
      result.outcome === "ready" &&
      result.data?.queryKind === "scope" &&
      isDeepStrictEqual(result.data.view.scope, scope) &&
      result.data.view.entry === null &&
      result.persistence?.state === "saved" &&
      result.persistence.savedRevision === result.storeRevision,
    "exact old or local scope is unbound and acknowledged saved",
  );
  return { scope, storeRevision: result.storeRevision, unbound: true };
}

/** The shared driver parses actual primary/backup bytes with the current owner. */
export function assertFirstSendConsumed(envelope, source, receipt) {
  const atom = envelope.atoms[atomKey];
  const entry = atom.entries[source.identity.draftId];
  requireFirstSend(
    entry?.state === "consumed" &&
      entry.consumption === "accepted" &&
      entry.draftId === source.identity.draftId &&
      entry.scopeVersion === source.identity.scopeVersion &&
      entry.originScopeKey === source.originScopeKey &&
      entry.sessionId === receipt.sessionId &&
      entry.threadId === receipt.threadId &&
      !Object.hasOwn(entry, "draft") &&
      !Object.values(atom.bindings).includes(source.identity.draftId),
    "exact submitted identity was promoted to receipt metadata and consumed",
  );
  return {
    ...source.identity,
    sessionId: entry.sessionId,
    threadId: entry.threadId,
    storeRevision: envelope.storeRevision,
    consumption: entry.consumption,
    sameCapturedIdentity: true,
    noRemainingBinding: true,
  };
}

export function assertFirstSendNewEdit(entry, source, receipt) {
  const identity = capturedIdentity(entry);
  requireFirstSend(
    entry.sessionId === receipt.sessionId &&
      entry.draft?.document?.text === newEditText &&
      (identity.draftId !== source.identity.draftId ||
        identity.scopeVersion !== source.identity.scopeVersion),
    "new local edit has a different opaque identity and exact user text",
  );
  return {
    ...identity,
    documentSha256: digest(entry.draft),
    newEditPreserved: true,
  };
}

/** Reject an old driver that silently ignores the envelope inspector callback. */
export function assertFirstSendSavedFiles(files, expected) {
  requireFirstSend(
    nonempty(expected.draftId) &&
      nonempty(expected.scopeVersion) &&
      Array.isArray(files) &&
      files.length === 2 &&
      files.every(
        (file) =>
          file.entryEvidence &&
          Object.entries(expected).every(
            ([key, value]) => file.entryEvidence[key] === value,
          ),
      ),
    "shared driver inspected the exact identity in both actual disk files",
  );
}

export function assertFirstSendTrace(trace) {
  const operations = trace.atomOperations;
  requireFirstSend(
    Array.isArray(operations) &&
      operations.every(
        (item) =>
          item.transport === "electron-ipc" && item.status === "success",
      ) &&
      trace.appServerInvokeCount > 0,
    "complete shared-driver ledger uses native IPC and current App Server",
  );
  const promotions = operations.flatMap((item, index) =>
    item.op === "promote" ? [index] : [],
  );
  const consumptions = operations.flatMap((item, index) =>
    item.op === "consume" ? [index] : [],
  );
  requireFirstSend(
    promotions.length === 1 &&
      consumptions.length === 1 &&
      promotions[0] < consumptions[0] &&
      operations.some(
        (item, index) => item.op === "put" && index > consumptions[0],
      ),
    "one production promotion precedes consume and a later new-edit put",
  );
  return {
    promotionIndex: promotions[0],
    consumeIndex: consumptions[0],
    productionPromotionBeforeConsume: true,
    newEditPutAfterConsume: true,
  };
}
