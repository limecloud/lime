import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ArrowUp,
  LoaderCircle,
  Scan,
  SquareMousePointer,
  TextSelect,
  X,
} from "lucide-react";
import { ComposerController } from "@/components/input-kit/ComposerController";
import {
  ComposerEditor,
  type ComposerEditorHandle,
} from "@/components/input-kit/ComposerEditor";
import type {
  BrowserAnnotationEditorAction,
  BrowserAnnotationEditorBridge,
  BrowserAnnotationEditorUpdate,
} from "@/lib/api/browserAnnotationEditorTypes";
import { sameBrowserAnnotationImages } from "@/lib/api/browserAnnotationImages";
import {
  sameBrowserDesignChange,
  type BrowserDesignChange,
} from "@/lib/api/browserDesign";
import { BrowserDesignEditor } from "./BrowserDesignEditor";
import { BrowserAnnotationImages } from "./BrowserAnnotationImages";
import { useBrowserAnnotationLayout } from "./useBrowserAnnotationLayout";
import {
  annotationComposerImages,
  annotationDocumentImages,
  annotationTransferImages,
  useBrowserAnnotationImages,
} from "./useBrowserAnnotationImages";

type Update = BrowserAnnotationEditorUpdate;

export function BrowserAnnotationEditor({
  bridge,
}: {
  bridge: BrowserAnnotationEditorBridge;
}) {
  const [update, setUpdate] = useState<Update | null>(null);
  const current = useRef<Update | null>(null);
  useEffect(() => {
    let alive = true;
    const unsubscribe = bridge.onUpdate((next) => {
      if (
        !alive ||
        (current.current && next.generation < current.current.generation)
      )
        return;
      current.current = next;
      setUpdate(next);
    });
    bridge.ready();
    return () => {
      alive = false;
      current.current = null;
      unsubscribe();
    };
  }, [bridge]);
  const readCurrent = useCallback(() => current.current, []);
  useLayoutEffect(() => {
    if (!update) return;
    document.documentElement.classList.toggle(
      "dark",
      update.presentation.appearance === "dark",
    );
    document.documentElement.style.colorScheme = update.presentation.appearance;
    document.title = update.presentation.labels.title;
  }, [update]);
  return update ? (
    <AnnotationDraft
      key={JSON.stringify([update.generation, update.presentation.editorId])}
      update={update}
      bridge={bridge}
      readCurrent={readCurrent}
    />
  ) : null;
}

function AnnotationDraft({
  update,
  bridge,
  readCurrent,
}: {
  update: Update;
  bridge: BrowserAnnotationEditorBridge;
  readCurrent: () => Update | null;
}) {
  const { presentation } = update;
  const { labels, selection } = presentation;
  const [controller] = useState(
    () =>
      new ComposerController(
        {
          text: presentation.body,
          attachments: annotationComposerImages(presentation.attachedImages),
        },
        { plainTextMode: true },
      ),
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const editorRef = useRef<ComposerEditorHandle>(null);
  const alive = useRef(false);
  const synchronizing = useRef(false);
  const revision = useRef(presentation.revision);
  const design = useRef(presentation.designChange ?? null);
  const [designChange, setDesignChange] = useState<BrowserDesignChange | null>(
    design.current,
  );
  const [invalidDesign, setInvalidDesign] = useState(false);
  const lastDraft = useRef({
    body: controller.getDocument().text,
    attachedImages: annotationDocumentImages(controller),
    designChange: design.current,
  });
  const previewOpen = useRef(false);
  const [previewing, setPreviewing] = useState(false);
  const setPreviewOpen = useCallback((open: boolean) => {
    previewOpen.current = open;
    setPreviewing(open);
  }, []);
  const surface = useBrowserAnnotationLayout(bridge, update.layout, previewing);
  const closePreview = useCallback(() => editorRef.current?.focus(), []);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const operation = useRef<{
    action: BrowserAnnotationEditorAction;
    update: Update;
    sawPending: boolean;
  } | null>(null);
  const [localAction, setLocalAction] =
    useState<BrowserAnnotationEditorAction | null>(null);
  const [localError, setLocalError] = useState(false);
  const currentUpdate = useCallback(() => {
    const next = readCurrent();
    return alive.current &&
      next?.generation === update.generation &&
      next.presentation.editorId === presentation.editorId
      ? next
      : null;
  }, [readCurrent, update.generation, presentation.editorId]);
  const canEdit = useCallback(() => {
    const next = currentUpdate();
    return !!next && !next.pending && !operation.current;
  }, [currentUpdate]);
  const images = useBrowserAnnotationImages(controller, canEdit);
  const { cancel: cancelImageReads, isReading: isReadingImages } = images;

  useLayoutEffect(() => {
    alive.current = true;
    const unsubscribe = controller.subscribe(() => {
      const next = currentUpdate();
      const body = controller.getDocument().text;
      const attachedImages = annotationDocumentImages(controller);
      if (
        !next ||
        synchronizing.current ||
        next.pending ||
        operation.current ||
        (body === lastDraft.current.body &&
          sameBrowserAnnotationImages(
            attachedImages,
            lastDraft.current.attachedImages,
          ) &&
          sameBrowserDesignChange(
            design.current,
            lastDraft.current.designChange,
          ))
      )
        return;
      lastDraft.current = {
        body,
        attachedImages,
        designChange: design.current,
      };
      revision.current =
        Math.max(revision.current, next.presentation.revision) + 1;
      setLocalError(false);
      try {
        bridge.act(
          "change",
          body,
          revision.current,
          attachedImages,
          design.current,
        );
      } catch {
        setLocalError(true);
      }
    });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [bridge, controller, currentUpdate]);

  useLayoutEffect(() => {
    const flush = () => {
      const next = currentUpdate();
      if (!next) return;
      cancelImageReads();
      const body = controller.getDocument().text;
      const attachedImages = annotationDocumentImages(controller);
      if (
        body !== lastDraft.current.body ||
        !sameBrowserAnnotationImages(
          attachedImages,
          lastDraft.current.attachedImages,
        ) ||
        !sameBrowserDesignChange(design.current, lastDraft.current.designChange)
      ) {
        lastDraft.current = {
          body,
          attachedImages,
          designChange: design.current,
        };
        revision.current =
          Math.max(revision.current, next.presentation.revision) + 1;
      }
      try {
        bridge.act(
          "change",
          body,
          revision.current,
          attachedImages,
          design.current,
        );
      } catch {
        setLocalError(true);
      }
    };
    window.addEventListener("browser-annotation-editor-flush", flush);
    return () =>
      window.removeEventListener("browser-annotation-editor-flush", flush);
  }, [bridge, controller, currentUpdate, cancelImageReads]);

  useLayoutEffect(() => {
    if (!update.error && presentation.revision >= revision.current) {
      revision.current = presentation.revision;
      synchronizing.current = true;
      lastDraft.current = {
        body: presentation.body,
        attachedImages: [...presentation.attachedImages],
        designChange: presentation.designChange ?? null,
      };
      try {
        design.current = presentation.designChange ?? null;
        setDesignChange(design.current);
        if (controller.getDocument().text !== presentation.body)
          controller.setText(presentation.body);
        if (
          !sameBrowserAnnotationImages(
            annotationDocumentImages(controller),
            presentation.attachedImages,
          )
        )
          controller.setAttachments(
            annotationComposerImages(presentation.attachedImages),
          );
      } finally {
        synchronizing.current = false;
      }
    }
    const active = operation.current;
    if (active && active.update !== update) {
      if (update.pending) active.sawPending = true;
      else if (update.error || active.sawPending) {
        operation.current = null;
        setLocalAction(null);
      }
    }
  }, [
    controller,
    presentation.body,
    presentation.attachedImages,
    presentation.revision,
    presentation.designChange,
    update,
  ]);

  const act = useCallback(
    (action: Exclude<BrowserAnnotationEditorAction, "change">) => {
      const next = currentUpdate();
      if (
        !next ||
        next.pending ||
        operation.current ||
        isReadingImages() ||
        previewOpen.current
      )
        return;
      const body = controller.getDocument().text;
      if (
        action !== "close" &&
        ((!body.trim() && !design.current) || invalidDesign)
      )
        return;
      operation.current = { action, update: next, sawPending: false };
      setLocalAction(action);
      setLocalError(false);
      try {
        bridge.act(
          action,
          body,
          revision.current,
          annotationDocumentImages(controller),
          design.current,
        );
      } catch {
        operation.current = null;
        setLocalAction(null);
        setLocalError(true);
      }
    },
    [bridge, controller, currentUpdate, isReadingImages, invalidDesign],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        previewOpen.current ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        editorRef.current?.isComposing()
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        act("close");
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [act]);

  const busy = update.pending || localAction !== null || images.loading;
  const sending = update.pending || localAction === "send";
  const empty = !snapshot.document.text.trim() && !designChange;
  const region = selection.kind === "region";
  const target = region
    ? `${Math.round(selection.targetRect.width)} × ${Math.round(selection.targetRect.height)} · ${Math.round(selection.targetRect.x)}, ${Math.round(selection.targetRect.y)}`
    : selection.targetText ||
      selection.targetSelector ||
      selection.targetPath ||
      selection.targetRole;
  const controlClass =
    "rounded-lg px-3 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-50";
  return (
    <div
      className="h-full w-full p-2"
      data-testid="browser-annotation-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) act("close");
      }}
    >
      <section
        ref={surface}
        role="dialog"
        aria-label={labels.title}
        aria-busy={busy}
        data-editor-id={presentation.editorId}
        data-generation={update.generation}
        style={{ maxHeight: Math.max(1, update.layout.maxHeight - 16) }}
        className={`flex min-h-0 w-full flex-col gap-2 rounded-2xl border border-border bg-popover p-3 text-popover-foreground shadow-lg ${dragging ? "ring-2 ring-ring" : ""}`}
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          if (canEdit()) {
            dragDepth.current++;
            setDragging(true);
          }
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = canEdit() ? "copy" : "none";
        }}
        onDragLeave={(event) => {
          if (!dragDepth.current) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = 0;
          setDragging(false);
          const files = annotationTransferImages(event.dataTransfer);
          images.add(
            files.length ? files : Array.from(event.dataTransfer.files),
          );
        }}
      >
        <header className="flex min-w-0 shrink-0 items-center gap-2">
          {region ? (
            <Scan
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          ) : selection.kind === "text" ? (
            <TextSelect
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          ) : (
            <SquareMousePointer
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xs font-medium">{labels.title}</h1>
            <p
              className="truncate text-xs text-muted-foreground"
              title={target ?? undefined}
              data-testid="browser-annotation-selection"
            >
              {labels[selection.kind]}
              {target ? ` · ${target}` : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label={labels.close}
            title={labels.close}
            disabled={busy}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground disabled:opacity-50"
            onClick={() => act("close")}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        {snapshot.document.attachments.length ? (
          <BrowserAnnotationImages
            images={annotationDocumentImages(controller)}
            labels={labels}
            disabled={busy}
            onRemove={images.remove}
            onPreviewOpenChange={setPreviewOpen}
            onPreviewClose={closePreview}
          />
        ) : null}
        <div className="min-h-0 max-h-[168px] overflow-y-auto">
          <ComposerEditor
            controller={controller}
            editorRef={editorRef}
            autoFocus
            placeholder={labels.placeholder}
            ariaLabel={labels.placeholder}
            disabled={update.pending || localAction !== null}
            testId="browser-annotation-composer"
            className="min-h-6 text-sm leading-6 outline-none before:pointer-events-none before:absolute before:text-muted-foreground data-[empty=true]:before:content-[attr(data-placeholder)]"
            onPaste={(event) => {
              if (!canEdit()) return true;
              const files = annotationTransferImages(event.clipboardData);
              if (!files.length) return false;
              images.add(files);
              return true;
            }}
            onKeyDown={(event) => {
              if (!currentUpdate() || operation.current) return true;
              if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
                event.preventDefault();
                act(event.metaKey || event.ctrlKey ? "send" : "save");
                return true;
              }
            }}
            onEscape={() => {
              act("close");
              return true;
            }}
            sendOnEnter={false}
          />
        </div>
        {presentation.designSnapshot && labels.design ? (
          <BrowserDesignEditor
            snapshot={presentation.designSnapshot}
            change={designChange}
            labels={labels.design}
            disabled={update.pending || localAction !== null}
            onInvalid={setInvalidDesign}
            onChange={(next) => {
              if (!canEdit() || sameBrowserDesignChange(next, design.current))
                return;
              design.current = next;
              setDesignChange(next);
              const body = controller.getDocument().text;
              const attachedImages = annotationDocumentImages(controller);
              lastDraft.current = { body, attachedImages, designChange: next };
              revision.current =
                Math.max(
                  revision.current,
                  currentUpdate()?.presentation.revision ?? 0,
                ) + 1;
              setLocalError(false);
              try {
                bridge.act(
                  "change",
                  body,
                  revision.current,
                  attachedImages,
                  next,
                );
              } catch {
                setLocalError(true);
              }
            }}
          />
        ) : null}
        {presentation.screenshotStatus !== "captured" ? (
          <p role="status" className="shrink-0 text-xs text-muted-foreground">
            {labels.captureFailed}
          </p>
        ) : null}
        {images.loading ? (
          <p role="status" className="shrink-0 text-xs text-muted-foreground">
            {labels.attachmentLoading}
          </p>
        ) : null}
        {images.error ? (
          <p role="alert" className="shrink-0 text-xs text-destructive">
            {labels.attachmentFailed}
          </p>
        ) : null}
        {update.error || localError ? (
          <p role="alert" className="shrink-0 text-xs text-destructive">
            {labels.sendFailed}
          </p>
        ) : null}
        <footer className="flex shrink-0 items-center justify-end gap-2">
          {sending ? (
            <span
              role="status"
              className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-3 animate-spin motion-reduce:animate-none"
              />
              {labels.sending}
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy || empty || invalidDesign}
            className={`${controlClass} bg-muted text-foreground hover:bg-accent`}
            onClick={() => act("save")}
          >
            {labels.save}
          </button>
          <button
            type="button"
            disabled={busy || empty || invalidDesign}
            className={`${controlClass} inline-flex items-center gap-1.5 bg-primary text-primary-foreground hover:opacity-90`}
            onClick={() => act("send")}
          >
            <ArrowUp aria-hidden="true" className="size-3.5" />
            {labels.send}
          </button>
        </footer>
      </section>
    </div>
  );
}
