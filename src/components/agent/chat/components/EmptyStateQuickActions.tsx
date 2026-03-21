import styled, { keyframes } from "styled-components";
import {
  EMPTY_STATE_META_PILL_CLASSNAME,
  EMPTY_STATE_PANEL_CLASSNAME,
  EMPTY_STATE_PANEL_EMBEDDED_CLASSNAME,
  EMPTY_STATE_PRESET_BUTTON_CLASSNAME,
  EMPTY_STATE_RECOMMENDATION_CARD_CLASSNAME,
} from "./emptyStateSurfaceTokens";

const sectionReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const itemReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(14px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const QuickActionsPanel = styled.section<{ $embedded: boolean }>`
  position: relative;
  overflow: hidden;
  animation: ${sectionReveal} 580ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: 200ms;

  &::after {
    content: "";
    position: absolute;
    inset: 0 auto auto 1.1rem;
    width: 8rem;
    height: 1px;
    background: linear-gradient(
      90deg,
      rgba(16, 185, 129, 0.55) 0%,
      rgba(56, 189, 248, 0.24) 100%
    );
    opacity: 0.55;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const PresetButton = styled.button.attrs({
  className: EMPTY_STATE_PRESET_BUTTON_CLASSNAME,
})<{ $index: number }>`
  animation: ${itemReveal} 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: ${({ $index }) => `${160 + $index * 40}ms`};
  transition:
    transform 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 14px 24px -20px rgba(15, 23, 42, 0.18);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition: none;
  }
`;

const RecommendationCard = styled.button.attrs({
  className: EMPTY_STATE_RECOMMENDATION_CARD_CLASSNAME,
})<{ $index: number }>`
  animation: ${itemReveal} 520ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: ${({ $index }) => `${220 + $index * 70}ms`};
  transition:
    transform 200ms ease,
    box-shadow 200ms ease,
    border-color 200ms ease;

  &:hover {
    transform: translateY(-3px);
    border-color: rgba(203, 213, 225, 0.98);
    box-shadow: 0 16px 28px -22px rgba(15, 23, 42, 0.18);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
    transition: none;
  }
`;

export interface EmptyStateQuickActionItem {
  key: string;
  title: string;
  description: string;
  badge: string;
  prompt: string;
  actionLabel?: string;
  outputHint?: string;
  statusLabel?: string;
  statusTone?: "slate" | "sky" | "emerald" | "amber";
  statusDescription?: string;
  testId?: string;
  solutionId?: string;
}

export interface EmptyStateQuickPresetItem {
  key: string;
  label: string;
  icon?: string;
  prompt: string;
}

interface EmptyStateQuickActionsProps {
  title: string;
  description: string;
  selectedTextPreview?: string;
  presets?: EmptyStateQuickPresetItem[];
  items: EmptyStateQuickActionItem[];
  embedded?: boolean;
  loading?: boolean;
  onPresetAction?: (item: EmptyStateQuickPresetItem) => void;
  onAction: (item: EmptyStateQuickActionItem) => void;
}

const STATUS_TONE_CLASSNAMES = {
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
} as const;

export function EmptyStateQuickActions({
  title,
  description,
  selectedTextPreview,
  presets = [],
  items,
  embedded = false,
  loading = false,
  onPresetAction,
  onAction,
}: EmptyStateQuickActionsProps) {
  if (!loading && items.length === 0 && presets.length === 0) {
    return null;
  }

  return (
    <QuickActionsPanel
      $embedded={embedded}
      className={
        embedded
          ? EMPTY_STATE_PANEL_EMBEDDED_CLASSNAME
          : EMPTY_STATE_PANEL_CLASSNAME
      }
    >
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <p className="mt-1 text-xs leading-5 text-slate-500 md:text-sm">
            {description}
          </p>
        </div>
      </div>

      {presets.length > 0 ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {presets.map((preset, index) => (
            <PresetButton
              key={preset.key}
              $index={index}
              type="button"
              onClick={() => onPresetAction?.(preset)}
            >
              {preset.icon ? (
                <span aria-hidden="true" className="text-base leading-none">
                  {preset.icon}
                </span>
              ) : null}
              <span>{preset.label}</span>
            </PresetButton>
          ))}
        </div>
      ) : null}

      {selectedTextPreview ? (
        <div className="mt-2.5 rounded-2xl border border-sky-200/70 bg-sky-50/85 px-3.5 py-2.5 text-xs leading-5 text-slate-600">
          已检测到当前选中内容，点击推荐动作时会自动携带上下文：
          <span className="ml-1 font-medium text-slate-900">
            “{selectedTextPreview}”
          </span>
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white/80 px-4 py-3 text-xs leading-5 text-slate-500">
          正在加载推荐方案…
        </div>
      ) : (
        <div className="mt-2.5 grid gap-2 md:grid-cols-2">
          {items.map((item, index) => (
            <RecommendationCard
              key={item.key}
              $index={index}
              type="button"
              data-testid={item.testId}
              onClick={() => onAction(item)}
            >
              <div className="flex w-full items-start justify-between gap-3">
                <span className={EMPTY_STATE_META_PILL_CLASSNAME}>
                  {item.badge}
                </span>
                <span className="text-[11px] font-medium text-slate-400 transition-colors group-hover:text-slate-500">
                  {item.actionLabel || "立即开始"}
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">
                  {item.title}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                  {item.description}
                </p>
                {item.outputHint ? (
                  <p className="mt-2 text-[11px] leading-5 text-slate-400">
                    产出：{item.outputHint}
                  </p>
                ) : null}
                {item.statusLabel ? (
                  <div className="mt-2 flex items-center justify-start">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${STATUS_TONE_CLASSNAMES[item.statusTone ?? "slate"]}`}
                      title={item.statusDescription}
                    >
                      {item.statusLabel}
                    </span>
                  </div>
                ) : null}
              </div>
            </RecommendationCard>
          ))}
        </div>
      )}
    </QuickActionsPanel>
  );
}

export default EmptyStateQuickActions;
