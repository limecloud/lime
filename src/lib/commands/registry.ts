import {
  isInputLikeTarget,
  resolveHotkeyPlatform,
} from "@/lib/hotkeys/platform";
import {
  bindingIdentity,
  bindingMatchesPrefix,
  captureBinding,
  KEY_SEQUENCE_TIMEOUT_MS,
  normalizeBinding,
} from "./bindings";
import { compareKeyboardShortcutCommands } from "./keyboard-shortcut-command-order";

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
  allowRepeat?: boolean;
}

export type RegisteredCommand = Pick<
  CommandRegistration,
  "id" | "titleKey" | "descriptionKey" | "section" | "bindings"
> & { defaultBindings: readonly string[]; customized: boolean };

type Entry = CommandRegistration & { target: EventTarget };
const entries = new Set<Entry>();
type KeyScope = {
  target: EventTarget;
  capture: boolean;
  prefix: string | null;
  pendingTarget: EventTarget | null;
  timer: ReturnType<typeof setTimeout> | null;
  handleKeyDown: (event: Event) => void;
  reset: () => void;
};
const keyScopes = new Set<KeyScope>();
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
  for (const scope of keyScopes) scope.reset();
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
  snapshot = [...active.values()].sort(compareKeyboardShortcutCommands);
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
  if (entry.enabled === false) return false;
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

function keyScope(target: EventTarget, capture: boolean): KeyScope {
  const existing = [...keyScopes].find(
    (scope) => scope.target === target && scope.capture === capture,
  );
  if (existing) return existing;
  const scope: KeyScope = {
    target,
    capture,
    prefix: null,
    pendingTarget: null,
    timer: null,
    reset: () => {
      if (scope.timer !== null) clearTimeout(scope.timer);
      scope.timer = null;
      scope.prefix = null;
      scope.pendingTarget = null;
    },
    handleKeyDown: (rawEvent) => {
      const event = rawEvent as KeyboardEvent;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229
      ) {
        scope.reset();
        return;
      }
      const stroke = captureBinding(event);
      if (!stroke) {
        if (
          !["Control", "Meta", "Alt", "AltGraph", "Shift", "Fn"].includes(
            event.key,
          )
        )
          scope.reset();
        return;
      }
      if (scope.prefix && scope.pendingTarget !== event.target) scope.reset();
      if (event.repeat && scope.prefix) {
        event.preventDefault();
        return;
      }
      const candidates = [...entries]
        .reverse()
        .filter(
          (entry) =>
            entry.target === target &&
            Boolean(entry.capture) === capture &&
            (!event.repeat || entry.allowRepeat === true) &&
            acceptsEvent(entry, event),
        );
      const platform = resolveHotkeyPlatform(navigator);
      const dispatch = (sequence: string) => {
        const identity = bindingIdentity(sequence, platform);
        const winner = candidates.find((entry) =>
          effectiveBindings(entry).some(
            (binding) => bindingIdentity(binding, platform) === identity,
          ),
        );
        if (winner) {
          scope.reset();
          event.preventDefault();
          winner.handler();
          return true;
        }
        if (
          candidates.some((entry) =>
            effectiveBindings(entry).some((binding) =>
              bindingMatchesPrefix(binding, sequence, platform),
            ),
          )
        ) {
          scope.prefix = sequence;
          scope.pendingTarget = event.target;
          scope.timer = setTimeout(scope.reset, KEY_SEQUENCE_TIMEOUT_MS);
          event.preventDefault();
          return true;
        }
        return false;
      };
      const prefix = scope.prefix;
      scope.reset();
      if (prefix && dispatch(`${prefix} ${stroke}`)) return;
      dispatch(stroke);
    },
  };
  keyScopes.add(scope);
  target.addEventListener("keydown", scope.handleKeyDown, capture);
  target.addEventListener("blur", scope.reset);
  target.addEventListener("focusout", scope.reset);
  return scope;
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
  entries.add(entry);
  const scope = keyScope(target, Boolean(command.capture));
  scope.reset();
  publish();
  return () => {
    if (!entries.delete(entry)) return;
    scope.reset();
    if (
      ![...entries].some(
        (entry) =>
          entry.target === target && Boolean(entry.capture) === scope.capture,
      )
    ) {
      target.removeEventListener("keydown", scope.handleKeyDown, scope.capture);
      target.removeEventListener("blur", scope.reset);
      target.removeEventListener("focusout", scope.reset);
      keyScopes.delete(scope);
    }
    publish();
  };
}
