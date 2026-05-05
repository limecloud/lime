import { readFilePreview } from "@/lib/api/fileBrowser";
import {
  compileKnowledgePack,
  importKnowledgeSource,
  type KnowledgePackDetail,
} from "@/lib/api/knowledge";
import { normalizePackNameInput } from "../domain/knowledgeVisibility";
import {
  getKnowledgeSourceDisplayName,
  getKnowledgeSourceExtension,
  isKnowledgeTextSourceCandidate,
  normalizeKnowledgeSourceTitle,
  type KnowledgeSourceCandidate,
} from "./knowledgeSourceSupport";

export const KNOWLEDGE_TEXT_IMPORT_MAX_BYTES = 512 * 1024;

export { isKnowledgeTextSourceCandidate };
export type { KnowledgeSourceCandidate };

export interface KnowledgeImportDraft {
  packName: string;
  description: string;
  packType: string;
  sourceFileName: string;
  sourceText: string;
}

export interface KnowledgeImportResult {
  pack: KnowledgePackDetail;
  warnings: string[];
}

export function cleanKnowledgeSourceText(value: string): string {
  let text = value.replace(/^\uFEFF/, "").trim();

  // DOCX/Markdown 转换工具常在文件开头写入本机路径等注释，普通用户不应看到。
  for (let i = 0; i < 4; i += 1) {
    const next = text.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
    if (next === text) {
      break;
    }
    text = next.trim();
  }

  return text;
}

function inferPackType(title: string, sourceText: string): string {
  const haystack = `${title}\n${sourceText.slice(0, 2000)}`.toLowerCase();
  if (/个人\s*ip|personal\s*ip|人物|创始人/.test(haystack)) {
    return "personal-ip";
  }
  if (/品牌|产品|卖点|价格|客服/.test(haystack)) {
    return "brand-product";
  }
  if (/sop|faq|流程|客服|组织|团队/.test(haystack)) {
    return "organization-knowhow";
  }
  if (/增长|投放|渠道|转化|复盘/.test(haystack)) {
    return "growth-strategy";
  }
  return "custom";
}

function buildFallbackPackName(packType: string): string {
  const compactTime = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const prefix = packType === "custom" ? "project-material" : packType;
  return `${prefix}-${compactTime}`;
}

function buildSourceFileName(name: string): string {
  const extension = getKnowledgeSourceExtension(name);
  const title = normalizeKnowledgeSourceTitle(name);
  const normalized = normalizePackNameInput(title);
  const safeBase = normalized || "source";
  return `${safeBase}.${extension && extension !== "txt" ? extension : "md"}`;
}

function isBrowserMockFileManagerPath(path: string): boolean {
  return path.replace(/\\/g, "/").startsWith("/Users/mock/");
}

function buildBrowserMockFileManagerSourceText(sourceName: string): string {
  const title = normalizeKnowledgeSourceTitle(sourceName);
  return [
    `# ${title}`,
    "",
    "- 事实：这是一份从文件管理器加入的文本资料。",
    "- 适用场景：用于验证项目资料从本地文件添加、确认和生成引用的流程。",
    "- 待确认：替换成真实项目内容后再作为长期资料使用。",
  ].join("\n");
}

export function buildKnowledgeImportDraft(params: {
  sourceName: string;
  sourceText: string;
  description?: string | null;
  packType?: string | null;
}): KnowledgeImportDraft {
  const sourceText = cleanKnowledgeSourceText(params.sourceText);
  const title = normalizeKnowledgeSourceTitle(
    params.description || params.sourceName,
  );
  const packType =
    params.packType?.trim() || inferPackType(title, sourceText) || "custom";
  const packName =
    normalizePackNameInput(title) || buildFallbackPackName(packType);

  return {
    packName,
    description: title,
    packType,
    sourceFileName: buildSourceFileName(params.sourceName),
    sourceText,
  };
}

export async function readKnowledgeTextSourceFromPath(
  source: KnowledgeSourceCandidate,
): Promise<{ sourceName: string; sourceText: string }> {
  const path = source.path?.trim();
  if (!path) {
    throw new Error("缺少文件路径，不能整理为项目资料。");
  }
  if (!isKnowledgeTextSourceCandidate(source)) {
    throw new Error("这份文件暂时不能直接整理，请换成 Markdown 或文本文件。");
  }

  let preview: Awaited<ReturnType<typeof readFilePreview>>;
  try {
    preview = await readFilePreview(path, KNOWLEDGE_TEXT_IMPORT_MAX_BYTES);
  } catch (error) {
    if (isBrowserMockFileManagerPath(path)) {
      const sourceName = getKnowledgeSourceDisplayName(source);
      return {
        sourceName,
        sourceText: buildBrowserMockFileManagerSourceText(sourceName),
      };
    }
    throw error;
  }
  if (preview.error) {
    if (isBrowserMockFileManagerPath(path)) {
      const sourceName = getKnowledgeSourceDisplayName(source);
      return {
        sourceName,
        sourceText: buildBrowserMockFileManagerSourceText(sourceName),
      };
    }
    throw new Error(preview.error);
  }
  if (preview.isBinary || !preview.content?.trim()) {
    throw new Error("这份文件暂时不能直接整理，请换成 Markdown 或文本文件。");
  }

  return {
    sourceName: getKnowledgeSourceDisplayName(source),
    sourceText: preview.content,
  };
}

export async function importKnowledgeTextSource(params: {
  workingDir: string;
  sourceName: string;
  sourceText: string;
  description?: string | null;
  packType?: string | null;
}): Promise<KnowledgeImportResult> {
  const workingDir = params.workingDir.trim();
  if (!workingDir) {
    throw new Error("请先选择一个项目，再添加项目资料。");
  }

  const draft = buildKnowledgeImportDraft({
    sourceName: params.sourceName,
    sourceText: params.sourceText,
    description: params.description,
    packType: params.packType,
  });
  if (!draft.sourceText.trim()) {
    throw new Error("这份资料没有可整理的文本内容。");
  }

  const imported = await importKnowledgeSource({
    workingDir,
    packName: draft.packName,
    description: draft.description,
    packType: draft.packType,
    sourceFileName: draft.sourceFileName,
    sourceText: draft.sourceText,
  });
  const compiled = await compileKnowledgePack(
    workingDir,
    imported.pack.metadata.name,
  );

  return {
    pack: compiled.pack,
    warnings: compiled.warnings,
  };
}

export async function importKnowledgePathSource(params: {
  workingDir: string;
  source: KnowledgeSourceCandidate;
}): Promise<KnowledgeImportResult> {
  const textSource = await readKnowledgeTextSourceFromPath(params.source);
  return importKnowledgeTextSource({
    workingDir: params.workingDir,
    sourceName: textSource.sourceName,
    sourceText: textSource.sourceText,
  });
}
