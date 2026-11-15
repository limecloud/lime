import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverChromeHistory } from "./chromeHistoryImport";

const nodeRequire = createRequire(import.meta.url);

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lime-chrome-history-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeHistory(profile: string, rows: Array<[string, string, number]>) {
  const dir = path.join(root, profile);
  mkdirSync(dir, { recursive: true });
  const { DatabaseSync } = nodeRequire(
    "node:sqlite",
  ) as typeof import("node:sqlite");
  const db = new DatabaseSync(path.join(dir, "History"));
  db.exec("CREATE TABLE urls (url TEXT, title TEXT, last_visit_time INTEGER)");
  const insert = db.prepare(
    "INSERT INTO urls (url, title, last_visit_time) VALUES (?, ?, ?)",
  );
  for (const [url, title, visitedAtMs] of rows) {
    insert.run(url, title, BigInt((visitedAtMs + 11_644_473_600_000) * 1000));
  }
  db.close();
}

describe("chromeHistoryImport", () => {
  it("reads latest Chrome history visits per profile", async () => {
    writeHistory("Default", [
      ["https://example.com/", "Example", 1_700_000_000_000],
      ["chrome://settings", "Settings", 1_700_000_001_000],
    ]);
    const visits = await discoverChromeHistory([root]);
    expect(visits).toHaveLength(1);
    expect(visits[0]).toMatchObject({
      url: "https://example.com/",
      title: "Example",
      visitedAt: 1_700_000_000_000,
      profile: "Default",
    });
  });

  it("returns empty when no Chrome profiles exist", async () => {
    await expect(discoverChromeHistory([root])).resolves.toEqual([]);
  });
});
