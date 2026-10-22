import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageSquare, X } from "lucide-react";
import { requestWorkspaceRightSurface } from "@/lib/api/workspaceRightSurface";
import type { BrowserAnnotationDraft } from "./browserAnnotationDrafts";
import { useBrowserAnnotationRuntime } from "./BrowserAnnotationContext";
import { useBrowserAnnotationDrafts } from "./useBrowserAnnotationDrafts";

export function BrowserAnnotationAccessory() {
  const { t } = useTranslation("agent");
  const runtime = useBrowserAnnotationRuntime();
  const latest = useRef(runtime);
  latest.current = runtime;
  const { store, drafts, pending } = useBrowserAnnotationDrafts(
    runtime?.sessionId,
    runtime?.threadId,
  );
  const [openFailed, setOpenFailed] = useState(false);
  const opening = useRef(false);
  if (!runtime || !drafts.length) return null;
  const open = async (draft: BrowserAnnotationDraft) => {
    if (opening.current) return;
    opening.current = true;
    const captured = runtime;
    setOpenFailed(false);
    try {
      await requestWorkspaceRightSurface({
        surfaceKind: "browser",
        origin: "user",
        priority: "foreground",
        reason: "open_browser_annotation",
        sessionId: captured.sessionId,
        workspaceId: captured.workspaceId,
        workspaceRoot: null,
        metadata: { browser: { tabId: draft.event.tabId } },
      });
      if (
        latest.current?.sessionId === captured.sessionId &&
        latest.current.threadId === captured.threadId
      )
        store.focus(draft.id);
    } catch {
      if (
        latest.current?.sessionId === captured.sessionId &&
        latest.current.threadId === captured.threadId
      )
        setOpenFailed(true);
    } finally {
      opening.current = false;
    }
  };
  return (
    <section
      data-testid="browser-annotation-accessory"
      className="mb-2 space-y-2 rounded-xl border border-border bg-background px-3 py-2 text-xs"
      aria-label={String(t("browserAnnotation.title" as never))}
    >
      <div className="flex items-center gap-2">
        <MessageSquare
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="flex-1">
          {String(
            t(
              "browserAnnotation.count" as never,
              { count: drafts.length } as never,
            ),
          )}
        </span>
        <button
          type="button"
          className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
          disabled={pending}
          onClick={() =>
            void runtime.send({
              browserAnnotationIds: drafts.map((draft) => draft.id),
              sendOptions: {
                composerTarget: runtime.isSending ? "queue" : "start",
                skipSceneCommandRouting: true,
                skipWorkspaceCommandRouting: true,
                skipSessionRestore: true,
                targetSessionId: runtime.sessionId,
              },
            })
          }
        >
          {String(
            t(
              (pending
                ? "browserAnnotation.sending"
                : "browserAnnotation.sendAll") as never,
            ),
          )}
        </button>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            className="flex min-w-0 max-w-full items-center rounded-md border border-border"
          >
            <button
              type="button"
              disabled={draft.pending}
              className="min-w-0 truncate px-2 py-1 text-left hover:bg-muted disabled:opacity-40"
              onClick={() => void open(draft)}
              title={draft.event.selection.pageUrl}
            >
              {draft.body}
            </button>
            <button
              type="button"
              disabled={draft.pending}
              aria-label={String(t("browserAnnotation.remove" as never))}
              className="shrink-0 p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
              onClick={() => store.remove(draft.id)}
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {openFailed || drafts.some((draft) => draft.failure) ? (
        <p role="alert" className="text-destructive">
          {String(
            t(
              (openFailed
                ? "browserAnnotation.openFailed"
                : "browserAnnotation.sendFailed") as never,
            ),
          )}
        </p>
      ) : null}
    </section>
  );
}
