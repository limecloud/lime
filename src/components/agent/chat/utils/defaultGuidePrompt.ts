const SOCIAL_MEDIA_DEFAULT_GUIDE_PROMPT = `你现在是社媒内容创作教练，请先进入“提问引导”阶段，不要直接成文。

请先用简洁问题逐项确认以下信息：
1. 核心主题（想解决的问题或核心观点）
2. 发布平台（如小红书/公众号/知乎）
3. 目标受众（人群画像）
4. 目标结果（涨粉/互动/转化/品牌认知）
5. 语气风格与篇幅要求

提问规则：
- 一次最多 3 个问题，问题要具体可回答
- 若信息不全，继续追问关键缺失项
- 在用户明确“可以开始写”前，不输出完整稿件

当信息收集完成后，再给出创作执行计划并开始写作。`;

export function getDefaultGuidePromptByTheme(
  theme: string,
): string | undefined {
  if (theme === "social-media") {
    return SOCIAL_MEDIA_DEFAULT_GUIDE_PROMPT;
  }

  return undefined;
}
