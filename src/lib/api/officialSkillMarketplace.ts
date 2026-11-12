import { skillsApi, type AppType, type SkillInspection } from "./skills";
import {
  listProductContent,
  readProductContent,
  productContentText,
  type ProductContent,
} from "./productCatalog";
import {
  getCloudAccount,
  cloudAccountIdentityVersion,
  CloudAccountChangedError,
} from "@/lib/cloudAccount";

export interface SkillMarketplaceVisualAsset {
  kind?: string;
  url?: string;
  svg?: string;
  prompt?: string;
  generatedAt?: string;
}

export interface SkillMarketplaceBundleResourceSummary {
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}

export interface SkillMarketplaceBundleStandardCompliance {
  isStandard: boolean;
  validationErrors?: string[];
  deprecatedFields?: string[];
}

export interface SkillMarketplaceBundleSummary {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  resourceSummary: SkillMarketplaceBundleResourceSummary;
  standardCompliance: SkillMarketplaceBundleStandardCompliance;
}

export interface SkillMarketplaceItem {
  id: string;
  name: string;
  aliases: string[];
  title: string;
  summary: string;
  category: string;
  outputHint: string;
  version: string;
  sort: number;
  icon?: SkillMarketplaceVisualAsset;
  cover?: SkillMarketplaceVisualAsset;
  contentHash?: string;
  bundle?: SkillMarketplaceBundleSummary;
  updatedAt?: string;
  release?: Pick<ProductContent, "id" | "revision" | "contentHash">;
}

export interface SkillMarketplaceFile {
  path: string;
  content: string;
  encoding?: string;
  sha256?: string;
}

export interface SkillMarketplaceBundle {
  manifestVersion: string;
  name: string;
  aliases: string[];
  version: string;
  contentHash: string;
  fileCount: number;
  files: SkillMarketplaceFile[];
}

export interface SkillMarketplaceInstallResult {
  directory: string;
  inspection: SkillInspection;
}

export interface ListSkillMarketplaceParams {
  query?: string;
  category?: string;
  sort?: string;
}

/** Product curation is distinct from the shared Cloud marketplace. */
export async function listOfficialSkillMarketplace(
  params: ListSkillMarketplaceParams = {},
): Promise<SkillMarketplaceItem[]> {
  const items = await listProductContent("skills");
  const query = params.query?.trim().toLocaleLowerCase();
  return items
    .map((content, index): SkillMarketplaceItem => {
      const text = productContentText(content);
      return {
        id: content.id,
        name: content.key,
        aliases: content.document.tags,
        title: text.title,
        summary: text.summary,
        category: content.document.category,
        outputHint: "",
        version: String(content.revision),
        contentHash: content.contentHash,
        updatedAt: content.publishedAt,
        sort: index,
        release: {
          id: content.id,
          revision: content.revision,
          contentHash: content.contentHash,
        },
      };
    })
    .filter(
      (item) =>
        (!params.category || params.category === item.category) &&
        (!query ||
          [item.name, item.title, item.summary, ...item.aliases].some((value) =>
            value.toLocaleLowerCase().includes(query),
          )),
    );
}

export async function getOfficialSkillMarketplaceBundle(
  skillName: string,
  expected?: SkillMarketplaceItem["release"],
): Promise<SkillMarketplaceBundle> {
  const release =
    expected ??
    (await listProductContent("skills")).find(
      (content) => content.key === skillName,
    );
  if (!release) throw new Error("product_catalog_release_not_found");
  const content = await readProductContent("skills", skillName, release);
  const files = await Promise.all(
    content.document.files!.map(async (file) => ({
      ...file,
      encoding: "utf-8",
      sha256: Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(file.content),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join(""),
    })),
  );
  return {
    manifestVersion: "agentskills.v1",
    name: content.key,
    aliases: content.document.tags,
    version: String(content.revision),
    contentHash: content.contentHash,
    fileCount: files.length,
    files,
  };
}

export async function installOfficialMarketplaceSkill(
  skillName: string,
  app: AppType = "lime",
  expected?: SkillMarketplaceItem["release"],
): Promise<SkillMarketplaceInstallResult> {
  const generation = cloudAccountIdentityVersion();
  const bundle = await getOfficialSkillMarketplaceBundle(skillName, expected);
  if (!getCloudAccount() || generation !== cloudAccountIdentityVersion())
    throw new CloudAccountChangedError();
  return skillsApi.installMarketplaceBundle(bundle, app);
}
