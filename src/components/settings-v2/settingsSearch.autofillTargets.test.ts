import { describe, expect, it } from "vitest";
import { settingsSearchDocuments } from "./settingsSearchDocuments";

const expected = [
  "browser-password-manager",
  "browser-contact-info",
  "app-snapshots-shortcut",
  "app-snapshots-target",
  "app-snapshots-sound",
  "app-snapshots-accessibility",
  "browser-site-settings",
  "browser-extension-manager",
];

describe("settings search targets for browser autofill/snapshots/ssh", () => {
  it.each(expected)("%s is searchable", (targetId) => {
    const document = settingsSearchDocuments.find(
      (entry) => entry.targetId === targetId,
    );
    expect(document).toBeDefined();
    expect(document?.labelKey).toBeTruthy();
    expect(document?.termKeys.length).toBeGreaterThan(0);
  });
});
