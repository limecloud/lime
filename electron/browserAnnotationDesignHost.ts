import {
  readBrowserDesignChange,
  readBrowserDesignSnapshot,
  sameBrowserDesignChange,
  type BrowserDesignChange,
  type BrowserDesignSnapshot,
} from "../src/lib/api/browserDesign";
import type { BrowserAnnotationEditorAction } from "../src/lib/api/browserAnnotationEditorTypes";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";

export interface BrowserAnnotationDesignEvent extends BrowserAnnotationIdentity {
  annotationId: string;
  action: BrowserAnnotationEditorAction;
  revision: number;
  designChange?: BrowserDesignChange | null;
}

/** This holds only temporary presentation; annotation identity remains Host-owned. */
export class BrowserAnnotationDesignHost {
  readonly #entries = new Map<
    string,
    {
      snapshot: BrowserDesignSnapshot;
      revision: number;
      change: BrowserDesignChange | null;
      saved: BrowserDesignChange | null;
    }
  >();

  register(id: string, value: unknown): BrowserDesignSnapshot | undefined {
    if (value === undefined) return undefined;
    const snapshot = readBrowserDesignSnapshot(value);
    this.#entries.set(id, {
      snapshot,
      revision: -1,
      change: null,
      saved: null,
    });
    return structuredClone(snapshot);
  }

  receive(
    event: BrowserAnnotationDesignEvent,
    send: (change: BrowserDesignChange | null) => void,
  ): void {
    const entry = this.#entries.get(event.annotationId);
    if (
      !entry ||
      !Number.isSafeInteger(event.revision) ||
      event.revision < 0 ||
      event.revision < entry.revision
    )
      return;
    const change = readBrowserDesignChange(event.designChange, entry.snapshot);
    if (
      event.revision === entry.revision &&
      !sameBrowserDesignChange(change, entry.change)
    )
      return;
    entry.revision = event.revision;
    entry.change = change;
    if (event.action === "save") entry.saved = change;
    send(event.action === "close" ? entry.saved : change);
  }

  remove(id: string): void {
    this.#entries.delete(id);
  }
}
