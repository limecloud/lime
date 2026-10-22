export interface BrowserMenuItem {
  id?: string;
  label?: string;
  shortcut?: string;
  enabled?: boolean;
  checked?: boolean;
  submenu?: BrowserMenuItem[];
  controls?: { id: string; label: string; ariaLabel?: string; enabled?: boolean }[];
  separator?: boolean;
}

export interface BrowserMenuPresentation {
  menuId: string;
  anchor: { x: number; y: number; width: number; height: number };
  items: BrowserMenuItem[];
  appearance?: "light" | "dark";
}

export type BrowserOverlayCloseReason = "action" | "escape" | "outside" | "replaced" | "owner" | "hidden" | "navigation";
export const BROWSER_OVERLAY_ACTION_CHANNEL = "browser-overlay:action";
export const BROWSER_OVERLAY_UPDATE_CHANNEL = "browser-overlay:update";

/** Menus carry finite presentation data. No URLs, HTML or executable callbacks cross IPC. */
export function readBrowserMenuPresentation(value: unknown): BrowserMenuPresentation {
  const record = readRecord(value);
  assertKeys(record, ["menuId", "anchor", "items", "appearance"]);
  const menuId = readIdentifier(record.menuId);
  const anchor = readRecord(record.anchor);
  assertKeys(anchor, ["x", "y", "width", "height"]);
  const coordinate = (key: string) => {
    const number = anchor[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 100000) throw new Error(`Browser menu anchor ${key} is invalid`);
    return number;
  };
  if (record.appearance !== undefined && record.appearance !== "light" && record.appearance !== "dark") throw new Error("Browser menu appearance is invalid");
  const identifiers = new Set<string>();
  let total = 0;
  const identity = (value: unknown) => {
    const id = readIdentifier(value);
    if (identifiers.has(id)) throw new Error("Browser menu item identity is duplicated");
    identifiers.add(id);
    if (++total > 100) throw new Error("Browser menu has too many items");
    return id;
  };
  const label = (value: unknown) => {
    if (typeof value !== "string" || !value.trim() || value.length > 1000) throw new Error("Browser menu label is invalid");
    return value;
  };
  const readItems = (value: unknown, depth: number): BrowserMenuItem[] => {
    if (!Array.isArray(value) || !value.length || depth > 4) throw new Error("Browser menu nesting is invalid");
    return value.map(source => {
      const item = readRecord(source);
      assertKeys(item, ["id", "label", "shortcut", "enabled", "checked", "submenu", "controls", "separator"]);
      if (item.separator === true) {
        if (++total > 100) throw new Error("Browser menu has too many items");
        if (Object.keys(item).length !== 1) throw new Error("Browser menu separator cannot have actions");
        return { separator: true };
      }
      const id = identity(item.id);
      for (const key of ["enabled", "checked"] as const) {
        if (item[key] !== undefined && typeof item[key] !== "boolean") throw new Error(`Browser menu ${key} must be a boolean`);
      }
      if (item.shortcut !== undefined && (typeof item.shortcut !== "string" || item.shortcut.length > 100)) throw new Error("Browser menu shortcut is invalid");
      if (item.controls !== undefined && (!Array.isArray(item.controls) || !item.controls.length || item.controls.length > 4 || item.submenu !== undefined || item.checked !== undefined || item.shortcut !== undefined)) throw new Error("Browser menu controls are invalid");
      const controls = item.controls === undefined ? undefined : (item.controls as unknown[]).map(source => {
        const control = readRecord(source);
        assertKeys(control, ["id", "label", "ariaLabel", "enabled"]);
        if (control.enabled !== undefined && typeof control.enabled !== "boolean") throw new Error("Browser menu enabled must be a boolean");
        return { id: identity(control.id), label: label(control.label), ...(control.ariaLabel === undefined ? {} : { ariaLabel: label(control.ariaLabel) }), ...(control.enabled === undefined ? {} : { enabled: control.enabled as boolean }) };
      });
      return {
        id, label: label(item.label),
        ...(item.shortcut === undefined ? {} : { shortcut: item.shortcut as string }),
        ...(item.enabled === undefined ? {} : { enabled: item.enabled as boolean }),
        ...(item.checked === undefined ? {} : { checked: item.checked as boolean }),
        ...(item.submenu === undefined ? {} : { submenu: readItems(item.submenu, depth + 1) }),
        ...(controls === undefined ? {} : { controls }),
      };
    });
  };
  return { menuId, anchor: { x: coordinate("x"), y: coordinate("y"), width: coordinate("width"), height: coordinate("height") }, items: readItems(record.items, 1), ...(record.appearance ? { appearance: record.appearance as "light" | "dark" } : {}) };
}

export function browserMenuActionIds(items: BrowserMenuItem[]): Set<string> {
  return new Set(items.flatMap(item => item.enabled === false || item.separator ? [] : item.submenu ? [...browserMenuActionIds(item.submenu)] : item.controls ? item.controls.filter(control => control.enabled !== false).map(control => control.id) : item.id ? [item.id] : []));
}

export function browserMenuPersistentActionIds(items: BrowserMenuItem[]): Set<string> {
  return new Set(items.flatMap(item => item.enabled === false || item.separator ? [] : item.submenu ? [...browserMenuPersistentActionIds(item.submenu)] : item.controls ? item.controls.filter(control => control.enabled !== false).map(control => control.id) : []));
}

function readIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._:-]{1,100}$/u.test(value)) throw new Error("Browser menu identity is invalid");
  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Browser menu must be a record");
  return value as Record<string, unknown>;
}

function assertKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Browser menu contains unsupported presentation data");
}
