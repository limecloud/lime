import React, { useCallback, useRef, useState } from "react";
import {
  ActionButtonGroup,
  Container,
  InputBarContainer,
  InputColumn,
  DictationRecordingDuration,
  DictationRecordingGlyph,
  InputIconButton,
  InputSuggestionKeycap,
  InputSuggestionLayer,
  InputSuggestionText,
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
  PathReferenceChip,
  PathReferenceContainer,
  PathReferenceIcon,
  PathReferenceKnowledgeButton,
  PathReferenceName,
  PathReferencePath,
  PathReferenceRemoveButton,
  PathReferenceText,
} from "../styles";
import { InputbarTools } from "./InputbarTools";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  FileText,
  Folder,
  ImagePlus,
  Loader2,
  Mic,
  Square,
  X,
} from "lucide-react";
import { BaseComposer } from "@/components/input-kit";
import { isKnowledgeTextSourceCandidate } from "@/features/knowledge/import/knowledgeSourceSupport";
import type { MessageImage, MessagePathReference } from "../../../types";
import type { QueuedTurnSnapshot } from "@/lib/api/agentRuntime";
import { QueuedTurnsPanel } from "./QueuedTurnsPanel";
import { useInputbarDictation } from "../hooks/useInputbarDictation";

const INTERACTIVE_TARGET_SELECTOR =
  "button, a, input, textarea, select, option, [role='button'], [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']";

function formatDictationDuration(duration = 0): string {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const minutes = Math.floor(safeDuration / 60);
  const seconds = Math.floor(safeDuration % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function buildDictationStatusText(
  state: "idle" | "listening" | "transcribing" | "polishing",
  duration = 0,
): string {
  switch (state) {
    case "listening":
      return `录音中 ${formatDictationDuration(duration)}`;
    case "transcribing":
      return "识别中";
    case "polishing":
      return "润色中";
    case "idle":
    default:
      return "";
  }
}

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
  pathReferences?: MessagePathReference[];
  onImportPathReferenceAsKnowledge?: (reference: MessagePathReference) => void;
  onRemovePathReference?: (id: string) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
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
  /** Enter 发送延后一帧，优先释放首页首帧渲染。 */
  deferSendOnEnter?: boolean;
  activeTheme?: string;
  queuedTurns?: QueuedTurnSnapshot[];
  onPromoteQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  onRemoveQueuedTurn?: (queuedTurnId: string) => void | Promise<boolean>;
  showMetaTools?: boolean;
  inputSuggestion?: {
    label: string;
    prompt: string;
    testId?: string;
  } | null;
  onAcceptInputSuggestion?: (suggestion: {
    label: string;
    prompt: string;
    testId?: string;
  }) => void;
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
  pathReferences = [],
  onImportPathReferenceAsKnowledge,
  onRemovePathReference,
  onPaste,
  onDragOver,
  onDrop,
  isFullscreen = false,
  textareaRef: externalTextareaRef,
  leftExtra,
  topExtra,
  placeholder,
  toolMode = "default",
  showDragHandle = true,
  visualVariant = "default",
  deferSendOnEnter = false,
  activeTheme,
  queuedTurns = [],
  onPromoteQueuedTurn,
  onRemoveQueuedTurn,
  showMetaTools = true,
  inputSuggestion = null,
  onAcceptInputSuggestion,
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
    recordingStatus,
    liveTranscript,
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
    text.trim().length > 0 ||
    pendingImages.length > 0 ||
    pathReferences.length > 0 ||
    queuedTurns.length > 0;
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
  const shouldShowInputSuggestion =
    Boolean(inputSuggestion) && text.trim().length === 0 && !disabled;
  const dictationStatusText = buildDictationStatusText(
    dictationState,
    recordingStatus?.duration,
  );
  const dictationStatusLabel =
    dictationState === "listening" && liveTranscript
      ? `${dictationStatusText} · 实时识别`
      : dictationStatusText;
  const dictationButtonTitle = isDictationProcessing
    ? dictationState === "polishing"
      ? "语音润色中"
      : "语音识别中"
    : isDictating
      ? `${dictationStatusLabel || "录音中"}，点击停止`
      : dictationEnabled || !voiceConfigLoaded
        ? "开始语音输入"
        : "语音输入未启用";

  const handleInputSuggestionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        !inputSuggestion ||
        event.key !== "Tab" ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        text.trim().length > 0 ||
        disabled
      ) {
        return;
      }

      const nativeEvent = event.nativeEvent as KeyboardEvent & {
        isComposing?: boolean;
      };
      if (
        nativeEvent.isComposing ||
        nativeEvent.key === "Process" ||
        nativeEvent.keyCode === 229
      ) {
        return;
      }

      event.preventDefault();
      const acceptedText = inputSuggestion.prompt;
      if (onAcceptInputSuggestion) {
        onAcceptInputSuggestion(inputSuggestion);
      } else {
        setText(acceptedText);
      }
      window.requestAnimationFrame(() => {
        const textarea = resolvedTextareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(acceptedText.length, acceptedText.length);
      });
    },
    [
      disabled,
      inputSuggestion,
      onAcceptInputSuggestion,
      resolvedTextareaRef,
      setText,
      text,
    ],
  );

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

  const handleRemovePathReferenceMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );

  const handleRemovePathReferenceClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, id: string) => {
      event.preventDefault();
      event.stopPropagation();
      onRemovePathReference?.(id);
    },
    [onRemovePathReference],
  );
  const handleImportPathReferenceMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
    },
    [],
  );
  const handleImportPathReferenceClick = useCallback(
    (
      event: React.MouseEvent<HTMLButtonElement>,
      reference: MessagePathReference,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      onImportPathReferenceAsKnowledge?.(reference);
    },
    [onImportPathReferenceAsKnowledge],
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
      onKeyDown={handleInputSuggestionKeyDown}
      isFullscreen={isFullscreen}
      fillHeightWhenFullscreen
      hasAdditionalContent={
        pendingImages.length > 0 || pathReferences.length > 0
      }
      maxAutoHeight={isTextareaExpanded ? 360 : isFloatingVariant ? 240 : 120}
      textareaRef={resolvedTextareaRef}
      onEscape={() => onToolClick("fullscreen")}
      allowSendWhileLoading
      deferSendOnEnter={deferSendOnEnter}
      rows={isTextareaExpanded ? 7 : isFloatingVariant ? 3 : 1}
      placeholder={
        shouldShowInputSuggestion
          ? ""
          : placeholder ||
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
              onDragEnterCapture={onDragOver}
              onDragOverCapture={onDragOver}
              onDropCapture={onDrop}
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

              {pathReferences.length > 0 ? (
                <PathReferenceContainer aria-label="已添加的本地路径">
                  {pathReferences.map((reference) => {
                    const ReferenceIcon = reference.isDir ? Folder : FileText;
                    return (
                      <PathReferenceChip
                        key={reference.id}
                        title={reference.name}
                        data-testid="inputbar-path-reference-chip"
                      >
                        <PathReferenceIcon $isDir={reference.isDir}>
                          <ReferenceIcon size={14} aria-hidden />
                        </PathReferenceIcon>
                        <PathReferenceText>
                          <PathReferenceName>
                            {reference.name}
                          </PathReferenceName>
                          <PathReferencePath>
                            {reference.isDir ? "本地文件夹" : "本地文件"}
                          </PathReferencePath>
                        </PathReferenceText>
                        {onImportPathReferenceAsKnowledge &&
                        isKnowledgeTextSourceCandidate(reference) ? (
                          <PathReferenceKnowledgeButton
                            type="button"
                            aria-label={`设为项目资料 ${reference.name}`}
                            onMouseDown={handleImportPathReferenceMouseDown}
                            onClick={(event) =>
                              handleImportPathReferenceClick(event, reference)
                            }
                          >
                            <FileText size={12} aria-hidden />
                            设为资料
                          </PathReferenceKnowledgeButton>
                        ) : null}
                        <PathReferenceRemoveButton
                          type="button"
                          aria-label={`移除路径 ${reference.name}`}
                          onMouseDown={handleRemovePathReferenceMouseDown}
                          onClick={(event) =>
                            handleRemovePathReferenceClick(event, reference.id)
                          }
                        >
                          <X size={12} />
                        </PathReferenceRemoveButton>
                      </PathReferenceChip>
                    );
                  })}
                </PathReferenceContainer>
              ) : null}

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
                  {shouldShowInputSuggestion && inputSuggestion ? (
                    <InputSuggestionLayer
                      className={textareaClassName}
                      data-testid="home-input-tab-suggestion"
                      title="按 Tab 使用这条起手建议"
                    >
                      <InputSuggestionText>
                        {inputSuggestion.label}
                      </InputSuggestionText>
                      <InputSuggestionKeycap>tab</InputSuggestionKeycap>
                    </InputSuggestionLayer>
                  ) : null}
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
                      <>
                        <DictationRecordingGlyph aria-hidden="true" />
                        <DictationRecordingDuration>
                          {formatDictationDuration(recordingStatus?.duration)}
                        </DictationRecordingDuration>
                      </>
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
                  {!isLoading && !isDictationBusy ? (
                    <SendButton
                      type="button"
                      onClick={onPrimaryAction}
                      disabled={isPrimaryDisabled}
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
