import { useEffect } from "react";
import {
  isBrowserTabHostAvailable,
  listBrowserTabs,
  mountBrowserTab,
  listenBrowserTabClosed,
  listenBrowserTabState,
  type BrowserTabState,
} from "@/lib/api/browserTab";
import { openBrowserWorkspaceIdentity } from "@/lib/api/browserWorkspace";
import { rememberBrowserPresentation } from "./right-surface/browser/browserPresentation";
import {
  projectBrowserTabChanges,
  type BrowserTabChange,
} from "./right-surface/browser/browserTabHydration";

/** Subscribe before reading so a background popup or close cannot be lost to the snapshot. */
export function useWorkspaceBrowserTabProjection({
  enabled,
  runtimeSessionId,
  threadId,
  resumeUrl = null,
  onProjection,
}: {
  enabled: boolean;
  runtimeSessionId: string | null;
  threadId: string | null;
  resumeUrl?: string | null;
  onProjection: (states: readonly BrowserTabState[]) => void;
}) {
  useEffect(() => {
    if (
      !enabled ||
      !runtimeSessionId ||
      !threadId ||
      !isBrowserTabHostAvailable()
    )
      return;
    let disposed = false;
    let pending = true;
    let anchor: BrowserTabState | null = null;
    let states: BrowserTabState[] = [];
    let changes: BrowserTabChange[] = [];
    const closedViews = new Set<string>();
    const cleanup: Array<() => void> = [];
    const publish = () => {
      if (!disposed) onProjection(states);
    };
    const receive = (change: BrowserTabChange) => {
      const state = change.kind === "state" ? change.state : change.event;
      if (disposed || state.threadId !== threadId) return;
      // The outgoing document loses its native views on reload or shutdown. This revokes
      // control, but must not overwrite the next renderer's navigation hint.
      if (
        change.kind === "closed" &&
        ["renderer-navigation", "window-closed", "host-dispose"].includes(
          change.event.reason,
        )
      )
        return;
      if (pending) {
        changes.push(change);
        return;
      }
      if (!anchor && change.kind === "state") anchor = change.state;
      if (!anchor) return;
      states = projectBrowserTabChanges(states, [change], anchor, closedViews);
      publish();
    };
    const register = async (subscription: Promise<() => void>) => {
      const stop = await subscription;
      if (disposed) stop();
      else cleanup.push(stop);
    };
    void (async () => {
      await Promise.all([
        register(
          listenBrowserTabState((state) => receive({ kind: "state", state })),
        ),
        register(
          listenBrowserTabClosed((event) => receive({ kind: "closed", event })),
        ),
      ]);
      if (disposed) return;
      const identity = await openBrowserWorkspaceIdentity({
        runtimeSessionId,
        threadId,
      });
      if (disposed) return;
      let snapshot = await listBrowserTabs({
        browserSessionId: identity.browserSessionId,
        threadId,
      });
      if (disposed) return;
      if (!snapshot.length && !changes.length && resumeUrl) {
        const restored = await mountBrowserTab({
          ...identity,
          threadId,
          url: resumeUrl,
          restoreNavigation: true,
          selected: true,
          visible: false,
          bounds: { x: 0, y: 0, width: 0, height: 0 },
        });
        if (disposed) return;
        if (
          restored.threadId !== threadId ||
          restored.browserSessionId !== identity.browserSessionId ||
          restored.tabId !== identity.tabId
        )
          throw new Error(
            "Restored browser does not belong to the canonical conversation",
          );
        snapshot = [restored];
        rememberBrowserPresentation(
          { sessionId: runtimeSessionId, threadId },
          restored.tabId,
          restored.url,
        );
      } else if (snapshot.length && resumeUrl) {
        const selected = snapshot.find((tab) => tab.selected) ?? snapshot[0];
        rememberBrowserPresentation(
          { sessionId: runtimeSessionId, threadId },
          selected.tabId,
          selected.url,
        );
      }
      const first = changes.find(
        (change) =>
          change.kind === "state" &&
          change.state.browserSessionId === identity.browserSessionId,
      );
      anchor = snapshot[0] ?? (first?.kind === "state" ? first.state : null);
      states = anchor
        ? projectBrowserTabChanges(snapshot, changes, anchor, closedViews)
        : [];
      changes = [];
      pending = false;
      publish();
    })().catch((reason: unknown) => {
      cleanup.splice(0).forEach((stop) => stop());
      // BrowserWorkspace presents the same bridge error with its retry controls.
      if (!disposed)
        console.error("Browser tab strip projection failed", reason);
    });
    return () => {
      disposed = true;
      cleanup.forEach((stop) => stop());
    };
  }, [enabled, runtimeSessionId, threadId, resumeUrl, onProjection]);
}
