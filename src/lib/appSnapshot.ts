import { safeInvoke } from "@/lib/dev-bridge";

export interface NativeWindowInfo {
  windowId: number;
  ownerPid?: number;
  ownerName?: string;
  title?: string;
  bundleIdentifier?: string;
  layer?: number;
  bounds?: { width?: number; height?: number };
}

export interface AppSnapshotCapture {
  file: File;
  width: number;
  height: number;
  ownerName: string;
  title: string;
  text: string;
}

export interface AccessibilityTreeLike {
  role?: unknown;
  value?: unknown;
  title?: unknown;
  description?: unknown;
  children?: unknown;
}

const MAX_ACCESSIBILITY_TEXT = 4000;
const TEXT_ROLES = new Set([
  "AXStaticText",
  "AXTextArea",
  "AXTextField",
  "AXHeading",
  "AXLink",
]);

const LIME_BUNDLE_ID = "com.limecloud.lime";
const LIME_OWNER_NAME = "Lime";
const DOUBLE_COMMAND_WINDOW_MS = 500;
export const APP_SNAPSHOT_TRIGGER_EVENT = "lime-app-snapshot-trigger";

export class DoubleCommandDetector {
  #lastDownMs: number | null = null;

  handle(event: {
    modifier?: unknown;
    phase?: unknown;
    timestamp?: unknown;
  }): boolean {
    if (event.phase !== "down") return false;
    if (event.modifier !== "command") {
      this.#lastDownMs = null;
      return false;
    }
    const timestamp = Number(event.timestamp);
    if (!Number.isFinite(timestamp)) return false;
    const now = timestamp * 1000;
    const last = this.#lastDownMs;
    if (last !== null && now - last <= DOUBLE_COMMAND_WINDOW_MS) {
      this.#lastDownMs = null;
      return true;
    }
    this.#lastDownMs = now;
    return false;
  }
}

function isLimeWindow(window: NativeWindowInfo): boolean {
  return (
    window.bundleIdentifier === LIME_BUNDLE_ID ||
    window.ownerName === LIME_OWNER_NAME
  );
}

export function pickFrontmostWindow(
  windows: readonly NativeWindowInfo[],
): NativeWindowInfo | null {
  for (const window of windows) {
    if (window.layer !== 0) continue;
    if (isLimeWindow(window)) continue;
    const width = window.bounds?.width ?? 0;
    const height = window.bounds?.height ?? 0;
    if (width <= 0 || height <= 0) continue;
    return window;
  }
  return null;
}

function invokeNative(
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  return safeInvoke("macos_native_host_invoke", { method, params });
}

export function base64PngToFile(dataBase64: string): File {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], "app-snapshot.png", { type: "image/png" });
}

export async function captureAppSnapshot(): Promise<AppSnapshotCapture | null> {
  const read = (await invokeNative("window.read")) as {
    windows?: NativeWindowInfo[];
  } | null;
  const target = pickFrontmostWindow(read?.windows ?? []);
  if (!target) return null;
  const shot = (await invokeNative("screenCapture.snapshot", {
    windowId: target.windowId,
  })) as { data?: unknown; width?: unknown; height?: unknown } | null;
  if (!shot || typeof shot.data !== "string" || !shot.data) return null;
  const text = await readAccessibilityText(target.windowId);
  return {
    file: base64PngToFile(shot.data),
    width: Number(shot.width) || 0,
    height: Number(shot.height) || 0,
    ownerName: target.ownerName ?? "",
    title: target.title ?? "",
    text,
  };
}

export function deliverAppSnapshot(file: File, text = ""): boolean {
  if (typeof document === "undefined") return false;
  const editor = document.querySelector('[data-testid="composer-editor"]');
  if (!(editor instanceof HTMLElement)) return false;
  editor.focus();
  const transfer = new DataTransfer();
  transfer.items.add(file);
  editor.dispatchEvent(
    new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    }),
  );
  if (text.trim().length >= 20) {
    const textTransfer = new DataTransfer();
    textTransfer.setData("text/plain", text);
    textTransfer.setData("application/x-lime-paste-atom", "1");
    editor.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: textTransfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  return true;
}

export async function triggerAppSnapshot(): Promise<boolean> {
  const capture = await captureAppSnapshot();
  if (!capture) return false;
  return deliverAppSnapshot(capture.file, capture.text);
}

export async function startBareModifierMonitor(): Promise<unknown> {
  const permission = (await invokeNative("inputMonitoring.read")) as {
    status?: unknown;
  } | null;
  if (permission?.status !== "ready") return { started: false };
  return invokeNative("bareModifierMonitor.start", {
    requestPermission: false,
  });
}

export function playSnapshotSound(): void {
  try {
    const AudioContextCtor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const now = context.currentTime;
    const playTone = (frequency: number, start: number, duration: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.08, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.02);
    };
    playTone(880, 0, 0.06);
    playTone(1320, 0.07, 0.08);
    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, 300);
  } catch {
    // 音效不可用时静默。
  }
}

function accessibleText(node: AccessibilityTreeLike): string {
  for (const value of [node.value, node.title, node.description]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function flattenAccessibilityText(tree: unknown): string {
  const lines: string[] = [];
  let length = 0;
  const visit = (node: AccessibilityTreeLike) => {
    if (length >= MAX_ACCESSIBILITY_TEXT) return;
    if (typeof node.role === "string" && TEXT_ROLES.has(node.role)) {
      const text = accessibleText(node);
      if (text && lines[lines.length - 1] !== text) {
        lines.push(text);
        length += text.length + 1;
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child && typeof child === "object") {
          visit(child as AccessibilityTreeLike);
        }
      }
    }
  };
  if (tree && typeof tree === "object") visit(tree as AccessibilityTreeLike);
  const joined = lines.join("\n");
  return joined.length > MAX_ACCESSIBILITY_TEXT
    ? joined.slice(0, MAX_ACCESSIBILITY_TEXT)
    : joined;
}

async function readAccessibilityText(windowId: number): Promise<string> {
  try {
    const result = (await invokeNative("accessibilityTree.read", {
      windowId,
      maxDepth: 18,
      maxNodes: 3000,
    })) as { tree?: unknown } | null;
    return flattenAccessibilityText(result?.tree);
  } catch {
    return "";
  }
}
