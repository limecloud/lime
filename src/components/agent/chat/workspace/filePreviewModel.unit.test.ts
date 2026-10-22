import { describe, expect, it, vi } from "vitest";
import type { Artifact } from "@/lib/artifact/types";
import { type FilePreviewContext } from "./filePreviewTarget";

import {
  resolveHtmlPreviewFrameState,
  resolvePreferredFilePreviewMode,
  resolveFilePreviewModeState,
} from "./filePreviewModel";

function createSelection(
  overrides: Partial<FilePreviewContext>,
): FilePreviewContext {
  return {
    title: "README.md",

    target: {
      kind: "text",
      title: "README.md",
      content: "# 标题",
      filePath: "/workspace/README.md",
      absolutePath: "/workspace/README.md",
    },
    content: "# 标题",

    selectionPath: "/workspace/README.md",
    ...overrides,
  };
}

function createArtifact(type: Artifact["type"], language = ""): Artifact {
  return {
    id: "artifact-1",
    type,
    title: "index.html",
    content: "<!doctype html><html><body>OK</body></html>",
    status: "complete",
    meta: { language },
    position: { start: 0, end: 0 },
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("filePreviewModel", () => {
  it("应按 Markdown 文件启用 Markdown 与 Code 模式", () => {
    const state = resolveFilePreviewModeState(
      createSelection({
        selectionPath: "/workspace/docs/README.md",
        title: "README.md",
      }),
    );

    expect(state.defaultMode).toBe("markdown");
    expect(state.language).toBe("markdown");
    expect(state.modes.markdown.enabled).toBe(true);
    expect(state.modes.html.enabled).toBe(false);
    expect(state.modes.code.enabled).toBe(true);
  });

  it("应按 HTML 文件或内容启用 HTML 与 Code 模式", () => {
    const state = resolveFilePreviewModeState(
      createSelection({
        selectionPath: "/workspace/index.html",
        title: "index.html",
        content: "<html><body>OK</body></html>",
      }),
    );

    expect(state.defaultMode).toBe("html");
    expect(state.language).toBe("html");
    expect(state.modes.markdown.enabled).toBe(false);
    expect(state.modes.html.enabled).toBe(true);
    expect(state.modes.code.enabled).toBe(true);
  });

  it("应按代码扩展名默认进入 Code 模式", () => {
    const state = resolveFilePreviewModeState(
      createSelection({
        selectionPath: "/workspace/src/App.tsx",
        title: "App.tsx",
        content: "export function App() { return null; }",
      }),
    );

    expect(state.defaultMode).toBe("code");
    expect(state.language).toBe("tsx");
    expect(state.modes.markdown.enabled).toBe(false);
    expect(state.modes.html.enabled).toBe(false);
    expect(state.modes.code.enabled).toBe(true);
  });

  it("空文本文件仍应允许 Code 模式预览", () => {
    const state = resolveFilePreviewModeState(
      createSelection({
        selectionPath: "/workspace/empty.txt",
        title: "empty.txt",
        content: "",
        target: {
          kind: "text",
          title: "empty.txt",
          content: "",
          filePath: "/workspace/empty.txt",
          absolutePath: "/workspace/empty.txt",
        },
      }),
    );

    expect(state.defaultMode).toBe("code");
    expect(state.hasContent).toBe(true);
    expect(state.modes.code.enabled).toBe(true);
  });

  it("应优先使用 artifact 类型和语言推断模式", () => {
    const state = resolveFilePreviewModeState(
      createSelection({
        title: "preview",
        selectionPath: undefined,
        target: {
          kind: "artifact",
          title: "preview",
          artifact: createArtifact("html", "html"),
        },
      }),
    );

    expect(state.defaultMode).toBe("html");
    expect(state.language).toBe("html");
    expect(state.modes.html.enabled).toBe(true);
  });

  it("路径默认模式推断应区分 Markdown、HTML 与 Code", () => {
    expect(resolvePreferredFilePreviewMode("README.md")).toBe("markdown");
    expect(resolvePreferredFilePreviewMode("index.htm")).toBe("html");
    expect(resolvePreferredFilePreviewMode("src/main.rs")).toBe("code");
  });

  it("导入 HTML 已有内容时应优先用 srcDoc，避免依赖本地文件 URL", () => {
    const resolveLocalPreviewUrl = vi.fn(
      () => "asset://local/imported-preview.html",
    );
    const state = resolveHtmlPreviewFrameState(
      createSelection({
        title: "imported-preview.html",
        selectionPath: "/tmp/imported-preview.html",
        content: "<!doctype html><html><body>导入预览</body></html>",
      }),
      resolveLocalPreviewUrl,
    );

    expect(resolveLocalPreviewUrl).not.toHaveBeenCalled();
    expect(state.src).toBeNull();
    expect(state.srcDoc).toContain("导入预览");
    expect(state.sandbox).not.toContain("allow-same-origin");
  });

  it("HTML 内容为空时才回退使用本地文件 URL", () => {
    const resolveLocalPreviewUrl = vi.fn(
      () => "asset://local/imported-preview.html",
    );
    const state = resolveHtmlPreviewFrameState(
      createSelection({
        title: "imported-preview.html",
        selectionPath: "/tmp/imported-preview.html",
        content: "",
      }),
      resolveLocalPreviewUrl,
    );

    expect(resolveLocalPreviewUrl).toHaveBeenCalledWith(
      "/tmp/imported-preview.html",
    );
    expect(state.src).toBe("asset://local/imported-preview.html");
    expect(state.srcDoc).toBeUndefined();
    expect(state.sandbox).toContain("allow-same-origin");
  });
});
