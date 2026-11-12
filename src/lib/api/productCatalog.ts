import { requestCloud } from "./cloudClient";
import { getLimeI18n } from "@/i18n/createI18n";

export interface ProductContent {
  id: string;
  kind: "skills" | "experts";
  key: string;
  revision: number;
  contentHash: string;
  publishedAt: string;
  document: {
    defaultLocale: string;
    translations: Record<string, { title: string; summary: string }>;
    category: string;
    tags: string[];
    files?: { path: string; content: string }[];
    instructions?: string;
    skillRefs?: string[];
  };
}

const keyPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const digestPattern = /^[a-f0-9]{64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validate(
  value: unknown,
  kind: ProductContent["kind"],
): ProductContent {
  if (
    !record(value) ||
    value.kind !== kind ||
    typeof value.key !== "string" ||
    !keyPattern.test(value.key) ||
    typeof value.id !== "string" ||
    !digestPattern.test(value.id) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    typeof value.contentHash !== "string" ||
    !digestPattern.test(value.contentHash) ||
    typeof value.publishedAt !== "string" ||
    !Number.isFinite(Date.parse(value.publishedAt))
  ) {
    throw new Error("product_catalog_invalid");
  }
  const d = value.document;
  if (
    !record(d) ||
    typeof d.category !== "string" ||
    !keyPattern.test(d.category) ||
    !Array.isArray(d.tags) ||
    d.tags.some((t) => typeof t !== "string") ||
    typeof d.defaultLocale !== "string" ||
    !record(d.translations) ||
    !Object.hasOwn(d.translations, d.defaultLocale)
  )
    throw new Error("product_catalog_invalid");
  for (const t of Object.values(d.translations)) {
    if (
      !record(t) ||
      typeof t.title !== "string" ||
      !t.title.trim() ||
      typeof t.summary !== "string" ||
      !t.summary.trim()
    )
      throw new Error("product_catalog_invalid");
  }
  if (
    d.skillRefs !== undefined &&
    (!Array.isArray(d.skillRefs) ||
      d.skillRefs.some((k) => typeof k !== "string" || !keyPattern.test(k)))
  ) {
    throw new Error("product_catalog_invalid");
  }
  return value as unknown as ProductContent;
}

export async function listProductContent(
  kind: ProductContent["kind"],
): Promise<ProductContent[]> {
  const result = await requestCloud<unknown>({
    path: `/catalog/${kind}`,
    method: "GET",
  });
  if (
    !record(result) ||
    !Array.isArray(result.items) ||
    result.items.length > 5000
  ) {
    throw new Error("product_catalog_invalid");
  }
  const seen = new Set<string>();
  return result.items.map((item) => {
    const value = validate(item, kind);
    if (seen.has(value.key)) throw new Error("product_catalog_invalid");
    seen.add(value.key);
    return value;
  });
}

/** Mirrors contentcatalog.Document's Go JSON field order and HTML escaping. */
function canonicalDocument(d: ProductContent["document"]): string {
  return JSON.stringify({
    defaultLocale: d.defaultLocale,
    translations: Object.fromEntries(
      Object.keys(d.translations)
        .sort()
        .map((locale) => [
          locale,
          {
            title: d.translations[locale]!.title,
            summary: d.translations[locale]!.summary,
          },
        ]),
    ),
    category: d.category,
    tags: d.tags,
    ...(d.files?.length
      ? { files: d.files.map((f) => ({ path: f.path, content: f.content })) }
      : {}),
    ...(d.instructions ? { instructions: d.instructions } : {}),
    ...(d.skillRefs?.length ? { skillRefs: d.skillRefs } : {}),
  }).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export async function readProductContent(
  kind: ProductContent["kind"],
  key: string,
  expected: Pick<ProductContent, "id" | "revision" | "contentHash">,
): Promise<ProductContent> {
  if (!keyPattern.test(key) || !digestPattern.test(expected.id))
    throw new Error("product_catalog_key_invalid");
  const value = validate(
    await requestCloud<unknown>({
      path: `/catalog/${kind}/${key}?releaseId=${expected.id}`,
      method: "GET",
    }),
    kind,
  );
  if (
    value.key !== key ||
    value.id !== expected.id ||
    value.revision !== expected.revision ||
    value.contentHash !== expected.contentHash
  )
    throw new Error("product_catalog_release_changed");
  const d = value.document;
  if (kind === "experts") {
    if (
      typeof d.instructions !== "string" ||
      !d.instructions.trim() ||
      d.files?.length
    ) {
      throw new Error("product_catalog_invalid");
    }
  } else {
    if (
      !Array.isArray(d.files) ||
      !d.files.length ||
      d.files.length > 100 ||
      d.instructions
    ) {
      throw new Error("product_catalog_invalid");
    }
    const paths = new Set<string>();
    for (const f of d.files) {
      if (
        !record(f) ||
        typeof f.path !== "string" ||
        typeof f.content !== "string" ||
        !f.path ||
        f.path.length > 240 ||
        /[\\:\0\r\n]/.test(f.path) ||
        f.path.split("/").some((p) => !p || p === "." || p === "..") ||
        paths.has(f.path)
      ) {
        throw new Error("product_catalog_invalid");
      }
      paths.add(f.path);
    }
    if (!d.files.some((f) => f.path === "SKILL.md" && f.content.trim()))
      throw new Error("product_catalog_invalid");
  }
  const bytes = new TextEncoder().encode(canonicalDocument(d));
  if (bytes.length > 1024 * 1024) throw new Error("product_catalog_invalid");
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== value.contentHash)
    throw new Error("product_catalog_digest_mismatch");
  return value;
}

export function productContentText(content: ProductContent) {
  const d = content.document;
  return (
    d.translations[getLimeI18n().language] ?? d.translations[d.defaultLocale]!
  );
}
