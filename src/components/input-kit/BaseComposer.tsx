import React, { useCallback, useEffect, useId, useMemo, useRef } from "react";

interface BaseComposerRenderContext {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement>;
  hasContent: boolean;
  canSend: boolean;
  isPrimaryDisabled: boolean;
  onPrimaryAction: () => void;
}

export interface BaseComposerProps {
  text: string;
  setText: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onPaste?: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onEscape?: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  isFullscreen?: boolean;
  fillHeightWhenFullscreen?: boolean;
  sendOnEnter?: boolean;
  maxAutoHeight?: number;
  hasAdditionalContent?: boolean;
  rows?: number;
  autoFocus?: boolean;
  allowSendWhileLoading?: boolean;
  allowEmptySend?: boolean;
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
  textareaRef: externalTextareaRef,
  isFullscreen = false,
  fillHeightWhenFullscreen = false,
  sendOnEnter = true,
  maxAutoHeight = 300,
  hasAdditionalContent = false,
  rows = 1,
  autoFocus = false,
  allowSendWhileLoading = false,
  allowEmptySend = false,
  children,
}) => {
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;
  const textareaId = useId();
  const pendingImeSendRef = useRef(false);
  const canSendRef = useRef(false);
  const onSendRef = useRef(onSend);

  const hasContent = useMemo(() => {
    return allowEmptySend || text.trim().length > 0 || hasAdditionalContent;
  }, [allowEmptySend, hasAdditionalContent, text]);

  const canSend =
    hasContent && !disabled && (!isLoading || allowSendWhileLoading);
  const isPrimaryDisabled =
    isLoading && !allowSendWhileLoading ? false : !canSend;

  useEffect(() => {
    canSendRef.current = canSend;
  }, [canSend]);

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (isFullscreen && fillHeightWhenFullscreen) {
      textarea.style.height = "100%";
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxAutoHeight)}px`;
  }, [
    fillHeightWhenFullscreen,
    isFullscreen,
    maxAutoHeight,
    text,
    textareaRef,
  ]);

  useEffect(() => {
    if (!autoFocus || disabled) return;
    textareaRef.current?.focus();
  }, [autoFocus, disabled, textareaRef]);

  const isImeComposing = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = event.nativeEvent as KeyboardEvent & {
        isComposing?: boolean;
      };
      return Boolean(
        nativeEvent.isComposing ||
        nativeEvent.key === "Process" ||
        nativeEvent.keyCode === 229,
      );
    },
    [],
  );

  const onPrimaryAction = useCallback(() => {
    if (isLoading && !allowSendWhileLoading) {
      onStop?.();
      return;
    }

    if (!canSend) {
      return;
    }

    onSend();
  }, [allowSendWhileLoading, canSend, isLoading, onSend, onStop]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      const composing = isImeComposing(event);
      if (composing) {
        if (event.key === "Enter" && sendOnEnter && !event.shiftKey) {
          pendingImeSendRef.current = true;
        }
        return;
      }

      if (event.key === "Enter" && sendOnEnter && !event.shiftKey) {
        event.preventDefault();
        if (canSend) {
          onSend();
        }
        return;
      }

      if (event.key === "Escape" && isFullscreen) {
        onEscape?.();
      }
    },
    [
      canSend,
      isFullscreen,
      isImeComposing,
      onEscape,
      onKeyDown,
      onSend,
      sendOnEnter,
    ],
  );

  const handleCompositionEnd = useCallback(() => {
    if (!pendingImeSendRef.current) {
      return;
    }

    pendingImeSendRef.current = false;
    if (!sendOnEnter) {
      return;
    }

    window.requestAnimationFrame(() => {
      if (canSendRef.current) {
        onSendRef.current();
      }
    });
  }, [sendOnEnter]);

  const textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement> = {
    id: textareaId,
    name: "agent-chat-message",
    value: text,
    onChange: (event) => setText(event.target.value),
    onKeyDown: handleKeyDown,
    onCompositionEnd: handleCompositionEnd,
    onPaste,
    placeholder,
    disabled,
    rows,
    autoFocus,
  };

  return (
    <>
      {children({
        textareaRef,
        textareaProps,
        hasContent,
        canSend,
        isPrimaryDisabled,
        onPrimaryAction,
      })}
    </>
  );
};
