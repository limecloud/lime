import { useEffect } from "react";
import { register, unregister } from "@/lib/desktop-host/global-shortcut";
import { getElectronHostBridge } from "@/lib/electron-host";

const SPOTLIGHT_SHORTCUT = "Alt+K";

export function SpotlightRuntime() {
  useEffect(() => {
    let registered = false;
    const open = () => {
      const host = getElectronHostBridge();
      void Promise.resolve(host?.window?.show()).catch(() => undefined);
      void Promise.resolve(host?.window?.setFocus()).catch(() => undefined);
      window.dispatchEvent(new CustomEvent("lime:open-command-menu"));
    };
    void register(SPOTLIGHT_SHORTCUT, open)
      .then(() => {
        registered = true;
      })
      .catch(() => undefined);
    return () => {
      if (!registered) return;
      void unregister(SPOTLIGHT_SHORTCUT).catch(() => undefined);
    };
  }, []);
  return null;
}
