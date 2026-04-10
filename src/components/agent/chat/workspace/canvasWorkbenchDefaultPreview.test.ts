import { describe, expect, it } from "vitest";
import { buildCanvasWorkbenchDefaultPreview } from "./canvasWorkbenchDefaultPreview";

describe("canvasWorkbenchDefaultPreview", () => {
  it("通用工作区真实文件预览应生成稳定的默认 selectionKey", () => {
    const preview = buildCanvasWorkbenchDefaultPreview({
      workspaceRoot: "/workspace",
      canvasRenderTheme: "general",
      generalCanvasState: {
        isOpen: true,
        content: "# 标题\n\n正文",
        filename: "exports/x-article-export/latest/index.md",
      },
      resolvedCanvasState: null,
      activeCanvasTaskFile: null,
    });

    expect(preview).toEqual(
      expect.objectContaining({
        selectionKey:
          "default-preview:exports/x-article-export/latest/index.md",
        title: "index.md",
        filePath: "exports/x-article-export/latest/index.md",
        absolutePath: "/workspace/exports/x-article-export/latest/index.md",
      }),
    );
  });
});
