import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import { TextDecoder } from "node:util";
import {
  BROWSER_SITE_PERMISSIONS,
  DEFAULT_BROWSER_SITE_SETTINGS,
  browserSitePermissionAvailable,
  parseBrowserSiteOrigin,
  parseBrowserSitePermission,
  parseBrowserSitePermissionSetting,
  parseBrowserSiteSettingsUpdate,
  type BrowserSitePermission,
  type BrowserSitePermissionSetting,
  type BrowserSiteSettingsSnapshot,
  type BrowserSiteSettingsUpdate,
} from "../src/lib/api/browserSiteSettingsTypes";
import {
  persistedAtomFileIO,
  type PersistedAtomFileIO,
} from "./persistedAtomFile";

const MAX_FILE_BYTES = 256 * 1024;
const MAX_SITES = 1000;
const UPDATE_COMMAND = "browser_site_settings_update";
const REMOVE_COMMAND = "browser_site_settings_remove";
const CLEAR_COMMAND = "browser_site_settings_clear";

type StoredSite = { origin: string } & Partial<
  Record<BrowserSitePermission, BrowserSitePermissionSetting>
>;
type Envelope = {
  schemaVersion: 4;
  revision: number;
  defaults: BrowserSiteSettingsSnapshot["defaults"];
  sites: StoredSite[];
};
type StoreOptions = {
  io?: PersistedAtomFileIO;
  platform?: typeof process.platform;
  wait?: (milliseconds: number) => Promise<void>;
  changed?: (revision: number) => void;
};

/** Owns persistent user decisions for the embedded browser's native site permissions. */
export class BrowserSiteSettingsStore {
  readonly ready: Promise<void>;
  readonly #file: string;
  readonly #io: PersistedAtomFileIO;
  readonly #platform: typeof process.platform;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #changed: (revision: number) => void;
  #state: Envelope | null = null;
  #loadError: Error | null = null;
  #tail: Promise<void> = Promise.resolve();

  constructor(appDataRoot: string, options: StoreOptions = {}) {
    if (!appDataRoot.trim() || !path.isAbsolute(appDataRoot))
      throw new Error("Browser site settings require the resolved AppDataRoot");
    this.#file = path.join(
      path.resolve(appDataRoot),
      "browser",
      "site-settings.json",
    );
    this.#io = options.io ?? persistedAtomFileIO;
    this.#platform = options.platform ?? process.platform;
    this.#wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#changed = options.changed ?? (() => undefined);
    this.ready = this.#run(async () => {
      await this.#load();
    });
    void this.ready.catch(() => undefined);
  }

  decision(
    origin: string,
    permission: BrowserSitePermission,
  ): BrowserSitePermissionSetting {
    try {
      const canonicalOrigin = parseBrowserSiteOrigin(origin);
      const key = parseBrowserSitePermission(permission);
      if (!browserSitePermissionAvailable(key)) return "block";
      if (!this.#state || this.#loadError) return "block";
      const site = this.#state.sites.find(
        (entry) => entry.origin === canonicalOrigin,
      );
      return site?.[key] ?? this.#state.defaults[key];
    } catch {
      return "block";
    }
  }

  async resolveDecision(
    origin: string,
    permission: BrowserSitePermission,
  ): Promise<BrowserSitePermissionSetting> {
    try {
      await this.ready;
      return this.decision(origin, permission);
    } catch {
      return "block";
    }
  }

  list(): Promise<BrowserSiteSettingsSnapshot> {
    return this.#run(async () => this.#snapshot(await this.#load()));
  }

  update(
    value: BrowserSiteSettingsUpdate,
  ): Promise<BrowserSiteSettingsSnapshot> {
    const update = parseBrowserSiteSettingsUpdate(value);
    if (!browserSitePermissionAvailable(update.permission))
      throw new Error("Browser site permission is unavailable in this build");
    return this.#run(async () => {
      const current = await this.#load();
      const next: Envelope = {
        ...current,
        defaults: { ...current.defaults },
        sites: current.sites.map((site) => ({ ...site })),
      };
      if (update.origin === null) {
        next.defaults[update.permission] = update.setting;
      } else {
        let site = next.sites.find((entry) => entry.origin === update.origin);
        if (!site) {
          site = { origin: update.origin };
          next.sites.push(site);
        }
        if (update.setting === null) delete site[update.permission];
        else site[update.permission] = update.setting;
      }
      next.sites.sort((left, right) => left.origin.localeCompare(right.origin));
      return this.#commit(current, next);
    });
  }

  clear(): Promise<BrowserSiteSettingsSnapshot> {
    return this.#run(async () => {
      const current = await this.#load();
      return this.#commit(current, {
        schemaVersion: 4,
        revision: current.revision,
        defaults: { ...DEFAULT_BROWSER_SITE_SETTINGS },
        sites: [],
      });
    });
  }

  remove(origin: string): Promise<BrowserSiteSettingsSnapshot> {
    const canonicalOrigin = parseBrowserSiteOrigin(origin);
    return this.#run(async () => {
      const current = await this.#load();
      return this.#commit(current, {
        ...current,
        defaults: { ...current.defaults },
        sites: current.sites.filter((site) => site.origin !== canonicalOrigin),
      });
    });
  }

  async invoke(command: string, input: unknown = {}): Promise<unknown> {
    if (command === "browser_site_settings_list") {
      exactRecord(input, []);
      return this.list();
    }
    if (command === UPDATE_COMMAND)
      return this.update(input as BrowserSiteSettingsUpdate);
    if (command === REMOVE_COMMAND) {
      const record = exactRecord(input, ["origin"]);
      return this.remove(parseBrowserSiteOrigin(record.origin));
    }
    if (command === CLEAR_COMMAND) {
      exactRecord(input, []);
      return this.clear();
    }
    throw new Error(`Unsupported Browser site settings command: ${command}`);
  }

  async count(): Promise<number> {
    return (await this.list()).sites.length;
  }

  async #commit(
    current: Envelope,
    proposed: Envelope,
  ): Promise<BrowserSiteSettingsSnapshot> {
    const comparable = (value: Envelope) =>
      JSON.stringify({ defaults: value.defaults, sites: value.sites });
    if (comparable(current) === comparable(proposed))
      return this.#snapshot(current);
    if (current.revision >= Number.MAX_SAFE_INTEGER)
      throw new Error("Browser site settings revision capacity exceeded");
    const next: Envelope = { ...proposed, revision: current.revision + 1 };
    assertEnvelope(next);
    await this.#save(next);
    this.#state = next;
    this.#changed(next.revision);
    return this.#snapshot(next);
  }

  #snapshot(state: Envelope): BrowserSiteSettingsSnapshot {
    return {
      revision: state.revision,
      defaults: { ...state.defaults },
      sites: state.sites.map((site) => ({
        origin: site.origin,
        camera: site.camera ?? null,
        microphone: site.microphone ?? null,
        geolocation: site.geolocation ?? null,
        notifications: site.notifications ?? null,
        clipboard: site.clipboard ?? null,
        sound: site.sound ?? null,
        protectedContent: site.protectedContent ?? null,
        automaticDownloads: site.automaticDownloads ?? null,
      })),
    };
  }

  #run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation);
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async #load(): Promise<Envelope> {
    if (this.#loadError) throw this.#loadError;
    if (this.#state) return this.#state;
    let bytes: Buffer;
    try {
      bytes = await this.#io.readFile(this.#file, MAX_FILE_BYTES);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return (this.#state = emptyEnvelope());
      this.#loadError = new Error("Browser site settings could not be read");
      throw this.#loadError;
    }
    try {
      if (bytes.byteLength > MAX_FILE_BYTES)
        throw new Error("Browser site settings exceed their storage budget");
      const parsed = upgradeEnvelope(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      );
      assertEnvelope(parsed);
      if (parsed.sites.length > MAX_SITES)
        throw new Error("Browser site settings capacity exceeded");
      return (this.#state = parsed);
    } catch {
      this.#loadError = new Error(
        "Browser site settings file is corrupt or exceeds its storage budget",
      );
      throw this.#loadError;
    }
  }

  async #save(state: Envelope): Promise<void> {
    const data = JSON.stringify(state);
    if (Buffer.byteLength(data, "utf8") > MAX_FILE_BYTES)
      throw new Error("Browser site settings storage budget exceeded");
    if (state.sites.length > MAX_SITES)
      throw new Error("Browser site settings capacity exceeded");
    const temporary = `${this.#file}.${process.pid}.${randomUUID()}.tmp`;
    let renamed = false;
    try {
      await this.#io.mkdir(path.dirname(this.#file));
      await this.#io.writeFile(temporary, data);
      for (let attempt = 0; ; attempt += 1) {
        try {
          await this.#io.rename(temporary, this.#file);
          break;
        } catch (error) {
          if (
            this.#platform !== "win32" ||
            !["EPERM", "EACCES", "EBUSY"].includes(errorCode(error) ?? "") ||
            attempt >= 3
          )
            throw error;
          await this.#wait(50 * 2 ** attempt);
        }
      }
      renamed = true;
    } catch {
      throw new Error("Browser site settings could not be saved");
    } finally {
      if (!renamed)
        await this.#io.removeTemporary(temporary).catch(() => undefined);
    }
  }
}

function emptyEnvelope(): Envelope {
  return {
    schemaVersion: 4,
    revision: 0,
    defaults: { ...DEFAULT_BROWSER_SITE_SETTINGS },
    sites: [],
  };
}

function assertEnvelope(value: unknown): asserts value is Envelope {
  const record = exactRecord(value, [
    "schemaVersion",
    "revision",
    "defaults",
    "sites",
  ]);
  if (
    record.schemaVersion !== 4 ||
    typeof record.revision !== "number" ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    !Array.isArray(record.sites) ||
    record.sites.length > MAX_SITES
  )
    throw new Error("Invalid Browser site settings envelope");
  const defaults = exactRecord(record.defaults, BROWSER_SITE_PERMISSIONS);
  for (const permission of BROWSER_SITE_PERMISSIONS)
    parseBrowserSitePermissionSetting(defaults[permission], permission);
  const origins = new Set<string>();
  for (const value of record.sites) {
    const site = optionalRecord(
      value,
      ["origin", ...BROWSER_SITE_PERMISSIONS],
      ["origin"],
    );
    const origin = parseBrowserSiteOrigin(site.origin);
    if (origins.has(origin))
      throw new Error("Duplicate Browser site settings origin");
    origins.add(origin);
    for (const permission of BROWSER_SITE_PERMISSIONS) {
      const setting = site[permission];
      if (setting !== undefined)
        parseBrowserSitePermissionSetting(setting, permission);
    }
  }
}

function upgradeEnvelope(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    ![1, 2, 3].includes(value.schemaVersion as number)
  )
    return value;
  const record = exactRecord(value, [
    "schemaVersion",
    "revision",
    "defaults",
    "sites",
  ]);
  const permissions: readonly BrowserSitePermission[] =
    record.schemaVersion === 1
      ? ["camera", "microphone"]
      : record.schemaVersion === 2
        ? ["camera", "microphone", "geolocation", "notifications"]
        : [
            "camera",
            "microphone",
            "geolocation",
            "notifications",
            "clipboard",
            "sound",
          ];
  const defaults = exactRecord(record.defaults, permissions);
  for (const permission of permissions)
    parseBrowserSitePermissionSetting(defaults[permission], permission);
  if (!Array.isArray(record.sites))
    throw new Error("Invalid Browser site settings sites");
  for (const site of record.sites) {
    const entry = optionalRecord(site, ["origin", ...permissions], ["origin"]);
    for (const permission of permissions) {
      const setting = entry[permission];
      if (setting === undefined) continue;
      if (record.schemaVersion === 1 && setting === "ask")
        throw new Error("Invalid Browser site settings rule");
      parseBrowserSitePermissionSetting(setting, permission);
    }
  }
  return {
    ...record,
    schemaVersion: 4,
    defaults: { ...DEFAULT_BROWSER_SITE_SETTINGS, ...defaults },
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Invalid Browser site settings value");
  return value as Record<string, unknown>;
}

function optionalRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key)) ||
    requiredKeys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Invalid Browser site settings value");
  return value as Record<string, unknown>;
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}
