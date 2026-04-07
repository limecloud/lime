import {
  useCallback,
  useEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { safeInvoke } from "@/lib/dev-bridge";

export interface HintRouteItem {
  hint: string;
  provider: string;
  model: string;
}

interface UseHintRoutesParams {
  setInput: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
}

export function useHintRoutes({ setInput, textareaRef }: UseHintRoutesParams) {
  const [showHintPopup, setShowHintPopup] = useState(false);
  const [hintRoutes, setHintRoutes] = useState<HintRouteItem[]>([]);
  const [hintIndex, setHintIndex] = useState(0);

  useEffect(() => {
    safeInvoke<HintRouteItem[]>("get_hint_routes")
      .then((routes) => {
        if (routes?.length > 0) {
          setHintRoutes(routes);
        }
      })
      .catch(() => {});
  }, []);

  const handleSetInput = useCallback(
    (value: string) => {
      setInput(value);
      if (hintRoutes.length > 0 && value === "[") {
        setShowHintPopup(true);
        setHintIndex(0);
      } else if (!value.startsWith("[") || value.includes("]")) {
        setShowHintPopup(false);
      }
    },
    [hintRoutes.length, setInput],
  );

  const handleHintSelect = useCallback(
    (hint: string) => {
      setInput(`[${hint}] `);
      setShowHintPopup(false);
      textareaRef.current?.focus();
    },
    [setInput, textareaRef],
  );

  const handleHintKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const nativeEvent = e.nativeEvent as KeyboardEvent & {
        isComposing?: boolean;
      };
      if (
        nativeEvent.isComposing ||
        nativeEvent.key === "Process" ||
        nativeEvent.keyCode === 229
      ) {
        return;
      }
      if (!showHintPopup || hintRoutes.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHintIndex((i) => (i + 1) % hintRoutes.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHintIndex((i) => (i - 1 + hintRoutes.length) % hintRoutes.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        handleHintSelect(hintRoutes[hintIndex].hint);
      } else if (e.key === "Escape") {
        setShowHintPopup(false);
      }
    },
    [handleHintSelect, hintIndex, hintRoutes, showHintPopup],
  );

  return {
    showHintPopup,
    hintRoutes,
    hintIndex,
    handleSetInput,
    handleHintSelect,
    handleHintKeyDown,
  };
}
