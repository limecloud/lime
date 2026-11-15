import { useEffect } from "react";
import { register, unregister } from "@/lib/desktop-host/global-shortcut";
import { getElectronHostBridge } from "@/lib/electron-host";

const GLOBAL_DICTATION_SHORTCUT = "Alt+D";

/**
 * 全局听写只负责把主窗口带到前台并触发当前 Composer 的听写 owner；
 * 录音、转写、取消仍由 useInputbarDictation 单一负责。
 */
export function GlobalDictationRuntime() {
  useEffect(() => {
    let registered = false;
    const toggle = () => {
      const host = getElectronHostBridge();
      void Promise.resolve(host?.window?.show()).catch(() => undefined);
      void Promise.resolve(host?.window?.setFocus()).catch(() => undefined);
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("lime:toggle-dictation"));
      }, 180);
    };
    void register(GLOBAL_DICTATION_SHORTCUT, toggle)
      .then(() => {
        registered = true;
      })
      .catch(() => undefined);
    return () => {
      if (!registered) return;
      void unregister(GLOBAL_DICTATION_SHORTCUT).catch(() => undefined);
    };
  }, []);
  return null;
}
