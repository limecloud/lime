import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getExpertCatalog,
  readExpertInstructions,
} from "./expertCatalogClient";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  account: {
    account: {
      baseUrl: "https://core.test",
      applicationId: "lime",
      environment: "sandbox",
    },
  } as unknown,
}));
vi.mock("@/lib/api/productCatalog", () => ({
  listProductContent: mocks.list,
  readProductContent: mocks.read,
  productContentText: (c: {
    document: { translations: Record<string, unknown> };
  }) => c.document.translations["zh-CN"],
}));
vi.mock("@/lib/cloudAccount", () => ({ getCloudAccount: () => mocks.account }));
const content = {
  id: "a".repeat(64),
  kind: "experts",
  key: "research",
  revision: 3,
  contentHash: "b".repeat(64),
  publishedAt: "2026-11-12T00:00:00Z",
  document: {
    translations: { "zh-CN": { title: "资料整理", summary: "核对来源" } },
    category: "research",
    tags: [],
    skillRefs: ["citations"],
  },
};
describe("expert product catalog", () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.read.mockReset();
    mocks.account = {
      account: {
        baseUrl: "https://core.test",
        applicationId: "lime",
        environment: "sandbox",
      },
    };
  });
  it("maps real published content without fabricating tenant, ranking or usage data", async () => {
    mocks.list.mockResolvedValue([content]);
    const catalog = await getExpertCatalog();
    expect(mocks.list).toHaveBeenCalledWith("experts");
    expect(catalog).not.toHaveProperty("tenantId");
    expect(catalog.rankings).toEqual([]);
    expect(catalog.items[0]).toMatchObject({
      title: "资料整理",
      release: {
        releaseId: content.id,
        version: "3",
        skillRefs: ["citations"],
      },
    });
    mocks.read.mockResolvedValue({
      ...content,
      document: { ...content.document, instructions: "核实每条引用" },
    });
    await expect(readExpertInstructions(catalog.items[0]!)).resolves.toBe(
      "核实每条引用",
    );
    expect(mocks.read).toHaveBeenCalledWith("experts", "research", {
      id: content.id,
      revision: 3,
      contentHash: content.contentHash,
    });
  });
  it("preserves empty catalogs and propagates failures", async () => {
    mocks.list.mockResolvedValueOnce([]);
    expect((await getExpertCatalog()).items).toEqual([]);
    mocks.list.mockRejectedValueOnce(new Error("service unavailable"));
    await expect(getExpertCatalog()).rejects.toThrow("service unavailable");
    mocks.account = null;
    await expect(getExpertCatalog()).rejects.toThrow("account_login_required");
  });
});
