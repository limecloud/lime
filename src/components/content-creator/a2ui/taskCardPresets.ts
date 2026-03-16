export interface A2UITaskCardPreset {
  title: string;
  subtitle: string;
  statusLabel: string;
  footerText?: string;
  loadingText?: string;
}

export const DEFAULT_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  title: "补充信息",
  subtitle: "请先完成这一步，我再继续后续处理。",
  statusLabel: "待完成 1 / 1",
  loadingText: "表单加载中...",
};

export const CHAT_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  ...DEFAULT_A2UI_TASK_CARD_PRESET,
  subtitle: "请先完成这一步，我再继续当前对话。",
};

export const CHAT_FLOATING_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  ...DEFAULT_A2UI_TASK_CARD_PRESET,
  subtitle: "请先完成这一步，我再继续。",
};

export const REVIEW_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  title: "结构化补充信息",
  subtitle: "评审结果已切换为结构化预览，仅展示字段与提示，不直接允许提交。",
  statusLabel: "评审预览",
  loadingText: "结构化评审结果加载中...",
};

export const TIMELINE_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  title: "结构化问答预览",
  subtitle: "当前阶段已整理结构化字段，仅作为回合记录预览展示。",
  statusLabel: "阶段预览",
  loadingText: "结构化问答整理中...",
};

export const WORKSPACE_CREATE_CONFIRMATION_TASK_PRESET: A2UITaskCardPreset = {
  ...DEFAULT_A2UI_TASK_CARD_PRESET,
  subtitle: "请选择一种开始方式，确认后我再继续执行后续创作。",
};
