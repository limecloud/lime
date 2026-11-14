import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BrowserExtensionRecord {
  id: string;
  name: string;
  version: string;
  manifestVersion: number | null;
  path: string;
}

interface RawBrowserExtension {
  id: string;
  name: string;
  version: string;
  path: string;
  manifest?: { manifest_version?: number };
}

export interface BrowserExtensionsSession {
  getAllExtensions(): readonly RawBrowserExtension[];
  loadExtension(
    path: string,
    options?: { allowFileAccess?: boolean },
  ): Promise<RawBrowserExtension>;
  removeExtension(id: string): void;
}

function toRecord(extension: RawBrowserExtension): BrowserExtensionRecord {
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version,
    manifestVersion: extension.manifest?.manifest_version ?? null,
    path: extension.path,
  };
}

export function listBrowserExtensions(
  session: BrowserExtensionsSession,
): BrowserExtensionRecord[] {
  return session.getAllExtensions().map(toRecord);
}

export async function loadBrowserExtension(
  session: BrowserExtensionsSession,
  extensionPath: string,
): Promise<BrowserExtensionRecord> {
  const path = extensionPath.trim();
  if (!path) throw new Error("扩展路径不能为空");
  const extension = await session.loadExtension(path, {
    allowFileAccess: true,
  });
  return toRecord(extension);
}

export function removeBrowserExtension(
  session: BrowserExtensionsSession,
  extensionId: string,
): boolean {
  const id = extensionId.trim();
  if (!id) throw new Error("扩展 ID 不能为空");
  session.removeExtension(id);
  return true;
}

export interface PersistedBrowserExtension {
  id: string;
  path: string;
}

export class BrowserExtensionStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<PersistedBrowserExtension[]> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (entry): entry is PersistedBrowserExtension =>
          Boolean(entry) &&
          typeof entry.id === "string" &&
          entry.id.length > 0 &&
          typeof entry.path === "string" &&
          entry.path.length > 0,
      );
    } catch {
      return [];
    }
  }

  async add(record: PersistedBrowserExtension): Promise<void> {
    const records = await this.read();
    const next = records.filter(
      (entry) => entry.id !== record.id && entry.path !== record.path,
    );
    next.push(record);
    await this.#write(next);
  }

  async remove(id: string): Promise<void> {
    const records = await this.read();
    await this.#write(records.filter((entry) => entry.id !== id));
  }

  async #write(records: PersistedBrowserExtension[]): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, JSON.stringify(records, null, 2) + "\n");
  }
}

export async function restoreBrowserExtensions(
  session: BrowserExtensionsSession,
  store: BrowserExtensionStore,
): Promise<BrowserExtensionRecord[]> {
  const restored: BrowserExtensionRecord[] = [];
  for (const record of await store.read()) {
    try {
      restored.push(
        toRecord(
          await session.loadExtension(record.path, { allowFileAccess: true }),
        ),
      );
    } catch {
      // 扩展目录可能已被移动或删除，跳过损坏记录。
    }
  }
  return restored;
}
