import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** Observe real shell calls without substituting their result or promise. */
export function observeBrowserDownloadShell(shell) {
  const actions = [];
  const originals = new Map();
  for (const [method, action] of [
    ["openPath", "open"],
    ["showItemInFolder", "reveal"],
  ]) {
    const original = shell[method];
    originals.set(method, original);
    shell[method] = function (...args) {
      const record = { action, path: args[0], status: "started" };
      actions.push(record);
      try {
        const result = Reflect.apply(original, this, args);
        if (result && typeof result.then === "function") {
          void result.then(
            (value) => Object.assign(record, { status: "fulfilled", value }),
            (error) =>
              Object.assign(record, {
                status: "rejected",
                error: String(error),
              }),
          );
        } else Object.assign(record, { status: "returned" });
        return result;
      } catch (error) {
        Object.assign(record, { status: "threw", error: String(error) });
        throw error;
      }
    };
  }
  return {
    actions,
    restore: () => {
      for (const [method, original] of originals) shell[method] = original;
    },
  };
}

async function applicationQuery(source, args) {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", source, ...args],
      { timeout: 10_000, maxBuffer: 32 * 1024 },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `macOS file action observation failed: ${stderr || error}`,
            ),
          );
        else {
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(
              new Error("macOS file action observation returned invalid JSON"),
            );
          }
        }
      },
    );
  });
}

const documentHandlerQuery = `
ObjC.import('AppKit');
function run(args) {
  var handler = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(args[0]));
  if (handler.isNil()) return JSON.stringify({bundleId: null});
  return JSON.stringify({bundleId: ObjC.unwrap($.NSBundle.bundleWithURL(handler).bundleIdentifier), path: ObjC.unwrap(handler.path)});
}`;
const textDocumentQuery = `
function run(args) {
  var app = Application('com.apple.TextEdit');
  if (!app.running()) return JSON.stringify({running: false});
  var matches = app.documents().filter(function(doc) { return doc.name() === args[1]; });
  return JSON.stringify({running: true, documents: matches.map(function(doc) {
    return {path: doc.path(), containsMarker: String(doc.text()).indexOf(args[2]) >= 0};
  })});
}`;
const finderSelectionQuery = `
function run(args) {
  var app = Application('com.apple.finder');
  if (!app.running()) return JSON.stringify({running: false});
  return JSON.stringify({running: true, urls: app.selection().filter(function(item) {
    return item.name() === args[0];
  }).map(function(item) { return item.url(); })});
}`;
const closeTextDocumentQuery = `
function run(args) {
  var app = Application('com.apple.TextEdit');
  if (!app.running()) return JSON.stringify({closed: false});
  var matches = app.documents().filter(function(doc) { return doc.name() === args[1] && doc.path() === args[0]; });
  matches.forEach(function(doc) { doc.close({saving: 'no'}); });
  return JSON.stringify({closed: matches.length === 1});
}`;

export function readBrowserDownloadHandler(downloadPath) {
  return applicationQuery(documentHandlerQuery, [downloadPath]);
}

/** Mac-specific OS evidence is separate from portable UI and native shell dispatch. */
export async function verifyBrowserDownloadFileActions({
  app,
  entry,
  file,
  downloadPath,
  action,
  waitFor,
  capture,
}) {
  assert.equal(process.platform, "darwin");
  assert.equal(entry.state, "completed");
  assert.equal(path.extname(downloadPath), ".txt");
  assert.ok(file.text);
  const canonicalPath = await realpath(downloadPath);
  const handler = await readBrowserDownloadHandler(downloadPath);
  assert.equal(
    handler.bundleId,
    "com.apple.TextEdit",
    "Text document default handler is outside this OS probe's supported scope",
  );
  const readActions = () =>
    app.evaluate(() => globalThis.__browserRestartEvidence.systemActions);
  await action(entry, "open").click();
  const opened = await waitFor(
    readActions,
    (records) =>
      records.some(
        (r) =>
          r.action === "open" &&
          r.path === downloadPath &&
          r.status === "fulfilled",
      ),
    "The real shell openPath call did not finish",
  );
  const open = opened.find(
    (r) => r.action === "open" && r.path === downloadPath,
  );
  assert.equal(open.value, "");
  const document = await waitFor(
    () =>
      applicationQuery(textDocumentQuery, [
        downloadPath,
        file.filename,
        file.text,
      ]),
    (value) => value.documents?.some((doc) => doc.containsMarker),
    "The downloaded text was not observed in the default application",
  );
  const openedDocument = document.documents.find((doc) => doc.containsMarker);
  assert.equal(await realpath(openedDocument.path), canonicalPath);
  await capture("system-open");
  await action(entry, "reveal").click();
  const revealed = await waitFor(
    readActions,
    (records) =>
      records.some(
        (r) =>
          r.action === "reveal" &&
          r.path === downloadPath &&
          r.status === "returned",
      ),
    "The real shell showItemInFolder call did not return",
  );
  const finder = await waitFor(
    () => applicationQuery(finderSelectionQuery, [file.filename]),
    (value) => value.urls?.length === 1,
    "Finder did not select the downloaded file",
  );
  assert.equal(await realpath(fileURLToPath(finder.urls[0])), canonicalPath);
  await capture("system-reveal");
  const closed = await applicationQuery(closeTextDocumentQuery, [
    openedDocument.path,
    file.filename,
  ]);
  assert.equal(closed.closed, true);
  return {
    platform: "darwin",
    defaultApplication: handler,
    document: openedDocument,
    finder,
    actions: revealed.filter((r) => r.path === downloadPath),
    fixtureDocumentClosed: true,
    input:
      "Actual Settings buttons through Electron IPC; native shell delegates unchanged",
    observation:
      "macOS application document and Finder selection queries; no native screenshot or physical input claim",
  };
}
