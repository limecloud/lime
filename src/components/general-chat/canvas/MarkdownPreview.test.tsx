import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

const mockConvertLocalFileSrc = vi.fn((path: string) => `asset://${path}`);

vi.mock("react-syntax-highlighter", () => ({
  Prism: ({ children }: { children: React.ReactNode }) => (
    <pre data-testid="syntax-highlighter">
      <code>{children}</code>
    </pre>
  ),
}));

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
  oneDark: { __theme: "dark" },
  oneLight: { __theme: "light" },
}));

vi.mock(
  "@/components/agent/chat/components/ArtifactPlaceholder",
  () => ({
    ArtifactPlaceholder: ({ language }: { language: string }) => (
      <div data-testid="artifact-placeholder">{language}</div>
    ),
  }),
);

vi.mock("@/components/agent/chat/components/A2UITaskCard", () => ({
  A2UITaskCard: () => <div data-testid="a2ui-task-card" />,
  A2UITaskLoadingCard: () => <div data-testid="a2ui-task-loading-card" />,
}));

vi.mock("@/lib/api/fileSystem", () => ({
  convertLocalFileSrc: (path: string) => mockConvertLocalFileSrc(path),
}));

interface MountedPreview {
  container: HTMLDivElement;
  root: Root;
}

const mountedPreviews: MountedPreview[] = [];

function renderPreview(props: React.ComponentProps<typeof MarkdownPreview>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<MarkdownPreview {...props} />);
  });

  mountedPreviews.push({ container, root });
  return container;
}

describe("MarkdownPreview", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(() => {
    while (mountedPreviews.length > 0) {
      const mounted = mountedPreviews.pop();
      if (!mounted) {
        continue;
      }
      act(() => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("应将 Markdown 相对图片路径解析为本地资源地址", () => {
    const container = renderPreview({
      content:
        "[![图像](images/image-1.jpg)](https://example.com/full-image)\n\n正文",
      baseFilePath:
        "/Users/coso/Library/Application Support/lime/projects/default/exports/x-article-export/demo/index.md",
    });

    const image = container.querySelector("img");
    const link = container.querySelector("a");

    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/Library/Application Support/lime/projects/default/exports/x-article-export/demo/images/image-1.jpg",
    );
    expect(link?.getAttribute("href")).toBe("https://example.com/full-image");
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/Library/Application Support/lime/projects/default/exports/x-article-export/demo/images/image-1.jpg",
    );
  });
});
