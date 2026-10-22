import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

const MIN_FILES_PANEL_WIDTH = 200;
const MAX_FILES_PANEL_RATIO = 0.6;
const DEFAULT_FILES_PANEL_WIDTH = 250;

let sharedWidth = DEFAULT_FILES_PANEL_WIDTH;
const widthListeners = new Set<() => void>();
const getWidth = () => sharedWidth;
const subscribeWidth = (listener: () => void) => {
  widthListeners.add(listener);
  return () => {
    widthListeners.delete(listener);
  };
};
const setFilesPanelWidth = (value: number) => {
  if (value === sharedWidth) return;
  sharedWidth = value;
  for (const listener of widthListeners) listener();
};

export interface FileTreeResizeState {
  filesPanelWidth: number;
  filesPanelGridStyle: CSSProperties | undefined;
  handleFilesPanelResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  handleFilesPanelResizeMove: (event: PointerEvent<HTMLDivElement>) => void;
  handleFilesPanelResizeEnd: (event: PointerEvent<HTMLDivElement>) => void;
  handleFilesPanelResizeKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  resetFilesPanelWidth: () => void;
}

export function useFileTreeResize(
  filesPanelOpen: boolean,
  onToggleFilesPanel?: () => void,
): FileTreeResizeState {
  const filesPanelWidth = useSyncExternalStore(
    subscribeWidth,
    getWidth,
    getWidth,
  );
  const dragStartRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const currentGeometry = useCallback(
    (element: HTMLDivElement) => {
      const container = element.closest("[data-file-tree-container]");
      const containerWidth = container?.getBoundingClientRect().width ?? 0;
      const measuredWidth = container
        ?.querySelector("[data-file-tree-panel]")
        ?.getBoundingClientRect().width;
      return {
        width: measuredWidth || filesPanelWidth,
        maximum:
          containerWidth > 0
            ? Math.max(
                MIN_FILES_PANEL_WIDTH,
                containerWidth * MAX_FILES_PANEL_RATIO,
              )
            : DEFAULT_FILES_PANEL_WIDTH,
      };
    },
    [filesPanelWidth],
  );

  const setSize = useCallback(
    (width: number, element: HTMLDivElement) => {
      if (width < MIN_FILES_PANEL_WIDTH / 2 && onToggleFilesPanel) {
        dragStartRef.current = null;
        onToggleFilesPanel();
        return;
      }
      setFilesPanelWidth(
        Math.min(
          currentGeometry(element).maximum,
          Math.max(MIN_FILES_PANEL_WIDTH, width),
        ),
      );
    },
    [currentGeometry, onToggleFilesPanel],
  );

  const handleFilesPanelResizeStart = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!filesPanelOpen || event.button !== 0 || event.isPrimary === false) {
        return;
      }
      event.preventDefault();
      dragStartRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: currentGeometry(event.currentTarget).width,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [filesPanelOpen, currentGeometry],
  );

  const handleFilesPanelResizeMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const dragStart = dragStartRef.current;
      if (!dragStart || dragStart.pointerId !== event.pointerId) {
        return;
      }
      const nextWidth =
        dragStart.startWidth - (event.clientX - dragStart.startX);
      setSize(nextWidth, event.currentTarget);
      if (
        !dragStartRef.current &&
        event.currentTarget.hasPointerCapture(event.pointerId)
      )
        event.currentTarget.releasePointerCapture(event.pointerId);
    },
    [setSize],
  );

  const handleFilesPanelResizeEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const dragStart = dragStartRef.current;
      if (!dragStart || dragStart.pointerId !== event.pointerId) {
        return;
      }
      dragStartRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [],
  );

  const handleFilesPanelResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!filesPanelOpen || !["ArrowLeft", "ArrowRight"].includes(event.key))
        return;
      event.preventDefault();
      const width = currentGeometry(event.currentTarget).width;
      setSize(
        width + (event.key === "ArrowLeft" ? 10 : -10),
        event.currentTarget,
      );
    },
    [filesPanelOpen, currentGeometry, setSize],
  );

  return {
    filesPanelWidth,
    filesPanelGridStyle: filesPanelOpen
      ? {
          gridTemplateColumns: `minmax(0, 1fr) min(60%, ${filesPanelWidth}px)`,
        }
      : undefined,
    handleFilesPanelResizeStart,
    handleFilesPanelResizeMove,
    handleFilesPanelResizeEnd,
    handleFilesPanelResizeKeyDown,
    resetFilesPanelWidth: () => setFilesPanelWidth(DEFAULT_FILES_PANEL_WIDTH),
  };
}
