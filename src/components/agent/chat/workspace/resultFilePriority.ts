function normalizePath(value?: string | null): string {
  return (value || "").trim().replace(/\\/g, "/");
}

function extractFileName(path: string): string {
  const segments = normalizePath(path).split("/").filter(Boolean);
  return (segments.at(-1) || "").toLowerCase();
}

function isMarkdownLikePath(path: string): boolean {
  return /\.(md|markdown|mdx|txt|rst|adoc)$/i.test(path);
}

export function isAgentInstructionFilePath(path?: string | null): boolean {
  return extractFileName(path || "") === "agents.md";
}

export function scorePreferredResultFilePath(
  path?: string | null,
): number {
  const normalizedPath = normalizePath(path);
  if (!normalizedPath || !isMarkdownLikePath(normalizedPath)) {
    return Number.NEGATIVE_INFINITY;
  }

  const fileName = extractFileName(normalizedPath);
  const insideExports = normalizedPath.startsWith("exports/");

  let score = 0;

  if (fileName === "index.md" || fileName === "index.markdown") {
    score += 900;
  } else if (
    /^(draft|final|main|article|content|post|script|outline|report|summary)\.(md|markdown|mdx)$/i.test(
      fileName,
    )
  ) {
    score += 520;
  } else if (fileName === "readme.md") {
    score += 260;
  } else if (isAgentInstructionFilePath(normalizedPath)) {
    score -= 280;
  } else {
    score += 360;
  }

  if (normalizedPath.includes("/skills/")) {
    score -= 140;
  }

  if (insideExports) {
    score += 240;
  } else {
    score += 120;
  }

  return score;
}

export function isPrimaryResultDocumentPath(path?: string | null): boolean {
  return (
    scorePreferredResultFilePath(path) >
    scorePreferredResultFilePath("Agents.md")
  );
}
