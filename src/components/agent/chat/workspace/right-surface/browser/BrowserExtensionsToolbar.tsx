import { useEffect, useRef, useState } from "react";
import { MoreHorizontal, Puzzle } from "lucide-react";
import { useAppNavigationRequest } from "@/contexts/AppNavigationContext";
import { openExternalUrlWithSystemBrowser } from "@/lib/api/externalUrl";
import {
  listBrowserExtensions,
  type BrowserExtensionSummary,
} from "@/lib/api/browserExtensions";
import { SettingsTabs } from "@/types/settings";
import { browserIconButton } from "./BrowserNavigationBar";

const PINNED_STORAGE_KEY = "lime.browser.extensions.pinned.v1";
const TOOLBAR_ITEM_WIDTH = 28;
const TOOLBAR_TRIGGER_WIDTH = 40;

type MenuTarget = "all" | "overflow" | `extension:${string}` | null;

function readPinned(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PINNED_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writePinned(ids: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Toolbar pinning remains usable for the current session.
  }
}

export function BrowserExtensionsToolbar({
  translate,
}: {
  translate: (key: string, options?: Record<string, unknown>) => string;
}) {
  const navigate = useAppNavigationRequest();
  const [extensions, setExtensions] = useState<
    BrowserExtensionSummary[] | null
  >(null);
  const [pinned, setPinned] = useState<string[]>(readPinned);
  const [menu, setMenu] = useState<MenuTarget>(null);
  const [error, setError] = useState(false);
  const [width, setWidth] = useState<number>(Number.POSITIVE_INFINITY);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu || extensions !== null) return;
    setError(false);
    void listBrowserExtensions()
      .then((next) => setExtensions(next))
      .catch(() => setError(true));
  }, [extensions, menu]);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === "number") setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setPinned((current) => {
      const next = current.filter(
        (id) => extensions?.some((extension) => extension.id === id) ?? true,
      );
      if (next.length !== current.length) writePinned(next);
      return next;
    });
  }, [extensions]);

  const enabled = extensions?.filter((extension) => extension.enabled) ?? [];
  const pinnedExtensions = enabled.filter((extension) =>
    pinned.includes(extension.id),
  );
  const visibleCount = Number.isFinite(width)
    ? Math.max(
        0,
        Math.floor((width - TOOLBAR_TRIGGER_WIDTH) / TOOLBAR_ITEM_WIDTH),
      )
    : pinnedExtensions.length;
  const visiblePinned = pinnedExtensions.slice(0, visibleCount);
  const overflowPinned = pinnedExtensions.slice(visibleCount);
  const activeExtension = menu?.startsWith("extension:")
    ? enabled.find((extension) => `extension:${extension.id}` === menu)
    : undefined;

  const togglePinned = (id: string) => {
    setPinned((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      writePinned(next);
      return next;
    });
  };

  const manageExtensions = () => {
    setMenu(null);
    navigate?.("settings", { tab: SettingsTabs.BrowserExtension });
  };

  const openWebStore = () => {
    setMenu(null);
    void openExternalUrlWithSystemBrowser("https://chromewebstore.google.com/");
  };

  const renderMoreMenu = (extension: BrowserExtensionSummary) => {
    const isPinned = pinned.includes(extension.id);
    return (
      <div
        role="menu"
        className="absolute right-0 top-8 z-40 w-64 rounded-lg border border-border bg-popover p-1 shadow-lg"
      >
        <p className="truncate px-2 py-1.5 text-xs font-medium">
          {extension.name}
        </p>
        <button
          type="button"
          role="menuitem"
          className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
          onClick={() => togglePinned(extension.id)}
        >
          {translate(
            isPinned
              ? "browserExtensions.unpinNamed"
              : "browserExtensions.pinNamed",
            { name: extension.name },
          )}
        </button>
        {isPinned ? (
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => togglePinned(extension.id)}
          >
            {translate("browserExtensions.hide")}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
          onClick={manageExtensions}
        >
          {translate("browserExtensions.manage")}
        </button>
        <button
          type="button"
          role="menuitem"
          className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
          onClick={openWebStore}
        >
          {translate("browserExtensions.webStore")}
        </button>
      </div>
    );
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-0.5">
      {visiblePinned.map((extension) => (
        <button
          key={extension.id}
          type="button"
          className={browserIconButton}
          title={extension.name}
          aria-label={extension.name}
          onClick={() => setMenu(`extension:${extension.id}`)}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu(`extension:${extension.id}`);
          }}
        >
          <span className="text-[11px] font-semibold uppercase">
            {extension.name.trim().charAt(0) || "?"}
          </span>
        </button>
      ))}
      {overflowPinned.length > 0 ? (
        <button
          type="button"
          className={browserIconButton}
          aria-label={translate("browserExtensions.overflow")}
          title={translate("browserExtensions.overflow")}
          data-testid="browser-extensions-overflow"
          onClick={() => setMenu("overflow")}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
      <button
        type="button"
        className={browserIconButton}
        aria-label={translate("browserExtensions.titleWithCount", {
          count: enabled.length,
        })}
        title={translate("browserExtensions.titleWithCount", {
          count: enabled.length,
        })}
        aria-expanded={menu === "all"}
        data-testid="browser-extensions-toolbar"
        onClick={() => setMenu(menu === "all" ? null : "all")}
      >
        <Puzzle className="h-4 w-4" aria-hidden="true" />
        {extensions ? (
          <span className="ml-0.5 text-[10px] text-[color:var(--lime-text-muted)]">
            {enabled.length}
          </span>
        ) : null}
      </button>
      {menu === "all" ? (
        <div
          role="menu"
          className="absolute right-0 top-8 z-30 w-72 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {extensions === null && !error ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {translate("browserExtensions.loading")}
            </p>
          ) : null}
          {error ? (
            <p className="px-2 py-2 text-xs text-destructive">
              {translate("browserExtensions.loadError")}
            </p>
          ) : null}
          {extensions && enabled.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {translate("browserExtensions.empty")}
            </p>
          ) : null}
          {enabled.map((extension) => {
            const isPinned = pinned.includes(extension.id);
            return (
              <div
                key={extension.id}
                className="flex items-center gap-1 rounded px-1 py-1 hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate px-1 text-xs">
                  {extension.name}
                </span>
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-[11px] text-[color:var(--lime-info)]"
                  onClick={() => togglePinned(extension.id)}
                >
                  {translate(
                    isPinned
                      ? "browserExtensions.unpin"
                      : "browserExtensions.pin",
                  )}
                </button>
                <button
                  type="button"
                  className={browserIconButton}
                  aria-label={translate("browserExtensions.more", {
                    name: extension.name,
                  })}
                  title={translate("browserExtensions.more", {
                    name: extension.name,
                  })}
                  onClick={() => setMenu(`extension:${extension.id}`)}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {menu === "overflow" ? (
        <div
          role="menu"
          className="absolute right-0 top-8 z-30 w-64 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {overflowPinned.map((extension) => (
            <div
              key={extension.id}
              className="flex items-center gap-1 rounded px-1 py-1 hover:bg-muted"
            >
              <span className="min-w-0 flex-1 truncate px-1 text-xs">
                {extension.name}
              </span>
              <button
                type="button"
                className={browserIconButton}
                aria-label={translate("browserExtensions.more", {
                  name: extension.name,
                })}
                onClick={() => setMenu(`extension:${extension.id}`)}
              >
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {activeExtension ? (
        <div className="absolute right-0 top-8 z-50">
          {renderMoreMenu(activeExtension)}
        </div>
      ) : null}
    </div>
  );
}
