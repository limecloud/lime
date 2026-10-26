import assert from "node:assert/strict";
import { test } from "node:test";
import { wpsFixtureAdapter } from "./computer-use-wps-adapter.mjs";

const title = "wps-live.xlsx";
const native = {
  type: "native",
  appId: "com.kingsoft.wpsoffice.mac",
  processId: 123,
  windowId: "456",
  title,
};
const office = {
  type: "office",
  host: "WPS",
  workbookName: title,
  workbookId: "workbook-123",
  sessionId: "session-456",
};

test("native scenario excludes Office and rejects incomplete or different native targets", () => {
  const adapter = wpsFixtureAdapter("native");
  assert.deepEqual(adapter.features, {
    computer_use: true,
    chrome_use: false,
    office_use: false,
  });
  const decoys = [
    office,
    { ...native, appId: "another.application" },
    { ...native, title: "user.xlsx" },
    ...[0, -1, undefined, "123"].map((processId) => ({ ...native, processId })),
    ...["", undefined].map((windowId) => ({ ...native, windowId })),
  ];
  assert.equal(adapter.selectTarget(decoys, title), undefined);
  assert.equal(adapter.selectTarget([...decoys, native], title), native);
  assert.throws(
    () =>
      adapter.selectTarget([native, { ...native, windowId: "other" }], title),
    /ambiguous/,
  );
});

test("Office scenario requires an exact independent workbook session and excludes native", () => {
  const adapter = wpsFixtureAdapter();
  assert.deepEqual(adapter.features, {
    computer_use: false,
    chrome_use: false,
    office_use: true,
  });
  const decoys = [
    native,
    { ...office, host: "Excel" },
    { ...office, workbookName: "user.xlsx" },
    { ...office, workbookId: "" },
    { ...office, sessionId: undefined },
  ];
  assert.equal(adapter.selectTarget(decoys, title), undefined);
  assert.equal(adapter.selectTarget([...decoys, office], title), office);
  assert.throws(
    () =>
      adapter.selectTarget([office, { ...office, sessionId: "other" }], title),
    /ambiguous/,
  );
  assert.throws(() => wpsFixtureAdapter("chrome"), /supported/);
});
