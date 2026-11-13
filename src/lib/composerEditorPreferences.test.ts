import { beforeEach, describe, expect, it } from "vitest";
import {
  getComposerEditorPreferences,
  resetComposerEditorPreferencesForTest,
  setComposerEditorPreferences,
} from "./composerEditorPreferences";

describe("composerEditorPreferences", () => {
  beforeEach(() => resetComposerEditorPreferencesForTest());

  it("defaults to rich text and persists plain text mode", () => {
    expect(getComposerEditorPreferences()).toEqual({
      plainTextEditor: false,
      followUpMode: "queue",
      defaultStandaloneChat: true,
      showContextWindowUsage: true,
    });
    setComposerEditorPreferences({
      plainTextEditor: true,
      followUpMode: "steer",
    });
    expect(getComposerEditorPreferences()).toEqual({
      plainTextEditor: true,
      followUpMode: "steer",
      defaultStandaloneChat: true,
      showContextWindowUsage: true,
    });
  });
});
