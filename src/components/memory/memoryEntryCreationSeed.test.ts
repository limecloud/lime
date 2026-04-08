import { describe, expect, it } from "vitest";
import { buildMemoryEntryCreationSeed } from "./memoryEntryCreationSeed";

describe("buildMemoryEntryCreationSeed", () => {
  it("应把风格灵感整理成可带回输入栏的骨架", () => {
    const result = buildMemoryEntryCreationSeed({
      category: "identity",
      title: "夏日短视频语气",
      summary: "适合清爽、轻快、有镜头感的小红书口播开场。",
      content: "第一句先给画面感，再抛出反差点，整体节奏要短句、轻快、有停顿。",
      tags: ["小红书", "口播", "夏日氛围"],
    });

    expect(result).toEqual({
      initialUserPrompt: [
        "请参考下面这条风格灵感继续创作。先整理成可编辑的输入骨架，再继续执行。",
        "灵感标题：夏日短视频语气",
        "灵感摘要：适合清爽、轻快、有镜头感的小红书口播开场。",
        "补充线索：第一句先给画面感，再抛出反差点，整体节奏要短句、轻快、有停顿。",
        "标签：小红书、口播、夏日氛围",
      ].join("\n"),
      entryBannerMessage: "已从灵感库带入“风格”条目，可继续改写后发送。",
    });
  });

  it("摘要为空时应回退到内容，并按分类切换提示语", () => {
    const result = buildMemoryEntryCreationSeed({
      category: "experience",
      title: "爆款复盘模板",
      summary: "",
      content: "保留开头钩子、三段展开和结尾行动点，适合继续改写成新的内容主稿。",
      tags: [],
    });

    expect(result.initialUserPrompt).toContain(
      "请复用下面这条已验证成果继续创作。先整理成可编辑的输入骨架，再继续执行。",
    );
    expect(result.initialUserPrompt).toContain(
      "灵感摘要：保留开头钩子、三段展开和结尾行动点，适合继续改写成新的内容主稿。",
    );
    expect(result.initialUserPrompt).not.toContain("补充线索：");
    expect(result.entryBannerMessage).toBe(
      "已从灵感库带入“成果”条目，可继续改写后发送。",
    );
  });
});
