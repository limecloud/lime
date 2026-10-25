import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { analyzeChromeExtensionWorkflowReport } from "./i18n-chrome-extension-workflow-report";

it("keeps five complete locales on the new Native Messaging entry", () => {
  const report = analyzeChromeExtensionWorkflowReport();
  expect(report.issues).toEqual([]);
  expect(report.locales.map((entry) => entry.locale)).toEqual([
    "en",
    "zh_CN",
    "zh_TW",
    "ja",
    "ko",
  ]);
});
it("detects missing translations and restored legacy code", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lime-chrome-locale-"));
  try {
    fs.cpSync("extensions/lime-chrome", root, { recursive: true });
    fs.writeFileSync(path.join(root, "_locales/ja/messages.json"), "{}");
    fs.writeFileSync(path.join(root, "background.js"), "");
    const report = analyzeChromeExtensionWorkflowReport({
      extensionRoot: root,
    });
    expect(report.decision.status).toBe("required");
    expect(report.issues).toContain("ja: locale keys differ");
    expect(report.issues).toContain(
      "Retired extension surface exists: background.js",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
