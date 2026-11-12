import { webcrypto, createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountFixture,
  cloudRequestMock,
  seedCloudAccount,
} from "@/test/cloudAccountFixture";
import {
  getOfficialSkillMarketplaceBundle,
  installOfficialMarketplaceSkill,
  listOfficialSkillMarketplace,
} from "./officialSkillMarketplace";
import type { ProductContent } from "./productCatalog";

const install = vi.hoisted(() => vi.fn());
vi.mock("./skills", () => ({
  skillsApi: { installMarketplaceBundle: install },
}));

const document = {
  defaultLocale: "en-US",
  translations: { "en-US": { title: "Research", summary: "Check sources" } },
  category: "research",
  tags: ["sources"],
  files: [
    {
      path: "SKILL.md",
      content:
        "---\\nname: research\\ndescription: Check sources\\n---\\nRead sources.",
    },
  ],
};
const release: ProductContent = {
  kind: "skills",
  key: "research",
  id: "a".repeat(64),
  revision: 3,
  publishedAt: "2026-11-12T00:00:00Z",
  contentHash: createHash("sha256")
    .update(JSON.stringify(document))
    .digest("hex"),
  document,
};
function reply(body: unknown) {
  return { status: 200, body, account: accountFixture.account };
}

describe("product skill catalog", () => {
  beforeEach(async () => {
    vi.stubGlobal("crypto", webcrypto);
    install
      .mockReset()
      .mockResolvedValue({ directory: "research", inspection: {} });
    await seedCloudAccount();
  });

  it("reads the formal product directory, preserving the selected release", async () => {
    cloudRequestMock.mockResolvedValueOnce(reply({ items: [release] }));
    const items = await listOfficialSkillMarketplace({
      query: "sources",
      category: "research",
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "research",
      title: "Research",
      release: {
        id: release.id,
        revision: 3,
        contentHash: release.contentHash,
      },
    });
    expect(cloudRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/catalog/skills", method: "GET" }),
      expect.anything(),
    );
  });

  it("installs the exact verified content with file hashes through the native installer", async () => {
    cloudRequestMock.mockResolvedValueOnce(reply(release));
    await installOfficialMarketplaceSkill("research", "lime", release);
    expect(cloudRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/catalog/skills/research?releaseId=" + release.id,
        method: "GET",
      }),
      expect.anything(),
    );
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({
        manifestVersion: "agentskills.v1",
        version: "3",
        fileCount: 1,
        files: [
          {
            ...document.files[0],
            encoding: "utf-8",
            sha256: createHash("sha256")
              .update(document.files[0]!.content)
              .digest("hex"),
          },
        ],
      }),
      "lime",
    );
  });

  it("rejects replaced releases and modified content before native installation", async () => {
    cloudRequestMock.mockResolvedValueOnce(
      reply({ ...release, id: "b".repeat(64) }),
    );
    await expect(
      installOfficialMarketplaceSkill("research", "lime", release),
    ).rejects.toThrow("release_changed");
    cloudRequestMock.mockResolvedValueOnce(
      reply({
        ...release,
        document: {
          ...document,
          files: [{ path: "SKILL.md", content: "altered" }],
        },
      }),
    );
    await expect(
      installOfficialMarketplaceSkill("research", "lime", release),
    ).rejects.toThrow("digest_mismatch");
    expect(install).not.toHaveBeenCalled();
  });

  it("an empty directory stays empty and failures do not use a website fallback", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      cloudRequestMock.mockResolvedValueOnce(reply({ items: [] }));
      await expect(listOfficialSkillMarketplace()).resolves.toEqual([]);
      cloudRequestMock.mockResolvedValueOnce({
        ...reply({ error: "catalog_unavailable" }),
        status: 503,
      });
      await expect(listOfficialSkillMarketplace()).rejects.toThrow(
        "catalog_unavailable",
      );
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it("name-only entry resolves a formal release and rejects an unknown name", async () => {
    cloudRequestMock
      .mockResolvedValueOnce(reply({ items: [release] }))
      .mockResolvedValueOnce(reply(release));
    expect((await getOfficialSkillMarketplaceBundle("research")).version).toBe(
      "3",
    );
    cloudRequestMock.mockResolvedValueOnce(reply({ items: [] }));
    await expect(getOfficialSkillMarketplaceBundle("missing")).rejects.toThrow(
      "release_not_found",
    );
  });
});
