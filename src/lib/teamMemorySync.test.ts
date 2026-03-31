import { describe, expect, it } from "vitest";

import {
  buildTeamMemoryShadowRequestMetadata,
  buildTeamMemorySyncPlan,
  getTeamMemoryStorageKey,
  hashTeamMemoryContent,
  normalizeTeamMemoryRepoScope,
  readTeamMemorySnapshot,
  scanTeamMemorySecrets,
  writeTeamMemorySnapshot,
} from "./teamMemorySync";

function createMemoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("teamMemorySync", () => {
  it("应规范化 repo scope 并生成稳定存储 key", () => {
    const repoScope = normalizeTeamMemoryRepoScope("C:\\Work\\Repo\\");
    expect(repoScope).toBe("c:/Work/Repo");
    expect(getTeamMemoryStorageKey(repoScope)).toBe(
      "lime:team-memory:c:/Work/Repo",
    );
  });

  it("应支持读写 repo 作用域快照", () => {
    const storage = createMemoryStorage();
    writeTeamMemorySnapshot(storage, {
      repoScope: "/tmp/repo",
      entries: {
        note: {
          key: "note",
          content: "团队约定：默认走 verify:local",
          updatedAt: 1,
        },
      },
    });

    expect(readTeamMemorySnapshot(storage, "/tmp/repo")).toEqual({
      repoScope: "/tmp/repo",
      entries: {
        note: {
          key: "note",
          content: "团队约定：默认走 verify:local",
          updatedAt: 1,
        },
      },
    });
  });

  it("应把快照压成稳定的 team_memory_shadow request metadata", () => {
    const metadata = buildTeamMemoryShadowRequestMetadata({
      repoScope: "C:\\Work\\Repo\\",
      entries: {
        "team.parent_context": {
          key: "team.parent_context",
          content: " 父会话：主线推进 ",
          updatedAt: 3,
        },
        "team.selection": {
          key: "team.selection",
          content: " Team：前端联调团队 ",
          updatedAt: 1,
        },
        empty: {
          key: "empty",
          content: "   ",
          updatedAt: 2,
        },
      },
    });

    expect(metadata).toEqual({
      repo_scope: "c:/Work/Repo",
      entries: [
        {
          key: "team.selection",
          content: "Team：前端联调团队",
          updated_at: 1,
        },
        {
          key: "team.parent_context",
          content: "父会话：主线推进",
          updated_at: 3,
        },
      ],
    });
  });

  it("应识别敏感内容并在同步计划中跳过", async () => {
    expect(scanTeamMemorySecrets('api_key="secret-token-123456"')).toEqual([
      "api_key",
    ]);

    const stableChecksum = await hashTeamMemoryContent("已同步");
    const plan = await buildTeamMemorySyncPlan(
      {
        repoScope: "/tmp/repo",
        entries: {
          stable: {
            key: "stable",
            content: "已同步",
            updatedAt: 1,
          },
          changed: {
            key: "changed",
            content: "新的团队规范",
            updatedAt: 2,
          },
          secret: {
            key: "secret",
            content: 'access_token = "super-secret-token"',
            updatedAt: 3,
          },
        },
      },
      {
        stable: stableChecksum,
      },
      10_000,
    );

    expect(plan.changedKeys).toEqual(["changed"]);
    expect(plan.skippedSecretKeys).toEqual(["secret"]);
    expect(plan.entries.changed?.content).toBe("新的团队规范");
    expect(plan.payloadBytes).toBeGreaterThan(0);
  });

  it("应在超出 body 限额时延后条目", async () => {
    const plan = await buildTeamMemorySyncPlan(
      {
        repoScope: "/tmp/repo",
        entries: {
          small: {
            key: "small",
            content: "短内容",
            updatedAt: 1,
          },
          large: {
            key: "large",
            content: "x".repeat(512),
            updatedAt: 2,
          },
        },
      },
      {},
      200,
    );

    expect(plan.changedKeys).toEqual(["small"]);
    expect(plan.deferredKeys).toEqual(["large"]);
  });
});
