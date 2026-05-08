import type { KnowledgePackStatus } from "@/lib/api/knowledge";

export type KnowledgeView = "overview" | "import" | "detail";
export type DetailTab =
  | "overview"
  | "content"
  | "sources"
  | "runtime"
  | "risks"
  | "runs";

export const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  ready: "已确认",
  "needs-review": "待确认",
  stale: "可能过期",
  disputed: "有争议",
  archived: "已归档",
};

export const STATUS_CLASS_NAMES: Record<string, string> = {
  draft: "border-slate-200 bg-slate-50 text-slate-600",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
  "needs-review": "border-amber-200 bg-amber-50 text-amber-700",
  stale: "border-amber-200 bg-amber-50 text-amber-700",
  disputed: "border-rose-200 bg-rose-50 text-rose-700",
  archived: "border-slate-200 bg-slate-100 text-slate-500",
};

export const PACK_TYPES = [
  {
    value: "personal-ip",
    label: "个人 IP",
    description: "创始人介绍、故事素材、表达风格和商务话术。",
  },
  {
    value: "brand-product",
    label: "品牌产品",
    description: "品牌定位、产品事实、功效边界和客服口径。",
  },
  {
    value: "organization-knowhow",
    label: "组织 Know-how",
    description: "团队 SOP、交付方法、升级路径和不可回答边界。",
  },
  {
    value: "content-operations",
    label: "内容运营",
    description: "选题日历、栏目节奏、素材复用和发布复盘。",
  },
  {
    value: "private-domain-operations",
    label: "私域 / 社群运营",
    description: "社群 SOP、触达节奏、分层转化和话术边界。",
  },
  {
    value: "live-commerce-operations",
    label: "直播运营",
    description: "直播排期、场控流程、互动话术和复盘指标。",
  },
  {
    value: "campaign-operations",
    label: "活动 / Campaign",
    description: "活动节奏、渠道分工、物料清单和风险预案。",
  },
  {
    value: "growth-strategy",
    label: "增长策略",
    description: "渠道策略、投放假设、转化漏斗和复盘结论。",
  },
] as const;

export const VIEW_TABS: Array<{
  id: KnowledgeView;
  label: string;
  description: string;
}> = [
  { id: "overview", label: "上下文总览", description: "1 persona + N data" },
  { id: "import", label: "Builder 整理", description: "用 Skills 生产资料" },
  { id: "detail", label: "资料详情", description: "审阅与边界" },
];

export const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "概览" },
  { id: "content", label: "内容" },
  { id: "sources", label: "原始资料" },
  { id: "runtime", label: "引用摘要" },
  { id: "risks", label: "缺口与风险" },
  { id: "runs", label: "整理记录" },
];

export function resolveStatusLabel(status: KnowledgePackStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function resolveStatusClassName(status: KnowledgePackStatus): string {
  return STATUS_CLASS_NAMES[status] ?? STATUS_CLASS_NAMES.draft;
}

export function getPackTypeLabel(value?: string | null): string {
  const normalized =
    value === "personal-profile"
      ? "personal-ip"
      : value === "custom:lime-growth-strategy"
        ? "growth-strategy"
        : value;
  return (
    PACK_TYPES.find((type) => type.value === normalized)?.label ??
    normalized ??
    "自定义"
  );
}
