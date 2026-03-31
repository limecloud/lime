import type { InsertableImage } from "@/lib/documentImageInsertBus";

export interface MarkdownSectionAnchor {
  title: string;
  headingLineIndex: number;
  contentStartLineIndex: number;
  nextHeadingLineIndex: number;
}

export interface SectionImageAssignment {
  sectionTitle: string;
  image: InsertableImage;
}

export interface ApplySectionImageAssignmentsOptions {
  includeAttribution?: boolean;
}

const IMAGE_MARKDOWN_REGEX = /!\[[^\]]*\]\([^)]+\)/;

function normalizeTitle(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function isSectionHeading(line: string): boolean {
  return /^##\s+/.test(line.trim());
}

function extractSectionTitle(line: string): string {
  return line.replace(/^##\s+/, "").trim();
}

export function extractLevel2Sections(markdown: string): MarkdownSectionAnchor[] {
  const lines = markdown.split("\n");
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => isSectionHeading(entry.line));

  return headings.map((heading, currentIndex) => {
    const nextHeadingIndex =
      currentIndex < headings.length - 1
        ? headings[currentIndex + 1].index
        : lines.length;
    return {
      title: extractSectionTitle(heading.line),
      headingLineIndex: heading.index,
      contentStartLineIndex: heading.index + 1,
      nextHeadingLineIndex: nextHeadingIndex,
    };
  });
}

function hasImageInSection(lines: string[], section: MarkdownSectionAnchor): boolean {
  for (
    let lineIndex = section.contentStartLineIndex;
    lineIndex < section.nextHeadingLineIndex;
    lineIndex += 1
  ) {
    if (IMAGE_MARKDOWN_REGEX.test(lines[lineIndex])) {
      return true;
    }
  }
  return false;
}

function resolveInsertLineIndex(
  lines: string[],
  section: MarkdownSectionAnchor,
): number {
  for (
    let lineIndex = section.contentStartLineIndex;
    lineIndex < section.nextHeadingLineIndex;
    lineIndex += 1
  ) {
    if (lines[lineIndex]?.trim()) {
      return lineIndex;
    }
  }
  return section.contentStartLineIndex;
}

function createImageMarkdown(
  image: InsertableImage,
  includeAttribution: boolean,
): string[] {
  const altText = (image.title || "插图").trim() || "插图";
  const lines = [`![${altText}](${image.contentUrl})`];

  if (includeAttribution) {
    const attributionName =
      image.attributionName || image.provider || "图片来源";
    if (image.pageUrl) {
      lines.push(`> 图片来源：[${attributionName}](${image.pageUrl})`);
    } else {
      lines.push(`> 图片来源：${attributionName}`);
    }
  }

  return lines;
}

function findBestSection(
  sections: MarkdownSectionAnchor[],
  sectionTitle: string,
): MarkdownSectionAnchor | null {
  if (!sectionTitle) {
    return sections[0] ?? null;
  }

  const normalizedTarget = normalizeTitle(sectionTitle);
  const exactMatch = sections.find(
    (section) => normalizeTitle(section.title) === normalizedTarget,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const fuzzyMatch = sections.find((section) =>
    normalizeTitle(section.title).includes(normalizedTarget),
  );
  return fuzzyMatch ?? sections[0] ?? null;
}

export function appendImageToMarkdown(
  markdown: string,
  image: InsertableImage,
  includeAttribution = true,
): string {
  if (!image.contentUrl || markdown.includes(`(${image.contentUrl})`)) {
    return markdown;
  }

  const blockLines = createImageMarkdown(image, includeAttribution);
  const trimmed = markdown.trimEnd();
  if (!trimmed) {
    return `${blockLines.join("\n")}\n`;
  }
  return `${trimmed}\n\n${blockLines.join("\n")}\n`;
}

export function applySectionImageAssignments(
  markdown: string,
  assignments: SectionImageAssignment[],
  options?: ApplySectionImageAssignmentsOptions,
): string {
  if (!assignments.length) {
    return markdown;
  }

  const includeAttribution = options?.includeAttribution ?? true;
  const lines = markdown.split("\n");
  const sections = extractLevel2Sections(markdown);

  if (sections.length === 0) {
    let nextContent = markdown;
    for (const assignment of assignments) {
      nextContent = appendImageToMarkdown(
        nextContent,
        assignment.image,
        includeAttribution,
      );
    }
    return nextContent;
  }

  const insertOperations: Array<{ lineIndex: number; lines: string[] }> = [];
  const usedSectionTitles = new Set<string>();

  for (const assignment of assignments) {
    if (!assignment.image.contentUrl) continue;
    if (markdown.includes(`(${assignment.image.contentUrl})`)) continue;

    const section = findBestSection(sections, assignment.sectionTitle);
    if (!section) continue;

    const normalizedKey = normalizeTitle(section.title);
    if (usedSectionTitles.has(normalizedKey)) continue;
    if (hasImageInSection(lines, section)) continue;

    const insertLineIndex = resolveInsertLineIndex(lines, section);
    const blockLines = createImageMarkdown(assignment.image, includeAttribution);
    insertOperations.push({
      lineIndex: insertLineIndex,
      lines: [...blockLines, ""],
    });
    usedSectionTitles.add(normalizedKey);
  }

  if (!insertOperations.length) {
    return markdown;
  }

  insertOperations
    .sort((a, b) => b.lineIndex - a.lineIndex)
    .forEach((operation) => {
      lines.splice(operation.lineIndex, 0, ...operation.lines);
    });

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function buildSectionSearchQuery(
  topic: string | undefined,
  sectionTitle: string,
): string {
  const baseTopic = (topic || "").trim();
  const baseSection = sectionTitle.trim();
  if (!baseTopic && !baseSection) {
    return "";
  }
  if (!baseTopic) {
    return `${baseSection} 高清摄影`;
  }
  if (!baseSection) {
    return `${baseTopic} 高清摄影`;
  }
  return `${baseTopic} ${baseSection} 高清摄影`;
}

