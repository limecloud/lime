const DOCUMENT_EDITOR_FOCUS_EVENT = "lime:document-editor-focus";

interface DocumentEditorFocusDetail {
  focused: boolean;
}

export function emitDocumentEditorFocus(focused: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<DocumentEditorFocusDetail>(DOCUMENT_EDITOR_FOCUS_EVENT, {
      detail: { focused },
    }),
  );
}

export function subscribeDocumentEditorFocus(
  callback: (focused: boolean) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handle = (event: Event) => {
    const customEvent = event as CustomEvent<DocumentEditorFocusDetail>;
    callback(Boolean(customEvent.detail?.focused));
  };

  window.addEventListener(DOCUMENT_EDITOR_FOCUS_EVENT, handle);
  return () => {
    window.removeEventListener(DOCUMENT_EDITOR_FOCUS_EVENT, handle);
  };
}
