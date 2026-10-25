import { act } from "react";
import { describe, expect, it } from "vitest";
import {
  getMarkdownRendererMocks,
  renderMarkdown,
  renderMarkdownHarness,
} from "./MarkdownRenderer.testHarness";

describe.each(["standard", "light"] as const)(
  "%s Markdown autolinks",
  (renderMode) => {
    it.each([
      "，",
      "。",
      "；",
      "：",
      "！",
      "？",
      "、",
      "）",
      "】",
      "》",
      "」",
      "”",
    ])(
      "keeps %s and the following sentence outside a bare URL",
      (punctuation) => {
        const content = `请打开 https://news.baidu.com/${punctuation}确认页面已加载。`;
        const container = renderMarkdown(content, { renderMode });
        const link = container.querySelector<HTMLAnchorElement>("a")!;
        expect(link.textContent).toBe("https://news.baidu.com/");
        expect(link.href).toBe("https://news.baidu.com/");
        expect(container.textContent).toBe(content);
        act(() => link.click());
        expect(
          getMarkdownRendererMocks().openExternalUrlWithSystemBrowser,
        ).toHaveBeenCalledExactlyOnceWith("https://news.baidu.com/");
      },
    );

    it("keeps Unicode paths and percent-encoded punctuation in the destination", () => {
      const url = "https://example.org/新闻/%EF%BC%8C?q=中文#详情";
      const container = renderMarkdown(`链接 ${url}，查看详情。`, {
        renderMode,
      });
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        new URL(url).href,
      );
      expect(container.querySelector("a")?.textContent).toBe(url);
    });

    it("preserves explicit links, angle autolinks and reference destinations", () => {
      const url = "https://example.org/新闻，详情";
      const content = `[${url}](${url}) <${url}> [参考][news]\n\n[news]: ${url}`;
      const container = renderMarkdown(content, { renderMode });
      expect(
        Array.from(container.querySelectorAll("a"), (link) =>
          link.getAttribute("href"),
        ),
      ).toEqual([url, url, url].map((value) => new URL(value).href));
    });

    it("does not link code or change a Skill prompt reference", () => {
      const container = renderMarkdown(
        "`https://example.org/，文本` [$review](/skills/review/SKILL.md)\n\n```text\nhttps://example.org/，文本\n```",
        { renderMode },
      );
      expect(container.querySelector("a")).toBeNull();
      expect(
        container
          .querySelector("[data-prompt-link-href]")
          ?.getAttribute("data-prompt-link-href"),
      ).toBe("/skills/review/SKILL.md");
    });

    it("uses the same boundary for nested and www links", () => {
      const container = renderMarkdown(
        "> **https://example.org/，说明**\n\n| 网站 |\n| --- |\n| www.example.org/；详情 |",
        { renderMode },
      );
      expect(
        Array.from(container.querySelectorAll("a"), (link) => link.href),
      ).toEqual(["https://example.org/", "http://www.example.org/"]);
      expect(container.textContent).toContain("，说明");
      expect(container.textContent).toContain("；详情");
    });

    it("keeps the destination and text stable when a streamed sentence arrives", () => {
      const { container, rerender } = renderMarkdownHarness(
        "https://news.baidu.com/",
        {
          renderMode,
          isStreaming: true,
        },
      );
      rerender("https://news.baidu.com/，页面已加载。", { isStreaming: false });
      expect(container.querySelector("a")?.getAttribute("href")).toBe(
        "https://news.baidu.com/",
      );
      expect(container.textContent).toBe(
        "https://news.baidu.com/，页面已加载。",
      );
    });
  },
);
