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
  /^(?:请继续[。.]?\s*)?你上一条回复没有输出任何内容[。.]?/,
  /^(?:请继续[。.]?\s*)?你上一条回复还是中间过程结论，不是最终答复[。.]?/,
  /^上一条回复已经是完整结论(?:了)?[，,]\s*不是中间过程(?:[。.,，]\s*我已经基于足够的(?:代码)?证据给出了[:：]?)?/,
] as const;
const INTERNAL_PROTOCOL_LINE_PATTERNS = [
  /^structuredoutput$/i,
  /^select:\s*structuredoutput(?:\s*,.*)?$/i,
  /^structured output captured successfully\.?$/i,
  /^final output tool$/i,
  /^deliver artifact document$/i,
  /^output final deliver artifact document$/i,
  /^请继续[。.]?$/,
  /^你上一条回复没有输出任何内容[。.]?$/,
  /^你上一条回复还是中间过程结论，不是最终答复[。.]?$/,
  /^上一条回复已经是完整结论(?:了)?[，,]\s*不是中间过程[。.]?$/,
  /^我已经基于足够的(?:代码)?证据给出了[:：]?$/,
] as const;
const INTERNAL_PROTOCOL_PARAGRAPH_PREFIX_PATTERNS = [
  /^(?:请继续[。.]?\s*)?你上一条回复没有输出任何内容[。.]?/,
  /^(?:请继续[。.]?\s*)?你上一条回复还是中间过程结论，不是最终答复[。.]?/,
  /^上一条回复已经是完整结论(?:了)?[，,]\s*不是中间过程(?:[。.,，]\s*我已经基于足够的(?:代码)?证据给出了[:：]?)?/,
] as const;
const INTERNAL_CONTINUATION_LIST_LINE_RE =
  /^(?:[-*•]\s+|\d+[.)]\s+|项目概览$|\d+\s*个对标优化点$|\d+\s*阶段行动路线$)/;

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

  const firstLine = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (
    firstLine &&
    INTERNAL_PROTOCOL_PARAGRAPH_PREFIX_PATTERNS.some((pattern) =>
      pattern.test(firstLine),
    )
  ) {
    return true;
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

function stripInternalContinuationResidue(text: string): string {
  if (!text) {
    return "";
  }

  const lines = text.split(/\r?\n/);
  const keptLines: string[] = [];
  let skippingContinuationBlock = false;

  for (const line of lines) {
    const normalized = line.trim();

    if (
      INTERNAL_PROTOCOL_PARAGRAPH_PREFIX_PATTERNS.some((pattern) =>
        pattern.test(normalized),
      )
    ) {
      skippingContinuationBlock = true;
      continue;
    }

    if (!skippingContinuationBlock) {
      keptLines.push(line);
      continue;
    }

    if (
      !normalized ||
      INTERNAL_CONTINUATION_LIST_LINE_RE.test(normalized) ||
      INTERNAL_PROTOCOL_LINE_PATTERNS.some((pattern) =>
        pattern.test(normalized),
      )
    ) {
      continue;
    }

    skippingContinuationBlock = false;
    keptLines.push(line);
  }

  return normalizeProtocolStripWhitespace(keptLines.join("\n"));
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
  if (
    TOOL_PROTOCOL_DETECT_RE.test(text) ||
    containsProviderTraceResidue(text)
  ) {
    return true;
  }

  return text
    .split(/\n{2,}/)
    .some(
      (paragraph) =>
        isAssistantProtocolResidueParagraph(paragraph) ||
        paragraph
          .split(/\r?\n/)
          .some((line) => isAssistantProtocolResidueLine(line)),
    );
}

export function stripAssistantProtocolResidue(text: string): string {
  if (!text) {
    return "";
  }

  const withoutProviderTrace = stripProviderTraceResidue(text);
  const withoutInternalContinuation =
    stripInternalContinuationResidue(withoutProviderTrace);
  const withoutBlocks = withoutInternalContinuation.replace(
    TOOL_PROTOCOL_BLOCK_RE,
    "\n",
  );
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
    .filter(
      (paragraph) =>
        paragraph && !isAssistantProtocolResidueParagraph(paragraph),
    );

  return normalizeProtocolStripWhitespace(sanitizedParagraphs.join("\n\n"));
}
