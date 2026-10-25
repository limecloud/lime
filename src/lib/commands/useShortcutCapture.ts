import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
} from "react";
import {
  formatShortcutTokens,
  type HotkeyPlatform,
} from "@/lib/hotkeys/platform";
import { captureBinding, KEY_SEQUENCE_TIMEOUT_MS } from "./bindings";

/** 对齐 Desktop 捕获：裸首键等待第二键，带修饰键的首键立即提交。 */
export function useShortcutCapture({
  enabled,
  platform,
  allowsSequences = true,
  onCapture,
  onCancel,
}: {
  enabled: boolean;
  platform: HotkeyPlatform;
  allowsSequences?: boolean;
  onCapture: (binding: string) => void;
  onCancel: (restoreFocus: boolean) => void;
}) {
  const [preview, setPreview] = useState("");
  const prefix = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef({ enabled, onCapture, onCancel });
  current.current = { enabled, onCapture, onCancel };
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    prefix.current = null;
  }, []);
  useEffect(() => {
    setPreview("");
    return clear;
  }, [enabled, platform, allowsSequences, clear]);
  const cancel = (restoreFocus: boolean) => {
    clear();
    setPreview("");
    if (current.current.enabled) current.current.onCancel(restoreFocus);
  };
  const commit = (binding: string) => {
    clear();
    setPreview("");
    if (current.current.enabled) current.current.onCapture(binding);
  };
  const onKeyDown: KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Tab") {
      cancel(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!enabled || event.repeat) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      clear();
      setPreview("");
      return;
    }
    if (
      event.key === "Escape" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey
    ) {
      cancel(true);
      return;
    }
    const stroke = captureBinding(event);
    if (!stroke) return;
    if (prefix.current) {
      commit(`${prefix.current} ${stroke}`);
    } else if (!allowsSequences || stroke.includes("+")) {
      commit(stroke);
    } else {
      prefix.current = stroke;
      setPreview(`${formatShortcutTokens(stroke, platform).join(" ")} …`);
      timer.current = setTimeout(() => commit(stroke), KEY_SEQUENCE_TIMEOUT_MS);
    }
  };
  return { preview, onKeyDown, onBlur: () => cancel(false) };
}
