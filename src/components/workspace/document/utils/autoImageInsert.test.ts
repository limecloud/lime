import { describe, expect, it } from "vitest";
import {
  applySectionImageAssignments,
  appendImageToMarkdown,
  buildSectionSearchQuery,
  extractLevel2Sections,
} from "./autoImageInsert";

describe("autoImageInsert", () => {
  it("应解析二级标题小节", () => {
    const markdown = `# 标题

## 第一节
内容一

## 第二节
内容二`;
    const sections = extractLevel2Sections(markdown);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("第一节");
    expect(sections[1].title).toBe("第二节");
  });

  it("应按小节插入图片并附带来源", () => {
    const markdown = `# 城市观察

## 交通
讨论交通现象

## 建筑
讨论建筑空间`;

    const next = applySectionImageAssignments(markdown, [
      {
        sectionTitle: "交通",
        image: {
          id: "img-1",
          previewUrl: "https://img.example/traffic-thumb.jpg",
          contentUrl: "https://img.example/traffic.jpg",
          pageUrl: "https://img.example/page-traffic",
          attributionName: "Pexels",
          title: "交通图",
        },
      },
    ]);

    expect(next).toContain("![交通图](https://img.example/traffic.jpg)");
    expect(next).toContain("> 图片来源：[Pexels](https://img.example/page-traffic)");
  });

  it("appendImageToMarkdown 应避免重复插入", () => {
    const base = "## 小节\n内容";
    const once = appendImageToMarkdown(base, {
      id: "img-1",
      previewUrl: "https://img.example/thumb.jpg",
      contentUrl: "https://img.example/full.jpg",
      title: "示例图",
    });
    const twice = appendImageToMarkdown(once, {
      id: "img-1",
      previewUrl: "https://img.example/thumb.jpg",
      contentUrl: "https://img.example/full.jpg",
      title: "示例图",
    });
    expect(once).toBe(twice);
  });

  it("应生成包含主题和小节的检索词", () => {
    const query = buildSectionSearchQuery("城市夜景", "交通");
    expect(query).toContain("城市夜景");
    expect(query).toContain("交通");
  });
});

