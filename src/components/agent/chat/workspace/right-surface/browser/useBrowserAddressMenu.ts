import { useEffect, useRef, type RefObject } from "react";
import {
  hideBrowserTabOverlay,
  listenBrowserMenuEvent,
  showBrowserTabMenu,
  updateBrowserTabMenu,
  type BrowserMenuItem,
  type BrowserMenuEvent,
} from "@/lib/api/browserMenu";
import type { BrowserTabState } from "@/lib/api/browserTab";
import type { BrowserHistoryEntry } from "@/lib/api/browserHistory";
import { matchesBrowserTabEvent } from "./browserTabEventIdentity";

let nextPopup = 0;
type Session = {
  tab: BrowserTabState;
  menuId: string;
  generation?: number;
  queued: BrowserMenuEvent[];
};
const hide = (session: Session) =>
  hideBrowserTabOverlay(session.tab.tabId, {
    menuId: session.menuId,
    generation: session.generation,
  });

/** The native popup never takes keyboard focus from the renderer address input. */
export function useBrowserAddressMenu(options: {
  selected: BrowserTabState | null;
  input: RefObject<HTMLInputElement | null>;
  entries: BrowserHistoryEntry[];
  selection: number;
  onSelect: (url: string) => void;
  onDismiss: () => void;
}) {
  const current = useRef(options);
  current.current = options;
  const session = useRef<Session | null>(null);
  const tail = useRef(Promise.resolve());
  const ready = useRef<Promise<void>>(Promise.resolve());
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let stop: (() => void) | undefined;
    const receive = (event: BrowserMenuEvent) => {
      const pending = session.current;
      if (
        !pending ||
        event.generation !== pending.generation ||
        current.current.selected?.url !== pending.tab.url
      )
        return;
      if (event.itemId) {
        const entry = current.current.entries.find(
          (entry) => entry.id === event.itemId,
        );
        if (entry) current.current.onSelect(entry.url);
      } else current.current.onDismiss();
    };
    ready.current = listenBrowserMenuEvent((event) => {
      const pending = session.current;
      if (
        !pending ||
        event.menuId !== pending.menuId ||
        !matchesBrowserTabEvent(pending.tab, event) ||
        !matchesBrowserTabEvent(current.current.selected, event)
      )
        return;
      if (pending.generation === undefined) {
        pending.queued.push(event);
        return;
      }
      if (event.generation !== pending.generation) return;
      receive(event);
    }).then((unsubscribe) => {
      if (disposed) unsubscribe();
      else stop = unsubscribe;
    });
    void ready.current.catch(() => undefined);
    return () => {
      alive.current = false;
      disposed = true;
      stop?.();
      const pending = session.current;
      session.current = null;
      if (pending) void hide(pending).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      await ready.current;
      if (cancelled || !alive.current) return;
      const { selected, input, entries, selection } = current.current;
      let pending = session.current;
      if (
        pending &&
        (!entries.length ||
          !matchesBrowserTabEvent(selected, pending.tab) ||
          selected?.url !== pending.tab.url)
      ) {
        session.current = null;
        await hide(pending);
        pending = null;
      }
      if (
        !selected ||
        !input.current ||
        !entries.length ||
        cancelled ||
        !alive.current
      )
        return;
      const items: BrowserMenuItem[] = entries.map((entry, index) => ({
        id: entry.id,
        label: (entry.title || entry.url).slice(0, 1000),
        shortcut: entry.url.slice(0, 100),
        checked: index === selection,
      }));
      if (pending) {
        if (pending.generation !== undefined)
          await updateBrowserTabMenu(
            selected.tabId,
            pending.menuId,
            pending.generation,
            items,
          );
        return;
      }
      const rect = input.current.getBoundingClientRect();
      pending = {
        tab: selected,
        menuId: `browser-address-${++nextPopup}`,
        queued: [],
      };
      session.current = pending;
      const receipt = await showBrowserTabMenu(selected.tabId, {
        menuId: pending.menuId,
        mode: "address",
        items,
        anchor: {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: rect.width,
          height: rect.height,
        },
        appearance: document.documentElement.classList.contains("dark")
          ? "dark"
          : "light",
      });
      if (!alive.current || session.current !== pending) {
        await hideBrowserTabOverlay(selected.tabId, {
          menuId: pending.menuId,
          generation: receipt.generation,
        });
        return;
      }
      pending.generation = receipt.generation;
      if (!receipt.visible) {
        session.current = null;
        current.current.onDismiss();
        return;
      }
      for (const event of pending.queued.splice(0)) {
        if (
          event.generation !== pending.generation ||
          current.current.selected?.url !== pending.tab.url
        )
          continue;
        if (!event.itemId) current.current.onDismiss();
        else {
          const entry = current.current.entries.find(
            (entry) => entry.id === event.itemId,
          );
          if (entry) current.current.onSelect(entry.url);
        }
      }
    };
    tail.current = tail.current.then(sync).catch(() => {
      if (alive.current && !cancelled) current.current.onDismiss();
    });
    return () => {
      cancelled = true;
    };
  }, [options.entries, options.selection, options.selected, options.input]);
}
