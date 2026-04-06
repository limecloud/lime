import { describe, expect, it } from "vitest";
import {
  extractStyleActionContent,
  resolveStyleActionFileName,
} from "./styleRuntime";

describe("styleRuntime", () => {
  it("有选中文件内容时应优先使用该文件作为风格重写目标", () => {
    const result = extractStyleActionContent({
      activeTheme: "general",
      generalCanvasState: {
        type: "document",
        filename: "general.md",
        content: "通用画布内容",
        selectedText: "",
        title: "",
        lastModified: Date.now(),
      },
      resolvedCanvasState: {
        type: "document",
        content: "画布正文",
        versions: [],
        currentVersionId: undefined,
      },
      taskFiles: [
        {
          id: "file-1",
          name: "final-article.md",
          type: "document",
          content: "任务文件正文",
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      selectedFileId: "file-1",
    } as any);

    expect(result).toBe("任务文件正文");
  });

  it("应优先返回当前选中文件名", () => {
    const result = resolveStyleActionFileName({
      activeTheme: "general",
      generalCanvasState: {
        type: "document",
        filename: "general.md",
        content: "",
        selectedText: "",
        title: "",
        lastModified: Date.now(),
      },
      resolvedCanvasState: {
        type: "document",
        content: "画布正文",
        versions: [],
        currentVersionId: undefined,
      },
      taskFiles: [
        {
          id: "file-1",
          name: "final-article.md",
          type: "document",
          content: "任务文件正文",
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      selectedFileId: "file-1",
    } as any);

    expect(result).toBe("final-article.md");
  });

  it("未选中文件时应回退到当前通用画布内容", () => {
    const result = extractStyleActionContent({
      activeTheme: "general",
      generalCanvasState: {
        type: "document",
        filename: "general.md",
        content: "通用画布内容",
        selectedText: "",
        title: "",
        lastModified: Date.now(),
      },
      resolvedCanvasState: {
        type: "document",
        content: "画布正文",
        versions: [],
        currentVersionId: undefined,
      },
      taskFiles: [],
    } as any);

    expect(result).toBe("通用画布内容");
  });
});
