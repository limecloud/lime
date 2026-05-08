export const PERSONAL_IP_KNOWLEDGE_BUILDER_SKILL_NAME =
  "personal-ip-knowledge-builder";
export const COMPAT_KNOWLEDGE_BUILDER_SKILL_NAME = "knowledge_builder";

export function normalizeKnowledgeDraftName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "project-material"
  );
}

export function buildKnowledgeBuilderPrompt(params: {
  workingDir: string;
  packName: string;
  packType?: string;
  description?: string;
}) {
  const displayName = params.description?.trim() || "项目资料";
  const lines = [
    "请整理这份项目资料，生成一份可检查确认的资料草稿。",
    "",
    `资料名称：${displayName}`,
  ];

  if (params.packType?.trim()) {
    lines.push(`资料类型：${params.packType.trim()}`);
  }

  lines.push(
    "",
    "请只基于已导入资料提炼事实、适用场景、表达边界和待补充内容。",
    "缺失内容请标为待补充，不要编造；完成后给出可供人工确认的摘要。",
  );

  return lines.join("\n");
}

export function buildKnowledgeOrganizePrompt(sourceText: string): string {
  const trimmed = sourceText.trim();
  const lines = [
    "请把这些内容整理成当前项目可复用的项目资料。",
    "",
    "整理目标：",
    "1. 提炼已确认事实、适用场景、表达风格和不能编造的边界。",
    "2. 标出缺失信息、冲突内容和需要人工确认的风险提醒。",
    "3. 生成一份可供我检查确认的项目资料草稿。",
  ];

  if (trimmed) {
    lines.push("", "待整理资料：", trimmed);
  } else {
    lines.push("", "我接下来会补充资料，请先告诉我需要提供哪些内容。");
  }

  return lines.join("\n");
}
