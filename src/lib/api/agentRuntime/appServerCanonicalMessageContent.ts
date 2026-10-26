import type { MessageContentPart } from "@limecloud/app-server-client";
import { normalizeRecord } from "./appServerEventPayloadUtils";

// Multi-protocol output keeps durable media refs at the same boundary as text.
export function readCanonicalMessageContentParts(
  value: unknown,
): MessageContentPart[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const parts: MessageContentPart[] = [];
  for (const raw of value) {
    const part = normalizeRecord(raw);
    if (part?.type === "text" && typeof part.text === "string") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    const reference = normalizeRecord(part?.reference);
    if (
      part?.type !== "media" ||
      typeof part.kind !== "string" ||
      !part.kind.trim() ||
      !reference ||
      typeof reference.uri !== "string" ||
      !reference.uri.trim() ||
      typeof reference.mime_type !== "string" ||
      !reference.mime_type.trim()
    )
      return null;
    const strings: Record<string, string> = {};
    for (const key of [
      "title",
      "source_uri",
      "source_path",
      "preview_url",
      "sha256",
    ]) {
      const field = reference[key];
      if (field !== undefined && typeof field !== "string") return null;
      if (typeof field === "string") strings[key] = field;
    }
    if (
      [reference.uri, strings.source_uri, strings.preview_url].some((uri) =>
        uri?.trimStart().toLowerCase().startsWith("data:"),
      )
    )
      return null;
    const byteSize = reference.byte_size;
    if (
      byteSize !== undefined &&
      (typeof byteSize !== "number" ||
        !Number.isSafeInteger(byteSize) ||
        byteSize < 0)
    )
      return null;
    if (part.caption !== undefined && typeof part.caption !== "string")
      return null;
    parts.push({
      type: "media",
      kind: part.kind,
      reference: {
        uri: reference.uri,
        mime_type: reference.mime_type,
        ...strings,
        ...(byteSize !== undefined ? { byte_size: byteSize } : {}),
        ...(reference.sidecar_ref !== undefined
          ? { sidecar_ref: reference.sidecar_ref }
          : {}),
      },
      ...(typeof part.caption === "string" ? { caption: part.caption } : {}),
    });
  }
  return parts;
}
