import { describe, expect, it } from "vitest";
import {
  applySectionImageAssignments,
  appendImageToMarkdown,
  buildSectionSearchQuery,
  extractLevel2Sections,
  insertMarkdownBlock,
  resolveSectionTitleForSelection,
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
    expect(next).toContain(
      "> 图片来源：[Pexels](https://img.example/page-traffic)",
    );
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

  it("应根据选中文本推断所属小节", () => {
    const markdown = `# 城市观察

## 交通
讨论交通现象

## 建筑
讨论建筑空间`;

    expect(resolveSectionTitleForSelection(markdown, "讨论建筑空间")).toBe(
      "建筑",
    );
  });

  it("insertMarkdownBlock 应优先插入到目标小节而不是文末", () => {
    const markdown = `# 城市观察

## 交通
讨论交通现象

## 建筑
讨论建筑空间`;

    const next = insertMarkdownBlock(
      markdown,
      ["![建筑配图](https://img.example/building.jpg)"],
      { sectionTitle: "建筑" },
    );

    expect(next.indexOf("## 建筑")).toBeLessThan(
      next.indexOf("https://img.example/building.jpg"),
    );
    expect(next.indexOf("https://img.example/building.jpg")).toBeLessThan(
      next.lastIndexOf("讨论建筑空间"),
    );
  });

  it("insertMarkdownBlock 应优先插入到选中文本所在段落之后", () => {
    const markdown = `# 城市观察

## 建筑
第一段介绍城市天际线。

这里是被选中的关键段落，用于说明核心建筑特征。

最后一段补充材料。`;

    const next = insertMarkdownBlock(
      markdown,
      ["![建筑配图](https://img.example/building-closeup.jpg)"],
      {
        sectionTitle: "建筑",
        anchorText: "这里是被选中的关键段落，用于说明核心建筑特征。",
      },
    );

    expect(next.indexOf("关键段落")).toBeLessThan(
      next.indexOf("https://img.example/building-closeup.jpg"),
    );
    expect(next.indexOf("https://img.example/building-closeup.jpg")).toBeLessThan(
      next.indexOf("最后一段补充材料"),
    );
  });

  it("应生成包含主题和小节的检索词", () => {
    const query = buildSectionSearchQuery("城市夜景", "交通");
    expect(query).toContain("城市夜景");
    expect(query).toContain("交通");
  });
});
