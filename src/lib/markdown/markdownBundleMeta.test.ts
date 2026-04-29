import { describe, expect, it } from "vitest";
import {
  parseMarkdownBundleImageOverrides,
  resolveMarkdownBundleMetaPath,
} from "./markdownBundleMeta";

describe("markdownBundleMeta", () => {
  it("应从 Markdown 文件路径解析同目录 meta.json", () => {
    expect(
      resolveMarkdownBundleMetaPath(
        "/Users/coso/.lime/projects/default/exports/x-article/google/index.md",
      ),
    ).toBe(
      "/Users/coso/.lime/projects/default/exports/x-article/google/meta.json",
    );
  });

  it("应优先使用图片记录中的 markdown_path", () => {
    expect(
      parseMarkdownBundleImageOverrides(
        JSON.stringify({
          markdown_relative_path: "exports/x-article/google/index.md",
          images: [
            {
              original_url: "https://cdn.example.com/hero.png",
              markdown_path: "images/hero.png",
            },
          ],
        }),
      ),
    ).toEqual({
      "https://cdn.example.com/hero.png": "images/hero.png",
    });
  });

  it("缺少 markdown_path 时应根据 project_relative_path 计算相对路径", () => {
    expect(
      parseMarkdownBundleImageOverrides(
        JSON.stringify({
          markdown_relative_path: "exports/x-article/google/index.md",
          images: [
            {
              original_url: "https://cdn.example.com/hero.png",
              project_relative_path: "exports/x-article/google/images/hero.png",
            },
          ],
        }),
      ),
    ).toEqual({
      "https://cdn.example.com/hero.png": "images/hero.png",
    });
  });

  it("非法元数据应静默降级为空映射", () => {
    expect(parseMarkdownBundleImageOverrides("{invalid-json")).toEqual({});
  });
});
