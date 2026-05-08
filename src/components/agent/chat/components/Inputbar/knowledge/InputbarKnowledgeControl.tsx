import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import {
  BookOpen,
  ChevronDown,
  MessageSquareText,
  SlidersHorizontal,
} from "lucide-react";
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
import {
  isReadyKnowledgePackStatus,
  normalizeKnowledgePackOptions,
  resolveKnowledgeHubState,
} from "./knowledgeHubState";

const KnowledgePackControlWrap = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;

  ${MetaToggleLabel} {
    max-width: 168px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
`;

const KnowledgePackMenu = styled.div`
  width: 100%;
  max-height: 168px;
  overflow: auto;
  margin-top: 12px;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid rgba(203, 213, 225, 0.9);
  background: #f8fafc;
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

const KnowledgePackSectionTitle = styled.div`
  margin: 12px 2px 0;
  color: #0f766e;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.02em;
`;

const KnowledgeHubCard = styled.div`
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 120;
  width: min(400px, calc(100vw - 48px));
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(187, 247, 208, 0.9);
  background: #ffffff;
  box-shadow: 0 20px 42px -30px rgba(15, 23, 42, 0.38);
`;

const KnowledgeHubTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: #0f172a;
  font-size: 13px;
  font-weight: 760;
`;

const KnowledgeHubDescription = styled.p`
  margin: 7px 0 0;
  color: #475569;
  font-size: 12px;
  line-height: 1.5;
`;

const KnowledgeHubActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
`;

const KnowledgeHubAction = styled.button<{ $primary?: boolean }>`
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

export function InputbarKnowledgeControl({
  knowledgePackSelection,
  knowledgePackOptions = [],
  inputText = "",
  openKnowledgeHubRequestKey,
  onToggleKnowledgePack,
  onSelectKnowledgePack,
  onToggleKnowledgeCompanionPack,
  onStartKnowledgeOrganize,
  onManageKnowledgePacks,
}: {
  knowledgePackSelection?: InputbarKnowledgePackSelection | null;
  knowledgePackOptions?: InputbarKnowledgePackOption[];
  inputText?: string;
  openKnowledgeHubRequestKey?: number;
  onToggleKnowledgePack?: (enabled: boolean) => void;
  onSelectKnowledgePack?: (packName: string) => void;
  onToggleKnowledgeCompanionPack?: (
    packName: string,
    enabled: boolean,
  ) => void;
  onStartKnowledgeOrganize?: () => void;
  onManageKnowledgePacks?: () => void;
}) {
  const [showKnowledgeHub, setShowKnowledgeHub] = useState(false);
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
  const readyOptions = useMemo(
    () =>
      normalizedOptions.filter((option) =>
        isReadyKnowledgePackStatus(option.status),
      ),
    [normalizedOptions],
  );
  const hiddenPendingCount = normalizedOptions.length - readyOptions.length;
  const optionLabelByName = useMemo(() => {
    const labels = new Map<string, string>();
    for (const option of normalizedOptions) {
      labels.set(option.packName, option.label || option.packName);
    }
    return labels;
  }, [normalizedOptions]);
  const companionPacks = knowledgePackSelection?.companionPacks ?? [];
  const implicitCompanionLabels = companionPacks
    .filter((pack) => pack.activation === "implicit")
    .map((pack) => optionLabelByName.get(pack.name) || pack.name);
  const explicitCompanionNames = new Set(
    companionPacks
      .filter((pack) => pack.activation === "explicit")
      .map((pack) => pack.name),
  );
  const companionCandidates = readyOptions.filter(
    (option) =>
      option.runtimeMode === "data" &&
      option.packName !== knowledgePackSelection?.packName,
  );
  const currentKnowledgePackLabel =
    knowledgePackSelection?.label ||
    knowledgePackSelection?.packName ||
    "项目资料";
  const effectiveKnowledgeEnabled = Boolean(
    knowledgePackSelection?.enabled &&
      isReadyKnowledgePackStatus(knowledgePackSelection.status),
  );
  const hubState = resolveKnowledgeHubState({
    knowledgePackSelection,
    knowledgePackOptions: normalizedOptions,
    hasInputText: Boolean(inputText.trim()),
    canManageKnowledgePacks: Boolean(onManageKnowledgePacks),
    canStartKnowledgeOrganize: Boolean(onStartKnowledgeOrganize),
  });
  const shouldShowSecondaryManageAction = Boolean(
    onManageKnowledgePacks &&
      hubState.primaryAction !== "manage" &&
      (readyOptions.length > 0 || hiddenPendingCount > 0),
  );
  const shouldShowSecondaryOrganizeAction = Boolean(
    onStartKnowledgeOrganize &&
      hubState.primaryAction !== "organize" &&
      hubState.primaryAction !== "supplement",
  );
  const secondaryOrganizeLabel = inputText.trim()
    ? "整理当前输入"
    : "添加新资料";
  const companionCount = companionPacks.length;
  const knowledgeToggleLabel = effectiveKnowledgeEnabled
    ? `资料：${currentKnowledgePackLabel}${companionCount ? ` +${companionCount}` : ""}`
    : shouldShowKnowledgePackToggle
      ? isReadyKnowledgePackStatus(knowledgePackSelection?.status)
        ? "资料可用"
        : "资料待确认"
      : "添加资料";

  useEffect(() => {
    if (!openKnowledgeHubRequestKey) {
      return;
    }
    setShowKnowledgeHub(true);
  }, [openKnowledgeHubRequestKey]);

  const handleSelectKnowledgePack = (option: InputbarKnowledgePackOption) => {
    onSelectKnowledgePack?.(option.packName);
    if (!isReadyKnowledgePackStatus(option.status)) {
      onManageKnowledgePacks?.();
      setShowKnowledgeHub(false);
      return;
    }
    onToggleKnowledgePack?.(true);
    setShowKnowledgeHub(false);
  };

  const handlePrimaryAction = () => {
    switch (hubState.primaryAction) {
      case "use":
        onToggleKnowledgePack?.(true);
        setShowKnowledgeHub(false);
        return;
      case "manage":
        onManageKnowledgePacks?.();
        setShowKnowledgeHub(false);
        return;
      case "organize":
      case "supplement":
        onStartKnowledgeOrganize?.();
        setShowKnowledgeHub(false);
        return;
      case "none":
      default:
        return;
    }
  };

  if (!shouldShowKnowledgePackToggle && !onStartKnowledgeOrganize) {
    return null;
  }

  return (
    <KnowledgePackControlWrap>
      <MetaToggleButton
        type="button"
        $checked={effectiveKnowledgeEnabled || showKnowledgeHub}
        aria-label="打开项目资料"
        aria-expanded={showKnowledgeHub}
        title={
          effectiveKnowledgeEnabled
            ? `正在使用项目资料：${currentKnowledgePackLabel}`
            : shouldShowKnowledgePackToggle
              ? `已有可用项目资料：${currentKnowledgePackLabel}。点击选择、添加或使用。`
              : "查看、添加或使用项目资料"
        }
        data-testid={
          shouldShowKnowledgePackToggle
            ? "inputbar-knowledge-pack-toggle"
            : "inputbar-knowledge-organize"
        }
        onClick={() => setShowKnowledgeHub((previous) => !previous)}
      >
        <MetaToggleCheck
          $checked={effectiveKnowledgeEnabled || showKnowledgeHub}
          aria-hidden
        />
        <MetaToggleGlyph aria-hidden>
          <BookOpen strokeWidth={1.8} />
        </MetaToggleGlyph>
        <MetaToggleLabel>{knowledgeToggleLabel}</MetaToggleLabel>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </MetaToggleButton>
      {showKnowledgeHub ? (
        <KnowledgeHubCard data-testid="inputbar-knowledge-hub">
          <KnowledgeHubTitle>
            <BookOpen className="h-4 w-4 text-emerald-600" />
            {hubState.title}
          </KnowledgeHubTitle>
          <KnowledgeHubDescription>
            {hubState.description}
          </KnowledgeHubDescription>
          {readyOptions.length > 0 ? (
            <>
              <KnowledgePackSectionTitle>主资料</KnowledgePackSectionTitle>
              <KnowledgePackMenu
                role="menu"
                data-testid="inputbar-knowledge-pack-menu"
              >
                {readyOptions.map((option) => {
                  const isSelected =
                    option.packName === knowledgePackSelection?.packName;
                  const label = option.label || option.packName;

                  return (
                    <KnowledgePackMenuItem
                      key={option.packName}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isSelected}
                      data-testid={`inputbar-knowledge-pack-option-${option.packName}`}
                      $active={isSelected}
                      onClick={() => handleSelectKnowledgePack(option)}
                    >
                      <KnowledgePackMenuItemTitle>
                        <span>{label}</span>
                        {option.defaultForWorkspace ? (
                          <KnowledgePackMenuBadge>默认</KnowledgePackMenuBadge>
                        ) : null}
                      </KnowledgePackMenuItemTitle>
                      <KnowledgePackMenuItemMeta>
                        已确认，可用于生成
                      </KnowledgePackMenuItemMeta>
                    </KnowledgePackMenuItem>
                  );
                })}
              </KnowledgePackMenu>
            </>
          ) : null}
          {implicitCompanionLabels.length > 0 ? (
            <KnowledgeHubDescription data-testid="inputbar-knowledge-implicit-companions">
              已自动搭配人设资料：{implicitCompanionLabels.join("、")}。
            </KnowledgeHubDescription>
          ) : null}
          {companionCandidates.length > 0 && onToggleKnowledgeCompanionPack ? (
            <>
              <KnowledgePackSectionTitle>
                协同资料（可多选）
              </KnowledgePackSectionTitle>
              <KnowledgePackMenu data-testid="inputbar-knowledge-companion-menu">
                {companionCandidates.map((option) => {
                  const isSelected = explicitCompanionNames.has(
                    option.packName,
                  );
                  const label = option.label || option.packName;

                  return (
                    <KnowledgePackMenuItem
                      key={option.packName}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={isSelected}
                      data-testid={`inputbar-knowledge-companion-option-${option.packName}`}
                      $active={isSelected}
                      onClick={() =>
                        onToggleKnowledgeCompanionPack(
                          option.packName,
                          !isSelected,
                        )
                      }
                    >
                      <KnowledgePackMenuItemTitle>
                        <span>{label}</span>
                        <KnowledgePackMenuBadge>
                          {isSelected ? "已协同" : "可协同"}
                        </KnowledgePackMenuBadge>
                      </KnowledgePackMenuItemTitle>
                      <KnowledgePackMenuItemMeta>
                        和主资料一起进入上下文，用于补充运营事实和执行边界
                      </KnowledgePackMenuItemMeta>
                    </KnowledgePackMenuItem>
                  );
                })}
              </KnowledgePackMenu>
            </>
          ) : null}
          {hiddenPendingCount > 0 ? (
            <KnowledgeHubDescription>
              还有 {hiddenPendingCount} 份资料待确认，确认后才会出现在可用列表里。
            </KnowledgeHubDescription>
          ) : null}
          <KnowledgeHubActions>
            {effectiveKnowledgeEnabled ? (
              <KnowledgeHubAction
                type="button"
                onClick={() => {
                  onToggleKnowledgePack?.(false);
                  setShowKnowledgeHub(false);
                }}
              >
                关闭资料
              </KnowledgeHubAction>
            ) : null}
            {shouldShowSecondaryOrganizeAction ? (
              <KnowledgeHubAction
                type="button"
                onClick={() => {
                  onStartKnowledgeOrganize?.();
                  setShowKnowledgeHub(false);
                }}
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                {secondaryOrganizeLabel}
              </KnowledgeHubAction>
            ) : null}
            {shouldShowSecondaryManageAction ? (
              <KnowledgeHubAction
                type="button"
                onClick={() => {
                  onManageKnowledgePacks?.();
                  setShowKnowledgeHub(false);
                }}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                检查资料
              </KnowledgeHubAction>
            ) : null}
            {hubState.primaryAction !== "none" ? (
              <KnowledgeHubAction
                type="button"
                $primary
                onClick={handlePrimaryAction}
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                {hubState.primaryLabel}
              </KnowledgeHubAction>
            ) : null}
          </KnowledgeHubActions>
        </KnowledgeHubCard>
      ) : null}
    </KnowledgePackControlWrap>
  );
}
