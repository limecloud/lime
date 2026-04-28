import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  countPreviewSearchMatches,
  normalizePreviewSearchQuery,
  renderHighlightedPreviewText,
} from "./resourcePreviewSearch";

describe("resourcePreviewSearch", () => {
  it("应裁剪查询并忽略空查询", () => {
    expect(normalizePreviewSearchQuery("  alpha  ")).toBe("alpha");
    expect(countPreviewSearchMatches("alpha alpha", "   ")).toBe(0);
  });

  it("应按字面量查找特殊字符并忽略大小写", () => {
    expect(countPreviewSearchMatches("a+b A+B a-b", "a+b")).toBe(2);
    expect(countPreviewSearchMatches("[tag] [TAG] tag", "[tag]")).toBe(2);
  });

  it("应给当前命中加 active 标记", () => {
    const markup = renderToStaticMarkup(
      <>
        {renderHighlightedPreviewText("alpha beta alpha", "alpha", {
          activeIndex: 1,
        })}
      </>,
    );
    const hits = markup.match(/data-testid="resource-preview-search-hit"/g);

    expect(hits).toHaveLength(2);
    expect(markup).toContain('data-resource-preview-search-active="true"');
  });
});
