import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
} from "react";
import { usePersistedBooleanAtom } from "@/hooks/usePersistedBooleanAtom";
import { SUMMARY_PANEL_PIN_ATOM_KEY } from "@/lib/api/persistedAtomTypes";
import {
  getThreadSummaryContentShift,
  getThreadSummaryDisplayMode,
} from "./threadSummaryPanelLayout";

export function useThreadSummaryPanel(threadId: string | null) {
  const enabled = Boolean(threadId);
  const [mainContent, setMainContent] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const pin = usePersistedBooleanAtom(SUMMARY_PANEL_PIN_ATOM_KEY, enabled);
  const { value: pinned, setValue: setPinned } = pin;
  const [isPopoverOpen, setPopoverOpen] = useState(false);
  const panelId = useId();
  const displayMode = getThreadSummaryDisplayMode(width);

  useLayoutEffect(() => {
    if (!mainContent) return;
    const measure = () => setWidth(mainContent.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(mainContent);
    return () => observer.disconnect();
  }, [mainContent]);

  useEffect(() => {
    setPopoverOpen(false);
  }, [threadId, displayMode]);
  useEffect(() => {
    const toggleSummary = () => setPinned(!pinned);
    window.addEventListener("lime:toggle-summary-panel", toggleSummary);
    return () =>
      window.removeEventListener("lime:toggle-summary-panel", toggleSummary);
  }, [pinned, setPinned]);
  const togglePinned = useCallback(
    () => setPinned(!pinned),
    [setPinned, pinned],
  );

  const isOverlay = displayMode === "overlay";
  return {
    panelId,
    mainContent,
    mainContentRef: setMainContent,
    displayMode,
    isPinned: pin.value,
    isOpen: enabled && (isOverlay ? isPopoverOpen : pin.value),
    isPopoverOpen: enabled && isOverlay && isPopoverOpen,
    isInline: enabled && !isOverlay && pin.value,
    isOverlay,
    pinDisabled: !pin.ready || pin.updating,
    persistenceError: pin.error,
    contentShift: enabled
      ? getThreadSummaryContentShift(displayMode, pin.value)
      : 0,
    onOpenChange: (open: boolean) => {
      if (isOverlay) setPopoverOpen(open);
      else void togglePinned();
    },
  };
}

export type ThreadSummaryPanelState = ReturnType<typeof useThreadSummaryPanel>;
