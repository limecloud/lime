import { access, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";
import path from "node:path";
import { isIP } from "node:net";
import type { CloudDesktopConnectionTransport } from "../src/lib/desktop-host/cloudDesktopConnection";

export const CREDENTIALS_DIRECTORY = "credentials";
const CREDENTIAL_FILE_NAME = "app-server-session.v1";
const CREDENTIAL_VERSION = 1;
const MAX_TENANT_ID_LENGTH = 256;
const MAX_ENDPOINT_LENGTH = 2_048;
const MAX_TOKEN_LENGTH = 64 * 1024;

export type CloudSessionCredential = {
  tenantId: string;
  endpoint: string;
  token: string;
  transport?: CloudDesktopConnectionTransport;
};

export type CloudSessionCredentialMetadata = {
  available: boolean;
  exists: boolean;
  tenantId?: string;
  endpoint?: string;
  updatedAt?: string;
  transport?: CloudDesktopConnectionTransport;
};

export interface SecureCredentialStore {
  setCloudSessionCredential(
    credential: CloudSessionCredential,
  ): Promise<CloudSessionCredentialMetadata>;
  readCloudSessionCredential(): Promise<CloudSessionCredential | null>;
  getCloudSessionCredentialMetadata(): Promise<CloudSessionCredentialMetadata>;
  deleteCloudSessionCredential(): Promise<{ deleted: boolean }>;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

type CredentialEnvelope = {
  version: typeof CREDENTIAL_VERSION;
  credential: CloudSessionCredential;
  updatedAt: string;
};

/** Shared encrypted persistence for session credentials and private installation recovery. */
export class ElectronEncryptedStateFile {
  readonly filePath: string;
  constructor(
    root: string,
    name: string,
    readonly safeStorage: SafeStorageLike,
    readonly platform: typeof process.platform = process.platform,
  ) {
    if (!/^[a-z][a-z0-9.-]+$/u.test(name))
      throw new Error("invalid encrypted state name");
    this.filePath = path.join(path.resolve(root), CREDENTIALS_DIRECTORY, name);
  }
  get available(): boolean {
    try {
      if (!this.safeStorage.isEncryptionAvailable()) return false;
      if (this.platform !== "linux") return true;
      return [
        "local_key",
        "gnome_libsecret",
        "kwallet",
        "kwallet5",
        "kwallet6",
      ].includes(this.safeStorage.getSelectedStorageBackend?.() ?? "");
    } catch {
      return false;
    }
  }
  assertAvailable(): void {
    if (!this.available)
      throw new Error("secure credential storage is unavailable");
  }
  async write(value: unknown): Promise<void> {
    this.assertAvailable();
    const encrypted = this.safeStorage.encryptString(JSON.stringify(value));
    if (encrypted.length > 128 * 1024)
      throw new Error("encrypted state is too large");
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await lstat(directory);
    if (
      !info.isDirectory() ||
      (this.platform !== "win32" &&
        ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    )
      throw new Error("encrypted state directory must be private");
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(encrypted);
        await file.sync();
      } finally {
        await file.close();
      }
      // Preserve the old record if replacement fails; never delete it first.
      await rename(temporary, this.filePath);
      if (this.platform !== "win32") {
        const parent = await open(directory, "r");
        try {
          await parent.sync();
        } finally {
          await parent.close();
        }
      }
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  async read(): Promise<unknown | null> {
    this.assertAvailable();
    let file;
    try {
      file = await open(
        this.filePath,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw new Error("encrypted state is invalid");
    }
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        // Atomic replacement may unlink this already-open snapshot. Multiple
        // hard links remain invalid; an unlinked descriptor is still private.
        info.nlink > 1 ||
        info.size < 1 ||
        info.size > 128 * 1024 ||
        (this.platform !== "win32" &&
          ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
      )
        throw new Error("encrypted state is invalid");
      return JSON.parse(
        this.safeStorage.decryptString(await file.readFile()),
      ) as unknown;
    } catch {
      throw new Error("encrypted state is invalid");
    } finally {
      await file.close();
    }
  }
  async delete(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}

export class ElectronSecureCredentialStore implements SecureCredentialStore {
  readonly #filePath: string;
  readonly #state: ElectronEncryptedStateFile;

  constructor(
    appDataRoot: string,
    safeStorage: SafeStorageLike,
    platform: typeof process.platform = process.platform,
  ) {
    this.#filePath = path.join(
      path.resolve(appDataRoot),
      CREDENTIALS_DIRECTORY,
      CREDENTIAL_FILE_NAME,
    );
    this.#state = new ElectronEncryptedStateFile(
      appDataRoot,
      CREDENTIAL_FILE_NAME,
      safeStorage,
      platform,
    );
  }

  async setCloudSessionCredential(
    credential: CloudSessionCredential,
  ): Promise<CloudSessionCredentialMetadata> {
    const normalized = normalizeCredential(credential);
    this.#assertEncryptionAvailable();

    const envelope: CredentialEnvelope = {
      version: CREDENTIAL_VERSION,
      credential: normalized,
      updatedAt: new Date().toISOString(),
    };
    await this.#state.write(envelope);

    return metadataFromEnvelope(envelope, true);
  }

  async readCloudSessionCredential(): Promise<CloudSessionCredential | null> {
    const envelope = await this.#readEnvelope();
    return envelope?.credential ?? null;
  }

  async getCloudSessionCredentialMetadata(): Promise<CloudSessionCredentialMetadata> {
    const exists = await fileExists(this.#filePath);
    const available = this.#isEncryptionAvailable();
    if (!exists || !available) {
      return { available, exists };
    }

    const envelope = await this.#readEnvelope();
    return envelope
      ? metadataFromEnvelope(envelope, true)
      : { available, exists: false };
  }

  async deleteCloudSessionCredential(): Promise<{ deleted: boolean }> {
    const existed = await fileExists(this.#filePath);
    await rm(this.#filePath, { force: true });
    return { deleted: existed };
  }

  async #readEnvelope(): Promise<CredentialEnvelope | null> {
    if (!(await fileExists(this.#filePath))) {
      return null;
    }
    this.#assertEncryptionAvailable();

    try {
      return parseEnvelope(await this.#state.read());
    } catch {
      throw new Error("stored Cloud session credential is invalid");
    }
  }

  #isEncryptionAvailable(): boolean {
    return this.#state.available;
  }

  #assertEncryptionAvailable(): void {
    if (!this.#isEncryptionAvailable()) {
      throw new Error("secure credential storage is unavailable");
    }
  }
}

function normalizeCredential(
  credential: CloudSessionCredential,
): CloudSessionCredential {
  const tenantId = normalizeField(
    credential.tenantId,
    "tenantId",
    MAX_TENANT_ID_LENGTH,
  );
  const endpoint = normalizeEndpoint(credential.endpoint);
  const token = normalizeField(credential.token, "token", MAX_TOKEN_LENGTH);
  const transport = credential.transport;
  if (
    transport !== undefined &&
    transport !== "direct" &&
    transport !== "ecsTunnel"
  ) {
    throw new Error("unsupported Cloud connection transport");
  }
  return { tenantId, endpoint, token, ...(transport ? { transport } : {}) };
}

function normalizeField(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} must not be empty`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${name} exceeds the maximum length`);
  }
  if (
    [...normalized].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    throw new Error(`${name} contains control characters`);
  }
  return normalized;
}

function normalizeEndpoint(value: unknown): string {
  const endpoint = normalizeField(value, "endpoint", MAX_ENDPOINT_LENGTH);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("endpoint must be a valid WebSocket URL");
  }
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("endpoint must use ws:// or wss://");
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("endpoint must not contain userinfo, query, or fragment");
  }
  if (url.protocol === "ws:" && !isLoopbackUrl(url)) {
    throw new Error("insecure ws:// endpoints must be loopback URLs");
  }
  return url.toString();
}

function isLoopbackUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    (isIP(hostname) === 4 && hostname.startsWith("127.")) ||
    (isIP(hostname) === 6 && hostname === "::1")
  );
}

function parseEnvelope(value: unknown): CredentialEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid credential envelope");
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== CREDENTIAL_VERSION ||
    typeof record.updatedAt !== "string"
  ) {
    throw new Error("invalid credential envelope");
  }
  const credential = record.credential;
  if (
    !credential ||
    typeof credential !== "object" ||
    Array.isArray(credential)
  ) {
    throw new Error("invalid credential envelope");
  }
  const normalized = normalizeCredential(credential as CloudSessionCredential);
  return {
    version: CREDENTIAL_VERSION,
    credential: normalized,
    updatedAt: record.updatedAt,
  };
}

function metadataFromEnvelope(
  envelope: CredentialEnvelope,
  available: boolean,
): CloudSessionCredentialMetadata {
  return {
    available,
    exists: true,
    tenantId: envelope.credential.tenantId,
    endpoint: envelope.credential.endpoint,
    updatedAt: envelope.updatedAt,
    ...(envelope.credential.transport
      ? { transport: envelope.credential.transport }
      : {}),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
