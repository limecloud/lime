import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { Buffer } from "node:buffer";
import {
  CREDENTIALS_DIRECTORY,
  type SafeStorageLike,
} from "./secureCredentialStore";

const header = Buffer.from("LIME-LOCAL-1\0");
const keyBytes = 32;
const nonceBytes = 12;
const tagBytes = 16;
const maxBytes = 128 * 1024;

/** Main-only encryption. Account file permissions protect the local key; no OS vault is accessed. */
export class LocalCredentialEncryption implements SafeStorageLike {
  readonly #directory: string;
  readonly #keyPath: string;

  constructor(root: string) {
    this.#directory = path.join(path.resolve(root), CREDENTIALS_DIRECTORY);
    this.#keyPath = path.join(this.#directory, "encryption-key.v1");
  }

  getSelectedStorageBackend(): string {
    return "local_key";
  }

  isEncryptionAvailable(): boolean {
    try {
      this.#ensureDirectory();
      if (this.#hasKey()) this.#readKey().fill(0);
      return true;
    } catch {
      return false;
    }
  }

  encryptString(plainText: string): Buffer {
    if (Buffer.byteLength(plainText, "utf8") > maxBytes)
      throw new Error("encrypted state is too large");
    this.#ensureDirectory();
    if (!this.#hasKey()) this.#createKey();
    const key = this.#readKey();
    try {
      const nonce = randomBytes(nonceBytes);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(header);
      const encrypted = Buffer.concat([
        cipher.update(plainText, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([header, nonce, cipher.getAuthTag(), encrypted]);
    } finally {
      key.fill(0);
    }
  }

  decryptString(encrypted: Buffer): string {
    if (
      encrypted.length < header.length + nonceBytes + tagBytes ||
      encrypted.length > maxBytes + header.length + nonceBytes + tagBytes ||
      !encrypted.subarray(0, header.length).equals(header)
    )
      throw new Error("encrypted state requires reconnection");
    this.#ensureDirectory();
    // Never create or replace a missing key while reading existing state.
    const key = this.#readKey();
    try {
      const tagOffset = header.length + nonceBytes;
      const contentOffset = tagOffset + tagBytes;
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        encrypted.subarray(header.length, tagOffset),
      );
      decipher.setAAD(header);
      decipher.setAuthTag(encrypted.subarray(tagOffset, contentOffset));
      return Buffer.concat([
        decipher.update(encrypted.subarray(contentOffset)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("encrypted state is invalid");
    } finally {
      key.fill(0);
    }
  }

  #ensureDirectory(): void {
    mkdirSync(this.#directory, { recursive: true, mode: 0o700 });
    const info = lstatSync(this.#directory);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      throw new Error("credential key directory must be private");
  }

  #hasKey(): boolean {
    try {
      lstatSync(this.#keyPath);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return false;
      throw new Error("credential key is invalid");
    }
  }

  #readKey(): Buffer {
    const file = openSync(
      this.#keyPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const key = Buffer.alloc(keyBytes);
    try {
      const info = fstatSync(file);
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.uid !== process.getuid?.() ||
        (info.mode & 0o077) !== 0 ||
        info.size !== keyBytes ||
        readSync(file, key, 0, key.length, 0) !== keyBytes
      )
        throw new Error("credential key is invalid");
      return key;
    } catch {
      key.fill(0);
      throw new Error("credential key is invalid");
    } finally {
      closeSync(file);
    }
  }

  #createKey(): void {
    const temporary = path.join(this.#directory, `${randomUUID()}.tmp`);
    const key = randomBytes(keyBytes);
    try {
      const file = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(file, key);
        fsyncSync(file);
      } finally {
        closeSync(file);
      }
      try {
        linkSync(temporary, this.#keyPath);
      } catch (error) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
      }
    } finally {
      key.fill(0);
      unlinkSync(temporary);
    }
    const directory = openSync(this.#directory, "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
}

export function createCredentialEncryption(
  root: string,
  platform: typeof process.platform,
  windowsEncryption: SafeStorageLike,
): SafeStorageLike {
  return platform === "win32"
    ? windowsEncryption
    : new LocalCredentialEncryption(root);
}
