import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BrowserHistoryVisit } from "../src/lib/api/browserHistoryTypes";

const nodeRequire = createRequire(import.meta.url);

const CHROME_EPOCH_OFFSET_MS = 11_644_473_600_000;
export const CHROME_HISTORY_IMPORT_LIMIT = 2_000;

export type DiscoveredChromeHistory = BrowserHistoryVisit & {
  visitedAt: number;
  profile: string;
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function chromeProfileDirectories(): string[] {
  return [
    "Default",
    ...Array.from({ length: 20 }, (_, i) => `Profile ${i + 1}`),
  ];
}

export async function discoverChromeHistory(
  profileRoots: readonly string[],
  limit = CHROME_HISTORY_IMPORT_LIMIT,
): Promise<DiscoveredChromeHistory[]> {
  const seen = new Set<string>();
  const visits: DiscoveredChromeHistory[] = [];
  for (const root of profileRoots) {
    for (const profile of chromeProfileDirectories()) {
      const historyPath = path.join(root, profile, "History");
      if (!(await exists(historyPath))) continue;
      let db: DatabaseSync | null = null;
      try {
        const { DatabaseSync } = nodeRequire(
          "node:sqlite",
        ) as typeof import("node:sqlite");
        db = new DatabaseSync(historyPath, { readOnly: true });
        const rows = db
          .prepare(
            `SELECT url, title,
              CAST(last_visit_time / 1000 - ${CHROME_EPOCH_OFFSET_MS} AS INTEGER) AS visited_at
             FROM urls
             WHERE url LIKE 'http%' AND last_visit_time > 0
             ORDER BY last_visit_time DESC
             LIMIT ?`,
          )
          .all(limit) as Array<{
          url?: unknown;
          title?: unknown;
          visited_at?: unknown;
        }>;
        for (const row of rows) {
          if (typeof row.url !== "string" || !row.url) continue;
          if (seen.has(row.url)) continue;
          const visitedAt = Number(row.visited_at);
          if (!Number.isFinite(visitedAt) || visitedAt <= 0) continue;
          seen.add(row.url);
          visits.push({
            url: row.url,
            title: typeof row.title === "string" ? row.title : "",
            visitedAt,
            isActorVisit: false,
            profile,
          });
        }
      } catch {
        // Locked or unreadable profile; skip it and continue.
      } finally {
        db?.close();
      }
    }
  }
  return visits.sort((left, right) => right.visitedAt - left.visitedAt);
}
