import { describe, expect, it } from "vitest";

import { resolveSearchResultPreviewItemsFromText } from "./searchResultPreview";

describe("searchResultPreview", () => {
  it("应解析 web search tool_result 里的 content 数组", () => {
    const items = resolveSearchResultPreviewItemsFromText(
      JSON.stringify({
        tool_use_id: "web_search_1",
        content: [
          {
            title: "Yahoo Mail",
            url: "https://mail.yahoo.com/",
            summary: "邮箱首页",
          },
          {
            title: "Reddit",
            url: "https://www.reddit.com/r/LocalLLaMA/",
            description: "社区讨论",
          },
        ],
      }),
    );

    expect(items).toEqual([
      {
        id: "search-record-0-https://mail.yahoo.com/",
        title: "Yahoo Mail",
        url: "https://mail.yahoo.com/",
        hostname: "mail.yahoo.com",
        snippet: "邮箱首页",
      },
      {
        id: "search-record-1-https://www.reddit.com/r/LocalLLaMA/",
        title: "Reddit",
        url: "https://www.reddit.com/r/LocalLLaMA/",
        hostname: "reddit.com",
        snippet: "社区讨论",
      },
    ]);
  });

  it("应从混合文本里的 JSON 数组提取标题而不是回退成 url 字段名", () => {
    const items = resolveSearchResultPreviewItemsFromText(`
Web search results for query: "AI Agent Twitter trending past 24 hours"

Links: [{"title":"Yahoo Mail","url":"https://mail.yahoo.com/","snippet":"邮箱首页"},{"title":"Devflokers","url":"https://devflokers.com/","summary":"行业文章"}]

REMINDER: You MUST include the sources above in your response.
    `);

    expect(items).toEqual([
      {
        id: "search-record-0-https://mail.yahoo.com/",
        title: "Yahoo Mail",
        url: "https://mail.yahoo.com/",
        hostname: "mail.yahoo.com",
        snippet: "邮箱首页",
      },
      {
        id: "search-record-1-https://devflokers.com/",
        title: "Devflokers",
        url: "https://devflokers.com/",
        hostname: "devflokers.com",
        snippet: "行业文章",
      },
    ]);
  });

  it("应兼容 locator.url 与 label 形式的来源对象", () => {
    const items = resolveSearchResultPreviewItemsFromText(
      JSON.stringify({
        sources: [
          {
            label: "Anthropic Docs",
            locator: {
              url: "https://docs.anthropic.com/en/docs",
            },
            snippet: "官方文档入口",
          },
        ],
      }),
    );

    expect(items).toEqual([
      {
        id: "search-record-0-https://docs.anthropic.com/en/docs",
        title: "Anthropic Docs",
        url: "https://docs.anthropic.com/en/docs",
        hostname: "docs.anthropic.com",
        snippet: "官方文档入口",
      },
    ]);
  });
});
