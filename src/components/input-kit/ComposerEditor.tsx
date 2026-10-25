import React, {
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorView } from "@tiptap/pm/view";
import type { ComposerController } from "./ComposerController";
import { handleComposerKeyDown, isComposerComposing } from "./composerKeymap";
import type { ComposerSelection } from "./types";
import { CodeBlockToolbars } from "./CodeBlockToolbar";
import type { ComposerEnterBehavior } from "@/lib/api/appConfigTypes";

export interface ComposerEditorHandle {
  getElement(): HTMLElement | null;
  getSelection(): ComposerSelection;
  setSelection(
    selection: ComposerSelection,
    options?: { focus?: boolean },
  ): void;
  replaceRange(range: ComposerSelection, text: string): void;
  focus(): void;
  contains(target: Node | null): boolean;
  getBoundingClientRect(): DOMRect | null;
  coordsAtSelection(): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null;
  isComposing(): boolean;
}

export interface ComposerEditorProps {
  controller: ComposerController;
  editorRef?: React.Ref<ComposerEditorHandle | null>;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  sessionId?: string;
  testId?: string;
  onKeyDown?: (
    event: KeyboardEvent,
    editor: ComposerEditorHandle,
  ) => boolean | void;
  onPaste?: (
    event: ClipboardEvent,
    editor: ComposerEditorHandle,
  ) => boolean | void;
  onSubmit?: (metadata: {
    triggeredAt: number;
    triggerSource: "enter";
  }) => void;
  onEscape?: () => boolean | void;
  onCompositionStateChange?: (composing: boolean) => void;
  sendOnEnter?: boolean;
  enterBehavior?: ComposerEnterBehavior;
}

export function ComposerEditor(props: ComposerEditorProps) {
  const { controller, editorRef } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);
  const propsRef = useRef(props);
  propsRef.current = props;
  const handle = useMemo<ComposerEditorHandle>(
    () => ({
      getElement: () => viewRef.current?.dom ?? null,
      getSelection: () => {
        const doc = controller.getDocument();
        return { start: doc.selectionStart, end: doc.selectionEnd };
      },
      setSelection: (selection, options) => {
        controller.setSelection(selection.start, selection.end);
        if (options?.focus && !propsRef.current.disabled)
          viewRef.current?.focus();
      },
      replaceRange: (range, text) => controller.replaceRange(range, text),
      focus: () => {
        if (!propsRef.current.disabled) viewRef.current?.focus();
      },
      contains: (target) =>
        target !== null && !!viewRef.current?.dom.contains(target),
      getBoundingClientRect: () =>
        viewRef.current?.dom.getBoundingClientRect() ?? null,
      coordsAtSelection: () => {
        const view = viewRef.current;
        return view && !view.isDestroyed
          ? view.coordsAtPos(view.state.selection.head)
          : null;
      },
      isComposing: () => composingRef.current || !!viewRef.current?.composing,
    }),
    [controller],
  );
  useImperativeHandle(editorRef, () => handle, [handle]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateComposition = (composing: boolean) => {
      if (composingRef.current === composing) return;
      composingRef.current = composing;
      setComposing(composing);
      propsRef.current.onCompositionStateChange?.(composing);
    };
    const nodeViews = controller.createNodeViews();
    const createCodeBlock = nodeViews.code_block;
    if (createCodeBlock) {
      nodeViews.code_block = (node, currentView, getPos, ...decorations) =>
        createCodeBlock(
          node,
          currentView,
          () => (composingRef.current ? undefined : getPos()),
          ...decorations,
        );
    }
    const view = new EditorView(container, {
      state: controller.getEditorState(),
      nodeViews,
      editable: () => !propsRef.current.disabled,
      dispatchTransaction: (transaction) => {
        if (propsRef.current.disabled) return;
        controller.applyTransaction(transaction);
        if (view.state !== controller.getEditorState())
          view.updateState(controller.getEditorState());
      },
      handleKeyDown: (currentView, event) => {
        if (event.defaultPrevented) return true;
        if (propsRef.current.disabled) return true;
        if (isComposerComposing(event, currentView, composingRef.current))
          return false;
        const externalHandled = propsRef.current.onKeyDown?.(event, handle);
        if (externalHandled || event.defaultPrevented) return true;
        return handleComposerKeyDown({
          event,
          view: currentView,
          controller,
          onSubmit: propsRef.current.onSubmit,
          onEscape: propsRef.current.onEscape,
          sendOnEnter: propsRef.current.sendOnEnter ?? true,
          enterBehavior: propsRef.current.enterBehavior ?? "enter",
        });
      },
      handleDOMEvents: {
        keydown: (currentView, event) => {
          if (event.defaultPrevented) return true;
          // Stop PM keymaps without preventing the OS's composition confirmation.
          return isComposerComposing(event, currentView, composingRef.current);
        },
        compositionstart: () => {
          updateComposition(true);
          return false;
        },
        compositionend: () => {
          updateComposition(false);
          return false;
        },
        paste: (_view, event) => {
          if (propsRef.current.disabled) {
            event.preventDefault();
            return true;
          }
          const handled = propsRef.current.onPaste?.(event, handle);
          if (handled || event.defaultPrevented) {
            event.preventDefault();
            return true;
          }
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const html = event.clipboardData?.getData("text/html") ?? "";
          // External resources take priority; only the known schema parses HTML.
          event.preventDefault();
          if (html && controller.ingestHTML(html)) return true;
          if (text) controller.ingestPaste(text);
          return true;
        },
      },
    });
    viewRef.current = view;
    view.dom.style.whiteSpace = "pre-wrap";
    view.dom.style.overflowWrap = "anywhere";
    const unsubscribe = controller.subscribe(() => {
      if (!view.isDestroyed && view.state !== controller.getEditorState()) {
        view.updateState(controller.getEditorState());
      }
      view.dom.dataset.empty =
        controller.getDocument().text.length === 0 ? "true" : "false";
    });
    view.dom.dataset.empty =
      controller.getDocument().text.length === 0 ? "true" : "false";
    if (propsRef.current.autoFocus && !propsRef.current.disabled) view.focus();
    return () => {
      unsubscribe();
      updateComposition(false);
      viewRef.current = null;
      view.destroy();
    };
  }, [controller, handle]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const attributes: Record<string, string> = {
      role: "textbox",
      "aria-multiline": "true",
      "aria-disabled": props.disabled ? "true" : "false",
      "aria-label": props.ariaLabel ?? props.placeholder ?? "",
      "data-testid": props.testId ?? "composer-editor",
      "data-placeholder": props.placeholder ?? "",
      class: props.className ?? "",
      spellcheck: "true",
      dir: "auto",
      tabindex: props.disabled ? "-1" : "0",
    };
    if (props.sessionId) attributes["data-session-id"] = props.sessionId;
    view.setProps({ attributes, editable: () => !propsRef.current.disabled });
  }, [
    props.ariaLabel,
    props.className,
    props.disabled,
    props.placeholder,
    props.sessionId,
    props.testId,
    controller,
  ]);

  return (
    <>
      <div
        ref={containerRef}
        data-composer-editor-host="true"
        style={{ display: "contents" }}
      />
      <CodeBlockToolbars
        registry={controller.codeBlockNodeViewRegistry}
        disabled={props.disabled || composing}
      />
    </>
  );
}
