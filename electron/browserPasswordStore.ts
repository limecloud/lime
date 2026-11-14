import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isSecureAutofillUrl,
  normalizeAutofillOrigin,
  type BrowserPasswordCredential,
} from "./browserPasswordAutofillModel";
import type { SafeStorageLike } from "./secureCredentialStore";

export interface BrowserPasswordSummary {
  id: string;
  origin: string;
  username: string;
  updatedAt: number;
}

interface StoredBrowserPassword extends BrowserPasswordSummary {
  password: string;
}

interface BrowserPasswordInput {
  origin: string;
  username: string;
  password: string;
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("网站地址无效");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("仅支持保存 http/https 网站的密码");
  }
  return url.origin;
}

function isStoredRecord(value: unknown): value is StoredBrowserPassword {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.origin === "string" &&
    record.origin.length > 0 &&
    typeof record.username === "string" &&
    record.username.length > 0 &&
    typeof record.password === "string" &&
    record.password.length > 0 &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt)
  );
}

export class BrowserPasswordStore {
  readonly #filePath: string;
  readonly #encryption: SafeStorageLike | null;

  constructor(filePath: string, encryption: SafeStorageLike | null) {
    this.#filePath = filePath;
    this.#encryption = encryption;
  }

  async list(): Promise<BrowserPasswordSummary[]> {
    return (await this.#read())
      .map(({ id, origin, username, updatedAt }) => ({
        id,
        origin,
        username,
        updatedAt,
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async save(input: BrowserPasswordInput): Promise<BrowserPasswordSummary> {
    const origin = normalizeOrigin(input.origin);
    const username = input.username.trim();
    if (!username) throw new Error("用户名不能为空");
    if (!input.password) throw new Error("密码不能为空");
    const records = await this.#read();
    const existing = records.find(
      (record) => record.origin === origin && record.username === username,
    );
    const record: StoredBrowserPassword = {
      id: existing?.id ?? randomUUID(),
      origin,
      username,
      password: this.#encrypt(input.password),
      updatedAt: Date.now(),
    };
    await this.#write([
      ...records.filter((item) => item.id !== record.id),
      record,
    ]);
    const { password: _password, ...summary } = record;
    return summary;
  }

  async remove(id: string): Promise<boolean> {
    const records = await this.#read();
    const next = records.filter((record) => record.id !== id);
    if (next.length === records.length) return false;
    await this.#write(next);
    return true;
  }

  async lookupForUrl(url: string): Promise<BrowserPasswordCredential[]> {
    if (!isSecureAutofillUrl(url)) return [];
    const origin = normalizeAutofillOrigin(url);
    if (!origin) return [];
    const credentials: BrowserPasswordCredential[] = [];
    const records = (await this.#read())
      .filter((record) => record.origin === origin)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    for (const record of records) {
      try {
        credentials.push({
          username: record.username,
          password: this.#decrypt(record.password),
        });
      } catch {
        // 无法解密的记录不参与自动填充。
      }
    }
    return credentials;
  }

  async reveal(id: string): Promise<string | null> {
    const record = (await this.#read()).find((item) => item.id === id);
    if (!record) return null;
    try {
      return this.#decrypt(record.password);
    } catch {
      return null;
    }
  }

  #encrypt(plainText: string): string {
    if (!this.#encryption?.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法保存密码");
    }
    return this.#encryption.encryptString(plainText).toString("base64");
  }

  #decrypt(cipherText: string): string {
    if (!this.#encryption?.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用");
    }
    return this.#encryption.decryptString(Buffer.from(cipherText, "base64"));
  }

  async #read(): Promise<StoredBrowserPassword[]> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isStoredRecord);
    } catch {
      return [];
    }
  }

  async #write(records: StoredBrowserPassword[]): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, JSON.stringify(records, null, 2) + "\n", {
      mode: 0o600,
    });
  }
}
