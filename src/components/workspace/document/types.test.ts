import { describe, expect, it } from "vitest";
import { createInitialDocumentState } from "./types";

describe("createInitialDocumentState", () => {
  it("应默认进入编辑模式", () => {
    const content = "# 学习计划\n\n- Go 并发";
    const state = createInitialDocumentState(content);

    expect(state.type).toBe("document");
    expect(state.content).toBe(content);
    expect(state.isEditing).toBe(true);
    expect(state.versions).toHaveLength(1);
    expect(state.currentVersionId).toBe(state.versions[0].id);
    expect(state.versions[0].content).toBe(content);
    expect(state.versions[0].description).toBe("初始版本");
  });
});
