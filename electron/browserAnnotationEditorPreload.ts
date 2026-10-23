/* global process */
import { contextBridge, ipcRenderer } from "electron";
import {
  readBrowserDesignChange,
  readBrowserDesignSnapshot,
  sameBrowserDesignChange,
  type BrowserDesignChange,
} from "../src/lib/api/browserDesign";
import {
  readBrowserAnnotationImages,
  sameBrowserAnnotationImages,
  type BrowserAnnotationImage,
} from "../src/lib/api/browserAnnotationImages";
import {
  BROWSER_ANNOTATION_EDITOR_CHANNEL,
  BROWSER_ANNOTATION_EDITOR_UPDATE,
  isBrowserAnnotationEditorHeight,
  type BrowserAnnotationEditorAction,
  type BrowserAnnotationEditorBridge,
  type BrowserAnnotationEditorUpdate,
} from "../src/lib/api/browserAnnotationEditorTypes";

const argument = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const token = argument("browser-annotation-token");
const editorId = argument("browser-annotation-id");
const generation = Number(argument("browser-annotation-generation"));
const authorized =
  !!token && !!editorId && Number.isSafeInteger(generation) && generation > 0;
const callbacks = new Set<(update: BrowserAnnotationEditorUpdate) => void>();
let current: BrowserAnnotationEditorUpdate | null = null;
let body = "";
let attachedImages: BrowserAnnotationImage[] = [];
let designChange: BrowserDesignChange | null = null;
let revision = 0;
let pending = false;
let flushing = false;

function matches(value: unknown): value is Record<string, unknown> {
  if (
    !authorized ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return false;
  const message = value as Record<string, unknown>;
  return (
    message.token === token &&
    message.editorId === editorId &&
    message.generation === generation
  );
}

function text(value: unknown, version: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 100_000 &&
    typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version >= revision &&
    (version !== revision || value === body)
  );
}

ipcRenderer.on(BROWSER_ANNOTATION_EDITOR_UPDATE, (_event, value: unknown) => {
  if (!matches(value)) return;
  if (value.kind === "flush") {
    if (flushing || typeof value.flushId !== "string") return;
    // The trusted UI synchronously serializes its ComposerController. DOM text is not canonical.
    flushing = true;
    const scope = globalThis as unknown as {
      dispatchEvent?: (event: unknown) => boolean;
      Event?: new (type: string) => unknown;
    };
    try {
      if (scope.dispatchEvent && scope.Event)
        scope.dispatchEvent(new scope.Event("browser-annotation-editor-flush"));
    } finally {
      ipcRenderer.send(BROWSER_ANNOTATION_EDITOR_CHANNEL, {
        kind: "flushed",
        token,
        editorId,
        generation,
        flushId: value.flushId,
        body,
        attachedImages,
        revision,
        ...(current?.presentation.designSnapshot ? { designChange } : {}),
      });
    }
    return;
  }
  if (
    value.kind !== "update" ||
    flushing ||
    typeof value.pending !== "boolean" ||
    typeof value.error !== "boolean"
  )
    return;
  const presentation = value.presentation as
    | BrowserAnnotationEditorUpdate["presentation"]
    | undefined;
  const layout = value.layout as
    | BrowserAnnotationEditorUpdate["layout"]
    | undefined;
  if (
    !presentation ||
    presentation.editorId !== editorId ||
    typeof presentation.body !== "string" ||
    presentation.body.length > 100_000 ||
    !Number.isSafeInteger(presentation.revision) ||
    presentation.revision < 0 ||
    !layout ||
    !isBrowserAnnotationEditorHeight(layout.width) ||
    !isBrowserAnnotationEditorHeight(layout.maxHeight) ||
    Object.keys(layout).some((key) => !["width", "maxHeight"].includes(key))
  )
    return;
  let images;
  let design;
  try {
    images = readBrowserAnnotationImages(presentation.attachedImages);
    const seed =
      presentation.designSnapshot === undefined
        ? undefined
        : readBrowserDesignSnapshot(presentation.designSnapshot);
    design = readBrowserDesignChange(presentation.designChange, seed);
    if (design && !seed) return;
  } catch {
    return;
  }
  if (
    !current ||
    presentation.revision > revision ||
    (presentation.revision === revision &&
      presentation.body === body &&
      sameBrowserAnnotationImages(images, attachedImages) &&
      sameBrowserDesignChange(design, designChange))
  ) {
    body = presentation.body;
    attachedImages = images;
    revision = presentation.revision;
    designChange = design;
  }
  pending = value.pending;
  current = {
    presentation: {
      ...presentation,
      body,
      attachedImages,
      revision,
      ...(presentation.designSnapshot ? { designChange } : {}),
    },
    layout: { width: layout.width, maxHeight: layout.maxHeight },
    generation,
    pending,
    error: value.error,
  };
  for (const callback of callbacks) callback(current);
});

const bridge: BrowserAnnotationEditorBridge = {
  onUpdate(callback) {
    if (typeof callback !== "function") return () => {};
    callbacks.add(callback);
    if (current) callback(current);
    return () => {
      callbacks.delete(callback);
    };
  },
  ready() {
    if (authorized && !flushing)
      ipcRenderer.send(BROWSER_ANNOTATION_EDITOR_CHANNEL, {
        kind: "ready",
        token,
        editorId,
        generation,
      });
  },
  resize(height: number) {
    if (
      !authorized ||
      !current ||
      flushing ||
      !isBrowserAnnotationEditorHeight(height)
    )
      return;
    ipcRenderer.send(BROWSER_ANNOTATION_EDITOR_CHANNEL, {
      kind: "resize",
      token,
      editorId,
      generation,
      height,
    });
  },
  act(
    action: BrowserAnnotationEditorAction,
    nextBody: string,
    nextRevision: number,
    nextImages: readonly BrowserAnnotationImage[],
    nextDesign?: BrowserDesignChange | null,
  ) {
    if (
      !authorized ||
      !current ||
      !["change", "save", "send", "close"].includes(action) ||
      !text(nextBody, nextRevision)
    )
      return;
    let images;
    let design;
    try {
      images = readBrowserAnnotationImages(nextImages);
      design = readBrowserDesignChange(
        nextDesign,
        current.presentation.designSnapshot,
      );
      if (design && !current.presentation.designSnapshot) return;
    } catch {
      return;
    }
    if (
      nextRevision === revision &&
      (!sameBrowserAnnotationImages(images, attachedImages) ||
        !sameBrowserDesignChange(design, designChange))
    )
      return;
    if (flushing) {
      if (action === "change") {
        body = nextBody;
        attachedImages = images;
        revision = nextRevision;
        designChange = design;
      }
      return;
    }
    if (pending && action !== "change") return;
    body = nextBody;
    attachedImages = images;
    revision = nextRevision;
    designChange = design;
    if (action === "send") pending = true;
    ipcRenderer.send(BROWSER_ANNOTATION_EDITOR_CHANNEL, {
      kind: "action",
      token,
      editorId,
      generation,
      action,
      body,
      attachedImages,
      revision,
      ...(current.presentation.designSnapshot ? { designChange } : {}),
    });
  },
};

contextBridge.exposeInMainWorld(
  "browserAnnotationEditor",
  Object.freeze(bridge),
);
