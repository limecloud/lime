export type VoiceWorkbenchCommandTrigger =
  | "@配音"
  | "@voice"
  | "@dubbing"
  | "@dub";

export interface ParsedVoiceWorkbenchCommand {
  rawText: string;
  trigger: VoiceWorkbenchCommandTrigger;
  body: string;
  prompt: string;
  targetLanguage?: string;
  voiceStyle?: string;
}

const VOICE_COMMAND_PREFIX_REGEX =
  /^\s*(@配音|@voice|@dubbing|@dub)(?:\s+|$)([\s\S]*)$/i;
const PROMPT_PREFIX_REGEX =
  /^\s*(帮我|给我|请|生成|制作|整理|输出|做一版|做个|做一个|create|generate|draft)(?:\s|$|[:：])*/i;
const FIELD_BOUNDARY_REGEX =
  /\s+(?=(?:帮我|给我|请|生成|制作|整理|输出|做一版|做个|做一个|create|generate|draft|目标语言|语言|language|风格|音色|voice|style))/i;

function trimDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+|[,\s，。；;:：]+$/g, "").trim();
}

function trimLeadingDecorations(value: string): string {
  return value.replace(/^[,\s，。；;:：]+/g, "").trimStart();
}

function normalizeTrigger(value: string): VoiceWorkbenchCommandTrigger {
  const normalized = value.trim().toLowerCase();
  if (normalized === "@voice") {
    return "@voice";
  }
  if (normalized === "@dubbing") {
    return "@dubbing";
  }
  if (normalized === "@dub") {
    return "@dub";
  }
  return "@配音";
}

function consumeNamedField(
  remaining: string,
  fieldNames: string[],
): { value?: string; remaining: string } | null {
  const normalized = remaining.trimStart();
  const matchedFieldName = fieldNames.find((fieldName) =>
    normalized.toLowerCase().startsWith(fieldName.toLowerCase()),
  );
  if (!matchedFieldName) {
    return null;
  }

  const rest = normalized
    .slice(matchedFieldName.length)
    .replace(/^\s*[:：=]?\s*/, "");
  const boundaryMatch = rest.match(FIELD_BOUNDARY_REGEX);
  if (!boundaryMatch) {
    const firstWhitespaceIndex = rest.search(/\s/);
    if (firstWhitespaceIndex > 0) {
      return {
        value: trimDecorations(rest.slice(0, firstWhitespaceIndex)),
        remaining: rest.slice(firstWhitespaceIndex).trimStart(),
      };
    }
    return {
      value: trimDecorations(rest),
      remaining: "",
    };
  }

  const boundaryIndex = boundaryMatch.index ?? rest.length;
  return {
    value: trimDecorations(rest.slice(0, boundaryIndex)),
    remaining: rest.slice(boundaryIndex).trimStart(),
  };
}

function consumeLeadingVoiceFields(body: string): {
  targetLanguage?: string;
  voiceStyle?: string;
  promptBody: string;
} {
  let remaining = body.trim();
  let targetLanguage: string | undefined;
  let voiceStyle: string | undefined;

  while (remaining) {
    const targetLanguageField = consumeNamedField(remaining, [
      "目标语言",
      "语言",
      "language",
    ]);
    if (targetLanguageField?.value) {
      targetLanguage = targetLanguage || targetLanguageField.value;
      remaining = trimLeadingDecorations(targetLanguageField.remaining);
      continue;
    }

    const voiceStyleField = consumeNamedField(remaining, [
      "风格",
      "音色",
      "voice",
      "style",
    ]);
    if (voiceStyleField?.value) {
      voiceStyle = voiceStyle || voiceStyleField.value;
      remaining = trimLeadingDecorations(voiceStyleField.remaining);
      continue;
    }

    break;
  }

  return {
    targetLanguage,
    voiceStyle,
    promptBody: remaining,
  };
}

function stripPromptDecorations(body: string): string {
  return trimDecorations(
    body.replace(PROMPT_PREFIX_REGEX, "").replace(/\s+/g, " "),
  );
}

export function parseVoiceWorkbenchCommand(
  text: string,
): ParsedVoiceWorkbenchCommand | null {
  const matched = text.match(VOICE_COMMAND_PREFIX_REGEX);
  if (!matched) {
    return null;
  }

  const body = (matched[2] || "").trim();
  const { targetLanguage, voiceStyle, promptBody } =
    consumeLeadingVoiceFields(body);
  const prompt = stripPromptDecorations(promptBody) || body;

  return {
    rawText: text,
    trigger: normalizeTrigger(matched[1] || ""),
    body,
    prompt,
    targetLanguage: targetLanguage || undefined,
    voiceStyle: voiceStyle || undefined,
  };
}
