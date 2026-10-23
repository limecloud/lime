const PUBLIC_FIELDS = new Set([
  "id",
  "url",
  "filename",
  "mimeType",
  "state",
  "receivedBytes",
  "totalBytes",
  "startedAt",
  "updatedAt",
  "canPause",
  "canResume",
  "canCancel",
  "fileExists",
]);
const PAGE_FIELDS = new Set([
  "entries",
  "total",
  "nextOffset",
  "revision",
  "historyRevision",
]);
const STATES = new Set([
  "started",
  "progressing",
  "paused",
  "completed",
  "cancelled",
  "interrupted",
]);

/** Reject private native fields before they can enter the saved public evidence. */
export function downloadHistoryPublicEvidence(value, forbiddenRoots = []) {
  const fail = () => {
    throw new Error(
      "Download history public payload is invalid or contains private native fields",
    );
  };
  const object = (entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry);
  const nonnegative = (number) => Number.isSafeInteger(number) && number >= 0;
  if (
    !object(value) ||
    Object.keys(value).some((key) => !PAGE_FIELDS.has(key)) ||
    !Array.isArray(value.entries) ||
    !nonnegative(value.revision) ||
    !nonnegative(value.historyRevision) ||
    value.historyRevision > value.revision ||
    !nonnegative(value.total) ||
    value.total < value.entries.length ||
    (value.nextOffset !== null &&
      (!nonnegative(value.nextOffset) || value.nextOffset >= value.total))
  )
    fail();
  const ids = new Set();
  for (const entry of value.entries) {
    if (
      !object(entry) ||
      Object.keys(entry).length !== PUBLIC_FIELDS.size ||
      Object.keys(entry).some((key) => !PUBLIC_FIELDS.has(key)) ||
      typeof entry.id !== "string" ||
      !entry.id ||
      ids.has(entry.id) ||
      typeof entry.url !== "string" ||
      typeof entry.filename !== "string" ||
      (entry.mimeType !== null && typeof entry.mimeType !== "string") ||
      !STATES.has(entry.state) ||
      !nonnegative(entry.receivedBytes) ||
      (entry.totalBytes !== null && !nonnegative(entry.totalBytes)) ||
      !nonnegative(entry.startedAt) ||
      !nonnegative(entry.updatedAt) ||
      entry.updatedAt < entry.startedAt ||
      ["canPause", "canResume", "canCancel", "fileExists"].some(
        (key) => typeof entry[key] !== "boolean",
      )
    )
      fail();
    ids.add(entry.id);
  }
  const serialized = JSON.stringify(value);
  if (
    forbiddenRoots
      .filter(Boolean)
      .some(
        (root) =>
          serialized.includes(root) ||
          serialized.includes(root.replaceAll("\\", "\\\\")),
      )
  )
    fail();
  return structuredClone(value);
}

/** Compare only native-owned persisted facts; paths remain private to the verifier. */
export function downloadHistoryMatchesDisk(publicPage, disk) {
  if (
    disk?.schemaVersion !== 2 ||
    disk.revision !== publicPage?.revision ||
    !Array.isArray(disk.entries) ||
    disk.entries.length !== publicPage.total ||
    publicPage.entries.length !== publicPage.total
  )
    return false;
  const keys = [
    "id",
    "url",
    "filename",
    "mimeType",
    "state",
    "receivedBytes",
    "totalBytes",
    "startedAt",
    "updatedAt",
  ];
  const ids = new Set(disk.entries.map((entry) => entry.id));
  return (
    ids.size === disk.entries.length &&
    publicPage.entries.every((entry) => {
      const stored = disk.entries.find((stored) => stored.id === entry.id);
      return !!stored && keys.every((key) => stored[key] === entry[key]);
    })
  );
}

function retainedDownload(entry) {
  return (
    ["started", "progressing", "paused"].includes(entry.state) ||
    (entry.state === "interrupted" && (entry.canResume || entry.canCancel))
  );
}

/** A clear must preserve live and resumable identities, including cold interruptions. */
export function downloadHistoryClearEvidence(before, after) {
  const active = before.entries.filter(retainedDownload);
  const terminal = before.entries.filter((entry) => !retainedDownload(entry));
  return {
    hadActiveAndTerminal: active.length > 0 && terminal.length > 0,
    allTerminalRemoved: terminal.every(
      (entry) => !after.entries.some((candidate) => candidate.id === entry.id),
    ),
    allActivePreserved: active.every((entry) =>
      after.entries.some(
        (candidate) =>
          candidate.id === entry.id &&
          candidate.url === entry.url &&
          candidate.filename === entry.filename &&
          candidate.startedAt === entry.startedAt &&
          retainedDownload(candidate),
      ),
    ),
    noUnexpectedEntries:
      after.entries.length === active.length && after.total === active.length,
    revisionAdvanced: after.revision > before.revision,
  };
}

/** Preserve action correlation without exporting config, local paths or prompts. */
export function downloadHistoryTraceEvidence(trace) {
  return (Array.isArray(trace) ? trace : [])
    .filter((entry) =>
      [
        "browser_downloads_list",
        "browser_downloads_action",
        "browser_downloads_clear",
      ].includes(entry.command),
    )
    .map((entry) => ({
      command: entry.command,
      transport: entry.transport ?? null,
      status: entry.status ?? null,
      ...(entry.command === "browser_downloads_action"
        ? {
            id:
              typeof entry.args_preview?.id === "string"
                ? entry.args_preview.id
                : null,
            action: [
              "pause",
              "resume",
              "cancel",
              "open",
              "reveal",
              "remove",
            ].includes(entry.args_preview?.action)
              ? entry.args_preview.action
              : null,
          }
        : {}),
    }));
}

/** The same completed record must lose only its file capability, then recover intact. */
export function downloadHistoryMissingFileEvidence({
  before,
  missing,
  restored,
  missingUi,
  restoredUi,
  originalFile,
  restoredFile,
}) {
  const identity = [before, missing, restored].every(
    (entry) =>
      entry?.id === before?.id &&
      entry?.filename === before?.filename &&
      entry?.url === before?.url &&
      entry?.state === "completed",
  );
  return {
    sameCompletedNativeRecord: !!before?.id && identity,
    liveFileExistenceReflectsRename:
      before?.fileExists === true &&
      missing?.fileExists === false &&
      restored?.fileExists === true,
    missingUiNamesAndDisablesFile:
      missingUi?.missingText === true &&
      missingUi?.strikethrough === true &&
      missingUi?.openDisabled === true &&
      missingUi?.revealUnavailable === true,
    restoredUiRecoversFileCapabilities:
      restoredUi?.missingText === false &&
      restoredUi?.strikethrough === false &&
      restoredUi?.openDisabled === false &&
      restoredUi?.revealAvailable === true,
    restoredFileBytesUnchanged:
      originalFile?.matchesResponse === true &&
      restoredFile?.matchesResponse === true &&
      !!originalFile?.sha256 &&
      originalFile.sha256 === restoredFile.sha256 &&
      originalFile.byteLength === restoredFile.byteLength,
  };
}
