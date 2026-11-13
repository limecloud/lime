import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compactChatHistory } from "./chatHistoryCompaction";
import type { ElectronAppServerHost } from "./appServerHost";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("compactChatHistory", () => {
  it("vacuums app-server sqlite files while the app server is stopped", async () => {
    root = await mkdtemp(path.join(tmpdir(), "lime-compact-"));
    const databaseDir = path.join(root, "app-server", "sqlite");
    await mkdir(databaseDir, { recursive: true });
    const database = path.join(databaseDir, "threads.sqlite");
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (file: string) => {
        exec: (sql: string) => void;
        close: () => void;
      };
    };
    const connection = new DatabaseSync(database);
    connection.exec("CREATE TABLE payloads (body TEXT)");
    connection.exec("INSERT INTO payloads VALUES (hex(randomblob(8192)))");
    connection.exec("DELETE FROM payloads");
    connection.close();
    const before = (await stat(database)).size;
    const appServerHost = {
      stop: vi.fn(async () => undefined),
      restartForMaintenance: vi.fn(async () => undefined),
    } as unknown as ElectronAppServerHost;

    const result = await compactChatHistory({
      appDataRoot: root,
      appServerHost,
    });

    expect(appServerHost.stop).toHaveBeenCalledTimes(1);
    expect(appServerHost.restartForMaintenance).toHaveBeenCalledTimes(1);
    expect(result.databases).toBe(1);
    expect(result.beforeBytes).toBe(before);
    expect(result.afterBytes).toBeLessThanOrEqual(result.beforeBytes);
  });
});
