/* global process */
import { contextBridge, ipcRenderer } from "electron";
import {
  BROWSER_ANNOTATION_EDITOR_CHANNEL,
  BROWSER_ANNOTATION_EDITOR_UPDATE,
  type BrowserAnnotationEditorAction,
  type BrowserAnnotationEditorBridge,
  type BrowserAnnotationEditorUpdate,
} from "../src/lib/api/browserAnnotationEditorTypes";

const argument = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const token = argument("browser-annotation-token");
const editorId = argument("browser-annotation-id");
const generation = Number(argument("browser-annotation-generation"));
const authorized = !!token && !!editorId && Number.isSafeInteger(generation) && generation > 0;
const callbacks = new Set<(update: BrowserAnnotationEditorUpdate) => void>();
let current: BrowserAnnotationEditorUpdate | null = null;
let body = "";
let revision = 0;
let pending = false;
let flushing = false;

function matches(value: unknown): value is Record<string, unknown> {
  if (!authorized || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return message.token === token && message.editorId === editorId && message.generation === generation;
}

function text(value: unknown, version: unknown): value is string {
  return typeof value === "string" && value.length <= 100_000 && typeof version === "number"
    && Number.isSafeInteger(version) && version >= revision && (version !== revision || value === body);
}

ipcRenderer.on(BROWSER_ANNOTATION_EDITOR_UPDATE, (_event, value: unknown) => {
  if (!matches(value)) return;
  if (value.kind === "flush") {
    if (flushing || typeof value.flushId !== "string") return;
    // The trusted UI synchronously serializes its ComposerController. DOM text is not canonical.
    flushing = true;
    const scope = globalThis as unknown as { dispatchEvent?: (event: unknown) => boolean; Event?: new (type: string) => unknown };
    try {
      if (scope.dispatchEvent && scope.Event) scope.dispatchEvent(new scope.Event("browser-annotation-editor-flush"));
    } finally {
      ipcRenderer.send(BROWSER_ANNOTATION_EDITOR_CHANNEL, { kind: "flushed", token, editorId, generation, flushId: value.flushId, body, revision });
    }
    return;
  }
  if (value.kind !== "update" || flushing || typeof value.pending !== "boolean" || typeof value.error !== "boolean") return;
  const presentation = value.presentation as BrowserAnnotationEditorUpdate["presentation"] | undefined;
  if (!presentation || presentation.editorId !== editorId || typeof presentation.body !== "string"
    || presentation.body.length > 100_000 || !Number.isSafeInteger(presentation.revision) || presentation.revision < 0) return;
  if (!current || presentation.revision > revision || (presentation.revision === revision && presentation.body === body)) {
    body = presentation.body;
    revision = presentation.revision;
  }
  pending = value.pending;
  current = { presentation: { ...presentation, body, revision }, generation, pending, error: value.error };
  for (const callback of callbacks) callback(current);
});

const bridge: BrowserAnnotationEditorBridge = {
  onUpdate(callback) {
    if (typeof callback !== "function") return () => {};
    callbacks.add(callback);
    if (current) callback(current);
    return () => { callbacks.delete(callback); };
  },
  ready() {
    if (authorized && !flushing) ipcRenderer.send(BROWSER_ANNOTATION_EDITOR_CHANNEL, { kind: "ready", token, editorId, generation });
  },
  act(action: BrowserAnnotationEditorAction, nextBody: string, nextRevision: number) {
    if (!authorized || !current || !["change", "save", "send", "close"].includes(action) || !text(nextBody, nextRevision)) return;
    if (flushing) {
      if (action === "change") { body = nextBody; revision = nextRevision; }
      return;
    }
    if (pending && action !== "change") return;
    body = nextBody;
    revision = nextRevision;
    if (action === "send") pending = true;
    ipcRenderer.send(BROWSER_ANNOTATION_EDITOR_CHANNEL, { kind: "action", token, editorId, generation, action, body, revision });
  },
};

contextBridge.exposeInMainWorld("browserAnnotationEditor", Object.freeze(bridge));
