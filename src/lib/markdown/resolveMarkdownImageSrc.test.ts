import { describe, expect, it, vi } from "vitest";
import { resolveMarkdownImageSrc } from "./resolveMarkdownImageSrc";

vi.mock("@/lib/api/fileSystem", () => ({
  convertLocalFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

describe("resolveMarkdownImageSrc", () => {
  it("应把相对图片路径解析为基于 Markdown 文件的本地资源", () => {
    expect(
      resolveMarkdownImageSrc(
        "images/hero.png",
        "/Users/coso/.proxycast/projects/default/exports/x-article/google/index.md",
      ),
    ).toBe(
      "asset:///Users/coso/.proxycast/projects/default/exports/x-article/google/images/hero.png",
    );
  });

  it("应归一化 ./ 和 ../ 相对路径并保留查询串与 hash", () => {
    expect(
      resolveMarkdownImageSrc(
        "./images/../images/hero.png?raw=1#preview",
        "/Users/coso/.proxycast/projects/default/exports/x-article/google/nested/index.md",
      ),
    ).toBe(
      "asset:///Users/coso/.proxycast/projects/default/exports/x-article/google/nested/images/hero.png?raw=1#preview",
    );
  });

  it("绝对路径图片应直接转成本地资源地址", () => {
    expect(
      resolveMarkdownImageSrc("/Users/coso/demo/assets/cover.png#hero"),
    ).toBe("asset:///Users/coso/demo/assets/cover.png#hero");
  });
});
