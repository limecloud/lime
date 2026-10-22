import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { createPreviewArtifactFromFile } from "@/lib/artifact/previewArtifact";
import { ArtifactRenderer } from "../ArtifactRenderer";
import { resolveFilePreviewTarget } from "../../agent/chat/workspace/filePreviewTarget";
import { FilePreviewPanel } from "@/components/agent/chat/workspace/FilePreviewPanel";
import { resolveFilePreviewModeState } from "../../agent/chat/workspace/filePreviewModel";
import type { CanvasWorkbenchResolvedSelection } from "@/components/agent/chat/components/CanvasWorkbenchLayoutViewModel";

vi.mock("./PdfPreviewPanel", () => ({
  PdfPreviewPanel: ({ path, title }: { path: string; title: string }) => (
    <section data-testid="real-pdf-dispatch" data-path={path}>
      {title}
    </section>
  ),
}));

vi.mock("./DocxPreviewPanel", () => ({
  DocxPreviewPanel: ({ path, title }: { path: string; title: string }) => (
    <section data-testid="real-docx-dispatch" data-path={path}>
      {title}
    </section>
  ),
}));

vi.mock("../workbook/WorkbookPanel", () => ({
  WorkbookPanel: ({ path, title }: { path: string; title: string }) => (
    <section data-testid="real-xlsx-dispatch" data-path={path}>
      {title}
    </section>
  ),
}));

const cleanups: (() => void)[] = [];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const copy = {
  workspaceFile: {
    readFailed: "read failed",
    binaryUnsupported: "binary unsupported",
  },
};

describe("Files 媒体与二进制分发", () => {
  it.each([
    ["png", "img"],
    ["wav", "audio"],
    ["mp4", "video"],
  ])(
    "%s 使用原路径的真实媒体renderer，不进入文本或不可用面",
    async (format, tag) => {
      const filePath = `/workspace/media/report.${format}`;
      const target = resolveFilePreviewTarget(
        {
          path: filePath,
          title: `report.${format}`,
          status: "binary",
          content: "",
        },
        copy,
      );
      const context = {
        title: `report.${format}`,
        content: "",
        selectionPath: filePath,
        target,
      } as CanvasWorkbenchResolvedSelection;
      const modeState = resolveFilePreviewModeState(context);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
      });
      await act(async () => {
        root.render(
          <FilePreviewPanel
            context={context}
            mode={modeState.defaultMode}
            modeState={modeState}
            onSelectMode={vi.fn()}
            translate={(key) => key}
          />,
        );
      });
      expect(container.querySelector(tag)).not.toBeNull();
      expect(container.querySelector(tag)?.getAttribute("src")).toContain(
        "report.",
      );
      expect(container.querySelector("textarea")).toBeNull();
      expect(
        container.querySelector(
          '[data-testid="preview-artifact-fallback-surface"]',
        ),
      ).toBeNull();
    },
  );
});

describe.each(["pdf", "docx", "xlsx"])("%s 的两条真实组件分发", (format) => {
  it("空正文的会话文件进入页面面板而非空文档或系统打开", async () => {
    await changeLimeLocale("zh-CN");
    const { artifact } = createPreviewArtifactFromFile({
      filePath: `/tmp/report.${format}`,
      isBinary: true,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    await act(async () => {
      root.render(<ArtifactRenderer artifact={artifact} />);
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector(`[data-testid=real-${format}-dispatch]`),
      ).not.toBeNull(),
    );
    expect(
      container
        .querySelector(`[data-testid=real-${format}-dispatch]`)
        ?.getAttribute("data-path"),
    ).toBe(`/tmp/report.${format}`);
    expect(
      container.querySelector("[data-testid=artifact-empty-surface]"),
    ).toBeNull();
    expect(
      container.querySelector(
        "[data-testid=preview-artifact-fallback-surface]",
      ),
    ).toBeNull();
  });

  it.each(["binary", "ready"] as const)(
    "文件树 %s 选择进入同一页面面板",
    async (status) => {
      const target = resolveFilePreviewTarget(
        {
          path: `/workspace/report.${format}`,
          title: `report.${format}`,
          status,
          content: "# Extracted document text",
        },
        copy,
      );
      expect(target.kind).toBe("synthetic-artifact");
      const context = {
        title: `report.${format}`,
        content: "# Extracted document text",
        selectionPath: `/workspace/report.${format}`,
        target,
      } as CanvasWorkbenchResolvedSelection;
      const modeState = resolveFilePreviewModeState(context);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
      });
      await act(async () =>
        root.render(
          <FilePreviewPanel
            context={context}
            mode="markdown"
            modeState={modeState}
            translate={(key) => key}
          />,
        ),
      );
      await vi.waitFor(() =>
        expect(
          container.querySelector(`[data-testid=real-${format}-dispatch]`),
        ).not.toBeNull(),
      );
      expect(
        container.querySelector("[data-testid=file-preview-markdown]"),
      ).toBeNull();
      expect(
        container.querySelector("[data-testid=file-preview-mode-toggle]"),
      ).toBeNull();
    },
  );

  it("文件树读取错误保留失败终态，不以后缀强行恢复", () => {
    expect(
      resolveFilePreviewTarget(
        {
          path: `/workspace/private.${format}`,
          title: `private.${format}`,
          status: "binary",
          error: "Access denied",
        },
        copy,
      ),
    ).toMatchObject({ kind: "unsupported", reason: "Access denied" });
  });
});
