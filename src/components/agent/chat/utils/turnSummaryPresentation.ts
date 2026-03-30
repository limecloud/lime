const LEGACY_DECISION_PREFIX_RE = /^已决定[:：]\s*/;

const INTERNAL_ROUTING_SUMMARY_PATTERNS = [
  /^直接回答优先$/,
  /^优先本地直接回答$/,
  /^联网搜索能力待命$/,
  /^联网搜索仅作为候选能力待命$/,
  /^先理解意图再决定是否联网$/,
  /^当前请求无需默认升级为搜索或任务$/,
  /^当前请求无需工具介入$/,
  /^等待首个模型事件$/,
  /^推理增强已待命$/,
  /^必要时启用深度思考$/,
  /^先走轻量推理$/,
  /^自动选择执行方式$/,
  /^对话优先执行$/,
  /^代码编排执行$/,
  /^用户请求已入队$/,
  /^系统引导请求$/,
  /^正在启动处理流程$/,
  /^正在准备处理$/,
  /^已开始处理正在准备环境并等待第一条进展$/,
  /^正在理解你的需求并准备当前阶段$/,
];

function normalizeLineForMatch(value: string): string {
  return value
    .replace(LEGACY_DECISION_PREFIX_RE, "")
    .replace(/[。；，、,.!?！？:：]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

export function normalizeTurnSummaryDisplayText(text?: string | null): string {
  return (text || "").trim();
}

export function extractTurnSummaryLines(text?: string | null): string[] {
  return normalizeTurnSummaryDisplayText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isInternalRoutingTurnSummaryText(
  text?: string | null,
): boolean {
  const lines = extractTurnSummaryLines(text);
  if (lines.length === 0) {
    return false;
  }

  return lines.every((line) => {
    const normalized = normalizeLineForMatch(line);
    return INTERNAL_ROUTING_SUMMARY_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    );
  });
}
