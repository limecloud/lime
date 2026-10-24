import type { BrowserAnnotationEditorEvent } from "../src/lib/api/browserAnnotationEditorTypes";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";

type EditorEvent = BrowserAnnotationEditorEvent & BrowserAnnotationIdentity;

/** Prepare synchronously to invalidate old revisions; deliver save before its close. */
export function createAnnotationEditorRelay(
  prepare: (event: EditorEvent) => Promise<EditorEvent | null>,
  emit: (event: EditorEvent) => void,
): (event: EditorEvent) => void {
  const queues = new Map<string, Promise<void>>();
  return (event) => {
    const key = `${event.editorId}:${event.generation}`;
    const prepared = prepare(event).catch(() => null);
    const delivery = (queues.get(key) ?? Promise.resolve()).then(async () => {
      const result = await prepared;
      if (result) emit(result);
    });
    queues.set(key, delivery);
    void delivery.finally(() => {
      if (queues.get(key) === delivery) queues.delete(key);
    });
  };
}
