import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { createExtensions } from "./extensions";
import { BubbleToolbar } from "./BubbleToolbar";
import {
  CommandList,
  type SlashMenuState,
  type SlashMenuKeyHandler,
} from "./SlashCommand";
import { markdownToHtml, htmlToMarkdown } from "./utils/markdown";
import {
  isInputLatencyDebugEnabled,
  logRenderPerf,
} from "@/lib/perfDebug";
import { emitDocumentEditorFocus } from "@/lib/documentEditorFocusEvents";
import { resolveDocumentEditorHotkeyAction } from "@/components/content-creator/canvas/document/documentEditorHotkeys";
import "./editor-styles.css";

interface NotionEditorProps {
  content: string;
  contentVersionKey?: string;
  readOnly?: boolean;
  onCommit: (content: string) => void;
  onSave: (latestContent?: string) => void;
  onCancel: () => void;
  onSelectionTextChange?: (text: string) => void;
  externalImageInsert?: {
    requestId: string;
    url: string;
    alt?: string;
  } | null;
  onExternalImageInsertComplete?: (requestId: string, success: boolean) => void;
}

export interface NotionEditorHandle {
  flushContent: () => string;
}

const IDLE_COMMIT_DELAY_MS = 2500;
const INPUT_LATENCY_LOG_WARN_MS = 200;
const INPUT_LATENCY_WARN_LOG_COOLDOWN_MS = 1200;
const MAX_SELECTION_SYNC_CHARS = 1200;

const EMPTY_SLASH: SlashMenuState = {
  isOpen: false,
  items: [],
  range: null,
  clientRect: null,
};

function isTrackableInputKey(event: KeyboardEvent): boolean {
  if (event.key.length === 1) {
    return true;
  }
  return (
    event.key === "Backspace" ||
    event.key === "Delete" ||
    event.key === "Enter" ||
    event.key === "Tab"
  );
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

const NotionEditorCore = forwardRef<NotionEditorHandle, NotionEditorProps>(
  (
    {
      content,
      contentVersionKey,
      readOnly = false,
      onCommit,
      onSave,
      onCancel,
      onSelectionTextChange,
      externalImageInsert,
      onExternalImageInsertComplete,
    },
    ref,
  ) => {
    const [slashState, setSlashState] = useState<SlashMenuState>(EMPTY_SLASH);
    const keyDownRef = useRef<SlashMenuKeyHandler | null>(null);
    const handledExternalInsertRef = useRef<string | null>(null);
    const idleCommitTimerRef = useRef<number | null>(null);
    const lastCommittedContentRef = useRef(content);
    const lastSelectionTextRef = useRef("");
    const selectionSyncFrameRef = useRef<number | null>(null);
    const isPointerSelectingRef = useRef(false);
    const dirtyRef = useRef(false);
    const renderCountRef = useRef(0);
    const lastCommitAtRef = useRef<number | null>(null);
    const inputLatencyStatsRef = useRef({
      samples: [] as number[],
      totalLatencyMs: 0,
      maxLatencyMs: 0,
      sampleCount: 0,
    });
    const lastInputLatencyWarnLogAtRef = useRef(0);
    renderCountRef.current += 1;
    const currentRenderCount = renderCountRef.current;

    const clearIdleCommitTimer = useCallback(() => {
      if (idleCommitTimerRef.current !== null) {
        window.clearTimeout(idleCommitTimerRef.current);
        idleCommitTimerRef.current = null;
      }
    }, []);

    const clearSelectionSyncFrame = useCallback(() => {
      if (selectionSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionSyncFrameRef.current);
        selectionSyncFrameRef.current = null;
      }
    }, []);

    const extensions = useMemo(
      () =>
        createExtensions({
          onStateChange: setSlashState,
          onKeyDownRef: keyDownRef,
        }),
      [],
    );

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const initialContent = useMemo(() => markdownToHtml(content), []);

    const editor = useEditor({
      extensions,
      content: initialContent,
      shouldRerenderOnTransaction: false,
      editable: !readOnly,
    });

    // readOnly 变化时同步 editable 状态
    useEffect(() => {
      if (editor && !editor.isDestroyed) {
        editor.setEditable(!readOnly);
      }
    }, [editor, readOnly]);

    const flushContent = useCallback((): string => {
      if (!editor) {
        return lastCommittedContentRef.current;
      }

      const nextContent = htmlToMarkdown(editor.getHTML());
      const changed = nextContent !== lastCommittedContentRef.current;
      if (changed) {
        lastCommittedContentRef.current = nextContent;
        onCommit(nextContent);
      }
      dirtyRef.current = false;
      return nextContent;
    }, [editor, onCommit]);

    const scheduleIdleCommit = useCallback(() => {
      clearIdleCommitTimer();
      idleCommitTimerRef.current = window.setTimeout(() => {
        idleCommitTimerRef.current = null;
        if (!dirtyRef.current) {
          return;
        }
        flushContent();
      }, IDLE_COMMIT_DELAY_MS);
    }, [clearIdleCommitTimer, flushContent]);

    useImperativeHandle(
      ref,
      () => ({
        flushContent: () => {
          clearIdleCommitTimer();
          return flushContent();
        },
      }),
      [clearIdleCommitTimer, flushContent],
    );

    const handleSlashClose = useCallback(() => {
      setSlashState(EMPTY_SLASH);
    }, []);

    useEffect(() => {
      if (!editor) {
        return;
      }

      const handleUpdate = () => {
        dirtyRef.current = true;
        scheduleIdleCommit();
      };

      editor.on("update", handleUpdate);
      return () => {
        editor.off("update", handleUpdate);
      };
    }, [editor, scheduleIdleCommit]);

    useEffect(() => {
      if (!editor) {
        return;
      }
      if (content === lastCommittedContentRef.current) {
        return;
      }

      clearIdleCommitTimer();
      const nextHtml = markdownToHtml(content);
      editor.commands.setContent(nextHtml, { emitUpdate: false });
      lastCommittedContentRef.current = content;
      dirtyRef.current = false;
      handledExternalInsertRef.current = null;
      lastSelectionTextRef.current = "";
    }, [clearIdleCommitTimer, content, contentVersionKey, editor]);

    useEffect(() => {
      if (!editor) {
        return;
      }

      editor.commands.focus("end");
    }, [editor]);

    useEffect(() => {
      if (!editor) {
        return;
      }

      const element = editor.view.dom as HTMLElement;
      const handleEditorKeyDown = (event: KeyboardEvent) => {
        const action = resolveDocumentEditorHotkeyAction(event);
        if (!action) {
          return;
        }

        if (action === "save") {
          event.preventDefault();
          clearIdleCommitTimer();
          const latestContent = flushContent();
          onSave(latestContent);
          return;
        }

        if (action === "cancel" && !slashState.isOpen) {
          event.preventDefault();
          onCancel();
        }
      };

      element.addEventListener("keydown", handleEditorKeyDown, true);
      return () => {
        element.removeEventListener("keydown", handleEditorKeyDown, true);
      };
    }, [clearIdleCommitTimer, editor, flushContent, onCancel, onSave, slashState.isOpen]);

    useEffect(() => {
      if (!editor) {
        return;
      }

      const handleFocus = () => {
        emitDocumentEditorFocus(true);
      };
      const handleBlur = () => {
        clearIdleCommitTimer();
        flushContent();
        emitDocumentEditorFocus(false);
      };

      editor.on("focus", handleFocus);
      editor.on("blur", handleBlur);

      return () => {
        editor.off("focus", handleFocus);
        editor.off("blur", handleBlur);
        emitDocumentEditorFocus(false);
      };
    }, [clearIdleCommitTimer, editor, flushContent]);

    useEffect(
      () => () => {
        clearIdleCommitTimer();
        clearSelectionSyncFrame();
      },
      [clearIdleCommitTimer, clearSelectionSyncFrame],
    );

    useEffect(() => {
      const now = performance.now();
      const sinceLastCommitMs =
        lastCommitAtRef.current === null ? null : now - lastCommitAtRef.current;
      lastCommitAtRef.current = now;
      logRenderPerf("NotionEditor", currentRenderCount, sinceLastCommitMs, {
        slashOpen: slashState.isOpen,
        hasSelectionHandler: Boolean(onSelectionTextChange),
        hasPendingExternalImage: Boolean(externalImageInsert),
      });
    });

    useEffect(() => {
      if (!editor) {
        return;
      }

      const element = editor.view.dom as HTMLElement;
      const handleInputProbe = (event: KeyboardEvent) => {
        if (!isInputLatencyDebugEnabled()) {
          return;
        }
        if (
          event.isComposing ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          !isTrackableInputKey(event)
        ) {
          return;
        }

        const start = performance.now();
        window.setTimeout(() => {
          const timeoutLatencyMs = performance.now() - start;
          window.requestAnimationFrame(() => {
            const latencyMs = performance.now() - start;
            const stats = inputLatencyStatsRef.current;
            stats.sampleCount += 1;
            stats.totalLatencyMs += latencyMs;
            stats.maxLatencyMs = Math.max(stats.maxLatencyMs, latencyMs);
            stats.samples.push(latencyMs);
            if (stats.samples.length > 120) {
              stats.samples.shift();
            }

            if (
              stats.sampleCount % 20 === 0
            ) {
              const avgLatencyMs = stats.totalLatencyMs / stats.sampleCount;
              const p50LatencyMs = calculatePercentile(stats.samples, 50);
              const p95LatencyMs = calculatePercentile(stats.samples, 95);
              console.log(
                "[NotionEditorPerf] input_latency",
                JSON.stringify({
                  key: event.key,
                  latencyMs: Number(latencyMs.toFixed(2)),
                  timeoutLatencyMs: Number(timeoutLatencyMs.toFixed(2)),
                  avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
                  p50LatencyMs: Number(p50LatencyMs.toFixed(2)),
                  p95LatencyMs: Number(p95LatencyMs.toFixed(2)),
                  maxLatencyMs: Number(stats.maxLatencyMs.toFixed(2)),
                  sampleCount: stats.sampleCount,
                }),
              );
            }

            if (latencyMs >= INPUT_LATENCY_LOG_WARN_MS) {
              const now = performance.now();
              if (
                now - lastInputLatencyWarnLogAtRef.current >=
                INPUT_LATENCY_WARN_LOG_COOLDOWN_MS
              ) {
                lastInputLatencyWarnLogAtRef.current = now;
                const avgLatencyMs = stats.totalLatencyMs / stats.sampleCount;
                const p95LatencyMs = calculatePercentile(stats.samples, 95);
                console.warn(
                  "[NotionEditorPerf] input_latency_warn",
                  JSON.stringify({
                    key: event.key,
                    latencyMs: Number(latencyMs.toFixed(2)),
                    timeoutLatencyMs: Number(timeoutLatencyMs.toFixed(2)),
                    avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
                    p95LatencyMs: Number(p95LatencyMs.toFixed(2)),
                    sampleCount: stats.sampleCount,
                  }),
                );
              }
            }
          });
        }, 0);
      };

      element.addEventListener("keydown", handleInputProbe, true);
      return () => {
        element.removeEventListener("keydown", handleInputProbe, true);
      };
    }, [editor]);

    useEffect(
      () => () => {
        if (isInputLatencyDebugEnabled()) {
          const stats = inputLatencyStatsRef.current;
          const avgLatencyMs =
            stats.sampleCount > 0 ? stats.totalLatencyMs / stats.sampleCount : 0;
          const p50LatencyMs = calculatePercentile(stats.samples, 50);
          const p95LatencyMs = calculatePercentile(stats.samples, 95);
          console.log(
            "[NotionEditorPerf] input_latency_summary",
            JSON.stringify({
              sampleCount: stats.sampleCount,
              avgLatencyMs: Number(avgLatencyMs.toFixed(2)),
              p50LatencyMs: Number(p50LatencyMs.toFixed(2)),
              p95LatencyMs: Number(p95LatencyMs.toFixed(2)),
              maxLatencyMs: Number(stats.maxLatencyMs.toFixed(2)),
            }),
          );
        }
      },
      [],
    );

    useEffect(() => {
      if (!editor || !onSelectionTextChange) {
        return;
      }

      const syncSelectionText = () => {
        const { from, to, empty } = editor.state.selection;
        if (empty) {
          if (lastSelectionTextRef.current !== "") {
            lastSelectionTextRef.current = "";
            onSelectionTextChange("");
          }
          return;
        }

        const cappedTo = Math.min(to, from + MAX_SELECTION_SYNC_CHARS);
        const selectedText = editor.state.doc.textBetween(from, cappedTo, "\n").trim();
        if (selectedText !== lastSelectionTextRef.current) {
          lastSelectionTextRef.current = selectedText;
          onSelectionTextChange(selectedText);
        }
      };

      const scheduleSelectionSync = () => {
        clearSelectionSyncFrame();
        if (isPointerSelectingRef.current) {
          return;
        }
        selectionSyncFrameRef.current = window.requestAnimationFrame(() => {
          selectionSyncFrameRef.current = null;
          syncSelectionText();
        });
      };

      const handleSelectionUpdate = () => {
        scheduleSelectionSync();
      };

      const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) {
          return;
        }
        isPointerSelectingRef.current = true;
        clearSelectionSyncFrame();
      };

      const handlePointerUp = () => {
        if (!isPointerSelectingRef.current) {
          return;
        }
        isPointerSelectingRef.current = false;
        scheduleSelectionSync();
      };

      const handlePointerCancel = () => {
        if (!isPointerSelectingRef.current) {
          return;
        }
        isPointerSelectingRef.current = false;
        scheduleSelectionSync();
      };

      const editorElement = editor.view.dom as HTMLElement;
      editorElement.addEventListener("pointerdown", handlePointerDown);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerCancel);
      editor.on("selectionUpdate", handleSelectionUpdate);
      return () => {
        editorElement.removeEventListener("pointerdown", handlePointerDown);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerCancel);
        editor.off("selectionUpdate", handleSelectionUpdate);
        isPointerSelectingRef.current = false;
        clearSelectionSyncFrame();
      };
    }, [clearSelectionSyncFrame, editor, onSelectionTextChange]);

    useEffect(() => {
      if (!editor || !externalImageInsert) {
        return;
      }

      if (handledExternalInsertRef.current === externalImageInsert.requestId) {
        return;
      }

      handledExternalInsertRef.current = externalImageInsert.requestId;
      const success = editor
        .chain()
        .focus()
        .setImage({
          src: externalImageInsert.url,
          alt: externalImageInsert.alt || "插图",
        })
        .run();

      if (success) {
        clearIdleCommitTimer();
        flushContent();
      }
      onExternalImageInsertComplete?.(externalImageInsert.requestId, success);
    }, [
      clearIdleCommitTimer,
      editor,
      externalImageInsert,
      flushContent,
      onExternalImageInsertComplete,
    ]);

    if (!editor) return null;

    return (
      <div
        className={`notion-editor-wrapper flex-1${readOnly ? " notion-editor-readonly" : ""}`}
      >
        {readOnly && <div className="notion-editor-scan-bar" />}
        <BubbleToolbar editor={editor} />
        <EditorContent editor={editor} />
        {slashState.isOpen && slashState.range && (
          <CommandList
            editor={editor}
            items={slashState.items}
            range={slashState.range}
            clientRect={slashState.clientRect}
            onKeyDownRef={keyDownRef}
            onClose={handleSlashClose}
          />
        )}
      </div>
    );
  },
);

NotionEditorCore.displayName = "NotionEditor";

export const NotionEditor = memo(NotionEditorCore);
