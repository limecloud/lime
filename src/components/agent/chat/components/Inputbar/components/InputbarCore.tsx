import React, { useCallback, useRef, useState } from "react";
import {
  ActionButtonGroup,
  Container,
  InputBarContainer,
  InputColumn,
  InputIconButton,
  MainRow,
  MetaSlot,
  StyledTextarea,
  BottomBar,
  LeftSection,
  SendButton,
  SecondaryActionButton,
  DragHandle,
  ImagePreviewContainer,
  ImagePreviewItem,
  ImagePreviewImg,
  ImageRemoveButton,
} from "../styles";
import { InputbarTools } from "./InputbarTools";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Loader2,
  Mic,
  Square,
  X,
} from "lucide-react";
import { BaseComposer } from "@/components/input-kit";
import type { MessageImage } from "../../../types";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import { QueuedTurnsPanel } from "./QueuedTurnsPanel";
import { useInputbarDictation } from "../hooks/useInputbarDictation";

const INTERACTIVE_TARGET_SELECTOR =
  "button, a, input, textarea, select, option, [role='button'], [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']";

function shouldFocusComposerTextarea(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  return !target.closest(INTERACTIVE_TARGET_SELECTOR);
}

interface InputbarCoreProps {
  text: string;
  setText: (text: string) => void;
  onSend: () => void;
  /** 停止生成回调 */
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  activeTools: Record<string, boolean>;
  onToolClick: (tool: string) => void;
  pendingImages?: MessageImage[];
  onRemoveImage?: (index: number) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  isFullscreen?: boolean;
  /** Textarea ref（用于 CharacterMention） */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  /** 输入框底栏左侧扩展区域 */
  leftExtra?: React.ReactNode;
  /** 输入框内部顶部扩展区域（textarea 上方） */
  topExtra?: React.ReactNode;
  /** 输入框提示文案 */
  placeholder?: string;
  /** 工具栏模式 */
  toolMode?: "default" | "attach-only";
  /** 是否显示顶部拖拽条 */
  showDragHandle?: boolean;
  /** 视觉风格 */
  visualVariant?: "default" | "floating";
  activeTheme?: string;
  queuedTurns?: QueuedTurnSnapshot[];
  onPromoteQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  onRemoveQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  showMetaTools?: boolean;
}

export const InputbarCore: React.FC<InputbarCoreProps> = ({
  text,
  setText,
  onSend,
  onStop,
  isLoading = false,
  disabled = false,
  activeTools,
  onToolClick,
  pendingImages = [],
  onRemoveImage,
  onPaste,
  isFullscreen = false,
  textareaRef: externalTextareaRef,
  leftExtra,
  topExtra,
  placeholder,
  toolMode = "default",
  showDragHandle = true,
  visualVariant = "default",
  activeTheme,
  queuedTurns = [],
  onPromoteQueuedTurn,
  onRemoveQueuedTurn,
  showMetaTools = true,
}) => {
  const [isTextareaExpanded, setIsTextareaExpanded] = useState(false);
  const inputBarContainerRef = useRef<HTMLDivElement | null>(null);
  const fallbackTextareaRef = useRef<HTMLTextAreaElement>(null);
  const resolvedTextareaRef = externalTextareaRef ?? fallbackTextareaRef;
  const isFloatingVariant = visualVariant === "floating";
  const {
    dictationEnabled,
    voiceConfigLoaded,
    dictationState,
    isDictating,
    isDictationBusy,
    isDictationProcessing,
    handleDictationToggle,
  } = useInputbarDictation({
    text,
    setText,
    textareaRef: resolvedTextareaRef,
    disabled,
  });
  const hasInlineComposerContent =
    text.trim().length > 0 || pendingImages.length > 0 || queuedTurns.length > 0;
  const shouldCollapseFloatingTools =
    isFloatingVariant &&
    toolMode === "attach-only" &&
    !hasInlineComposerContent;
  const shouldUseCompactFloatingComposer =
    shouldCollapseFloatingTools && !topExtra && !isTextareaExpanded;
  const containerClassName = [
    isFullscreen ? "flex-1 flex flex-col" : "",
    isFloatingVariant ? "floating-composer" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inputBarClassName = [
    isFullscreen ? "flex-1 flex flex-col" : "",
    isFloatingVariant ? "floating-composer" : "",
    shouldUseCompactFloatingComposer ? "floating-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const textareaClassName = [
    isFullscreen ? "flex-1 resize-none" : "",
    isFloatingVariant ? "floating-composer" : "",
    shouldUseCompactFloatingComposer ? "floating-collapsed" : "",
    isTextareaExpanded ? "composer-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const bottomBarClassName = [
    isFloatingVariant ? "floating-composer" : "",
    shouldUseCompactFloatingComposer ? "floating-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const mainRowClassName = [
    isFloatingVariant ? "floating-composer" : "",
    shouldUseCompactFloatingComposer ? "floating-collapsed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const leftSectionClassName = shouldCollapseFloatingTools
    ? "floating-collapsed"
    : "";
  const shouldRenderMetaBar =
    !shouldUseCompactFloatingComposer &&
    (Boolean(leftExtra) ||
      (toolMode === "default" && !shouldCollapseFloatingTools));
  const dictationButtonTitle = isDictationProcessing
    ? dictationState === "polishing"
      ? "语音润色中"
      : "语音识别中"
    : isDictating
      ? "停止语音输入"
      : dictationEnabled || !voiceConfigLoaded
        ? "开始语音输入"
        : "语音输入未启用";

  const handleRemoveImageMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const handleRemoveImageClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
      event.preventDefault();
      event.stopPropagation();
      onRemoveImage?.(index);
    },
    [onRemoveImage],
  );

  const handleToggleTextareaExpanded = useCallback(() => {
    setIsTextareaExpanded((previous) => !previous);
  }, []);

  return (
    <BaseComposer
      text={text}
      setText={setText}
      onSend={onSend}
      onStop={onStop}
      isLoading={isLoading}
      disabled={disabled}
      onPaste={onPaste}
      isFullscreen={isFullscreen}
      fillHeightWhenFullscreen
      hasAdditionalContent={pendingImages.length > 0}
      maxAutoHeight={isTextareaExpanded ? 360 : isFloatingVariant ? 240 : 120}
      textareaRef={resolvedTextareaRef}
      onEscape={() => onToolClick("fullscreen")}
      allowSendWhileLoading
      rows={isTextareaExpanded ? 7 : isFloatingVariant ? 3 : 1}
      placeholder={
        placeholder ||
        (isFullscreen
          ? "全屏编辑模式，按 ESC 退出，Enter 发送"
          : "在这里输入消息, 按 Enter 发送")
      }
    >
      {({ textareaProps, textareaRef, isPrimaryDisabled, onPrimaryAction }) => {
        const handleContainerMouseDownCapture = (
          event: React.MouseEvent<HTMLDivElement>,
        ) => {
          if (!isFloatingVariant || toolMode !== "attach-only") {
            return;
          }
          if (!shouldFocusComposerTextarea(event.target)) {
            return;
          }
          window.requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        };

        return (
          <Container className={containerClassName}>
            <InputBarContainer
              ref={inputBarContainerRef}
              data-testid="inputbar-core-container"
              className={inputBarClassName}
              onMouseDownCapture={handleContainerMouseDownCapture}
            >
              {!isFullscreen && showDragHandle && <DragHandle />}

              {pendingImages.length > 0 && (
                <ImagePreviewContainer>
                  {pendingImages.map((img, index) => (
                    <ImagePreviewItem key={index}>
                      <ImagePreviewImg
                        src={`data:${img.mediaType};base64,${img.data}`}
                        alt={`预览 ${index + 1}`}
                      />
                      <ImageRemoveButton
                        type="button"
                        aria-label={`移除图片 ${index + 1}`}
                        onMouseDown={handleRemoveImageMouseDown}
                        onClick={(event) =>
                          handleRemoveImageClick(event, index)
                        }
                      >
                        <X size={12} />
                      </ImageRemoveButton>
                    </ImagePreviewItem>
                  ))}
                </ImagePreviewContainer>
              )}

              {topExtra}
              <QueuedTurnsPanel
                queuedTurns={queuedTurns}
                onPromoteQueuedTurn={onPromoteQueuedTurn}
                onRemoveQueuedTurn={onRemoveQueuedTurn}
              />

              <MainRow className={mainRowClassName}>
                <InputIconButton
                  type="button"
                  onClick={() => onToolClick("attach")}
                  aria-label="添加图片"
                  title="添加图片"
                >
                  <ImagePlus size={14} />
                </InputIconButton>
                <InputColumn>
                  <StyledTextarea
                    ref={textareaRef}
                    {...textareaProps}
                    className={textareaClassName}
                  />
                </InputColumn>
                <ActionButtonGroup>
                  <InputIconButton
                    type="button"
                    onClick={handleToggleTextareaExpanded}
                    disabled={disabled}
                    className={isTextareaExpanded ? "is-active" : ""}
                    aria-label={
                      isTextareaExpanded ? "收起输入框" : "展开输入框"
                    }
                    title={isTextareaExpanded ? "收起输入框" : "展开输入框"}
                  >
                    {isTextareaExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronUp size={14} />
                    )}
                  </InputIconButton>
                  <InputIconButton
                    type="button"
                    onClick={() => void handleDictationToggle()}
                    disabled={disabled || isDictationProcessing}
                    className={
                      isDictationProcessing
                        ? "is-processing"
                        : isDictating
                          ? "is-recording"
                          : ""
                    }
                    aria-label={dictationButtonTitle}
                    title={dictationButtonTitle}
                  >
                    {isDictationProcessing ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : isDictating ? (
                      <Square size={14} fill="currentColor" />
                    ) : (
                      <Mic size={14} />
                    )}
                  </InputIconButton>
                  {isLoading ? (
                    <SecondaryActionButton
                      type="button"
                      onClick={onPrimaryAction}
                      disabled={isPrimaryDisabled}
                    >
                      <span>稍后处理</span>
                    </SecondaryActionButton>
                  ) : null}
                  {isLoading ? (
                    <InputIconButton
                      type="button"
                      onClick={onStop}
                      disabled={!onStop}
                      $destructive
                      aria-label="停止"
                      title="停止"
                    >
                      <Square size={14} fill="currentColor" />
                    </InputIconButton>
                  ) : null}
                  {!isLoading ? (
                    <SendButton
                      type="button"
                      onClick={onPrimaryAction}
                      disabled={isPrimaryDisabled || isDictationBusy}
                      aria-label="发送"
                      title="发送"
                    >
                      <ArrowUp size={16} strokeWidth={2.4} />
                    </SendButton>
                  ) : null}
                </ActionButtonGroup>
              </MainRow>

              {shouldRenderMetaBar ? (
                <BottomBar className={bottomBarClassName}>
                  <LeftSection className={leftSectionClassName}>
                    {leftExtra ? <MetaSlot>{leftExtra}</MetaSlot> : null}
                    {!shouldCollapseFloatingTools && showMetaTools ? (
                      <InputbarTools
                        onToolClick={onToolClick}
                        activeTools={activeTools}
                        toolMode={toolMode}
                        activeTheme={activeTheme}
                      />
                    ) : null}
                  </LeftSection>
                </BottomBar>
              ) : null}
            </InputBarContainer>
          </Container>
        );
      }}
    </BaseComposer>
  );
};
