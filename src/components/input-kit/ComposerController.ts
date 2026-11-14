import {
  DOMParser,
  Slice,
  type Node as ProseMirrorNode,
} from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import {
  composerDocumentFromJSON,
  composerDocumentFromText,
  composerSchema,
  normalizeComposerText,
} from "./composerSchema";
import {
  composerDocumentFromAnnotations,
  composerDocumentFromPromptText,
  projectComposerDocument,
  serializeComposerDocument,
} from "./composerSerialization";
import { composerLinkDefaults, normalizeComposerHref } from "./composerLinks";
import { replaceComposerAnnotations } from "./composerAnnotations";
import { composerTextSelection } from "./composerPositions";
import * as suggestions from "./composerSuggestions";
import type {
  ComposerSuggestion,
  ComposerSuggestionSource,
} from "./composerSuggestions";
import type {
  ComposerAttachment,
  ComposerDocumentInput,
  ComposerControllerOptions,
  ComposerControllerSnapshot,
  ComposerDocument,
  ComposerDraftSnapshot,
  ComposerEditorDocument,
  ComposerHistoryDirection,
  ComposerIntent,
  ComposerMentionBinding,
  ComposerPasteOptions,
  ComposerPathReference,
  ComposerSelection,
  ComposerSubmission,
  ComposerSubmitResult,
  ComposerSubmitTarget,
  ComposerTextElement,
  ComposerLinkAttributes,
} from "./types";

import type { NodeViewConstructor } from "@tiptap/pm/view";
import { CodeBlockNodeViewRegistry } from "./CodeBlockNodeViewRegistry";
import {
  clone,
  stateFrom,
  documentFrom,
  resourcesFrom,
  buildDocument,
  type ComposerResources,
} from "./composerState";

export const LARGE_PASTE_CHAR_THRESHOLD = 1_000;
const MAX_LOCAL_HISTORY_ENTRIES = 50;

function documentsEqual(
  left: ComposerDocument,
  right: ComposerDocument,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function persistedHistoryEntriesEqual(
  left: ComposerDocument,
  right: ComposerDocument,
): boolean {
  const {
    selectionStart: _leftStart,
    selectionEnd: _leftEnd,
    ...leftContent
  } = left;
  const {
    selectionStart: _rightStart,
    selectionEnd: _rightEnd,
    ...rightContent
  } = right;
  return JSON.stringify(leftContent) === JSON.stringify(rightContent);
}

function hasContent(draft: ComposerDocument): boolean {
  return (
    !!draft.text.trim() ||
    draft.attachments.length > 0 ||
    draft.pathReferences.length > 0
  );
}

export class ComposerController {
  readonly codeBlockNodeViewRegistry = new CodeBlockNodeViewRegistry();
  private readonly codeBlocksEnabled: boolean;
  private state: EditorState;
  private resources: ComposerResources;
  private revision = 0;
  private lastIntent: ComposerIntent | null = null;
  private pasteSequence = 0;
  private readonly historyEntries: ComposerDraftSnapshot[] = [];
  private historyCursor: number | null = null;
  private historyBaseDraft: ComposerDraftSnapshot | null = null;
  private snapshot: ComposerControllerSnapshot;
  private readonly listeners = new Set<() => void>();

  constructor(
    initialDocument: ComposerDocumentInput = {},
    options: ComposerControllerOptions = {},
  ) {
    this.codeBlocksEnabled =
      options.enableRichText !== false &&
      options.enableCodeBlocks !== false &&
      options.plainTextMode !== true;
    this.state = stateFrom(initialDocument, this.codeBlocksEnabled);
    this.resources = resourcesFrom(initialDocument);
    this.snapshot = this.createSnapshot();
  }

  getSnapshot = (): ComposerControllerSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  createNodeViews(): Record<string, NodeViewConstructor> {
    return this.codeBlocksEnabled
      ? { code_block: this.codeBlockNodeViewRegistry.createNodeView }
      : {};
  }

  getEditorState(): EditorState {
    return this.state;
  }

  getSuggestion = (): ComposerSuggestion =>
    suggestions.getComposerSuggestion(this.state);

  toggleContextSuggestions(): void {
    this.applyTransaction(suggestions.toggleContext(this.state));
  }

  dismissSuggestions(): void {
    this.applyTransaction(suggestions.dismiss(this.state));
  }

  setSuggestionSource(
    source: ComposerSuggestionSource | null,
    suggestion = this.getSuggestion(),
  ): void {
    const transaction = suggestions.setSource(this.state, source, suggestion);
    if (transaction) this.applyTransaction(transaction);
  }

  clearSuggestion(suggestion = this.getSuggestion()): void {
    const transaction = suggestions.clear(this.state, suggestion);
    if (transaction) this.applyTransaction(transaction);
  }

  completeSuggestionQuery(
    query: string,
    suggestion = this.getSuggestion(),
  ): void {
    const transaction = suggestions.completeQuery(
      this.state,
      query,
      suggestion,
    );
    if (transaction) this.applyTransaction(transaction);
  }

  applyTransaction(transaction: Transaction): boolean {
    const previous = this.state;
    const applied = previous.applyTransaction(transaction);
    if (applied.transactions.length === 0) return false;
    const documentChanged = !previous.doc.eq(applied.state.doc);
    const selectionChanged = !previous.selection.eq(applied.state.selection);
    if (documentChanged) {
      composerDocumentFromJSON(
        applied.state.doc.toJSON() as ComposerEditorDocument,
      );
      // Automatic metadata is persisted, but is not a manual history edit.
      if (
        applied.transactions.some(
          (item) => item.docChanged && item.getMeta("addToHistory") !== false,
        )
      )
        this.resetHistoryNavigation();
    }
    this.state = applied.state;
    if (documentChanged || selectionChanged) this.publish();
    else this.notify();
    return true;
  }

  getDocument(): ComposerDocument {
    return clone(this.snapshot.document);
  }
  captureDraft(): ComposerDraftSnapshot {
    return this.getDocument();
  }

  setText(value: string, selection?: { start?: number; end?: number }): void {
    const text = normalizeComposerText(value);
    const current = this.snapshot.document;
    if (text === current.text) {
      if (selection?.start !== undefined || selection?.end !== undefined) {
        this.setSelection(
          selection.start ?? current.selectionStart,
          selection.end ?? selection.start ?? current.selectionEnd,
        );
      }
      return;
    }
    this.replaceDocument({
      ...this.resources,
      text,
      selectionStart: selection?.start ?? current.selectionStart,
      selectionEnd: selection?.end ?? selection?.start ?? current.selectionEnd,
    });
  }

  setSelection(start: number, end = start): void {
    const selection = composerTextSelection(this.state.doc, { start, end });
    if (selection.eq(this.state.selection)) return;
    this.applyTransaction(this.state.tr.setSelection(selection));
  }

  replaceRange(range: ComposerSelection, text: string): void {
    const transaction = this.state.tr.setSelection(
      composerTextSelection(this.state.doc, range),
    );
    const normalized = normalizeComposerText(text);
    if (normalized) {
      if (
        transaction.selection.$from.parent ===
          transaction.selection.$to.parent &&
        transaction.selection.$from.parent.type.spec.code
      ) {
        transaction.insertText(normalized);
      } else
        transaction.replaceSelection(
          Slice.maxOpen(composerDocumentFromText(normalized).content),
        );
    } else {
      transaction.deleteSelection();
    }
    this.applyTransaction(transaction.scrollIntoView());
  }

  insertMention(
    binding: Omit<ComposerMentionBinding, "from" | "to">,
    range: ComposerSelection = {
      start: this.snapshot.document.selectionStart,
      end: this.snapshot.document.selectionEnd,
    },
  ): void {
    const selection = composerTextSelection(this.state.doc, range);
    if (
      this.selectionContainsCode(this.state.doc, selection.from, selection.to)
    )
      return;
    const node = composerSchema.node("mention", binding);
    const doc = composerSchema.node(
      "doc",
      null,
      composerSchema.node("paragraph", null, node),
    );
    composerDocumentFromJSON(doc.toJSON() as ComposerEditorDocument);
    this.applyTransaction(
      this.state.tr
        .setSelection(selection)
        .replaceSelectionWith(node, false)
        .scrollIntoView(),
    );
  }

  setTextElements(textElements: readonly ComposerTextElement[]): void {
    const current = this.snapshot.document;
    if (JSON.stringify(textElements) === JSON.stringify(current.textElements))
      return;
    const annotated = composerDocumentFromAnnotations({
      text: current.text,
      textElements,
      mentionBindings: current.mentionBindings,
    });
    const occupied = projectComposerDocument(this.state.doc).spans.filter(
      (span) => {
        const node = this.state.doc.nodeAt(span.pmFrom);
        return span.atom && node?.type.name !== "text_element";
      },
    );
    const transaction = replaceComposerAnnotations(
      this.state,
      "text_element",
      annotated,
      occupied,
    );
    if (transaction.docChanged) this.applyTransaction(transaction);
  }

  setMentionBindings(mentionBindings: readonly ComposerMentionBinding[]): void {
    if (
      JSON.stringify(mentionBindings) ===
      JSON.stringify(this.snapshot.document.mentionBindings)
    )
      return;
    if (
      mentionBindings.some(
        (binding) =>
          binding.label !==
          this.snapshot.document.text.slice(binding.from, binding.to),
      )
    )
      throw new Error("Composer mention annotation label mismatch");
    const annotated = composerDocumentFromAnnotations({
      text: this.snapshot.document.text,
      mentionBindings,
    });
    const transaction = replaceComposerAnnotations(
      this.state,
      "mention",
      annotated,
    );
    if (transaction.docChanged) this.applyTransaction(transaction);
  }

  setLink(
    range: ComposerSelection,
    href: string,
    title: string | null = null,
  ): boolean {
    const normalized = normalizeComposerHref(href);
    if (normalized === null) throw new Error("Invalid composer link href");
    const selection = composerTextSelection(this.state.doc, range);
    if (!this.isTextLinkSelection(selection.from, selection.to)) return false;
    return this.applyTransaction(
      this.state.tr.addMark(
        selection.from,
        selection.to,
        composerSchema.marks.link.create({
          ...composerLinkDefaults,
          href: normalized,
          title,
        }),
      ),
    );
  }

  updateLink(
    range: ComposerSelection,
    update: { href: string; title?: string | null; label?: string },
  ): boolean {
    const href = normalizeComposerHref(update.href);
    if (href === null) throw new Error("Invalid composer link href");
    const selection = composerTextSelection(this.state.doc, range);
    if (!this.isTextLinkSelection(selection.from, selection.to)) return false;
    let current: ComposerLinkAttributes | null = null;
    let uniform = true;
    this.state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (!node.isText) return;
      const mark = node.marks.find((item) => item.type.name === "link");
      if (
        !mark ||
        (current && !composerSchema.marks.link.create(current).eq(mark))
      )
        uniform = false;
      else current = mark.attrs as ComposerLinkAttributes;
    });
    if (!uniform || !current || update.label === "") return false;
    const previous = current as ComposerLinkAttributes;
    const mark = composerSchema.marks.link.create({
      ...previous,
      href,
      title: update.title === undefined ? previous.title : update.title,
      isAutolink: false,
      isGeneratedAutolink: false,
      literalMarkdownOccurrenceId: null,
      literalMarkdownSource: null,
    });
    const transaction = this.state.tr;
    if (update.label === undefined)
      transaction
        .removeMark(selection.from, selection.to, composerSchema.marks.link)
        .addMark(selection.from, selection.to, mark);
    else
      transaction
        .setSelection(selection)
        .replaceSelectionWith(composerSchema.text(update.label, [mark]), false);
    return this.applyTransaction(transaction.scrollIntoView());
  }

  setAttachments(attachments: readonly ComposerAttachment[]): void {
    this.updateResources({ ...this.resources, attachments });
  }

  setPathReferences(pathReferences: readonly ComposerPathReference[]): void {
    this.updateResources({ ...this.resources, pathReferences });
  }

  setInputCapabilityRoute(inputCapabilityRoute: unknown): void {
    this.updateResources({ ...this.resources, inputCapabilityRoute });
  }

  replaceDocument(document: ComposerDocumentInput): void {
    this.replaceState(document, true);
  }

  restoreDraft(draft: ComposerDocumentInput): void {
    this.lastIntent = "edit";
    this.replaceState(draft, true, true);
  }

  clear(): void {
    this.lastIntent = "clear";
    this.replaceState({}, true, true);
  }

  ingestPaste(
    value: string,
    options: ComposerPasteOptions = {},
  ): {
    handled: boolean;
    insertedText: string;
    placeholder?: string;
  } {
    const text = normalizeComposerText(value);
    if (!text) return { handled: false, insertedText: "" };
    if (
      this.state.selection.$from.parent.type.spec.code &&
      this.state.selection.$from.parent === this.state.selection.$to.parent
    ) {
      const { selectionStart: start, selectionEnd: end } =
        this.snapshot.document;
      this.replaceRange({ start, end }, text);
      return { handled: true, insertedText: text };
    }
    let occurrenceStart = 1;
    this.state.doc.descendants((node) => {
      for (const mark of node.marks)
        if (typeof mark.attrs.literalMarkdownOccurrenceId === "number")
          occurrenceStart = Math.max(
            occurrenceStart,
            mark.attrs.literalMarkdownOccurrenceId + 1,
          );
    });
    const parsed = composerDocumentFromPromptText(text, occurrenceStart);
    let formatted = false;
    parsed.descendants((node) => {
      if (node.type.name === "code_block" || node.marks.length > 0)
        formatted = true;
    });
    if (formatted) {
      this.insertDocument(parsed);
      return {
        handled: true,
        insertedText: projectComposerDocument(parsed).text,
      };
    }
    if (options.preferPasteAtom || text.length > LARGE_PASTE_CHAR_THRESHOLD) {
      const ids = new Set<string>();
      this.state.doc.descendants((node) => {
        if (node.type.name === "paste") ids.add(node.attrs.id);
      });
      do {
        this.pasteSequence += 1;
      } while (ids.has(`paste-${this.pasteSequence}`));
      const placeholder = `[Pasted text ${this.pasteSequence}: ${text.length} characters]`;
      this.applyTransaction(
        this.state.tr
          .replaceSelectionWith(
            composerSchema.node("paste", {
              id: `paste-${this.pasteSequence}`,
              placeholder,
              text,
            }),
            false,
          )
          .scrollIntoView(),
      );
      return { handled: true, insertedText: placeholder, placeholder };
    }
    const { selectionStart: start, selectionEnd: end } = this.snapshot.document;
    this.replaceRange({ start, end }, text);
    return { handled: true, insertedText: text };
  }

  ingestHTML(html: string): boolean {
    const document = window.document.implementation.createHTMLDocument("");
    document.body.innerHTML = html;
    const parsed = DOMParser.fromSchema(composerSchema).parse(document.body);
    composerDocumentFromJSON(parsed.toJSON() as ComposerEditorDocument);
    let formatted = false;
    parsed.descendants((node) => {
      if (node.type.name === "code_block" || node.marks.length > 0)
        formatted = true;
    });
    if (!formatted) return false;
    if (
      this.state.selection.$from.parent.type.spec.code &&
      this.state.selection.$from.parent === this.state.selection.$to.parent
    ) {
      const { selectionStart: start, selectionEnd: end } =
        this.snapshot.document;
      this.replaceRange({ start, end }, projectComposerDocument(parsed).text);
    } else this.insertDocument(parsed);
    return true;
  }

  submit(
    target: ComposerSubmitTarget,
    options: { allowEmpty?: boolean } = {},
  ): ComposerSubmitResult {
    this.recordIntent(target);
    const draft = this.captureDraft();
    const expanded = serializeComposerDocument(this.state.doc);
    const submission: ComposerSubmission = {
      text: expanded.text,
      textElements: expanded.textElements,
      inputMentions: expanded.inputMentions,
      ...clone(this.resources),
    };
    const receipt = {
      intent: target,
      target,
      draft,
      submission,
      revision: this.revision,
    };
    return options.allowEmpty || hasContent(draft) || target === "interrupt"
      ? { ...receipt, kind: "accepted" }
      : { ...receipt, kind: "empty" };
  }

  commit(
    receipt: Extract<ComposerSubmitResult, { kind: "accepted" }>,
  ): boolean {
    if (receipt.target === "interrupt" || receipt.revision !== this.revision)
      return false;
    this.recordSubmission(receipt.draft);
    this.replaceState({}, true);
    return true;
  }

  getHistory(): readonly ComposerDraftSnapshot[] {
    return clone(this.historyEntries);
  }

  replaceHistory(entries: readonly ComposerDocumentInput[]): void {
    this.historyEntries.length = 0;
    this.appendHistoryEntries(entries);
    this.resetHistoryNavigation();
  }

  mergeHistory(entries: readonly ComposerDocumentInput[]): void {
    const incoming = this.buildHistoryEntries(entries);
    if (incoming.length === 0) return;
    const current = this.getHistory();
    let matchedStart = -1;
    let matchedEnd = -1;
    for (
      let size = Math.min(incoming.length, current.length);
      size > 0 && matchedEnd < 0;
      size -= 1
    ) {
      const tail = incoming.slice(-size);
      for (let start = current.length - size; start >= 0; start -= 1) {
        if (
          tail.every((entry, index) => {
            const existing = current[start + index];
            return (
              existing !== undefined &&
              persistedHistoryEntriesEqual(entry, existing)
            );
          })
        ) {
          matchedStart = start;
          matchedEnd = start + size;
          break;
        }
      }
    }
    this.historyEntries.length = 0;
    this.appendHistoryEntries([
      ...(matchedStart > 0 ? current.slice(0, matchedStart) : []),
      ...incoming,
      ...(matchedEnd >= 0 ? current.slice(matchedEnd) : current),
    ]);
    this.resetHistoryNavigation();
  }

  recallHistory(
    direction: ComposerHistoryDirection,
  ): ComposerDraftSnapshot | null {
    if (this.historyEntries.length === 0) return null;
    if (direction === "previous") {
      if (this.historyCursor === null) {
        this.historyBaseDraft = this.captureDraft();
        this.historyCursor = this.historyEntries.length;
      }
      if (this.historyCursor === 0) return null;
      this.historyCursor -= 1;
      const entry = this.historyEntries[this.historyCursor];
      if (!entry) return null;
      this.applyHistoryDraft(entry);
      return this.captureDraft();
    }
    if (this.historyCursor === null) return null;
    if (this.historyCursor >= this.historyEntries.length - 1) {
      const draft = this.historyBaseDraft;
      this.historyCursor = null;
      this.historyBaseDraft = null;
      if (!draft) return null;
      this.applyHistoryDraft(draft);
      return this.captureDraft();
    }
    this.historyCursor += 1;
    const entry = this.historyEntries[this.historyCursor];
    if (!entry) return null;
    this.applyHistoryDraft(entry);
    return this.captureDraft();
  }

  private buildHistoryEntries(
    entries: readonly ComposerDocumentInput[],
  ): ComposerDraftSnapshot[] {
    const result: ComposerDraftSnapshot[] = [];
    for (const entry of entries) {
      const draft = buildDocument(entry);
      if (!hasContent(draft)) continue;
      const previous = result.at(-1);
      if (!previous || !persistedHistoryEntriesEqual(previous, draft))
        result.push(draft);
    }
    return result;
  }

  private appendHistoryEntries(
    entries: readonly ComposerDocumentInput[],
  ): void {
    for (const draft of this.buildHistoryEntries(entries)) {
      const previous = this.historyEntries.at(-1);
      if (!previous || !persistedHistoryEntriesEqual(previous, draft))
        this.historyEntries.push(draft);
    }
    if (this.historyEntries.length > MAX_LOCAL_HISTORY_ENTRIES) {
      this.historyEntries.splice(
        0,
        this.historyEntries.length - MAX_LOCAL_HISTORY_ENTRIES,
      );
    }
  }

  private recordSubmission(draft: ComposerDraftSnapshot): void {
    this.appendHistoryEntries([draft]);
    this.resetHistoryNavigation();
  }

  private applyHistoryDraft(draft: ComposerDraftSnapshot): void {
    this.lastIntent = "edit";
    this.replaceState(draft, false);
  }

  private selectionContainsCode(
    doc: ProseMirrorNode,
    from: number,
    to: number,
  ): boolean {
    let found =
      !!doc.resolve(from).parent.type.spec.code ||
      !!doc.resolve(to).parent.type.spec.code;
    doc.nodesBetween(from, to, (node) => {
      if (node.type.spec.code) found = true;
    });
    return found;
  }

  private isTextLinkSelection(from: number, to: number): boolean {
    if (from === to) return false;
    const start = this.state.doc.resolve(from);
    const end = this.state.doc.resolve(to);
    if (start.parent !== end.parent || start.parent.type.name !== "paragraph")
      return false;
    let valid = true;
    this.state.doc.nodesBetween(from, to, (node) => {
      if (node.isInline && !node.isText) valid = false;
    });
    return valid;
  }

  private insertDocument(doc: ProseMirrorNode): void {
    let hasCode = false;
    doc.forEach((node) => {
      if (node.type.name === "code_block") hasCode = true;
    });
    const transaction = this.state.tr;
    const { $from, $to } = transaction.selection;
    if (
      $from.parent === $to.parent &&
      $from.parent.type.name === "paragraph" &&
      $from.parentOffset === 0 &&
      $to.parentOffset === $from.parent.content.size
    ) {
      transaction.replaceWith($from.before(), $to.after(), doc.content);
    } else
      transaction.replaceSelection(
        hasCode ? new Slice(doc.content, 0, 0) : Slice.maxOpen(doc.content),
      );
    this.applyTransaction(transaction.scrollIntoView());
  }

  private replaceState(
    input: ComposerDocumentInput,
    resetHistory: boolean,
    force = false,
  ): void {
    const state = stateFrom(input, this.codeBlocksEnabled);
    const resources = resourcesFrom(input);
    if (
      !force &&
      documentsEqual(this.snapshot.document, documentFrom(state, resources)) &&
      this.snapshot.lastIntent === this.lastIntent
    )
      return;
    if (resetHistory) this.resetHistoryNavigation();
    this.state = state;
    this.resources = resources;
    this.publish();
  }

  private updateResources(resources: ComposerResources): void {
    const next = resourcesFrom(resources);
    if (JSON.stringify(next) === JSON.stringify(this.resources)) return;
    this.resources = next;
    this.resetHistoryNavigation();
    this.publish();
  }

  private resetHistoryNavigation(): void {
    this.historyCursor = null;
    this.historyBaseDraft = null;
  }

  private recordIntent(intent: ComposerIntent): void {
    if (this.lastIntent === intent) return;
    this.lastIntent = intent;
    this.publish();
  }

  private publish(): void {
    this.revision += 1;
    this.snapshot = this.createSnapshot();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private createSnapshot(): ComposerControllerSnapshot {
    return {
      document: documentFrom(this.state, this.resources),
      revision: this.revision,
      lastIntent: this.lastIntent,
    };
  }
}
