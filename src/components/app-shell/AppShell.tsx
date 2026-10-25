import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";

import {
  createShellRegistry,
  type Align,
  type ContentLayout,
  type HeaderActionEntry,
  type HeaderEntry,
  type LayoutEntry,
  type PageHeaderEntry,
  type SlotPosition,
} from "./shellRegistry";
import {
  UnifiedTabStripRenderer,
  type UnifiedTabStripEntry,
} from "./UnifiedTabStripRenderer";
import { KeyboardShortcutsDialogHost } from "@/components/keyboard-shortcuts/KeyboardShortcutsDialogHost";
import { WindowCloseConfirmationDialogHost } from "@/components/window-close-confirmation/WindowCloseConfirmationDialogHost";

const HeaderContext = createContext<ReturnType<
  typeof createShellRegistry
> | null>(null);

function useHeaderRegistry() {
  const registry = useContext(HeaderContext);
  if (!registry) throw new Error("AppShell is missing");
  return registry;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [registry] = useState(createShellRegistry);
  return (
    <HeaderContext.Provider value={registry}>
      {children}
      <KeyboardShortcutsDialogHost />
      <WindowCloseConfirmationDialogHost />
    </HeaderContext.Provider>
  );
}

function useShellSnapshot() {
  const registry = useHeaderRegistry();
  return useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
}

export function Header({
  children,
  className,
  contentFade = true,
  divider = true,
  desktopPlacement = "page",
  inline = false,
  separator = false,
}: {
  children: ReactNode;
  className?: string;
  contentFade?: boolean;
  divider?: boolean;
  desktopPlacement?: PageHeaderEntry["desktopPlacement"];
  inline?: boolean;
  separator?: boolean;
}) {
  const registry = useHeaderRegistry();
  useLayoutEffect(() => {
    registry.setPageHeader(
      inline
        ? null
        : { node: children, contentFade, divider, desktopPlacement, separator },
    );
    return () => registry.setPageHeader(null);
  }, [
    registry,
    children,
    contentFade,
    divider,
    desktopPlacement,
    inline,
    separator,
  ]);
  return inline ? (
    <div
      className={className}
      style={
        separator
          ? { borderBottom: "1px solid var(--lime-surface-border)" }
          : undefined
      }
    >
      {children}
    </div>
  ) : null;
}

export function UnifiedTabStrip({
  children,
  mode,
  isVisible,
  desktopPlacement = "page",
  mainTabId,
  mainTabPanelId,
  mainToolbar,
  sidePanelTabStrip,
  sidePanelActive,
  mainPaneEnd,
  onContentTabDoubleClick,
}: Omit<UnifiedTabStripEntry, "node"> & { children?: ReactNode }) {
  const registry = useHeaderRegistry();
  const entry = useRef<UnifiedTabStripEntry | null>(null);
  useLayoutEffect(() => {
    entry.current = {
      mode,
      isVisible,
      desktopPlacement,
      mainTabId,
      mainTabPanelId,
      mainToolbar,
      sidePanelTabStrip,
      sidePanelActive,
      mainPaneEnd,
      onContentTabDoubleClick,
      node: children,
    };
    registry.setUnifiedTabStrip(entry.current);
  }, [
    registry,
    children,
    mode,
    isVisible,
    desktopPlacement,
    mainTabId,
    mainTabPanelId,
    mainToolbar,
    sidePanelTabStrip,
    sidePanelActive,
    mainPaneEnd,
    onContentTabDoubleClick,
  ]);
  useLayoutEffect(
    () => () => registry.removeUnifiedTabStrip(entry.current),
    [registry],
  );
  return null;
}

export function MainContentLayout({
  layout,
  fallback = false,
}: {
  layout: ContentLayout;
  fallback?: boolean;
}) {
  const registry = useHeaderRegistry();
  const entry = useRef<LayoutEntry | null>(null);
  useLayoutEffect(() => {
    entry.current = { layout };
    registry.setLayout(fallback, entry.current);
  }, [registry, fallback, layout]);
  useLayoutEffect(
    () => () => registry.removeLayout(fallback, entry.current),
    [registry, fallback],
  );
  return null;
}

export function AppShellContent({
  pageSurface,
  children,
  style,
  ...props
}: HTMLAttributes<HTMLElement> & { pageSurface: boolean }) {
  const registry = useHeaderRegistry();
  const { layout, pageHeader, unifiedTabStrip, contentBounds } =
    useShellSnapshot();
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () => {
      const { left, right } = element.getBoundingClientRect();
      registry.setContentBounds({ left, right });
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      registry.setContentBounds(null);
    };
  }, [registry]);
  const fullBleed = layout === "full-bleed" || layout === "custom-titlebar";
  const inset =
    !fullBleed &&
    (pageSurface || pageHeader !== null || unifiedTabStrip !== null);
  return (
    <main
      {...props}
      ref={ref}
      tabIndex={props.tabIndex ?? -1}
      data-app-shell-content
      data-main-content-layout={layout}
      className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${props.className ?? ""}`}
      style={{
        margin: inset ? (pageSurface ? "44px 4px 4px 0" : "44px 0 0") : 0,
        borderRadius: pageSurface && !fullBleed ? 12 : 0,
        background: "var(--lime-app-bg, hsl(var(--background)))",
        ...style,
      }}
    >
      {unifiedTabStrip?.desktopPlacement !== "titlebar" && unifiedTabStrip ? (
        <div
          className="h-[44px] shrink-0"
          style={
            {
              "--app-shell-main-titlebar-left": `${contentBounds?.left ?? 0}px`,
            } as CSSProperties
          }
        >
          <UnifiedTabStripRenderer entry={unifiedTabStrip} />
        </div>
      ) : null}
      {children}
    </main>
  );
}

export function HeaderAction({
  actionId,
  align = "start",
  allowsThreadContentOverlap = false,
  children,
  order = 0,
  slotPosition = "center",
}: {
  actionId: string;
  align?: Align;
  allowsThreadContentOverlap?: boolean;
  children: ReactNode;
  order?: number;
  slotPosition?: SlotPosition;
}) {
  const registry = useHeaderRegistry();
  const entry = useRef<HeaderEntry | null>(null);
  useLayoutEffect(() => {
    entry.current = {
      align,
      allowsThreadContentOverlap,
      node: children,
      order,
    };
    registry.update(slotPosition, actionId, entry.current);
  }, [
    registry,
    slotPosition,
    actionId,
    align,
    allowsThreadContentOverlap,
    children,
    order,
  ]);
  useLayoutEffect(() => {
    registry.register(slotPosition, actionId);
    return () => registry.remove(slotPosition, actionId, entry.current);
  }, [registry, slotPosition, actionId]);
  return null;
}

function HeaderSlot({
  entries,
  side,
  slotRef,
}: {
  entries: HeaderActionEntry[];
  side: "start" | "center" | "end";
  slotRef?: Ref<HTMLDivElement>;
}) {
  const start = entries.filter((entry) => entry.align === "start");
  const center = entries.filter((entry) => entry.align === "center");
  const end = entries.filter((entry) => entry.align === "end");
  const action = (entry: HeaderActionEntry, index: number) => (
    <div
      key={entry.actionId}
      data-header-action-id={entry.actionId}
      className="pointer-events-auto flex shrink-0 items-center"
      style={
        {
          WebkitAppRegion: "no-drag",
          marginInlineStart:
            entry.align === "end" && index === 0 ? "auto" : undefined,
        } as CSSProperties
      }
    >
      {entry.node}
    </div>
  );
  return (
    <div
      ref={slotRef}
      data-app-shell-header-slot={side}
      data-app-shell-header-obstacle
      data-app-shell-thread-content-overlap={
        (entries.length > 0 &&
          entries.every((entry) => entry.allowsThreadContentOverlap)) ||
        undefined
      }
      className="pointer-events-none flex h-full min-w-0 items-center gap-1.5"
      style={{ marginInlineStart: side === "end" ? "auto" : undefined }}
    >
      {start.map(action)}
      {center.length > 0 ? (
        <div className="mx-auto flex shrink-0 items-center gap-1.5">
          {center.map(action)}
        </div>
      ) : null}
      {end.map(action)}
    </div>
  );
}

export function AppShellHeader({
  reserveWindowControls = false,
}: {
  reserveWindowControls?: boolean;
}) {
  const entries = useShellSnapshot();
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [obstacles, setObstacles] = useState({ start: 0, end: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const start = startRef.current!.getBoundingClientRect().right;
      const end = endRef.current!.getBoundingClientRect().left;
      setObstacles((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end },
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(startRef.current!);
    observer?.observe(endRef.current!);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [reserveWindowControls, entries.left, entries.right]);
  const left = Math.max(
    entries.contentBounds?.left ?? 0,
    reserveWindowControls ? 92 : 8,
    entries.left.some((entry) => !entry.allowsThreadContentOverlap)
      ? obstacles.start + 6
      : 0,
  );
  const right = Math.max(
    8,
    entries.contentBounds ? window.innerWidth - entries.contentBounds.right : 0,
    entries.right.some((entry) => !entry.allowsThreadContentOverlap) &&
      obstacles.end
      ? window.innerWidth - obstacles.end + 6
      : 0,
  );
  const pageHeader =
    entries.layout === "custom-titlebar" || entries.unifiedTabStrip
      ? null
      : entries.pageHeader;
  return (
    <header
      data-app-shell-titlebar
      data-testid="app-shell-header"
      data-main-content-layout={entries.layout}
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex h-[44px] min-w-0 items-center gap-1.5"
      style={
        {
          paddingInlineStart: reserveWindowControls ? 92 : 8,
          paddingInlineEnd: 8,
          WebkitAppRegion: "drag",
        } as CSSProperties
      }
    >
      <HeaderSlot entries={entries.left} side="start" slotRef={startRef} />
      <div
        data-app-shell-main-titlebar
        className="pointer-events-none absolute inset-y-0 flex min-w-0 items-center gap-1.5"
        style={
          {
            left,
            right,
            "--app-shell-main-titlebar-left": `${left}px`,
          } as CSSProperties
        }
      >
        {entries.unifiedTabStrip?.desktopPlacement === "titlebar" ? (
          <UnifiedTabStripRenderer entry={entries.unifiedTabStrip} />
        ) : null}
        {pageHeader ? (
          <div
            data-app-shell-page-header
            data-desktop-placement={pageHeader.desktopPlacement}
            data-content-fade={pageHeader.contentFade}
            data-divider={pageHeader.divider}
            className="pointer-events-auto flex h-full min-w-0 flex-1 items-center"
            style={
              {
                WebkitAppRegion: "no-drag",
                borderBottom: pageHeader.separator
                  ? "1px solid var(--lime-surface-border)"
                  : undefined,
              } as CSSProperties
            }
          >
            {pageHeader.node}
          </div>
        ) : null}
        <HeaderSlot entries={entries.center} side="center" />
      </div>
      <HeaderSlot entries={entries.right} side="end" slotRef={endRef} />
    </header>
  );
}
