/// <reference lib="dom" />

/** Only physical Space input can temporarily release the page's annotation shield. */
export function annotationSpacePressed(
  event: KeyboardEvent,
  held: boolean,
): boolean | undefined {
  if (!event.isTrusted || event.code !== "Space") return;
  if (!held) {
    if (
      event.type !== "keydown" ||
      event.repeat ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.composedPath().some((target) => {
        if ((target as Node).nodeType !== 1) return false;
        const element = target as HTMLElement;
        const editable = element.closest("[contenteditable]");
        return (
          element.isContentEditable ||
          (editable !== null &&
            editable.getAttribute("contenteditable") !== "false") ||
          element.closest(
            "input,textarea,select,[role='textbox'],[data-lime-composer],[data-lime-terminal]",
          ) !== null
        );
      })
    )
      return;
  }
  if (event.type !== "keydown" && event.type !== "keyup") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  return event.type === "keydown";
}

/** Listen through accessible documents without exposing a child-frame bridge. */
export function watchAnnotationKeyboard(
  key: (event: KeyboardEvent) => void,
  blur: () => void,
  root: Document = document,
): () => void {
  const entries = new Map<
    Document,
    { observer: MutationObserver; dispose: () => void }
  >();
  let disposed = false;
  const hasFrameOrShadow = (node: Node): boolean =>
    node.nodeType === 1 &&
    ((node as Element).localName === "iframe" ||
      !!(node as Element).shadowRoot ||
      Array.from((node as Element).querySelectorAll("*")).some(
        (element) => element.localName === "iframe" || !!element.shadowRoot,
      ));
  const refresh = () => {
    if (disposed) return;
    const documents = new Map<Document, (Document | ShadowRoot)[]>();
    const visit = (doc: Document, depth: number) => {
      if (documents.has(doc) || depth > 32 || !doc.defaultView) return;
      const roots: (Document | ShadowRoot)[] = [];
      documents.set(doc, roots);
      const scan = (scope: Document | ShadowRoot) => {
        roots.push(scope);
        for (const element of Array.from(scope.querySelectorAll("*"))) {
          if (element.shadowRoot) scan(element.shadowRoot);
          if (element.localName !== "iframe") continue;
          try {
            const child = (element as HTMLIFrameElement).contentDocument;
            if (child) visit(child, depth + 1);
          } catch {
            // Cross-origin documents keep their own input and never gain a bridge.
          }
        }
      };
      scan(doc);
    };
    visit(root, 0);
    for (const [doc, entry] of entries) {
      if (!documents.has(doc)) {
        entry.dispose();
        entries.delete(doc);
      }
    }
    for (const [doc, roots] of documents) {
      let entry = entries.get(doc);
      if (!entry) {
        const win = doc.defaultView!;
        const observer = new MutationObserver((records) => {
          if (
            records.some((record) =>
              [
                ...Array.from(record.addedNodes),
                ...Array.from(record.removedNodes),
              ].some(hasFrameOrShadow),
            )
          )
            refresh();
        });
        const loaded = (event: Event) => {
          if ((event.target as Element)?.localName === "iframe") refresh();
        };
        win.addEventListener("keydown", key, true);
        win.addEventListener("keyup", key, true);
        win.addEventListener("blur", blur);
        doc.addEventListener("load", loaded, true);
        entry = {
          observer,
          dispose: () => {
            observer.disconnect();
            win.removeEventListener("keydown", key, true);
            win.removeEventListener("keyup", key, true);
            win.removeEventListener("blur", blur);
            doc.removeEventListener("load", loaded, true);
          },
        };
        entries.set(doc, entry);
      }
      entry.observer.disconnect();
      roots.forEach((scope) =>
        entry.observer.observe(scope, { childList: true, subtree: true }),
      );
    }
  };
  refresh();
  return () => {
    disposed = true;
    entries.forEach((entry) => entry.dispose());
    entries.clear();
  };
}
