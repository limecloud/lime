/**
 * @file 内容评审专家预设
 * @description 定义评审专家预设与自定义专家构建方法
 * @module components/workspace/document/contentReviewExperts
 */

import type {
  ContentReviewExpert,
  CustomContentReviewExpertInput,
} from "./types";

function buildAvatarLabel(name: string): string {
  const normalized = name.trim();
  if (!normalized) {
    return "评";
  }

  const chars = Array.from(normalized).filter((char) => char.trim().length > 0);
  return chars.slice(0, 2).join("");
}

const DEFAULT_CUSTOM_EXPERT_COLOR =
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";

export const DEFAULT_CONTENT_REVIEW_EXPERTS: ContentReviewExpert[] = [
  {
    id: "narrative-chief-editor",
    name: "林岑·叙事总编",
    title: "结构整饬 · 主线聚焦",
    description:
      "擅长把松散信息压成清晰叙事链，优先检查标题、导语、正文和结论是否同向。",
    tags: ["结构整饬", "主线聚焦"],
    badgeText: "+1",
    avatarLabel: "林岑",
    avatarColor: "linear-gradient(135deg, #4f8cff 0%, #56d8ff 100%)",
  },
  {
    id: "fact-verification-officer",
    name: "许衡·事实核验官",
    title: "信息可信度 · 表述边界",
    description:
      "长期负责研究稿与行业稿审看，专盯数据站不站得住、结论有没有说过头。",
    tags: ["信息可信度", "表述边界"],
    badgeText: "+1",
    avatarLabel: "许衡",
    avatarColor: "linear-gradient(135deg, #7f7fd5 0%, #86a8e7 100%)",
  },
  {
    id: "platform-voice-strategist",
    name: "周映·传播策略师",
    title: "传播钩子 · 平台语感",
    description:
      "擅长把专业内容转成更有点击和停留意愿的表达，同时控制“标题党”风险。",
    tags: ["传播钩子", "平台语感"],
    badgeText: "+1",
    avatarLabel: "周映",
    avatarColor: "linear-gradient(135deg, #ff7a59 0%, #ffb36b 100%)",
  },
  {
    id: "tone-polish-director",
    name: "沈既白·语气润色官",
    title: "语气统一 · 句式节奏",
    description: "关注行文气质是否稳定，擅长削掉口水话、重复话和生硬转折。",
    tags: ["语气统一", "句式节奏"],
    badgeText: "+1",
    avatarLabel: "沈既",
    avatarColor: "linear-gradient(135deg, #00c6a7 0%, #1e90ff 100%)",
  },
  {
    id: "compliance-guard",
    name: "顾澄·风险把关人",
    title: "敏感风险 · 规范措辞",
    description:
      "熟悉内容发布中的敏感边界，擅长把高风险表达改成更稳妥、更可发布的版本。",
    tags: ["敏感风险", "规范措辞"],
    badgeText: "+2",
    avatarLabel: "顾澄",
    avatarColor: "linear-gradient(135deg, #5ee7df 0%, #b490ca 100%)",
  },
  {
    id: "audience-insight-coach",
    name: "贺知南·读者洞察师",
    title: "受众预期 · 阅读阻力",
    description:
      "从读者视角检查理解门槛和信息密度，帮助内容更快进入重点、减少跳出。",
    tags: ["受众预期", "阅读阻力"],
    badgeText: "+1",
    avatarLabel: "贺知",
    avatarColor: "linear-gradient(135deg, #f857a6 0%, #ff5858 100%)",
  },
];

export function createCustomContentReviewExpert(
  input: CustomContentReviewExpertInput,
): ContentReviewExpert {
  return {
    id: `custom-review-expert-${Date.now()}`,
    name: input.name.trim(),
    title: "自定义专家 · 个性化评审",
    description: input.description.trim(),
    tags: ["自定义专家", "个性化评审"],
    badgeText: "+1",
    avatarLabel: buildAvatarLabel(input.name),
    avatarColor: DEFAULT_CUSTOM_EXPERT_COLOR,
    avatarImageUrl: input.avatarImageUrl,
  };
}
