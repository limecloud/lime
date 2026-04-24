const STRUCTURED_LINE_RE =
  /^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s+|\|.*\||```|~~~)/m;

const MIN_FRAGMENTED_LINE_COUNT = 5;
const SHORT_FRAGMENT_LINE_LENGTH = 12;
const AVERAGE_FRAGMENT_LINE_LENGTH = 10;

function collapseDisplayWhitespace(value: string): string {
  return value
    .replace(/\s+([，。！？、；：,!?;:])/g, "$1")
    .replace(/([（【《“‘([<])\s+/g, "$1")
    .replace(/\s+([）】》”’)\]>])/g, "$1")
    .replace(/(?<=[，。！？、；：])\s+(?=[\u4e00-\u9fff])/gu, "")
    .replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeStructuredMarkdown(text: string): boolean {
  if (/```|~~~/.test(text)) {
    return true;
  }

  return STRUCTURED_LINE_RE.test(text);
}

function shouldCompactFragmentedLines(lines: string[]): boolean {
  if (lines.length < MIN_FRAGMENTED_LINE_COUNT) {
    return false;
  }

  const shortLineCount = lines.filter(
    (line) => line.length <= SHORT_FRAGMENT_LINE_LENGTH,
  ).length;
  const averageLineLength =
    lines.reduce((total, line) => total + line.length, 0) / lines.length;

  return (
    averageLineLength <= AVERAGE_FRAGMENT_LINE_LENGTH ||
    shortLineCount / lines.length >= 0.7
  );
}

export function normalizeProcessDisplayText(value?: string | null): string {
  const normalized = (value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized || looksLikeStructuredMarkdown(normalized)) {
    return normalized;
  }

  const nonEmptyLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!shouldCompactFragmentedLines(nonEmptyLines)) {
    return normalized;
  }

  return collapseDisplayWhitespace(nonEmptyLines.join(" "));
}
