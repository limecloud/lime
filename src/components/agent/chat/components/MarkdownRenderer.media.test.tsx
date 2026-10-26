import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  getMarkdownRendererMocks,
  mockConvertLocalFileSrc,
  renderMarkdown as render,
} from "./MarkdownRenderer.testHarness";

const markdownRendererMocks = getMarkdownRendererMocks();

describe("MarkdownRenderer media and links", () => {
  it("base64 图片说明文案应保持精简中文", () => {
    const content = "![示例图](data:image/png;base64,ZmFrZQ==)";

    const container = render(content);

    expect(container.textContent).toContain("图片 点击查看大图");
  });

  it("markdown 图片加载失败时不应暴露 alt 文本", () => {
    const container = render("![image](https://cdn.example.com/missing.png)");
    const image = container.querySelector("img");

    expect(image).not.toBeNull();

    act(() => {
      image?.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-testid="markdown-image-unavailable"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="markdown-image-block"]')
        ?.getAttribute("data-markdown-image-src"),
    ).toBe("https://cdn.example.com/missing.png");
    expect(container.textContent).toContain("图片暂时无法显示");
    expect(container.textContent).not.toContain("image");
  });

  it("http/https 链接应交给系统浏览器而不是当前 WebView", async () => {
    const container = render("[Node.js](https://nodejs.org)");
    const link = container.querySelector("a");

    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://nodejs.org");
    expect(link?.getAttribute("rel")).toBe("noreferrer noopener");

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      link?.dispatchEvent(clickEvent);
      await Promise.resolve();
    });

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(
      markdownRendererMocks.openExternalUrlWithSystemBrowser,
    ).toHaveBeenCalledWith(
      "https://nodejs.org",
    );
  });

  it("非 http/https 链接不应触发系统浏览器打开", () => {
    const container = render("[章节](#install)");
    const link = container.querySelector("a");
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });

    link?.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(false);
    expect(
      markdownRendererMocks.openExternalUrlWithSystemBrowser,
    ).not.toHaveBeenCalled();
  });

  it("带 baseFilePath 时应把相对图片路径解析为本地文件资源", () => {
    const container = render("![配图](images/hero.png)", {
      baseFilePath:
        "/Users/coso/.proxycast/projects/default/exports/x-article/google/index.md",
    });

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/.proxycast/projects/default/exports/x-article/google/images/hero.png",
    );
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/.proxycast/projects/default/exports/x-article/google/images/hero.png",
    );
  });

  it("file 图片地址应直接用于 markdown 图片渲染", () => {
    const container = render("![配图](file:///tmp/lime/inline-image.png)", {
      baseFilePath: "/Users/coso/.lime/projects/default/article.md",
    });

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).not.toHaveBeenCalled();
    expect(image?.getAttribute("src")).toBe(
      "file:///tmp/lime/inline-image.png",
    );
    expect(image?.getAttribute("data-markdown-image-src")).toBe(
      "file:///tmp/lime/inline-image.png",
    );
  });

  it("应通过同目录 meta.json 将远程图片替换为本地下载资源", async () => {
    markdownRendererMocks.readFilePreview.mockResolvedValue({
      path: "/Users/coso/.lime/projects/default/exports/x-article/google/meta.json",
      content: JSON.stringify({
        markdown_relative_path: "exports/x-article/google/index.md",
        images: [
          {
            original_url: "https://cdn.example.com/hero.png",
            markdown_path: "images/hero.png",
          },
        ],
      }),
      isBinary: false,
      size: 160,
      error: null,
    });

    const container = render("![配图](https://cdn.example.com/hero.png)", {
      baseFilePath:
        "/Users/coso/.lime/projects/default/exports/x-article/google/index.md",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(markdownRendererMocks.readFilePreview).toHaveBeenCalledWith(
      "/Users/coso/.lime/projects/default/exports/x-article/google/meta.json",
      64 * 1024,
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/.lime/projects/default/exports/x-article/google/images/hero.png",
    );
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/.lime/projects/default/exports/x-article/google/images/hero.png",
    );
  });

  it("http/https 图片点击应交给系统浏览器 current 网关", async () => {
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);

    try {
      const container = render("![远程图](https://cdn.example.com/hero.png)");
      const image = container.querySelector("img");

      expect(image).not.toBeNull();

      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });

      await act(async () => {
        image?.dispatchEvent(clickEvent);
        await Promise.resolve();
      });

      expect(clickEvent.defaultPrevented).toBe(true);
      expect(
        markdownRendererMocks.openExternalUrlWithSystemBrowser,
      ).toHaveBeenCalledWith(
        "https://cdn.example.com/hero.png",
      );
      expect(windowOpen).not.toHaveBeenCalled();
    } finally {
      windowOpen.mockRestore();
    }
  });

  it("Desktop Host 下 base64 图片点击不应回退 window.open", () => {
    markdownRendererMocks.hasDesktopHostRuntimeMarkers.mockReturnValue(true);
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const container = render("![示例图](data:image/png;base64,ZmFrZQ==)");
      const image = container.querySelector("img");

      expect(image).not.toBeNull();

      image?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(windowOpen).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "[MarkdownRenderer] Desktop Host image preview cannot fall back to browser window",
        "data:image/png;base64,ZmFrZQ==",
      );
    } finally {
      windowOpen.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("Desktop Host 下本地图片点击不应回退 window.open", () => {
    markdownRendererMocks.hasDesktopHostInvokeCapability.mockReturnValue(true);
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const container = render("![配图](images/hero.png)", {
        baseFilePath:
          "/Users/coso/.proxycast/projects/default/exports/x-article/google/index.md",
      });
      const image = container.querySelector("img");
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });

      expect(image).not.toBeNull();

      image?.dispatchEvent(clickEvent);

      expect(clickEvent.defaultPrevented).toBe(true);
      expect(windowOpen).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "[MarkdownRenderer] Desktop Host image preview cannot fall back to browser window",
        "asset:///Users/coso/.proxycast/projects/default/exports/x-article/google/images/hero.png",
      );
    } finally {
      windowOpen.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("Desktop Host 下绝对路径图片点击不应回退 window.open", () => {
    markdownRendererMocks.hasDesktopHostRuntimeMarkers.mockReturnValue(true);
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const container = render("![配图](/tmp/project/assets/cover.png)");
      const image = container.querySelector("img");
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });

      expect(image).not.toBeNull();

      image?.dispatchEvent(clickEvent);

      expect(clickEvent.defaultPrevented).toBe(true);
      expect(windowOpen).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "[MarkdownRenderer] Desktop Host image preview cannot fall back to browser window",
        "asset:///tmp/project/assets/cover.png",
      );
    } finally {
      windowOpen.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("非 Desktop Host 下本地图片点击保留浏览器预览", () => {
    const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);

    try {
      const container = render("![配图](images/hero.png)", {
        baseFilePath:
          "/Users/coso/.proxycast/projects/default/exports/x-article/google/index.md",
      });
      const image = container.querySelector("img");
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });

      expect(image).not.toBeNull();

      image?.dispatchEvent(clickEvent);

      expect(clickEvent.defaultPrevented).toBe(false);
      expect(windowOpen).toHaveBeenCalledWith(
        "asset:///Users/coso/.proxycast/projects/default/exports/x-article/google/images/hero.png",
        "_blank",
      );
    } finally {
      windowOpen.mockRestore();
    }
  });

  it("应归一化 ./ 和 ../ 相对图片路径并保留查询串", () => {
    const container = render(
      "![配图](./images/../images/hero.png?raw=1#preview)",
      {
        baseFilePath:
          "/Users/coso/.proxycast/projects/default/exports/x-article/google/nested/index.md",
      },
    );

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/.proxycast/projects/default/exports/x-article/google/nested/images/hero.png",
    );
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/.proxycast/projects/default/exports/x-article/google/nested/images/hero.png?raw=1#preview",
    );
  });

  it("绝对路径图片应复用本地资源转换并保留 hash", () => {
    const container = render("![配图](/Users/coso/demo/assets/cover.png#hero)");

    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(mockConvertLocalFileSrc).toHaveBeenCalledWith(
      "/Users/coso/demo/assets/cover.png",
    );
    expect(image?.getAttribute("src")).toBe(
      "asset:///Users/coso/demo/assets/cover.png#hero",
    );
  });
});
