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
        content: "old",
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: "latest",
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
        content: "first",
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: "second",
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
