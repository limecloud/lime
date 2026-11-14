import { beforeEach, describe, expect, it } from "vitest";
import {
  getImportHistory,
  recordImport,
  resetImportHistoryForTest,
} from "./importHistory";

describe("importHistory", () => {
  beforeEach(() => resetImportHistoryForTest());

  it("records newest imports first", () => {
    recordImport({ kind: "skills", summary: "reviewer" });
    recordImport({ kind: "projects", summary: "1 project" });
    expect(getImportHistory().map((entry) => entry.kind)).toEqual([
      "projects",
      "skills",
    ]);
  });
});
