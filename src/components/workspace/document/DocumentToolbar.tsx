/**
 * @file 文档工具栏组件
 * @description 提供工作台风格的主稿工具条
 * @module components/workspace/document/DocumentToolbar
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import {
  Bot,
  Brain,
  ChevronDown,
  Download,
  FileText,
  Info,
  Image as ImageIcon,
  PlusCircle,
  Sparkles,
  Undo2,
  Redo2,
  Wand2,
  UsersRound,
  Zap,
} from "lucide-react";
import type {
  AutoContinueSettings,
  DocumentToolbarProps,
  ExportFormat,
} from "./types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ModelSelector } from "@/components/input-kit";
import { logRenderPerf } from "@/lib/perfDebug";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 16px 8px 20px;
  background: hsl(var(--background));
  border-bottom: 1px solid hsl(var(--border) / 0.5);
`;

const ToolbarRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: default;
  transition: all 0.2s;
  flex-shrink: 0;

  &:not(:disabled) {
    cursor: pointer;
  }

  &:not(:disabled):hover {
    background: hsl(var(--muted) / 0.8);
    color: hsl(var(--foreground));
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const Divider = styled.div`
  width: 1px;
  height: 16px;
  background: hsl(var(--border));
  margin: 0 4px;
  flex-shrink: 0;
`;

const QuickInsertMenu = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const QuickInsertItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;

  &:hover {
    background: hsl(var(--muted) / 0.75);
    color: hsl(var(--foreground));
  }
`;

const ActionPill = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  background: ${({ $active }) =>
    $active ? "hsl(var(--primary) / 0.08)" : "transparent"};
  color: ${({ $active }) =>
    $active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"};
  cursor: pointer;
  transition: all 0.2s ease-out;
  white-space: nowrap;
  flex-shrink: 0;

  &:hover {
    background: ${({ $active }) =>
      $active ? "hsl(var(--primary) / 0.12)" : "hsl(var(--muted) / 0.8)"};
    color: ${({ $active }) =>
      $active ? "hsl(var(--primary))" : "hsl(var(--foreground))"};
  }
`;

const ActionMeta = styled.span`
  font-size: 11px;
  color: hsl(var(--muted-foreground));
`;

const ActiveBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--primary));
  background: hsl(var(--primary) / 0.14);
`;

const AutoContinuePanel = styled.div`
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: hsl(var(--background));
  max-height: min(80vh, 560px);
  overflow-y: auto;
`;

const PanelSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SectionHint = styled.span`
  font-size: 12px;
  line-height: 1.5;
  color: hsl(var(--muted-foreground));
`;

const PanelDivider = styled.div`
  height: 1px;
  background: hsl(var(--border));
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const HeaderTitleWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const HeaderIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: hsl(var(--primary) / 0.14);
  color: hsl(var(--primary));
`;

const HeaderTitle = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const SettingLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: hsl(var(--foreground));
`;

const SectionTitle = styled(SettingLabel)`
  font-weight: 500;
`;

const SliderBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SliderHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const SliderMarks = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
`;

const SensitivityValue = styled.span`
  font-size: 11px;
  color: hsl(var(--muted-foreground));
`;

const RunButton = styled.button`
  height: 34px;
  width: 100%;
  border: 0;
  border-radius: 10px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const RunButtonWrap = styled.div`
  position: sticky;
  bottom: 0;
  padding-top: 4px;
  background: hsl(var(--background));
`;

const LENGTH_MARKS = ["短", "中", "长"] as const;

const isNestedModelSelectorTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return !!target.closest("[data-model-selector-popover='true']");
};

const resolveOutsideInteractionTarget = (event: {
  target: EventTarget | null;
  detail?: {
    originalEvent?: Event;
  };
}): EventTarget | null => {
  return event.detail?.originalEvent?.target ?? event.target;
};

/**
 * 文档工具栏组件
 */
export const DocumentToolbar: React.FC<DocumentToolbarProps> = memo(
  ({
    isStreaming = false,
    onExport,
    onAutoInsertImages,
    onAddImage,
    onImportDocument,
    onTextStylize,
    textStylizeSourceLabel,
    onContentReview,
    contentReviewActive = false,
    onUndo,
    onRedo,
    canUndo = false,
    canRedo = false,
    autoContinueSettings,
    autoContinueProviderType,
    onAutoContinueProviderChange,
    selectedAutoContinueModel,
    autoContinueModelLoading = false,
    onAutoContinueModelChange,
    thinkingEnabled,
    onThinkingChange,
    onAutoContinueSettingsChange,
    onAutoContinueRun,
    autoContinueRunDisabled = false,
  }) => {
    const [autoContinuePopoverOpen, setAutoContinuePopoverOpen] =
      useState(false);
    const [quickInsertPopoverOpen, setQuickInsertPopoverOpen] = useState(false);
    const [exportPopoverOpen, setExportPopoverOpen] = useState(false);
    const renderCountRef = useRef(0);
    const lastCommitAtRef = useRef<number | null>(null);
    renderCountRef.current += 1;
    const currentRenderCount = renderCountRef.current;
    const activeLength = Math.min(
      2,
      Math.max(0, Math.round(autoContinueSettings.continuationLength)),
    );
    const activeSensitivity = Math.min(
      100,
      Math.max(0, Math.round(autoContinueSettings.sensitivity)),
    );

    const patchAutoContinueSettings = (
      patch: Partial<AutoContinueSettings>,
    ) => {
      onAutoContinueSettingsChange?.(patch);
    };

    const handleAutoContinueRunClick = useCallback(() => {
      if (autoContinueRunDisabled) {
        return;
      }
      setAutoContinuePopoverOpen(false);
      onAutoContinueRun?.();
    }, [autoContinueRunDisabled, onAutoContinueRun]);

    const handleAddImageClick = useCallback(() => {
      setQuickInsertPopoverOpen(false);
      onAddImage?.();
    }, [onAddImage]);

    const handleImportDocumentClick = useCallback(() => {
      setQuickInsertPopoverOpen(false);
      onImportDocument?.();
    }, [onImportDocument]);

    const handleExportClick = useCallback(
      (format: ExportFormat) => {
        setExportPopoverOpen(false);
        onExport(format);
      },
      [onExport],
    );

    const hasQuickInsertActions = Boolean(onAddImage || onImportDocument);

    useEffect(() => {
      const now = performance.now();
      const sinceLastCommitMs =
        lastCommitAtRef.current === null ? null : now - lastCommitAtRef.current;
      lastCommitAtRef.current = now;
      logRenderPerf("DocumentToolbar", currentRenderCount, sinceLastCommitMs, {
        isStreaming,
        autoContinuePopoverOpen,
        autoContinueEnabled: autoContinueSettings.enabled,
        autoContinueRunDisabled,
        autoContinueModelLoading,
        contentReviewActive,
        hasProviderType: Boolean(autoContinueProviderType),
        hasModel: Boolean(selectedAutoContinueModel),
        thinkingEnabled,
      });
    });

    return (
      <Container>
        <ToolbarRow>
          <IconButton title="撤销" disabled={!canUndo} onClick={onUndo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton title="重做" disabled={!canRedo} onClick={onRedo}>
            <Redo2 size={16} />
          </IconButton>
          <Divider />
          {hasQuickInsertActions ? (
            <Popover
              modal={false}
              open={quickInsertPopoverOpen}
              onOpenChange={setQuickInsertPopoverOpen}
            >
              <PopoverTrigger asChild>
                <IconButton type="button" title="插入内容">
                  <PlusCircle size={16} />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent
                className="z-[70] w-[168px] p-1 bg-background opacity-100"
                align="start"
                sideOffset={8}
              >
                <QuickInsertMenu>
                  {onAddImage ? (
                    <QuickInsertItem
                      type="button"
                      onClick={handleAddImageClick}
                    >
                      <ImageIcon size={16} />
                      <span>添加图片</span>
                    </QuickInsertItem>
                  ) : null}
                  {onImportDocument ? (
                    <QuickInsertItem
                      type="button"
                      onClick={handleImportDocumentClick}
                    >
                      <FileText size={16} />
                      <span>导入文稿</span>
                    </QuickInsertItem>
                  ) : null}
                </QuickInsertMenu>
              </PopoverContent>
            </Popover>
          ) : (
            <IconButton
              onClick={onAutoInsertImages}
              title="自动配图"
              disabled={!onAutoInsertImages}
            >
              <PlusCircle size={16} />
            </IconButton>
          )}
          <Popover
            modal={false}
            open={exportPopoverOpen}
            onOpenChange={setExportPopoverOpen}
          >
            <PopoverTrigger asChild>
              <IconButton type="button" title="导出文稿">
                <Download size={16} />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent
              className="z-[70] w-[160px] p-1 bg-background opacity-100"
              align="start"
              sideOffset={8}
            >
              <QuickInsertMenu>
                <QuickInsertItem
                  type="button"
                  onClick={() => handleExportClick("markdown")}
                >
                  <span>Markdown</span>
                </QuickInsertItem>
                <QuickInsertItem
                  type="button"
                  onClick={() => handleExportClick("word")}
                >
                  <span>Word</span>
                </QuickInsertItem>
                <QuickInsertItem
                  type="button"
                  onClick={() => handleExportClick("text")}
                >
                  <span>纯文本</span>
                </QuickInsertItem>
                <QuickInsertItem
                  type="button"
                  onClick={() => handleExportClick("clipboard")}
                >
                  <span>复制到剪贴板</span>
                </QuickInsertItem>
              </QuickInsertMenu>
            </PopoverContent>
          </Popover>
          <Divider />
          <Popover
            modal={false}
            open={autoContinuePopoverOpen}
            onOpenChange={setAutoContinuePopoverOpen}
          >
            <PopoverTrigger asChild>
              <ActionPill
                type="button"
                $active={isStreaming || autoContinueSettings.enabled}
                title="自动续写设置"
              >
                <Sparkles size={16} />
                自动续写
                <ChevronDown size={14} />
              </ActionPill>
            </PopoverTrigger>
            <PopoverContent
              forceMount
              className="z-[70] w-[360px] max-w-[calc(100vw-24px)] max-h-[min(82vh,620px)] p-0 bg-background opacity-100 overflow-hidden"
              align="start"
              sideOffset={8}
              onInteractOutside={(event) => {
                const interactionTarget =
                  resolveOutsideInteractionTarget(event);
                if (isNestedModelSelectorTarget(interactionTarget)) {
                  event.preventDefault();
                  return;
                }
                setAutoContinuePopoverOpen(false);
              }}
              onFocusOutside={(event) => {
                const interactionTarget =
                  resolveOutsideInteractionTarget(event);
                if (isNestedModelSelectorTarget(interactionTarget)) {
                  event.preventDefault();
                  return;
                }
                setAutoContinuePopoverOpen(false);
              }}
              onEscapeKeyDown={() => {
                setAutoContinuePopoverOpen(false);
              }}
            >
              <AutoContinuePanel>
                <PanelHeader>
                  <HeaderTitleWrap>
                    <HeaderIcon>
                      <Sparkles size={15} />
                    </HeaderIcon>
                    <HeaderTitle>自动续写</HeaderTitle>
                  </HeaderTitleWrap>
                  <Switch
                    checked={autoContinueSettings.enabled}
                    onCheckedChange={(checked) =>
                      patchAutoContinueSettings({ enabled: checked })
                    }
                  />
                </PanelHeader>

                <PanelDivider />

                <PanelSection>
                  <SectionTitle>
                    <Bot size={14} />
                    模型切换
                  </SectionTitle>
                  <SectionHint>
                    这里沿用当前 Claw 会话的 Provider、模型与思考过程设置。
                  </SectionHint>
                  <ModelSelector
                    className="w-full"
                    providerType={autoContinueProviderType}
                    setProviderType={onAutoContinueProviderChange || (() => {})}
                    model={selectedAutoContinueModel}
                    setModel={onAutoContinueModelChange || (() => {})}
                    activeTheme="general"
                    popoverSide="bottom"
                    disabled={autoContinueModelLoading}
                  />
                </PanelSection>

                <PanelDivider />

                <PanelSection>
                  <SettingRow>
                    <SettingLabel>
                      <Brain size={14} />
                      思考过程
                      <Info size={12} />
                    </SettingLabel>
                    <Switch
                      checked={thinkingEnabled}
                      onCheckedChange={onThinkingChange}
                    />
                  </SettingRow>
                  <SettingRow>
                    <SettingLabel>
                      <Zap size={14} />
                      快速模式
                      <Info size={12} />
                    </SettingLabel>
                    <Switch
                      checked={autoContinueSettings.fastModeEnabled}
                      onCheckedChange={(checked) =>
                        patchAutoContinueSettings({ fastModeEnabled: checked })
                      }
                    />
                  </SettingRow>
                </PanelSection>

                <PanelDivider />

                <PanelSection>
                  <SliderBlock>
                    <SliderHeader>
                      <SettingLabel>续写长度</SettingLabel>
                    </SliderHeader>
                    <Slider
                      value={[activeLength]}
                      min={0}
                      max={2}
                      step={1}
                      onValueChange={(values) =>
                        patchAutoContinueSettings({
                          continuationLength: Math.round(values[0] ?? 0),
                        })
                      }
                    />
                    <SliderMarks>
                      {LENGTH_MARKS.map((label, index) => (
                        <span
                          key={label}
                          style={{
                            color:
                              index === activeLength
                                ? "hsl(var(--primary))"
                                : undefined,
                            fontWeight: index === activeLength ? 600 : 500,
                          }}
                        >
                          {label}
                        </span>
                      ))}
                    </SliderMarks>
                  </SliderBlock>

                  <SliderBlock>
                    <SliderHeader>
                      <SettingLabel>
                        续写灵敏度
                        <Info size={12} />
                      </SettingLabel>
                      <SensitivityValue>{activeSensitivity}%</SensitivityValue>
                    </SliderHeader>
                    <Slider
                      value={[activeSensitivity]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(values) =>
                        patchAutoContinueSettings({
                          sensitivity: Math.round(values[0] ?? 0),
                        })
                      }
                    />
                  </SliderBlock>
                </PanelSection>

                <PanelDivider />

                <RunButtonWrap>
                  <RunButton
                    type="button"
                    onClick={handleAutoContinueRunClick}
                    disabled={autoContinueRunDisabled}
                  >
                    开始自动续写
                  </RunButton>
                </RunButtonWrap>
              </AutoContinuePanel>
            </PopoverContent>
          </Popover>
          <ActionPill
            type="button"
            onClick={onTextStylize}
            title={
              textStylizeSourceLabel
                ? `当前生效风格：${textStylizeSourceLabel}`
                : undefined
            }
          >
            <Wand2 size={16} />
            文本风格化
            {textStylizeSourceLabel ? (
              <ActionMeta>{textStylizeSourceLabel}</ActionMeta>
            ) : null}
          </ActionPill>
          <ActionPill
            type="button"
            onClick={onContentReview}
            $active={contentReviewActive}
          >
            <UsersRound size={16} />
            内容评审
          </ActionPill>
          {isStreaming ? (
            <ActiveBadge>
              <Sparkles size={12} />
              自动编排中
            </ActiveBadge>
          ) : null}
        </ToolbarRow>
      </Container>
    );
  },
);

DocumentToolbar.displayName = "DocumentToolbar";
