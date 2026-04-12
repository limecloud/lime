import { describe, it, expect } from "vitest";
import {
  resolveCanvasTaskFileTarget,
  shouldDeferCanvasSyncWhileEditing,
} from "./taskFileCanvasSync";

describe("taskFileCanvasSync", () => {
  it("优先保留当前选中的可渲染文件", () => {
    const files = [
      {
        id: "older",
        name: "draft.md",
        content: "old",
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: "latest",
        name: "index.md",
        content: "new",
        createdAt: 20,
        updatedAt: 20,
      },
    ];

    expect(resolveCanvasTaskFileTarget(files, "older")).toEqual({
      targetFile: files[0],
      nextSelectedFileId: null,
    });
  });

  it("未选中文件时回退到最新文件", () => {
    const files = [
      {
        id: "first",
        name: "draft.md",
        content: "first",
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: "second",
        name: "index.md",
        content: "second",
        createdAt: 15,
        updatedAt: 30,
      },
    ];

    expect(resolveCanvasTaskFileTarget(files)).toEqual({
      targetFile: files[1],
      nextSelectedFileId: "second",
    });
  });

  it("未选中文件时应优先真正的主稿而不是 Agents.md", () => {
    const files = [
      {
        id: "agents",
        name: "exports/x-article-export/latest/Agents.md",
        content: "# Agents",
        createdAt: 40,
        updatedAt: 40,
      },
      {
        id: "index",
        name: "exports/x-article-export/latest/index.md",
        content: "# 正文",
        createdAt: 10,
        updatedAt: 10,
      },
    ];

    expect(resolveCanvasTaskFileTarget(files)).toEqual({
      targetFile: files[1],
      nextSelectedFileId: "index",
    });
  });

  it("编辑器聚焦时延后文档画布同步", () => {
    expect(
      shouldDeferCanvasSyncWhileEditing({
        canvasType: "document",
        editorFocused: true,
      }),
    ).toBe(true);

    expect(
      shouldDeferCanvasSyncWhileEditing({
        canvasType: "video",
        editorFocused: true,
      }),
    ).toBe(false);
  });
});
