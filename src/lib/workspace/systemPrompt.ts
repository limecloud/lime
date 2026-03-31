/**
 * @file 工作台系统提示词生成器
 * @description 根据工作区主题和模式生成 AI 系统提示词
 * @module lib/workspace/systemPrompt
 */

import type { CreationMode, ThemeType } from "./workflowTypes";

export { isSpecializedWorkbenchTheme } from "@/lib/workspace/workbenchContract";

const THEME_NAMES: Record<ThemeType, string> = {
  general: "通用对话",
  "social-media": "社媒内容",
  knowledge: "知识探索",
  planning: "计划规划",
  document: "办公文档",
  video: "短视频",
};

const THEME_GUIDANCE: Record<ThemeType, string> = {
  general: `
【交互原则】
- 先澄清目标、约束和预期输出
- 不确定时先提问，不编造事实
- 输出优先追求可执行和可复用`,
  "social-media": `
【社媒内容特点】
- 先明确平台、受众、主题和传播目标
- 标题、开头、主体、结尾要有明确结构
- 平台适配时保留事实，调整语气、长度和排版`,
  knowledge: `
【知识探索特点】
- 区分事实、推断与待验证项
- 优先给出结构化解释和关键结论
- 存在不确定性时明确标注`,
  planning: `
【计划规划特点】
- 输出里程碑、依赖、风险和下一步动作
- 计划要考虑时间、资源和验收标准
- 避免只给空泛建议`,
  document: `
【办公文档特点】
- 结构清晰，标题层级明确
- 语言专业但保持可读性
- 优先产出可直接编辑和继续迭代的文稿`,
  video: `
【短视频特点】
- 先抓前 3 秒钩子，再组织冲突、信息和行动号召
- 脚本兼顾镜头描述、口播节奏和转场
- 输出应便于拆成分镜和后续制作清单`,
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
    "social-media": `
| 步骤 | 文件名 | 内容说明 |
|------|--------|----------|
| 1. 明确需求 | brief.md | 用户需求摘要、目标平台、受众定位 |
| 2. 创作内容 | draft.md | 社媒内容初稿 |
| 3. 润色优化 | article.md | 优化后的内容 |
| 4. 平台适配 | adapted.md | 适配不同平台的版本 |`,
    knowledge: `
| 步骤 | 文件名 | 内容说明 |
|------|--------|----------|
| 1. 问题定义 | brief.md | 研究问题、范围与判断标准 |
| 2. 资料整理 | research.md | 事实、来源、关键证据 |
| 3. 结论输出 | article.md | 结构化结论与建议 |`,
    planning: `
| 步骤 | 文件名 | 内容说明 |
|------|--------|----------|
| 1. 目标确认 | brief.md | 目标、约束、资源情况 |
| 2. 计划草案 | plan.md | 里程碑、依赖、任务清单 |
| 3. 执行版 | article.md | 最终行动方案 |`,
    document: `
| 步骤 | 文件名 | 内容说明 |
|------|--------|----------|
| 1. 明确需求 | brief.md | 文档主题、类型、目标读者 |
| 2. 文档大纲 | outline.md | 文档结构和章节规划 |
| 3. 撰写内容 | draft.md | 文档初稿 |
| 4. 润色优化 | article.md | 优化后的最终文档 |`,
    video: `
| 步骤 | 文件名 | 内容说明 |
|------|--------|----------|
| 1. 明确需求 | brief.md | 视频主题、时长、目标受众 |
| 2. 剧情大纲 | outline.md | 视频整体结构和节奏规划 |
| 3. 分镜设计 | storyboard.md | 关键画面和镜头设计 |
| 4. 撰写剧本 | script.md | 完整视频脚本 |
| 5. 润色优化 | script-final.md | 优化后的最终脚本 |`,
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

export function generateThemeWorkbenchPrompt(
  theme: ThemeType,
  mode: CreationMode = "guided",
): string {
  if (theme === "knowledge" || theme === "planning") {
    return `你是一位专业的${THEME_NAMES[theme]}助手。
${THEME_GUIDANCE[theme]}

【当前工作方式】
- 不需要进入旧式多阶段创作工作流
- 直接围绕用户目标组织分析、方案和结论
- 如果信息不足，先提问 1-3 个关键澄清问题`;
  }

  return buildThemePrompt(theme, mode);
}

export function needsFullWorkflow(theme: string): boolean {
  return ["social-media", "document", "video"].includes(
    theme.trim().toLowerCase(),
  );
}
