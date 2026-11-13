import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ElectronAppServerHost } from "./appServerHost";

export interface ChatHistoryCompactionResult {
  beforeBytes: number;
  afterBytes: number;
  databases: number;
}

async function collectSqliteFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (directory: string) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".sqlite")) {
        files.push(fullPath);
      }
    }
  };
  await walk(path.join(root, "app-server"));
  return files;
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

export async function compactChatHistory({
  appDataRoot,
  appServerHost,
}: {
  appDataRoot: string;
  appServerHost: ElectronAppServerHost;
}): Promise<ChatHistoryCompactionResult> {
  const databases = await collectSqliteFiles(appDataRoot);
  if (databases.length === 0) {
    return { beforeBytes: 0, afterBytes: 0, databases: 0 };
  }
  await appServerHost.stop();
  try {
    const before = await Promise.all(databases.map(fileSize));
    // eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (file: string) => {
        exec: (sql: string) => void;
        close: () => void;
      };
    };
    for (const database of databases) {
      const connection = new DatabaseSync(database);
      try {
        connection.exec("VACUUM");
      } finally {
        connection.close();
      }
    }
    const after = await Promise.all(databases.map(fileSize));
    return {
      beforeBytes: before.reduce((sum, size) => sum + size, 0),
      afterBytes: after.reduce((sum, size) => sum + size, 0),
      databases: databases.length,
    };
  } finally {
    await appServerHost.restartForMaintenance();
  }
}
