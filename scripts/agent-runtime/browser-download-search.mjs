import assert from "node:assert/strict";

/** Exercise keyboard and search against real records; never synthesize history or native state. */
export async function verifyBrowserDownloadSearch({
  page,
  entries,
  label,
  waitFor,
  capture,
}) {
  assert.equal(entries.length, 2);
  const downloads = page.getByTestId("browser-downloads-page");
  const search = downloads.getByRole("searchbox", {
    name: label("search"),
    exact: true,
  });
  const groups = downloads.locator("button[aria-expanded]");
  const rows = downloads.locator("li[data-download-id]");
  const initialBounds = await downloads.boundingBox();
  assert.ok(initialBounds && initialBounds.width > 0);
  const layout = [{ state: "all-records", ...initialBounds }];
  const stableLayout = async (state) => {
    const bounds = await downloads.boundingBox();
    assert.ok(bounds);
    layout.push({ state, ...bounds });
    assert.ok(
      Math.abs(bounds.x - initialBounds.x) < 1 &&
        Math.abs(bounds.width - initialBounds.width) < 1,
      `Download layout shifted horizontally in ${state}: x/width ${initialBounds.x}/${initialBounds.width} -> ${bounds.x}/${bounds.width}`,
    );
  };
  const visibleIds = () =>
    rows.evaluateAll((items) =>
      items
        .filter((item) => item.checkVisibility())
        .map((item) => item.getAttribute("data-download-id")),
    );
  const focused = (target) =>
    target.evaluate((element) => element === document.activeElement);
  const groupExpanded = async (expanded) => {
    await waitFor(
      () => groups.first().getAttribute("aria-expanded"),
      (value) => value === String(expanded),
      `Download date group did not become ${expanded ? "expanded" : "collapsed"}`,
    );
  };
  const typeQuery = async (text) => {
    await search.press("ControlOrMeta+A");
    if (text) await search.pressSequentially(text);
    else await search.press("Backspace");
  };
  const waitMatch = (id) =>
    waitFor(
      visibleIds,
      (ids) => ids.length === 1 && ids[0] === id,
      "A matching download was hidden by another search's date-group choice",
    );
  assert.equal(await focused(search), true);
  assert.equal(await groups.count(), 1);
  await search.press("Tab");
  assert.equal(await focused(groups.first()), true);
  await groups.first().press("Enter");
  await groupExpanded(false);
  assert.deepEqual(await visibleIds(), []);
  await groups.first().press("Shift+Tab");
  assert.equal(await focused(search), true);
  await typeQuery(entries[0].filename);
  await waitMatch(entries[0].id);
  await groupExpanded(true);
  await stableLayout("filename-match");
  await capture("search-keyboard-filename");
  await search.press("Tab");
  assert.equal(await focused(groups.first()), true);
  await groups.first().press("Space");
  await groupExpanded(false);
  assert.deepEqual(await visibleIds(), []);
  await groups.first().press("Shift+Tab");
  assert.equal(await focused(search), true);
  await typeQuery(entries[1].url);
  await waitMatch(entries[1].id);
  await groupExpanded(true);
  await stableLayout("url-match");
  await capture("search-keyboard-url");
  await typeQuery(`no-match-${entries[0].id}`);
  await downloads
    .getByRole("status")
    .filter({ hasText: label("noResults") })
    .waitFor({ state: "visible" });
  assert.deepEqual(await visibleIds(), []);
  assert.equal(await focused(search), true);
  await stableLayout("no-results");
  await capture("search-keyboard-no-results");
  await typeQuery("");
  const restored = await waitFor(
    visibleIds,
    (ids) =>
      ids.length === entries.length &&
      entries.every((entry) => ids.includes(entry.id)),
    "Clearing search did not restore the expanded original native records",
  );
  await groupExpanded(true);
  await stableLayout("cleared-search");
  await capture("search-keyboard-restored");
  return {
    input:
      "Playwright locator keyboard against real Electron; no physical input claim",
    initialSearchFocus: true,
    tabSkipsDisabledClear: true,
    enterCollapsesGroup: true,
    spaceCollapsesGroup: true,
    shiftTabReturnsToSearch: true,
    filenameQueryShowsMatch: true,
    urlQueryShowsMatch: true,
    collapsedStateDoesNotLeakBetweenSearches: true,
    noResultsVisible: true,
    clearedSearchRestoresNativeIds: restored,
    layout,
    generatedDownloadRecords: false,
  };
}
