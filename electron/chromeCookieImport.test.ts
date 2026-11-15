import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptChromeCookieValue,
  discoverChromeCookies,
  encryptChromeCookieValue,
} from "./chromeCookieImport";

const nodeRequire = createRequire(import.meta.url);
const password = "fixture-password";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lime-chrome-cookies-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("chromeCookieImport", () => {
  it("encrypts and decrypts a v10 cookie value", () => {
    const encrypted = encryptChromeCookieValue("session-token", password);
    expect(decryptChromeCookieValue(encrypted, password)).toBe("session-token");
    expect(decryptChromeCookieValue(encrypted, "wrong")).toBeNull();
  });

  it("reads cookies from a Chrome profile", async () => {
    const dir = path.join(root, "Default");
    mkdirSync(dir, { recursive: true });
    const { DatabaseSync } = nodeRequire(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(dir, "Cookies"));
    db.exec(`CREATE TABLE cookies (
      host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
      path TEXT, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER,
      expires_utc INTEGER
    )`);
    const encrypted = encryptChromeCookieValue("secret", password);
    db.prepare("INSERT INTO cookies VALUES (?,?,?,?,?,?,?,?,?)").run(
      ".example.com",
      "sid",
      "",
      encrypted,
      "/",
      1,
      1,
      1,
      BigInt((1_700_000_000_000 + 11_644_473_600_000) * 1000),
    );
    db.close();

    const cookies = await discoverChromeCookies([root], password);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      domain: ".example.com",
      name: "sid",
      value: "secret",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      expiresAt: 1_700_000_000_000,
    });
  });
});
