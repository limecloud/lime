import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const atomKey = "composer-drafts-v1";
export const sha256 = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function requireDraftProof(condition, phase) {
  if (!condition)
    throw new Error(`Composer draft GUI fixture failed: ${phase}`);
}

export function assertAppServerRequestMethods(entries) {
  return entries.flatMap((entry) => {
    const lines = entry.args_preview?.request?.lines;
    requireDraftProof(
      entry.transport === "electron-ipc" &&
        Array.isArray(lines) &&
        lines.length > 0 &&
        lines.every((line) => typeof line === "string" && line.trim()),
      "complete native App Server request-method projection; no silent parse gaps",
    );
    const requests = lines.map((line) => JSON.parse(line));
    // Codex's current envelopes omit the JSON-RPC version field.
    requireDraftProof(
      requests.every(
        (request) =>
          request &&
          !Array.isArray(request) &&
          (request.jsonrpc === undefined || request.jsonrpc === "2.0") &&
          typeof request.method === "string" &&
          request.method.length > 0,
      ),
      "complete native App Server request-method projection; no silent parse gaps",
    );
    return requests.map((request) => request.method);
  });
}

export function savedDraft(result, scope) {
  requireDraftProof(
    result?.outcome === "ready" &&
      result.key === atomKey &&
      result.data?.queryKind === "scope" &&
      isDeepStrictEqual(result.data.view?.scope, scope),
    "same native atom and exact scope",
  );
  const entry = result.data.view.entry;
  requireDraftProof(
    entry?.state === "draft" &&
      typeof entry.draftId === "string" &&
      entry.draftId.length > 0 &&
      typeof entry.scopeVersion === "string" &&
      entry.scopeVersion.trim().length > 0 &&
      Number.isSafeInteger(result.storeRevision) &&
      result.persistence?.state === "saved" &&
      result.persistence.savedRevision >= result.storeRevision,
    "draft identity applied and acknowledged saved on disk",
  );
  return entry;
}

function walk(node, result = []) {
  result.push(node);
  for (const child of node?.content ?? []) walk(child, result);
  return result;
}

// Fixed literals are independent of the product serializer and observed DOM.
export function assertRichDraft(entry, expected) {
  const payload = entry?.draft;
  const document = payload?.document;
  requireDraftProof(
    payload?.format === "composer-draft" &&
      payload.version === 1 &&
      payload.plainTextMode === false &&
      document?.editorDocument?.type === "doc",
    "current rich document codec",
  );
  const nodes = walk(document.editorDocument);
  const code = nodes.filter((node) => node?.type === "code_block");
  const links = nodes.flatMap((node) =>
    (node?.marks ?? []).filter((mark) => mark.type === "link"),
  );
  requireDraftProof(
    code.length === 1 &&
      code[0].attrs?.language === "typescript" &&
      code[0].content.map((node) => node.text).join("") ===
        "  const value = '中😀';\n````\n\n" &&
      links.length === 1 &&
      links[0].attrs?.href === "https://example.invalid/marks" &&
      links[0].attrs.title === "标题",
    "literal code body, language and link mark",
  );
  const pastes = nodes.filter((node) => node?.type === "paste");
  requireDraftProof(
    pastes.length === 1 &&
      pastes[0].attrs.text === expected.pasteText &&
      Object.values(document.pendingPastes ?? {}).some(
        (paste) => paste?.text === expected.pasteText,
      ) &&
      document.text.includes(expected.prompt) &&
      document.text.includes(expected.marker),
    "hidden paste source and independent workspace marker",
  );
  requireDraftProof(
    document.attachments?.length === 1 &&
      document.attachments[0].mediaType === "image/png" &&
      document.attachments[0].data === expected.imageBase64 &&
      !Object.hasOwn(document.attachments[0], "previewUrl") &&
      document.pathReferences?.length === 1 &&
      document.pathReferences[0].path === expected.path &&
      document.pathReferences[0].name === expected.pathName &&
      document.pathReferences[0].isDir === false,
    "durable image and complete path resource",
  );
  requireDraftProof(
    document.inputCapabilityRoute == null &&
      document.mentionBindings?.length === 1 &&
      expected.skillIdentity?.key === "user:capability-report" &&
      document.mentionBindings[0].id === expected.skillIdentity.key &&
      document.mentionBindings[0].kind === "skill" &&
      document.mentionBindings[0].name === expected.skillIdentity.name &&
      document.mentionBindings[0].label === `$${expected.skillIdentity.name}` &&
      document.mentionBindings[0].path === expected.skillIdentity.path,
    "canonical installed Skill mention identity without a second capability route",
  );
  requireDraftProof(
    Number.isSafeInteger(document.selectionStart) &&
      document.selectionEnd - document.selectionStart === 3 &&
      document.text.slice(document.selectionStart, document.selectionEnd) ===
        expected.marker.slice(-3),
    "persisted noncollapsed user selection",
  );
  return summarizeDraft(entry);
}

export function summarizeDraft(entry) {
  return {
    draftId: entry.draftId,
    scopeVersion: entry.scopeVersion,
    payloadSha256: sha256(entry.draft),
    documentSha256: sha256(entry.draft.document.editorDocument),
    textLength: entry.draft.document.text.length,
    pasteSourceSha256: sha256(entry.draft.document.pendingPastes),
    attachmentsSha256: sha256(entry.draft.document.attachments),
    pathsSha256: sha256(entry.draft.document.pathReferences),
    capabilitySha256: sha256(entry.draft.document.inputCapabilityRoute ?? null),
    selection: [
      entry.draft.document.selectionStart,
      entry.draft.document.selectionEnd,
    ],
  };
}

/** The caller parses actual disk bytes with the current records owner first. */
export function assertConsumedDraft(envelope, identity) {
  const atom = envelope.atoms[atomKey];
  const entry = atom.entries[identity.draftId];
  requireDraftProof(
    entry?.state === "consumed" &&
      entry.consumption === "accepted" &&
      entry.draftId === identity.draftId &&
      entry.scopeVersion === identity.scopeVersion &&
      !Object.values(atom.bindings).includes(identity.draftId),
    "saved accepted tombstone has exact captured identity and no scope binding",
  );
  return {
    ...identity,
    storeRevision: envelope.storeRevision,
    consumption: entry.consumption,
    noRemainingBinding: true,
  };
}

export function assertRestoredDraft(result, scope, original) {
  const entry = savedDraft(result, scope);
  requireDraftProof(
    entry.draftId === original.draftId &&
      entry.scopeVersion === original.scopeVersion &&
      isDeepStrictEqual(entry.draft, original.draft),
    "cold restore preserves exact rich JSON, resources, selection and identity",
  );
  return summarizeDraft(entry);
}

export function assertRestoredDom(actual, original, sessionId) {
  const projection = (snapshot) => ({
    text: snapshot.text,
    documentProjection: snapshot.documentProjection,
    marks: snapshot.marks,
    tokens: snapshot.tokens,
    images: snapshot.images,
    paths: snapshot.paths,
  });
  requireDraftProof(
    actual?.electron === true &&
      actual.preload === true &&
      actual.editorCount === 1 &&
      actual.sessionId === sessionId &&
      actual.disabled === false &&
      actual.images?.every((image) => image.decoded === true) &&
      isDeepStrictEqual(projection(actual), projection(original)),
    "same-session real Composer rendered semantics restored",
  );
  return {
    sessionId,
    projectionSha256: sha256(projection(actual)),
    editorCount: actual.editorCount,
    imageCount: actual.images.length,
    pathCount: actual.paths.length,
    tokenCount: actual.tokens.length,
  };
}

export function assertWorkspaceIndex(result, workspaceId, scope, entry) {
  requireDraftProof(
    result?.outcome === "ready" &&
      result.key === atomKey &&
      result.data?.queryKind === "workspace-index" &&
      result.data.workspaceId === workspaceId &&
      result.data.items?.length === 1 &&
      isDeepStrictEqual(result.data.items[0].scope, scope) &&
      isDeepStrictEqual(result.data.items[0].identity, {
        draftId: entry.draftId,
        scopeVersion: entry.scopeVersion,
      }),
    "three workspace indexes contain only their own exact identity",
  );
  return { workspaceId, itemsSha256: sha256(result.data.items) };
}

export function assertRestartLifecycle(
  generations,
  expectedProfile,
  expectedCount = 3,
) {
  requireDraftProof(
    Number.isSafeInteger(expectedCount) &&
      expectedCount >= 2 &&
      generations.length === expectedCount &&
      new Set(generations.map((entry) => entry.pid)).size === expectedCount &&
      generations.every(
        (entry) =>
          Number.isSafeInteger(entry.pid) &&
          entry.pid > 0 &&
          entry.profile === expectedProfile &&
          entry.mode === "normal" &&
          entry.exitCode === 0 &&
          entry.signal === null &&
          entry.exited === true,
      ),
    "exact distinct real Main PIDs, same profile and public normal quit",
  );
}
