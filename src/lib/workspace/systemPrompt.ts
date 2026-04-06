/**
 * @file 工作台系统提示词生成器
 * @description 根据工作区主题和模式生成 AI 系统提示词
 * @module lib/workspace/systemPrompt
 */

import type { CreationMode, ThemeType } from "./workflowTypes";

const THEME_NAMES: Record<ThemeType, string> = {
  general: "通用对话",
};

const THEME_GUIDANCE: Record<ThemeType, string> = {
  general: `
【交互原则】
- 先澄清目标、约束和预期输出
- 不确定时先提问，不编造事实
- 输出优先追求可执行和可复用`,
};

const MODE_NAMES: Record<CreationMode, string> = {
  guided: "引导模式",
  fast: "快速模式",
  hybrid: "混合模式",
  framework: "框架模式",
};

function getFileWritingInstructions(theme: ThemeType): string {
  const fileSystemByTheme: Record<ThemeType, string> = {
    general: `
| 步骤 | 文件名 | 内容说明 |
|------|--------|----------|
| 1. 需求澄清 | brief.md | 目标、约束、验收标准 |
| 2. 输出草稿 | draft.md | 第一版正文或方案 |
| 3. 终稿整理 | article.md | 整理后的可交付版本 |`,
  };

  return `
## 文件写入格式

当需要输出文档内容时，使用以下标签格式：

<write_file path="文件名.md">
内容...
</write_file>

重要规则：
- 这是回复文本中的标签，不是工具调用
- 标签前先给一句引导说明，标签后给一句结果说明
- 同一轮需要多文件时，按步骤分别写入，避免覆盖

## 推荐文件体系

${fileSystemByTheme[theme]}
`;
}

function getModeInstructions(mode: CreationMode, theme: ThemeType): string {
  switch (mode) {
    case "fast":
      return `
【${MODE_NAMES[mode]}】
- 默认直接给出第一版结果
- 需求不清时只问最少的关键问题
- 输出后附上 2-3 条可继续追问或改写的方向`;
    case "hybrid":
      return `
【${MODE_NAMES[mode]}】
- 先给结构或关键选项，再继续生成正文
- 对需要确认的地方显式提出选择题
- 将用户补充内容并入下一版输出`;
    case "framework":
      return `
【${MODE_NAMES[mode]}】
- 优先输出结构、框架、检查清单和执行顺序
- 暂不急着写满正文，先把骨架搭好
- 对${THEME_NAMES[theme]}结果给出可扩展的目录或步骤`;
    case "guided":
    default:
      return `
【${MODE_NAMES.guided}】
- 拆成小步推进，每步都说明当前产出与下一步
- 涉及关键信息缺口时先澄清再继续
- 每轮输出都要能自然承接下一轮修改`;
  }
}

function buildThemePrompt(theme: ThemeType, mode: CreationMode): string {
  return `你是一位专业的${THEME_NAMES[theme]}助手。
${THEME_GUIDANCE[theme]}

${getModeInstructions(mode, theme)}

${getFileWritingInstructions(theme)}

【输出要求】
- 保持结构化表达，优先使用小标题和清单
- 先交付可用版本，再补充优化建议
- 不要输出与当前主题无关的旧创作模式或历史画布说明`;
}

export function generateGeneralWorkbenchPrompt(
  theme: ThemeType,
  mode: CreationMode = "guided",
): string {
  return buildThemePrompt(theme, mode);
}
