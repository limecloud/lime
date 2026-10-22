import { atom } from "jotai/vanilla";
import type {
  BrowserAnnotationCaptureResult,
  BrowserAnnotationSelectionEvent,
} from "@/lib/api/browserAnnotationTypes";

export interface BrowserAnnotationDraft {
  readonly id: string;
  readonly sessionId: string;
  readonly event: BrowserAnnotationSelectionEvent;
  readonly capture: BrowserAnnotationCaptureResult;
  readonly body: string;
  readonly revision: number;
  readonly pending: boolean;
  readonly failure: boolean;
}

/** Desktop draft state; canonical messages and acceptance remain runtime-owned. */
export class BrowserAnnotationDraftStore {
  #snapshot: readonly BrowserAnnotationDraft[] = [];
  readonly #listeners = new Set<() => void>();
  #focus: { id: string; request: number } | null = null;
  #nextFocus = 0;
  getFocusSnapshot = () => this.#focus;
  focus(id: string): void {
    if (!this.get(id)) return;
    this.#focus = { id, request: ++this.#nextFocus };
    for (const listener of this.#listeners) listener();
  }
  consumeFocus(request: number): void {
    if (this.#focus?.request !== request) return;
    this.#focus = null;
    for (const listener of this.#listeners) listener();
  }
  getSnapshot = () => this.#snapshot;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  create(
    sessionId: string,
    event: BrowserAnnotationSelectionEvent,
    capture: BrowserAnnotationCaptureResult,
  ): BrowserAnnotationDraft {
    if (
      !sessionId.trim() ||
      capture.annotationId !== event.annotationId ||
      this.get(event.annotationId)
    )
      throw new Error("Invalid browser annotation draft identity");
    const draft: BrowserAnnotationDraft = {
      id: event.annotationId,
      sessionId,
      event: structuredClone(event),
      capture: structuredClone(capture),
      body: "",
      revision: 0,
      pending: false,
      failure: false,
    };
    this.#publish([...this.#snapshot, draft]);
    return draft;
  }

  get(id: string): BrowserAnnotationDraft | undefined {
    return this.#snapshot.find((draft) => draft.id === id);
  }

  update(id: string, body: string, revision: number): boolean {
    const draft = this.get(id);
    if (
      !draft ||
      typeof body !== "string" ||
      body.length > 100_000 ||
      !Number.isSafeInteger(revision) ||
      revision < draft.revision ||
      (revision === draft.revision && body !== draft.body)
    )
      return false;
    if (body === draft.body && revision === draft.revision) return true;
    this.#replace(id, { ...draft, body, revision, failure: false });
    return true;
  }

  capture(
    sessionId: string,
    threadId: string,
    ids?: readonly string[],
  ): readonly BrowserAnnotationDraft[] {
    const included = ids ? new Set(ids) : null;
    if (ids && included?.size !== ids.length)
      throw new Error("Duplicate browser annotation ids");
    const drafts = this.#snapshot.filter(
      (draft) =>
        draft.sessionId === sessionId &&
        draft.event.threadId === threadId &&
        draft.body.trim() &&
        (!included || included.has(draft.id)),
    );
    if (
      (included && drafts.length !== included.size) ||
      drafts.some((draft) => draft.pending)
    )
      throw new Error("Browser annotation draft is unavailable");
    return drafts;
  }

  begin(drafts: readonly BrowserAnnotationDraft[]): boolean {
    if (drafts.some((draft) => this.get(draft.id) !== draft || draft.pending))
      return false;
    const included = new Set(drafts);
    this.#publish(
      this.#snapshot.map((draft) =>
        included.has(draft)
          ? { ...draft, pending: true, failure: false }
          : draft,
      ),
    );
    return true;
  }

  finish(drafts: readonly BrowserAnnotationDraft[], accepted: boolean): void {
    const captured = new Map(drafts.map((draft) => [draft.id, draft]));
    this.#publish(
      this.#snapshot.flatMap((draft) => {
        const original = captured.get(draft.id);
        if (!original) return [draft];
        const unchanged =
          draft.revision === original.revision && draft.body === original.body;
        if (accepted && unchanged) return [];
        return [{ ...draft, pending: false, failure: !accepted }];
      }),
    );
  }

  remove(id: string): boolean {
    const draft = this.get(id);
    if (!draft || draft.pending) return false;
    this.#publish(this.#snapshot.filter((draft) => draft.id !== id));
    return true;
  }

  #replace(id: string, next: BrowserAnnotationDraft): void {
    this.#publish(
      this.#snapshot.map((draft) => (draft.id === id ? next : draft)),
    );
  }

  #publish(snapshot: readonly BrowserAnnotationDraft[]): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

export const browserAnnotationDraftsAtom = atom(
  new BrowserAnnotationDraftStore(),
);
