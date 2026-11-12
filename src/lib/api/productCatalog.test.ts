import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listProductContent,
  readProductContent,
  type ProductContent,
} from "./productCatalog";

const request = vi.hoisted(() => vi.fn());
vi.mock("./cloudClient", () => ({ requestCloud: request }));

// Generated with encoding/json and crypto/sha256 using contentcatalog.Document's field order.
const release: ProductContent = {
  kind: "experts",
  key: "research",
  id: "a".repeat(64),
  revision: 3,
  publishedAt: "2026-11-12T00:00:00Z",
  contentHash:
    "bd8f815bce6ebb61b0b605e10c25002d1c4967a04ab86f1b4e23b243a4d0f811",
  document: {
    defaultLocale: "zh-CN",
    translations: {
      "zh-CN": { title: "资料整理", summary: "核对来源" },
      "en-US": { title: "Research", summary: "Check sources" },
    },
    category: "research",
    tags: ["research"],
    instructions: "引用 <来源> & 保留\u2028分行",
    skillRefs: ["research-skill"],
  },
};

describe("product published content", () => {
  beforeEach(() => {
    request.mockReset();
    vi.stubGlobal("crypto", webcrypto);
  });

  it("reads the selected release and verifies the real Go JSON digest", async () => {
    request.mockResolvedValue(structuredClone(release));
    const result = await readProductContent("experts", "research", release);
    expect(result.document.instructions).toContain("<来源>");
    expect(request).toHaveBeenCalledWith({
      method: "GET",
      path: `/catalog/experts/research?releaseId=${release.id}`,
    });
  });

  it("rejects substituted releases and modified bodies", async () => {
    request.mockResolvedValueOnce({ ...release, id: "b".repeat(64) });
    await expect(
      readProductContent("experts", "research", release),
    ).rejects.toThrow("release_changed");
    const changed = structuredClone(release);
    changed.document.instructions += " altered";
    request.mockResolvedValueOnce(changed);
    await expect(
      readProductContent("experts", "research", release),
    ).rejects.toThrow("digest_mismatch");
  });

  it("accepts an empty directory, rejects duplicates and malformed content", async () => {
    request.mockResolvedValueOnce({ items: [] });
    await expect(listProductContent("experts")).resolves.toEqual([]);
    request.mockResolvedValueOnce({ items: [release, release] });
    await expect(listProductContent("experts")).rejects.toThrow(
      "catalog_invalid",
    );
    request.mockResolvedValueOnce({
      items: [{ ...release, key: "../escape" }],
    });
    await expect(listProductContent("experts")).rejects.toThrow(
      "catalog_invalid",
    );
    request.mockResolvedValueOnce({
      ...release,
      document: { ...release.document, instructions: null },
    });
    await expect(
      readProductContent("experts", "research", release),
    ).rejects.toThrow("catalog_invalid");
  });
});
