import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ComposerController } from "./ComposerController";
import type {
  ComposerEditorHandle,
  ComposerEditorProps,
} from "./ComposerEditor";
import type { ComposerDraftSnapshot } from "./types";
import type { ComposerEnterBehavior } from "@/lib/api/appConfigTypes";

interface BaseComposerRenderContext {
  editorRef: React.RefObject<ComposerEditorHandle>;
  editorProps: ComposerEditorProps;
  hasContent: boolean;
  canSend: boolean;
  isPrimaryDisabled: boolean;
  onPrimaryActionStart: () => void;
  onPrimaryAction: () => void;
}

export type BaseComposerSendTriggerSource = "button" | "enter";

export interface BaseComposerSendMetadata {
  triggeredAt: number;
  triggerSource: BaseComposerSendTriggerSource;
  submitTarget?: "start" | "queue" | "steer" | "interrupt" | "command";
}

export interface BaseComposerProps {
  text: string;
  setText: (value: string) => void;
  onSend: (metadata?: BaseComposerSendMetadata) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onPaste?: (event: ClipboardEvent) => boolean | void;
  onKeyDown?: (event: KeyboardEvent) => boolean | void;
  onEscape?: () => void;
  onHistoryRecall?: (draft: ComposerDraftSnapshot) => void;
  editorRef?: React.RefObject<ComposerEditorHandle>;
  isFullscreen?: boolean;
  fillHeightWhenFullscreen?: boolean;
  sendOnEnter?: boolean;
  enterBehavior?: ComposerEnterBehavior;
  deferSendOnEnter?: boolean;
  maxAutoHeight?: number;
  hasAdditionalContent?: boolean;
  autoFocus?: boolean;
  allowSendWhileLoading?: boolean;
  allowEmptySend?: boolean;
  sendOnPointerDown?: boolean;
  controller?: ComposerController;
  children: (context: BaseComposerRenderContext) => React.ReactNode;
}

export const BaseComposer: React.FC<BaseComposerProps> = ({
  text,
  setText,
  onSend,
  onStop,
  isLoading = false,
  disabled = false,
  placeholder,
  onPaste,
  onKeyDown,
  onEscape,
  onHistoryRecall,
  editorRef: externalEditorRef,
  isFullscreen = false,
  fillHeightWhenFullscreen = false,
  sendOnEnter = true,
  enterBehavior = "enter",
  deferSendOnEnter = false,
  maxAutoHeight = 300,
  hasAdditionalContent = false,
  autoFocus = false,
  allowSendWhileLoading = false,
  allowEmptySend = false,
  sendOnPointerDown = false,
  controller: externalController,
  children,
}) => {
  const [localController] = useState(
    () => externalController ?? new ComposerController({ text }),
  );
  const controller = externalController ?? localController;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const internalEditorRef = useRef<ComposerEditorHandle>(null);
  const editorRef = externalEditorRef ?? internalEditorRef;
  const pendingPointerSendClickRef = useRef(false);
  const pendingPointerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const canSendRef = useRef(false);
  const onSendRef = useRef(onSend);
  const hasContent =
    allowEmptySend ||
    snapshot.document.text.trim().length > 0 ||
    hasAdditionalContent;
  const canSend =
    hasContent && !disabled && (!isLoading || allowSendWhileLoading);
  const isPrimaryDisabled =
    isLoading && !allowSendWhileLoading ? false : !canSend;
  canSendRef.current = canSend;
  onSendRef.current = onSend;

  useEffect(() => {
    controller.setText(text);
  }, [controller, text]);
  const emittedTextRef = useRef(snapshot.document.text);
  useEffect(() => {
    if (emittedTextRef.current === snapshot.document.text) return;
    emittedTextRef.current = snapshot.document.text;
    setText(snapshot.document.text);
  }, [setText, snapshot.document.text]);
  useEffect(
    () => () => {
      if (pendingPointerTimerRef.current)
        clearTimeout(pendingPointerTimerRef.current);
    },
    [],
  );
  useEffect(() => {
    const element = editorRef.current?.getElement();
    if (!element) return;
    element.style.maxHeight =
      isFullscreen && fillHeightWhenFullscreen ? "none" : `${maxAutoHeight}px`;
    element.style.height =
      isFullscreen && fillHeightWhenFullscreen ? "100%" : "auto";
  }, [
    editorRef,
    fillHeightWhenFullscreen,
    isFullscreen,
    maxAutoHeight,
    snapshot.document.text,
  ]);

  const dispatchPrimaryAction = useCallback(
    (triggeredAt: number) => {
      if (isLoading && !allowSendWhileLoading) {
        onStop?.();
        return;
      }
      if (canSend) onSend({ triggeredAt, triggerSource: "button" });
    },
    [allowSendWhileLoading, canSend, isLoading, onSend, onStop],
  );
  const onPrimaryActionStart = useCallback(() => {
    if (!sendOnPointerDown || pendingPointerSendClickRef.current) return;
    pendingPointerSendClickRef.current = true;
    pendingPointerTimerRef.current = setTimeout(() => {
      pendingPointerSendClickRef.current = false;
    }, 1000);
    dispatchPrimaryAction(Date.now());
  }, [dispatchPrimaryAction, sendOnPointerDown]);
  const onPrimaryAction = useCallback(() => {
    if (sendOnPointerDown && pendingPointerSendClickRef.current) {
      pendingPointerSendClickRef.current = false;
      return;
    }
    dispatchPrimaryAction(Date.now());
  }, [dispatchPrimaryAction, sendOnPointerDown]);
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented) return true;
      if (
        editorRef.current?.isComposing() ||
        event.isComposing ||
        event.key === "Process" ||
        event.keyCode === 229
      )
        return false;
      if (onKeyDown?.(event) === true || event.defaultPrevented) return true;
      if (
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        const document = controller.getDocument();
        const boundary = event.key === "ArrowUp" ? 0 : document.text.length;
        if (
          document.selectionStart === boundary &&
          document.selectionEnd === boundary
        ) {
          const draft = controller.recallHistory(
            event.key === "ArrowUp" ? "previous" : "next",
          );
          if (draft) {
            onHistoryRecall?.(draft);
            event.preventDefault();
            return true;
          }
        }
      }
      return false;
    },
    [controller, editorRef, onHistoryRecall, onKeyDown],
  );
  const handleSubmit = useCallback(() => {
    const triggeredAt = Date.now();
    if (!canSend) return;
    if (deferSendOnEnter) {
      window.requestAnimationFrame(() => {
        if (canSendRef.current)
          onSendRef.current({ triggeredAt, triggerSource: "enter" });
      });
    } else onSend({ triggeredAt, triggerSource: "enter" });
  }, [canSend, deferSendOnEnter, onSend]);
  const editorProps: ComposerEditorProps = {
    controller,
    editorRef,
    placeholder,
    ariaLabel: placeholder,
    disabled,
    autoFocus,
    onPaste,
    onKeyDown: handleKeyDown,
    onSubmit: handleSubmit,
    onEscape: isFullscreen ? onEscape : undefined,
    sendOnEnter,
    enterBehavior,
  };
  return (
    <>
      {children({
        editorRef,
        editorProps,
        hasContent,
        canSend,
        isPrimaryDisabled,
        onPrimaryActionStart,
        onPrimaryAction,
      })}
    </>
  );
};
