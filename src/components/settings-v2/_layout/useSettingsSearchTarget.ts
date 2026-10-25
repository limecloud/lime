import { useEffect, type RefObject } from "react";
import type { SettingsSearchFocusContext } from "@/types/page";
import type { SettingsTabs } from "@/types/settings";
import { isSettingsSearchTarget } from "../settingsSearch";

export function useSettingsSearchTarget(
  containerRef: RefObject<HTMLElement | null>,
  section: SettingsTabs,
  focus: SettingsSearchFocusContext | undefined,
) {
  const targetId = focus?.targetId;
  const requestKey = focus?.requestKey;
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !targetId || !isSettingsSearchTarget(section, targetId))
      return;
    let active: HTMLElement | undefined;
    const locate = () => {
      const target = [
        ...container.querySelectorAll<HTMLElement>(
          "[data-settings-search-target]",
        ),
      ].find((node) => node.dataset.settingsSearchTarget === targetId);
      if (!target) return false;
      active = target;
      target.setAttribute("data-settings-search-active", "true");
      target.focus({ preventScroll: true });
      container.scrollTo?.({
        top: Math.max(
          0,
          container.scrollTop +
            target.getBoundingClientRect().top -
            container.getBoundingClientRect().top -
            24,
        ),
        behavior: "auto",
      });
      return true;
    };
    const observer = new MutationObserver(() => {
      if (locate()) observer.disconnect();
    });
    if (!locate())
      observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      active?.removeAttribute("data-settings-search-active");
    };
  }, [containerRef, section, targetId, requestKey]);
}
