export interface A2UITaskCardPreset {
  title: string;
  subtitle: string;
  statusLabel: string;
  footerText?: string;
  loadingText?: string;
}

export const DEFAULT_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  title: "等你补充信息",
  subtitle: "先补这一步，我再继续后续处理。",
  statusLabel: "等你确认",
  loadingText: "这一步加载中...",
};

export const CHAT_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  ...DEFAULT_A2UI_TASK_CARD_PRESET,
  subtitle: "先补这一步，我再继续当前对话。",
};

export const CHAT_FLOATING_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  ...DEFAULT_A2UI_TASK_CARD_PRESET,
  subtitle: "先补这一步，我再继续。",
};

export const REVIEW_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  title: "评审预览",
  subtitle: "结构化补充信息",
  statusLabel: "只读回显",
  loadingText: "结构化评审结果加载中...",
};

export const TIMELINE_A2UI_TASK_CARD_PRESET: A2UITaskCardPreset = {
  title: "这一步的信息",
  subtitle: "这是这一步的回显，我按这个继续。",
  statusLabel: "回合记录",
  loadingText: "这一步还在整理...",
};

export const WORKSPACE_CREATE_CONFIRMATION_TASK_PRESET: A2UITaskCardPreset = {
  ...DEFAULT_A2UI_TASK_CARD_PRESET,
  subtitle: "请选择一种开始方式，确认后我再继续执行后续创作。",
};
