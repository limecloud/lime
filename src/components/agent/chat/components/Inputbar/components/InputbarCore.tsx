import { useComposerCommand } from "@/components/input-kit/useComposerCommand";
import type { ComposerDraftSnapshot } from "@/components/input-kit";
import type { ComposerEditorHandle } from "@/components/input-kit";
import React, {
  useCallback,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";
import { QuestionSelectionContext } from "../../asyncUserInput/QuestionSelectionContext";
import { toast } from "sonner";
import {
  ActionButtonGroup,
  InputIconButton,
  MetaSlot,
  SendButton,
  SecondaryActionButton,
  ImagePreviewContainer,
  ImagePreviewItem,
  ImagePreviewImg,
  ImageRemoveButton,
  PathReferenceChip,
  PathReferenceContainer,
  PathReferenceIcon,
  PathReferenceName,
  PathReferencePath,
  PathReferenceRemoveButton,
  PathReferenceText,
} from "../styles";
import {
  Container,
  DictationRecordingDot,
  DictationRecordingDuration,
  DictationRecordingWaveform,
  DictationLiveTranscript,
  InputBarContainer,
  InputColumn,
  StyledComposerEditor,
  DragHandle,
  ExpansionControl,
} from "../composerStyles";
import { AdaptiveFooter } from "./ComposerLayout";
import { useComposerLayout } from "./useComposerLayout";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  FileText,
  Folder,
  Loader2,
  Mic,
  ListPlus,
  Plus,
  Square,
  X,
} from "lucide-react";
import {
  BaseComposer,
  type BaseComposerSendMetadata,
  ComposerController,
} from "@/components/input-kit";
import type { MessageImage, MessagePathReference } from "../../../types";
import type { InputbarCoreCopy } from "./inputbarCoreCopy";
import {
  ContextualSuggestions,
  type ContextualSuggestionsConfig,
} from "./ContextualSuggestions";
import { useInputbarDictation } from "../hooks/useInputbarDictation";
import { useDesktopPreferences } from "@/hooks/useDesktopPreferences";
import { effectiveDesktopPreferences } from "@/lib/api/desktopPreferences";

const INTERACTIVE_TARGET_SELECTOR =
  "button, a, input, textarea, select, option, [role='button'], [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']";

function shouldFocusComposerEditor(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return true;
  }
  return !target.closest(INTERACTIVE_TARGET_SELECTOR);
}

function resolvePendingImagePreviewSrc(image: MessageImage): string {
  const previewUrl = image.previewUrl?.trim();
  if (previewUrl) {
    return previewUrl;
  }
  if (image.data.trim()) {
    return `data:${image.mediaType};base64,${image.data}`;
  }
  return image.sourceUri?.trim() || image.sourcePath?.trim() || "";
}

function formatRecordingDuration(durationSecs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationSecs));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = `${totalSeconds % 60}`.padStart(2, "0");
  return `${minutes}:${seconds}`;
}

interface InputbarCoreProps {
  uiCopy: InputbarCoreCopy;
  controller?: ComposerController;
  onHistoryRecall?: (draft: ComposerDraftSnapshot) => void;
  text: string;
  hasAdditionalContent?: boolean;
  setText: (text: string) => void;
  onSend: (metadata?: BaseComposerSendMetadata) => void;
  /** 停止生成回调 */
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  onToolClick: (tool: string) => void;
  pendingImages?: MessageImage[];
  onRemoveImage?: (index: number) => void;
  pathReferences?: MessagePathReference[];
  onRemovePathReference?: (id: string) => void;
  onPaste?: (e: ClipboardEvent) => boolean | void;
  onKeyDown?: (e: KeyboardEvent) => boolean | void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  isFullscreen?: boolean;
  /** EditorView handle，用于共享建议列表和焦点恢复。 */
  editorRef?: React.RefObject<ComposerEditorHandle>;
  /** 输入框底栏左侧扩展区域 */
  leftExtra?: React.ReactNode;
  /** 输入框底栏尾部元信息区域 */
  trailingMeta?: React.ReactNode;
  /** 输入框内部顶部扩展区域（编辑器上方） */
  topExtra?: React.ReactNode;
  /** 输入框提示文案 */
  placeholder?: string;
  /** 是否显示顶部拖拽条 */
  showDragHandle?: boolean;
  /** 视觉风格 */
  visualVariant?: "default" | "floating";
  /** 下方是否连接外部上下文托盘 */
  connectedContextBar?: boolean;
  /** Enter 发送延后一帧，优先释放首页首帧渲染。 */
  deferSendOnEnter?: boolean;
  /** 首页首发按钮在 pointerdown 阶段预提交，避免 click 前后出现空首页帧。 */
  sendOnPointerDown?: boolean;
  /** 当前输入所属会话，用于隔离异步听写与编辑器运行态。 */
  sessionId?: string | null;
  commandPriority?: "normal" | "fallback";
  showEditorExpandButton?: boolean;
  contextualSuggestions: ContextualSuggestionsConfig;
}

export const InputbarCore: React.FC<InputbarCoreProps> = ({
  uiCopy,
  controller: externalController,
  text,
  hasAdditionalContent = false,
  setText,
  onSend,
  onHistoryRecall,
  onStop,
  isLoading = false,
  disabled = false,
  onToolClick,
  pendingImages = [],
  onRemoveImage,
  pathReferences = [],
  onRemovePathReference,
  onPaste,
  onKeyDown,
  onDragOver,
  onDrop,
  isFullscreen = false,
  editorRef: externalEditorRef,
  leftExtra,
  trailingMeta,
  topExtra,
  placeholder,
  showDragHandle = true,
  visualVariant = "default",
  connectedContextBar = false,
  deferSendOnEnter = false,
  sendOnPointerDown = false,
  sessionId = null,
  commandPriority,
  showEditorExpandButton = true,
  contextualSuggestions,
}) => {
  const { t } = useTranslation("agent");
  const { configured: desktopPreferences } = useDesktopPreferences();
  const { composerEnterBehavior } = effectiveDesktopPreferences(
    desktopPreferences ?? undefined,
  );
  const [fallbackController] = useState(
    () => externalController ?? new ComposerController({ text }),
  );
  const controller = externalController ?? fallbackController;
  const suggestion = useSyncExternalStore(
    controller.subscribe,
    controller.getSuggestion,
  );
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const inputBarContainerRef = useRef<HTMLDivElement | null>(null);
  const fallbackEditorRef = useRef<ComposerEditorHandle>(null);
  const resolvedEditorRef = externalEditorRef ?? fallbackEditorRef;
  const {
    dictationEnabled,
    dictationState,
    liveTranscript,
    recordingStatus,
    isDictationBusy,
    isDictationStarting,
    isDictationProcessing,
    handleDictationToggle,
    handleDictationCancel,
    discardDictationSession,
  } = useInputbarDictation({
    setText,
    editorRef: resolvedEditorRef,
    controller,
    sessionId,
    disabled: disabled || isLoading,
  });
  const dictationShowTranscript = isDictationBusy
    ? Boolean(liveTranscript.trim())
    : undefined;
  const isAwaitingInput = useContext(QuestionSelectionContext);
  const composerLayout = useComposerLayout({
    controller,
    editorRef: resolvedEditorRef,
    hasVisibleAttachments:
      pendingImages.length > 0 || pathReferences.length > 0,
    dictationShowTranscript,
    isAwaitingInput,
  });
  const composerDisabled = disabled || isDictationBusy;
  useComposerCommand({
    scope: sessionId,
    editor: resolvedEditorRef,
    disabled: composerDisabled,
    addFiles: contextualSuggestions.onAddFiles,
    priority: commandPriority,
  });
  const isFloatingVariant = visualVariant === "floating";
  const containerClassName = [
    isFullscreen ? "flex-1 flex flex-col" : "",
    isFloatingVariant ? "floating-composer" : "",
    connectedContextBar ? "context-connected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const inputBarClassName = containerClassName;
  const editorClassName = [
    isFullscreen ? "flex-1 resize-none" : "",
    isFloatingVariant ? "floating-composer" : "",
    isEditorExpanded ? "composer-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");
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

  const handleToggleEditorExpanded = useCallback(() => {
    setIsEditorExpanded((previous) => !previous);
  }, []);

  return (
    <BaseComposer
      controller={controller}
      text={text}
      setText={setText}
      onSend={onSend}
      onHistoryRecall={onHistoryRecall}
      onStop={onStop}
      isLoading={isLoading}
      disabled={composerDisabled}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      sendOnEnter={desktopPreferences !== null}
      enterBehavior={composerEnterBehavior}
      isFullscreen={isFullscreen}
      fillHeightWhenFullscreen
      hasAdditionalContent={
        hasAdditionalContent ||
        pendingImages.length > 0 ||
        pathReferences.length > 0
      }
      maxAutoHeight={isEditorExpanded ? 360 : isFloatingVariant ? 240 : 120}
      editorRef={resolvedEditorRef}
      onEscape={() => onToolClick("fullscreen")}
      allowSendWhileLoading
      deferSendOnEnter={deferSendOnEnter}
      sendOnPointerDown={sendOnPointerDown}
      placeholder={
        placeholder ||
        (isFullscreen
          ? uiCopy.placeholder.fullscreen
          : uiCopy.placeholder.default)
      }
    >
      {({
        editorProps,
        editorRef,
        isPrimaryDisabled,
        onPrimaryAction,
        onPrimaryActionStart,
      }) => {
        const loadingSecondaryActionLabel = isPrimaryDisabled
          ? uiCopy.action.running
          : uiCopy.action.defer;
        const recordingLabel = uiCopy.dictation.recording(
          formatRecordingDuration(recordingStatus?.duration ?? 0),
        );
        const dictationButtonLabel =
          dictationState === "listening"
            ? uiCopy.dictation.stopRecording(recordingLabel)
            : isDictationStarting
              ? uiCopy.dictation.starting
              : isDictationProcessing
                ? uiCopy.dictation.transcribing
                : uiCopy.dictation.start;
        const dictationButtonClassName = [
          "is-dictation",
          dictationState === "listening" ? "is-recording" : "",
          isDictationStarting || isDictationProcessing ? "is-processing" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const handleContainerMouseDownCapture = (
          event: React.MouseEvent<HTMLDivElement>,
        ) => {
          if (!isFloatingVariant) {
            return;
          }
          if (!shouldFocusComposerEditor(event.target)) {
            return;
          }
          window.requestAnimationFrame(() => {
            editorRef.current?.focus();
          });
        };

        const primaryActions = (
          <ActionButtonGroup data-testid="inputbar-primary-actions">
            {dictationEnabled ? (
              <InputIconButton
                type="button"
                data-testid="inputbar-dictation-toggle"
                onClick={() => {
                  void handleDictationToggle();
                }}
                disabled={
                  disabled ||
                  isLoading ||
                  (isDictationBusy && dictationState !== "listening")
                }
                className={dictationButtonClassName}
                aria-label={dictationButtonLabel}
                aria-pressed={dictationState === "listening"}
                title={dictationButtonLabel}
              >
                {dictationState === "listening" ? (
                  <>
                    <DictationRecordingDot aria-hidden />
                    <DictationRecordingDuration>
                      {formatRecordingDuration(recordingStatus?.duration ?? 0)}
                    </DictationRecordingDuration>
                    <DictationRecordingWaveform aria-hidden />
                    <Mic size={14} aria-hidden />
                  </>
                ) : isDictationStarting || isDictationProcessing ? (
                  <Loader2 size={14} aria-hidden />
                ) : (
                  <Mic size={14} aria-hidden />
                )}
              </InputIconButton>
            ) : null}
            {isDictationBusy ? (
              <InputIconButton
                type="button"
                data-testid="inputbar-dictation-cancel"
                onClick={handleDictationCancel}
                aria-label={uiCopy.dictation.cancel}
                title={uiCopy.dictation.cancel}
              >
                <X size={14} aria-hidden />
              </InputIconButton>
            ) : null}
            {isLoading ? (
              <SecondaryActionButton
                type="button"
                onClick={onPrimaryAction}
                disabled={isPrimaryDisabled}
                aria-label={loadingSecondaryActionLabel}
                title={loadingSecondaryActionLabel}
              >
                <span>{loadingSecondaryActionLabel}</span>
              </SecondaryActionButton>
            ) : null}
            {isLoading ? (
              <InputIconButton
                type="button"
                onClick={() =>
                  onSend({
                    triggeredAt: Date.now(),
                    triggerSource: "button",
                    submitTarget: "queue",
                  })
                }
                disabled={isPrimaryDisabled}
                aria-label={uiCopy.action.queue}
                title={uiCopy.action.queue}
              >
                <ListPlus size={14} />
              </InputIconButton>
            ) : null}
            {isLoading ? (
              <InputIconButton
                type="button"
                onClick={onStop}
                disabled={!onStop}
                $destructive
                aria-label={uiCopy.action.stop}
                title={uiCopy.action.stop}
              >
                <Square size={14} fill="currentColor" />
              </InputIconButton>
            ) : null}
            {!isLoading && !isDictationBusy ? (
              <SendButton
                type="button"
                data-testid="send-btn"
                onPointerDown={
                  sendOnPointerDown ? onPrimaryActionStart : undefined
                }
                onClick={onPrimaryAction}
                disabled={isPrimaryDisabled}
                aria-label={uiCopy.action.send}
                title={uiCopy.action.send}
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </SendButton>
            ) : null}
          </ActionButtonGroup>
        );

        return (
          <Container className={containerClassName}>
            <InputBarContainer
              ref={inputBarContainerRef}
              data-testid="inputbar-core-container"
              data-composer-layout={composerLayout.bodyLayout}
              className={inputBarClassName}
              onMouseDownCapture={handleContainerMouseDownCapture}
              onDragEnterCapture={onDragOver}
              onDragOverCapture={onDragOver}
              onDropCapture={onDrop}
            >
              <ContextualSuggestions
                controller={controller}
                config={contextualSuggestions}
                editorRef={resolvedEditorRef}
                anchorRef={inputBarContainerRef}
                disabled={composerDisabled}
              />
              {!isFullscreen && showDragHandle && <DragHandle />}

              {pendingImages.length > 0 && (
                <ImagePreviewContainer>
                  {pendingImages.map((img, index) => (
                    <ImagePreviewItem key={index}>
                      <ImagePreviewImg
                        src={resolvePendingImagePreviewSrc(img)}
                        alt={uiCopy.image.previewAlt(index + 1)}
                      />
                      <ImageRemoveButton
                        type="button"
                        aria-label={uiCopy.image.remove(index + 1)}
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
                <PathReferenceContainer aria-label={uiCopy.path.containerLabel}>
                  {pathReferences.map((reference) => {
                    const ReferenceIcon = reference.isDir ? Folder : FileText;
                    return (
                      <PathReferenceChip
                        key={reference.id}
                        data-reference-id={reference.id}
                        data-reference-path={reference.path}
                        data-reference-is-dir={String(reference.isDir)}
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
                            {reference.isDir
                              ? uiCopy.path.localFolder
                              : uiCopy.path.localFile}
                          </PathReferencePath>
                        </PathReferenceText>
                        <PathReferenceRemoveButton
                          type="button"
                          aria-label={uiCopy.path.remove(reference.name)}
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
              {showEditorExpandButton ? (
                <ExpansionControl>
                  <InputIconButton
                    type="button"
                    onClick={handleToggleEditorExpanded}
                    disabled={disabled}
                    data-testid="inputbar-expand-toggle"
                    data-composer-expand-toggle=""
                    className={isEditorExpanded ? "is-active" : ""}
                    aria-label={
                      isEditorExpanded
                        ? uiCopy.editor.collapse
                        : uiCopy.editor.expand
                    }
                    title={
                      isEditorExpanded
                        ? uiCopy.editor.collapse
                        : uiCopy.editor.expand
                    }
                  >
                    {isEditorExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronUp size={14} />
                    )}
                  </InputIconButton>
                </ExpansionControl>
              ) : null}
              <AdaptiveFooter
                input={
                  <InputColumn>
                    <StyledComposerEditor
                      {...editorProps}
                      onCompositionStateChange={(active) => {
                        composerLayout.onCompositionStateChange(active);
                        editorProps.onCompositionStateChange?.(active);
                        if (active && discardDictationSession()) {
                          toast.info(uiCopy.dictation.interruptedByComposition);
                        }
                      }}
                      sessionId={sessionId ?? undefined}
                      className={editorClassName}
                    />
                    {liveTranscript.trim() ? (
                      <DictationLiveTranscript
                        role="status"
                        aria-label={uiCopy.dictation.liveTranscript}
                        data-testid="inputbar-dictation-live-transcript"
                      >
                        {liveTranscript}
                      </DictationLiveTranscript>
                    ) : null}
                  </InputColumn>
                }
                leadingControls={
                  <MetaSlot data-testid="inputbar-meta-left">
                    <InputIconButton
                      type="button"
                      aria-label={t("agentChat.inputbar.suggestions.label")}
                      title={t("agentChat.inputbar.suggestions.label")}
                      aria-expanded={
                        suggestion.active && suggestion.trigger === "+"
                      }
                      data-testid="inputbar-plus-trigger"
                      disabled={composerDisabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        controller.toggleContextSuggestions();
                        resolvedEditorRef.current?.focus();
                      }}
                    >
                      <Plus size={15} />
                    </InputIconButton>
                    {leftExtra}
                  </MetaSlot>
                }
                modelControl={
                  trailingMeta ? (
                    <MetaSlot data-testid="inputbar-meta-trailing">
                      {trailingMeta}
                    </MetaSlot>
                  ) : null
                }
                trailingControls={isDictationBusy ? null : primaryActions}
                inputRef={composerLayout.inputRef}
                layout={composerLayout.layout}
                isComposing={composerLayout.isComposing}
                dictation={
                  isDictationBusy
                    ? {
                        showTranscript: Boolean(dictationShowTranscript),
                        controls: primaryActions,
                      }
                    : undefined
                }
              />
            </InputBarContainer>
          </Container>
        );
      }}
    </BaseComposer>
  );
};
