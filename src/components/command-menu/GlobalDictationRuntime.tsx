import { useEffect } from "react";
import { register, unregister } from "@/lib/desktop-host/global-shortcut";
import {
  armGlobalDictation,
  cancelGlobalDictation,
} from "@/lib/globalDictation";

const GLOBAL_DICTATION_SHORTCUT = "Alt+D";

/**
 * 全局听写只负责把主窗口带到前台并触发当前 Composer 的听写 owner；
 * 录音、转写、取消仍由 useInputbarDictation 单一负责。
 */
export function GlobalDictationRuntime() {
  useEffect(() => {
    let registered = false;
    let disarmTimer: number | undefined;
    const toggle = () => {
      armGlobalDictation();
      window.clearTimeout(disarmTimer);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("lime:toggle-dictation"));
      }, 180);
      disarmTimer = window.setTimeout(cancelGlobalDictation, 60_000);
    };
    void register(GLOBAL_DICTATION_SHORTCUT, toggle)
      .then(() => {
        registered = true;
      })
      .catch(() => undefined);
    return () => {
      window.clearTimeout(disarmTimer);
      cancelGlobalDictation();
      if (!registered) return;
      void unregister(GLOBAL_DICTATION_SHORTCUT).catch(() => undefined);
    };
  }, []);
  return null;
}
