import {
  listProductContent,
  productContentText,
  readProductContent,
} from "@/lib/api/productCatalog";
import { getCloudAccount } from "@/lib/cloudAccount";
import type { ExpertCatalog, ExpertProfile } from "./types";

/** Product catalogs contain published content, never platform tenant or user state. */
export async function getExpertCatalog(): Promise<ExpertCatalog> {
  const account = getCloudAccount()?.account;
  if (!account) throw new Error("account_login_required");
  const contents = await listProductContent("experts");
  return {
    catalogId: JSON.stringify([
      account.baseUrl,
      account.applicationId,
      account.environment,
    ]),
    version: JSON.stringify(contents.map((c) => c.id).sort()),
    syncedAt: new Date().toISOString(),
    items: contents.map((c) => {
      const text = productContentText(c);
      return {
        id: c.key,
        slug: c.key,
        title: text.title,
        summary: text.summary,
        avatar: { kind: "emoji", value: "👤" },
        category: c.document.category,
        tags: c.document.tags,
        source: "cloud_catalog",
        stats: { usageCount: 0, likeCount: 0 },
        release: {
          releaseId: c.id,
          version: String(c.revision),
          personaRef: c.key,
          personaHash: c.contentHash,
          releasedAt: c.publishedAt,
          skillRefs: c.document.skillRefs ?? [],
          workflowRefs: [],
        },
        promptStarters: [],
        showcase: [],
      };
    }),
    categories: [...new Set(contents.map((c) => c.document.category))].map(
      (key, sort) => ({ key, title: key, sort }),
    ),
    rankings: [],
  };
}

export async function readExpertInstructions(
  expert: ExpertProfile,
): Promise<string | null> {
  if (expert.source !== "cloud_catalog") return null;
  const content = await readProductContent("experts", expert.slug, {
    id: expert.release.releaseId,
    revision: Number(expert.release.version),
    contentHash: expert.release.personaHash ?? "",
  });
  return content.document.instructions!;
}
