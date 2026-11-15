/* global process, Buffer */
import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(import.meta.url);
const CHROME_SAFE_STORAGE_SALT = "saltysalt";
const CHROME_SAFE_STORAGE_ITERATIONS = 1003;
const CHROME_SAFE_STORAGE_KEY_LENGTH = 16;
const CHROME_COOKIE_IV = Buffer.alloc(16, " ");

export interface ChromeCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
  expiresAt: number | null;
}

function chromeCookieKey(password: string): Buffer {
  return pbkdf2Sync(
    password,
    CHROME_SAFE_STORAGE_SALT,
    CHROME_SAFE_STORAGE_ITERATIONS,
    CHROME_SAFE_STORAGE_KEY_LENGTH,
    "sha1",
  );
}

export function decryptChromeCookieValue(
  encrypted: Buffer,
  password: string,
): string | null {
  if (encrypted.length <= 3 || encrypted.subarray(0, 3).toString() !== "v10") {
    return null;
  }
  try {
    const decipher = createDecipheriv(
      "aes-128-cbc",
      chromeCookieKey(password),
      CHROME_COOKIE_IV,
    );
    const decrypted = Buffer.concat([
      decipher.update(encrypted.subarray(3)),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

/** Test helper mirroring Chrome's v10 encryption. */
export function encryptChromeCookieValue(
  value: string,
  password: string,
): Buffer {
  const cipher = createCipheriv(
    "aes-128-cbc",
    chromeCookieKey(password),
    CHROME_COOKIE_IV,
  );
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(Buffer.from(value, "utf8")),
    cipher.final(),
  ]);
}

export async function readChromeSafeStoragePassword(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-w",
      "-s",
      "Chrome Safe Storage",
      "-a",
      "Chrome",
    ]);
    const password = stdout.trim();
    return password || null;
  } catch {
    return null;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function profileDirectories(): string[] {
  return [
    "Default",
    ...Array.from({ length: 20 }, (_, i) => `Profile ${i + 1}`),
  ];
}

function sameSite(value: unknown): ChromeCookie["sameSite"] {
  if (value === 0) return "no_restriction";
  if (value === 1) return "lax";
  if (value === 2) return "strict";
  return "unspecified";
}

export async function discoverChromeCookies(
  profileRoots: readonly string[],
  password: string,
): Promise<ChromeCookie[]> {
  const cookies = new Map<string, ChromeCookie>();
  for (const root of profileRoots) {
    for (const profile of profileDirectories()) {
      const cookiePath = path.join(root, profile, "Cookies");
      if (!(await exists(cookiePath))) continue;
      let db: import("node:sqlite").DatabaseSync | null = null;
      try {
        const { DatabaseSync } = nodeRequire(
          "node:sqlite",
        ) as typeof import("node:sqlite");
        db = new DatabaseSync(cookiePath, { readOnly: true });
        const rows = db
          .prepare(
            `SELECT host_key, name, value, encrypted_value, path, is_secure,
              is_httponly, samesite,
              CAST(expires_utc / 1000 - 11644473600000 AS INTEGER) AS expires_at
             FROM cookies
             WHERE length(name) > 0`,
          )
          .all() as Array<{
          host_key?: unknown;
          name?: unknown;
          value?: unknown;
          encrypted_value?: unknown;
          path?: unknown;
          is_secure?: unknown;
          is_httponly?: unknown;
          samesite?: unknown;
          expires_at?: unknown;
        }>;
        for (const row of rows) {
          if (typeof row.host_key !== "string" || !row.host_key) continue;
          if (typeof row.name !== "string" || !row.name) continue;
          const encrypted = row.encrypted_value;
          const encryptedBytes = ArrayBuffer.isView(encrypted)
            ? Buffer.from(
                encrypted.buffer,
                encrypted.byteOffset,
                encrypted.byteLength,
              )
            : encrypted instanceof ArrayBuffer
              ? Buffer.from(encrypted)
              : null;
          const value =
            typeof row.value === "string" && row.value
              ? row.value
              : encryptedBytes
                ? decryptChromeCookieValue(encryptedBytes, password)
                : null;
          if (value === null) continue;
          const key = `${row.host_key}\u0000${row.name}\u0000${row.path ?? "/"}`;
          if (cookies.has(key)) continue;
          const expires = Number(row.expires_at);
          cookies.set(key, {
            domain: row.host_key,
            name: row.name,
            value,
            path: typeof row.path === "string" && row.path ? row.path : "/",
            secure: row.is_secure === 1,
            httpOnly: row.is_httponly === 1,
            sameSite: sameSite(row.samesite),
            expiresAt: Number.isFinite(expires) && expires > 0 ? expires : null,
          });
        }
      } catch {
        // Locked or unreadable profile; skip it.
      } finally {
        db?.close();
      }
    }
  }
  return [...cookies.values()];
}
