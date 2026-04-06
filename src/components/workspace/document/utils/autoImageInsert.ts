import type { InsertableImage } from "@/lib/canvasImageInsertBus";

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

export interface InsertMarkdownBlockOptions {
  sectionTitle?: string | null;
  anchorText?: string | null;
}

const IMAGE_MARKDOWN_REGEX = /!\[[^\]]*\]\([^)]+\)/;
const MAX_SELECTION_ANCHOR_TEXT_LENGTH = 240;

interface MarkdownContentBlock {
  startLineIndex: number;
  endLineIndexExclusive: number;
  text: string;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeTitle(text: string): string {
  return collapseWhitespace(text).toLowerCase();
}

export function normalizeSelectionAnchorText(
  selectedText?: string | null,
): string | null {
  const collapsed = collapseWhitespace(selectedText || "");
  if (!collapsed) {
    return null;
  }
  return collapsed.slice(0, MAX_SELECTION_ANCHOR_TEXT_LENGTH).trim() || null;
}

function isSectionHeading(line: string): boolean {
  return /^##\s+/.test(line.trim());
}

function extractSectionTitle(line: string): string {
  return line.replace(/^##\s+/, "").trim();
}

export function extractLevel2Sections(
  markdown: string,
): MarkdownSectionAnchor[] {
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

function hasImageInSection(
  lines: string[],
  section: MarkdownSectionAnchor,
): boolean {
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

export function resolveSectionTitleForSelection(
  markdown: string,
  selectedText?: string | null,
): string | null {
  const sections = extractLevel2Sections(markdown);
  if (sections.length === 0) {
    return null;
  }

  const normalizedSelection = normalizeTitle(
    normalizeSelectionAnchorText(selectedText) || "",
  );
  if (!normalizedSelection) {
    return sections.length === 1 ? sections[0]?.title || null : null;
  }

  const lines = markdown.split("\n");
  const matchedSection = sections.find((section) => {
    const sectionContent = lines
      .slice(section.headingLineIndex, section.nextHeadingLineIndex)
      .join("\n");
    return normalizeTitle(sectionContent).includes(normalizedSelection);
  });

  return (
    matchedSection?.title || (sections.length === 1 ? sections[0].title : null)
  );
}

function extractContentBlocks(
  lines: string[],
  startLineIndex: number,
  endLineIndexExclusive: number,
): MarkdownContentBlock[] {
  const blocks: MarkdownContentBlock[] = [];
  let blockStart: number | null = null;
  let blockLines: string[] = [];

  for (let lineIndex = startLineIndex; lineIndex < endLineIndexExclusive; lineIndex += 1) {
    const currentLine = lines[lineIndex] || "";
    if (currentLine.trim()) {
      if (blockStart === null) {
        blockStart = lineIndex;
        blockLines = [];
      }
      blockLines.push(currentLine);
      continue;
    }

    if (blockStart !== null) {
      blocks.push({
        startLineIndex: blockStart,
        endLineIndexExclusive: lineIndex,
        text: blockLines.join(" "),
      });
      blockStart = null;
      blockLines = [];
    }
  }

  if (blockStart !== null) {
    blocks.push({
      startLineIndex: blockStart,
      endLineIndexExclusive,
      text: blockLines.join(" "),
    });
  }

  return blocks;
}

function resolveAnchorInsertLineIndex(
  lines: string[],
  anchorText: string,
  section: MarkdownSectionAnchor | null,
): number | null {
  const normalizedAnchorText = normalizeTitle(anchorText);
  if (!normalizedAnchorText) {
    return null;
  }

  const searchScopes = [
    section
      ? {
          startLineIndex: section.contentStartLineIndex,
          endLineIndexExclusive: section.nextHeadingLineIndex,
        }
      : null,
    {
      startLineIndex: 0,
      endLineIndexExclusive: lines.length,
    },
  ].filter(
    (
      scope,
    ): scope is {
      startLineIndex: number;
      endLineIndexExclusive: number;
    } => Boolean(scope),
  );

  for (const scope of searchScopes) {
    const matchedBlock = extractContentBlocks(
      lines,
      scope.startLineIndex,
      scope.endLineIndexExclusive,
    ).find((block) => normalizeTitle(block.text).includes(normalizedAnchorText));
    if (matchedBlock) {
      return matchedBlock.endLineIndexExclusive;
    }
  }

  return null;
}

export function insertMarkdownBlock(
  markdown: string,
  blockLines: string[],
  options?: InsertMarkdownBlockOptions,
): string {
  const sanitizedBlockLines = blockLines.filter(
    (line) => line.trim().length > 0,
  );
  if (sanitizedBlockLines.length === 0) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const normalizedSectionTitle = options?.sectionTitle?.trim();
  const normalizedAnchorText = normalizeSelectionAnchorText(options?.anchorText);
  const sections =
    normalizedSectionTitle || normalizedAnchorText
      ? extractLevel2Sections(markdown)
      : [];
  const targetSection = normalizedSectionTitle
    ? findBestSection(sections, normalizedSectionTitle)
    : null;

  if (normalizedAnchorText) {
    const anchorInsertLineIndex = resolveAnchorInsertLineIndex(
      lines,
      normalizedAnchorText,
      targetSection,
    );
    if (anchorInsertLineIndex !== null) {
      lines.splice(anchorInsertLineIndex, 0, ...sanitizedBlockLines, "");
      return lines.join("\n").replace(/\n{3,}/g, "\n\n");
    }
  }

  if (normalizedSectionTitle) {
    if (targetSection) {
      const insertLineIndex = resolveInsertLineIndex(lines, targetSection);
      lines.splice(insertLineIndex, 0, ...sanitizedBlockLines, "");
      return lines.join("\n").replace(/\n{3,}/g, "\n\n");
    }
  }

  const trimmed = markdown.trimEnd();
  if (!trimmed) {
    return `${sanitizedBlockLines.join("\n")}\n`;
  }
  return `${trimmed}\n\n${sanitizedBlockLines.join("\n")}\n`;
}

export function appendImageToMarkdown(
  markdown: string,
  image: InsertableImage,
  includeAttribution = true,
): string {
  if (!image.contentUrl || markdown.includes(`(${image.contentUrl})`)) {
    return markdown;
  }

  return insertMarkdownBlock(
    markdown,
    createImageMarkdown(image, includeAttribution),
  );
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
    const blockLines = createImageMarkdown(
      assignment.image,
      includeAttribution,
    );
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
