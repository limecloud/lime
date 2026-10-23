import { assert } from "./claw-chat-current-fixture-utils.mjs";
import { downloadHistoryPublicEvidence } from "./browser-runtime-electron-gate-b-download-history-evidence.mjs";
import {
  fileEvidence,
  readTrace,
  waitFor,
} from "./browser-runtime-electron-gate-b-download-history-native.mjs";
import { observeLiveDownloadPagination } from "./browser-download-live-pagination.mjs";

/** Populate history exclusively through real HTTP attachments in the original WebContents. */
export async function verifyDownloadHistoryPagination({
  app,
  page,
  options,
  profile,
  fixture,
  initial,
  readInvokeTrace,
  capture,
  labels,
  active,
}) {
  const files = fixture.addPaginationFiles(102);
  const query = `${fixture.marker}-page-`;
  const visibleQuery = fixture.marker;
  const read = async (offset) =>
    downloadHistoryPublicEvidence(
      await page.evaluate(
        ({ query, offset }) =>
          window.electronAPI.invoke("browser_downloads_list", {
            query,
            offset,
            limit: 100,
          }),
        { query, offset },
      ),
      [profile.root, profile.downloads],
    );
  const downloads = page.getByTestId("browser-downloads-page");
  const search = downloads.getByRole("searchbox");
  await app.evaluate(
    ({ webContents }, { id, urls }) => {
      const target = webContents.fromId(id);
      if (!target || target.isDestroyed())
        throw new Error("Pagination requires the original live browser page");
      for (const url of urls) target.downloadURL(url);
    },
    { id: initial.webContentsId, urls: files.map((file) => file.url) },
  );
  const first = await waitFor(
    options,
    () => read(0),
    (value) =>
      value.total === 102 &&
      value.entries.length === 100 &&
      value.entries.every(
        (entry) => entry.state === "completed" && entry.fileExists,
      ),
    "102 real native downloads did not reach the first history page",
  );
  const second = await waitFor(
    options,
    () => read(100),
    (value) =>
      value.total === 102 &&
      value.entries.length === 2 &&
      value.entries.every(
        (entry) => entry.state === "completed" && entry.fileExists,
      ),
    "The final two native downloads did not complete",
  );
  assert(
    first.nextOffset === 100 && second.nextOffset === null,
    "Native download offset pagination is inconsistent",
  );
  const secondPageReads = (trace) =>
    trace.filter(
      (entry) =>
        entry.command === "browser_downloads_list" &&
        entry.transport === "electron-ipc" &&
        entry.status === "success" &&
        entry.args_preview?.query === visibleQuery &&
        entry.args_preview?.offset === 100,
    ).length;
  const live = await observeLiveDownloadPagination({
    page,
    options,
    active,
    readInvokeTrace,
    query: visibleQuery,
    labels,
  });
  // The older live record is beyond page one; resume through its real id-scoped Host command.
  await page.evaluate(
    (id) =>
      window.electronAPI.invoke("browser_downloads_action", {
        id,
        action: "resume",
      }),
    active.id,
  );
  await search.fill(visibleQuery);
  await waitFor(
    options,
    () =>
      downloads
        .locator("li[data-download-id]")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-download-id")),
        ),
    (ids) =>
      ids.length === 100 &&
      new Set(ids).size === 100 &&
      ids.every((id) => first.entries.some((entry) => entry.id === id)),
    "The first 100 download records were not projected into the management page",
  );
  const readsBeforeScroll = secondPageReads(
    await readTrace(page, readInvokeTrace),
  );
  await downloads
    .getByTestId("browser-downloads-more")
    .scrollIntoViewIfNeeded();
  const rendered = await waitFor(
    options,
    () =>
      downloads
        .locator("li[data-download-id]")
        .evaluateAll((rows) =>
          rows.map((row) => row.getAttribute("data-download-id")),
        ),
    (ids) => ids.length === 103 && new Set(ids).size === 103,
    "Scrolling did not automatically load the remaining download records",
  );
  let liveEvidence;
  try {
    liveEvidence = await live.verify();
  } finally {
    await live.dispose();
  }
  await capture("pagination-after-scroll");
  const trace = await readTrace(page, readInvokeTrace);
  const secondPageRead = secondPageReads(trace) > readsBeforeScroll;
  const expected = [...first.entries, ...second.entries].map(
    (entry) => entry.id,
  );
  const filesBefore = await Promise.all(
    files.map((file) => fileEvidence(profile, file)),
  );
  // Cleanup goes through the current id-only service; it never writes history or deletes files.
  await page.evaluate(async (ids) => {
    for (const id of ids)
      await window.electronAPI.invoke("browser_downloads_action", {
        id,
        action: "remove",
      });
  }, expected);
  await waitFor(
    options,
    () => read(0),
    (value) => value.total === 0,
    "Pagination fixture terminal records were not removed",
  );
  await search.fill(query);
  await downloads
    .getByText(labels.noResultsDescription, { exact: true })
    .waitFor({ state: "visible", timeout: options.timeoutMs });
  await search.fill("");
  const filesAfter = await Promise.all(
    files.map((file) => fileEvidence(profile, file)),
  );
  return {
    nativeDownloadCount: files.length,
    firstPageCount: first.entries.length,
    lastPageCount: second.entries.length,
    firstNextOffset: first.nextOffset,
    lastNextOffset: second.nextOffset,
    uniqueRenderedCount: new Set(rendered).size,
    sameNativeIds:
      expected.length + 1 === rendered.length &&
      rendered.includes(active.id) &&
      expected.every((id) => rendered.includes(id)),
    realSecondPageIpc: secondPageRead,
    actualFilesMatchResponses: filesBefore.every(
      (file) => file.exists && file.matchesResponse,
    ),
    removedRecordsPreserveAllFiles: filesAfter.every(
      (file) => file.exists && file.matchesResponse,
    ),
    emptySearchDescriptionVisible: true,
    live: liveEvidence,
  };
}
