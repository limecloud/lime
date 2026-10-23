import {
  isInputLikeTarget,
  resolveHotkeyPlatform,
} from "@/lib/hotkeys/platform";
import { matchesBinding, normalizeBinding } from "./bindings";

export type CommandSection =
  | "thread"
  | "navigation"
  | "panels"
  | "workspace"
  | "skills"
  | "configure"
  | "app"
  | "general";

export interface CommandRegistration {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  section: CommandSection;
  bindings: readonly string[];
  enabled?: boolean;
  handler: () => void;
  target?: EventTarget | null;
  capture?: boolean;
  allowInInput?: boolean;
  allowInDialog?: boolean;
}

export type RegisteredCommand = Pick<
  CommandRegistration,
  "id" | "titleKey" | "descriptionKey" | "section" | "bindings"
> & { defaultBindings: readonly string[]; customized: boolean };

type Entry = CommandRegistration & { target: EventTarget };
const entries = new Set<Entry>();
const subscribers = new Set<() => void>();
let snapshot: readonly RegisteredCommand[] = [];
let bindingOverrides: Record<string, readonly string[]> = {};

function effectiveBindings(entry: Entry): readonly string[] {
  return Object.prototype.hasOwnProperty.call(bindingOverrides, entry.id)
    ? bindingOverrides[entry.id]
    : entry.bindings;
}

// 配置投影可随时丢弃；handler与默认键位仍来自同一挂载记录。
export function setCommandBindingOverrides(
  overrides: Record<string, readonly string[]>,
) {
  const next = Object.fromEntries(
    Object.entries(overrides).map(([id, bindings]) => [
      id,
      bindings.map((binding) => normalizeBinding(binding) ?? binding),
    ]),
  );
  if (JSON.stringify(bindingOverrides) === JSON.stringify(next)) return;
  bindingOverrides = next;
  publish();
}

function publish() {
  const active = new Map<string, RegisteredCommand>();
  for (const entry of entries) {
    if (entry.enabled !== false && entry.bindings.length > 0) {
      active.set(entry.id, {
        id: entry.id,
        titleKey: entry.titleKey,
        descriptionKey: entry.descriptionKey,
        section: entry.section,
        bindings: [...effectiveBindings(entry)],
        defaultBindings: [...entry.bindings],
        customized: Object.prototype.hasOwnProperty.call(
          bindingOverrides,
          entry.id,
        ),
      });
    }
  }
  snapshot = [...active.values()];
  for (const subscriber of subscribers) subscriber();
}

export function subscribeCommands(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function getRegisteredCommands(): readonly RegisteredCommand[] {
  return snapshot;
}

function acceptsEvent(entry: Entry, event: KeyboardEvent) {
  if (
    entry.enabled === false ||
    !effectiveBindings(entry).some((binding) =>
      matchesBinding(event, binding, resolveHotkeyPlatform(navigator)),
    )
  ) {
    return false;
  }
  const target = event.target;
  if (target instanceof Element) {
    if (target.closest("[data-shortcut-capture]")) return false;
    if (
      !entry.allowInDialog &&
      target.closest('[role="dialog"], [role="alertdialog"]')
    ) {
      return false;
    }
    if (
      !entry.allowInInput &&
      (isInputLikeTarget(target) ||
        target.closest('input, textarea, select, [contenteditable="true"]'))
    ) {
      return false;
    }
  }
  return true;
}

export function runCommand(id: string): boolean {
  const entry = [...entries]
    .reverse()
    .find((candidate) => candidate.id === id && candidate.enabled !== false);
  if (!entry) return false;
  entry.handler();
  return true;
}

// 处理器、键位、可用性与列表来自同一挂载记录；没有静态快捷键副本。
export function registerCommand(command: CommandRegistration): () => void {
  const target = command.target === undefined ? window : command.target;
  if (!target) return () => {};
  const entry: Entry = { ...command, target };
  const handleKeyDown = (rawEvent: Event) => {
    const event = rawEvent as KeyboardEvent;
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229)
      return;
    const winner = [...entries]
      .reverse()
      .find(
        (candidate) =>
          candidate.target === target &&
          Boolean(candidate.capture) === Boolean(entry.capture) &&
          acceptsEvent(candidate, event),
      );
    if (winner !== entry) return;
    event.preventDefault();
    entry.handler();
  };
  entries.add(entry);
  target.addEventListener("keydown", handleKeyDown, command.capture);
  publish();
  return () => {
    target.removeEventListener("keydown", handleKeyDown, command.capture);
    if (entries.delete(entry)) publish();
  };
}
