const TOOL_PROTOCOL_BLOCK_RE =
  /<tool_(call|result)\b[^>]*>[\s\S]*?<\/tool_\1>/gi;
const TOOL_PROTOCOL_TAG_RE = /<\/?tool_(?:call|result)\b[^>]*\/?>/gi;
const TOOL_PROTOCOL_DETECT_RE = /<\/?tool_(?:call|result)\b[^>]*\/?>/i;
const PROVIDER_TRACE_TOOL_MARKER_RE =
  /(?:^|\s)(?:[A-Za-z0-9.-]+\s+)?Built-in Tool:\s*[A-Za-z0-9_.-]+/i;
const PROVIDER_TRACE_EXECUTING_RE = /^executing on server(?:\.\.\.)?/i;
const PROVIDER_TRACE_RESULT_SUMMARY_RE = /\b[A-Za-z0-9_]+_result_summary\b/i;
const INTERNAL_PROTOCOL_PARAGRAPH_PATTERNS = [
  /you must call the [`"]?structuredoutput[`"]? tool now/i,
  /you must use the [`"]?structuredoutput[`"]? tool/i,
  /final output must be a valid json object provided to the [`"]?structuredoutput[`"]? tool/i,
  /\bselect:\s*structuredoutput\b/i,
  /\bfinal[_\s-]*response\b.*\bsubmit\b.*\bresponse\b/i,
  /\boutput\b.*\bfinal\b.*\bdeliver\b.*\bartifact\b.*\bdocument\b/i,
] as const;
const INTERNAL_PROTOCOL_LINE_PATTERNS = [
  /^structuredoutput$/i,
  /^select:\s*structuredoutput(?:\s*,.*)?$/i,
  /^structured output captured successfully\.?$/i,
  /^final output tool$/i,
  /^deliver artifact document$/i,
  /^output final deliver artifact document$/i,
] as const;

function isLikelyProviderTraceJsonLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) {
    return true;
  }

  return (
    normalized === "JSON" ||
    normalized === "```json" ||
    normalized === "```" ||
    /^(?:\[|{)/.test(normalized) ||
    /^(?:\]|})/.test(normalized) ||
    /^"(?:[^"]+)"\s*:/.test(normalized) ||
    /^[:,}\]]+$/.test(normalized)
  );
}

function isProviderTraceContinuationLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) {
    return true;
  }

  return (
    /^input:$/i.test(normalized) ||
    /^output:/i.test(normalized) ||
    PROVIDER_TRACE_EXECUTING_RE.test(normalized) ||
    PROVIDER_TRACE_RESULT_SUMMARY_RE.test(normalized) ||
    isLikelyProviderTraceJsonLine(normalized)
  );
}

function stripInlineProviderTraceStart(line: string): string | null {
  const match = line.match(PROVIDER_TRACE_TOOL_MARKER_RE);
  if (!match || typeof match.index !== "number") {
    return null;
  }

  return line.slice(0, match.index).trimEnd();
}

function containsProviderTraceResidue(text: string): boolean {
  return (
    PROVIDER_TRACE_TOOL_MARKER_RE.test(text) ||
    PROVIDER_TRACE_EXECUTING_RE.test(text) ||
    PROVIDER_TRACE_RESULT_SUMMARY_RE.test(text)
  );
}

function isAssistantProtocolResidueLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }

  return [
    ...INTERNAL_PROTOCOL_PARAGRAPH_PATTERNS,
    ...INTERNAL_PROTOCOL_LINE_PATTERNS,
  ].some((pattern) => pattern.test(normalized));
}

function isAssistantProtocolResidueParagraph(paragraph: string): boolean {
  const normalized = paragraph.trim();
  if (!normalized) {
    return false;
  }

  if (
    INTERNAL_PROTOCOL_PARAGRAPH_PATTERNS.some((pattern) =>
      pattern.test(normalized),
    )
  ) {
    return true;
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const matchedLineCount = lines.filter((line) =>
    isAssistantProtocolResidueLine(line),
  ).length;

  return (
    matchedLineCount >= 2 ||
    (matchedLineCount >= 1 && lines.length <= 2 && normalized.length <= 240)
  );
}

function normalizeProtocolStripWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripProviderTraceResidue(text: string): string {
  if (!text) {
    return "";
  }

  const lines = text.split(/\r?\n/);
  const keptLines: string[] = [];
  let skippingTrace = false;
  let sawBlankWithinTrace = false;

  const appendLine = (line: string) => {
    keptLines.push(line);
  };

  for (const line of lines) {
    if (!skippingTrace) {
      const inlinePrefix = stripInlineProviderTraceStart(line);
      if (inlinePrefix !== null) {
        if (inlinePrefix) {
          appendLine(inlinePrefix);
        }
        skippingTrace = true;
        sawBlankWithinTrace = false;
        continue;
      }

      if (
        PROVIDER_TRACE_EXECUTING_RE.test(line.trim()) ||
        PROVIDER_TRACE_RESULT_SUMMARY_RE.test(line)
      ) {
        skippingTrace = true;
        sawBlankWithinTrace = false;
        continue;
      }

      appendLine(line);
      continue;
    }

    if (isProviderTraceContinuationLine(line)) {
      if (!line.trim()) {
        sawBlankWithinTrace = true;
      }
      continue;
    }

    if (
      sawBlankWithinTrace &&
      keptLines.length > 0 &&
      keptLines[keptLines.length - 1]?.trim() !== ""
    ) {
      appendLine("");
    }

    skippingTrace = false;
    sawBlankWithinTrace = false;

    const inlinePrefix = stripInlineProviderTraceStart(line);
    if (inlinePrefix !== null) {
      if (inlinePrefix) {
        appendLine(inlinePrefix);
      }
      skippingTrace = true;
      continue;
    }

    if (
      PROVIDER_TRACE_EXECUTING_RE.test(line.trim()) ||
      PROVIDER_TRACE_RESULT_SUMMARY_RE.test(line)
    ) {
      skippingTrace = true;
      continue;
    }

    appendLine(line);
  }

  return normalizeProtocolStripWhitespace(keptLines.join("\n"));
}

export function containsAssistantProtocolResidue(text: string): boolean {
  if (TOOL_PROTOCOL_DETECT_RE.test(text) || containsProviderTraceResidue(text)) {
    return true;
  }

  return text
    .split(/\n{2,}/)
    .some(
      (paragraph) =>
        isAssistantProtocolResidueParagraph(paragraph) ||
        paragraph.split(/\r?\n/).some((line) => isAssistantProtocolResidueLine(line)),
    );
}

export function stripAssistantProtocolResidue(text: string): string {
  if (!text) {
    return "";
  }

  const withoutProviderTrace = stripProviderTraceResidue(text);
  const withoutBlocks = withoutProviderTrace.replace(TOOL_PROTOCOL_BLOCK_RE, "\n");
  const withoutTags = withoutBlocks.replace(TOOL_PROTOCOL_TAG_RE, "\n");
  const sanitizedParagraphs = withoutTags
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split(/\r?\n/)
        .filter((line) => !isAssistantProtocolResidueLine(line))
        .join("\n")
        .trim(),
    )
    .filter((paragraph) => paragraph && !isAssistantProtocolResidueParagraph(paragraph));

  return normalizeProtocolStripWhitespace(sanitizedParagraphs.join("\n\n"));
}
