import { baseKeymap } from "@tiptap/pm/commands";
import { undo, redo } from "@tiptap/pm/history";
import { keymap } from "@tiptap/pm/keymap";
import type { EditorView } from "@tiptap/pm/view";
import { TextSelection } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import type { ComposerEnterBehavior } from "@/lib/api/appConfigTypes";
import { resolveHotkeyPlatform } from "@/lib/hotkeys/platform";
import type { ComposerController } from "./ComposerController";

export function createComposerEditingKeymap() {
  return [
    keymap({ "Mod-z": undo, "Shift-Mod-z": redo, "Mod-y": redo }),
    keymap(baseKeymap),
  ];
}

export function isComposerComposing(
  event: KeyboardEvent,
  view: EditorView,
  composing: boolean,
): boolean {
  return (
    composing ||
    view.composing ||
    event.isComposing ||
    event.key === "Process" ||
    event.keyCode === 229
  );
}

function hasMultilineContent(doc: Node): boolean {
  if (doc.childCount > 1) return true;
  let multiline = false;
  doc.descendants((node) => {
    if (node.type.name === "hard_break") multiline = true;
    return !multiline;
  });
  return multiline;
}

export function handleComposerKeyDown(options: {
  event: KeyboardEvent;
  view: EditorView;
  controller: ComposerController;
  onSubmit?: (metadata: {
    triggeredAt: number;
    triggerSource: "enter";
  }) => void;
  onEscape?: () => boolean | void;
  sendOnEnter: boolean;
  enterBehavior: ComposerEnterBehavior;
}): boolean {
  const {
    event,
    view,
    controller,
    onSubmit,
    onEscape,
    sendOnEnter,
    enterBehavior,
  } = options;
  const unmodified =
    !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
  const platform = resolveHotkeyPlatform(navigator);
  const primary =
    platform === "mac"
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
  const inCode =
    view.state.selection.$from.sameParent(view.state.selection.$to) &&
    view.state.selection.$from.parent.type.spec.code === true;
  const coarsePointer =
    platform !== "windows" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const insertNewline = () => {
    if (inCode) {
      controller.applyTransaction(
        view.state.tr.insertText("\n").scrollIntoView(),
      );
      return true;
    }
    return baseKeymap.Enter(
      view.state,
      (tr) => controller.applyTransaction(tr),
      view,
    );
  };
  if (event.key === "Enter" && primary && !event.shiftKey && !event.altKey) {
    if (!sendOnEnter) {
      event.preventDefault();
      return insertNewline();
    }
    if (!onSubmit) return false;
    event.preventDefault();
    if (enterBehavior === "enter" && inCode && !coarsePointer) {
      const after = view.state.selection.$from.after();
      const tr =
        view.state.doc.nodeAt(after)?.type === view.state.schema.nodes.paragraph
          ? view.state.tr
          : view.state.tr.insert(
              after,
              view.state.schema.nodes.paragraph.create(),
            );
      controller.applyTransaction(
        tr
          .setSelection(TextSelection.create(tr.doc, after + 1))
          .scrollIntoView(),
      );
    } else onSubmit({ triggeredAt: Date.now(), triggerSource: "enter" });
    return true;
  }
  if (event.key === "Enter" && unmodified) {
    event.preventDefault();
    if (
      !sendOnEnter ||
      !onSubmit ||
      coarsePointer ||
      enterBehavior === "cmdAlways" ||
      (enterBehavior === "cmdIfMultiline" &&
        (inCode || hasMultilineContent(view.state.doc)))
    ) {
      return insertNewline();
    }
    onSubmit({ triggeredAt: Date.now(), triggerSource: "enter" });
    return true;
  }
  if (
    event.key === "Enter" &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    inCode
  ) {
    event.preventDefault();
    controller.applyTransaction(
      view.state.tr.insertText("\n").scrollIntoView(),
    );
    return true;
  }
  if (unmodified && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
    const draft = controller.getDocument();
    const atBoundary =
      event.key === "ArrowUp"
        ? draft.selectionStart === 0 && draft.selectionEnd === 0
        : draft.selectionStart === draft.text.length &&
          draft.selectionEnd === draft.text.length;
    if (
      atBoundary &&
      controller.recallHistory(event.key === "ArrowUp" ? "previous" : "next")
    ) {
      event.preventDefault();
      return true;
    }
  }
  if (
    event.key === "Enter" &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    controller.applyTransaction(
      view.state.tr
        .replaceSelectionWith(view.state.schema.nodes.hard_break.create())
        .scrollIntoView(),
    );
    return true;
  }
  if (event.key === "Escape" && onEscape) {
    const handled = onEscape();
    if (handled !== false) {
      event.preventDefault();
      return true;
    }
  }
  return false;
}
