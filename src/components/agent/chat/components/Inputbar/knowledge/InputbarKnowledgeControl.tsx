import { useMemo, useState } from "react";
import styled from "styled-components";
import { BookOpen, ChevronDown, MessageSquareText } from "lucide-react";
import type {
  InputbarKnowledgePackOption,
  InputbarKnowledgePackSelection,
} from "../types";
import {
  MetaToggleButton,
  MetaToggleCheck,
  MetaToggleGlyph,
  MetaToggleLabel,
} from "../styles";

const KnowledgePackControlWrap = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;

  ${MetaToggleLabel} {
    max-width: 190px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const KnowledgePackMenuButton = styled.button`
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: #ffffff;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;

  &:hover,
  &:focus-visible {
    border-color: rgba(16, 185, 129, 0.38);
    background: var(--lime-surface-hover, #f4fdf4);
    color: hsl(var(--foreground));
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--lime-focus-ring, rgba(74, 222, 128, 0.24));
  }
`;

const KnowledgePackMenu = styled.div`
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 120;
  width: min(320px, calc(100vw - 48px));
  max-height: 320px;
  overflow: auto;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid rgba(203, 213, 225, 0.9);
  background: #ffffff;
  box-shadow: 0 18px 40px -28px rgba(15, 23, 42, 0.34);
`;

const KnowledgePackMenuItem = styled.button<{ $active?: boolean }>`
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  padding: 9px 10px;
  border: 1px solid
    ${({ $active }) => ($active ? "rgba(16, 185, 129, 0.42)" : "transparent")};
  border-radius: 10px;
  background: ${({ $active }) => ($active ? "#ecfdf5" : "transparent")};
  color: #0f172a;
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: #f8fafc;
    border-color: rgba(203, 213, 225, 0.9);
  }

  &:focus-visible {
    outline: none;
  }
`;

const KnowledgePackMenuItemTitle = styled.span`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.35;

  > span:first-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const KnowledgePackMenuItemMeta = styled.span`
  color: #64748b;
  font-size: 11px;
  line-height: 1.3;
`;

const KnowledgePackMenuBadge = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-height: 18px;
  border-radius: 999px;
  background: #d1fae5;
  padding: 0 7px;
  color: #047857;
  font-size: 10px;
  font-weight: 700;
`;

const KnowledgePackMenuDivider = styled.div`
  margin: 6px 4px;
  height: 1px;
  background: #e2e8f0;
`;

const KnowledgeOrganizeCard = styled.div`
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 120;
  width: min(340px, calc(100vw - 48px));
  padding: 12px;
  border-radius: 16px;
  border: 1px solid rgba(187, 247, 208, 0.95);
  background: #ffffff;
  box-shadow: 0 18px 40px -28px rgba(15, 23, 42, 0.34);
`;

const KnowledgeOrganizeTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #0f172a;
  font-size: 13px;
  font-weight: 760;
`;

const KnowledgeOrganizeDescription = styled.p`
  margin: 8px 0 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.55;
`;

const KnowledgeOrganizeActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
`;

const KnowledgeOrganizeAction = styled.button<{ $primary?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 32px;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid ${({ $primary }) => ($primary ? "#0f172a" : "#cbd5e1")};
  background: ${({ $primary }) => ($primary ? "#0f172a" : "#ffffff")};
  padding: 0 12px;
  color: ${({ $primary }) => ($primary ? "#ffffff" : "#334155")};
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    background: ${({ $primary }) => ($primary ? "#1e293b" : "#f8fafc")};
  }
`;

function normalizeKnowledgePackOptions({
  knowledgePackOptions,
  knowledgePackSelection,
}: {
  knowledgePackOptions: InputbarKnowledgePackOption[];
  knowledgePackSelection?: InputbarKnowledgePackSelection | null;
}) {
  const optionMap = new Map<string, InputbarKnowledgePackOption>();

  for (const option of knowledgePackOptions) {
    const packName = option.packName.trim();
    if (!packName || optionMap.has(packName)) {
      continue;
    }

    optionMap.set(packName, {
      ...option,
      packName,
    });
  }

  const selectedPackName = knowledgePackSelection?.packName.trim();
  if (selectedPackName && !optionMap.has(selectedPackName)) {
    optionMap.set(selectedPackName, {
      packName: selectedPackName,
      label: knowledgePackSelection?.label,
      status: knowledgePackSelection?.status,
    });
  }

  return Array.from(optionMap.values());
}

export function InputbarKnowledgeControl({
  knowledgePackSelection,
  knowledgePackOptions = [],
  onToggleKnowledgePack,
  onSelectKnowledgePack,
  onStartKnowledgeOrganize,
  onManageKnowledgePacks,
}: {
  knowledgePackSelection?: InputbarKnowledgePackSelection | null;
  knowledgePackOptions?: InputbarKnowledgePackOption[];
  onToggleKnowledgePack?: (enabled: boolean) => void;
  onSelectKnowledgePack?: (packName: string) => void;
  onStartKnowledgeOrganize?: () => void;
  onManageKnowledgePacks?: () => void;
}) {
  const [showKnowledgePackMenu, setShowKnowledgePackMenu] = useState(false);
  const [showOrganizeCard, setShowOrganizeCard] = useState(false);
  const shouldShowKnowledgePackToggle = Boolean(
    knowledgePackSelection?.packName && knowledgePackSelection?.workingDir,
  );
  const normalizedOptions = useMemo(
    () =>
      normalizeKnowledgePackOptions({
        knowledgePackOptions,
        knowledgePackSelection,
      }),
    [knowledgePackOptions, knowledgePackSelection],
  );
  const hasKnowledgePackChoices = normalizedOptions.length > 1;
  const currentKnowledgePackLabel =
    knowledgePackSelection?.label || knowledgePackSelection?.packName || "项目资料";

  const handleKnowledgePackToggle = () => {
    if (!knowledgePackSelection) {
      return;
    }

    onToggleKnowledgePack?.(!knowledgePackSelection.enabled);
  };
  const handleSelectKnowledgePack = (packName: string) => {
    onSelectKnowledgePack?.(packName);
    onToggleKnowledgePack?.(true);
    setShowKnowledgePackMenu(false);
  };

  if (shouldShowKnowledgePackToggle && knowledgePackSelection) {
    return (
      <KnowledgePackControlWrap>
        <MetaToggleButton
          type="button"
          $checked={knowledgePackSelection.enabled}
          aria-label={
            knowledgePackSelection.enabled ? "关闭项目资料" : "使用项目资料"
          }
          title={
            knowledgePackSelection.enabled
              ? `正在使用项目资料：${currentKnowledgePackLabel}`
              : `项目资料当前未使用：${currentKnowledgePackLabel}`
          }
          data-testid="inputbar-knowledge-pack-toggle"
          onClick={handleKnowledgePackToggle}
        >
          <MetaToggleCheck
            $checked={knowledgePackSelection.enabled}
            aria-hidden
          />
          <MetaToggleGlyph aria-hidden>
            <BookOpen strokeWidth={1.8} />
          </MetaToggleGlyph>
          <MetaToggleLabel>
            {knowledgePackSelection.enabled
              ? `正在使用：${currentKnowledgePackLabel}`
              : "项目资料：未使用"}
          </MetaToggleLabel>
        </MetaToggleButton>
        {hasKnowledgePackChoices || onManageKnowledgePacks ? (
          <KnowledgePackMenuButton
            type="button"
            aria-label="管理项目资料"
            aria-expanded={showKnowledgePackMenu}
            title="管理项目资料"
            data-testid="inputbar-knowledge-pack-menu-toggle"
            onClick={() => setShowKnowledgePackMenu((previous) => !previous)}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </KnowledgePackMenuButton>
        ) : null}
        {showKnowledgePackMenu ? (
          <KnowledgePackMenu role="menu" data-testid="inputbar-knowledge-pack-menu">
            {normalizedOptions.map((option) => {
              const isSelected = option.packName === knowledgePackSelection.packName;
              const label = option.label || option.packName;

              return (
                <KnowledgePackMenuItem
                  key={option.packName}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  data-testid={`inputbar-knowledge-pack-option-${option.packName}`}
                  $active={isSelected}
                  onClick={() => handleSelectKnowledgePack(option.packName)}
                >
                  <KnowledgePackMenuItemTitle>
                    <span>{label}</span>
                    {option.defaultForWorkspace ? (
                      <KnowledgePackMenuBadge>默认</KnowledgePackMenuBadge>
                    ) : null}
                  </KnowledgePackMenuItemTitle>
                  <KnowledgePackMenuItemMeta>
                    {option.status || "未确认"}
                  </KnowledgePackMenuItemMeta>
                </KnowledgePackMenuItem>
              );
            })}
            {knowledgePackSelection.enabled || onManageKnowledgePacks ? (
              <KnowledgePackMenuDivider />
            ) : null}
            {knowledgePackSelection.enabled ? (
              <KnowledgePackMenuItem
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleKnowledgePack?.(false);
                  setShowKnowledgePackMenu(false);
                }}
              >
                <KnowledgePackMenuItemTitle>
                  <span>关闭项目资料</span>
                </KnowledgePackMenuItemTitle>
                <KnowledgePackMenuItemMeta>
                  本次对话不再引用项目资料
                </KnowledgePackMenuItemMeta>
              </KnowledgePackMenuItem>
            ) : null}
            {onManageKnowledgePacks ? (
              <KnowledgePackMenuItem
                type="button"
                role="menuitem"
                onClick={() => {
                  onManageKnowledgePacks();
                  setShowKnowledgePackMenu(false);
                }}
              >
                <KnowledgePackMenuItemTitle>
                  <span>管理资料</span>
                </KnowledgePackMenuItemTitle>
                <KnowledgePackMenuItemMeta>
                  检查、确认、设为默认或归档
                </KnowledgePackMenuItemMeta>
              </KnowledgePackMenuItem>
            ) : null}
          </KnowledgePackMenu>
        ) : null}
      </KnowledgePackControlWrap>
    );
  }

  if (!onStartKnowledgeOrganize) {
    return null;
  }

  return (
    <KnowledgePackControlWrap>
      <MetaToggleButton
        type="button"
        $checked={showOrganizeCard}
        aria-label="添加项目资料"
        aria-expanded={showOrganizeCard}
        title="添加项目资料"
        data-testid="inputbar-knowledge-organize"
        onClick={() => setShowOrganizeCard((previous) => !previous)}
      >
        <MetaToggleCheck $checked={showOrganizeCard} aria-hidden />
        <MetaToggleGlyph aria-hidden>
          <BookOpen strokeWidth={1.8} />
        </MetaToggleGlyph>
        <MetaToggleLabel>添加项目资料</MetaToggleLabel>
      </MetaToggleButton>
      {showOrganizeCard ? (
        <KnowledgeOrganizeCard data-testid="inputbar-knowledge-organize-card">
          <KnowledgeOrganizeTitle>
            <BookOpen className="h-4 w-4 text-emerald-600" />
            让 Agent 整理成可复用资料
          </KnowledgeOrganizeTitle>
          <KnowledgeOrganizeDescription>
            把访谈稿、产品说明、SOP 或历史文案粘贴到输入框，Lime 会提炼事实、适用场景和待确认风险。
          </KnowledgeOrganizeDescription>
          <KnowledgeOrganizeActions>
            {onManageKnowledgePacks ? (
              <KnowledgeOrganizeAction
                type="button"
                onClick={() => {
                  onManageKnowledgePacks();
                  setShowOrganizeCard(false);
                }}
              >
                管理资料
              </KnowledgeOrganizeAction>
            ) : null}
            <KnowledgeOrganizeAction
              type="button"
              $primary
              onClick={() => {
                onStartKnowledgeOrganize();
                setShowOrganizeCard(false);
              }}
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              发送给 Agent 整理
            </KnowledgeOrganizeAction>
          </KnowledgeOrganizeActions>
        </KnowledgeOrganizeCard>
      ) : null}
    </KnowledgePackControlWrap>
  );
}
