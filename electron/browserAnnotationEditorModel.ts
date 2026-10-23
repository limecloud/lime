import type { BrowserWindow, WebContents } from "electron";
import { readBrowserAnnotationImages } from "../src/lib/api/browserAnnotationImages";
import {
  readBrowserDesignChange,
  readBrowserDesignSnapshot,
  type BrowserDesignLabels,
} from "../src/lib/api/browserDesign";
import type { BrowserAnnotationIdentity } from "../src/lib/api/browserAnnotationTypes";
import type {
  BrowserAnnotationEditorLabels,
  BrowserAnnotationEditorPresentation,
} from "../src/lib/api/browserAnnotationEditorTypes";
import {
  annotationKind,
  annotationRecord,
  annotationString,
  readAnnotationSelection,
} from "./browserAnnotationModel";

export function readAnnotationEditorPresentation(
  value: unknown,
): BrowserAnnotationEditorPresentation {
  const source = annotationRecord(value);
  annotationEditorKeys(source, [
    "editorId",
    "annotationId",
    "draftId",
    "body",
    "attachedImages",
    "revision",
    "selection",
    "screenshotStatus",
    "labels",
    "appearance",
    "designSnapshot",
    "designChange",
  ]);
  const id = (value: unknown) => {
    if (typeof value !== "string" || !/^[a-zA-Z0-9._:-]{1,100}$/u.test(value))
      throw new Error("Browser annotation editor identity is invalid");
    return value;
  };
  if (
    typeof source.body !== "string" ||
    source.body.length > 100_000 ||
    typeof source.revision !== "number" ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 0
  )
    throw new Error("Browser annotation editor draft is invalid");
  if (
    !["captured", "failed", "stale", "timeout"].includes(
      source.screenshotStatus as string,
    ) ||
    !["light", "dark"].includes(source.appearance as string)
  )
    throw new Error("Browser annotation editor presentation is invalid");
  const labels = annotationRecord(source.labels);
  const labelKeys: (keyof BrowserAnnotationEditorLabels)[] = [
    "title",
    "placeholder",
    "save",
    "send",
    "close",
    "element",
    "region",
    "text",
    "captureFailed",
    "sending",
    "sendFailed",
    "imageAttachment",
    "removeImage",
    "previewImage",
    "closePreview",
    "attachmentFailed",
    "attachmentLoading",
  ];
  annotationEditorKeys(labels, [...labelKeys, "design"]);
  for (const key of labelKeys)
    if (
      typeof labels[key] !== "string" ||
      !(labels[key] as string).trim() ||
      (labels[key] as string).length > 1000
    )
      throw new Error("Browser annotation editor label is invalid");
  const selection = annotationRecord(source.selection);
  const designSnapshot =
    source.designSnapshot === undefined
      ? undefined
      : readBrowserDesignSnapshot(source.designSnapshot);
  const designChange = readBrowserDesignChange(
    source.designChange,
    designSnapshot,
  );
  let designLabels: BrowserDesignLabels | undefined;
  if (designSnapshot) {
    if (selection.kind !== "element")
      throw new Error("Browser design requires an element");
    const design = annotationRecord(labels.design);
    const keys = ["title", "text", "reset", "invalid"] as const;
    annotationEditorKeys(design, keys);
    for (const key of keys)
      if (
        typeof design[key] !== "string" ||
        !(design[key] as string).trim() ||
        (design[key] as string).length > 1000
      )
        throw new Error("Invalid Browser design label");
    designLabels = { ...design } as unknown as BrowserDesignLabels;
  } else if (designChange)
    throw new Error("Browser design baseline is missing");
  if (
    typeof selection.pageTitle !== "string" ||
    selection.pageTitle.length > 8192
  )
    throw new Error("Browser annotation editor page title is invalid");
  return {
    editorId: id(source.editorId),
    annotationId: id(source.annotationId),
    draftId: id(source.draftId),
    body: source.body,
    attachedImages: readBrowserAnnotationImages(source.attachedImages),
    revision: source.revision,
    selection: readAnnotationSelection(
      selection,
      annotationKind(selection.kind),
      annotationString(selection.pageUrl),
      selection.pageTitle,
    ),
    screenshotStatus:
      source.screenshotStatus as BrowserAnnotationEditorPresentation["screenshotStatus"],
    labels: {
      ...labels,
      ...(designLabels ? { design: designLabels } : {}),
    } as unknown as BrowserAnnotationEditorLabels,
    appearance: source.appearance as "light" | "dark",
    ...(designSnapshot ? { designSnapshot, designChange } : {}),
  };
}

export function annotationEditorKeys(
  source: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(source).some((key) => !allowed.includes(key)))
    throw new Error("Browser annotation editor contains unsupported data");
}

export function readAnnotationEditorIdentity(
  value: BrowserAnnotationIdentity,
  window: BrowserWindow,
  viewId: string,
  page: WebContents,
): BrowserAnnotationIdentity {
  const source = annotationRecord(value);
  annotationEditorKeys(source, [
    "browserSessionId",
    "threadId",
    "tabId",
    "viewId",
    "ownerWebContentsId",
    "webContentsId",
    "windowId",
    "pageRevision",
  ]);
  if (
    source.viewId !== viewId ||
    source.windowId !== window.id ||
    source.ownerWebContentsId !== window.webContents.id ||
    source.webContentsId !== page.id ||
    typeof source.pageRevision !== "number" ||
    !Number.isSafeInteger(source.pageRevision) ||
    source.pageRevision < 0
  )
    throw new Error("Browser annotation editor owner identity is invalid");
  return {
    browserSessionId: annotationString(source.browserSessionId),
    threadId: annotationString(source.threadId),
    tabId: annotationString(source.tabId),
    viewId,
    ownerWebContentsId: window.webContents.id,
    webContentsId: page.id,
    windowId: window.id,
    pageRevision: source.pageRevision,
  };
}
