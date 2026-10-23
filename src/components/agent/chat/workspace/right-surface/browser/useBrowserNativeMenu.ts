import { useCallback, useEffect, useRef, useState } from "react";
import {
  hideBrowserTabOverlay,
  listenBrowserMenuEvent,
  showBrowserTabMenu,
  updateBrowserTabMenu,
  type BrowserMenuEvent,
  type BrowserMenuItem,
  type BrowserMenuPresentation,
} from "@/lib/api/browserMenu";
import type { BrowserTabState } from "@/lib/api/browserTab";
import { matchesBrowserTabEvent } from "./browserTabEventIdentity";

let nextMenu = 0;
interface MenuSession {
  id: string;
  tab: BrowserTabState;
  generation: number | null;
  queued: BrowserMenuEvent[];
}

export function useBrowserNativeMenu({
  selected,
  active,
  onAction,
  onError,
}: {
  selected: BrowserTabState | null;
  active: boolean;
  onAction: (id: string) => void;
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = useRef({ selected, active, onAction, onError });
  current.current = { selected, active, onAction, onError };
  const session = useRef<MenuSession | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const lifetime = useRef(0);
  const receive = useCallback((event: BrowserMenuEvent) => {
    const pending = session.current;
    if (
      !pending ||
      pending.id !== event.menuId ||
      !matchesBrowserTabEvent(pending.tab, event) ||
      !matchesBrowserTabEvent(current.current.selected, event) ||
      !current.current.active
    )
      return;
    if (pending.generation === null) {
      pending.queued.push(event);
      return;
    }
    if (pending.generation !== event.generation) return;
    if (event.itemId) current.current.onAction(event.itemId);
    else {
      session.current = null;
      setOpen(false);
    }
  }, []);
  useEffect(() => {
    const version = lifetime.current + 1;
    lifetime.current = version;
    let disposed = false;
    let stop: (() => void) | undefined;
    const subscribed = listenBrowserMenuEvent(receive).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else stop = unsubscribe;
    });
    ready.current = subscribed;
    void subscribed.catch((error) => {
      if (!disposed) current.current.onError(error);
    });
    return () => {
      lifetime.current = version + 1;
      disposed = true;
      stop?.();
      const tabId = session.current?.tab.tabId;
      session.current = null;
      if (tabId) void hideBrowserTabOverlay(tabId).catch(() => undefined);
    };
  }, [receive]);
  useEffect(() => {
    const pending = session.current;
    if (
      pending &&
      (!active ||
        !selected ||
        !matchesBrowserTabEvent(selected, pending.tab) ||
        selected.url !== pending.tab.url)
    ) {
      session.current = null;
      setOpen(false);
      void hideBrowserTabOverlay(pending.tab.tabId).catch(
        current.current.onError,
      );
    }
  }, [active, selected]);
  const show = async (
    element: HTMLElement,
    items: BrowserMenuItem[],
    confirmation?: BrowserMenuPresentation["confirmation"],
  ) => {
    const tab = current.current.selected;
    if (!tab || !current.current.active) return;
    if (session.current) {
      const previous = session.current;
      session.current = null;
      setOpen(false);
      await hideBrowserTabOverlay(previous.tab.tabId);
      return;
    }
    const version = lifetime.current;
    const pending: MenuSession = {
      id: `browser-options-${++nextMenu}`,
      tab,
      generation: null,
      queued: [],
    };
    session.current = pending;
    const rect = element.getBoundingClientRect();
    try {
      await ready.current;
      if (
        lifetime.current !== version ||
        session.current !== pending ||
        !current.current.active ||
        !matchesBrowserTabEvent(current.current.selected, tab) ||
        current.current.selected?.url !== tab.url
      )
        return;
      const receipt = await showBrowserTabMenu(tab.tabId, {
        menuId: pending.id,
        anchor: {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: rect.width,
          height: rect.height,
        },
        items,
        ...(confirmation ? { confirmation } : {}),
        appearance: document.documentElement.classList.contains("dark")
          ? "dark"
          : "light",
      });
      if (session.current !== pending) return;
      pending.generation = receipt.generation;
      setOpen(receipt.visible);
      const queued = pending.queued.splice(0);
      queued.forEach(receive);
    } catch (error) {
      if (session.current === pending) {
        session.current = null;
        setOpen(false);
        current.current.onError(error);
      }
    }
  };
  const update = useCallback(async (items: BrowserMenuItem[]) => {
    const pending = session.current;
    if (!pending || pending.generation === null) return;
    try {
      await updateBrowserTabMenu(
        pending.tab.tabId,
        pending.id,
        pending.generation,
        items,
      );
    } catch (error) {
      if (session.current === pending) current.current.onError(error);
    }
  }, []);
  return { open, show, update };
}
