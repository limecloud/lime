const COMPACT_RIGHT_PANEL_OPEN_EVENT = "lime:compact-right-panel-open";

type CompactRightPanelSource = "chat" | "workbench";

interface CompactRightPanelOpenDetail {
  source: CompactRightPanelSource;
}

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function emitCompactRightPanelOpen(
  detail: CompactRightPanelOpenDetail,
): void {
  if (!hasWindow()) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<CompactRightPanelOpenDetail>(
      COMPACT_RIGHT_PANEL_OPEN_EVENT,
      {
        detail,
      },
    ),
  );
}

export function onCompactRightPanelOpen(
  listener: (detail: CompactRightPanelOpenDetail) => void,
): () => void {
  if (!hasWindow()) {
    return () => undefined;
  }

  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) {
      return;
    }

    const detail = (event as CustomEvent<CompactRightPanelOpenDetail>).detail;
    if (
      !detail ||
      (detail.source !== "chat" && detail.source !== "workbench")
    ) {
      return;
    }
    listener(detail);
  };

  window.addEventListener(COMPACT_RIGHT_PANEL_OPEN_EVENT, handler);
  return () => {
    window.removeEventListener(COMPACT_RIGHT_PANEL_OPEN_EVENT, handler);
  };
}
