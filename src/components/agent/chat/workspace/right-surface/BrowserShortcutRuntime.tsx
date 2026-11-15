import { useEffect } from "react";
import {
  captureBrowserTabScreenshot,
  goBackBrowserTab,
  goForwardBrowserTab,
  printBrowserTab,
  reloadBrowserTab,
  stopBrowserTab,
} from "@/lib/api/browserTab";

export function BrowserShortcutRuntime({
  tabId,
  enabled,
  onNewTab,
  onCloseTab,
  onSelectRelativeTab,
  onCloseOtherTabs,
  onCloseAllTabs,
}: {
  tabId: string | null;
  enabled: boolean;
  onNewTab?: () => void;
  onCloseTab?: (tabId: string) => void;
  onSelectRelativeTab?: (offset: number) => void;
  onCloseOtherTabs?: () => void;
  onCloseAllTabs?: () => void;
}) {
  useEffect(() => {
    if (!enabled || !tabId) return;
    const back = () => void goBackBrowserTab(tabId);
    const forward = () => void goForwardBrowserTab(tabId);
    const reload = () => void reloadBrowserTab(tabId);
    const hardReload = () => void reloadBrowserTab(tabId, { ignoreCache: true });
    const print = () => void printBrowserTab(tabId);
    const stop = () => void stopBrowserTab(tabId);
    const screenshot = () =>
      void captureBrowserTabScreenshot(tabId, true);
    window.addEventListener("lime:browser-back", back);
    window.addEventListener("lime:browser-forward", forward);
    window.addEventListener("lime:browser-reload", reload);
    window.addEventListener("lime:browser-hard-reload", hardReload);
    window.addEventListener("lime:browser-print", print);
    window.addEventListener("lime:browser-stop", stop);
    window.addEventListener("lime:browser-copy-screenshot", screenshot);
    const newTab = () => onNewTab?.();
    const closeTab = () => onCloseTab?.(tabId);
    const closeOtherTabs = () => onCloseOtherTabs?.();
    const closeAllTabs = () => onCloseAllTabs?.();
    const nextTab = () => onSelectRelativeTab?.(1);
    const previousTab = () => onSelectRelativeTab?.(-1);
    window.addEventListener("lime:browser-new-tab", newTab);
    window.addEventListener("lime:browser-close-tab", closeTab);
    window.addEventListener("lime:browser-close-other-tabs", closeOtherTabs);
    window.addEventListener("lime:browser-close-all-tabs", closeAllTabs);
    window.addEventListener("lime:browser-next-tab", nextTab);
    window.addEventListener("lime:browser-previous-tab", previousTab);
    return () => {
      window.removeEventListener("lime:browser-back", back);
      window.removeEventListener("lime:browser-forward", forward);
      window.removeEventListener("lime:browser-reload", reload);
      window.removeEventListener("lime:browser-hard-reload", hardReload);
      window.removeEventListener("lime:browser-print", print);
      window.removeEventListener("lime:browser-stop", stop);
      window.removeEventListener("lime:browser-copy-screenshot", screenshot);
      window.removeEventListener("lime:browser-new-tab", newTab);
      window.removeEventListener("lime:browser-close-tab", closeTab);
      window.removeEventListener("lime:browser-close-other-tabs", closeOtherTabs);
      window.removeEventListener("lime:browser-close-all-tabs", closeAllTabs);
      window.removeEventListener("lime:browser-next-tab", nextTab);
      window.removeEventListener("lime:browser-previous-tab", previousTab);
    };
  }, [
    enabled,
    onCloseAllTabs,
    onCloseOtherTabs,
    onCloseTab,
    onNewTab,
    onSelectRelativeTab,
    tabId,
  ]);
  return null;
}
