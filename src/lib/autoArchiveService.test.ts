import { describe, expect, it, vi } from "vitest";
import { archiveInactiveSessions } from "./autoArchiveService";

const now = Date.UTC(2026, 10, 13, 12);
const day = 86_400_000;

function session(id: string, updatedAt: number, archived = false) {
  return {
    id,
    updated_at: Math.floor(updatedAt / 1000),
    archived_at: archived ? Math.floor(updatedAt / 1000) : null,
  } as never;
}

describe("archiveInactiveSessions", () => {
  it("archives only inactive, unarchived sessions", async () => {
    const archive = vi.fn(async () => undefined);
    const list = vi.fn(async () => [
      session("old", now - 40 * day),
      session("recent", now - 2 * day),
      session("already", now - 40 * day, true),
    ]);
    const count = await archiveInactiveSessions({
      days: 30,
      now,
      list,
      archive,
    });
    expect(count).toBe(1);
    expect(archive).toHaveBeenCalledWith("old");
  });

  it("does nothing when auto archive is disabled", async () => {
    const archive = vi.fn(async () => undefined);
    const list = vi.fn(async () => [session("old", now - 400 * day)]);
    await expect(
      archiveInactiveSessions({ days: 0, now, list, archive }),
    ).resolves.toBe(0);
    expect(list).not.toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });
});
