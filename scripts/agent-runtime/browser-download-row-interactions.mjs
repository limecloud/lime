import assert from "node:assert/strict";

/** Inspect real layout and native button semantics without replacing actions. */
export async function inspectBrowserDownloadRow({
  row,
  entry,
  open,
  missingLabel,
}) {
  const bounds = await row.boundingBox();
  assert.ok(bounds);
  const filename = row.getByText(entry.filename, { exact: true });
  const filenameBounds = await filename.boundingBox();
  assert.ok(filenameBounds);
  assert.equal((await row.innerText()).includes(entry.url), false);
  if (entry.fileExists) {
    assert.equal(await open.count(), 1);
    const openBounds = await open.boundingBox();
    assert.ok(openBounds);
    for (const key of ["x", "y", "width", "height"])
      assert.ok(
        Math.abs(bounds[key] - openBounds[key]) <= 1,
        `Open action does not cover the download row: ${JSON.stringify({ bounds, openBounds })}`,
      );
    assert.equal(await open.locator("button").count(), 0);
    return { row: bounds, open: openBounds, filename: filenameBounds };
  }
  assert.equal(await open.count(), 0);
  const missing = await row
    .getByText(missingLabel, { exact: true })
    .boundingBox();
  assert.ok(missing);
  assert.ok(
    Math.abs(missing.y - filenameBounds.y) < 2,
    "Missing-file status is not on the filename line",
  );
  assert.ok(
    missing.x >= filenameBounds.x + filenameBounds.width,
    "Missing-file status overlaps the filename",
  );
  assert.ok(
    missing.x + missing.width <= bounds.x + bounds.width,
    "Missing-file status overflows the download row",
  );
  const time = await row.locator("time").boundingBox();
  assert.ok(time);
  assert.ok(
    missing.x + missing.width <= time.x,
    "Missing-file status overlaps trailing controls",
  );
  return { row: bounds, open: null, filename: filenameBounds, missing };
}
