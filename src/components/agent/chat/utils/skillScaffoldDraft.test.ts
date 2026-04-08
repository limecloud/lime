import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSkillsPageParamsFromMessage } from "./skillScaffoldDraft";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildSkillsPageParamsFromMessage", () => {
  it("应从结果消息生成技能页脚手架草稿参数", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234567890);

    const result = buildSkillsPageParamsFromMessage({
      messageId: "msg-assistant-42",
      content: `# 小红书选题研究\n\n请围绕春季露营主题，输出 10 个可执行选题和各自切入角度。`,
    }, { creationProjectId: "project-demo" });

    expect(result?.creationProjectId).toBe("project-demo");
    expect(result?.initialScaffoldDraft).toMatchObject({
      target: "project",
      name: "小红书选题研究",
      description:
        "沉淀自一次成功结果：小红书选题研究 请围绕春季露营主题，输出 10 个可执行选题和各自切入角度。",
      whenToUse: [
        "当你需要继续产出“小红书选题研究”这类结果时使用。",
        "适合继续沿用这次围绕“请围绕春季露营主题，输出 10 个可执行选题和各自切入角度。”的结构、判断方式和交付颗粒度。",
      ],
      inputs: [
        "目标与主题：请围绕春季露营主题，输出 10 个可执行选题和各自切入角度。",
        "补充受众、风格、篇幅、平台或输出格式等关键约束。",
        "如有历史版本、参考资料、示例或素材，可一并提供。",
      ],
      outputs: [
        "交付一份与“小红书选题研究”同类型、可直接使用的完整结果。",
        "输出需要覆盖“请围绕春季露营主题，输出 10 个可执行选题和各自切入角度。”对应的关键信息，并保持结构清晰。",
        "必要时附带简短说明，便于继续复用或二次迭代。",
      ],
      steps: [
        "先确认本次任务是否仍围绕：请围绕春季露营主题，输出 10 个可执行选题和各自切入角度。",
        "提炼这次成功结果里的结构骨架，再决定哪些部分需要沿用或改写。",
        "按相同颗粒度补齐关键信息与执行细节，输出可直接交付的结果。",
      ],
      fallbackStrategy: [
        "如果用户目标或素材不足，先补问最关键的主题、受众或平台约束。",
        "如果原结果不适合直接复用，先提炼最小骨架，再给出可继续迭代的首版。",
        "如果信息仍然缺失，明确标注待补内容，不要假设不存在的事实。",
      ],
      sourceMessageId: "msg-assistant-42",
      sourceExcerpt:
        "小红书选题研究 请围绕春季露营主题，输出 10 个可执行选题和各自切入角度。",
    });
    expect(result?.initialScaffoldDraft?.directory).toMatch(/^saved-skill-/);
    expect(result?.initialScaffoldRequestKey).toBe(1234567890);
  });

  it("标题无法转成目录名时应回退到稳定前缀", () => {
    vi.spyOn(Date, "now").mockReturnValue(22334455);

    const result = buildSkillsPageParamsFromMessage({
      messageId: "message-cn-only",
      content: "复盘这个流程，并整理成以后可复用的做法。",
    });

    expect(result?.initialScaffoldDraft?.directory).toMatch(/^saved-skill-/);
    expect(result?.initialScaffoldRequestKey).toBe(22334455);
  });

  it("来自技能草稿回放时应复用已有结构化字段", () => {
    vi.spyOn(Date, "now").mockReturnValue(33445566);

    const result = buildSkillsPageParamsFromMessage(
      {
        messageId: "msg-replay-skill",
        content: "请继续产出一版更完整的交付结果，并补充执行细节。",
      },
      {
        creationReplay: {
          version: 1,
          kind: "skill_scaffold",
          source: {
            page: "skills",
          },
          data: {
            target: "project",
            directory: "saved-skill-existing",
            when_to_use: ["优先复用这条已经验证过的工作流。"],
            inputs: ["历史输入骨架：目标、平台、限制。"],
            outputs: ["保留原有交付结构，并输出一版更完整结果。"],
            steps: ["先检查哪些步骤必须保留。"],
            fallback_strategy: ["如果信息不足，先追问缺失参数。"],
          },
        },
      },
    );

    expect(result?.initialScaffoldDraft).toMatchObject({
      target: "project",
      directory: "saved-skill-existing",
      whenToUse: expect.arrayContaining(["优先复用这条已经验证过的工作流。"]),
      inputs: expect.arrayContaining(["历史输入骨架：目标、平台、限制。"]),
      outputs: expect.arrayContaining(["保留原有交付结构，并输出一版更完整结果。"]),
      steps: expect.arrayContaining(["先检查哪些步骤必须保留。"]),
      fallbackStrategy: expect.arrayContaining([
        "如果信息不足，先追问缺失参数。",
      ]),
    });
    expect(result?.initialScaffoldRequestKey).toBe(33445566);
  });

  it("来自灵感库回放时应把灵感线索带入技能草稿输入约束", () => {
    vi.spyOn(Date, "now").mockReturnValue(44556677);

    const result = buildSkillsPageParamsFromMessage(
      {
        messageId: "msg-replay-memory",
        content: "继续把这条灵感扩写成一套完整的可复用结果。",
      },
      {
        creationReplay: {
          version: 1,
          kind: "memory_entry",
          source: {
            page: "memory",
          },
          data: {
            category: "identity",
            title: "夏日短视频语气",
            summary: "整体要轻快、清爽、有画面感。",
            tags: ["小红书", "口播"],
          },
        },
      },
    );

    expect(result?.initialScaffoldDraft).toMatchObject({
      description:
        "沉淀自一次继续复用“夏日短视频语气”灵感后的成功结果。 整体要轻快、清爽、有画面感。",
      whenToUse: expect.arrayContaining([
        "适合继续围绕灵感库中的“夏日短视频语气”这条风格线索扩展成完整工作流。",
      ]),
      inputs: expect.arrayContaining([
        "参考灵感：夏日短视频语气",
        "灵感摘要：整体要轻快、清爽、有画面感。",
        "参考标签：小红书、口播",
      ]),
    });
    expect(result?.initialScaffoldRequestKey).toBe(44556677);
  });

  it("纯空白内容不应生成技能草稿", () => {
    const result = buildSkillsPageParamsFromMessage({
      messageId: "msg-empty",
      content: "   \n\n",
    });

    expect(result).toBeNull();
  });
});
