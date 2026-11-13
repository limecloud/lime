import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedCloudAccount } from "@/test/cloudAccountFixture";
import {
  cloudAccountIdentity,
  cloudAccountIdentityVersion,
  getCloudAccount,
} from "@/lib/cloudAccount";
import {
  skillPreviewQueryClient as client,
  skillPreviewQueryOptions,
  subscribeSkillPreviewAccount,
} from "./skillPreviewQueries";
import { skillPreviewDetail } from "./skillPreviewTestFixtures";

const mocks = vi.hoisted(() => ({ read: vi.fn(), file: vi.fn() }));
vi.mock("@/lib/api/pluginCatalog", () => ({ readPluginSkill: mocks.read }));
vi.mock("@/lib/api/fileBrowser", () => ({ readFileBytes: mocks.file }));
const account = {
  userId: "one",
  generation: "generation-one",
};
function options(detail = skillPreviewDetail()) {
  return skillPreviewQueryOptions({
    detail,
    skill: detail.skills[0],
    accountIdentity: cloudAccountIdentity(getCloudAccount()),
    accountVersion: cloudAccountIdentityVersion(),
  });
}
beforeEach(async () => {
  client.clear();
  mocks.read.mockReset();
  mocks.file.mockReset();
  await seedCloudAccount(account);
});
afterEach(() => {
  client.clear();
  vi.useRealTimers();
});

describe("plugin skill preview query lifecycle", () => {
  it.each([null, "", "Raw contents"])(
    "caches successful nullable contents for five minutes: %s",
    async (contents) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
      mocks.read.mockResolvedValueOnce({ contents });
      const query = options();
      expect(await client.fetchQuery(query)).toEqual({ contents });
      vi.setSystemTime(Date.now() + 299_999);
      expect(await client.fetchQuery(query)).toEqual({ contents });
      expect(mocks.read).toHaveBeenCalledTimes(1);
      mocks.read.mockResolvedValueOnce({ contents: "Refreshed" });
      vi.setSystemTime(Date.now() + 1);
      expect(await client.fetchQuery(query)).toEqual({ contents: "Refreshed" });
      expect(mocks.read).toHaveBeenCalledTimes(2);
    },
  );

  it("shares concurrent reads and keeps marketplace, plugin, and skill identities distinct", async () => {
    let resolve!: (value: { contents: string }) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const query = options();
    const pending = [client.fetchQuery(query), client.fetchQuery(query)];
    expect(mocks.read).toHaveBeenCalledTimes(1);
    resolve({ contents: "Shared read" });
    expect(await Promise.all(pending)).toEqual([
      { contents: "Shared read" },
      { contents: "Shared read" },
    ]);
    mocks.read.mockResolvedValue({ contents: "Distinct read" });
    for (const field of ["marketplace", "plugin", "skill"]) {
      const detail = skillPreviewDetail();
      if (field === "marketplace")
        detail.marketplaceName = "created-by-me-remote";
      if (field === "plugin") detail.summary.remotePluginId = "another~plugin";
      if (field === "skill") detail.skills[0].name = "another-skill";
      expect(await client.fetchQuery(options(detail))).toEqual({
        contents: "Distinct read",
      });
    }
    expect(mocks.read).toHaveBeenCalledTimes(4);
    client.clear();
    mocks.read.mockReset().mockRejectedValue("transport unavailable");
    await expect(
      client.fetchQuery({ ...options(), retryDelay: 0 }),
    ).rejects.toBe("transport unavailable");
    expect(mocks.read).toHaveBeenCalledTimes(4);
  });

  it("does not cache or automatically retry a non-transient HTTP failure", async () => {
    mocks.read.mockRejectedValueOnce(
      Object.assign(new Error("HTTP 404"), { status: 404 }),
    );
    const query = options();
    await expect(client.fetchQuery(query)).rejects.toThrow("HTTP 404");
    expect(client.getQueryData(query.queryKey)).toBeUndefined();
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.read.mockResolvedValueOnce({ contents: "Recovered" });
    expect(await client.fetchQuery(query)).toEqual({ contents: "Recovered" });
  });

  it("retries a transient failure and caps failures with no HTTP status at three retries", async () => {
    mocks.read.mockRejectedValueOnce(
      Object.assign(new Error("HTTP 503"), { status: 503 }),
    );
    mocks.read.mockResolvedValueOnce({ contents: "Recovered after retry" });
    expect(await client.fetchQuery({ ...options(), retryDelay: 0 })).toEqual({
      contents: "Recovered after retry",
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    client.clear();
    mocks.read.mockClear();
    mocks.read.mockRejectedValue(new Error("transport unavailable"));
    await expect(
      client.fetchQuery({ ...options(), retryDelay: 0 }),
    ).rejects.toThrow("transport unavailable");
    expect(mocks.read).toHaveBeenCalledTimes(4);
  });

  it("uses local file identity and caches the original decoded bytes without a remote fallback", async () => {
    mocks.file.mockResolvedValueOnce(
      new TextEncoder().encode("---\r\nname: local\r\n---\r\n# Local"),
    );
    const query = options(
      skillPreviewDetail("/workspace/skills/local/SKILL.md"),
    );
    expect(await client.fetchQuery(query)).toEqual({
      contents: "---\r\nname: local\r\n---\r\n# Local",
    });
    await client.fetchQuery(query);
    expect(mocks.file).toHaveBeenCalledTimes(1);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("clears active previews on identity change and rejects an A→B→A late response", async () => {
    const dispose = subscribeSkillPreviewAccount(() => undefined);
    let resolve!: (value: { contents: string }) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const query = options();
    const pending = client.fetchQuery(query).catch((error: unknown) => error);
    const signal = mocks.read.mock.calls[0][1].signal as AbortSignal;
    await seedCloudAccount({
      ...account,
      userId: "two",
      generation: "generation-two",
    });
    await seedCloudAccount(account);
    expect(signal.aborted).toBe(true);
    resolve({ contents: "Private old contents" });
    await pending;
    expect(client.getQueryData(query.queryKey)).toBeUndefined();
    mocks.read.mockResolvedValueOnce({ contents: "New lifetime" });
    expect(await client.fetchQuery(options())).toEqual({
      contents: "New lifetime",
    });
    dispose();
  });

  it("does not revive a cached response after an unobserved account switch away and back", async () => {
    mocks.read.mockResolvedValueOnce({ contents: "Old lifetime" });
    await client.fetchQuery(options());
    await seedCloudAccount({ ...account, generation: "generation-other" });
    await seedCloudAccount(account);
    mocks.read.mockResolvedValueOnce({ contents: "Fresh lifetime" });
    expect(await client.fetchQuery(options())).toEqual({
      contents: "Fresh lifetime",
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });

  it("fences late responses even when no preview is subscribed to account changes", async () => {
    let resolve!: (value: { contents: string }) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const query = options();
    const pending = client.fetchQuery(query);
    const rejected = expect(pending).rejects.toThrow("cloud account changed");
    await seedCloudAccount({
      ...account,
      userId: "two",
      generation: "generation-two",
    });
    await seedCloudAccount(account);
    resolve({ contents: "Rejected old lifetime" });
    await rejected;
    expect(client.getQueryData(query.queryKey)).toBeUndefined();
  });
});
